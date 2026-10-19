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
| blocked_at | timestamptz | nullable — conta bloqueada (checado a cada requisição autenticada; migration 016) |
| token_version | integer | NOT NULL, default `1` — invalidação de sessões (o JWT carrega a versão; sobe no desbloqueio; migration 016) |
| bio | varchar(280) | nullable — apresentação exibida na página pública (migration 020) |
| public_theme | varchar(20) | NOT NULL, default `'vinho'`; CHECK `professionals_public_theme_check`: `vinho` / `verde` / `azul` — cor da página pública, independente do tema do painel (migration 020) |
| confirmation_mode | varchar(10) | NOT NULL, default `'manual'`; CHECK: `manual` / `automatic` (migration 022) |
| deposit_required | boolean | NOT NULL, default `false` — cobra sinal (migration 022) |
| deposit_type | VARCHAR(10) | nullable — `percentage` / `fixed` (migration 022) |
| deposit_value | integer | nullable — percentual (30/50/100) ou valor fixo em centavos (migration 022) |
| pix_key | varchar(77) | nullable — chave Pix informada à cliente nas instruções de sinal; **não é exposta** em nenhuma rota pública, só na resposta da reserva com sinal e na mensagem (migration 022) |

CHECK `professionals_deposit_check` (migration 022): só valida a coerência de `deposit_type`/`deposit_value` — ambos nulos, ou `percentage` com valor de 1 a 100, ou `fixed` com valor maior que 0. O CHECK **não** exige `pix_key`; a exigência de chave Pix, o limite de percentuais (30/50/100) e a proibição de sinal no modo `manual` estão na API (`PUT /auth/booking-settings`).
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
| available_on_whatsapp | boolean | NOT NULL, default `true` — se `false`, o serviço continua na Agenda mas não é oferecido pelo bot nem pela página pública (migration 018) |
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
| status | varchar(20) | pendente (exibido como "Aguardando confirmação") / aguardando_pagamento / confirmado / cancelado / concluido / nao_compareceu |
| notes | text | nullable |
| cancel_reason | varchar(20) | nullable — `rejected` (recusa pela profissional), `expired` (reserva vencida); migration 021 |
| source | varchar(10) | nullable — `public` / `bot` (CHECK); nulo = painel/legado; só `public`/`bot` avisam a cliente na recusa; migration 021 |
| expires_at | timestamptz | nullable — fim da reserva temporária (24 h em `pendente`, 2 h em `aguardando_pagamento`); nulo ao confirmar; índice `idx_appointments_expires_at`; migration 022 |
| deposit_cents | integer | nullable — sinal calculado no servidor (percentual arredondado ao centavo; valor fixo limitado ao preço); migration 022 |
| paid_at | timestamptz | nullable — quando a profissional marcou "Pagamento recebido"; migration 022 |
| price_cents_snapshot | integer | preço no momento do agendamento |
| reminder_sent | boolean | default false — lembrete 24h enviado? |
| recurring_group_id | uuid | nullable — FK → recurring_groups |
| created_at / updated_at | timestamptz | |

**Constraint importante:** exclusão por `gist` evita sobreposição de horários para a mesma profissional (ignora status 'cancelado').

**Reservas temporárias (migration 022):** uma reserva vencida e ainda não varrida continuaria ocupando a constraint; por isso o backend roda `expireDueHolds` antes de criar/alterar agendamentos, a disponibilidade ignora holds vencidos (`expiredHoldSql`) e um sweeper (`startHoldSweeper`, a cada 60 s, `FOR UPDATE SKIP LOCKED`) cancela as vencidas com `cancel_reason='expired'`. Expirar **não** envia mensagem à cliente.

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

### `admin_audit_log` (migration 019)

Histórico das ações administrativas **concluídas** (`block`, `unblock`, `update`, `delete`), gravado por `logAdminAction()` (`backend/src/utils/auditLog.js`) só depois do sucesso da ação. Consultado pela tela `/admin/auditoria` (`GET /admin/audit-log`, somente leitura; a Auditoria v1 de 2026-10-03 **não criou migration**).

| Coluna | Tipo | Observação |
|---|---|---|
| id | uuid | PK |
| actor_id | uuid | admin que executou; **sem FK** (o registro sobrevive à exclusão da conta) |
| actor_email | varchar(160) | denormalizado de propósito |
| action | varchar(20) | CHECK: `block`, `unblock`, `update`, `delete` |
| target_id | uuid | profissional afetada; **sem FK** |
| target_business_name | varchar(120) | denormalizado de propósito |
| created_at | timestamptz | data/hora da ação |

