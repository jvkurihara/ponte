# Ponte

Sistema de transferência de arquivos entre dispositivos, com React, TypeScript, Node.js, Socket.io, WebRTC, PostgreSQL/Prisma e Nodemailer.

**Sem limite de tamanho imposto pela aplicação.** O arquivo é lido por partes e gravado em um `FileSystemWritableFileStream` no destino. Não existe upload de conteúdo para a API nem uma lista de chunks acumulada em um Blob. Armazenamento livre, navegador, sistema de arquivos e rede continuam sendo limites reais.

O fluxo principal é **celular → Chrome/Edge no computador**. Dispositivos que não oferecem `showSaveFilePicker` podem enviar, mas não recebem arquivos neste MVP. Essa restrição evita prometer recebimento ilimitado no Safari/iOS usando memória RAM. A interface explica a compatibilidade por detecção de recursos.

## O que está implementado

- Cadastro e login com scrypt, salt por usuário e sessão opaca revogável em cookie HttpOnly. Nenhuma credencial em localStorage.
- E-mail de ativação com Nodemailer, token aleatório de uso único, hash no banco e validade de 24 horas. Reenvio e tratamento de indisponibilidade SMTP.
- Pareamento com código aleatório de 12 caracteres, validade de 10 minutos, dois participantes fixos e aprovação explícita do receptor.
- Signaling autenticado via Socket.io: offer, answer e ICE. Cookies, origem, participação na sala e estado da transferência são validados no servidor.
- DataChannel confiável e ordenado, chunks de até 16 KiB, offset de 64 bits e SHA-256 por bloco.
- Janela de 1 MiB de payload não confirmado, controle de `bufferedAmount`, gravação sequencial, ACK após escrita e confirmação final após `close()`.
- Barra de progresso, taxa média, aceite de arquivo, cancelamento, falha de conexão e histórico paginado.
- STUN opcional e TURN opcional com credenciais temporárias assinadas no backend.
- Migração SQL versionada, testes de unidade, integração, teste real de WebRTC no Chromium e GitHub Actions.

## Estrutura

| Caminho | Responsabilidade |
| --- | --- |
| `apps/web/src/components/` | Login, verificação, pareamento, seleção, progresso e histórico |
| `apps/web/src/lib/usePeer.ts` | Socket.io, negociação WebRTC, ICE e ciclo de conexão |
| `apps/web/src/lib/transfer.ts` | Envio/recepção, janela, ACK, cancelamento e conclusão |
| `apps/web/src/lib/frames.ts` | Cabeçalho binário, offsets e SHA-256 por bloco |
| `apps/web/src/lib/disk.ts` | Escolha do destino e gravação direta em disco |
| `apps/server/src/auth.ts` | Cadastro, login, sessão e verificação de e-mail |
| `apps/server/src/security.ts` | Hash de senha e geração/hash de tokens |
| `apps/server/src/mail.ts` | Transporte Nodemailer e mensagem de ativação |
| `apps/server/src/signaling.ts` | Pareamento, autorização de sinais e metadados |
| `apps/server/src/index.ts` | API HTTP, histórico, configuração ICE e inicialização |
| `apps/server/prisma/` | Models Prisma e migração PostgreSQL |
| `packages/shared/src/` | Tipos, validação de metadados, mensagens e constantes |
| `tests/` | Protocolo, integração e teste de navegador |
| `docs/ARCHITECTURE.md` | Arquitetura, estados, endpoints e decisões de segurança |
| `docs/PROTOCOL.md` | Especificação do protocolo de transferência |
| `docs/DEPLOYMENT.md` | HTTPS, celular, SMTP externo, TURN e produção |

## Instalação local

Você precisa de **Node.js 22.12+** e **Docker com Compose**. No Windows, use PowerShell ou Git Bash com Docker Desktop iniciado. Os comandos abaixo usam Git Bash/macOS/Linux.

1. Abra a pasta do projeto:

   ```bash
   cd ponte
   npm ci
   ```

2. Prepare as variáveis de ambiente:

   ```bash
   cp apps/server/.env.example apps/server/.env
   ```

   O exemplo funciona com o PostgreSQL e o Mailpit fornecidos no Compose. Nunca envie `.env`, senhas SMTP, certificados privados ou URLs de banco com credenciais ao GitHub.

