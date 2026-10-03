# NailFlow — Rotas e Endpoints

**Base URL produção:** `https://nailflow.duckdns.org/api` (o Nginx repassa `/api/*` para o backend, sem o prefixo `/api`)

Rotas marcadas com **JWT** exigem o cookie `nailflow_token` válido (ou `Authorization: Bearer <JWT>`).

> Lista levantada a partir de `backend/src/routes/*.routes.js` em 2026-09-25 (commit `b26d682`). Validações de 2026-09-27 (telefone, `clientId`) acrescentadas; nenhuma rota nova até então.
>
> **Atualizada em 2026-10-03** conforme o código de `main` em `50906f5`: confirmação/recusa/pagamento de agendamentos, configuração de agendamento (`/auth/booking-settings`), serviços e criação de agendamento pela página pública, bloco `aguardando` do `/dashboard` e perfil público em `/auth/me` e `/public/:slug/info`.

**Isolamento:** todas as rotas JWT operam só sobre dados do `professional_id` da sessão. Recurso de outra profissional responde como inexistente (404) ou, no caso de `clientId` em agendamentos, 400 "Cliente inválido.".

---

## Autenticação (`/auth`)

| Método | Path | Auth | Descrição |
|---|---|---|---|
| POST | `/auth/register` | ✗ | Cadastrar nova profissional (rate limit 5/h por IP) |
| POST | `/auth/login` | ✗ | Login → define o cookie JWT (rate limit 10/15 min por IP) |
| POST | `/auth/logout` | ✗ | Remove o cookie |
| GET | `/auth/me` | JWT | Dados da profissional logada |
| PUT | `/auth/me` | JWT | Atualizar perfil: identidade (`name`, `business_name`, `phone_whatsapp`, `email`) e/ou perfil público (`avatar_b64`, `bio`, `public_theme`) |
| GET | `/auth/booking-settings` | JWT | Configuração de agendamento da profissional: `confirmation_mode`, `deposit_required`, `deposit_type`, `deposit_value`, `pix_key` |
| PUT | `/auth/booking-settings` | JWT | Atualizar a configuração de agendamento (ver regras abaixo) |

**`PUT /auth/me` — perfil público** (migration 020, desde 2026-10-02): `bio` (texto aparado, máx. 280 caracteres), `public_theme` (`vinho`, `verde` ou `azul`, independente do tema do painel) e `avatar_b64` (data URL `jpeg`/`png`/`webp`, máx. 90.000 caracteres, abaixo do limite de 100 KB do corpo). Bio, tema e foto podem ser enviados **sem** os campos de identidade; quando qualquer campo de identidade é enviado, o `phone_whatsapp` é exigido. O `GET /auth/me` devolve também o `slug`.

**`PUT /auth/booking-settings`** (migration 022, desde 2026-10-02): corpo estrito (campos desconhecidos são recusados) e ao menos um campo.
- `confirmation_mode`: `manual` (padrão) ou `automatic`
- `deposit_required`: booleano; **sinal exige o modo `automatic`**
- `deposit_type`: `percentage` (valor 30, 50 ou 100) ou `fixed` (valor em centavos, de R$ 1,00 a R$ 10.000,00); tipo e valor sempre juntos
- `pix_key`: 5 a 77 caracteres entre letras, números e `@ . + _ -`, sem espaços (CPF/CNPJ, e-mail, telefone ou chave aleatória); obrigatória para ligar o sinal
- A validação final considera a configuração já salva mais o que foi enviado; erros respondem 400 com mensagem em português. O valor do sinal de cada agendamento é calculado no servidor (`deposit_cents`)

> **Não publicadas:** `POST /auth/forgot-password`, `POST /auth/reset-password` e `PUT /auth/password` existem apenas na implementação isolada em `/opt/nailflow-next`. **Não existem em produção.**

---

## Agendamentos (`/appointments`)

