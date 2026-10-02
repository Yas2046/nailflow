# NailFlow — Workflow n8n

> Atualizado em 13/09/2026 para refletir a arquitetura real em produção.

A integração WhatsApp usa **um único workflow** chamado "WhatsApp NailFlow —
Definitivo", diferente dos 5 workflows originais planejados. A arquitetura
evoluiu para um modelo em que toda a lógica de negócio (máquina de estados,
agendamentos, cancelamentos) fica no backend NailFlow, e o n8n funciona como
roteador de mensagens.

---

## Arquitetura real

```
WhatsApp (cliente)
    ↓
Evolution API v2.3.7 (webhook POST)
    ↓
n8n — "WhatsApp NailFlow — Definitivo"
    ↓
POST /bot/process  →  NailFlow backend (máquina de estados)
    ↓ (se houver reply)
Evolution API — sendText
    ↓
POST /bot/record-sent  →  NailFlow backend (registra mensagem do bot)
```

---

## Workflow: "WhatsApp NailFlow — Definitivo"

Arquivo: `workflows/whatsapp_nailflow_definitivo.json`

| Node | Tipo | Função |
|---|---|---|
| Receber Mensagem | Webhook POST `/webhook/whatsapp-nailflow` | Recebe eventos da Evolution API |
| Extrair Dados | Code | Filtra eventos, ignora grupos, extrai phone/text/waMessageId/fromMe/pushName |
| Processar no NailFlow | HTTP Request → POST `/bot/process` | Executa a máquina de estados do bot |
| Tem Resposta? | If | Verifica se o backend retornou `reply` não vazio |
| Enviar via Evolution | HTTP Request → POST Evolution sendText | Envia a resposta ao cliente |
| Registrar Mensagem Bot | HTTP Request → POST `/bot/record-sent` | Registra a mensagem enviada (anti-loop) |

---

## Configuração das credenciais no n8n live

### Autenticação com o backend NailFlow (`/bot/process` e `/bot/record-sent`)
- **Tipo:** Generic Credential Type → Header Auth
- **Nome da credencial no n8n:** "Header Auth account 2"
- **Header Name:** `Authorization`
- **Header Value:** `Bearer <valor_do_BOT_API_KEY>`

> ⚠️ O arquivo JSON local usa `$env.BOT_API_KEY` — isso **não funciona** no
> n8n Community Edition sem pagar. Ao importar o workflow, editar manualmente
> os nodes "Processar no NailFlow" e "Registrar Mensagem Bot" para usar a
> credencial "Header Auth account 2" acima.

### Autenticação com a Evolution API (envio de mensagens)
- Credencial já existente no n8n live (apikey da Evolution API).
- Usada no node "Enviar via Evolution".

---

## Webhook da Evolution API

O webhook da Evolution foi configurado para:
- **URL:** `https://nailflow-n8n.duckdns.org/webhook/whatsapp-nailflow`
- **Método:** POST
- **Instância:** chip2

Para verificar ou reconfigurar, acessar o Manager da Evolution:
`https://nailflow-evolution.duckdns.org/manager/`

---

## Lógica do bot (`botController.js`)

Toda a inteligência está em `/var/www/nailflow/backend/src/controllers/botController.js`.

**Estados da máquina:**
```
INICIO → MENU
MENU → AGUARDANDO_SERVICO → AGUARDANDO_DATA → AGUARDANDO_HORARIO
     → AGUARDANDO_CONFIRMACAO_AGENDAMENTO
MENU → AGUARDANDO_CANCELAMENTO → AGUARDANDO_CONFIRMACAO_CANCELAMENTO
```

**Comportamentos especiais:**
- `fromMe = true` + texto `#bot` → ativa o bot para aquele número
- `fromMe = true` + qualquer outro texto → modo ATENDIMENTO_HUMANO (bot silencia)
- `fromMe = false` + frases de escape → ATENDIMENTO_HUMANO com mensagem de aviso
- 3 inputs inválidos no MENU → ATENDIMENTO_HUMANO
- "menu" / "voltar" em AGUARDANDO_* → retorna ao MENU
- `wa_message_id` deduplicado em `message_history` → anti-loop

---

## Pendências / funcionalidades a implementar

- **Cron de abandono:** workflow n8n separado que verifica conversations em estado
  AGUARDANDO_* com `last_message_at` há mais de X minutos e `context->>'abandonment_notified' = 'false'`,
  envia um lembrete, e faz PUT/POST na API para marcar `abandonment_notified = true`.
  Implementar após os testes do bot estarem concluídos.

---

## O que NÃO usar mais

Os 5 workflows originais (`1-novo-agendamento.json`, `2-consulta-horarios.json`,
`3-confirmacao.json`, `4-lembrete.json`, `5-cancelamento.json`) **não são mais
usados**. A arquitetura mudou. Esses arquivos podem ser descartados ou mantidos
apenas como referência histórica.
