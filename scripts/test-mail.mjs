// Local test inbox only; never sends real email. Do not expose these ports publicly.
import { SMTPServer } from 'smtp-server';
import { createServer } from 'node:http';
const messages = [];
const smtp = new SMTPServer({
  authOptional: true, disabledCommands: ['AUTH', 'STARTTLS'],
  onData(stream, session, callback) {
    let raw = '';
    stream.on('data', chunk => { raw += chunk.toString(); });
    stream.on('end', () => { messages.push({ to: session.envelope.rcptTo.map(r => r.address), raw: raw.replace(/=\r?\n/g, '').replace(/=3D/g, '=') }); callback(); });
  },
});
smtp.listen(2525, '127.0.0.1', () => console.log('SMTP de teste: 127.0.0.1:2525'));
const api = createServer((_req, res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(messages)); });
api.listen(8026, '127.0.0.1');
const close = () => { smtp.close(); api.close(); };
process.on('SIGTERM', close); process.on('SIGINT', close);
