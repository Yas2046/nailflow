# NailFlow — Arquitetura

## Diagrama de componentes

```
                      CLIENTE (WhatsApp)
                            │
                            ▼
                   Evolution API (chip2)
                  Docker · porta 8080
                            │
                     webhook POST
                            │
                            ▼
              n8n · WhatsApp NailFlow — Definitivo
              nailflow-n8n.duckdns.org · porta 5678
                            │
                  POST /bot/process  (BOT_API_KEY)
                            │
                            ▼
               NailFlow Backend API (Express/Node)
               localhost:3333 → Nginx → /api/
                            │
              ┌─────────────┼─────────────┐
              ▼             ▼             ▼
         PostgreSQL    Evolution API   (n8n webhooks)
         porta 5432   /instance/send   nailflow/notificacoes ❌
```

```
PROFISSIONAL (browser)
        │
        ▼
 https://nailflow.duckdns.org
        │
        ├── /         → Nginx → /frontend/dist (React SPA)
        └── /api/*    → Nginx → localhost:3333 (Express)
                                      │
                                      ▼
                                 PostgreSQL
```

---

## Como os componentes se comunicam

### 1. WhatsApp → Bot (mensagem recebida)

1. Cliente envia mensagem para o número conectado ao `chip2`
2. Evolution API recebe via Baileys (protocolo nativo WA)
3. Evolution dispara webhook `POST https://nailflow-n8n.duckdns.org/webhook/whatsapp-nailflow`
4. n8n executa workflow **"WhatsApp NailFlow — Definitivo"**
5. Workflow chama `POST https://nailflow.duckdns.org/api/bot/process` com `BOT_API_KEY`
6. Backend processa estado da conversa e retorna texto de resposta
7. Workflow envia resposta via Evolution API `POST /message/sendText/{instance}`

### 2. Profissional → Painel Web

1. Profissional acessa `https://nailflow.duckdns.org`
2. React SPA carrega do `/frontend/dist`
3. Todas as chamadas de dados vão para `/api/*` (proxied pelo Nginx para porta 3333)
4. Backend autentica via JWT em cookie `httpOnly`

### 3. Bot → n8n (notificação de agendamento)

- Quando cliente confirma/cancela agendamento pelo bot, o backend chama:
  - `POST N8N_WEBHOOK_CONFIRMED_URL` (path: `nailflow/notificacoes`)
  - `POST N8N_WEBHOOK_CANCELLED_URL` (path: `nailflow/notificacoes`)
- **⚠️ PROBLEMA ATUAL:** workflow "NailFlow — Notificações" está inativo, endpoint retorna 404

### 4. n8n → Bot (lembretes e abandono)

- n8n tem workflows com Schedule Trigger (cron) que chamam:
  - `GET /api/bot/appointments-tomorrow` → lista agendamentos de amanhã
  - `POST /api/bot/mark-reminder-sent` → marca lembrete enviado
  - `GET /api/bot/abandoned-conversations` → lista conversas abandonadas
  - `POST /api/bot/mark-abandonment-notified` → marca abandono notificado

### 5. Profissional → WhatsApp (via Configurações)

- Profissional acessa Configurações → WhatsApp
- Frontend chama `GET /api/whatsapp/status`
- Se desconectado, chama `POST /api/whatsapp/connect` → recebe QR Code base64 + code
- Backend obtém QR da Evolution API e repassa ao frontend
- Frontend renderiza QR para escaneamento

---

## Multi-tenancy

O sistema suporta múltiplas profissionais. Cada profissional tem:
- `slug` — identificador URL-safe (ex: `camila-nails-studio`)
- `wa_instance_name` — nome da instância no Evolution (ex: `chip2`)
- Todos os dados isolados por `professional_id`

O bot identifica a profissional pelo campo `instanceName` enviado pelo n8n, que é o nome da instância Evolution.

---

## Autenticação

### Frontend / Profissional
- JWT assinado com `JWT_SECRET`, salvo em cookie `httpOnly`
- Middleware `requireAuth` valida em todas as rotas `/api/*` (exceto `/api/auth/*` e `/api/public/*`)
- Expiração: `JWT_EXPIRES_IN` (padrão: 7d)

### Bot (n8n → backend)
- `BOT_API_KEY` no header `x-bot-api-key`
- Middleware `requireBotAuth` resolve `professionalId` a partir do `instanceName` no body
