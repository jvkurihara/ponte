import { useState, type FormEvent } from 'react';
import type { User } from '@ponte/shared';
import { api } from '../lib/api';
import { Icon } from './Icon';

export function Auth({ onLogin }: { onLogin: (user: User) => void }) {
  const [mode, setMode] = useState<'login' | 'register' | 'resend'>('login');
  const [email, setEmail] = useState(''), [password, setPassword] = useState('');
  const [error, setError] = useState(''), [message, setMessage] = useState(''), [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError(''); setMessage('');
    try {
      if (mode === 'login') onLogin((await api<{ user: User }>('/auth/login', { email, password })).user);
      else { const result = await api<{ message: string }>(`/auth/${mode}`, { email, ...(mode === 'register' ? { password } : {}) }); setMessage(result.message); setPassword(''); }
    } catch (e) { setError(e instanceof Error ? e.message : 'Falha na autenticação.'); }
    finally { setBusy(false); }
  }
  return <main className="auth-layout">
    <section className="auth-intro"><h1>Seus arquivos.<br/>Do outro lado.</h1><p>Conecte dois dispositivos e transfira direto entre eles.</p><div className="auth-devices"><Icon name="devices" size={160}/></div><p className="muted">Do celular para o computador.<br/>Sem limite de tamanho imposto pelo serviço.</p></section>
    <section className="auth-form"><h2>{mode === 'login' ? 'Bem-vindo ao Ponte' : mode === 'register' ? 'Crie sua conta' : 'Confirme seu e-mail'}</h2><p>{mode === 'login' ? 'Entre para conectar seus dispositivos.' : mode === 'register' ? 'Você receberá um link para ativar sua conta.' : 'Enviaremos um novo link de verificação.'}</p>
      <form onSubmit={submit}><label>E-mail<input type="email" name="email" value={email} onChange={e => setEmail(e.target.value)} required maxLength={254} autoComplete="email" placeholder="voce@exemplo.com"/></label>
      {mode !== 'resend' && <label>Senha<input type="password" name="password" value={password} onChange={e => setPassword(e.target.value)} required minLength={10} maxLength={128} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} placeholder="Pelo menos 10 caracteres"/></label>}
      {error && <p role="alert" className="error">{error}</p>}{message && <p role="status" className="success">{message}</p>}
      <button disabled={busy} className="primary full">{busy ? 'Aguarde…' : mode === 'login' ? 'Entrar' : mode === 'register' ? 'Criar conta' : 'Reenviar verificação'}</button></form>
      <div className="auth-links">{mode !== 'login' && <button className="link" onClick={() => { setMode('login'); setError(''); setMessage(''); }}>Já tenho conta</button>}{mode !== 'register' && <button className="link" onClick={() => { setMode('register'); setError(''); setMessage(''); }}>Criar conta</button>}{mode !== 'resend' && <button className="link" onClick={() => { setMode('resend'); setError(''); setMessage(''); }}>Reenviar verificação</button>}</div>
      <p className="privacy"><Icon name="lock" size={16}/> Os arquivos ficam entre seus dispositivos.</p>
    </section>
  </main>;
}
export function Verification() {
  const [token] = useState(() => { const value = new URLSearchParams(location.hash.slice(1)).get('token'); history.replaceState(null, '', '/verify'); return value; });
  const [message, setMessage] = useState('Confirme seu e-mail para liberar as transferências.');
  const [busy, setBusy] = useState(false), [done, setDone] = useState(false);
  async function verify() { setBusy(true); try { setMessage((await api<{ message: string }>('/auth/verify', { token })).message); setDone(true); } catch (e) { setMessage(e instanceof Error ? e.message : 'Falha na verificação.'); } finally { setBusy(false); } }
  return <main className="single-panel"><Icon name="lock" size={40}/><h1>Verifique seu e-mail</h1><p role="status">{message}</p>{!done && token && <button className="primary" disabled={busy} onClick={verify}>{busy ? 'Confirmando…' : 'Confirmar e-mail'}</button>}<a className="button outline" href="/">{done ? 'Entrar na minha conta' : 'Voltar para o login'}</a></main>;
}
export function Unverified({ user, refresh }: { user: User; refresh: () => void }) {
  const [message, setMessage] = useState('');
  return <main className="single-panel"><Icon name="lock" size={40}/><h1>Falta só confirmar seu e-mail.</h1><p>Abra o link enviado para <strong>{user.email}</strong>.</p><p>Depois de confirmar, volte aqui para conectar seus dispositivos.</p><button className="primary" onClick={refresh}>Já confirmei meu e-mail</button><button className="outline" onClick={async () => { try { setMessage((await api<{ message: string }>('/auth/resend', { email: user.email })).message); } catch (e) { setMessage(e instanceof Error ? e.message : 'Falha ao reenviar.'); } }}>Reenviar verificação</button><p role="status">{message}</p></main>;
}
