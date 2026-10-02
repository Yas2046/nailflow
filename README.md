# NailFlow

Sistema privado de agendamento e automação de atendimento via WhatsApp para profissional autônoma de nail design.

O sistema permite que clientes agendem, confirmem e cancelem horários diretamente pelo WhatsApp, enquanto a profissional gerencia tudo por um painel web completo.

---

## Funcionalidades

### Painel web (profissional)
- **Dashboard** — KPIs do dia e do mês: faturamento realizado, previsto e perdido; agendamentos concluídos/cancelados; novos clientes; top 5 serviços; gráfico de faturamento dos últimos 6 meses
- **Agenda** — visualização diária, semanal e mensal; criação e edição de agendamentos; bloqueio de horários; suporte a agendamentos recorrentes (semanal e quinzenal)
- **Clientes** — listagem com busca, histórico de atendimentos, avatar com inicial
- **Serviços** — cadastro de serviços com preço e duração
- **Disponibilidade** — configuração de horários de trabalho por dia da semana com intervalo de almoço
- **Perfil** — edição de nome, nome do negócio, WhatsApp e e-mail

### Automação WhatsApp (via n8n + Evolution API)
- Recepção de mensagens pelo WhatsApp Business
- Agendamento guiado por bot conversacional
- Confirmação e cancelamento automático
- Lembretes de agendamento
- Modo profissional (pausa o bot para atendimento humano)

---

## Stack

| Camada | Tecnologia |
|---|---|
| **Backend API** | Node.js 20, Express 5, ESM (`"type":"module"`), PM2 |
| **Banco de dados** | PostgreSQL 16 |
| **Frontend** | React 18, TypeScript, Vite, Tailwind CSS v3 |
| **Automação** | n8n Community Edition |
| **WhatsApp gateway** | Evolution API v2.3.7 |
| **Servidor** | VPS com Nginx + HTTPS (Let's Encrypt) |

---

## Estrutura do projeto

```
nailflow/
├── backend/
│   ├── db/
│   │   ├── migrations/       # Migrations SQL (001, 003…)
│   │   ├── schema.sql         # Schema completo
│   │   └── seed.sql           # Dados iniciais
│   ├── src/
│   │   ├── config/            # Configuração do banco
│   │   ├── controllers/       # Lógica de negócio
│   │   ├── middleware/        # Auth, error handler, bot auth
│   │   ├── routes/            # Roteamento Express
│   │   └── utils/             # Disponibilidade, timezone, notificações
│   ├── tests/                 # Testes de integração
│   └── .env.example           # Referência de variáveis de ambiente
├── frontend/
│   ├── src/
│   │   ├── components/        # AppointmentModal, BlockTimeModal, Layout
│   │   ├── context/           # AuthContext (sessão da profissional)
│   │   ├── pages/             # Dashboard, Agenda, Clientes, Servicos,
│   │   │                      # Disponibilidade, Perfil, Login, PaginaPublica
│   │   ├── services/          # api.ts (fetch wrapper)
│   │   └── types.ts           # Tipos compartilhados
│   └── .env.example           # Referência de variáveis de ambiente
├── n8n/
│   ├── workflows/             # Workflows n8n exportados (importar na instância)
│   └── README.md              # Instruções de configuração do n8n
├── backend/migrations/        # Migrations adicionais (bot tables)
└── docker-compose.yml         # Postgres + n8n para desenvolvimento local
```

---

## Como executar localmente

### Pré-requisitos
- Node.js 20+
- PostgreSQL 16
- (Opcional) Docker + Docker Compose

### 1. Banco de dados

```bash
# Com Docker:
docker-compose up -d postgres

# Ou crie manualmente o banco e aplique o schema:
psql -U postgres -c "CREATE DATABASE nailflow;"
psql -U postgres -d nailflow -f backend/db/schema.sql
```

### 2. Backend

```bash
cd backend
cp .env.example .env        # edite com suas credenciais
npm install
npm run dev                 # porta 3333
```

### 3. Frontend

```bash
cd frontend
cp .env.example .env        # ajuste VITE_API_URL se necessário
npm install
npm run dev                 # porta 5173
```

### 4. Migrations adicionais (opcional — funcionalidades de recorrência e bot)

```bash
psql $DATABASE_URL -f backend/db/migrations/001_add_price_cents_snapshot.sql
psql $DATABASE_URL -f backend/migrations/002_bot_tables.sql
psql $DATABASE_URL -f backend/db/migrations/003_recurring_appointments.sql
```

---

## Variáveis de ambiente

### Backend (`backend/.env`)

| Variável | Descrição |
|---|---|
| `PORT` | Porta da API (padrão: 3333) |
| `DATABASE_URL` | String de conexão PostgreSQL |
| `JWT_SECRET` | Segredo para assinar tokens JWT |
| `JWT_EXPIRES_IN` | Validade do token (ex.: `7d`) |
| `FRONTEND_URL` | URL do frontend (CORS) |
| `API_URL` | URL pública da API |
| `WHATSAPP_TOKEN` | Token da WhatsApp Business Platform |
| `WHATSAPP_PHONE_ID` | Phone Number ID (Meta) |
| `WHATSAPP_VERIFY_TOKEN` | Token de verificação do webhook |
| `N8N_WEBHOOK_URL` | URL do webhook n8n para notificações |

> Consulte `backend/.env.example` para a lista completa e comentários.

### Frontend (`frontend/.env`)

| Variável | Descrição |
|---|---|
| `VITE_API_URL` | URL base da API backend |

> Consulte `frontend/.env.example`.

---

## Workflows n8n

Os arquivos em `n8n/workflows/` são exportações prontas para importar na instância n8n.

| Arquivo | Finalidade |
|---|---|
| `1-novo-agendamento.json` | Fluxo de agendamento via WhatsApp |
| `2-consulta-horarios.json` | Consulta de horários disponíveis |
| `3-confirmacao.json` | Confirmação de agendamento |
| `4-lembrete.json` | Lembrete automático |
| `5-cancelamento.json` | Cancelamento pelo cliente |
| `whatsapp_nailflow_definitivo.json` | Workflow unificado definitivo |

Consulte `n8n/README.md` para instruções detalhadas de configuração.

---

## Testes

```bash
cd backend
npm test
```

Os testes cobrem: health check, fluxo de autenticação, disponibilidade de horários, snapshot de preço, rate limiting.

---

## Licença

Projeto privado. Todos os direitos reservados.
