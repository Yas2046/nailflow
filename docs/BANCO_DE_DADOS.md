# NailFlow — Banco de Dados

## Conexão

- **Motor:** PostgreSQL 16
- **Host:** localhost (VPS)
- **Porta:** 5432
- **Banco:** nailflow
- **Usuário da aplicação:** role `nailflow` (definido em `DATABASE_URL`); tarefas administrativas com `postgres`
- **Variável de ambiente:** `DATABASE_URL`

> Não há PostgreSQL na máquina local de desenvolvimento. O banco roda exclusivamente no VPS.
> Para dev local, usar o `docker-compose.yml` na raiz do projeto.

---

## Tabelas

### `professionals`
Profissionais cadastradas no sistema. Cada profissional é um tenant isolado.

| Coluna | Tipo | Obs |
|---|---|---|
| id | uuid | PK |
| name | varchar(120) | nome da profissional |
| email | varchar(160) | UNIQUE |
| password_hash | text | bcrypt |
| phone_whatsapp | varchar(20) | nullable |
| business_name | varchar(120) | default 'NailFlow' |
| slug | varchar(80) | UNIQUE, URL da página pública |
| wa_instance_name | varchar(80) | nullable, nome da instância Evolution |
| avatar_b64 | text | nullable, foto de perfil em base64 (migration 013) |
| is_admin | boolean | NOT NULL, default `false` — conta de administração (migration 010) |
| booking_horizon_days | smallint | NOT NULL, default `60` — antecedência máxima da agenda em dias; a API aceita 7 a 365 (migration 007) |
| created_at / updated_at | timestamptz | automático |

---

### `clients`
Clientes de cada profissional. Identificadas pelo telefone.

| Coluna | Tipo | Obs |
|---|---|---|
| id | uuid | PK |
| professional_id | uuid | FK → professionals |
| name | varchar(120) | |
| phone | varchar(20) | UNIQUE por professional; o painel grava normalizado (`55` + DDD + número) — ver [`ROTAS_E_ENDPOINTS.md`](./ROTAS_E_ENDPOINTS.md) |
| notes | text | nullable |
| tags | text[] | NOT NULL, default `'{}'` — etiquetas do CRM (migration 012) |
| created_at / updated_at | timestamptz | |

---

### `services`
Serviços oferecidos por cada profissional.

| Coluna | Tipo | Obs |
|---|---|---|
| id | uuid | PK |
| professional_id | uuid | FK → professionals |
| name | varchar(120) | |
| description | text | nullable |
| price_cents | integer | em centavos (ex: 8000 = R$80,00) |
| duration_minutes | integer | |
| active | boolean | default true |
| created_at / updated_at | timestamptz | |

---

### `appointments`
Agendamentos.

| Coluna | Tipo | Obs |
|---|---|---|
| id | uuid | PK |
| professional_id | uuid | FK → professionals |
| client_id | uuid | FK → clients |
| service_id | uuid | FK → services |
| starts_at | timestamptz | |
| ends_at | timestamptz | |
| status | varchar(20) | pendente / confirmado / cancelado / concluido / nao_compareceu |
| notes | text | nullable |
| price_cents_snapshot | integer | preço no momento do agendamento |
| reminder_sent | boolean | default false — lembrete 24h enviado? |
| recurring_group_id | uuid | nullable — FK → recurring_groups |
| created_at / updated_at | timestamptz | |

**Constraint importante:** exclusão por `gist` evita sobreposição de horários para a mesma profissional (ignora status 'cancelado').

---

### `weekly_availability`
Horário de trabalho semanal de cada profissional.

| Coluna | Tipo | Obs |
|---|---|---|
| id | uuid | PK |
| professional_id | uuid | FK |
| weekday | smallint | 0=Dom, 1=Seg, ..., 6=Sab |
| is_working | boolean | |
| start_time | time | nullable se is_working=false |
| end_time | time | nullable se is_working=false |
| break_start | time | nullable |
| break_end | time | nullable |