Índices: PK, `idx_admin_audit_log_actor`, `idx_admin_audit_log_target`. **Não são armazenados:** valores antes/depois, motivo, IP, nome do administrador (só o e-mail) e tentativas com falha. A imutabilidade é só da API (não há rota de escrita); não há trigger/permissão no banco.

**Limpeza de 2026-10-03:** os 104 registros existentes eram todos de testes antigos (admins `admin_block_test@`, `admin_delete_test@` e `admin_edit_test@nailflow.com`; nenhum de admin real) e foram apagados após backup (`/var/backups/nailflow/manual/admin_audit_log_pre-cleanup_20261003-233014.{csv,sql}`, fora do Git, modo 600). Desde então, todo registro é de ação administrativa real.

### Financeiro — estrutura base (migration 025)

**Etapa 1 do Financeiro: só estrutura e auditoria; nenhuma rota, tela ou indicador usa isto ainda.** A migration é aditiva e idempotente e **não altera nenhuma linha existente**: atendimentos, sinais Pix e despesas antigos **não** viram "realizados", "recebidos" ou "pagos". `expense_date` **não** é prova de pagamento.

| Objeto | Resumo |
|---|---|
| `appointments` (+5 colunas, todas `NULL`) | `checked_in_at` (chegada, **não** é pagamento), `final_price_cents` + `final_price_set_at` (derivado pelo banco), `finance_review` (`realizado`, `nao_compareceu`, `cancelado`, `sem_movimentacao`) + `finance_reviewed_at`. `UNIQUE (id, professional_id)` como alvo da FK composta |
| `expenses` (+4 colunas) | `payment_status` (`a_revisar` padrão, `pendente`, `paga`), `due_on`, `paid_on`, `paid_method`. `paga` exige `paid_on`; os outros estados exigem `paid_on` e `paid_method` nulos |
| `financial_payments` | Recebimentos e **estornos** por atendimento (`kind`), valor, forma (`pix`, `dinheiro`, `cartao_debito`, `cartao_credito`, `outra`; **+ `transferencia` com a 026**), `occurred_on`, `source` (`manual` ou `sinal_pix_confirmado`), `reverses_payment_id`, `idempotency_key` + `request_hash`. **Append-only** |
| `financial_audit_log` | Histórico: entidade, ação, autor opcional, motivo, `before_data`/`after_data`, `seq` estável. **Append-only** |
| `cash_closings` | Um registro por profissional e dia (`fechado`/`aberto`), totais congelados, `reopen_count`, `reopen_reason` |

Regras garantidas pelo banco (testadas em `backend/tests/financeiro-migrations.test.js`):

* **Isolamento:** `professional_id NOT NULL` com `ON DELETE CASCADE` em todas as tabelas novas; pagamento → atendimento e estorno → recebimento são **FKs compostas** com `professional_id`. A FK para `appointments` é `DEFERRABLE INITIALLY DEFERRED` e **sem cascata**: apagar um atendimento com pagamento é recusado, e a exclusão da conta (que apaga os dois) funciona.
* **Append-only:** `UPDATE` nunca; `DELETE` só na exclusão em cascata da conta. A role da aplicação também não recebe `UPDATE`/`DELETE`/`TRUNCATE` nessas duas tabelas (`_ops/025_grant_app_role.sql`).
* **Estorno:** linha nova, mesmo atendimento, data não anterior, motivo obrigatório; a soma dos estornos nunca passa do recebimento (serializado por advisory lock). Só recebimento pode ser estornado.
* **Pagamento parcial:** vários recebimentos por atendimento. O banco **não** compara com o valor final (regra da API).
* **Sinal Pix antigo:** `deposit_cents` e `paid_at` não são lidos nem copiados. Confirmar um sinal é um recebimento explícito (`source = 'sinal_pix_confirmado'`), **no máximo um por atendimento**, limitado ao sinal registrado.
* **Idempotência:** `(professional_id, idempotency_key)` único (índice parcial) com `request_hash` obrigatório junto; a API deve usar `ON CONFLICT (professional_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING` (alvo explícito).
* **Dia fechado:** recusa recebimento/estorno com `occurred_on` no dia e despesa paga com `paid_on` no dia. Reabrir exige motivo novo, incrementa `reopen_count` e fica no histórico; fechado só reabre, aberto só fecha, e fechamentos não se apagam.
* **Correções com motivo:** alterar valor final, check-in, revisão ou uma despesa paga exige `set_config('nailflow.audit_reason', '...', true)` na mesma transação (autor opcional em `nailflow.actor_id`).
* **Histórico automático** (triggers): pagamentos, fechamentos, despesas (criar, alterar, mudar de estado, apagar) e as colunas novas de `appointments`. Não grava nada ao apagar a conta.

