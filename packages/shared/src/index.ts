import { z } from 'zod';

// A file's total size has no product quota. Browser File.size uses a JS number.
export const byteCount = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const fileMeta = z.object({
  name: z.string().min(1).max(255).refine(n => !/[\x00-\x1f/\\]/.test(n), 'Nome inválido'),
  size: byteCount,
  mime: z.string().max(255),
});
export type FileMeta = z.infer<typeof fileMeta>;
export const CHUNK_SIZE = 16 * 1024;
export const FRAME_HEADER = 40; // uint64 offset + SHA-256 digest
export const WINDOW_BYTES = 1024 * 1024;
export const controlMessage = z.discriminatedUnion('type', [
  z.object({ type: z.literal('offer'), id: z.string().uuid(), file: fileMeta }),
  z.object({ type: z.literal('accept'), id: z.string().uuid() }),
  z.object({ type: z.literal('ack'), id: z.string().uuid(), bytes: byteCount }),
  z.object({ type: z.literal('end'), id: z.string().uuid() }),
  z.object({ type: z.literal('complete'), id: z.string().uuid(), historySaved: z.boolean() }),
  z.object({ type: z.literal('cancel'), id: z.string().uuid() }),
]);
export type ControlMessage = z.infer<typeof controlMessage>;
export type User = { id: string; email: string; verified: boolean };
export type TransferRecord = { id: string; fileName: string; fileSize: string; bytesReceived: string; status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'FAILED'; createdAt: string; senderId: string; receiverId: string };
export type Reply<T> = { ok: true; data: T } | { ok: false; error: string };
