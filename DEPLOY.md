# NailFlow — Guia de Deploy e Sincronização

## Fonte oficial do código

O repositório oficial é **`https://github.com/Yas2046/nailflow`** (branch `main`).

O código-fonte de referência para qualquer modificação ou deploy é sempre o que está
no GitHub. Nunca use o `src/` do VPS como fonte — ele pode estar desatualizado.

---

## Problema ocorrido em 16/09/2026 (e como evitar)

### O que aconteceu

O `dist/` no VPS havia sido gerado localmente (máquina da Yasmin) e copiado diretamente
para `/var/www/nailflow/frontend/dist/` sem atualizar o `src/` no VPS. Isso criou uma
divergência:

| Local | Conteúdo |
|---|---|
| VPS `/var/www/nailflow/frontend/src/` | versão antiga (sem Layout com ícones, sem Perfil, sem Dashboard V2) |
| VPS `/var/www/nailflow/frontend/dist/` | versão nova compilada localmente |

Quando um novo build foi feito a partir do `src/` desatualizado, o frontend voltou para
a versão antiga (bundle caiu de 262 KB para 205 KB, perdendo Perfil, Dashboard V2,
Layout com ícones etc.).

### Solução aplicada

1. Identificado o `dist` correto em `dist.bak_20260916-pre-whatsapp/` (262 KB).
2. Localizado o `src/` correto em `nailflow (2)/nailflow (2)/nailflow/frontend/src/`
   na máquina local.
3. Arquivos corretos copiados para o VPS via `scp`.
4. Novas funcionalidades (Configurações → WhatsApp) mescladas sobre o src restaurado.
5. Build realizado a partir do src correto → bundle 265 KB.
6. Tudo commitado no GitHub e VPS atualizado.

---

## Como fazer deploy corretamente

### Pré-requisito: nunca editar arquivos direto no VPS `src/`

Edições devem ser feitas localmente, testadas e depois o deploy segue este fluxo:

```
Editar local → commit no Git → push GitHub → deploy no VPS
```

### Fluxo de deploy completo

```bash
# 1. Na máquina local: build do frontend
cd frontend
npm run build

# 2. Enviar src e dist ao VPS
scp -r src/ root@77.237.242.192:/var/www/nailflow/frontend/src/
scp -r dist/ root@77.237.242.192:/var/www/nailflow/frontend/dist/

# 3. Enviar backend atualizado (se houve mudanças)
scp -r backend/src/ root@77.237.242.192:/var/www/nailflow/backend/src/

# 4. Reiniciar backend no VPS
ssh root@77.237.242.192 "pm2 restart 0 --update-env"

# 5. Commit e push no GitHub
git add -A
git commit -m "feat/fix: descrição"
git push origin main
```

### Alternativa: build no VPS (recomendado para garantir consistência)

```bash
# 1. Na máquina local: enviar apenas o src
scp -r frontend/src/ root@77.237.242.192:/var/www/nailflow/frontend/src/
scp -r backend/src/ root@77.237.242.192:/var/www/nailflow/backend/src/

# 2. No VPS: build
ssh root@77.237.242.192 "cd /var/www/nailflow/frontend && npm run build"

# 3. Reiniciar backend
ssh root@77.237.242.192 "pm2 restart 0 --update-env"
```

---

## Multi-tenancy — Fases validadas (17/09/2026)

Todas as fases abaixo foram implementadas, testadas com 2 profissionais simultâneas
(Camila Souza / Studio Beta) e validadas em isolamento completo antes de serem
consolidadas no `main`.

### Isolamento multi-tenant

O mecanismo central é **JWT → `professional_id`**: ao fazer login, o token JWT inclui
`sub = professional.id`. O middleware `requireAuth` extrai `req.professionalId` de cada
request. Todas as queries de dados privados filtram por esse campo, garantindo que
profissional A nunca veja dados de profissional B.

Todas as tabelas têm `professional_id UUID NOT NULL REFERENCES professionals(id) ON DELETE CASCADE`.

### Fase 0 — Filtros `professional_id` (commit `3857908`)

- Todas as queries de `botController.js` e `clientsController.js` filtradas por `professional_id`
- Migrations: `004_reminder_sent.sql` (campo `reminder_sent` em `appointments`)
- Rotas cron do bot adicionadas ao `bot.routes.js`

### Fase 1 — `slug` e `wa_instance_name` (commit `e7b8773`)