| Método | Path | Auth | Descrição |
|---|---|---|---|
| GET | `/appointments` | JWT | Listar agendamentos (`?from=&to=`) |
| POST | `/appointments` | JWT | Criar agendamento (valida com `checkSlotAvailability`) |
| POST | `/appointments/recurring` | JWT | Criar série recorrente |
| PUT | `/appointments/:id` | JWT | Atualizar agendamento (`status: 'confirmado'` só vale a partir de `pendente`) |
| POST | `/appointments/:id/confirm` | JWT | Confirmar solicitação: `pendente` → `confirmado` |
| POST | `/appointments/:id/reject` | JWT | Recusar solicitação: `pendente` → `cancelado` (`cancel_reason = 'rejected'`) |
| POST | `/appointments/:id/mark-paid` | JWT | Pagamento (sinal Pix) recebido: `aguardando_pagamento` → `confirmado` |
| PUT | `/appointments/:id/and-following` | JWT | Atualizar este e os seguintes da série |
| DELETE | `/appointments/:id` | JWT | Cancelamento lógico (`status = 'cancelado'`, mantém o histórico); não confere o status atual |
| DELETE | `/appointments/:id/and-following` | JWT | Cancelar/excluir este e os seguintes da série |

**Confirmar, recusar e pagamento recebido** (`appointmentsController.js`, regras de transição em `utils/appointmentStatus.js`):
- Cada ação é um `UPDATE` condicional atômico ao status de origem; as de confirmar e pagamento também exigem que a reserva não esteja vencida (`expires_at` nulo ou futuro) e zeram `expires_at`. `mark-paid` grava `paid_at`.
- Repetir a mesma ação é **idempotente**: responde 200 com `changed: false` e **não** reenvia mensagem à cliente. A resposta é o agendamento (`id`, `status`, `expiresAt`, `depositCents`, `paidAt` etc.) mais `changed`.
- Reserva vencida (ou já cancelada por expiração) → **409** com `reason: 'hold_expired'`; status de origem errado → **409** com `reason: 'invalid_transition'`; agendamento de outra profissional ou inexistente → **404**.
- Avisos pelo n8n (fire-and-forget): confirmar e pagamento recebido disparam `appointment.confirmed` só quando houve mudança real; recusar dispara `appointment.rejected` só quando a origem do agendamento (`source`) é `public` ou `bot` (agendamentos criados antes da migration 021, com `source` nulo, não avisam a cliente). Detalhes em [`N8N.md`](./N8N.md).
- `DELETE /appointments/:id` marca `cancelado` mesmo que o agendamento já esteja cancelado, expirado ou concluído e dispara `appointment.cancelled` a cada chamada (não há guarda de status; ver [`PENDENCIAS.md`](./PENDENCIAS.md)).

**Validação de `clientId`** (desde 2026-09-27, função `assertOwnClient` em `appointmentsController.js`):
- `POST /appointments`: a cliente precisa pertencer à profissional logada; senão **400 `"Cliente inválido."`** (roda depois da checagem do serviço e antes da checagem de horário)
- `PUT /appointments/:id`: mesma validação, **só quando `clientId` é enviado**; edições sem `clientId` seguem iguais
- A resposta é a mesma para ID inexistente e para ID de outra conta (não revela se a cliente existe em outro lugar). `POST /appointments/recurring` já fazia essa validação

---

## Clientes (`/clients`)

| Método | Path | Auth | Descrição |
|---|---|---|---|
| GET | `/clients` | JWT | Listar clientes (com busca e filtro por tag) |
| GET | `/clients/:id` | JWT | Detalhe e histórico de atendimentos |
| POST | `/clients` | JWT | Criar cliente |
| PUT | `/clients/:id` | JWT | Atualizar cliente |

