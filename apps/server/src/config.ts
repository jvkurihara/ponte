import 'dotenv/config';
import { z } from 'zod';
const bool = z.enum(['true', 'false']).transform(v => v === 'true');
export const config = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  APP_ORIGIN: z.string().url().transform(v => new URL(v).origin),
  DATABASE_URL: z.string().min(1),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
  SESSION_DAYS: z.coerce.number().int().min(1).max(30).default(7),
  SMTP_HOST: z.string().min(1), SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_SECURE: bool.default('false'), SMTP_REQUIRE_TLS: bool.default('true'),
  SMTP_USER: z.string().default(''), SMTP_PASS: z.string().default(''), SMTP_FROM: z.string().min(1),
  STUN_URLS: z.string().default(''), TURN_URLS: z.string().default(''), TURN_SHARED_SECRET: z.string().default(''),
  TURN_TTL_SECONDS: z.coerce.number().int().min(600).max(604800).default(86400),
}).parse(process.env);
if (config.NODE_ENV === 'production' && !config.APP_ORIGIN.startsWith('https://')) throw new Error('APP_ORIGIN deve usar HTTPS em produção.');
if (Boolean(config.SMTP_USER) !== Boolean(config.SMTP_PASS)) throw new Error('Preencha SMTP_USER e SMTP_PASS juntos.');
if (config.TURN_URLS && config.TURN_SHARED_SECRET.length < 32) throw new Error('TURN_SHARED_SECRET precisa de pelo menos 32 caracteres.');