- Colunas `slug VARCHAR(80) NOT NULL UNIQUE` e `wa_instance_name VARCHAR(80)` adicionadas em `professionals`
- Indexes em ambas as colunas
- Migration: `005_slug_wa_instance.sql`

### Fase 3 — Página pública por slug (commit `6ddfb54`)

- `GET /p/:slug` → `publicController.getBySlug` retorna dados da profissional dada pelo slug
- Rota legada `/agenda-publica` mantida para compatibilidade
- Frontend: `PaginaPublica.tsx` atualizado para usar o slug da URL
- `App.tsx`: rota `/p/:slug` adicionada

### Fase 4 — Bot multi-profissional (commit `29f58f8`)

- `botAuth.js`: lookup de `wa_instance_name` no banco para identificar a profissional
  que recebe a mensagem → `req.professionalId` derivado do número da instância Evolution
- `whatsappController.js`: queries de status e QR isoladas por `professionalId`
- Bot responde exclusivamente com dados da profissional dona da instância ativa

### Fase 4.1 — Cron workflows multi-profissional (commit `0e4405e`)

- `botController.js`: funções `getAbandonedConversations`, `markAbandonmentNotified`,
  `getAppointmentsTomorrow`, `markReminderSent` agora retornam dados agrupados por profissional
- `bot.routes.js`: endpoints cron expostos para o n8n
  - `GET /bot/abandoned-conversations`
  - `POST /bot/mark-abandonment-notified`
  - `GET /bot/appointments-tomorrow`
  - `POST /bot/mark-reminder-sent`
- Workflows n8n: `WB-lembretes.json`, `WC-confirmacao.json`, `WD-cancelamento.json`

### Fase 5 — Cadastro de profissionais (commit `e123e70`)

- `POST /auth/register`: campos `email`, `password`, `businessName`, `slug`
  - Validação zod, unicidade de email e slug (409), bcrypt 10 rounds, rate limit 5/h por IP
  - `wa_instance_name` inicia como `NULL` — sem Evolution na criação
- `phone_whatsapp` agora nullable na tabela `professionals`
  - Migration: `006_phone_whatsapp_nullable.sql`
  - `publicController.js`: null-safe `whatsappLink` (ternário)
- Frontend:
  - `Register.tsx`: slug auto-sugerido a partir do nome do negócio (slugify), editável
  - `Login.tsx`: link "Criar conta" → `/register`
  - `App.tsx`: rota `/register` adicionada

### Teste de isolamento validado (17/09/2026)

| Teste | Resultado |
|-------|-----------|
| Registro de P2 via UI | OK |
| Login de P2 (sidebar "Studio Beta") | OK |
| Serviços P2: P1 invisível | OK |
| Clientes P2: P1 invisível | OK |
| Agenda P2: dropdowns somente P2 | OK |
| Dashboard P2: KPIs isolados | OK |
| Página pública `/p/studio-beta` | OK |
| Integridade P1 (10c / 5s / 30a inalterados) | OK |
| Cross-contaminação no banco: 0 registros | OK |
| `wa_instance_name` de P2 = NULL | OK |
| Limpeza CASCADE sem órfãos | OK |

**Conclusão: isolamento 100% validado. Fase 2 (WhatsApp para novas profissionais) permanece pendente.**

---

## Fase 2 — WhatsApp para novas profissionais (PENDENTE)

Esta fase está **bloqueada** e não foi incluída na consolidação de `main`.

O que está pendente:
- Fluxo de onboarding para conectar a instância Evolution de uma nova profissional
- QR Code individualizado por profissional no `Configurações`
- Associação de `wa_instance_name` via `PATCH /auth/me` ou endpoint específico
- Testes de Evolution dinâmico com 2 instâncias simultâneas

**Não reconectar `chip2` nem criar nova instância Evolution sem autorização explícita.**

---

## Estado em produção (17/09/2026)

### Commit de referência (VPS — ainda em `main` pré-multi-tenancy)

```
072aa70  feat(whatsapp): conexão via QR Code na tela Configurações
```

> O VPS ainda roda a versão pré-multi-tenancy. As fases 0–5 estão em
> `integrate/all-phases` local e foram testadas em isolamento. O deploy
> para produção será feito após aprovação do `main` consolidado.

### Commit de referência (branch de integração local)

```
56d7467  merge: fase 5 — cadastro de novas profissionais e isolamento validado
```

### Frontend (dist no VPS)

| Bundle | Tamanho |
|---|---|
| `index-Brh_NMra.js` | 260 KB |
| `index-Y72aXm50.css` | 29 KB |

