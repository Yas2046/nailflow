# NailFlow — Arquitetura

## Diagrama de componentes

```
                      CLIENTE (WhatsApp)
                            │
                            ▼
                Evolution API (chip2, chip2-teste…)
                Docker · 127.0.0.1:8080
                            │
   webhook POST (HTTPS, via Nginx :443) + header X-NailFlow-Webhook-Secret
                            │
                            ▼
              n8n · WhatsApp NailFlow — Definitivo
              nailflow-n8n.duckdns.org → Nginx → localhost:5678
                            │
          POST http://localhost:3333/bot/process  (Bearer BOT_API_KEY)
                            │
                            ▼
               NailFlow Backend API (Express/Node)
               localhost:3333  (público apenas via Nginx /api/)
                            │
              ┌─────────────┼──────────────────┐
              ▼             ▼                  ▼
         PostgreSQL    Evolution API       n8n webhook
         localhost     (status / QR)       nailflow/notificacoes
                                           (+ header X-NailFlow-Webhook-Secret)
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

As portas 3333 (backend) e 5678 (n8n) estão **bloqueadas externamente pelo UFW**; o acesso de fora passa sempre pelo Nginx (443). Ver [`INFRAESTRUTURA.md`](./INFRAESTRUTURA.md).

---

## Como os componentes se comunicam

### 1. WhatsApp → Bot (mensagem recebida)

1. Cliente envia mensagem para o número conectado à instância (ex.: `chip2`)
2. Evolution API recebe via Baileys (protocolo nativo WA)
3. Evolution dispara webhook `POST https://nailflow-n8n.duckdns.org/webhook/whatsapp-nailflow` com o cabeçalho `X-NailFlow-Webhook-Secret` (valor de `N8N_BOT_WEBHOOK_SECRET`); sem o cabeçalho correto, o n8n recusa com 403 e o workflow não executa
4. n8n executa o workflow **"WhatsApp NailFlow — Definitivo"**
5. Workflow chama `POST http://localhost:3333/bot/process` com `Authorization: Bearer <BOT_API_KEY>` e o nome da instância (`instance` / `waInstance`)
6. Backend identifica a profissional pela instância, processa o estado da conversa e retorna o texto de resposta
7. Workflow envia a resposta via Evolution (`https://nailflow-evolution.duckdns.org/message/sendText/{instance}`)
8. Workflow registra a mensagem enviada em `POST /bot/record-sent`

### 2. Profissional → Painel Web

1. Profissional acessa `https://nailflow.duckdns.org`
2. React SPA carrega do `/frontend/dist`
3. Chamadas de dados vão para `/api/*` (proxy do Nginx para a porta 3333)
4. Backend autentica via JWT no cookie `httpOnly` `nailflow_token`

### 3. Backend → n8n (notificação de agendamento)

- Ao confirmar/cancelar agendamento, o backend chama `N8N_WEBHOOK_CONFIRMED_URL` / `N8N_WEBHOOK_CANCELLED_URL` (path `nailflow/notificacoes`) com o cabeçalho `X-NailFlow-Webhook-Secret` (valor de `N8N_NOTIFY_SECRET`, enviado por `utils/notifyN8n.js`)
- O workflow **"NailFlow — Notificações"** está ativo e com o webhook registrado; a mensagem é enviada pela instância da profissional (`waInstance` no payload)

### 4. n8n → Backend (crons de lembretes e abandono)

- Workflows com Schedule Trigger chamam `http://localhost:3333` / `http://127.0.0.1:3333`:
  - `GET /bot/instances` → lista profissionais e instâncias (loop multi-profissional)
  - `GET /bot/appointments-tomorrow` / `POST /bot/mark-reminder-sent`
  - `GET /bot/abandoned-conversations` / `POST /bot/mark-abandonment-notified`
- Os dois crons percorrem as instâncias em loop (uma chamada por instância, com `?instance=`). **Falharam de 2026-09-21 a 2026-09-27** e foram corrigidos em 2026-09-27 — ver [`N8N.md`](./N8N.md)

