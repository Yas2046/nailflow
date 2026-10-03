# NailFlow — Checklist Geral do Projeto

> Consolida, desde o início do projeto até 2026-10-03 (`main` em `50906f5`), o que já foi construído, corrigido/hardening, validado, o que falta e o que é futuro.
> Legenda: `[x]` concluído · `[~]` parcialmente concluído · `[ ]` pendente/não feito.
> Fonte: documentos em `docs/` e histórico de commits. Não repete detalhe técnico já coberto nesses documentos — só aponta para eles.

---

## 0. Auditoria geral de fechamento — 2026-10-01

> Auditoria de ponta a ponta (sem expansão de escopo, sem novas funcionalidades) para identificar o que falta para considerar a versão atual do sistema funcional. Commit das correções: `5fea86c`. Detalhe completo no relatório da sessão; aqui só o resumo por bloco.

- [x] **Autenticação/Profissionais** — login/logout, sessão por cookie `httpOnly`, bloqueio de profissional revoga sessão ativa imediatamente (`token_version`), isolamento por `professional_id` íntegro, nenhum acesso cruzado entre profissionais encontrado
- [x] **Segurança/isolamento** — nenhum IDOR encontrado (todo update/delete/get-by-id auditado filtra por `professional_id`); middlewares de auth aplicados em todas as rotas que deveriam; nenhum endpoint vaza dado sensível (`password_hash` etc.)
- [x] **Agenda** — criação/edição/cancelamento, prevenção de conflito em duas camadas (checagem na API + `EXCLUDE` no Postgres), timezone tratado, recorrência ponta a ponta (criação em lote, cancelamento de ocorrência única vs série)
- [x] **Clientes** — CRUD, histórico, tags, isolamento por profissional, íntegros
- [x] **Serviços** — CRUD, snapshot de preço correto no momento do agendamento, visibilidade no WhatsApp (`available_on_whatsapp`) respeitada tanto pelo bot quanto pela página pública
- [x] **Dashboard** — métricas conferem com dados reais, sem valor mockado/hardcoded
- [x] **Agendamento e cancelamento** (painel + bot) — fluxos íntegros após os últimos deploys, sem regressão encontrada
- [x] **Bot V1 (WhatsApp)** — considerado funcional e **não alterado** nesta rodada; confirmado que o backend em produção roda o commit correto, `conversation_states` isolado por `professional_id`, nenhuma quebra encontrada após os deploys recentes
- [x] **WhatsApp/Evolution/n8n** — Evolution API íntegra e alcançável, webhooks do n8n configurados com URLs reais (não placeholder), fluxo de conexão/QR Code coerente no código
- [x] **Página pública / link de agendamento** — fluxo testado em produção (200 em `/info`, `/services`, `/availability` e na página real), integração com a agenda íntegra
- [x] **Infraestrutura** — PM2 (`nailflow-backend` e `n8n`) online e estáveis, `/health` 200, build do frontend atualizado, `nginx -t` OK, certificado TLS válido, Evolution/n8n no ar
- [x] **Correções aplicadas na auditoria de 2026-10-01** (ver seção 3 e 7):
  - `createBlockedTime` aceitava `endsAt <= startsAt` (bloqueio invertido/vazio) — corrigido, agora rejeita com 400 (`5fea86c`)
  - `deleteService` retornava erro genérico de FK ao excluir serviço com agendamentos vinculados — corrigido, agora retorna 409 com mensagem clara orientando a desativar em vez de excluir (`5fea86c`)
- [ ] **Pendências de produto identificadas, deixadas deliberadamente para depois** (decisão do usuário, não bug):
  - Exclusão de cliente (não existe endpoint `DELETE`, provavelmente exigiria soft-delete)
  - Registro de nova profissional não faz auto-login (precisa chamar `/login` separadamente depois)
  - Mover horário/serviço de uma série recorrente inteira (`updateFromNow` só altera status/notes)
  - Configurações de notificação — endpoint dedicado não encontrado/implementado

### 0.1 Rodadas posteriores à auditoria (2026-10-01, mesma data)

- [x] **F9 — notificação da profissional ao receber agendamento pela página pública** (commits `2d17659` código + workflow do n8n editado manualmente na interface): implementação concluída — evento `appointment.public_created` disparado pelo backend após o `COMMIT` do agendamento (fire-and-forget, falha no envio não desfaz o agendamento), workflow "NailFlow — Notificações" do n8n estendido para reconhecer o evento e chamar a Evolution API. Fluxo backend → n8n → Evolution **validado ponta a ponta em produção** (execução registrada com sucesso até a chamada à Evolution). **Entrega real da mensagem no WhatsApp não foi possível validar**: o `phone_whatsapp` cadastrado da profissional de teste é um número placeholder (`5531999999999`), que a Evolution rejeita com `exists: false` — não é um bug de código, é dado de cadastro. Ver F9 em [`PENDENCIAS.md`](./PENDENCIAS.md) para o detalhe completo. **Não considerar validado de ponta a ponta até um teste com número real.**
- [x] **3 bloqueadores visuais de UX corrigidos** (commit `3f039dd`, auditoria de UX de produção): página pública não mostra mais botão/rodapé do WhatsApp quando o autoatendimento está ativo; bug visual de sobreposição no "R$" grande do Dashboard corrigido (fonte do símbolo trocada para sans-serif); pluralização "1 cliente(s) cadastrada(s)" corrigida em Clientes — ver seção 9
- [x] **Fechamento técnico — limpeza e consistência** (commit `26ae97f`): ~23 arquivos `.bak*` removidos do disco; `N8N_API_KEY`/`N8N_PROFESSIONAL_ID` removidas do `.env` (não usadas); filtro de `professional_id` adicionado ao SELECT pós-criação em `createAppointment` (defesa em profundidade); rate limiting adicionado em `/admin/professionals/*` — ver seções 3 e 12

---

## 1. Base do projeto e infraestrutura

