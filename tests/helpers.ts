export const origin = process.env.TEST_ORIGIN || 'http://localhost:5173';
export const endpoint = process.env.TEST_API || 'http://127.0.0.1:3001';
export async function request(path: string, data?: unknown, cookie?: string) {
  return fetch(endpoint + '/api' + path, { method: data === undefined ? 'GET' : 'POST', headers: { Origin: origin, ...(data === undefined ? {} : { 'Content-Type': 'application/json' }), ...(cookie ? { Cookie: cookie } : {}) }, body: data === undefined ? undefined : JSON.stringify(data) });
}
export async function inboxToken(email: string) {
  const inbox = await (await fetch('http://127.0.0.1:8026')).json() as { to: string[]; raw: string }[];
  const message = inbox.filter(m => m.to.includes(email)).at(-1);
  const token = message?.raw.match(/token=([a-f0-9]{64})/)?.[1];
  if (!token) throw new Error('Nenhum token encontrado no SMTP local de teste.');
  return token;
}
export async function createAccount(suffix: string, verify = true) {
  const email = `ponte-${suffix}-${Date.now()}@example.test`, password = 'test-only-strong-password-2026';
  const registered = await request('/auth/register', { email, password });
  if (registered.status !== 202) throw new Error(`Cadastro falhou: ${registered.status} ${await registered.text()}`);
  const token = await inboxToken(email);
  if (verify) {
    const response = await request('/auth/verify', { token });
    if (!response.ok) throw new Error(`Verificação falhou: ${await response.text()}`);
  }
  const logged = await request('/auth/login', { email, password });
  if (!logged.ok) throw new Error(`Login falhou: ${await logged.text()}`);
  const cookie = logged.headers.get('set-cookie')!.split(';')[0]!;
  const { user } = await logged.json();
  return { email, password, cookie, user, token };
}