### 5. Profissional → WhatsApp (via Configurações)

- Configurações → WhatsApp: criar instância Evolution, gerar QR, consultar status
- Frontend chama `/api/whatsapp/*`; o backend conversa com a Evolution usando `EVOLUTION_API_URL` e `EVOLUTION_API_KEY`
- Ao criar a instância, o backend já configura o webhook com `N8N_BOT_WEBHOOK_URL` e o cabeçalho `X-NailFlow-Webhook-Secret`; sem `N8N_BOT_WEBHOOK_SECRET` configurado, a criação falha
- O QR é renderizado no frontend via canvas a partir do campo `code`

---

## Regras de disponibilidade (centralizadas no backend)

Toda a regra de horários livres fica em `backend/src/utils/availability.js`. Agenda, página pública e bot usam a mesma lógica — nada é recalculado no frontend nem no n8n.

- **`getAvailableSlots(professionalId, data, duração)`** — slots de 30 em 30 minutos, considerando, nesta ordem:
  1. expediente do dia da semana (`weekly_availability`); sem linha salva ou `is_working = false` → dia sem horários
  2. **fechamentos** (`recurring_exceptions`, função `isRecurringException`) → dia inteiro fechado
  3. intervalo de almoço, bloqueios pontuais (`blocked_times`) e agendamentos ativos
- **`checkSlotAvailability(...)`** — valida um horário exato; usado na criação e edição de agendamentos (`appointmentsController`), que por isso também respeita os fechamentos
- Datas e horários civis são interpretados em `America/Sao_Paulo` (`utils/timezone.js`)

### Antecedência máxima (`booking_horizon_days`)

Configuração por profissional (7 a 365 dias, padrão 60), definida em Configurações → Disponibilidade.

| Consumidor | Como aplica |
|---|---|
| Página pública (`publicController`) | Consulta `min(dias pedidos, booking_horizon_days)` a partir de hoje |
| Bot (`getAvailableDaysWithSlots`) | Varre de amanhã até `booking_horizon_days`, parando ao encontrar 5 dias com horários |
| Agenda interna (`Agenda.tsx`) | Lê `GET /availability/horizon`; não permite avançar além de hoje + N dias |

### Fechamentos (`recurring_exceptions`)

| Tipo | Exemplo | Regra |
|---|---|---|
| `specific_date` | 15/10/2026 | fecha aquela data |
| `weekday_of_month` | 3º sábado | fecha a N-ésima ocorrência do dia da semana no mês (`-1` = última) |
| `date_range` | 12/10 a 18/10 | fecha todos os dias do intervalo, inclusive as pontas |

---

## Agenda interna

- Visualizações **dia, semana e mês**
- O botão de avançar fica desabilitado quando o próximo passo ultrapassaria hoje + `booking_horizon_days`; a barra mostra "Agenda aberta até …"
- Dias além do limite ficam esmaecidos e não clicáveis (semana/mês); na visão de dia aparece um aviso e os botões "Agendar"/"Bloquear" somem
- Navegação para datas passadas não é limitada

---

## Onboarding ("Primeiros passos")

- Card no topo da tela Início (`components/OnboardingChecklist.tsx`), alimentado por `GET /onboarding/status`
- **4 etapas obrigatórias** (entram no progresso "X de 4"):
  | Etapa | Critério |
  |---|---|
  | Perfil | `phone_whatsapp` preenchido |
  | Serviços | ≥ 1 serviço ativo |
  | Horários | ≥ 1 dia com `is_working = true` salvo em `weekly_availability` |
  | WhatsApp | instância com conexão real `open` na Evolution (consulta somente leitura, timeout de 5 s) |
