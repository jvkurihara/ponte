# HTTPS, SMTP e redes externas

## Teste em celular na mesma rede

Use um endereço HTTPS confiável nos dois dispositivos. Um certificado com alerta de segurança pode não habilitar as APIs exigidas.

1. Instale [mkcert](https://github.com/FiloSottile/mkcert) pelo procedimento oficial para seu sistema.
2. Descubra o IP local do computador com `ipconfig` no Windows ou nas configurações da rede. No exemplo abaixo, substitua `192.168.1.10` pelo seu IP.
3. Na raiz do projeto, gere o certificado local:

   ```bash
   mkdir -p .local
   mkcert -install
   mkcert -cert-file .local/local-cert.pem -key-file .local/local-key.pem localhost 127.0.0.1 ::1 192.168.1.10
   ```

4. Instale e confie no certificado público da CA local (`rootCA.pem`) também no seu celular, conforme o procedimento do sistema. No iOS, após instalar o perfil, a confiança do certificado deve ser habilitada nas configurações de certificados. **Nunca copie nem compartilhe `rootCA-key.pem` ou a chave privada do servidor.**
5. Configure em `apps/server/.env`:

   ```dotenv
   APP_ORIGIN=https://192.168.1.10:5173
   ```

6. Inicie a aplicação com os caminhos dos certificados. O processo do Vite roda em `apps/web`, portanto os caminhos relativos abaixo apontam para a raiz:

   ```bash
   LOCAL_TLS_CERT=../../.local/local-cert.pem LOCAL_TLS_KEY=../../.local/local-key.pem npm run dev
   ```

7. Abra o **mesmo endereço HTTPS** no computador e no celular. Permita acesso à porta 5173 no firewall apenas na rede confiável. Não exponha PostgreSQL, a caixa SMTP de teste ou o backend diretamente à internet.

8. Crie/verifique a conta e repita o fluxo de pareamento. E-mails antigos apontam para a origem anterior: reenvie a verificação se tiver alterado `APP_ORIGIN`.

Se o navegador móvel não apresentar a API de gravação, use-o como remetente e o computador como receptor. Essa detecção é feita dinamicamente; o nome comercial do navegador não garante suporte, especialmente no iOS.

## Produção

1. Use um banco PostgreSQL persistente e SMTP de envio transacional. O Compose de desenvolvimento contém senha local de exemplo e não é uma configuração de produção.
2. Configure o ambiente do backend com `NODE_ENV=production`, `APP_ORIGIN=https://seu-dominio` e `DATABASE_URL` de produção. Configure SMTP real com TLS e remetente autorizado. Não prefixe segredos com `VITE_`.
3. Instale dependências, gere Prisma, aplique a migração e faça build:

   ```bash
   npm ci
   npm run db:generate
   npm run db:migrate
   npm run build
   npm start
   ```

4. Encaminhe o domínio HTTPS por um reverse proxy para a porta 3001, incluindo upgrade de WebSocket. O backend em produção serve o frontend compilado de `apps/web/dist` e a API sob a mesma origem.
5. Defina `TRUST_PROXY_HOPS=1` **somente** se houver um proxy confiável que substitua cabeçalhos encaminhados e o backend não puder ser acessado diretamente. Caso contrário, mantenha zero. Isso afeta rate limiting por IP.
6. Use supervisão de processo, coleta de erros sem senhas/tokens, backups e uma instância de sinalização. O timeout ocioso do proxy para WebSocket deve permitir conexão contínua com os pings do Socket.io.

Exemplo de Caddyfile, substituindo o domínio:

```caddyfile
arquivos.example.com {
    reverse_proxy 127.0.0.1:3001
}
```

O proxy limita apenas API e sinais. Não há endpoint HTTP de upload de arquivos para aumentar limites de corpo ou timeout de upload.

## STUN e TURN

Na mesma rede, candidatos locais podem bastar. Para redes distintas, configure os servidores de sua infraestrutura:

```dotenv
STUN_URLS=stun:turn.example.com:3478
TURN_URLS=turn:turn.example.com:3478?transport=udp,turns:turn.example.com:5349?transport=tcp
TURN_SHARED_SECRET=um_segredo_aleatorio_com_pelo_menos_32_caracteres
TURN_TTL_SECONDS=86400
```

O exemplo é ilustrativo: `turn.example.com` não é um servidor disponível. Cadastre/provisione um TURN com suporte ao mecanismo REST do coturn e configure o mesmo segredo no servidor. O backend gera username `expiração:userId` e password HMAC-SHA1 Base64. O segredo compartilhado não chega ao frontend; as credenciais temporárias chegam apenas a contas verificadas.

Configure realm, certificados válidos, portas de escuta, faixa de relay, firewall e proteção de acesso a endereços privados/multicast conforme a documentação do coturn. Restrinja o relay a usuários autorizados e monitore banda. O TURN precisa ser acessível aos dois dispositivos.

A conexão pode usar relay quando P2P direto não funciona. Isso aumenta a compatibilidade, mas cria consumo de banda no relay; WebRTC não elimina esse custo. O payload continua criptografado por DTLS. A validade das credenciais TURN é configurável para cobrir a duração esperada das transferências; renovar credenciais durante uma sessão existente não está implementado.

## Problemas comuns

| Sintoma | Verificação |
| --- | --- |
| E-mail não chega | `npm run smtp:check`, credenciais, remetente, caixa Mailpit/Mailtrap, spam e cotas |
| Gmail rejeita senha | Use senha de aplicativo compatível com a conta; não use a senha normal |
| Cookie não persiste no celular | HTTPS válido, mesma origem, URL do frontend e APP_ORIGIN exatos |
| Código não funciona | Validade de 10 minutos, somente dois participantes, conexão anterior já encerrada |
| Dispositivos não conectam | Firewall, isolamento de Wi-Fi de convidados, redes diferentes, STUN/TURN |
| Não aparece escolha de destino | `showSaveFilePicker` indisponível ou contexto sem HTTPS confiável |
| Erro após vários GiB | Espaço livre/temporário, limite do sistema de arquivos, suspensão da aba ou rede |
| Histórico interrompido após reinício | Comportamento esperado: não existe retomada neste MVP |

Faça ensaios no navegador e hardware de destino, com seus maiores arquivos reais, antes de depender do sistema para dados sem outra cópia.
