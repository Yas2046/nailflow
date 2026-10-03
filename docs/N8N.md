# NailFlow — n8n

## Instalação

| Item | Valor |
|---|---|
| Versão | 2.35.7 Community Edition |
| Gerenciado por | PM2 (id: 4) |
| Porta | 5678 — bloqueada externamente pelo UFW; acesso só via Nginx |
| URL externa | https://nailflow-n8n.duckdns.org |
| Banco de dados | SQLite em `~/.n8n/database.sqlite` |

---

## Workflows

### Ativos (verificado em 2026-09-27)

| Nome | ID | Gatilho | Função | Versão publicada | Estado |
|---|---|---|---|---|---|
| WhatsApp NailFlow — Definitivo | 3yBtUtgMlKsXh3mw | webhook `whatsapp-nailflow` (Header Auth) | Processa mensagens recebidas das instâncias | `74585f0a` | ✅ ativo; sem mensagens desde a desconexão do `chip2` |
| NailFlow — Notificações | jgCnaeacHYMH6SRT | webhook `nailflow/notificacoes` (Header Auth) | Avisa a cliente sobre confirmação/cancelamento | `7eb7fd01` | ✅ ativo, webhook registrado |
| NailFlow — Abandono de Conversa | rQ7S8XcAiiTCgXEr | Schedule (15 min) | Detecta conversas abandonadas e notifica | `d566c2fe` | ✅ corrigido em 2026-09-27; execuções com sucesso |
| NailFlow — Lembretes de Agendamento | crVRWCDoVzCEWSgz | Schedule (30 min) | Envia lembrete ~24h antes | `9da88cb4` | ✅ corrigido em 2026-09-27; execuções com sucesso |
| NailFlow — Solicitação Recusada | NfSolRecusada0001 | webhook `nailflow/solicitacao-recusada` (Header Auth) | Avisa a cliente que a solicitação foi recusada (evento `appointment.rejected`) | — | ✅ publicado em 2026-10-02 (Fase 1A) |
| NailFlow — Mensagem à Cliente | NfMensagemCliente01 | webhook `nailflow/mensagem-cliente` (Header Auth) | Canal genérico de mensagem à cliente (evento `message.send`): recebimento da solicitação e instruções de sinal Pix | — | ✅ publicado em 2026-10-02 (commit `cb07d38`) |

Todos usam o nome da instância de forma dinâmica (`waInstance`, a partir de `GET /bot/instances` ou do payload) — nenhum tem instância fixa.

### Inativos (não alterar sem análise)

| Nome | ID | Obs |
|---|---|---|
| NailFlow — Lembretes de Agendamento | uHtykapT7vFNA1Du | duplicata inativa — manter inativo |
| NailFlow — Lembretes | 7Wx8Xul4czlqBx1o | versão antiga — manter inativo |
| NailFlow — WhatsApp Principal | muSSvRqsDtTSKojL / W9PbP87KDnW7YCaN | versões antigas — manter inativas |
| NailFlow — Verificação Meta Webhook | (4 instâncias) | relacionado a Meta/WABA — manter inativo |
| WhatsApp Teste — oi/olá | 2XiXEGDdFLy9OZc6 | workflow de teste — manter inativo |

---

## Webhooks registrados (ativos)

| Path | Método | Workflow |
|---|---|---|
| `whatsapp-nailflow` | POST | WhatsApp NailFlow — Definitivo (exige `X-NailFlow-Webhook-Secret`) |
| `nailflow/notificacoes` | POST | NailFlow — Notificações (exige `X-NailFlow-Webhook-Secret`) |
| `nailflow/solicitacao-recusada` | POST | NailFlow — Solicitação Recusada (exige `X-NailFlow-Webhook-Secret`) |
| `nailflow/mensagem-cliente` | POST | NailFlow — Mensagem à Cliente (exige `X-NailFlow-Webhook-Secret`) |
| `nailflow/mensagem-recebida` | POST | NailFlow — WhatsApp Principal (INATIVO) |
| `evolution-chip2` | POST | WhatsApp Teste — oi/olá (INATIVO) |

**URL completa:** `https://nailflow-n8n.duckdns.org/webhook/{path}`

### Autenticação dos webhooks (desde 2026-09-27)

