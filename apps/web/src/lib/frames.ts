import { CHUNK_SIZE, FRAME_HEADER } from '@ponte/shared';
export async function encodeFrame(offset: number, bytes: ArrayBuffer) {
  if (!Number.isSafeInteger(offset) || offset < 0 || bytes.byteLength > CHUNK_SIZE || bytes.byteLength === 0) throw new Error('Bloco inválido.');
  const frame = new ArrayBuffer(FRAME_HEADER + bytes.byteLength);
  new DataView(frame).setBigUint64(0, BigInt(offset));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  new Uint8Array(frame, 8, 32).set(new Uint8Array(digest));
  new Uint8Array(frame, FRAME_HEADER).set(new Uint8Array(bytes));
  return frame;
}
export async function decodeFrame(frame: ArrayBuffer, expectedOffset: number, totalSize: number) {
  if (frame.byteLength <= FRAME_HEADER || frame.byteLength > CHUNK_SIZE + FRAME_HEADER) throw new Error('Tamanho do bloco inválido.');
  const offset = new DataView(frame).getBigUint64(0);
  if (offset !== BigInt(expectedOffset)) throw new Error('Ordem dos blocos inválida.');
  const payload = frame.slice(FRAME_HEADER);
  if (expectedOffset + payload.byteLength > totalSize) throw new Error('O arquivo excede o tamanho informado.');
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', payload));
  const expected = new Uint8Array(frame, 8, 32);
  if (!hash.every((byte, i) => byte === expected[i])) throw new Error('Falha de integridade no bloco.');
  return new Uint8Array(payload);
}