Limites conhecidos (a API das próximas etapas deve cobrir): recebido ≤ valor final, datas no futuro, apagar despesa `paga`, e o cálculo dos totais do fechamento.

**Segurança das funções:** os triggers de histórico, o guarda de pagamentos e a consulta do fechamento são `SECURITY DEFINER` (rodam como o dono, para o fluxo atual de Gastos e Agenda não quebrar se os grants ainda não foram aplicados), com `search_path = pg_catalog, pg_temp` e todos os objetos qualificados (`public.*`): uma role com `CREATE` em `public` (caso de `nailflow`) não consegue interceptar chamadas criando funções ali. `fin_audit()` e `fin_day_is_closed()` não têm `EXECUTE` para o público.

**Exclusão da profissional:** `adminController.js` inclui as três tabelas no snapshot e no preview (`financialPayments`, `financialAuditEntries`, `cashClosings`) e confere, com a conta travada (`FOR UPDATE`), que nada financeiro foi gravado depois do snapshot (409 sem apagar nada). Sem a 025 o comportamento é o de sempre. O snapshot é uma rede de segurança de **30 dias** e **não** é o arquivo financeiro; os dados já arquivados por um rollback **não** são apagados pela exclusão da conta e não entram nesse snapshot (ver [`FINANCEIRO_ETAPA1.md`](./FINANCEIRO_ETAPA1.md), "Exclusão da conta × arquivo").