### Funcionalidades ativas (VPS atual)

- Painel (Dashboard V2): faturamento realizado/previsto/perdido, variação % vs mês
  anterior, top 5 serviços, gráfico de 6 meses
- Agenda: DayView / WeekView / MonthView com agendamentos recorrentes
- Clientes: busca, histórico de atendimentos
- Serviços: CRUD
- Disponibilidade: toggle por dia da semana
- Perfil: página da profissional
- Configurações → WhatsApp: status da conexão (chip2), número conectado, nome do perfil

### Funcionalidades validadas localmente (prontas para deploy)

- Isolamento multi-tenant completo (todas as queries filtradas por `professional_id`)
- Página pública por slug (`/p/:slug`)
- Bot roteado por `wa_instance_name`
- Crons multi-profissional (lembretes, abandono)
- Cadastro de novas profissionais (`/register`)

### Backend (PM2 id 0, porta 3333)

Endpoints ativos:
- `GET /whatsapp/status` — status da instância Evolution API (requireAuth)
- `POST /appointments/recurring` — agendamentos recorrentes
- Todos os endpoints bot (`/bot/*`) com TTL e normalização de telefone

### n8n (PM2 id 4, porta 5678)

- Workflow Lembretes 24h (`crVRWCDoVzCEWSgz`): ativo, cron a cada 30 min
- Workflow Abandono de Conversa (`rQ7S8XcAiiTCgXEr`): ativo, cron a cada 15 min
- Workflow WhatsApp Definitivo (`3yBtUtgMlKsXh3mw`): ativo, webhook MESSAGES_UPSERT
  - Nó "Processar no NailFlow": retry configurado (5 tentativas, 3s de intervalo)

---

## Aviso importante: `pm2 restart` causa janela de indisponibilidade

O comando `pm2 restart 0` reinicia o backend Node.js com ~10 segundos de downtime.
Nesse intervalo, mensagens chegadas via WhatsApp resultam em `ECONNREFUSED` no n8n.

**Mitigações aplicadas:**
- O nó "Processar no NailFlow" agora possui retry automático:
  5 tentativas com 3 segundos de intervalo (cobre até 12s de downtime).
- O botController (`/bot/process`) tem deduplicação por `waMessageId`:
  se o retry reprocessar uma mensagem já gravada, retorna `{reason:'duplicate'}`
  sem enviar resposta duplicada ao cliente.

**Alternativa com menor downtime:**
```bash
pm2 reload 0   # graceful reload — aguarda requisições em andamento antes de reiniciar
```

---

## Backups criados em 16–17/09/2026

| Arquivo | Conteúdo |
|---|---|
| `/root/backup_whatsapp_feature_20260916-213804.tar.gz` | src antes da implementação WhatsApp |
| `/root/backup_broken_state_20260916.tar.gz` | src do estado quebrado (build do src antigo) |
| `/var/www/nailflow/frontend/dist.bak_20260916-pre-whatsapp/` | dist correto pré-implementação |
| `/var/www/nailflow/frontend/dist.bak_20260915-etapa2-login/` | dist de 15/09 |
| `/var/www/nailflow/frontend/dist.bak_20260915-pre-fix-cancel/` | dist antes do fix-cancel |
| `/root/backup_workflow_3yBtUtgMlKsXh3mw_20260917.json` | workflow n8n antes do retry (17/09) |

---

## Pendências

- **Fase 2 WhatsApp**: onboarding de instância Evolution para novas profissionais
  (bloqueada — ver seção acima)
- **Deploy de `main` consolidado**: branch `integrate/all-phases` aprovada localmente;
  aguarda merge em `main` e deploy para VPS
- **Evolution `chip2`**: container parado desde 17/09/2026 13:37 UTC — não reconectar
  sem autorização explícita
- Verificar execução completa do workflow Abandono de Conversa: confirmar que mensagem
  é enviada via Evolution API e `abandonment_notified` marcado como `true`
- Futura funcionalidade: `POST /whatsapp/reconnect` para reconexão via QR Code
  a partir da tela Configurações (parte da Fase 2)

---

## Arquitetura resumida

```
Nginx (HTTPS)
  ├── /api/   → Node.js Express (PM2 id 0, :3333)
  ├── /       → React SPA (dist/ servido estático)
  └── /n8n/   → n8n (PM2 id 4, :5678)

Evolution API → Docker, instância chip2, :8080
n8n → webhook → /bot/process → Evolution API → cliente WhatsApp
```
