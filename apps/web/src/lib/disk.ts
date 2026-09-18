export interface DiskSink { write(bytes: Uint8Array<ArrayBuffer>): Promise<void>; close(): Promise<void>; abort(): Promise<void> }
type SaveHandle = { createWritable(): Promise<DiskSink> };
declare global { interface Window { showSaveFilePicker?: (options: { suggestedName: string }) => Promise<SaveHandle> } }
export const canReceive = () => window.isSecureContext && typeof window.showSaveFilePicker === 'function';
// Call directly from a user click, before any network await, to keep user activation.
export async function chooseDisk(name: string): Promise<DiskSink> {
  if (!canReceive()) throw new Error('Para receber arquivos grandes, abra o Ponte no Chrome ou Edge do computador usando HTTPS. Este dispositivo pode enviar arquivos.');
  const handle = await window.showSaveFilePicker!({ suggestedName: name });
  return handle.createWritable();
}
