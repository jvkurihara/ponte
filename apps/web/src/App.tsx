import { useCallback, useEffect, useState } from 'react';
import type { User } from '@ponte/shared';
import { api } from './lib/api';
import { Auth, Unverified, Verification } from './components/Auth';
import { TransferPanel } from './components/TransferPanel';
import { History } from './components/History';
import { Icon } from './components/Icon';
export default function App() {
  const [user, setUser] = useState<User | null>(null), [loading, setLoading] = useState(true), [revision, setRevision] = useState(0), [error, setError] = useState('');
  const refresh = useCallback(() => { api<{ user: User }>('/auth/me').then(r => setUser(r.user)).catch(() => setUser(null)).finally(() => setLoading(false)); }, []);
  useEffect(refresh, [refresh]);
  const historyChanged = useCallback(() => setRevision(v => v + 1), []);
  async function logout() { try { await api('/auth/logout', {}); setUser(null); } catch (e) { setError(e instanceof Error ? e.message : 'Falha ao sair.'); } }
  return <><header className="header"><div className="header-inner"><a className="brand" href="/" aria-label="Ponte, início"><Icon name="arrows" size={29}/>Ponte</a>{user?.verified && <nav aria-label="Principal"><a className="selected" href="#transferir">Transferir</a><a href="#historico">Histórico</a></nav>}<div className="account">{user ? <><span className="avatar">{user.email.slice(0, 2).toUpperCase()}</span><span className="account-email">{user.email}</span><button className="link" onClick={logout}>Sair</button></> : <span className="header-note">Entre seus dispositivos.</span>}</div></div></header>{error && <p className="error" role="alert">{error}</p>}
  {location.pathname === '/verify' ? <Verification/> : loading ? <main className="single-panel"><p role="status">Carregando…</p></main> : !user ? <Auth onLogin={setUser}/> : !user.verified ? <Unverified user={user} refresh={refresh}/> : <main className="main" id="transferir"><TransferPanel onHistory={historyChanged}/><History revision={revision}/></main>}</>;
}
