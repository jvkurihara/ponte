import { randomBytes, randomUUID } from 'node:crypto';
import type { Server as HTTPServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import { z } from 'zod';
import { fileMeta, byteCount } from '../../../packages/shared/src/index.js';
import { config } from './config.js';
import { sessionFromCookie } from './auth.js';
import { db } from './db.js';

type Active = { id: string; size: number };
type Room = { id: string; code: string; owner: string; guest?: string; ready: boolean; expiresAt: number; active?: Active; creating?: boolean };
const roomId = z.object({ roomId: z.string().uuid() });
const candidate = z.object({ candidate: z.string().max(4096), sdpMid: z.string().max(256).nullable().optional(), sdpMLineIndex: z.number().int().min(0).max(65535).nullable().optional(), usernameFragment: z.string().max(256).nullable().optional() });
const signal = roomId.extend({ payload: z.union([
  z.object({ description: z.object({ type: z.enum(['offer', 'answer']), sdp: z.string().max(60000) }) }),
  z.object({ candidate }),
]) });
const transferId = z.object({ id: z.string().uuid() });
const fail = (message: string): never => { throw new Error(message); };

export function signaling(server: HTTPServer) {
  const io = new Server(server, {
    maxHttpBufferSize: 70_000, transports: ['websocket'],
    cors: { origin: config.APP_ORIGIN, credentials: true },
    allowRequest: (req, callback) => callback(null, req.headers.origin === config.APP_ORIGIN),
  });
  const rooms = new Map<string, Room>(), byCode = new Map<string, string>();
  const ipCounts = new Map<string, number>();
  io.use(async (socket, next) => {
    try {
      const session = await sessionFromCookie(socket.request.headers.cookie);
      if (!session?.user.emailVerifiedAt) return next(new Error('Confirme seu e-mail e entre novamente.'));
      const ip = socket.handshake.address;
      if ((ipCounts.get(ip) || 0) >= 30) return next(new Error('Muitas conexões nesta rede.'));
      socket.data.sessionId = session.id; socket.data.user = session.user; socket.data.expiresAt = session.expiresAt.getTime();
      next();
    } catch { next(new Error('Não foi possível autenticar.')); }
  });
  function membership(socket: Socket, id: string) {
    const room = rooms.get(id);
    if (!room || (room.owner !== socket.id && room.guest !== socket.id)) fail('Pareamento não encontrado.');
    return room!;
  }
  function counterpart(socket: Socket, room: Room) { return room.owner === socket.id ? room.guest : room.owner; }
  function active(socket: Socket, id: string, receiver = false) {
    const room = membership(socket, socket.data.roomId);
    if (!room.ready || room.active?.id !== id || (receiver && room.owner !== socket.id)) fail('Transferência não autorizada.');
    return room;
  }
  async function closeRoom(id: string, reason: string) {
    const room = rooms.get(id); if (!room) return;
    rooms.delete(id); byCode.delete(room.code);
    for (const sid of [room.owner, room.guest]) {
      if (!sid) continue;
      const s = io.sockets.sockets.get(sid);
      if (s?.data.roomId === id) delete s.data.roomId;
      s?.emit('room:closed', { reason });
    }
    if (room.active) await db.transfer.updateMany({ where: { id: room.active.id, status: { in: ['PENDING', 'IN_PROGRESS'] } }, data: { status: 'FAILED' } });
  }
  io.on('connection', socket => {
    const ip = socket.handshake.address;
    ipCounts.set(ip, (ipCounts.get(ip) || 0) + 1);
    socket.join(`session:${socket.data.sessionId}`);
    const expiry = setTimeout(() => socket.disconnect(true), Math.min(2147483647, socket.data.expiresAt - Date.now()));
    let epoch = Date.now(), count = 0, queue = Promise.resolve();
    socket.use(async (_packet, next) => {
      if (Date.now() - epoch > 60_000) { epoch = Date.now(); count = 0; }
      if (++count > 240) { next(new Error('Muitas mensagens.')); socket.disconnect(true); return; }
      try {
        const session = await sessionFromCookie(socket.request.headers.cookie);
        if (!session?.user.emailVerifiedAt) { next(new Error('Sessão encerrada.')); socket.disconnect(true); return; }
        next();
      } catch { next(new Error('Sessão indisponível.')); socket.disconnect(true); }
    });
    function on<T>(event: string, schema: z.ZodType<T>, handler: (data: T) => unknown | Promise<unknown>) {
      socket.on(event, (data: unknown, ack: unknown) => {
        if (typeof ack !== 'function') return;
        queue = queue.then(async () => {
          if (!socket.connected) return;
          try { ack({ ok: true, data: await handler(schema.parse(data)) }); }
          catch (err) {
            const message = err instanceof z.ZodError ? 'Dados inválidos.' : err instanceof Error && !('code' in err) ? err.message : 'Não foi possível concluir a operação.';
            ack({ ok: false, error: message });
          }
        });
      });
    }
    on('room:create', z.object({}), async () => {
      if (socket.data.roomId) await closeRoom(socket.data.roomId, 'Novo pareamento.');
      const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      let code: string;
      do { code = Array.from(randomBytes(12), b => alphabet[b % 32]).join(''); } while (byCode.has(code));
      const room: Room = { id: randomUUID(), code, owner: socket.id, ready: false, expiresAt: Date.now() + 600_000 };
      rooms.set(room.id, room); byCode.set(code, room.id); socket.data.roomId = room.id;
      return { roomId: room.id, code, expiresAt: room.expiresAt };
    });
    on('room:join', z.object({ code: z.string().regex(/^[A-Z2-9]{12}$/) }), async ({ code }) => {
      if (socket.data.roomId) await closeRoom(socket.data.roomId, 'Novo pareamento.');
      const room = rooms.get(byCode.get(code) || '');
      if (!room || room.expiresAt < Date.now() || room.guest || room.owner === socket.id) fail('Código inválido, ocupado ou expirado.');
      room!.guest = socket.id; socket.data.roomId = room!.id;
      io.to(room!.owner).emit('room:request', { roomId: room!.id, email: socket.data.user.email });
      return { roomId: room!.id };
    });
    on('room:respond', roomId.extend({ accept: z.boolean() }), async ({ roomId, accept }) => {
      const room = membership(socket, roomId);
      if (room.owner !== socket.id || !room.guest || room.ready) fail('Solicitação inválida.');
      if (!accept) { await closeRoom(roomId, 'Conexão recusada.'); return {}; }
      room.ready = true; byCode.delete(room.code);
      io.to(room.owner).emit('room:ready', { roomId, role: 'receiver', email: io.sockets.sockets.get(room.guest!)?.data.user.email });
      io.to(room.guest!).emit('room:ready', { roomId, role: 'sender', email: socket.data.user.email });
      return {};
    });
    on('room:leave', z.object({}), async () => { if (socket.data.roomId) await closeRoom(socket.data.roomId, 'Dispositivo desconectado.'); return {}; });
    on('signal', signal, ({ roomId, payload }) => {
      const room = membership(socket, roomId);
      if (!room.ready) fail('Aguarde a aprovação do receptor.');
      if ('description' in payload && ((payload.description.type === 'offer') !== (socket.id === room.guest))) fail('Papel de sinalização inválido.');
      io.to(counterpart(socket, room)!).emit('signal', { roomId, payload });
      return {};
    });
    on('transfer:create', roomId.extend({ file: fileMeta }), async ({ roomId, file }) => {
      const room = membership(socket, roomId);
      if (!room.ready || room.guest !== socket.id || room.active || room.creating) fail('O dispositivo precisa estar conectado e livre.');
      const receiver = io.sockets.sockets.get(room.owner);
      if (!receiver) fail('Receptor desconectado.');
      room.creating = true;
      try {
        const row = await db.transfer.create({ data: { senderId: socket.data.user.id, receiverId: receiver!.data.user.id, fileName: file.name, fileSize: BigInt(file.size), mimeType: file.mime } });
        if (!rooms.has(roomId)) { await db.transfer.update({ where: { id: row.id }, data: { status: 'FAILED' } }); fail('Conexão encerrada.'); }
        room.active = { id: row.id, size: file.size };
        return { id: row.id };
      } finally { room.creating = false; }
    });
    on('transfer:start', transferId, async ({ id }) => {
      active(socket, id, true);
      const result = await db.transfer.updateMany({ where: { id, status: 'PENDING' }, data: { status: 'IN_PROGRESS' } });
      if (!result.count) fail('Transferência já encerrada.');
      return {};
    });
    on('transfer:progress', transferId.extend({ bytes: byteCount }), async ({ id, bytes }) => {
      const room = active(socket, id, true);
      if (bytes > room.active!.size) fail('Contagem de bytes inválida.');
      await db.transfer.updateMany({ where: { id, status: 'IN_PROGRESS', bytesReceived: { lte: BigInt(bytes) } }, data: { bytesReceived: BigInt(bytes) } });
      return {};
    });
    on('transfer:complete', transferId.extend({ bytes: byteCount }), async ({ id, bytes }) => {
      const room = active(socket, id, true);
      if (bytes !== room.active!.size) fail('Arquivo incompleto.');
      const result = await db.transfer.updateMany({ where: { id, status: 'IN_PROGRESS' }, data: { bytesReceived: BigInt(bytes), status: 'COMPLETED', completedAt: new Date() } });
      if (!result.count) fail('Transferência já encerrada.');
      delete room.active;
      return {};
    });
    on('transfer:cancel', transferId.extend({ failed: z.boolean().default(false) }), async ({ id, failed }) => {
      const room = active(socket, id);
      await db.transfer.updateMany({ where: { id, status: { in: ['PENDING', 'IN_PROGRESS'] } }, data: { status: failed ? 'FAILED' : 'CANCELLED' } });
      delete room.active; return {};
    });
    socket.on('disconnect', () => {
      clearTimeout(expiry);
      const remaining = (ipCounts.get(ip) || 1) - 1;
      if (remaining) ipCounts.set(ip, remaining); else ipCounts.delete(ip);
      if (socket.data.roomId) void closeRoom(socket.data.roomId, 'Dispositivo desconectado. Gere um novo código.').catch(() => console.error('Falha ao registrar desconexão.'));
    });
  });
  const cleanup = setInterval(() => {
    for (const room of rooms.values()) if (!room.ready && room.expiresAt < Date.now()) void closeRoom(room.id, 'Código expirado.').catch(() => {});
  }, 10_000);
  cleanup.unref();
  return { io, stop: () => clearInterval(cleanup), onLogout: (id: string) => io.in(`session:${id}`).disconnectSockets(true) };
}
