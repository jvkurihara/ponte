import { createServer } from 'node:http';
import { createHmac } from 'node:crypto';
import path from 'node:path';
import express, { type ErrorRequestHandler } from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { config } from './config.js';
import { db } from './db.js';
import { authRouter, authenticated, verified } from './auth.js';
import { signaling } from './signaling.js';
import { mailer } from './mail.js';

export const app = express();
export const server = createServer(app);
const { io, onLogout, stop } = signaling(server);
app.disable('x-powered-by');
app.set('trust proxy', config.TRUST_PROXY_HOPS);
app.set('json replacer', (_key: string, value: unknown) => typeof value === 'bigint' ? value.toString() : value);
app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], connectSrc: ["'self'", 'ws:', 'wss:'], imgSrc: ["'self'", 'blob:', 'data:'], scriptSrc: ["'self'"], styleSrc: ["'self'"], objectSrc: ["'none'"], upgradeInsecureRequests: config.NODE_ENV === 'production' ? [] : null } }, referrerPolicy: { policy: 'no-referrer' } }));
app.use('/api', (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
app.use('/api', rateLimit({ windowMs: 60_000, limit: 180, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Muitas requisições. Aguarde um minuto.' } }));
app.use('/api', (req, res, next) => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers.origin !== config.APP_ORIGIN) { res.status(403).json({ error: 'Origem não permitida.' }); return; }
  next();
});
app.use(express.json({ limit: '70kb' })); // ONLY metadata/auth/signaling, never the file payload.
app.get('/api/health', async (_req, res) => { await db.$queryRaw`SELECT 1`; res.json({ ok: true }); });
app.use('/api/auth', authRouter(onLogout));
app.get('/api/ice', authenticated, verified, (_req, res) => {
  const iceServers: Array<{ urls: string[]; username?: string; credential?: string }> = [];
  if (config.STUN_URLS) iceServers.push({ urls: config.STUN_URLS.split(',').map(v => v.trim()).filter(Boolean) });
  if (config.TURN_URLS) {
    const username = `${Math.floor(Date.now() / 1000) + config.TURN_TTL_SECONDS}:${res.locals.session.user.id}`;
    iceServers.push({ urls: config.TURN_URLS.split(',').map(v => v.trim()).filter(Boolean), username, credential: createHmac('sha1', config.TURN_SHARED_SECRET).update(username).digest('base64') });
  }
  res.json({ iceServers });
});
app.get('/api/transfers', authenticated, verified, async (req, res) => {
  const offset = z.coerce.number().int().min(0).max(100000).default(0).parse(req.query.offset);
  const id = res.locals.session.user.id;
  const rows = await db.transfer.findMany({ where: { OR: [{ senderId: id }, { receiverId: id }] }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: offset, take: 21 });
  res.json({ transfers: rows.slice(0, 20), nextOffset: rows.length > 20 ? offset + 20 : null });
});
app.get('/api/transfers/:id', authenticated, verified, async (req, res) => {
  const id = z.string().uuid().parse(req.params.id), userId = res.locals.session.user.id;
  const transfer = await db.transfer.findFirst({ where: { id, OR: [{ senderId: userId }, { receiverId: userId }] } });
  if (!transfer) { res.status(404).json({ error: 'Transferência não encontrada.' }); return; }
  res.json({ transfer });
});
app.use('/api', (_req, res) => { res.status(404).json({ error: 'Rota não encontrada.' }); });
if (config.NODE_ENV === 'production') {
  const web = path.resolve('../web/dist');
  app.use(express.static(web));
  app.get('/{*path}', (_req, res) => { res.sendFile(path.join(web, 'index.html')); });
}
const errors: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof z.ZodError) { res.status(400).json({ error: 'Dados inválidos. Confira os campos preenchidos.' }); return; }
  if (err instanceof SyntaxError) { res.status(400).json({ error: 'JSON inválido.' }); return; }
  if (err?.type === 'entity.too.large') { res.status(413).json({ error: 'Mensagem de controle muito grande.' }); return; }
  if (err?.message === 'SMTP_UNAVAILABLE') { res.status(503).json({ error: 'Conta criada, mas o envio do e-mail falhou. Confira o SMTP e use Reenviar verificação.' }); return; }
  console.error('Falha interna:', err instanceof Error ? err.name : 'UnknownError');
  res.status(500).json({ error: 'Não foi possível concluir. Tente novamente.' });
};
app.use(errors);

// A single signaling instance owns in-memory rooms. Its old active rows can't resume after restart.
await db.$connect();
await db.transfer.updateMany({ where: { status: { in: ['PENDING', 'IN_PROGRESS'] } }, data: { status: 'FAILED' } });
const sweep = setInterval(() => {
  void Promise.all([
    db.session.deleteMany({ where: { expiresAt: { lt: new Date() } } }),
    db.verificationToken.deleteMany({ where: { expiresAt: { lt: new Date() } } }),
  ]).catch(() => console.error('Falha ao limpar tokens expirados.'));
}, 3600_000);
sweep.unref();
server.listen(config.PORT, '0.0.0.0', () => console.log(`Ponte API na porta ${config.PORT}`));
async function shutdown() { stop(); clearInterval(sweep); io.close(); server.close(); mailer.close(); await db.$disconnect(); process.exit(0); }
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
