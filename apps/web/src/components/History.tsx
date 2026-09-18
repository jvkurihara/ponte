import { useEffect, useState } from 'react';
import type { TransferRecord } from '@ponte/shared';
import { api, formatBytes } from '../lib/api';
import { Icon } from './Icon';
const labels = { PENDING: 'Aguardando', IN_PROGRESS: 'Em andamento', COMPLETED: 'Concluído', CANCELLED: 'Cancelado', FAILED: 'Interrompido' };
export function History({ revision }: { revision: number }) {
  const [rows, setRows] = useState<TransferRecord[]>([]), [offset, setOffset] = useState(0), [next, setNext] = useState<number | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(true);
  useEffect(() => {
    let current = true; setLoading(true);
    api<{ transfers: TransferRecord[]; nextOffset: number | null }>(`/transfers?offset=${offset}`).then(result => { if (current) { setRows(result.transfers); setNext(result.nextOffset); setError(''); } }).catch(e => { if (current) setError(e.message); }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [revision, offset]);
  return <section id="historico" className="history"><h2>Transferências recentes</h2>{error && <p className="error" role="alert">{error}</p>}<div className="table-wrap"><table><thead><tr><th>Arquivo</th><th>Tamanho</th><th>Data</th><th>Status</th></tr></thead><tbody>
    {rows.map(row => <tr key={row.id}><td><span className="file-name"><Icon name="file" size={18}/>{row.fileName}</span></td><td>{formatBytes(Number(row.fileSize))}</td><td>{new Date(row.createdAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</td><td><span className={`status-${row.status.toLowerCase()}`}>{labels[row.status]}</span></td></tr>)}
    {rows.length === 0 && <tr><td colSpan={4} className="empty"><Icon name="file" size={30}/><p>{loading ? 'Carregando histórico…' : 'Seu histórico aparece aqui.'}</p></td></tr>}
  </tbody></table></div>{(offset > 0 || next !== null) && <div className="pagination"><button className="outline" disabled={offset === 0 || loading} onClick={() => setOffset(Math.max(0, offset - 20))}>Anterior</button><button className="outline" disabled={next === null || loading} onClick={() => next !== null && setOffset(next)}>Próxima</button></div>}</section>;
}
