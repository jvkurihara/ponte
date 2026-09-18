# Protocolo Ponte v1

O DataChannel se chama `ponte-v1`, com `ordered: true`. Não configura `maxRetransmits` ou `maxPacketLifeTime`: retransmissão confiável fica a cargo do SCTP/WebRTC. Nenhuma câmera ou microfone é solicitado.

## Negociação

1. O receptor cria uma sala e o remetente informa seu código.
2. Após aprovação, os clientes recebem os papéis fixos.
3. O remetente cria o DataChannel, gera SDP offer e envia por Socket.io.
4. O receptor aplica a offer, gera answer e a devolve.
5. Candidatos ICE podem chegar antes da descrição; ficam em fila até `setRemoteDescription`.
6. O arquivo só começa após o canal estar aberto, o receptor aceitar seus metadados e escolher o destino.

## Mensagens de controle

São JSON validados por Zod, limitados a 4096 caracteres no canal.

| Tipo | Direção | Conteúdo |
| --- | --- | --- |
| `offer` | Envio → recepção | ID da transferência, nome, tamanho e MIME |
| `accept` | Recepção → envio | ID, após abrir stream e registrar início |
| `ack` | Recepção → envio | ID e total acumulado de bytes escritos |
| `end` | Envio → recepção | ID, após ACK de todos os bytes |
| `complete` | Recepção → envio | ID e confirmação de registro no histórico |
| `cancel` | Ambos | ID; a conexão é descartada para não reaproveitar frames pendentes |

O receptor consulta a API autenticada e compara os metadados registrados com a offer. O servidor autoriza o início usando o socket receptor específico da sala.

## Frame binário

| Bytes | Campo | Codificação |
| --- | --- | --- |
| 0–7 | Offset no arquivo | uint64 big-endian |
| 8–39 | SHA-256 do payload | 32 bytes |
| 40 em diante | Payload | Até 16 KiB |

O tamanho efetivo do payload é `min(16384, pc.sctp.maxMessageSize - 40)`, com fallback de mensagem de 64 KiB quando o limite negociado não estiver disponível. `maxMessageSize=0` também usa o tamanho conservador. A memória nunca escala com o tamanho total do arquivo.

O hash é por bloco, não um hash final do arquivo inteiro. Com canal ordenado, offsets contíguos, tamanho final exato e verificação de cada bloco, o receptor detecta corrupção e frames fora de ordem. O hash não autentica a identidade por si só; a sessão, o pareamento aprovado e DTLS fazem parte dessa garantia.

## Controle de fluxo e progresso

O remetente avança apenas se `sent - acked + nextChunk <= 1 MiB` e o buffer de envio estiver abaixo da marca alta (256 KiB). Quando necessário, espera ACK ou `bufferedamountlow`, com marca baixa de 64 KiB. Arquivos são lidos usando `file.slice(offset, end).arrayBuffer()` por bloco.

O receptor limita também a quantidade de bytes pendentes na fila JavaScript. A fila processa hash, gravação e ACK sequencialmente; não inicia todas as escritas em paralelo. O ACK ocorre após `await writable.write(payload)`.

O progresso deriva de `ackedBytes / fileSize`. A UI mantém a barra em até 99% durante a finalização, mesmo após todos os ACKs, e só mostra 100% após `writable.close()` e a mensagem `complete`. Para arquivo vazio, a conclusão depende do mesmo aceite e fechamento, sem divisão por zero.

O histórico recebe contagens de recepção a cada aproximadamente dois segundos para evitar uma escrita SQL por chunk. A barra não depende desse intervalo; usa ACKs no DataChannel, com renderização limitada a aproximadamente 10 atualizações por segundo.

## Encerramento

Um timeout de espera não limita a duração total de um arquivo; detecta falta de resposta do par. O aceite pode esperar até 10 minutos. Envio/ACK/conclusão usam esperas de até 120 segundos sem satisfazer a condição esperada.

Cancelar envia uma mensagem ao par, atualiza o histórico quando possível, aborta o writable e fecha o canal. Após cancelamento, queda ou reinício, recomece do zero com novo pareamento. O MVP não tenta reaproveitar um arquivo parcial.

`write()` pode representar gravação em arquivo temporário do navegador. `close()` confirma a gravação no destino. Se falhar por falta de espaço, permissão ou erro de I/O, o receptor não envia `complete`. A conclusão não promete durabilidade física contra perda elétrica, algo que a API do navegador não permite assegurar.
