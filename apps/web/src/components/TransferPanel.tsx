import { useEffect, useRef, useState } from 'react';
import { usePeer } from '../lib/usePeer';
import { canReceive } from '../lib/disk';
import { formatBytes } from '../lib/api';
import { Icon } from './Icon';
const phases = { waiting: 'Aguardando aceite', sending: 'Enviando', receiving: 'Recebendo', saving: 'Finalizando gravação', completed: 'Concluído', cancelled: 'Cancelado', failed: 'Interrompido' };
export function TransferPanel({ onHistory }: { onHistory: () => void }) {
  const peer = usePeer(onHistory), [code, setCode] = useState(''), [file, setFile] = useState<File | null>(null), [busy, setBusy] = useState(false), [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const active = peer.progress && ['waiting', 'sending', 'receiving', 'saving'].includes(peer.progress.phase);
  const supported = canReceive();
  useEffect(() => {
    if (!active) return;
    const prevent = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', prevent);
    return () => window.removeEventListener('beforeunload', prevent);
  }, [Boolean(active)]);
  const percentage = peer.progress ? peer.progress.phase === 'completed' ? 100 : peer.progress.size ? Math.min(99, Math.floor(peer.progress.bytes / peer.progress.size * 100)) : 0 : 0;
  return <>
    <div className="intro"><h1>Seus arquivos. Do outro lado.</h1><p>Conecte dois dispositivos e transfira direto entre eles.</p></div>
    {!window.isSecureContext && <p className="error" role="alert">Abra este endereço com HTTPS para habilitar a transferência segura. No computador local, localhost também funciona.</p>}
    {peer.error && <p className="error" role="alert">{peer.error}</p>}{peer.notice && <p className="success" role="status">{peer.notice}</p>}
    <div className="workspace"><section className="send-panel">
      <div className="step"><span className="step-number">01</span><div className="step-body"><h2>Conectar</h2><p>Digite o código do dispositivo com o qual você quer se conectar.</p><form className="connect-form" onSubmit={async e => { e.preventDefault(); setBusy(true); await peer.join(code); setBusy(false); }}><input aria-label="Código do dispositivo" value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="Código do dispositivo" autoComplete="off" maxLength={14} required disabled={Boolean(active)}/><button className="primary" disabled={!peer.online || busy || Boolean(active) || code.replace(/[-\s]/g, '').length !== 12}>Conectar</button></form><div className="connection-state" role="status"><span className={peer.connected ? 'dot connected' : 'dot'}/>{peer.status}{peer.connected && !active && <button className="link" onClick={peer.leave}>Desconectar</button>}</div></div></div>
      <div className="divider"/>
      <div className="step"><span className="step-number">02</span><div className="step-body"><h2>Selecionar</h2><p>Escolha o arquivo que deseja transferir.</p>
        <div className={`drop-zone ${dragging ? 'dragging' : ''}`} onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={e => { e.preventDefault(); setDragging(false); if (!active) setFile(e.dataTransfer.files[0] || null); }}>
          <Icon name={file ? 'file' : 'upload'} size={42}/><h3>{file ? file.name : 'Arraste um arquivo para cá'}</h3><p>{file ? formatBytes(file.size) : 'ou selecione no seu dispositivo'}</p><input ref={input} type="file" className="visually-hidden" tabIndex={-1} aria-label="Arquivo para enviar" onChange={e => setFile(e.target.files?.[0] || null)}/><button className="outline" disabled={Boolean(active)} onClick={() => input.current?.click()}>{file ? 'Trocar arquivo' : 'Selecionar arquivo'}</button>
          {file && <button className="primary" disabled={!peer.connected || peer.role !== 'sender' || busy || Boolean(active)} onClick={async () => { setBusy(true); await peer.send(file); setBusy(false); }}>Enviar arquivo</button>}
        </div>{file && peer.role !== 'sender' && <p className="hint">Para enviar, digite o código gerado no dispositivo de destino.</p>}
      </div></div>
    </section>
    <aside className="receive-panel"><h2>Receber neste dispositivo</h2><p>Compartilhe este código com o outro dispositivo<br className="desktop-break"/> para que ele possa se conectar a você.</p><div className="devices-icon"><Icon name="devices" size={154}/></div><div className="pair-code" aria-label="Código para pareamento">{peer.pairing ? peer.pairing.code.match(/.{1,4}/g)?.join('-') : '••••-••••-••••'}</div><button className="outline" onClick={peer.create} disabled={!supported || !peer.online || Boolean(active)}>Gerar código</button><p className="expiry">O código expira em 10 minutos.</p>{!supported && <p className="compatibility">Este navegador pode enviar arquivos. Para receber arquivos grandes diretamente no disco, use Chrome ou Edge no computador.</p>}</aside>
    </div>
    {peer.request && <section className="approval" role="region" aria-label="Aprovar dispositivo"><div><h3>Permitir conexão?</h3><p><strong>{peer.request.email}</strong> quer se conectar a este dispositivo.</p></div><button className="primary" onClick={() => peer.respond(true)}>Permitir conexão</button><button className="outline" onClick={() => peer.respond(false)}>Recusar</button></section>}
    {peer.offer && <section className="approval" role="region" aria-label="Aceitar arquivo"><div><h3>Receber {peer.offer.file.name}?</h3><p>{formatBytes(peer.offer.file.size)} · Escolha onde salvar no seu computador.</p></div><button className="primary" onClick={peer.accept}>Escolher destino e receber</button><button className="outline" onClick={peer.cancel}>Recusar arquivo</button></section>}
    {peer.progress && <section className="progress-row" aria-label="Transferência atual"><div className="progress-file"><span className="file-icon"><Icon name="file"/></span><div><strong>{peer.progress.name}</strong><span role="status">{phases[peer.progress.phase]}</span></div></div><progress value={percentage} max={100} aria-label="Progresso da transferência"/><div className="progress-detail">{formatBytes(peer.progress.bytes)} de {formatBytes(peer.progress.size)} · {percentage}%{active && peer.progress.speed > 0 && <small>{formatBytes(peer.progress.speed)}/s</small>}</div>{active && peer.progress.phase !== 'saving' && <button className="icon-button" aria-label="Cancelar transferência" onClick={peer.cancel}><Icon name="close"/></button>}</section>}
    <div className="transfer-footnote"><span><Icon name="info" size={16}/>Mantenha os dois dispositivos abertos durante a transferência.</span><span><Icon name="lock" size={16}/>Criptografia entre dispositivos.</span></div>
  </>;
}