**Telefone** (desde 2026-09-27, `utils/phone.js`):
- O telefone é normalizado antes de gravar: só dígitos; números de 10 ou 11 dígitos recebem o `55`; o 9 extra é retirado → formato `55` + DDD + 8 dígitos (o mesmo do bot). Ex.: `(31) 98888-1111` → `553188881111`
- Telefone fora desse formato → **400 `"Telefone inválido."`**
- Telefone já usado por outra cliente **da mesma profissional** (em qualquer formato, inclusive fichas antigas com 13 dígitos ou sem o `55`) → **409 `"Já existe uma cliente com este telefone."`**
- O mesmo número pode existir em profissionais diferentes
- No `PUT`, a validação só roda se o telefone mudou; fichas antigas com telefone fora do padrão podem ter nome e notas editados sem mexer no telefone. Fichas antigas não são alteradas automaticamente

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
| GET | `/availability` | JWT | Expediente semanal salvo |
| PUT | `/availability` | JWT | Salvar os 7 dias do expediente |
| GET | `/availability/horizon` | JWT | Antecedência máxima → `{ bookingHorizonDays }` |
| PUT | `/availability/horizon` | JWT | Atualizar antecedência (`bookingHorizonDays`, 7–365) |
| GET | `/availability/exceptions` | JWT | Listar fechamentos |
| POST | `/availability/exceptions` | JWT | Criar fechamento (ver corpo abaixo) |
| DELETE | `/availability/exceptions/:id` | JWT | Remover fechamento |
| GET | `/availability/slots` | JWT | Horários livres de um dia (`?date=YYYY-MM-DD&serviceId=`) |
| GET | `/availability/check` | JWT | Verificar um horário exato (`?serviceId=&startsAt=`) |
| GET | `/availability/blocked` | JWT | Listar bloqueios pontuais (`?from=&to=`) |
| POST | `/availability/blocked` | JWT | Criar bloqueio pontual |
| DELETE | `/availability/blocked/:id` | JWT | Remover bloqueio pontual |

Corpo de `POST /availability/exceptions` (campo `label` opcional em todos):

```json
{ "exceptionType": "specific_date",    "specificDate": "2026-10-15" }
{ "exceptionType": "weekday_of_month", "weekday": 6, "weekOfMonth": 3 }
{ "exceptionType": "date_range",       "dateFrom": "2026-10-12", "dateTo": "2026-10-18" }
```

`weekday`: 0 (domingo) a 6 (sábado). `weekOfMonth`: 1–5 ou `-1` (última ocorrência).

---

## Onboarding (`/onboarding`)

| Método | Path | Auth | Descrição |
|---|---|---|---|
| GET | `/onboarding/status` | JWT | Estado das etapas; admin recebe 403 |

Resposta: `{ perfil, servicos, horarios, whatsapp, clientes, concluidos, total: 4 }` — `concluidos` conta só as 4 obrigatórias; `clientes` é opcional.

---

## Dashboard (`/dashboard`)

| Método | Path | Auth | Descrição |
|---|---|---|---|
| GET | `/dashboard` | JWT | KPIs: agendamentos do dia, próximo atendimento, faturamento, gastos e o bloco `aguardando` |

**Bloco `aguardando`** (desde `3bcbb1a`, 2026-10-03; alimenta o card "Precisa da sua ação" da Início): `{ confirmacao, pagamento, proximoVencimento, itens }`.
- Conta só reservas da profissional logada em `pendente` (`confirmacao`) ou `aguardando_pagamento` (`pagamento`) que **têm validade em curso** (`expires_at` futuro) e ainda não terminaram (`ends_at` futuro). Reservas vencidas ainda não varridas, agendamentos `pendente` criados na Agenda (sem `expires_at`) e confirmados não entram.
- `itens`: até 5 reservas, as de vencimento mais próximo primeiro (`id`, `clientName`, `serviceName`, `startsAt`, `status`, `expiresAt`); `proximoVencimento` é o `expiresAt` da primeira, ou `null`. A consulta lê no máximo 200 reservas.

---

## Gastos (`/expenses`)

| Método | Path | Auth | Descrição |
|---|---|---|---|
| GET | `/expenses/summary` | JWT | Resumo de gastos por período |
| GET | `/expenses` | JWT | Listar gastos |
| POST | `/expenses` | JWT | Criar gasto |
| PUT | `/expenses/:id` | JWT | Atualizar gasto |
| DELETE | `/expenses/:id` | JWT | Excluir gasto |

---

## WhatsApp (`/whatsapp`)