**Regra de horário salvo:** um dia sem linha nesta tabela é tratado como folga — sem nenhuma linha salva, a página pública e o bot não oferecem horários. A tela Disponibilidade mostra um preenchimento sugerido (Seg–Sáb, 08h–18h) com o aviso "Estes horários são apenas uma sugestão. Clique em Salvar para abrir sua agenda." até existir pelo menos 1 dia com `is_working = true` salvo.

---

### `blocked_times`
Bloqueios manuais de horário.

| Coluna | Tipo | Obs |
|---|---|---|
| id | uuid | PK |
| professional_id | uuid | FK |
| starts_at | timestamptz | |
| ends_at | timestamptz | |
| reason | varchar(160) | nullable |
| created_at | timestamptz | |

---

### `recurring_exceptions`
Fechamentos da agenda (dia inteiro fechado). Avaliados em `utils/availability.js` (`isRecurringException`) e respeitados pela Agenda, página pública, bot e criação de agendamentos. Migrations 008 e 009.

| Coluna | Tipo | Obs |
|---|---|---|
| id | uuid | PK, `gen_random_uuid()` |
| professional_id | uuid | NOT NULL, FK → professionals `ON DELETE CASCADE` |
| exception_type | varchar(20) | NOT NULL — `specific_date` / `weekday_of_month` / `date_range` |
| specific_date | date | usado por `specific_date` |
| weekday | smallint | 0–6, usado por `weekday_of_month` |
| week_of_month | smallint | 1–5 ou `-1` (última), nunca 0; usado por `weekday_of_month` |
| date_from | date | início do período (inclusive), usado por `date_range` |
| date_to | date | fim do período (inclusive); a API garante `date_to >= date_from` |
| label | varchar(100) | nullable, etiqueta opcional |
| created_at | timestamptz | NOT NULL, `now()` |

Restrições: `recurring_exceptions_exception_type_check`, `recurring_exceptions_weekday_check`, `recurring_exceptions_week_of_month_check`, `recurring_exceptions_professional_id_fkey`.
Índice: `idx_recurring_exceptions_professional (professional_id)`.

---

### `conversation_states`
Estado atual do bot para cada cliente de cada profissional. Criada pela migration 002 (`002_evolution_api_tables.sql`); `bot_state`, `context` e `last_message_at` vêm da 011.

| Coluna | Tipo | Obs |
|---|---|---|
| professional_id | uuid | NOT NULL, PK composta, FK → professionals `ON DELETE CASCADE` |
| phone | text | NOT NULL, PK composta |
| mode | text | NOT NULL, default `'BOT_ATIVO'`; CHECK `conversation_states_mode_check`: BOT_ATIVO / ATENDIMENTO_HUMANO |
| bot_state | varchar(50) | nullable, default `'INICIO'` — INICIO / MENU / AGUARDANDO_* |
| context | jsonb | nullable, default `'{}'` — dados temporários (ex: serviço escolhido) |
| last_message_at | timestamptz | nullable, default `now()` — última mensagem recebida |
| created_at / updated_at | timestamptz | NOT NULL, default `now()` |

- **PK:** `(professional_id, phone)` — não há coluna `id` nem UNIQUE separado
- **Índice:** `idx_conv_states_professional (professional_id)` (redundante com a PK; mantido como está em produção)
- **Trigger:** `trg_conversation_states_updated` (BEFORE UPDATE) → função `update_updated_at_column()`

---

### `message_history`
Histórico de mensagens trocadas via WhatsApp. Criada pela migration 002; `sender` vem da 011.