| Webhook | Node | Autenticação | Credencial (tipo Header Auth) | Quem envia | Variável do segredo |
|---|---|---|---|---|---|
| `whatsapp-nailflow` | Receber Mensagem | `headerAuth` | NailFlow Webhook — Evolution | Evolution (campo `headers` do webhook da instância) | `N8N_BOT_WEBHOOK_SECRET` |
| `nailflow/notificacoes` | Webhook NailFlow (notificações) | `headerAuth` | NailFlow Webhook — Notificações | backend (`utils/notifyN8n.js`) | `N8N_NOTIFY_SECRET` |

- Nome do cabeçalho: `X-NailFlow-Webhook-Secret`. Sem ele ou com valor errado, o n8n responde 403 e não executa o workflow
- Os segredos foram gerados no servidor e ficam só no `backend/.env`, nas credenciais do n8n (criptografadas) e no `headers` do webhook da Evolution. **Nunca escrever os valores no Git nem na documentação**
- As credenciais antigas ("Header Auth account" e "account 2") não foram alteradas
- **Ainda sem teste real ponta a ponta:** por decisão, não foi feito POST nos webhooks para testar o 403, e o `chip2` está desconectado. A validação feita foi: versões publicadas com `headerAuth` e a credencial certa, credenciais e `headers` da Evolution conferidos contra o `.env`, e os dois webhooks registrados após o reinício do n8n
- Rollback do "Definitivo", se a primeira mensagem real após a reconexão receber 403: voltar o node "Receber Mensagem" para `authentication = none` e reiniciar o n8n

---

## Fluxo "WhatsApp NailFlow — Definitivo"

```
[Webhook Trigger: POST /webhook/whatsapp-nailflow]  ← Header Auth (X-NailFlow-Webhook-Secret)
        │
        ▼ (recebe payload da Evolution)
[Filtrar: apenas mensagens de texto, ignora grupos/status]
        │
        ▼
[Processar no NailFlow: POST http://localhost:3333/bot/process]  ← Bearer BOT_API_KEY + instância
        │
        ▼
[Recebe resposta: { reply } ou { reply: null, reason }]
        │
        ├── reply existe?
        │      ▼
        │   [Enviar via Evolution: POST https://nailflow-evolution.duckdns.org/message/sendText/{instance}]
        │      ▼
        │   [Registrar Mensagem Bot: POST http://localhost:3333/bot/record-sent]
        │
        └── reply null (atendimento humano, duplicata, eco…) → encerra
```

- O node "Processar no NailFlow" tem retry: se o backend responder erro, a chamada é repetida. Como a mensagem já foi gravada na 1ª tentativa, a repetição retorna `reason: "duplicate"` — por isso um erro no backend aparece no n8n como execução "success" sem resposta à cliente (foi o caso do bug do `$1`, ver [`FLUXOS_DO_BOT.md`](./FLUXOS_DO_BOT.md)).
- O node "Registrar Mensagem Bot" retorna 400 (`Campo "instance" obrigatório…`) quando há mais de uma profissional cadastrada, porque não envia o nome da instância. A mensagem já foi enviada à cliente nesse ponto, então o atendimento não é afetado, mas as mensagens do bot não ficam gravadas em `message_history`. Pendência registrada em [`PENDENCIAS.md`](./PENDENCIAS.md).

---

## Variáveis de ambiente no n8n

O n8n tem `N8N_EXPOSE_PROCESS_ENV=true`. Variáveis visíveis aos workflows:

| Variável | Uso |
|---|---|
| `BOT_API_KEY` | Autenticação nas chamadas ao NailFlow backend |

Os segredos dos webhooks **não** são lidos por variável de ambiente no n8n: ficam nas credenciais Header Auth.
| `N8N_EXPOSE_PROCESS_ENV` | Permite ler `process.env` nos workflows |

---

## API Keys do n8n

A tabela `user_api_keys` está **vazia** (0 rows). O n8n REST API não está habilitado via chave.

A variável `N8N_API_KEY` no `.env` do backend **não é usada** em nenhum arquivo de código. É uma variável residual.

---

## Eventos do backend → n8n (`notifyN8n`)

O backend dispara `POST` fire-and-forget com `X-NailFlow-Webhook-Secret` (`N8N_NOTIFY_SECRET`) e corpo `{event, payload, sentAt}`. A URL de cada evento vem de uma variável do `.env`:

| Evento | Variável | Destino |
|---|---|---|
| `appointment.confirmed` / `appointment.cancelled` / `appointment.public_created` | `N8N_WEBHOOK_CONFIRMED_URL` / `N8N_WEBHOOK_CANCELLED_URL` | `nailflow/notificacoes` |
| `appointment.rejected` | `N8N_WEBHOOK_REJECTED_URL` | `nailflow/solicitacao-recusada` |
| `message.send` | `N8N_WEBHOOK_MESSAGE_URL` | `nailflow/mensagem-cliente` |

`message.send` leva `payload = {kind: appointment_requested | payment_instructions, waInstance, clientPhone, clientName, text}`; o workflow só envia `payload.text` (≤ 1000 caracteres), valida `clientPhone` (10–15 dígitos) e `waInstance`, e usa a credencial Evolution já existente. Quem monta o texto é o backend. Expirar uma reserva e a confirmação por "Pagamento recebido" não usam `message.send`: a confirmação usa `appointment.confirmed`; a expiração não envia nada.

## Arquivos de workflows exportados

Localização: `/var/www/nailflow/n8n/workflows/`

| Arquivo | Conteúdo |
|---|---|
| `nailflow_abandono_de_conversa.json` | **Export atual** de "NailFlow — Abandono de Conversa", versão publicada `d566c2fe-8330-44e6-91f8-a24729b6af11` |
| `nailflow_lembretes_de_agendamento.json` | **Export atual** de "NailFlow — Lembretes de Agendamento", versão publicada `9da88cb4-4a6a-4938-ba8a-b50957d24bb5` |
| `nailflow_solicitacao_recusada.json` | Workflow "NailFlow — Solicitação Recusada" (`NfSolRecusada0001`), versionado na Fase 1A |
| `nailflow_mensagem_cliente.json` | Workflow "NailFlow — Mensagem à Cliente" (`NfMensagemCliente01`), versionado em `cb07d38`; credenciais só por referência (sem segredos) |
| `whatsapp_nailflow_definitivo.json` | Export antigo do workflow principal — **não reflete** a versão publicada atual (sem Header Auth) |
| `WB-lembretes.json` | Export antigo dos lembretes |
| `WA-whatsapp-principal.json` | Versão anterior (não usar) |
| `1-novo-agendamento.json` ... | Versões iniciais do desenvolvimento |

- `nailflow_abandono_de_conversa.json` e `nailflow_lembretes_de_agendamento.json` foram **regenerados em 2026-09-27** com `n8n export:workflow --published`, a partir das versões publicadas e ativas. Nodes e conexões são idênticos à versão publicada; os loops estão corretos (saída `loop`/`done`, Always Output Data, condição por item). Contêm só `name`, `nodes`, `connections` e `settings`; credenciais aparecem apenas como referência (id e nome) e **não há segredos**. Podem ser versionados. (Uma versão anterior desses arquivos, com as saídas do loop trocadas, foi descartada.)
- Os exports do "WhatsApp NailFlow — Definitivo" e do "NailFlow — Notificações" ainda não foram regenerados a partir das versões publicadas atuais
- Para mudar um workflow publicado no n8n 2.x pela linha de comando: `n8n export:workflow --published`, `n8n import:workflow` (desativa o workflow) e `n8n publish:workflow --id --versionId`, seguido de `pm2 restart n8n`. Atenção: o `export` devolve a versão do histórico, e as conexões podem diferir das de `workflow_entity`

**Para importar no n8n:** acesse https://nailflow-n8n.duckdns.org → Workflows → Import from file.

---

## Problemas conhecidos

### ✅ Resolvido — POST `nailflow/notificacoes` → 404

O workflow "NailFlow — Notificações" foi ativado (última execução com sucesso registrada em 2026-09-22) e o webhook `nailflow/notificacoes` está registrado. Não há erros de notificação nos logs do backend.

### ✅ Resolvido em 2026-09-27 — Crons de Abandono e Lembretes falhando

| Workflow | Última execução com sucesso antes da falha | Falhas desde | Node | Erro |
|---|---|---|---|---|
| NailFlow — Abandono de Conversa | 2026-09-21 17:00 UTC | 2026-09-21 17:15 UTC | Buscar abandonados | 400, depois `Invalid expression` |
| NailFlow — Lembretes de Agendamento | 2026-09-21 17:00 UTC | 2026-09-21 17:30 UTC | Buscar agendamentos | 400, depois `Invalid expression` |