| Método | Path | Auth | Descrição |
|---|---|---|---|
| GET | `/whatsapp/status` | JWT | Status real da instância da profissional (consulta a Evolution) |
| POST | `/whatsapp/connect` | JWT | Solicitar QR para conectar (rate limit 10/5min por profissional) |
| GET | `/whatsapp/instance` | JWT | Instância configurada |
| POST | `/whatsapp/evolution-instance` | JWT | Criar instância na Evolution |
| DELETE | `/whatsapp/evolution-instance` | JWT | Remover instância da Evolution |

> `PUT /whatsapp/instance` e `DELETE /whatsapp/instance` foram **removidos** (2026-09-28): permitiam vincular/desvincular `wa_instance_name` sem sincronizar com a Evolution (uma profissional podia assumir a instância de outra, ou deixar uma instância órfã e ativa). A única forma de configurar/remover instância agora é `/evolution-instance`.

---

## Admin (`/admin`)

| Método | Path | Auth | Descrição |
|---|---|---|---|
| GET | `/admin/professionals` | JWT + `is_admin` | Listar profissionais (sem `password_hash` e `avatar_b64`) |
| PUT | `/admin/professionals/:id` | JWT + `is_admin` | Editar `name`/`business_name`/`phone_whatsapp`/`email`/`avatar_b64` (mesmo schema de `PUT /auth/me`, e-mail único); não permite editar a própria conta; não altera `slug`/`wa_instance_name`/`is_admin`/`blocked_at`/`token_version`/senha (2026-09-29) |
| POST | `/admin/professionals/:id/block` | JWT + `is_admin` | Bloqueia (`blocked_at = now()`); não permite bloquear a própria conta (2026-09-29) |
| POST | `/admin/professionals/:id/unblock` | JWT + `is_admin` | Desbloqueia e incrementa `token_version` (invalida tokens emitidos antes do desbloqueio, exige novo login) (2026-09-29) |
| GET | `/admin/professionals/:id/delete-preview` | JWT + `is_admin` | Contagens (clientes, agendamentos, serviços, recorrências, mensagens, despesas) antes de excluir (2026-09-29) |
| DELETE | `/admin/professionals/:id` | JWT + `is_admin` | Exclusão definitiva: snapshot em disco → exclui instância na Evolution se houver (aborta sem tocar no banco se falhar) → `DELETE` em transação (cascade apaga tudo que pertence à profissional). Exige digitar o `business_name` exato no corpo (`businessNameConfirmation`); não permite excluir a própria conta nem a última conta admin (2026-09-29) |

Middleware `requireAdmin`: valida o JWT e confere `is_admin` no banco; não admin → 403. Desde 2026-09-29 também expõe `req.actorEmail` (usado pelo audit log).

Toda ação de sucesso em `block`/`unblock`/`update`/`delete` grava 1 linha em `admin_audit_log` (`actor_id`, `actor_email`, `action`, `target_id`, `target_business_name`, `created_at`) — ver [`BANCO_DE_DADOS.md`](./BANCO_DE_DADOS.md). Falhas/tentativas não são registradas nesta primeira versão.

---

## Página Pública (`/public`)

| Método | Path | Auth | Descrição |
|---|---|---|---|
| GET | `/public/:slug/info` | ✗ | Perfil público: só `businessName`, `whatsappLink`, `bio`, `theme` (`vinho`/`verde`/`azul`) e `photo` (rate limit 60/5min por IP) |
| GET | `/public/:slug/availability` | ✗ | Dias com horários livres (`?days=N&serviceId=<uuid>`; `days` limitado por `booking_horizon_days`, `serviceId` opcional — com ele a grade usa a duração real do serviço; rate limit 60/5min por IP) |
| GET | `/public/:slug/services` | ✗ | Serviços ativos e marcados como disponíveis no WhatsApp (`id`, `name`, `priceCents`, `durationMinutes`, ordenados por nome); isolado pelo `slug` (rate limit 60/5min por IP) |
| POST | `/public/:slug/appointments` | ✗ | Cria um agendamento da cliente (ver abaixo) |

Página no frontend: `https://nailflow.duckdns.org/p/:slug`. A página pede `availability?days=6` (mostra só os próximos dias, 4 no estado de 2026-10-03), escolhe o serviço antes do horário e, ao tocar num horário, rola até o formulário de dados.