| Coluna | Tipo | Obs |
|---|---|---|
| id | bigint | PK, sequência `message_history_id_seq` (BIGSERIAL) |
| professional_id | uuid | NOT NULL, FK → professionals `ON DELETE CASCADE` |
| client_id | uuid | nullable, FK → clients `ON DELETE SET NULL` — **não usado pelo código** (ver nota) |
| phone | text | NOT NULL |
| wa_message_id | text | nullable, ID do WhatsApp (deduplicação) |
| direction | text | NOT NULL; CHECK: `inbound` / `outbound` |
| content | text | conteúdo da mensagem |
| sender | varchar(20) | NOT NULL, default `'client'`; CHECK `message_history_sender_check`: client / bot / professional |
| created_at | timestamptz | NOT NULL, default `now()` |

- **Índices únicos parciais** `(professional_id, wa_message_id) WHERE wa_message_id IS NOT NULL`:
  - `idx_message_history_wa_id` — criado pela migration 002
  - `message_history_dedup_idx` — **existe só em produção**, com a mesma definição (duplicado). A remoção foi deixada deliberadamente para uma etapa futura; as migrations não o recriam
- **`client_id`:** o código do bot não grava essa coluna (0 de 2.042 linhas preenchidas na auditoria de 2026-09-27). Mantida como está em produção; fica para o futuro decidir se passa a ser usada ou se é removida

---

### `expenses`
Gastos da profissional (tela Gastos e Dashboard). Veio com a V1 sem migration; versionada na migration 014.

| Coluna | Tipo | Obs |
|---|---|---|
| id | uuid | PK, `gen_random_uuid()` |
| professional_id | uuid | NOT NULL, FK → professionals `ON DELETE CASCADE` |
| description | varchar(200) | NOT NULL |
| category | varchar(80) | NOT NULL, default `'Outros'` |
| amount_cents | integer | NOT NULL; CHECK `expenses_amount_cents_check`: `> 0` |
| expense_date | date | NOT NULL |
| notes | text | nullable |
| created_at / updated_at | timestamptz | NOT NULL, default `now()` |

- **Índice:** `idx_expenses_professional (professional_id, expense_date DESC)`
- **Trigger:** `trg_expenses_updated` (BEFORE UPDATE) → `set_updated_at()` (função criada em `schema.sql`)

---

### `recurring_groups`
Grupos de agendamentos recorrentes.

| Coluna | Tipo | Obs |
|---|---|---|
| id | uuid | PK |
| professional_id | uuid | FK |
| frequency | varchar(20) | weekly / biweekly |
| ends_on | date | data de término |
| created_at | timestamptz | |

---

## Migrations

Não há executor de migrations: a ordem abaixo é aplicada manualmente com `psql`, com o dono do banco (ou superusuário).

Ordem oficial de aplicação (a 002 vem antes da 001):

```bash
psql $DATABASE_URL -f backend/db/schema.sql                                  # schema base
psql $DATABASE_URL -f backend/db/migrations/002_evolution_api_tables.sql     # tabelas do bot
psql $DATABASE_URL -f backend/db/migrations/001_add_price_cents_snapshot.sql
psql $DATABASE_URL -f backend/db/migrations/003_recurring_appointments.sql
psql $DATABASE_URL -f backend/db/migrations/004_reminder_sent.sql
psql $DATABASE_URL -f backend/db/migrations/005_slug_wa_instance.sql
psql $DATABASE_URL -f backend/db/migrations/006_phone_whatsapp_nullable.sql
psql $DATABASE_URL -f backend/db/migrations/007_booking_horizon_days.sql
psql $DATABASE_URL -f backend/db/migrations/008_recurring_exceptions.sql
psql $DATABASE_URL -f backend/db/migrations/009_recurring_exceptions_date_range.sql
psql $DATABASE_URL -f backend/db/migrations/010_is_admin.sql
psql $DATABASE_URL -f backend/db/migrations/011_conversation_bot_columns.sql
psql $DATABASE_URL -f backend/db/migrations/012_clients_tags.sql
psql $DATABASE_URL -f backend/db/migrations/013_professionals_avatar.sql
psql $DATABASE_URL -f backend/db/migrations/014_expenses.sql
```