- [x] Stack definida: Node.js/Express (ESM) + PostgreSQL + React/TypeScript/Vite/Tailwind — ver [`README.md`](../README.md)
- [x] VPS provisionada (Contabo, Ubuntu 24.04) — ver [`INFRAESTRUTURA.md`](./INFRAESTRUTURA.md)
- [x] PostgreSQL 16 instalado, rodando em `localhost`
- [x] Backend e frontend publicados em produção (`/var/www/nailflow`)
- [x] Nginx com HTTPS (Let's Encrypt/Certbot, renovação automática) para os 3 domínios (site, n8n, Evolution)
- [x] Domínios via DuckDNS (`nailflow.duckdns.org`, `nailflow-n8n.duckdns.org`, `nailflow-evolution.duckdns.org`)
- [x] PM2 gerenciando backend e n8n (autostart configurado)
- [x] Processo de deploy manual documentado (build frontend → restart backend quando necessário) — ver [`INFRAESTRUTURA.md`](./INFRAESTRUTURA.md)
- [x] `NODE_ENV=production` aplicado (cookie de sessão `Secure`)
- [x] Firewall UFW ativo — só 22/80/443 expostas externamente
- [x] Backup automático diário do banco (`pg_dump`, retenção 7 dias)
- [~] PM2 roda como usuário `root` (backend e n8n) — funcional, mas identificado como risco de amplificação; migração para usuário dedicado desenhada e **não implementada** (ver seção 12)

---

## 2. Autenticação e usuários

- [x] Login com e-mail/senha (`bcrypt`), mensagem de erro genérica (não revela qual condição falhou)
- [x] Cadastro de nova profissional (`slug` único, validação de e-mail único)
- [x] Sessão via JWT em cookie `httpOnly` + `SameSite=Lax` (+ `Secure` em produção)
- [x] Logout (limpa o cookie)
- [x] `requireAuth`/`requireAdmin`: checam `blocked_at` e `token_version` no banco a cada request, não só no login
- [x] Bloqueio de conta (`blocked_at`) e desbloqueio, com incremento de `token_version` no desbloqueio (força novo login)
- [x] Permissão `is_admin` com layout e rotas próprias (`/admin`, `AdminLayout`)
- [x] Rate limiting em login (10/15min) e cadastro (5/h) por IP
- [ ] Recuperação de senha ("Esqueci minha senha") — implementada isoladamente em `/opt/nailflow-next`, **fora do Git e fora de produção**; não publicada (ver seção 12)
- [ ] Troca de senha logada — mesma situação acima
- [ ] Promoção de conta a `is_admin` pela UI — hoje só é feita direto no banco, não existe endpoint/tela

---

## 3. Segurança e hardening

- [x] HTTPS em todos os domínios expostos (Let's Encrypt)
- [x] Security headers (HSTS, X-Content-Type-Options, X-Frame-Options, Referrer-Policy, Permissions-Policy) e CSP (validada em Report-Only antes de aplicar)
- [x] `X-Powered-By` oculto para tráfego externo; `server_tokens off` no Nginx
- [x] Secrets: `.env` (backend/frontend), `.pgpass` e sqlite do n8n com permissão `600`; nada de segredo commitado (`.gitignore` reforçado)
- [x] CORS restrito ao domínio de produção (`credentials: true`, sem wildcard)
- [x] CSRF mitigado pelo cookie `SameSite=Lax` + `httpOnly`
- [x] XSS: revisado, nenhum `dangerouslySetInnerHTML`/`eval` no frontend (React escapa por padrão)
- [x] SQL injection: revisado, queries parametrizadas em todo o backend; nenhuma interpolação de input de usuário em SQL
- [x] IDOR/BOLA: revisado, todo update/delete/get-by-id filtra por `professional_id` além do `id`
- [x] Isolamento multi-tenant reforçado **no banco**: foreign keys compostas `(id, professional_id)` (migration 017), não só na aplicação
- [x] Unicidade de instância WhatsApp por profissional (`wa_instance_name`, migration 015)
- [x] Validações de entrada com Zod nos principais endpoints; telefone normalizado/validado (`utils/phone.js`)
- [x] Rate limiting nas rotas mais sensíveis (login, cadastro, conexão WhatsApp, página pública) — Express + Nginx (`limit_req`)
- [x] Dependências do backend auditadas (`npm audit` → 0 vulnerabilidades)
- [x] Firewall/portas: só 22/80/443 externas; 3333 (backend) e 5678 (n8n) só locais
- [x] Backup diário do banco (`pg_dump`, 7 dias) — ver seção 1
- [x] Exclusão segura de profissional: snapshot pré-exclusão, exclusão sincronizada da instância Evolution, transação SQL (ver seção 4)
- [x] Audit log de ações administrativas (ver seção 4)
- [x] Evolution API: exposição pública restrita por IP no Nginx, logs reduzidos, imagem Docker fixada por digest
- [x] Validação de intervalo em bloqueios de horário (`createBlockedTime` rejeita `endsAt <= startsAt`, corrigido em 2026-10-01, commit `5fea86c`)
- [x] Mensagem clara (409) ao tentar excluir serviço com agendamentos vinculados, em vez do erro genérico de FK (corrigido em 2026-10-01, commit `5fea86c`)
- [x] Rate limiting nos endpoints administrativos (`/admin/professionals/*`) — 100 req/5min por IP, mesmo padrão de `/auth/login`/`register` (corrigido em 2026-10-01, commit `26ae97f`)
- [x] Consistência de isolamento: SELECT pós-criação em `createAppointment` passou a filtrar também por `professional_id` (defesa em profundidade; não era explorável, mas destoava do padrão do resto do arquivo) — corrigido em 2026-10-01, commit `26ae97f`
- [~] Dependências do frontend: `npm audit` acusa 2 vulnerabilidades **moderadas** em `react-router-dom`; avaliadas como não exploráveis no uso atual do app, correção (bump major) adiada por decisão registrada
- [ ] SSH restrito só a chave (hoje aceita senha também) — recomendado, não aplicado
- [ ] PM2 rodando como usuário dedicado (não-root) — ver seção 1

---

## 4. Administração

- [x] Cadastro/listagem de profissionais no painel Admin (`GET /admin/professionals`)
- [x] Editar cadastro de outra profissional (nome, negócio, WhatsApp, e-mail, foto) — reaproveita as mesmas regras de `PUT /auth/me`
- [x] Bloquear / desbloquear profissional
- [x] Exclusão definitiva de profissional (snapshot em disco antes de apagar, exclui a instância Evolution correspondente se houver, exclusão em transação com cascade)
- [x] Confirmação exigida antes de ações destrutivas (bloqueio/edição pedem confirmação; exclusão exige digitar o nome exato do negócio)
- [x] Proteção contra autoexclusão e autobloqueio
- [x] Proteção contra excluir a última conta admin
- [x] Layout responsivo da tela Admin (tabela no desktop, cards no mobile)
- [x] Audit log (`admin_audit_log`): registra ator, ação, alvo, data/hora para bloquear/desbloquear/editar/excluir, só em caso de sucesso
- [ ] Tela de consulta do audit log — o log já é gravado, mas não há UI para consultá-lo

---

## 5. Agenda e agendamentos

- [x] Agenda com visualização dia/semana/mês
- [x] Criação, edição e cancelamento de agendamentos
- [x] Disponibilidade semanal configurável (por dia, com intervalo de almoço)
- [x] Bloqueios pontuais de horário
- [x] Recorrência de agendamento por frequência (semanal/quinzenal) com data final ("Até uma data")
- [x] Recorrência por quantidade de dias ("Por X dias" — data inicial + X dias, alternativa a "Até uma data")
- [x] Fechamentos/exceções de agenda (`recurring_exceptions`): data específica, dia da semana recorrente (1ª–5ª/última ocorrência do mês), período de datas
- [x] Antecedência máxima de agendamento (`booking_horizon_days`) — hoje controla só o agendamento **externo** (WhatsApp + página pública)
- [x] Agenda interna sem limite de antecedência (navegação e criação livres — separado do controle externo acima)
- [x] Edição de agendamento diretamente pela ficha da cliente (histórico)
- [x] **Fase 1A — pré-agendamento e confirmação manual** (2026-10-02, commits `a36626b` e `47c2886`; **em produção e validada com WhatsApp real**): ver seção 14.9
- [x] Página pública de agendamento por slug (`/p/:slug`) — fluxo completo de autoatendimento (serviço → horário → dados → criação), não mais só uma vitrine que direciona pro WhatsApp (ver seção 14.8)
- [x] Disponibilidade pública filtrada por serviço (`serviceId` opcional em `GET /public/:slug/availability`), com rejeição de `serviceId` inválido/de outro profissional/inativo/oculto (`400` genérico) — validado em produção em 2026-09-30
- [x] Auditoria de segurança do fluxo de criação de agendamento público (2026-09-30): isolamento por `slug`/`professional_id` confirmado por teste real; backend não confia em preço/duração/`professionalId`/`clientId`/`status` enviados pelo cliente; horário sempre revalidado no backend; proteção contra double-booking em duas camadas (pré-checagem + `EXCLUDE` constraint do Postgres); concorrência e rollback cobertos por teste automatizado — nenhuma vulnerabilidade confirmada (ver [`PENDENCIAS.md`](./PENDENCIAS.md))

---

## 6. Clientes / CRM

- [x] Cadastro de clientes (nome, telefone validado/normalizado)
- [x] Ficha da cliente com histórico de atendimentos e métricas
- [x] Edição de agendamento pelo histórico da cliente (ver seção 5)
- [x] Tags por cliente (`clients.tags`, array de texto)
- [x] Notas por cliente (`clients.notes`)
- [x] Badge de cliente inativa na listagem
- [ ] CRM avançado (segmentação, campanhas por tag, histórico de conversas do WhatsApp exposto na ficha) — não implementado, ver seção 13

---

## 7. Serviços

- [x] Cadastro de serviços (nome, descrição, preço, duração)
- [x] Edição de serviço
- [x] Serviço ativo/inativo
- [x] Visibilidade no WhatsApp por serviço (`available_on_whatsapp`) — serviço pode ficar ativo na Agenda e oculto do bot/página pública
- [x] Indicador visual "WhatsApp" / "Somente Agenda" no card do serviço
- [x] Snapshot de preço no agendamento (preço não muda retroativamente em agendamentos já criados)

---

## 8. WhatsApp / Evolution / n8n

- [x] Evolution API rodando (Docker), autenticação por `apikey`
- [x] Gestão de instância WhatsApp pelo painel (criar/remover instância, QR via canvas, status)
- [x] Integração backend ↔ Evolution (status, criação/exclusão de instância)
- [x] n8n com 6 workflows de produção ativos: WhatsApp Definitivo, Notificações, Abandono de Conversa, Lembretes, **Solicitação Recusada** (2026-10-02, id `NfSolRecusada0001`) e **Mensagem à Cliente** (2026-10-02, id `NfMensagemCliente01`, evento `message.send`)
- [x] Webhooks do n8n autenticados por cabeçalho (`X-NailFlow-Webhook-Secret`)
- [x] Bot conversacional (máquina de estados completa: agendar, cancelar, consultar, atendimento humano) — ver [`FLUXOS_DO_BOT.md`](./FLUXOS_DO_BOT.md)
- [x] `conversation_states` e `message_history` implementados e em uso (estado da conversa e log de mensagens)
- [x] Classificador de respostas sim/não (`classifyReply`) para reduzir falsos positivos de confirmação
- [x] Notificações de confirmação/cancelamento de agendamento via n8n
- [x] **Aviso de recusa de solicitação** (2026-10-02): workflow separado "NailFlow — Solicitação Recusada" (webhook `POST nailflow/solicitacao-recusada`, mesma credencial Header Auth do "Notificações", envio pela Evolution com `waInstance` dinâmica); o backend dispara `appointment.rejected` com o texto pronto em `message`, e o n8n só entrega; ignora evento diferente, sem telefone (10–15 dígitos) ou sem instância válida; export versionado em `n8n/workflows/nailflow_solicitacao_recusada.json`. **Validado em produção com WhatsApp real** (recusa pela Agenda → mensagem recebida pela cliente)
- [x] Lembrete de agendamento (`/bot/appointments-tomorrow`) passa a incluir **somente `confirmado`** — uma solicitação ainda `pendente` não recebe lembrete de atendimento confirmado (envio real do lembrete continua não validado, ver abaixo)
- [x] Texto do bot corrigido: ao criar a solicitação (`pendente`) diz "Recebi sua solicitação… aguardando a confirmação da profissional", em vez de "confirmado"
- [x] Regras de serviços/agendamentos oferecidas pelo bot respeitam expediente, fechamentos, antecedência máxima e visibilidade no WhatsApp por serviço
- [x] Segurança da integração: `instance` obrigatório em todas as rotas do bot (sem fallback), CORS restrito em `/bot`, isolamento de `clientId` por profissional
- [x] Teste real ponta a ponta (2026-09-18): mensagem → bot → agendamento, validado com números reais
- [x] Atalhos naturais de entrada para "ver agendamentos" e "cancelar" (com casamento de pista por data/dia da semana/serviço), troca de intenção no meio de um fluxo de agendamento/cancelamento, saída global de desistência ("desisto", "deixa pra lá" etc. reseta qualquer estado `AGUARDANDO_*` para o menu) — commit `dcd5316`
- [x] Bug real corrigido: regex de "agendar" do estado `MENU` sem limite de palavra interpretava "desmarcar" como "agendar" (travava a conversa); "desmarcar"/"desmarca" agora reconhecidos como sinônimos de cancelar em todos os pontos de reconhecimento — encontrado e corrigido em 2026-10-01, commit `dcd5316` (reprodução do bug real registrada em teste automatizado)
- [x] F9 — notificação da profissional ao receber agendamento pela página pública: implementação e fluxo backend→n8n→Evolution concluídos e validados; entrega real da mensagem ainda não confirmada (ver seção 0.1 e [`PENDENCIAS.md`](./PENDENCIAS.md))
- [~] Conexão WhatsApp via painel (QR pelo sistema): implementada em código, mas **não testada completamente em produção** (a instância principal já estava conectada quando a feature ficou pronta)
- [x] `chip2` (Camila) reconectado e primeira mensagem real após a reconexão validada (2026-09-30): webhook autenticado (`X-NailFlow-Webhook-Secret`, sem 403), workflow "WhatsApp NailFlow — Definitivo" executado com sucesso, mensagem registrada em `message_history` sem vazamento cross-tenant; envio de teste controlado para a cliente Simone também validado, sem erro
- [x] Validação prática completa do WhatsApp pós-reconexão (01/10/2026, C2/C3 concluídas): agendamento por linguagem natural (serviço + data + horário em uma mensagem), confirmação e criação do agendamento, cancelamento por data + horário, confirmação e cancelamento real, e retorno ao menu/início após o cancelamento — todos validados com cliente real no WhatsApp
- [x] Aviso interno à profissional (`appointment.public_created`) — commit `50906f5` (2026-10-03, em produção): só é enviado quando a profissional tem `wa_instance_name` próprio (sem fallback para outra instância) e o telefone vai normalizado para `55` + número no ponto de envio (`whatsappNumberForSending`), sem alterar o telefone salvo. **Validado em produção** no caminho sem instância (E2E na `studio-simone-teles`: 201, nenhuma execução de "Notificações", nenhuma chamada à Evolution); a normalização foi validada por testes automatizados, não por uma entrega real
- [ ] Envio real de lembrete e de aviso de abandono após a correção dos crons de 2026-09-27 — os crons rodam com sucesso (144 de 144 execuções dos últimos 3 dias no caso dos lembretes) e há 8 agendamentos com `reminder_sent = true`, mas não há registro de confirmação de recebimento de um lembrete ou aviso reais

---

## 9. Frontend / UX

- [x] Tela **Início** com Dashboard (KPIs) e onboarding "Primeiros passos" (5 etapas, com hero de boas-vindas enquanto o onboarding está incompleto e não há próximo atendimento)
- [x] Tela **Agenda** (dia/semana/mês, criação/edição/bloqueio, recorrência)
- [x] Tela **Clientes** (listagem, ficha, histórico, tags/notas)
- [x] Tela **Serviços** (cadastro, badge WhatsApp/Agenda)
- [x] Tela **Gastos** (registro de despesas da profissional)
- [x] Tela **Admin** (listagem, editar, bloquear/desbloquear, excluir) — responsiva (cards no mobile)
- [x] Tela **Perfil/Configurações** (dados da conta, WhatsApp, Disponibilidade, Aparência)
- [x] Página pública de agendamento (`/p/:slug`)
- [x] Tema/Aparência (claro/escuro) e toasts
- [x] Padrão visual consistente de cards/badges reaproveitado entre páginas (Serviços, Clientes, Admin)
- [x] Auditoria de UX em produção (2026-10-01, como usuária real: login/Home/Dashboard/Agenda/Clientes/Serviços/Perfil/WhatsApp/página pública/mobile) — 3 bloqueadores visuais encontrados e corrigidos (commit `3f039dd`):
  - Página pública mostrava botão "Agendar pelo WhatsApp" e rodapé "confirmado diretamente pelo WhatsApp" mesmo com o fluxo de autoatendimento ativo — agora só aparecem quando o autoatendimento não está disponível
  - "R$" do Faturamento Realizado (Dashboard) renderizava com o glifo do cifrão sobreposto ao "R" na fonte decorativa, em desktop e mobile — corrigido com fonte sans-serif só no símbolo
  - Pluralização "1 clientes cadastradas" no topo da lista de Clientes, inconsistente com o rodapé da mesma tela — corrigida

---

## 10. Banco de dados

- [x] Tabelas principais: `professionals`, `clients`, `services`, `appointments`, `weekly_availability`, `blocked_times`, `recurring_groups`, `recurring_exceptions`, `expenses`, `conversation_states`, `message_history`, `admin_audit_log`
- [x] Isolamento por `professional_id` em todas as tabelas de domínio (`NOT NULL`, sem exceção)
- [x] Foreign keys compostas `(id, professional_id)` para impedir referência cross-tenant (migration 017)
- [x] Constraints de negócio relevantes (preço/duração positivos, e-mail/slug/telefone únicos, `wa_instance_name` único, etc.)
- [x] Migrations organizadas e (na maioria) idempotentes — ver [`BANCO_DE_DADOS.md`](./BANCO_DE_DADOS.md) para a lista completa (001–020)
- [x] `admin_audit_log` (migration 019) — sem FK obrigatória para `professionals`, de propósito (sobrevive à exclusão do ator/alvo)
- [x] Migration 020 (`professionals.bio` e `public_theme`, com CHECK em vinho/verde/azul) — **aplicada em produção em 2026-10-02** (backup prévio `/var/backups/nailflow/nailflow_pre-migration-020_2026-10-02_191104.dump`; aplicada como `postgres`, dono da tabela)
- [x] Migration 021 (`appointments.cancel_reason` varchar(20) e `appointments.source` varchar(10), esta com CHECK `public`/`bot`/nulo; aditiva, colunas nulas) — **aplicada em produção em 2026-10-02** (backup prévio `/var/backups/nailflow/nailflow_pre-migration-021_2026-10-02_210443.dump`; aplicada como `postgres`). Agendamentos criados antes dela ficam com `source` nulo (tratados como painel/legado)
- [x] Backup diário automatizado (`pg_dump`, retenção 7 dias)
- [x] Snapshot dedicado por exclusão de profissional (`/var/backups/nailflow/deleted-professionals/`, retenção 90 dias autopodada)
- [~] Migrations 007–019 são majoritariamente **retroativas** (estrutura já existia em produção, versionada depois) — ver `BANCO_DE_DADOS.md` para o detalhe de quais

---

## 11. Documentação / Git / deploy

- [x] Documentação organizada em `docs/` (arquitetura, infraestrutura, banco, rotas, bot, WhatsApp, n8n, testes, pendências, próximos passos, instalação)
- [x] Branch de trabalho: `main` — em 2026-10-02 `main` = `origin/main`, publicada e em produção (código em produção até `47c2886`, Fase 1A). **Estado em 2026-10-03: `main` = `origin/main` = `50906f5`**, tudo publicado e em produção: `cb07d38` (confirmação e sinal), `501cd55` (docs), `3bcbb1a` (Início com pendências, atalho para a Agenda e página pública) e `50906f5` (`public_created` sem instância e normalização do telefone). `feat/phase5-register` foi integrada à `main` e fica apenas como histórico
- [x] Histórico de commits recentes documentado em [`STATUS_ATUAL.md`](./STATUS_ATUAL.md)
- [x] Processo de deploy documentado (build do frontend, restart do backend quando necessário, migrations aplicadas manualmente)
- [x] Integração de `feat/phase5-register` ao `main` — concluída em 2026-10-02: merge resolvido a favor da feature (commit divergente `985c1f1` confirmado como superado), `origin/main` incluído, histórico publicado (`1f0216a`). Restart confirmado em 2026-10-02 (ver [`PENDENCIAS.md`](./PENDENCIAS.md))
- [ ] GitBook — não utilizado neste fluxo de trabalho; nenhuma publicação/sincronização feita

---

## 12. Pendências atuais

- [ ] Exclusão de cliente (não existe endpoint `DELETE` em `/clients/:id`; decisão de produto pendente — provável soft-delete, já que `appointments.client_id` é `ON DELETE RESTRICT`) — identificado na auditoria de 2026-10-01
- [ ] Registro de nova profissional não autentica automaticamente após criar a conta (precisa `/login` separado) — confirmar se é a UX pretendida — identificado na auditoria de 2026-10-01
- [ ] Mover horário/serviço de uma série recorrente inteira (`updateFromNow` só altera status/notes) — limitação conhecida de v1, documentar para o usuário final
- [ ] Configurações de notificação (endpoint dedicado) — não localizado/implementado
- [ ] Advisories moderados do `react-router-dom` (correção adiada — bump major)
- [ ] Retenção dos snapshots de exclusão de profissional depende de haver uma nova exclusão para autopodar (sem cron dedicado) — funcional, mas não 100% automática
- [ ] Tela de consulta do `admin_audit_log`
- [ ] Publicar recuperação/troca de senha (depende de conta Brevo/SMTP configurada e autorização)
- [ ] Migração do PM2 para usuário não-root (backend e n8n)
- [ ] SSH restrito só a chave
- [x] Integração de `feat/phase5-register` ao `main` — concluída em 2026-10-02 (ver seção 11)
- [ ] Regenerar exports do n8n "Definitivo" e "Notificações" (Abandono e Lembretes já regenerados) — o workflow "Notificações" também foi editado manualmente na interface em 2026-10-01 (F9) e ainda não foi re-exportado para o repositório
- [ ] **F9 — entrega real da notificação no WhatsApp não validada**: implementação e fluxo backend→n8n→Evolution estão concluídos e validados, mas o `phone_whatsapp` da profissional de teste em produção é um número placeholder (`5531999999999`) que a Evolution rejeita (`exists: false` / "Bad request"); falha **reconfirmada** nos E2E de 2026-10-03 (ex.: execução #14769, `appointment.public_created`), sem efeito sobre a reserva nem sobre a mensagem à cliente; falta um teste com número de WhatsApp real para considerar a F9 100% validada. Desde `50906f5`, o telefone vai normalizado (`55` + número) e o aviso não é enviado para profissional sem `wa_instance_name` (ex.: `studio-simone-teles`); o `chip2` da Camila é usado de propósito pelo perfil de teste
- [ ] A branch `feat/phase5-register` local continua à frente de `origin/feat/phase5-register`, mas todo o conteúdo já está na `main` publicada; decidir só se vale enviar ou remover a branch antiga (não afeta produção)
- [ ] A página pública de uma conta **bloqueada** (`blocked_at`) continua acessível: `getProfessionalBySlug` não checa o bloqueio — decisão adiada em 2026-10-02 (não é bloqueador do V1)
- [ ] Perfil: "Salvar foto" ainda envia a identidade completa e falha sem WhatsApp cadastrado; o backend já aceita foto sozinha desde 2026-10-02, falta só o frontend enviar apenas `avatar_b64`
- [ ] A antecedência mínima de 30 min para clientes é uma constante (`CUSTOMER_MIN_NOTICE_MINUTES`), não configurável por profissional
- [x] Personalização da página pública em produção (2026-10-03): a Camila (`camila-nails-studio`) já tem apresentação (`bio`) e tema azul; nenhuma conta enviou foto ainda, e as demais usam o padrão (sem apresentação, tema vinho, cabeçalho padrão com LogoMark)
- [ ] **Fase 1A — agendamentos anteriores à migration 021 têm `source` nulo**: recusar um deles funciona, mas a cliente **não** recebe WhatsApp (por desenho: só `public`/`bot` avisam). Só solicitações novas, feitas depois de 2026-10-02 21:04, avisam a cliente
- [x] Documentação técnica de apoio atualizada em 2026-10-03 (consolidação final, estado de `main` em `50906f5`): `BANCO_DE_DADOS.md`, `N8N.md`, `ROTAS_E_ENDPOINTS.md`, `FLUXOS_DO_BOT.md`, `ARQUITETURA.md`, `WHATSAPP_EVOLUTION.md`, `INSTALACAO_NOVA_MAQUINA.md`, `STATUS_ATUAL.md`, `TESTES_REALIZADOS.md`, `README.md` e `PROXIMOS_PASSOS.md` (ver M12 em [`PENDENCIAS.md`](./PENDENCIAS.md))
- [x] A cliente recebe WhatsApp ao *solicitar* o horário pela página pública — entregue no pacote `cb07d38`
- [ ] Pendências reais registradas em 2026-10-03 (detalhe, contexto e severidade em [`PENDENCIAS.md`](./PENDENCIAS.md), M16–M20; nenhuma é bloqueadora): o `chip2` pessoal responde a mensagens privadas; o workflow "Notificações" não valida instância nula em `confirmed`/`cancelled`; `DELETE /appointments/:id` sem guarda de status; sem aviso interno à profissional para reservas feitas pelo bot; o erro 409 da página pública não rola até a mensagem

---

## 13. Futuro do projeto

- [ ] Sugestão de horários alternativos (`suggestAlternatives`) buscar também em dias seguintes, não só no mesmo dia pedido — identificado na auditoria de 2026-10-01
- [ ] CRM avançado (segmentação por tag, histórico de conversas exposto na ficha da cliente)
- [ ] Campanhas de WhatsApp (envio em massa / reativação de clientes inativas)
- [ ] Módulo Financeiro mais completo (além de Gastos já existente)
- [ ] Aba Conversa (histórico de mensagens no painel, sem disparos novos)
- [ ] Monitoramento de produção (alertas de queda do bot / falha de crons)
- [ ] Logs estruturados (Winston/Pino)
- [ ] Rate limiting por número no bot
- [ ] Export de dados (LGPD)
- [ ] Versão pública do projeto para portfólio (repositório separado, sem infraestrutura/segredos)
- [ ] App mobile


---

## 14. Produto / UX — evolução para comercialização

> Visão específica das lacunas do **frontend/produto** pensando numa futura comercialização (múltiplas profissionais pagantes, não só uso interno). Complementa as seções 6, 7 e 9 acima — aqui o recorte é "o que falta para virar produto vendável", não "o que já existe tecnicamente".

### 14.1 Dashboard

- [x] Indicadores operacionais (agendamentos de hoje, próximo atendimento, horários livres hoje, total de clientes)
- [x] Faturamento (realizado no mês, previsto, perdido em não-comparecimento)
- [x] Atendimentos (contagem por status: concluído/cancelado/não compareceu)
- [x] Clientes (novos no mês, total)
- [x] Serviços mais realizados (top 5, com faturamento por serviço)
- [ ] Horários mais ocupados (heatmap/ranking de horário do dia com mais demanda) — não implementado
- [x] Cancelamentos (contagem separada no resumo do mês)
- [~] Comparação entre períodos — hoje só compara mês atual × mês anterior (variação %) e mostra uma janela fixa de 6 meses; não há seletor de período livre (ex.: trimestre, ano, datas customizadas)
- [x] Dashboard mantido separado da Home operacional (`Dashboard.tsx` e `Inicio.tsx` já são páginas distintas)

### 14.2 Financeiro

- [x] Entradas/faturamento (Dashboard: realizado/previsto/perdido + gráfico de 6 meses)
- [x] Gastos (tela própria — `Gastos.tsx` — e gráfico no Dashboard)
- [ ] Lucro (faturamento − gastos) calculado e exibido explicitamente — não existe hoje; o Dashboard mostra os dois lados (barras de faturamento + linha de gastos) mas não subtrai
- [ ] Separação de despesas fixas e variáveis — `expenses.category` é um campo livre (texto), sem uma classificação fixa/variável estruturada
- [x] Histórico (lista de despesas por data; faturamento e gastos dos últimos 6 meses)
- [x] Gráficos (combo chart faturamento × gastos, construído sob medida no Dashboard)
- [~] Evolução financeira — existe para uma janela fixa de 6 meses; falta um módulo Financeiro dedicado com período configurável e visão de lucro (ver [`PENDENCIAS.md`](./PENDENCIAS.md)/seção 13, "Módulo Financeiro mais completo")

### 14.3 CRM

- [x] Última visita (`ultimoAtendimento` na listagem e na ficha)
- [x] Frequência (`freq_media_dias` calculada na ficha da cliente)
- [x] Valor gasto (`valorTotalCents` e ticket médio na ficha)
- [x] Serviço mais utilizado (calculado por cliente na ficha)
- [x] Histórico completo (todos os agendamentos da cliente, com status e preço)
- [x] Observações (`notes` por cliente)
- [x] Tags pré-definidas + personalizadas (sugestões fixas e tags livres, até 20 por cliente)
- [x] Clientes inativas (badge e filtro dedicado na listagem)
- [x] Filtros/segmentação (filtro "Nova / Recorrente / Inativa" já na listagem de Clientes)

> CRM já está com cobertura ampla mesmo antes de pensar em comercialização — a lacuna real aqui é de UX/apresentação (ver 14.6), não de dado ausente.

### 14.4 Perfil e Configurações — organização em sub-abas

Hoje `Configuracoes.tsx` tem 4 abas: **Perfil, WhatsApp, Disponibilidade, Aparência**. Comparando com a organização-alvo de 5 abas ("Meu perfil / Meu negócio / Agenda / WhatsApp / Aparência"):

- [~] **Meu perfil** — existe, mas hoje misturado com dados do negócio na mesma aba "Perfil" (não separado)
- [ ] **Meu negócio** como aba própria — não existe separada; nome do negócio e afins ficam junto com o perfil pessoal
- [~] **Agenda** — existe como aba "Disponibilidade" (mesmo conteúdo-alvo: expediente, fechamentos, antecedência), só o nome/enquadramento é diferente do proposto
- [x] **WhatsApp** — já é uma aba própria
- [x] **Aparência** — já é uma aba própria

### 14.5 Onboarding

- [x] Configuração inicial guiada (card "Primeiros passos" na Home, com progresso)
- [x] Cadastro de serviços (etapa do checklist)
- [x] Horários (etapa do checklist)
- [x] Conexão WhatsApp (etapa do checklist, valida conexão real na Evolution)
- [x] Compartilhamento do link público **dentro do fluxo de onboarding** — 5ª etapa "Seu link" do checklist (concluída quando o slug existe, o que hoje vale para toda conta, pois `slug` é `NOT NULL`); o link, o botão copiar e "Ver página" ficam em Perfil (commit `63a7a58`)
- [x] Hero de boas-vindas ("Vamos configurar sua agenda") na Início enquanto o onboarding está incompleto e não há próximo atendimento, com um único botão para a próxima etapa pendente; continua aparecendo mesmo se o checklist for ocultado (commit `7a2a14e`)
- [x] Checklist de primeiros passos (o próprio componente `OnboardingChecklist`, com "Ocultar por enquanto")

### 14.6 Experiência geral do produto — itens para revisão futura

Nenhum destes foi auditado de ponta a ponta ainda; o que já existe pontualmente está marcado, o resto é trabalho de revisão futuro:

- [~] Responsividade — boa nas páginas mais recentes (Admin, Serviços); não auditada no app inteiro
- [~] Consistência visual — padrão de cards/badges já reaproveitado entre páginas recentes; não auditada no app inteiro
- [ ] Navegação (fluxo entre telas, breadcrumbs, atalhos) — não revisado
- [~] Estados vazios — existem em várias telas (ex.: "Nenhum serviço cadastrado", "Nenhuma profissional encontrada", "Dia de folga"); não revisado de forma sistemática em todas as telas
- [~] Mensagens de erro/sucesso — padrão de toast e caixas de erro já usado com consistência nas páginas mais recentes; não revisado no app inteiro
- [~] Loading — existem skeletons (Serviços) e "Carregando…" simples em outras telas; não padronizado
- [x] Confirmações de ações destrutivas — já é prática recorrente (Admin bloquear/editar/excluir, exclusão de despesa em Gastos); não 100% auditado se toda ação destrutiva do app tem confirmação
- [ ] Acessibilidade básica (contraste, labels, navegação por teclado, leitores de tela) — não revisado
- [ ] Experiência de primeira utilização (first-time user experience além do onboarding já existente — ex.: tour guiado, tooltips) — não implementada

### 14.7 Auditoria visual/funcional futura (antes de comercializar)

- [ ] Revisar página por página, nesta ordem, antes de comercializar: **Login → Início → Dashboard → Agenda → Clientes → Serviços → Gastos → Perfil/Configurações → WhatsApp → Admin → página pública**. Esta auditoria ainda não foi feita — este item fica registrado como pendência única, a ser quebrada em itens específicos quando for executada.


### 14.8 Página pública de agendamento / "link de agendamento online"

> **Atualizado em 2026-09-30 — descrição anterior desta seção estava desatualizada e foi corrigida aqui, não apagada silenciosamente** (ver conflito sinalizado no relatório da sessão). Até 2026-09-29 a página era só uma vitrine de horários que **encaminhava para o WhatsApp**; desde 2026-09-30 ela **fecha o agendamento sozinha**, sem depender do WhatsApp (commits `ec5643b`, `1617db5`, `9f88257`, `adf5164`).

- [x] Link público existe e é compartilhável (URL por `slug`, uma por profissional)
- [x] Compartilhamento do link (Instagram, WhatsApp etc.) — o link já é uma URL comum, e existe botão de copiar (em Perfil); não há um card/botão de "compartilhar" dedicado nessa própria página pública
- [x] Cliente vê a profissional/negócio da página (nome do negócio, horários) — cada link já é dedicado a uma profissional específica (via `slug`), não uma escolha entre várias
- [x] Cliente escolher o **serviço** desejado — implementado em 2026-09-30 (`GET /public/:slug/services` + Etapa 1 de `PaginaPublica.tsx`)
- [x] Cliente ver e **selecionar** data e horário disponível — horários agora clicáveis, filtrados pela duração do serviço escolhido (`serviceId` opcional em `GET /public/:slug/availability`)
- [x] Cliente informar os **dados necessários** (nome, telefone) — formulário implementado (Etapa 3, commit `9f88257`)
- [x] Confirmação **cria o agendamento diretamente** — `POST /public/:slug/appointments`, status inicial `pendente`; a página já não depende do WhatsApp para fechar o agendamento (o rodapé antigo mencionando "confirmado diretamente pelo WhatsApp" não reflete mais o fluxo atual)
- [x] Mobile — layout já é mobile-first (coluna única, `max-w-lg`, boa legibilidade em tela pequena), validado visualmente em produção em 2026-09-30
- [x] Personalização da página pública (2026-10-02, commits `c7cacaa` e `cc1b3ce`): foto (a mesma do Perfil), apresentação de até 280 caracteres e cor da página (vinho, verde ou azul, independente do tema do painel), configuradas em Perfil > "Página pública"; `GET /public/:slug/info` expõe só campos públicos e a página o busca uma vez. Em produção, mas ainda sem uso (ver seção 12)
- [x] Antecedência mínima de 30 minutos para clientes (commit `6122abc`, 2026-10-02): a página pública, o bot/WhatsApp e o KPI "disponíveis hoje" não oferecem nem aceitam horário que comece antes de agora + 30 min (`past_time`); corrige o bug de horários já passados de hoje aparecerem. A Agenda interna continua aceitando datas passadas (atendimentos retroativos)
- [~] Notificação automática à profissional quando um agendamento público é criado — **implementação concluída em 2026-10-01** (commit `2d17659` + workflow do n8n), fluxo backend→n8n→Evolution validado em produção; **entrega real da mensagem no WhatsApp ainda não confirmada** porque o número de WhatsApp cadastrado da profissional de teste é um placeholder inválido — não considerar validado de ponta a ponta até um teste com número real (ver F9 em [`PENDENCIAS.md`](./PENDENCIAS.md))
- [ ] Revisão futura de aparência, fluxo, estados de erro/sucesso e experiência da cliente **como fluxo comercial de autoatendimento** — agora já existem os estados de seleção/confirmação/sucesso/erro do fluxo novo; ainda não há uma revisão pensada especificamente para venda/conversão

### 14.9 Evolução do agendamento — pré-agendamento, confirmação e sinal

> Plano em fases, definido em 2026-10-02. `pendente` continua sendo o valor no banco e é exibido como **"Aguardando confirmação"**. Máquina de estados definida: `pendente`/`aguardando_pagamento` → `confirmado` → `concluido`/`nao_compareceu`; `cancelado` é terminal.

**Fase 1A — concluída, em produção e validada (2026-10-02)**
- [x] `pendente` exibido como "Aguardando confirmação" na Agenda, Início, Clientes e no modal (valor no banco inalterado; agendamentos existentes preservados)
- [x] Página pública: continua criando `pendente`, com a tela de sucesso "Agendamento solicitado!" e o texto "aguardando a confirmação da profissional"; ignora qualquer `status` enviado no corpo
- [x] Bot: ao criar a solicitação responde que ela foi recebida e aguarda confirmação (não diz mais "confirmado")
- [x] `POST /appointments/:id/confirm`: só a partir de `pendente`; repetir é idempotente (`changed:false`) e **não** reenvia mensagem
- [x] `PUT /appointments/:id` com `status: 'confirmado'`: só vale a partir de `pendente` (409 a partir de cancelado/concluído/não compareceu); notifica somente na mudança real
- [x] `POST /appointments/:id/reject`: só a partir de `pendente` → `cancelado` com `cancel_reason = 'rejected'`; avisa a cliente apenas quando `source` é `public` ou `bot`; repetir é idempotente
- [x] Mapa central mínimo de transições (`backend/src/utils/appointmentStatus.js`), usado só por confirmar/recusar; cancelamento pela cliente (bot) preservado; a cliente não consegue confirmar nem alterar status
- [x] Agenda: bloco "Aguardando confirmação" no modal com **Confirmar** e **Recusar** (Recusar pede confirmação; feedback por aviso; botões empilhados no celular); não aparece para confirmado/concluído/cancelado/não compareceu
- [x] Migration 021 (`cancel_reason`, `source`) e variável `N8N_WEBHOOK_REJECTED_URL` em produção; workflow de recusa publicado
- [x] Testes: `appointment-confirmation.test.js` (10 testes: criação pública, confirmação, repetição sem mensagem duplicada, rejeição, rejeição de já confirmado, isolamento entre profissionais, cliente sem login, lembrete só para confirmado); suíte backend 236/248, com as mesmas 12 falhas conhecidas (I14 e 3 testes do bot dependentes de data); build do frontend OK
- [x] **Validação real em produção**: confirmação pela Agenda → WhatsApp recebido; nova solicitação pela página pública aparece como "Aguardando confirmação"; recusa pela Agenda → solicitação cancelada → WhatsApp de recusa recebido
- Publicação: push `6122abc..47c2886`; `frontend/dist` anterior preservado em `dist.bak_20261002-pre-fase1a`

**Fases 1B + 2 + sinal Pix manual — concluídas, em produção e validadas por E2E (2026-10-02/03; commit `cb07d38`, publicado em `origin/main` e em produção)**
- [x] Migration 022 aplicada em produção após backup `/var/backups/nailflow/nailflow_pre-migration-022_2026-10-02_222934.dump` (detalhes em [`BANCO_DE_DADOS.md`](./BANCO_DE_DADOS.md))
- [x] Modo de confirmação por profissional (`manual` → `pendente` com reserva de 24 h; `automatic` sem sinal → `confirmado`; `automatic` com sinal → `aguardando_pagamento` com reserva de 2 h); a API proíbe sinal no modo manual
- [x] Sinal: percentual (30/50/100) ou valor fixo, calculado no servidor (`deposit_cents`), chave Pix da profissional; "Pagamento recebido" na Agenda (`POST /appointments/:id/mark-paid`, atômico e idempotente) → `confirmado`, `paid_at`, `expires_at` nulo
- [x] Expiração: sweeper de 60 s e `expireDueHolds` antes de criar/alterar; expirar = `cancelado` + `cancel_reason='expired'`, sem mensagem à cliente; disponibilidade ignora holds vencidos
- [x] Aba "Agendamento" em Configurações; página pública com bloco Pix (copiar chave); mensagens à cliente pelo canal genérico `message.send` → workflow `NfMensagemCliente01` ("NailFlow — Mensagem à Cliente", publicado após backup do banco do n8n; ver [`N8N.md`](./N8N.md))
- [x] Mensagem de "recebemos sua solicitação" à cliente (antes pendente da Fase 1B)
- [x] **E2E real aprovado — 4 cenários** (número de teste `553185108190`): (1) automático sem sinal e (2) manual com confirmação pela profissional, aprovados pela responsável (detalhes não reconferidos na revisão da documentação); (3) automático + sinal 50% → `aguardando_pagamento` (1750 de 3500, +2 h) → "Pagamento recebido" pela Agenda real → `confirmado`, 1 único `appointment.confirmed`, repetição idempotente; (4) expiração pelo sweeper real em ~56 s, sem mensagem e sem afetar outras reservas
- [x] Configuração da Camila restaurada após cada cenário: `manual`, sem sinal, sem Pix, sem tipo/valor; reservas de teste canceladas sem mensagem; agendamento antigo da Simone (05/10 13:00) intacto
- [x] Contador de "aguardando" na Início — entregue em `3bcbb1a` (ver bloco abaixo)
- [x] Push do commit `cb07d38` — feito; `main` = `origin/main` (`50906f5` em 2026-10-03)
- [ ] Aviso à cliente quando a reserva expira (hoje não envia; ver M14 em [`PENDENCIAS.md`](./PENDENCIAS.md))
- [ ] Investigação das respostas do bot de 2026-10-03 (#14772/#14773): eram mensagens reais recebidas do número de teste, respondidas conforme o fluxo existente do bot; **não é possível determinar quem as digitou nem se há relação causal com o cenário 4** (ver M15)

**Início com pendências, atalho para a Agenda e página pública — `3bcbb1a` (2026-10-03, em produção)**
- [x] Início: card "Precisa da sua ação" com a contagem de reservas aguardando confirmação e aguardando pagamento, o próximo vencimento e até 5 pedidos (cliente, serviço, dia/hora, status e vencimento), alimentado pelo bloco `aguardando` de `GET /dashboard`; só conta reservas com validade em curso (agendamentos `pendente` criados na Agenda, sem validade, ficam de fora do card); o card não aparece quando não há pendências
- [x] Atalho para a Agenda: cada pedido leva a `/agenda?data=AAAA-MM-DD&abrir=<id>`; a Agenda abre no dia do pedido e abre o detalhe (Confirmar/Recusar/Pagamento recebido) procurando o `id` apenas na lista da própria profissional; o parâmetro vale uma vez e é removido da URL
- [x] Página pública: ao escolher um horário (e ao ir para a revisão) a tela rola até o formulário, com a confirmação visual "Horário escolhido: serviço · dia e hora"; respeita `prefers-reduced-motion`; a lógica de disponibilidade não mudou. A página pede `days=6` (mostra só os próximos dias)
- [x] Testes: `dashboard-awaiting.test.js` (4 testes: contagem, ordem por vencimento, exclusões, isolamento entre profissionais); suíte atual **288 testes, 276 passando, 12 falhas conhecidas** (I14 em [`PENDENCIAS.md`](./PENDENCIAS.md))
- [x] **Validado em produção, página pública no celular (375×812):** serviço antes do horário, scroll até o formulário (totalmente visível), "Horário escolhido", revisão, envio (201) e tela de sucesso, sem overflow horizontal
- [x] **Validação manual da Home e da Agenda, relatada pela responsável (após o deploy de `3bcbb1a`):** o card "Precisa da sua ação" apareceu com contadores e validade corretos; "Ver na Agenda" abriu o agendamento correto; os botões do detalhe funcionaram; e o parâmetro `abrir` foi removido da URL depois do uso (M21 em [`PENDENCIAS.md`](./PENDENCIAS.md)). É um relato da responsável; as evidências **independentes** (testes `dashboard-awaiting`, consulta do card no banco e logs do Nginx de 2026-10-03, 16:03–16:04 UTC, com `POST /appointments/:id/confirm` → 200) apenas o corroboram

**Aviso interno à profissional sem instância e telefone normalizado — `50906f5` (2026-10-03, em produção)**
- [x] `appointment.public_created` só é disparado quando a profissional tem `wa_instance_name` (sem fallback para outra instância); o agendamento segue normalmente na Agenda e na Início
- [x] `professionalPhone` normalizado para `55` + número no ponto de envio (aceita máscara, `+55`, número sem DDI e zero de tronco; não duplica o `55`; vazio/inválido vira `null`), sem alterar o telefone salvo
- [x] **E2E de produção** na `studio-simone-teles` (sem instância): reserva pela página pública → 201, `pendente`, aparece na Agenda/Início; **nenhuma execução** de "Notificações" e nenhuma chamada de envio à Evolution; limpeza da reserva e da ficha de teste feita depois

**Próximas fases — não iniciadas**
- [ ] Fase 4: bot durante o pagamento (estado fora do prefixo `AGUARDANDO_`)
- [ ] Fase 5: lembretes e mensagens pós-atendimento
- [ ] Futuro: Pix automático/cartão (tabela `payments` e gateway)
