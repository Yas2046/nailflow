# NailFlow — Banco de Dados

## Conexão

- **Motor:** PostgreSQL 16
- **Host:** localhost (VPS)
- **Porta:** 5432
- **Banco:** nailflow
- **Usuário:** postgres
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
| created_at / updated_at | timestamptz | automático |

---

### `clients`
Clientes de cada profissional. Identificadas pelo telefone.

| Coluna | Tipo | Obs |
|---|---|---|
| id | uuid | PK |
| professional_id | uuid | FK → professionals |
| name | varchar(120) | |
| phone | varchar(20) | UNIQUE por professional |
| notes | text | nullable |
| tags | text[] | default '{}' |
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

### `conversation_states`
Estado atual do bot para cada cliente de cada profissional.

| Coluna | Tipo | Obs |
|---|---|---|
| professional_id | uuid | PK composta |
| phone | text | PK composta |
| mode | text | BOT_ATIVO / ATENDIMENTO_HUMANO |
| bot_state | varchar(50) | INICIO / MENU / AGUARDANDO_* |
| context | jsonb | dados temporários (ex: serviço escolhido) |
| last_message_at | timestamptz | última mensagem recebida |
| created_at / updated_at | timestamptz | |

---

### `message_history`
Histórico de mensagens trocadas via WhatsApp.

| Coluna | Tipo | Obs |
|---|---|---|
| id | bigint | PK autoincrement |
| professional_id | uuid | FK |
| client_id | uuid | nullable FK → clients |
| phone | text | |
| wa_message_id | text | ID único do WhatsApp (dedup) |
| direction | text | inbound / outbound |
| content | text | conteúdo da mensagem |
| sender | varchar(20) | client / bot / professional |
| created_at | timestamptz | |

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

Ordem de aplicação:

```bash
psql $DATABASE_URL -f backend/db/schema.sql                             # schema base
psql $DATABASE_URL -f backend/migrations/002_bot_tables.sql             # tabelas do bot
psql $DATABASE_URL -f backend/db/migrations/001_add_price_cents_snapshot.sql
psql $DATABASE_URL -f backend/db/migrations/003_recurring_appointments.sql
psql $DATABASE_URL -f backend/db/migrations/004_reminder_sent.sql
psql $DATABASE_URL -f backend/db/migrations/005_slug_wa_instance.sql
psql $DATABASE_URL -f backend/db/migrations/006_phone_whatsapp_nullable.sql
```

**Nota:** as migrations 001 e 003+ já estão aplicadas no banco de produção. Aplicar apenas em bancos novos.

---

## Seed

```bash
psql $DATABASE_URL -f backend/db/seed.sql
```

Cria dados de exemplo para desenvolvimento.

---

## Acesso direto (VPS)

```bash
psql "$(grep DATABASE_URL /var/www/nailflow/backend/.env | cut -d= -f2-)"
# ou
sudo -u postgres psql nailflow
```
