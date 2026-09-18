import nodemailer from 'nodemailer';
import { config } from './config.js';

export const mailer = nodemailer.createTransport({
  host: config.SMTP_HOST, port: config.SMTP_PORT, secure: config.SMTP_SECURE,
  requireTLS: config.SMTP_REQUIRE_TLS,
  auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASS } : undefined,
  connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000,
  // Certificate validation remains enabled, including STARTTLS on port 587.
});
export async function sendVerification(email: string, rawToken: string) {
  // Fragment isn't sent to HTTP access logs or in Referer headers.
  const url = `${config.APP_ORIGIN}/verify#token=${encodeURIComponent(rawToken)}`;
  await mailer.sendMail({
    from: config.SMTP_FROM, to: email, subject: 'Confirme seu e-mail — Ponte',
    text: `Confirme seu e-mail para usar o Ponte: ${url}\nO link vale por 24 horas. Se você não criou uma conta, ignore este e-mail.`,
    html: `<div style="font-family:Arial,sans-serif;max-width:520px;margin:40px auto;color:#11152a"><h1>Ponte</h1><h2>Seus dispositivos, conectados.</h2><p>Confirme seu e-mail para começar a transferir arquivos.</p><p><a href="${url}" style="display:inline-block;padding:14px 22px;background:#3457e8;color:white;border-radius:8px;text-decoration:none">Confirmar e-mail</a></p><p>O link vale por 24 horas. Se você não criou uma conta, ignore este e-mail.</p></div>`,
  });
}
