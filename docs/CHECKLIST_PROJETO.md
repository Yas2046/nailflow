# NailFlow — Checklist Geral do Projeto

> Consolida, desde o início do projeto até 2026-09-29, o que já foi construído, corrigido/hardening, validado, o que falta e o que é futuro.
> Legenda: `[x]` concluído · `[~]` parcialmente concluído · `[ ]` pendente/não feito.
> Fonte: documentos em `docs/` e histórico de commits. Não repete detalhe técnico já coberto nesses documentos — só aponta para eles.

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
- [~] Dependências do frontend: `npm audit` acusa 2 vulnerabilidades **moderadas** em `react-router-dom`; avaliadas como não exploráveis no uso atual do app, correção (bump major) adiada por decisão registrada
- [ ] Rate limiting nos endpoints administrativos (`/admin/professionals/*`) — não implementado, risco considerado baixo (já exige `is_admin`)
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
- [x] Página pública de agendamento por slug (`/p/:slug`)

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
- [x] n8n com 4 workflows ativos: WhatsApp Definitivo, Notificações, Abandono de Conversa, Lembretes
- [x] Webhooks do n8n autenticados por cabeçalho (`X-NailFlow-Webhook-Secret`)
- [x] Bot conversacional (máquina de estados completa: agendar, cancelar, consultar, atendimento humano) — ver [`FLUXOS_DO_BOT.md`](./FLUXOS_DO_BOT.md)
- [x] `conversation_states` e `message_history` implementados e em uso (estado da conversa e log de mensagens)
- [x] Classificador de respostas sim/não (`classifyReply`) para reduzir falsos positivos de confirmação
- [x] Notificações de confirmação/cancelamento de agendamento via n8n
- [x] Regras de serviços/agendamentos oferecidas pelo bot respeitam expediente, fechamentos, antecedência máxima e visibilidade no WhatsApp por serviço
- [x] Segurança da integração: `instance` obrigatório em todas as rotas do bot (sem fallback), CORS restrito em `/bot`, isolamento de `clientId` por profissional
- [x] Teste real ponta a ponta (2026-09-18): mensagem → bot → agendamento, validado com números reais
- [~] Conexão WhatsApp via painel (QR pelo sistema): implementada em código, mas **não testada completamente em produção** (a instância principal já estava conectada quando a feature ficou pronta)
- [ ] Validação prática completa após a reconexão mais recente: primeira mensagem com o webhook autenticado, agendamento e cancelamento ponta a ponta pelo WhatsApp — instâncias (`chip2`, `chip2-teste`) desconectadas intencionalmente, aguardando autorização para reconectar
- [ ] Envio real de lembrete e de aviso de abandono após a correção dos crons de 2026-09-27 — corrigidos e validados sem itens, mas nenhum envio real ainda aconteceu (instâncias desconectadas)

---

## 9. Frontend / UX

- [x] Tela **Início** com Dashboard (KPIs) e onboarding "Primeiros passos"
- [x] Tela **Agenda** (dia/semana/mês, criação/edição/bloqueio, recorrência)
- [x] Tela **Clientes** (listagem, ficha, histórico, tags/notas)
- [x] Tela **Serviços** (cadastro, badge WhatsApp/Agenda)
- [x] Tela **Gastos** (registro de despesas da profissional)
- [x] Tela **Admin** (listagem, editar, bloquear/desbloquear, excluir) — responsiva (cards no mobile)
- [x] Tela **Perfil/Configurações** (dados da conta, WhatsApp, Disponibilidade, Aparência)
- [x] Página pública de agendamento (`/p/:slug`)
- [x] Tema/Aparência (claro/escuro) e toasts
- [x] Padrão visual consistente de cards/badges reaproveitado entre páginas (Serviços, Clientes, Admin)

---

## 10. Banco de dados

- [x] Tabelas principais: `professionals`, `clients`, `services`, `appointments`, `weekly_availability`, `blocked_times`, `recurring_groups`, `recurring_exceptions`, `expenses`, `conversation_states`, `message_history`, `admin_audit_log`
- [x] Isolamento por `professional_id` em todas as tabelas de domínio (`NOT NULL`, sem exceção)
- [x] Foreign keys compostas `(id, professional_id)` para impedir referência cross-tenant (migration 017)
- [x] Constraints de negócio relevantes (preço/duração positivos, e-mail/slug/telefone únicos, `wa_instance_name` único, etc.)
- [x] Migrations organizadas e (na maioria) idempotentes — ver [`BANCO_DE_DADOS.md`](./BANCO_DE_DADOS.md) para a lista completa (001–019)
- [x] `admin_audit_log` (migration 019) — sem FK obrigatória para `professionals`, de propósito (sobrevive à exclusão do ator/alvo)
- [x] Backup diário automatizado (`pg_dump`, retenção 7 dias)
- [x] Snapshot dedicado por exclusão de profissional (`/var/backups/nailflow/deleted-professionals/`, retenção 90 dias autopodada)
- [~] Migrations 007–019 são majoritariamente **retroativas** (estrutura já existia em produção, versionada depois) — ver `BANCO_DE_DADOS.md` para o detalhe de quais

---

## 11. Documentação / Git / deploy

- [x] Documentação organizada em `docs/` (arquitetura, infraestrutura, banco, rotas, bot, WhatsApp, n8n, testes, pendências, próximos passos, instalação)
- [x] Branch de trabalho única: `feat/phase5-register`, sincronizada com `origin`
- [x] Histórico de commits recentes documentado em [`STATUS_ATUAL.md`](./STATUS_ATUAL.md)
- [x] Processo de deploy documentado (build do frontend, restart do backend quando necessário, migrations aplicadas manualmente)
- [ ] Integração de `feat/phase5-register` ao `main` — `main` local e `origin/main` divergentes, não contêm V1 nem V2
- [ ] GitBook — não utilizado neste fluxo de trabalho; nenhuma publicação/sincronização feita

---

## 12. Pendências atuais

- [ ] Validação prática completa do WhatsApp (primeira mensagem pós-reconexão, agendamento e cancelamento ponta a ponta) — depende de autorização para reconectar `chip2`
- [ ] Rate limiting nos endpoints `/admin/professionals/*`
- [ ] Advisories moderados do `react-router-dom` (correção adiada — bump major)
- [ ] Limpeza dos arquivos `.bak*` acumulados em `backend/src/controllers/` (gitignorados, não expostos, mas poluindo o disco)
- [ ] Retenção dos snapshots de exclusão de profissional depende de haver uma nova exclusão para autopodar (sem cron dedicado) — funcional, mas não 100% automática
- [ ] Tela de consulta do `admin_audit_log`
- [ ] Publicar recuperação/troca de senha (depende de conta Brevo/SMTP configurada e autorização)
- [ ] Migração do PM2 para usuário não-root (backend e n8n)
- [ ] SSH restrito só a chave
- [ ] Integração de `feat/phase5-register` ao `main`
- [ ] Regenerar exports do n8n "Definitivo" e "Notificações" (Abandono e Lembretes já regenerados)
- [ ] Remover `N8N_API_KEY`/`N8N_PROFESSIONAL_ID` do `.env` (não usadas pelo código)

---

## 13. Futuro do projeto

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
- [ ] Compartilhamento do link público **dentro do fluxo de onboarding** — não é uma etapa do checklist hoje; existe um botão de copiar link, mas está em Perfil, fora do onboarding
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