Rollback, restauração e retenção: [`FINANCEIRO_ETAPA1.md`](./FINANCEIRO_ETAPA1.md) e [`_rollback/README.md`](../backend/db/migrations/_rollback/README.md) (**arquiva antes de remover**, com manifesto de hashes).

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
psql $DATABASE_URL -f backend/db/migrations/015_unique_wa_instance_name.sql
psql $DATABASE_URL -f backend/db/migrations/016_professional_blocking.sql
psql $DATABASE_URL -f backend/db/migrations/017_cross_tenant_foreign_keys.sql
psql $DATABASE_URL -f backend/db/migrations/018_service_available_on_whatsapp.sql
psql $DATABASE_URL -f backend/db/migrations/019_admin_audit_log.sql
psql $DATABASE_URL -f backend/db/migrations/020_public_profile.sql
psql $DATABASE_URL -f backend/db/migrations/021_appointment_cancel_reason_source.sql
psql $DATABASE_URL -f backend/db/migrations/022_confirmation_modes_and_holds.sql
psql $DATABASE_URL -f backend/db/migrations/023_support_center.sql                    # Central de Suporte (ainda nao publicada)
psql $DATABASE_URL -f backend/db/migrations/024_audit_actions_support.sql
```

**023/024 e a role da aplicação.** A 023 não tem `GRANT`. Em produção as migrations rodam como `postgres` (dono de `professionals`) e a aplicação conecta como `nailflow`; sem o `GRANT` as tabelas de suporte ficam inacessíveis (`permission denied`). Depois da 023, aplicar `backend/db/migrations/_ops/023_grant_app_role.sql` com `-v app_role=<role da aplicação>` (ver `docs/SUPORTE_PUBLICACAO.md`). Em bancos onde a própria role da aplicação aplica a 023 (bancos descartáveis dos testes) não é necessário.

A lista acima reproduz a ordem usada para montar um banco novo (e os bancos descartáveis dos testes); em produção cada migration foi aplicada uma vez, manualmente, e as de 020 a 022 sempre depois de um backup (`/var/backups/nailflow/nailflow_pre-migration-02N_*.dump`). O seed (`backend/db/seed.sql`) vem depois de todas.

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
| 015 | Índice único parcial em `professionals.wa_instance_name` |
| 016 | `professionals.blocked_at`, `professionals.token_version` (bloqueio/revogação de sessão) |
| 017 | Foreign keys compostas `(id, professional_id)` cross-tenant (`appointments`→`clients`/`services`/`recurring_groups`, `message_history`→`clients`) |
| 018 | `services.available_on_whatsapp BOOLEAN NOT NULL DEFAULT true` |
| 019 | Tabela `admin_audit_log` (audit log de ações administrativas — ver [`ROTAS_E_ENDPOINTS.md`](./ROTAS_E_ENDPOINTS.md)); sem FK obrigatória para `professionals` (o registro precisa sobreviver à exclusão do ator ou do alvo) |
| 020 | Colunas `professionals.bio` (VARCHAR 280, apresentação da página pública) e `professionals.public_theme` (VARCHAR 20, padrão `vinho`, CHECK em `vinho`/`verde`/`azul`, independente do tema do painel). Aplicada em produção em 2026-10-02 (backup `nailflow_pre-migration-020_2026-10-02_191104.dump`) |
| 021 | `appointments.cancel_reason` (VARCHAR 20) e `appointments.source` (VARCHAR 10, CHECK `public`/`bot` ou nulo). Aplicada em produção em 2026-10-02 (backup `nailflow_pre-migration-021_2026-10-02_210443.dump`) |
| 022 | `022_confirmation_modes_and_holds.sql` — `professionals.confirmation_mode`, `deposit_required`, `deposit_type`, `deposit_value`, `pix_key` e CHECK `professionals_deposit_check`; `appointments.expires_at`, `deposit_cents`, `paid_at` e índice `idx_appointments_expires_at`; status ganha `aguardando_pagamento`. Aplicada em produção em 2026-10-02 (commit `cb07d38`) após backup `/var/backups/nailflow/nailflow_pre-migration-022_2026-10-02_222934.dump` |
| 023 | `023_support_center.sql` — Central de Suporte: `support_faq_categories` (6 categorias fixas), `support_faq_articles`, `support_tickets`, `support_messages`, `support_ticket_events` (mensagens e eventos imutáveis, contador de atividade por solicitação, cursores de leitura), 5 funções de gatilho e `professionals.support_fab_hidden`. Rollback destrutivo em `db/migrations/_rollback/` |
| 024 | `024_audit_actions_support.sql` — amplia o CHECK de `admin_audit_log.action` com `faq_create`, `faq_update`, `faq_publish`, `faq_unpublish`, `support_status` e `support_priority`. Rollback aborta se já houver auditoria com essas ações |
| 025 | `025_financeiro_base.sql` — estrutura do Financeiro (etapa 1): `financial_payments`, `financial_audit_log`, `cash_closings`, colunas novas em `appointments` (check-in, valor final, revisão) e `expenses` (estado de pagamento), triggers de histórico e guardas. **Não altera linhas existentes.** Permissões: `_ops/025_grant_app_role.sql`. Rollback: `_rollback/025_financeiro_base.down.sql` (arquiva antes de remover, com manifesto de hashes). Restauração: `_ops/025_restore_from_archive.sql`. Detalhes: [`FINANCEIRO_ETAPA1.md`](./FINANCEIRO_ETAPA1.md). **Não aplicada em produção.** |
| 026 | `026_financeiro_pagamentos_metodo.sql` — acrescenta `transferencia` a `financial_payments_method_check` (amplia a lista da 025; compatível). Rollback: `_rollback/026_financeiro_pagamentos_metodo.down.sql` (aborta se houver movimentação por transferência). Detalhes: [`FINANCEIRO_ETAPA2.md`](./FINANCEIRO_ETAPA2.md). **Não aplicada em produção.** |
| 027 | `027_financeiro_limites_banco.sql` — dois gatilhos novos: teto de recebimento (`trg_financial_payments_cap`) e piso do valor do atendimento (`trg_appointments_fin_value_floor`), ambos `SECURITY DEFINER`, serializados pelo mesmo advisory lock da API. Rollback: `_rollback/027_financeiro_limites_banco.down.sql` (só remove os gatilhos). Detalhes: [`FINANCEIRO_ETAPA3.md`](./FINANCEIRO_ETAPA3.md). **Não aplicada em produção.** |
| 028 | `028_financeiro_despesas.sql` — tabela `expense_payments` (pagamentos parciais de despesa, append-only por gatilho e privilégio), `UNIQUE (id, professional_id)` em `expenses`, quatro gatilhos (guarda, quitação, histórico, piso do valor) e duas listas de `financial_audit_log` ampliadas. Rollback: `_rollback/028_financeiro_despesas.down.sql` (aborta se houver pagamento de despesa). Grants: `_ops/028_grant_app_role.sql`. Detalhes: [`FINANCEIRO_ETAPA4.md`](./FINANCEIRO_ETAPA4.md). **Não aplicada em produção.** |
| 029 | `029_financeiro_fechamento_caixa.sql` — tabela `cash_closing_entries` (esperado/contado/diferença/justificativa por método e por fechamento, append-only), `UNIQUE (id, professional_id)` em `cash_closings` e `fin_day_is_closed` com lock compartilhado do dia. Rollback: `_rollback/029_financeiro_fechamento_caixa.down.sql` (aborta se houver fechamento por método). Grants: `_ops/029_grant_app_role.sql`. Detalhes: [`FINANCEIRO_ETAPA5.md`](./FINANCEIRO_ETAPA5.md). **Não aplicada em produção.** |

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