- **Clientes** aparece separado como **opcional** (≥ 1 cliente) e não conta no progresso
- O card some quando as 4 obrigatórias estão concluídas; "Ocultar por enquanto" grava no `localStorage` (por profissional e por navegador)
- Links diretos: `/configuracoes?tab=perfil`, `/servicos`, `/configuracoes?tab=disponibilidade`, `/configuracoes?tab=whatsapp`, `/clientes`
- Não bloqueia nenhuma funcionalidade; o admin não recebe o onboarding (endpoint responde 403)

---

## Multi-tenancy

Cada profissional tem:
- `slug` — identificador URL-safe da página pública (ex.: `camila-nails-studio`)
- `wa_instance_name` — nome da instância na Evolution (ex.: `chip2`)
- Todos os dados isolados por `professional_id`

- **Uma instância Evolution por profissional**; o nome da instância (`waInstance`) é a **chave de roteamento**: o bot identifica a profissional pelo nome enviado pelo n8n (`instance` ou `waInstance`), e as notificações saem pela instância da profissional (`waInstance` no payload)
- Os crons percorrem `GET /bot/instances` para atender todas as profissionais
- As rotas do painel filtram tudo por `professional_id` do JWT. Desde 2026-09-27, criar/editar agendamento com `clientId` de outra profissional é recusado (400 "Cliente inválido.") — ver [`ROTAS_E_ENDPOINTS.md`](./ROTAS_E_ENDPOINTS.md)

---

## Área administrativa

- Conta marcada com `professionals.is_admin = true` (não há tela para promover admin; a marcação é feita no banco)
- Login pelo mesmo formulário; ao entrar, o admin é levado ao `/admin`, com layout próprio (`AdminLayout`: cabeçalho + sair, **sem** a navegação da profissional). Uma profissional comum que acesse `/admin` é redirecionada
- `GET /admin/professionals` (middleware `requireAdmin`: JWT válido + `is_admin` conferido no banco) lista as profissionais **sem** `password_hash` nem `avatar_b64`
- O admin não acessa nem altera dados operacionais (agendamentos, clientes, serviços, gastos) de outras profissionais

---

## Autenticação

### Frontend / Profissional
- JWT assinado com `JWT_SECRET`, salvo no cookie `httpOnly` `nailflow_token` (`SameSite=Lax`)
- Middleware `requireAuth` protege as rotas autenticadas (tudo exceto `/auth/login`, `/auth/register`, `/auth/logout`, `/public/*` e as rotas `/bot/*`, que têm autenticação própria)
- Expiração: `JWT_EXPIRES_IN` (padrão: 7d)
- Rate limit: login 10/15 min por IP; cadastro 5/h por IP

### Bot (n8n → backend)
- Header `Authorization: Bearer <BOT_API_KEY>`
- Middleware `requireBotAuth` resolve `professionalId` a partir de `instance`/`waInstance` (body) ou `?instance=` (query); `GET /bot/instances` usa só a chave

### Webhooks do n8n (Evolution → n8n e backend → n8n)
- Desde 2026-09-27, os dois webhooks ativos (`whatsapp-nailflow` e `nailflow/notificacoes`) exigem o cabeçalho `X-NailFlow-Webhook-Secret`, validado por credenciais **Header Auth** do n8n
- Segredos: `N8N_BOT_WEBHOOK_SECRET` (Evolution → n8n) e `N8N_NOTIFY_SECRET` (backend → n8n), guardados só no `backend/.env` e nas credenciais do n8n (e no `headers` do webhook da Evolution). **Os valores nunca vão para o Git nem para a documentação**

## Bot: respostas sim/não

`utils/replyClassifier.js` (`classifyReply`) decide as respostas de confirmação de agendamento, confirmação de cancelamento e oferta de repetir o último serviço. Só a primeira palavra inteira decide; respostas ambíguas pedem de novo. Detalhes em [`FLUXOS_DO_BOT.md`](./FLUXOS_DO_BOT.md).

## Telefones

`utils/phone.js` concentra a regra de telefone usada pelo bot e pelo cadastro de clientes do painel — ver [`ROTAS_E_ENDPOINTS.md`](./ROTAS_E_ENDPOINTS.md).
