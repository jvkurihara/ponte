import { CHUNK_SIZE, FRAME_HEADER, WINDOW_BYTES, controlMessage, fileMeta, type ControlMessage, type FileMeta } from '@ponte/shared';
import { decodeFrame, encodeFrame } from './frames';
import type { DiskSink } from './disk';

export type Progress = { name: string; size: number; bytes: number; phase: 'waiting' | 'sending' | 'receiving' | 'saving' | 'completed' | 'cancelled' | 'failed'; speed: number };
export type Rpc = <T = Record<string, never>>(event: string, data: unknown) => Promise<T>;
type Hooks = {
  rpc: Rpc; roomId: string; maxMessageSize: number | (() => number);
  metadata: (id: string) => Promise<{ fileName: string; fileSize: string; mimeType: string }>;
  onOffer: (offer: { id: string; file: FileMeta } | null) => void;
  onProgress: (progress: Progress) => void;
  onDone: (historySaved: boolean) => void;
  onError: (message: string) => void;
};
type Transfer = { id: string; file: FileMeta; direction: 'send' | 'receive'; bytes: number; sent: number; accepted: boolean; completed: boolean; started: number; sink?: DiskSink; finishing?: boolean; historyAt: number; renderedAt: number };

export class FileTransfer {
  private current?: Transfer;
  private queue = Promise.resolve();
  private queuedBytes = 0;
  private waiters = new Set<() => void>();
  private stopped = false;
  private preparing = false;
  private lowBuffer = 64 * 1024;
  constructor(private channel: RTCDataChannel, private hooks: Hooks) {
    channel.binaryType = 'arraybuffer'; channel.bufferedAmountLowThreshold = this.lowBuffer;
    channel.addEventListener('bufferedamountlow', this.pulse);
    channel.addEventListener('close', () => this.abortLocally('Conexão encerrada. Gere um novo código.'));
    channel.addEventListener('error', () => this.abortLocally('Falha no canal de transferência.'));
    channel.addEventListener('message', event => {
      if (this.stopped) return;
      const data: unknown = event.data;
      const size = typeof data === 'string' ? data.length : data instanceof ArrayBuffer ? data.byteLength : Infinity;
      this.queuedBytes += size;
      if (this.queuedBytes > WINDOW_BYTES + 4 * (CHUNK_SIZE + FRAME_HEADER)) { this.abortLocally('O outro dispositivo excedeu a janela de recepção.'); return; }
      this.queue = this.queue.then(async () => {
        if (this.stopped) return;
        if (typeof data === 'string') {
          if (data.length > 4096) throw new Error('Mensagem de controle inválida.');
          await this.control(controlMessage.parse(JSON.parse(data)));
        } else if (data instanceof ArrayBuffer) await this.binary(data);
        else throw new Error('Formato de bloco inválido.');
      }).catch(error => this.abortLocally(error instanceof Error ? error.message : 'Falha na transferência.'))
        .finally(() => { this.queuedBytes -= size; });
    });
  }
  private pulse = () => { for (const waiter of this.waiters) waiter(); };
  private async until(predicate: () => boolean, timeout = 120_000) {
    if (this.stopped) throw new Error('Transferência encerrada.');
    if (predicate()) return;
    await new Promise<void>((resolve, reject) => {
      const clean = () => { clearTimeout(timer); this.waiters.delete(check); };
      const check = () => {
        if (this.stopped || this.channel.readyState !== 'open') { clean(); reject(new Error('Conexão encerrada.')); }
        else if (predicate()) { clean(); resolve(); }
      };
      const timer = setTimeout(() => { clean(); reject(new Error('O outro dispositivo parou de responder.')); }, timeout);
      this.waiters.add(check); check();
    });
  }
  private sendControl(message: ControlMessage) {
    if (this.channel.readyState !== 'open') throw new Error('Conexão indisponível.');
    this.channel.send(JSON.stringify(message));
  }
  private render(phase: Progress['phase'], force = false) {
    const t = this.current; if (!t) return;
    if (!force && performance.now() - t.renderedAt < 100) return;
    t.renderedAt = performance.now();
    this.hooks.onProgress({ name: t.file.name, size: t.file.size, bytes: t.bytes, phase, speed: t.bytes / Math.max(0.001, (performance.now() - t.started) / 1000) });
  }
  async send(file: File) {
    if (this.current || this.preparing || this.stopped) throw new Error('Já existe uma transferência ou a conexão foi encerrada.');
    const meta = fileMeta.parse({ name: file.name, size: file.size, mime: file.type });
    this.preparing = true;
    let id: string;
    try { ({ id } = await this.hooks.rpc<{ id: string }>('transfer:create', { roomId: this.hooks.roomId, file: meta })); }
    finally { this.preparing = false; }
    if (this.stopped) { void this.hooks.rpc('transfer:cancel', { id, failed: true }).catch(() => {}); return; }
    const t: Transfer = { id, file: meta, direction: 'send', bytes: 0, sent: 0, accepted: false, completed: false, started: performance.now(), historyAt: 0, renderedAt: 0 };
    this.current = t; this.render('waiting', true);
    try {
      this.sendControl({ type: 'offer', id, file: meta });
      await this.until(() => t.accepted, 600_000);
      t.started = performance.now(); this.render('sending', true);
      const configured = this.hooks.maxMessageSize;
      const negotiated = (typeof configured === 'function' ? configured() : configured) || 65536;
      const chunkSize = Math.min(CHUNK_SIZE, negotiated - FRAME_HEADER);
      if (chunkSize < 1) throw new Error('O navegador não suporta os blocos de transferência.');
      while (t.sent < file.size) {
        const length = Math.min(chunkSize, file.size - t.sent);
        await this.until(() => t.sent - t.bytes + length <= WINDOW_BYTES && this.channel.bufferedAmount <= 256 * 1024);
        const offset = t.sent;
        const payload = await file.slice(offset, offset + length).arrayBuffer();
        const frame = await encodeFrame(offset, payload);
        if (this.stopped) throw new Error('Transferência encerrada.');
        this.channel.send(frame); t.sent += length;
      }
      await this.until(() => t.bytes === file.size);
      this.render('saving', true); this.sendControl({ type: 'end', id });
      await this.until(() => t.completed);
      this.render('completed', true); this.current = undefined;
    } catch (error) {
      if (!this.stopped) this.abortLocally(error instanceof Error ? error.message : 'Falha no envio.');
    }
  }
  async accept(sink: DiskSink) {
    const t = this.current;
    if (!t || t.direction !== 'receive' || t.accepted || this.stopped) { await sink.abort(); throw new Error('Solicitação expirada.'); }
    t.sink = sink;
    try {
      await this.hooks.rpc('transfer:start', { id: t.id });
      if (this.stopped) { await sink.abort(); return; }
      t.accepted = true; t.started = performance.now(); this.hooks.onOffer(null);
      this.sendControl({ type: 'accept', id: t.id }); this.render('receiving', true);
    } catch (error) { this.abortLocally(error instanceof Error ? error.message : 'Falha ao abrir o arquivo.'); }
  }
  async cancel() {
    const t = this.current;
    if (t?.finishing) return; // close() is already committing the local file.
    if (t && !t.completed) {
      try { this.sendControl({ type: 'cancel', id: t.id }); } catch { /* disconnected */ }
      await this.hooks.rpc('transfer:cancel', { id: t.id }).catch(() => {});
      this.render('cancelled', true);
    }
    this.dispose();
  }
  private async control(message: ControlMessage) {
    if (message.type === 'offer') {
      if (this.current) throw new Error('Foi recebida uma segunda transferência simultânea.');
      const stored = await this.hooks.metadata(message.id);
      if (stored.fileName !== message.file.name || stored.fileSize !== String(message.file.size) || stored.mimeType !== message.file.mime) throw new Error('Os metadados do arquivo não conferem.');
      this.current = { id: message.id, file: message.file, direction: 'receive', bytes: 0, sent: 0, accepted: false, completed: false, started: performance.now(), historyAt: 0, renderedAt: 0 };
      this.hooks.onOffer(message); this.render('waiting', true); return;
    }
    const t = this.current;
    if (!t || message.id !== t.id) throw new Error('Mensagem de outra transferência.');
    switch (message.type) {
      case 'accept':
        if (t.direction !== 'send' || t.accepted) throw new Error('Aceite inesperado.');
        t.accepted = true; this.pulse(); break;
      case 'ack':
        if (t.direction !== 'send' || !t.accepted || message.bytes < t.bytes || message.bytes > t.sent) throw new Error('Confirmação de bytes inválida.');
        t.bytes = message.bytes; this.render('sending'); this.pulse(); break;
      case 'end': {
        if (t.direction !== 'receive' || !t.accepted || !t.sink || t.bytes !== t.file.size) throw new Error('Arquivo incompleto.');
        t.finishing = true; this.render('saving', true);
        try { await t.sink.close(); } // Only a successful close commits the destination.
        catch (error) { t.finishing = false; throw error; }
        t.completed = true;
        let historySaved = true;
        try { await this.hooks.rpc('transfer:complete', { id: t.id, bytes: t.bytes }); } catch { historySaved = false; }
        this.render('completed', true); this.hooks.onDone(historySaved);
        this.sendControl({ type: 'complete', id: t.id, historySaved });
        this.current = undefined; break;
      }
      case 'complete':
        if (t.direction !== 'send' || t.bytes !== t.file.size) throw new Error('Conclusão inválida.');
        t.completed = true; this.hooks.onDone(message.historySaved); this.pulse(); break;
      case 'cancel':
        this.render('cancelled', true); this.dispose(); this.hooks.onError('O outro dispositivo cancelou a transferência.'); break;
    }
  }
  private async binary(frame: ArrayBuffer) {
    const t = this.current;
    if (!t || t.direction !== 'receive' || !t.accepted || !t.sink || t.finishing) throw new Error('Bloco recebido sem autorização.');
    const payload = await decodeFrame(frame, t.bytes, t.file.size);
    if (this.stopped) return;
    await t.sink.write(payload);
    if (this.stopped) return;
    t.bytes += payload.byteLength;
    this.sendControl({ type: 'ack', id: t.id, bytes: t.bytes });
    this.render('receiving');
    if (performance.now() - t.historyAt > 2000) {
      t.historyAt = performance.now();
      void this.hooks.rpc('transfer:progress', { id: t.id, bytes: t.bytes }).catch(() => {});
    }
  }
  private abortLocally(message: string) {
    if (this.stopped) return;
    if (this.current && !this.current.completed) {
      this.render('failed', true);
      void this.hooks.rpc('transfer:cancel', { id: this.current.id, failed: true }).catch(() => {});
    }
    this.dispose(); this.hooks.onError(message);
  }
  dispose() {
    if (this.stopped) return;
    this.stopped = true;
    const t = this.current;
    if (t?.sink && !t.completed && !t.finishing) void t.sink.abort().catch(() => {});
    this.hooks.onOffer(null); this.pulse(); this.channel.close();
    this.channel.removeEventListener('bufferedamountlow', this.pulse);
  }
}
