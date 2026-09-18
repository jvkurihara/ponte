import { randomBytes, createHash, scrypt, timingSafeEqual } from 'node:crypto';
const options = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
export const token = () => randomBytes(32).toString('hex');
export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  const key = await new Promise<Buffer>((resolve, reject) => scrypt(password, salt, 64, options, (err, data) => err ? reject(err) : resolve(data)));
  return `scrypt$32768$8$3$${salt}$${key.toString('hex')}`;
}
export async function verifyPassword(password: string, encoded: string) {
  const [kind, n, r, p, salt, hash] = encoded.split('$');
  if (kind !== 'scrypt' || n !== '32768' || r !== '8' || p !== '3' || !salt || !hash || !/^[a-f0-9]{128}$/.test(hash)) return false;
  const key = await new Promise<Buffer>((resolve, reject) => scrypt(password, salt, 64, options, (err, data) => err ? reject(err) : resolve(data)));
  return timingSafeEqual(key, Buffer.from(hash, 'hex'));
}