3. Inicie banco e caixa de e-mail local:

   ```bash
   docker compose up -d
   npm run db:generate
   npm run db:migrate
   ```

4. Verifique o SMTP e inicie frontend e backend:

   ```bash
   npm run smtp:check
   npm run dev
   ```

5. Abra [Ponte local](http://localhost:5173), crie uma conta e abra [Mailpit local](http://localhost:8025). Clique no link do e-mail e no botão **Confirmar e-mail**. Depois, entre na conta. O Mailpit captura o e-mail localmente e não o entrega à sua caixa real.

6. Para testar no mesmo computador, use duas janelas ou perfis de navegador. No receptor, clique em **Gerar código**. No remetente, digite o código e clique em **Conectar**. Aprove a conexão no receptor.

7. Selecione um arquivo no remetente e clique em **Enviar arquivo**. No receptor, clique em **Escolher destino e receber** e confirme o local para salvar. Aguarde **Concluído** em ambos.

Um pareamento suporta um arquivo por vez. Após uma transferência concluída, pode enviar outro arquivo na mesma conexão. Após cancelamento ou interrupção, gere um novo código. Não há retomada automática de transferências interrompidas.

## SMTP no `.env`

| Variável | Significado |
| --- | --- |
| `SMTP_HOST` | Host do servidor SMTP |
| `SMTP_PORT` | Porta: 1025 local, 587 STARTTLS ou 465 TLS desde a conexão |
| `SMTP_SECURE` | `true` para TLS imediato, normalmente na porta 465 |
| `SMTP_REQUIRE_TLS` | `true` para exigir STARTTLS quando `SMTP_SECURE=false` |
| `SMTP_USER` / `SMTP_PASS` | Credenciais SMTP; vazias apenas no servidor local sem autenticação |
| `SMTP_FROM` | Nome e endereço do remetente autorizado pelo provedor |
| `APP_ORIGIN` | Origem exata do frontend; usada nos links, cookies e validação de origem |

**Mailtrap Email Sandbox** — copie host, usuário e senha da aba de integração da sua sandbox:

```dotenv
SMTP_HOST=sandbox.smtp.mailtrap.io
SMTP_PORT=2525
SMTP_SECURE=false
SMTP_REQUIRE_TLS=true
SMTP_USER=seu_usuario_da_sandbox
SMTP_PASS=sua_senha_da_sandbox
SMTP_FROM="Ponte <no-reply@example.com>"
```

**Gmail com Senha de Aplicativo** — use a senha de aplicativo da conta que enviará os e-mails:

```dotenv
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_REQUIRE_TLS=true
SMTP_USER=seuemail@gmail.com
SMTP_PASS=sua_senha_de_aplicativo
SMTP_FROM="Ponte <seuemail@gmail.com>"
```

A disponibilidade de Senhas de Aplicativo depende da conta Google e normalmente exige verificação em duas etapas. O Gmail tem cotas e não é a escolha indicada para envio transacional em grande escala. Consulte [Nodemailer SMTP](https://nodemailer.com/smtp) e [Ajuda Google sobre senhas de aplicativo](https://support.google.com/mail/answer/185833).

## Celular e computador

`localhost` no celular aponta para **o próprio celular**. Para usar os dois dispositivos, exponha o frontend pelo endereço do computador, com **HTTPS confiável nos dois dispositivos**, e configure `APP_ORIGIN` com exatamente esse endereço. O servidor Vite já encaminha `/api` e `/socket.io` para o backend.

Veja o passo a passo de certificados locais e produção em [DEPLOYMENT.md](docs/DEPLOYMENT.md). Não basta trocar localhost por um IP em HTTP: recursos seguros de navegador podem ficar indisponíveis. Mantenha as abas abertas e o celular acordado. Wi-Fi de convidados pode bloquear comunicação entre clientes.

Para redes diferentes, STUN ajuda a descobrir rotas; algumas redes só funcionam com TURN. Quando TURN é utilizado, o tráfego criptografado passa pelo relay e existe consumo de banda no servidor TURN. A API de autenticação/sinalização continua sem armazenar o conteúdo dos arquivos.

## Build e testes

```bash
npm run typecheck
npm test
npm run build
```

Testes de integração e navegador usam um **banco local de desenvolvimento descartável** e uma caixa SMTP de teste. Eles criam contas `@example.test` e metadados de teste. Não execute contra dados de produção.

1. No `.env` local, altere `SMTP_PORT=2525`, mantendo `SMTP_REQUIRE_TLS=false`.
2. Com o PostgreSQL iniciado e as migrações aplicadas, execute em terminais separados:

   ```bash
   npm run test:mail
   npm run dev
   ```

3. Em outro terminal:

   ```bash
   npm run test:integration
   npx playwright install chromium
   npm run test:e2e
   ```

O teste de navegador usa dois contextos, transfere 8 MiB + 17 bytes por WebRTC, grava no disco privado do Chromium e compara SHA-256. Apenas o seletor nativo de destino é substituído para automação; DataChannel e stream de escrita são reais. Testa também um segundo arquivo vazio na mesma conexão e layout em 390 × 844. O teste de offsets acima de 4 GiB não substitui um ensaio de transferência física com arquivos de vários GiB.

Se repetir os testes várias vezes, o rate limit de autenticação local pode ser alcançado. Aguarde a janela ou reinicie **apenas o servidor de teste**. Em produção, mantenha a proteção ativa.

## Limites e escopo

### Validação desta entrega — 18/09/2026

- Checagem TypeScript, build, 7 testes de unidade e 7 cenários de integração passaram (8 testes contados pelo runner incluindo o teste pai).
- As integrações foram executadas com Prisma, PostgreSQL via PGlite em ambiente descartável e SMTP local de teste. O CI está configurado para PostgreSQL 17.
- O teste de cadastro/login em viewport móvel passou; o layout desktop e a geração/aprovação de pareamento foram inspecionados.
- **A transferência real entre navegadores ainda não foi validada:** offer/answer foram trocados, mas o Chromium do ambiente terminou a coleta ICE sem candidatos e o teste expirou antes de abrir o DataChannel. Os testes unitários do protocolo usam um canal simulado e não substituem esse teste.
- Execute `npm run test:e2e` numa máquina com WebRTC disponível antes de usar em produção. Ainda é necessário testar celular físico, arquivos de vários GiB e redes diferentes com TURN.

- A aplicação não cria cotas por arquivo. `File.size` é representado por um número inteiro seguro em JavaScript; metadados usam `BIGINT` no PostgreSQL. Limites do sistema de arquivos, espaço temporário e permissões continuam valendo.
- A confirmação de bloco acontece depois de `write()`. A conclusão só ocorre após `close()`, que confirma a gravação do arquivo. Isso não é uma promessa de `fsync` físico em hardware.
- O receptor pode precisar de espaço temporário adicional enquanto o navegador grava de maneira segura. Falha de disco ou cancelamento não é marcada como sucesso.
- O histórico é informado pelos clientes autenticados. O servidor não vê os bytes e não pode provar entrega contra um receptor malicioso. Não é um registro financeiro ou comprovação independente.
- Uma única instância Node mantém os pareamentos em memória. Reinício encerra pares e marca registros pendentes como interrompidos. Escala horizontal exige um armazenamento compartilhado, coordenação de salas e mudança no procedimento de recuperação.
- Senha esquecida, antivírus, retomada, transferências em background e recebimento via Safari/iOS não estão incluídos neste MVP.

## Referências técnicas

- [MDN — WebRTC DataChannels e limites por mensagem](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Using_data_channels)
- [MDN — showSaveFilePicker e requisitos de contexto seguro](https://developer.mozilla.org/en-US/docs/Web/API/Window/showSaveFilePicker)
- [Chrome — File System Access API](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access)
- [Socket.io — middleware](https://socket.io/docs/v4/middlewares/)
- [Nodemailer — transporte SMTP](https://nodemailer.com/smtp)

Projeto entregue como base funcional para desenvolvimento. Credenciais externas de SMTP/TURN e domínio HTTPS devem ser configurados pelo responsável pela instalação.