| Migration | Conteúdo |
|---|---|
| 002 | `002_evolution_api_tables.sql` — **migration oficial das tabelas do bot**: `conversation_states` (PK composta, CHECK de `mode`, trigger + função `update_updated_at_column()`) e `message_history` (id bigint, `direction` inbound/outbound, `client_id`, índice único `idx_message_history_wa_id`). Recuperada do commit `985c1f1`, origem das tabelas de produção |
| 007 | `professionals.booking_horizon_days SMALLINT NOT NULL DEFAULT 60` |
| 008 | Tabela `recurring_exceptions` (tipos `specific_date` e `weekday_of_month`), FK, CHECKs e índice |
| 009 | Colunas `date_from` / `date_to` e tipo `date_range` na restrição de `exception_type` |
| 010 | `professionals.is_admin BOOLEAN NOT NULL DEFAULT false` |
| 011 | `conversation_states.bot_state`, `context`, `last_message_at` e `message_history.sender` (com `message_history_sender_check`) |
| 012 | `clients.tags TEXT[] NOT NULL DEFAULT '{}'` |
| 013 | `professionals.avatar_b64 TEXT` |
| 014 | Tabela `expenses` (PK, FK, CHECK, índice e trigger `trg_expenses_updated`) |

### Migration obsoleta: `002_bot_tables.sql`

- O antigo `backend/migrations/002_bot_tables.sql` foi movido para `backend/db/migrations/_historico/002_bot_tables.sql`, com um `README.md` explicando
- **Obsoleta — não executar.** Criava `conversation_states` com `id uuid` + UNIQUE e `message_history` com `id uuid`, `direction IN ('in','out')` e `message_type`, o que não corresponde a produção nem ao código (o código grava `inbound`/`outbound`)
- Até 2026-09-27 ela constava nesta ordem de instalação. Uma instalação nova feita assim não gravava mensagens do bot e não tinha `expenses`, `clients.tags` nem `professionals.avatar_b64` — corrigido com a 002 oficial e as migrations 011–014

**Notas:**
- Todas as estruturas já existem no banco de produção. As migrations servem para bancos novos; **não foram executadas em produção**.
- **007–014 são retroativas**: as estruturas foram criadas em produção diretamente e versionadas depois (007–010 no commit `b26d682`; 002 restaurada e 011–014 criadas em 2026-09-27, ainda sem commit). São idempotentes (`IF NOT EXISTS` ou blocos `DO` que consultam o catálogo antes).
- Validação de 2026-09-27 em bancos descartáveis, já removidos: ver [`TESTES_REALIZADOS.md`](./TESTES_REALIZADOS.md), Teste 12. Diferenças restantes em relação a produção: o índice duplicado `message_history_dedup_idx` e 6 comentários (1 só em produção, em `appointments.reminder_sent`; 5 das migrations 007–009 que produção nunca recebeu).
- Em produção foi necessário `GRANT CREATE ON SCHEMA public` ao role `nailflow` para criar `recurring_exceptions`; num banco novo cujo dono é `nailflow`, isso não é necessário.
- A migration de recuperação de senha **não existe no repositório** (implementação não publicada).

---

## Seed

```bash
psql $DATABASE_URL -f backend/db/seed.sql
```

Cria dados de exemplo para desenvolvimento.

- Compatível com o schema atual (`schema.sql` + migrations 002, 001, 003–014): aplicar **depois** das migrations. Validado em 2026-09-27 em dois bancos descartáveis
- Conta de exemplo: `camila@nailflow.com` / `senha123`, slug `camila-nails-studio`, com 5 serviços, expediente semanal e 3 clientes fictícias. Usada pelo teste de login da suíte
- Correção de 2026-09-27: o seed não informava `professionals.slug` (obrigatório desde a migration 005) e falhava

---

## Acesso direto (VPS)

```bash
psql "$(grep DATABASE_URL /var/www/nailflow/backend/.env | cut -d= -f2-)"
# ou
sudo -u postgres psql nailflow
```
