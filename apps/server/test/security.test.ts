import test from 'node:test';
import assert from 'node:assert/strict';
import { digest, hashPassword, token, verifyPassword } from '../src/security.js';

test('senhas usam salt único e rejeitam senha incorreta', async () => {
  const first = await hashPassword('Uma senha comprida!');
  const second = await hashPassword('Uma senha comprida!');
  assert.notEqual(first, second);
  assert.equal(await verifyPassword('Uma senha comprida!', first), true);
  assert.equal(await verifyPassword('uma senha comprida!', first), false);
  assert.equal(await verifyPassword('abc', 'invalid-hash'), false);
  assert.equal(first.includes('Uma senha'), false);
});
test('tokens imprevisíveis de 256 bits são armazenados apenas como hash', () => {
  const a = token(), b = token();
  assert.match(a, /^[0-9a-f]{64}$/); assert.notEqual(a, b); assert.notEqual(a, digest(a));
});