**`POST /public/:slug/appointments`:**
- Corpo: `serviceId`, `startsAt`, `clientName`, `clientPhone` e `notes` (opcional). `professional_id` vem só do `slug`; `status`, `clientId` e `professionalId` enviados no corpo são ignorados. O telefone é validado e normalizado antes dos limites por telefone (inválido → 400).
- **Status inicial conforme a configuração da profissional** (`utils/bookingRules.js`): `manual` → `pendente`, validade de **24 h**; `automatic` sem sinal → `confirmado`; `automatic` com sinal → `aguardando_pagamento`, validade de **2 h**, com `deposit_cents` calculado no servidor. O agendamento nasce com `source = 'public'`.
- Resposta **201**: `id`, `startsAt`, `endsAt`, `serviceName`, `status`, `expiresAt` e, **só** em `aguardando_pagamento`, o bloco `deposit` (`amountCents`, `pixKey`, `expiresAt`) — é o único momento em que a chave Pix é revelada. Nenhum telefone ou configuração da profissional é devolvido.
- Erros: 400 (dados/telefone inválidos), 404 (slug ou serviço), **409** horário indisponível (`reason`; a corrida entre duas clientes é protegida pela constraint de exclusão do banco) ou `reason: 'max_future_appointments'` (máx. **3** reservas futuras ativas por telefone e profissional), 429 (rate limit).
- **Rate limits:** 5 requisições/10 min por IP **e** 3/10 min por `slug` + telefone normalizado.
- **Avisos pelo n8n depois do `COMMIT`** (nunca atrasam nem desfazem a resposta; detalhes em [`N8N.md`](./N8N.md)): `message.send` à cliente (`appointment_requested` em `pendente`, `payment_instructions` em `aguardando_pagamento`), `appointment.confirmed` em `confirmado` e `appointment.public_created` à profissional — este **só quando ela tem `wa_instance_name`**, com o telefone normalizado para `55` + número no ponto de envio.

---

## Bot (`/bot`) — chamado pelo n8n

Autenticação: `Authorization: Bearer <BOT_API_KEY>` + nome da instância em `instance` ou `waInstance` (body) ou `?instance=` (query). O nome da instância é a chave de roteamento para a profissional.

| Método | Path | Auth | Descrição |
|---|---|---|---|
| GET | `/bot/instances` | BOT_KEY | Listar profissionais e suas instâncias (loop dos crons) |
| POST | `/bot/process` | BOT_KEY + instance | Processar mensagem recebida |
| POST | `/bot/record-sent` | BOT_KEY + instance | Registrar mensagem enviada no histórico |
| GET | `/bot/conversation/:phone` | BOT_KEY + instance | Obter estado da conversa |
| POST | `/bot/conversation/:phone` | BOT_KEY + instance | Forçar estado da conversa |
| GET | `/bot/abandoned-conversations` | BOT_KEY + instance | Listar conversas abandonadas (cron) |
| POST | `/bot/mark-abandonment-notified` | BOT_KEY + instance | Marcar abandono como notificado |
| GET | `/bot/appointments-tomorrow` | BOT_KEY + instance | Agendamentos de amanhã para lembrete |
| POST | `/bot/mark-reminder-sent` | BOT_KEY + instance | Marcar lembrete como enviado |

### Como o backend resolve o `professionalId`

Middleware `requireBotAuth` (`src/middleware/botAuth.js`):
1. Valida o Bearer contra `BOT_API_KEY`
2. Lê `instance` / `waInstance` do body ou `instance` da query
3. `SELECT id FROM professionals WHERE wa_instance_name = $1` (instância desconhecida → 404)
4. `instance` ausente → 400 ("Campo instance obrigatório"). **A instância é sempre obrigatória: não existe fallback** para "profissional única" (esse fallback atribuía dados à conta errada assim que uma 2ª profissional era cadastrada e foi removido em 2026-09-28); profissional bloqueada → 403
5. Injeta `req.professionalId` para os controllers

---

## Outras

| Método | Path | Auth | Descrição |
|---|---|---|---|
| GET | `/health` | ✗ | Healthcheck do backend |
