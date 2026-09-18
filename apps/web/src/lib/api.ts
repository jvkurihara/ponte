export async function api<T>(path: string, data?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method: data === undefined ? 'GET' : 'POST', credentials: 'same-origin',
    headers: data === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'Não foi possível concluir.');
  return body as T;
}
export function formatBytes(bytes: number) {
  if (bytes === 0) return '0 B';
  const unit = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), 5);
  return `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: unit ? 1 : 0 }).format(bytes / 1024 ** unit)} ${['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'][unit]}`;
}
