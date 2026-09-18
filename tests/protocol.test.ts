import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeFrame, decodeFrame } from '../apps/web/src/lib/frames.js';
import { FileTransfer } from '../apps/web/src/lib/transfer.js';
import { CHUNK_SIZE, FRAME_HEADER, WINDOW_BYTES } from '@ponte/shared';
import { randomUUID } from 'node:crypto';

test('offsets acima de 4 GiB não sofrem truncamento de 32 bits', async () => {
  const offset = 5 * 1024 ** 3;
  const bytes = new Uint8Array([3, 0, 1, 255]);
  const frame = await encodeFrame(offset, bytes.buffer);
  assert.deepEqual(await decodeFrame(frame, offset, offset + 4), bytes);
});
test('blocos corrompidos, fora de ordem ou acima do tamanho são rejeitados', async () => {
  const frame = await encodeFrame(0, new Uint8Array([1, 2, 3]).buffer);
  await assert.rejects(decodeFrame(frame, 1, 4), /Ordem/);
  await assert.rejects(decodeFrame(frame, 0, 2), /excede/);
  new Uint8Array(frame)[FRAME_HEADER] = 5;
  await assert.rejects(decodeFrame(frame, 0, 3), /integridade/);
  await assert.rejects(encodeFrame(0, new ArrayBuffer(CHUNK_SIZE + 1)), /inválido/);
});

class Channel extends EventTarget {
  peer!: Channel; readyState = 'open'; binaryType = 'arraybuffer'; bufferedAmount = 0; bufferedAmountLowThreshold = 65536;
  sentBytes = 0; maxOutstanding = 0; persisted = 0;
  send(data: string | ArrayBuffer) {
    if (this.readyState !== 'open') throw new Error('closed');
    if (data instanceof ArrayBuffer) { this.sentBytes += data.byteLength - FRAME_HEADER; this.maxOutstanding = Math.max(this.maxOutstanding, this.sentBytes - this.persisted); }
    queueMicrotask(() => { if (this.peer.readyState === 'open') this.peer.dispatchEvent(new MessageEvent('message', { data })); });
  }
  close() { if (this.readyState === 'closed') return; this.readyState = 'closed'; this.dispatchEvent(new Event('close')); this.peer.close(); }
}
async function exercise(size: number, cancel = false) {
  const a = new Channel(), b = new Channel(); a.peer = b; b.peer = a;
  const id = randomUUID(), expected = new Uint8Array(size);
  for (let i = 0; i < size; i++) expected[i] = i % 251;
  const file = new File([expected], 'fixture.bin', { type: 'application/octet-stream' });
  const sinkBytes: number[] = [];
  let written = 0, closed = false, aborted = false, complete = false;
  let receiver: FileTransfer;
  const errors: string[] = [], senderProgress: number[] = [];
  const rpc = async <T,>(event: string): Promise<T> => {
    if (event === 'transfer:complete') { assert.equal(closed, true); complete = true; }
    return { id } as T;
  };
  const base = { roomId: randomUUID(), rpc, maxMessageSize: 65536, metadata: async () => ({ fileName: file.name, fileSize: String(size), mimeType: file.type }), onDone: () => {}, onError: (m: string) => errors.push(m) };
  receiver = new FileTransfer(b as unknown as RTCDataChannel, { ...base, onProgress: () => {}, onOffer: value => {
    if (!value) return;
    void receiver.accept({
      write: async chunk => { await new Promise(resolve => setTimeout(resolve, 1)); assert.deepEqual(chunk, expected.slice(written, written + chunk.length)); written += chunk.length; a.persisted = written; sinkBytes.push(chunk.length); if (cancel && written >= CHUNK_SIZE) void receiver.cancel(); },
      close: async () => { assert.equal(written, size); closed = true; }, abort: async () => { aborted = true; },
    });
  } });
  const sender = new FileTransfer(a as unknown as RTCDataChannel, { ...base, onOffer: () => {}, onProgress: p => { senderProgress.push(p.bytes); assert.ok(p.bytes <= written); } });
  await sender.send(file);
  if (cancel) { assert.equal(complete, false); assert.equal(aborted, true); assert.equal(closed, false); }
  else { assert.equal(complete, true); assert.equal(written, size); assert.equal(closed, true); assert.equal(errors.length, 0); assert.equal(senderProgress.at(-1), size); }
  assert.ok(a.maxOutstanding <= WINDOW_BYTES, `window exceeded: ${a.maxOutstanding}`);
  assert.ok(sinkBytes.every(n => n <= CHUNK_SIZE));
  sender.dispose(); receiver.dispose();
}
test('janela limita dados em trânsito e 100% espera fechamento do arquivo', { timeout: 20000 }, () => exercise(3 * WINDOW_BYTES + 73));
test('arquivo vazio é salvo e confirmado sem divisão por zero', () => exercise(0));
test('cancelamento aborta destino e não registra sucesso', { timeout: 10000 }, () => exercise(3 * WINDOW_BYTES, true));
