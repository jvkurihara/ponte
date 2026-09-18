import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { FileMeta, Reply } from '@ponte/shared';
import { api } from './api';
import { FileTransfer, type Progress, type Rpc } from './transfer';
import { chooseDisk } from './disk';

type Pairing = { roomId: string; code: string; expiresAt: number };
type Request = { roomId: string; email: string };
type Signal = { roomId: string; payload: { description?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit } };
export function usePeer(onHistory: () => void) {
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [request, setRequest] = useState<Request | null>(null);
  const [offer, setOffer] = useState<{ id: string; file: FileMeta } | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [status, setStatus] = useState('Conectando ao serviço…');
  const [connected, setConnected] = useState(false);
  const [online, setOnline] = useState(false);
  const [role, setRole] = useState<'sender' | 'receiver' | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const socketRef = useRef<Socket | null>(null), engine = useRef<FileTransfer | null>(null);
  const onHistoryRef = useRef(onHistory); onHistoryRef.current = onHistory;
  const rpc: Rpc = async <T,>(event: string, data: unknown) => {
    const socket = socketRef.current;
    if (!socket?.connected) throw new Error('O serviço está desconectado. Atualize a página.');
    const reply = await socket.timeout(15000).emitWithAck(event, data) as Reply<T>;
    if (!reply.ok) throw new Error(reply.error);
    return reply.data;
  };
  useEffect(() => {
    const socket = io({ transports: ['websocket'], autoConnect: false, reconnection: false });
    socketRef.current = socket;
    let pc: RTCPeerConnection | null = null, roomId = '', disposed = false;
    let setup = Promise.resolve(), signalingQueue = Promise.resolve();
    let candidates: RTCIceCandidateInit[] = [], disconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let connectTimer: ReturnType<typeof setTimeout> | undefined;
    const closePeer = () => {
      clearTimeout(disconnectTimer); clearTimeout(connectTimer);
      engine.current?.dispose(); engine.current = null;
      if (pc) { pc.onconnectionstatechange = null; pc.close(); pc = null; }
      roomId = ''; candidates = []; setConnected(false); setRole(null); setOffer(null);
    };
    const problem = (e: unknown) => { if (!disposed) { setError(e instanceof Error ? e.message : 'Falha de conexão.'); closePeer(); } };
    const bindChannel = (channel: RTCDataChannel, connection: RTCPeerConnection, id: string) => {
      if (channel.label !== 'ponte-v1' || engine.current || !channel.ordered || channel.maxRetransmits !== null || channel.maxPacketLifeTime !== null) { channel.close(); return; }
      engine.current = new FileTransfer(channel, {
        roomId: id, rpc, maxMessageSize: () => connection.sctp?.maxMessageSize || 65536,
        metadata: async transferId => (await api<{ transfer: { fileName: string; fileSize: string; mimeType: string } }>(`/transfers/${transferId}`)).transfer,
        onOffer: setOffer, onProgress: setProgress,
        onDone: historySaved => {
          setNotice(historySaved ? 'Arquivo salvo no dispositivo de destino.' : 'Arquivo salvo. Não foi possível registrar a conclusão no histórico; gere um novo pareamento.');
          onHistoryRef.current();
        }, onError: message => { setError(message); onHistoryRef.current(); },
      });
      channel.onopen = () => { clearTimeout(connectTimer); setConnected(true); setStatus('Dispositivos conectados'); };
      channel.onclose = () => { setConnected(false); setStatus('Conexão encerrada. Gere um novo código.'); };
    };
    socket.on('connect', () => { setOnline(true); setStatus('Pronto para conectar'); });
    socket.on('connect_error', problem);
    socket.on('disconnect', () => { setOnline(false); closePeer(); setPairing(null); setRequest(null); setStatus('Serviço desconectado. Atualize a página.'); onHistoryRef.current(); });
    socket.on('room:request', (value: Request) => { setRequest(value); });
    socket.on('room:closed', ({ reason }: { reason: string }) => {
      closePeer(); setPairing(null); setRequest(null); setStatus(reason); onHistoryRef.current();
      setProgress(previous => previous && ['waiting', 'sending', 'receiving', 'saving'].includes(previous.phase) ? { ...previous, phase: 'failed' } : previous);
    });
    socket.on('room:ready', (data: { roomId: string; role: 'sender' | 'receiver'; email: string }) => {
      closePeer(); roomId = data.roomId; setRole(data.role); setRequest(null); setPairing(null);
      setStatus(`Conectando a ${data.email}…`);
      setup = (async () => {
        const { iceServers } = await api<{ iceServers: RTCIceServer[] }>('/ice');
        if (disposed || roomId !== data.roomId) return;
        const connection = new RTCPeerConnection({ iceServers }); pc = connection;
        connectTimer = setTimeout(() => problem(new Error('Não foi possível conectar. Use a mesma rede ou configure TURN.')), 45000);
        connection.onicecandidate = event => {
          if (event.candidate && roomId === data.roomId) void rpc('signal', { roomId, payload: { candidate: event.candidate.toJSON() } }).catch(problem);
        };
        connection.onconnectionstatechange = () => {
          if (connection.connectionState === 'failed') problem(new Error('A conexão P2P falhou. Gere um novo código.'));
          else if (connection.connectionState === 'disconnected') disconnectTimer = setTimeout(() => problem(new Error('A rede foi desconectada.')), 15000);
          else if (connection.connectionState === 'connected') clearTimeout(disconnectTimer);
        };
        if (data.role === 'sender') {
          bindChannel(connection.createDataChannel('ponte-v1', { ordered: true }), connection, roomId);
          await connection.setLocalDescription(await connection.createOffer());
          await rpc('signal', { roomId, payload: { description: connection.localDescription!.toJSON() } });
        } else connection.ondatachannel = event => bindChannel(event.channel, connection, data.roomId);
      })().catch(problem);
    });
    socket.on('signal', (data: Signal) => {
      signalingQueue = signalingQueue.then(async () => {
        await setup;
        if (!pc || data.roomId !== roomId) return;
        if (data.payload.description) {
          await pc.setRemoteDescription(data.payload.description);
          for (const candidate of candidates) await pc.addIceCandidate(candidate);
          candidates = [];
          if (data.payload.description.type === 'offer') {
            await pc.setLocalDescription(await pc.createAnswer());
            await rpc('signal', { roomId, payload: { description: pc.localDescription!.toJSON() } });
          }
        } else if (data.payload.candidate) {
          if (pc.remoteDescription) await pc.addIceCandidate(data.payload.candidate);
          else { if (candidates.length >= 64) throw new Error('Muitos candidatos ICE.'); candidates.push(data.payload.candidate); }
        }
      }).catch(problem);
    });
    socket.connect();
    return () => { disposed = true; closePeer(); socket.removeAllListeners(); socket.disconnect(); socketRef.current = null; };
  }, []);
  async function run(action: () => Promise<unknown>) { setError(''); try { await action(); } catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível concluir.'); } }
  return {
    pairing, request, offer, progress, status, connected, online, role, error, notice,
    create: () => run(async () => { setProgress(null); setNotice(''); setPairing(await rpc<Pairing>('room:create', {})); setStatus('Aguardando o outro dispositivo'); }),
    join: (code: string) => run(async () => { await rpc('room:join', { code: code.replace(/[-\s]/g, '').toUpperCase() }); setStatus('Aguardando aprovação no outro dispositivo'); }),
    respond: (accept: boolean) => run(() => rpc('room:respond', { roomId: request?.roomId, accept })),
    send: (file: File) => run(async () => { setNotice(''); if (!engine.current) throw new Error('Conecte os dispositivos primeiro.'); await engine.current.send(file); }),
    accept: () => run(async () => { if (!offer || !engine.current) return; const sink = await chooseDisk(offer.file.name); await engine.current.accept(sink); }),
    cancel: () => run(async () => { await engine.current?.cancel(); await rpc('room:leave', {}); onHistoryRef.current(); }),
    leave: () => run(() => rpc('room:leave', {})),
  };
}
