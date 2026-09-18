# NailFlow — Rotas e Endpoints

**Base URL produção:** `https://nailflow.duckdns.org/api`

Todas as rotas (exceto `/auth/*` e `/public/*`) exigem cookie JWT válido.

---

## Autenticação (`/auth`)

| Método | Path | Auth | Descrição |
|---|---|---|---|
| POST | `/auth/register` | ✗ | Cadastrar nova profissional |
| POST | `/auth/login` | ✗ | Login → seta cookie JWT |
| POST | `/auth/logout` | ✗ | Remove cookie |
| GET | `/auth/me` | JWT | Dados da profissional logada |
| PUT | `/auth/profile` | JWT | Atualizar perfil |
| PUT | `/auth/password` | JWT | Alterar senha |

---

## Agendamentos (`/appointments`)

| Método | Path | Auth | Descrição |
|---|---|---|---|
| GET | `/appointments` | JWT | Listar agendamentos |
| GET | `/appointments/:id` | JWT | Detalhe de um agendamento |
| POST | `/appointments` | JWT | Criar agendamento |
| PUT | `/appointments/:id` | JWT | Atualizar agendamento |
| DELETE | `/appointments/:id` | JWT | Cancelar/excluir |

---

## Clientes (`/clients`)

| Método | Path | Auth | Descrição |
|---|---|---|---|
| GET | `/clients` | JWT | Listar clientes (com busca e filtro por tag) |
| GET | `/clients/:id` | JWT | Histórico de atendimentos |
| POST | `/clients` | JWT | Criar cliente |
| PUT | `/clients/:id` | JWT | Atualizar cliente |
| DELETE | `/clients/:id` | JWT | Excluir cliente |

---

## Serviços (`/services`)

| Método | Path | Auth | Descrição |
|---|---|---|---|
| GET | `/services` | JWT | Listar serviços |
| POST | `/services` | JWT | Criar serviço |
| PUT | `/services/:id` | JWT | Atualizar serviço |
| DELETE | `/services/:id` | JWT | Excluir serviço |

---

## Disponibilidade (`/availability`)

| Método | Path | Auth | Descrição |
|---|---|---|---|
| GET | `/availability` | JWT | Listar regras semanais |
| PUT | `/availability` | JWT | Atualizar regras semanais |
| GET | `/availability/slots` | JWT | Horários disponíveis para agendamento |

---

## Dashboard (`/dashboard`)

| Método | Path | Auth | Descrição |
|---|---|---|---|
| GET | `/dashboard` | JWT | KPIs: faturamento, agendamentos, top serviços |

---

## WhatsApp (`/whatsapp`)

| Método | Path | Auth | Descrição |
|---|---|---|---|
| GET | `/whatsapp/status` | JWT | Status da instância chip2 da profissional |
| POST | `/whatsapp/connect` | JWT | Solicitar QR para conectar WhatsApp |
| GET | `/whatsapp/instance` | JWT | Nome da instância configurada |
| PUT | `/whatsapp/instance` | JWT | Configurar nome da instância |
| DELETE | `/whatsapp/instance` | JWT | Remover instância configurada |

---

## Página Pública (`/public`)

| Método | Path | Auth | Descrição |
|---|---|---|---|
| GET | `/public/:slug` | ✗ | Dados públicos da profissional (nome, serviços) |
| GET | `/public/:slug/slots` | ✗ | Slots disponíveis para agendamento público |

---

## Bot (`/bot`) — chamado pelo n8n

Autenticação: `x-bot-api-key: BOT_API_KEY`

| Método | Path | Auth | Descrição |
|---|---|---|---|
| GET | `/bot/instances` | BOT_KEY | Listar profissionais e suas instâncias |
| POST | `/bot/process` | BOT_KEY + instance | Processar mensagem recebida |
| POST | `/bot/record-sent` | BOT_KEY + instance | Registrar mensagem enviada no histórico |
| GET | `/bot/conversation/:phone` | BOT_KEY + instance | Obter estado da conversa |
| POST | `/bot/conversation/:phone` | BOT_KEY + instance | Forçar estado de conversa |
| GET | `/bot/abandoned-conversations` | BOT_KEY + instance | Listar conversas abandonadas (cron) |
| POST | `/bot/mark-abandonment-notified` | BOT_KEY + instance | Marcar abandono como notificado |
| GET | `/bot/appointments-tomorrow` | BOT_KEY + instance | Agendamentos de amanhã para lembrete |
| POST | `/bot/mark-reminder-sent` | BOT_KEY + instance | Marcar lembrete como enviado |

### Como o n8n resolve o `professionalId`

O middleware `requireBotAuth` (arquivo `src/middleware/botAuth.js`):
1. Valida `x-bot-api-key` contra `BOT_API_KEY`
2. Extrai `instanceName` do body da requisição
3. Faz `SELECT id FROM professionals WHERE wa_instance_name = $1`
4. Injeta `req.professionalId` para uso nos controllers

---

## Formato de autenticação

### JWT (frontend)
- Cookie `httpOnly` chamado `token`
- Setado pelo `POST /auth/login`
- Validado pelo middleware `requireAuth`

### Bot API (n8n)
```
Header: x-bot-api-key: <BOT_API_KEY>
Body:   { "instanceName": "chip2", ... }
```
