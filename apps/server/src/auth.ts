import { Router, type RequestHandler } from 'express';
import { parse } from 'cookie';
import { z } from 'zod';
import { rateLimit } from 'express-rate-limit';
import { Prisma } from '@prisma/client';
import { db } from './db.js';
import { config } from './config.js';
import { digest, hashPassword, token, verifyPassword } from './security.js';
import { sendVerification } from './mail.js';

export const COOKIE = 'ponte_session';
const cookieOptions = { httpOnly: true, secure: config.NODE_ENV === 'production' || config.APP_ORIGIN.startsWith('https:'), sameSite: 'lax' as const, path: '/' };
const credentials = z.object({ email: z.string().trim().email().max(254).transform(v => v.toLowerCase()), password: z.string().min(10).max(128) });
const publicUser = (u: { id: string; email: string; emailVerifiedAt: Date | null }) => ({ id: u.id, email: u.email, verified: Boolean(u.emailVerifiedAt) });
const genericMail = { message: 'Se a conta precisar de verificação, você receberá um link por e-mail. Confira também o spam.' };
const dummyHash = await hashPassword(token());
export async function sessionFromCookie(header?: string) {
  const raw = parse(header || '')[COOKIE];
  if (!raw || !/^[a-f0-9]{64}$/.test(raw)) return null;
  return db.session.findFirst({ where: { tokenHash: digest(raw), expiresAt: { gt: new Date() } }, include: { user: true } });
}
export const authenticated: RequestHandler = async (req, res, next) => {
  try {
    const session = await sessionFromCookie(req.headers.cookie);
    if (!session) { res.status(401).json({ error: 'Entre na sua conta.' }); return; }
    res.locals.session = session; next();
  } catch (e) { next(e); }
};
export const verified: RequestHandler = (_req, res, next) => {
  if (!res.locals.session.user.emailVerifiedAt) { res.status(403).json({ error: 'Confirme seu e-mail antes de transferir.' }); return; }
  next();
};
async function issueVerification(userId: string, email: string) {
  const raw = token();
  const row = await db.verificationToken.create({ data: { userId, tokenHash: digest(raw), expiresAt: new Date(Date.now() + 86400_000) } });
  try { await sendVerification(email, raw); }
  catch { await db.verificationToken.deleteMany({ where: { id: row.id } }); throw new Error('SMTP_UNAVAILABLE'); }
}
export function authRouter(onLogout: (sessionId: string) => void) {
  const router = Router();
  const limiter = rateLimit({ windowMs: 15 * 60_000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Muitas tentativas. Aguarde 15 minutos.' } });
  router.post('/register', limiter, async (req, res) => {
    const input = credentials.parse(req.body);
    const passwordHash = await hashPassword(input.password);
    let user;
    try { user = await db.user.create({ data: { email: input.email, passwordHash } }); }
    catch (e) { if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') { res.status(202).json(genericMail); return; } throw e; }
    await issueVerification(user.id, user.email);
    res.status(202).json(genericMail);
  });
  router.post('/resend', limiter, async (req, res) => {
    const email = credentials.shape.email.parse(req.body.email);
    const user = await db.user.findUnique({ where: { email } });
    if (user && !user.emailVerifiedAt) {
      const recent = await db.verificationToken.count({ where: { userId: user.id, createdAt: { gt: new Date(Date.now() - 60_000) } } });
      if (!recent) await issueVerification(user.id, email);
    }
    res.status(202).json(genericMail);
  });
  router.post('/verify', limiter, async (req, res) => {
    const raw = z.string().regex(/^[a-f0-9]{64}$/).parse(req.body.token);
    const ok = await db.$transaction(async tx => {
      const record = await tx.verificationToken.findUnique({ where: { tokenHash: digest(raw) } });
      if (!record) return false;
      const claimed = await tx.verificationToken.deleteMany({ where: { id: record.id, expiresAt: { gt: new Date() } } });
      if (!claimed.count) return false;
      await tx.user.update({ where: { id: record.userId }, data: { emailVerifiedAt: new Date() } });
      await tx.verificationToken.deleteMany({ where: { userId: record.userId } });
      return true;
    });
    if (!ok) { res.status(400).json({ error: 'Link inválido, expirado ou já utilizado. Solicite outro.' }); return; }
    res.json({ message: 'E-mail confirmado! Você já pode entrar.' });
  });
  router.post('/login', limiter, async (req, res) => {
    const input = credentials.parse(req.body);
    const user = await db.user.findUnique({ where: { email: input.email } });
    const valid = await verifyPassword(input.password, user?.passwordHash || dummyHash);
    if (!user || !valid) { res.status(401).json({ error: 'E-mail ou senha incorretos.' }); return; }
    const old = await sessionFromCookie(req.headers.cookie);
    if (old) { await db.session.deleteMany({ where: { id: old.id } }); onLogout(old.id); }
    const raw = token(), maxAge = config.SESSION_DAYS * 86400_000;
    await db.session.create({ data: { userId: user.id, tokenHash: digest(raw), expiresAt: new Date(Date.now() + maxAge) } });
    res.cookie(COOKIE, raw, { ...cookieOptions, maxAge }).json({ user: publicUser(user) });
  });
  router.get('/me', authenticated, (_req, res) => { res.json({ user: publicUser(res.locals.session.user) }); });
  router.post('/logout', authenticated, async (_req, res) => {
    const id = res.locals.session.id as string;
    await db.session.deleteMany({ where: { id } }); onLogout(id);
    res.clearCookie(COOKIE, cookieOptions).json({ ok: true });
  });
  return router;
}
