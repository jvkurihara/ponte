import { mailer } from './mail.js';
try { await mailer.verify(); console.log('Conexão e autenticação SMTP confirmadas. Nenhum e-mail foi enviado.'); }
catch { console.error('Falha na conexão SMTP. Confira host, porta, TLS e credenciais no .env.'); process.exitCode = 1; }
finally { mailer.close(); }
