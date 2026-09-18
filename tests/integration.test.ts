import test from 'node:test';
import assert from 'node:assert/strict';
import { io, type Socket } from 'socket.io-client';
import { createAccount, endpoint, origin, request } from './helpers.js';
import { randomUUID } from 'node:crypto';

async function connect(cookie: string) {
  const socket = io(endpoint, { transports: ['websocket'], extraHeaders: { Origin: origin, Cookie: cookie }, reconnection: false });
  await new Promise<void>((resolve, reject) => { socket.on('connect', resolve); socket.on('connect_error', reject); });
  return socket;
}
const rpc = (s: Socket, event: string, value: unknown) => s.timeout(5000).emitWithAck(event, value);
test('autenticação, verificação, autorização e histórico com PostgreSQL e SMTP reais', { timeout: 45000 }, async t => {
  const unverified = await createAccount('unverified', false);
  await t.test('origem externa é bloqueada antes do cadastro', async () => {
    const res = await fetch(endpoint + '/api/auth/register', { method: 'POST', headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(res.status, 403);
  });
  await t.test('contas não verificadas não recebem ICE nem acesso a Socket.io', async () => {
    assert.equal((await request('/ice', undefined, unverified.cookie)).status, 403);
    await assert.rejects(connect(unverified.cookie), /Confirme/);
  });
  await t.test('token é descartável e senha inválida não autentica', async () => {
    assert.equal((await request('/auth/verify', { token: unverified.token })).status, 200);
    assert.equal((await request('/auth/verify', { token: unverified.token })).status, 400);
    assert.equal((await request('/auth/login', { email: unverified.email, password: 'not-the-right-password' })).status, 401);
  });
  const receiver = await createAccount('receiver'), outsider = await createAccount('outsider');
  const senderSocket = await connect(unverified.cookie), receiverSocket = await connect(receiver.cookie), outsiderSocket = await connect(outsider.cookie);
  t.after(() => { senderSocket.disconnect(); receiverSocket.disconnect(); outsiderSocket.disconnect(); });
  const room = (await rpc(receiverSocket, 'room:create', {})).data;
  assert.match(room.code, /^[A-Z2-9]{12}$/);
  assert.equal((await rpc(senderSocket, 'room:join', { code: room.code })).ok, true);
  await t.test('sinalização exige aprovação e vínculo com a sala', async () => {
    assert.equal((await rpc(senderSocket, 'signal', { roomId: room.roomId, payload: { description: { type: 'offer', sdp: 'test' } } })).ok, false);
    assert.equal((await rpc(outsiderSocket, 'room:respond', { roomId: room.roomId, accept: true })).ok, false);
    assert.equal((await rpc(receiverSocket, 'room:respond', { roomId: room.roomId, accept: true })).ok, true);
  });
  const transfer = (await rpc(senderSocket, 'transfer:create', { roomId: room.roomId, file: { name: 'large-file.bin', size: 6 * 1024 ** 3, mime: 'application/octet-stream' } })).data;
  await t.test('arquivo >4 GiB é modelado sem truncar; terceiro não lê nem conclui', async () => {
    assert.equal((await request(`/transfers/${transfer.id}`, undefined, outsider.cookie)).status, 404);
    assert.equal((await rpc(outsiderSocket, 'transfer:complete', { id: transfer.id, bytes: 6 * 1024 ** 3 })).ok, false);
    assert.equal((await rpc(senderSocket, 'transfer:complete', { id: transfer.id, bytes: 6 * 1024 ** 3 })).ok, false);
    const row = await (await request(`/transfers/${transfer.id}`, undefined, receiver.cookie)).json();
    assert.equal(row.transfer.fileSize, String(6 * 1024 ** 3));
  });
  await t.test('não conclui antes do aceite ou com contagem incompleta', async () => {
    assert.equal((await rpc(receiverSocket, 'transfer:complete', { id: transfer.id, bytes: 6 * 1024 ** 3 })).ok, false);
    assert.equal((await rpc(receiverSocket, 'transfer:start', { id: transfer.id })).ok, true);
    assert.equal((await rpc(receiverSocket, 'transfer:complete', { id: transfer.id, bytes: 1 })).ok, false);
    assert.equal((await rpc(receiverSocket, 'transfer:cancel', { id: transfer.id })).ok, true);
    assert.equal((await rpc(receiverSocket, 'transfer:complete', { id: transfer.id, bytes: 6 * 1024 ** 3 })).ok, false);
    const row = await (await request(`/transfers/${transfer.id}`, undefined, receiver.cookie)).json();
    assert.equal(row.transfer.status, 'CANCELLED');
  });
  await t.test('logout revoga sessão HTTP e socket existente', async () => {
    const disconnected = new Promise(resolve => receiverSocket.once('disconnect', resolve));
    assert.equal((await request('/auth/logout', {}, receiver.cookie)).status, 200);
    await disconnected;
    assert.equal((await request('/auth/me', undefined, receiver.cookie)).status, 401);
  });
  assert.equal((await request(`/transfers/${randomUUID()}`, undefined, unverified.cookie)).status, 404);
});