**Causa:**
1. Em 2026-09-21 17:03 UTC foi criada a 2ª profissional com instância (`chip2-teste`). A versão publicada dos crons ligava o trigger direto ao node de busca, sem informar a instância; o backend passou a responder 400 ("Campo instance obrigatório…")
2. A partir de 2026-09-22 11:30 UTC a versão em execução passou a ter `?instance={{ $('Split instancias').item.json.wa_instance_name }}`, mas sem as conexões do loop → `Invalid expression` (`No path back to referenced node`)
3. A cópia de edição (`workflow_entity`) tinha o loop, mas com as saídas do Loop Over Items (v3) **trocadas** (saída 0 = done, saída 1 = loop)

**Correção (duas publicações em 2026-09-27, só com autorização):**
- 1ª publicação (`6fe8cf0d` / `9d9dd207`): publicou o loop da cópia de edição; o `Invalid expression` sumiu, mas as execuções terminavam em "success" sem chamar o backend, por causa das saídas trocadas
- 2ª publicação (`d566c2fe` / `9da88cb4`): saídas `loop`/`done` corrigidas nos loops de instâncias e nos loops internos ("Split conversas" e "Para cada agendamento"); **Always Output Data** nos nodes de busca, para o loop seguir quando uma instância não tem resultados; condição de "Tem lembretes?" trocada para verificar `{{ $json.id }}` não vazio (a anterior, `{{ $json.length }} > 0`, nunca seria verdadeira item a item)
- Antes da publicação, 4 conversas já atrasadas (de 16/09 a 27/09) foram marcadas `abandonment_notified = true`, para não receberem aviso com dias de atraso; nenhuma mensagem foi enviada
- Backup do banco do n8n e das versões anteriores: `/root/n8n-fix-20260927/` (fora do repositório)

**Validação real:**
- Execução 11225 do Abandono (2026-09-27 13:45 UTC): as 2 instâncias processadas pela saída `loop` (`chip2`, depois `chip2-teste`), "Buscar abandonados" rodou uma vez por instância sem erro, o loop terminou pela saída `done`; nenhum envio
- Consulta somente leitura de 2026-09-27: de 13:45 a 17:15 UTC, 15 execuções do Abandono e 7 dos Lembretes (a partir de 14:00), todas `success`
- **Não validado ainda:** os loops internos com itens reais (na execução 11225 não havia abandonos; os Lembretes não foram conferidos node a node) e o envio real de lembrete/abandono — o `chip2` e o `chip2-teste` estão desconectados

### ⚠️ Aviso interno à profissional falha com telefone placeholder (F9)

O evento `appointment.public_created` (aviso à profissional de uma nova reserva pela página pública) falha no node de envio com "Bad request" quando o `phone_whatsapp` da profissional é o número placeholder da conta de teste (`5531999999999`, rejeitado pela Evolution). Reproduzido nos cenários E2E de 2026-10-03 (ex.: execução #14769). Não afeta a mensagem à cliente nem o status da reserva; some com um telefone real cadastrado (ver F9 em [`PENDENCIAS.md`](./PENDENCIAS.md)).

### ℹ️ Execuções do "Definitivo" que param em "Extrair Dados"

O webhook `whatsapp-nailflow` assina `MESSAGES_UPSERT` e recebe também mensagens de **grupos** (`@g.us`), figurinhas e reações. O node "Extrair Dados" as descarta e a execução termina como `success` sem resposta (ex.: #14759–#14765, mensagens de um grupo de WhatsApp, em 2026-10-03). É esperado, não é erro. O campo `data.status` vem como `DELIVERY_ACK` em **todas** as mensagens recebidas (inclusive texto real da cliente); não indica evento de entrega/leitura.

### ⚠️ Status "success" sem trabalho
Uma execução "success" não garante que a chamada ao backend aconteceu: com as saídas trocadas, os crons terminaram "success" sem fazer nada. Ao validar, conferir node a node.

---

## Logs e monitoramento

```bash
pm2 logs n8n --lines 100          # logs recentes
pm2 logs n8n --lines 100 --err    # apenas erros

# Execuções recentes no banco SQLite
sqlite3 ~/.n8n/database.sqlite \
  "SELECT e.id, wf.name, e.status, e.startedAt
   FROM execution_entity e
   JOIN workflow_entity wf ON e.workflowId = wf.id
   ORDER BY e.id DESC LIMIT 20;"
```
