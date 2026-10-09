# NailFlow — Status Atual (2026-10-09)

## ADM V1 publicado — 2026-10-09 (referência: `main` em `596d24a`)

> Este bloco é o estado mais recente. As seções seguintes (a partir de "Estado atual — 2026-10-03") são histórico; onde algo ficou desatualizado há uma nota apontando para cá.

**Git e deploy**
- **Repositório:** `main` = `origin/main` = `596d24a` (fast-forward da `feat/admin-dashboard`, que também foi enviada ao remoto).
- **Commits do ADM V1** (sobre o Guia Rápido já publicado em `808a4a6`):

  | Commit | O quê |
  |---|---|
  | `93ba884`, `43c680e`, `3d8f359`, `3056049` | Central da conta: visão geral, edição do perfil, segurança (informativa) e atividade |
  | `8e9d334` | Ícones compartilhados do ADM, contexto do layout e formatador de telefone |
  | `630fd1a` | Redesenho da Visão geral, Perfil e Atividade da Central da conta |
  | `14f19ef` | Auditoria: painel de resumo único, filtros em chips, detalhes técnicos recolhidos |
  | `24a90b0` | Dashboard em `/admin` e gestão de profissionais em `/admin/profissionais` |
  | `c2d4b60` | Backend: `PUT /auth/password` e `POST /auth/logout-all` |
  | `596d24a` | Tela Segurança funcional (trocar senha e sair de todos os dispositivos) |

- **Deploy em 2026-10-08:** build do frontend no servidor e troca do `dist` (anterior preservado em `frontend/dist.bak_20261008-pre-adm-v1`); `nailflow-backend` reiniciado, necessário pelas rotas novas (**PID 1274349 → 1511808**). **Sem alteração em banco, migrations, n8n ou Evolution.**

**O que o ADM V1 entrega (7 telas, só para administradores)**
- `/admin` — Visão geral da plataforma: indicadores de contas, atenção necessária, atividade recente e atalhos; usa só endpoints que já existiam (`/admin/professionals`, `/admin/audit-log`, `/health`).
- `/admin/profissionais` — gestão de contas: busca, filtros (todas, ativas, bloqueadas, sem WhatsApp, sem número), lista de 12 em 12 com "Mostrar mais" (paginação no navegador) e as ações Editar, Bloquear/Desbloquear e Excluir (com prévia e confirmação pelo nome do negócio).
- `/admin/auditoria` — histórico de ações administrativas, com filtros e detalhes.
- `/admin/conta` (visão geral), `/perfil` (identidade e edição pelo `PUT /auth/me`), `/seguranca` e `/atividade` — Central da conta.
- Títulos de aba padronizados ("Tela · NailFlow"), sem rolagem horizontal de 390 px a 1440 px.

**Autenticação — novidades (backend)**
- **`PUT /auth/password`:** exige senha atual, nova senha (8 a 72 caracteres, diferente da atual) e confirmação; grava novo hash, incrementa `token_version` (derruba as outras sessões) e reemite o cookie para a sessão atual continuar. Senha atual errada devolve 400 (não desloga). Limite de 5 falhas por conta a cada 15 minutos.
- **`POST /auth/logout-all`:** incrementa `token_version` e reemite o cookie; encerra todos os outros dispositivos e mantém o atual. Limite de 10 por conta a cada 15 minutos.
- O `POST /auth/logout` continua só limpando o cookie do navegador (sem revogação no servidor).
- **Sem registro na Auditoria:** a tabela `admin_audit_log` só aceita `block`, `unblock`, `update` e `delete` (CHECK); registrar essas ações exigiria migration, que foi deliberadamente evitada.
- Isto é a **troca de senha logada** simples. A implementação isolada de `/opt/nailflow-next` (recuperação por e-mail, normalização de e-mail) **continua não publicada**.

**Validação**
- Antes do deploy (ambiente isolado, banco PostgreSQL descartável): 7 rotas × 4 larguras (28 combinações), estados de carregamento, erro e vazio, ações de admin, permissões (401 sem sessão, 403 para profissional comum, redirecionamento na interface, conta bloqueada não loga) e troca de senha / "sair de todos" (17 verificações no banco real de teste); `tsc -b`, `vite build` e `git diff --check` em cada commit.
- Depois do deploy: health OK, 7 rotas servidas, rotas novas exigem sessão (401 sem login), sem erros inesperados nos logs. **Validação manual em produção, relatada pela responsável (2026-10-08/09): tudo funcionando, exceto a foto da administradora** (ver pendência abaixo).

**Pendência conhecida:** a **foto da administradora** (menu lateral e Perfil da Central da conta) **não está funcionando como esperado em produção**; fica para uma próxima etapa (registrada como A7 em [`PENDENCIAS.md`](./PENDENCIAS.md)).

**Não implementado de propósito (V1):** recuperação de senha, 2FA, lista/encerramento de sessões individuais, indicadores de agendamentos/clientes da plataforma (não existe endpoint agregado para o admin) e paginação no servidor. Ver A8–A11 em [`PENDENCIAS.md`](./PENDENCIAS.md).

**Testes:** não foram adicionados testes automatizados ao repositório para o ADM nem para as rotas novas; a validação foi feita com scripts temporários fora do Git. A suíte existente não foi alterada (12 falhas conhecidas — I14).

---

## Estado atual — 2026-10-03 (referência: `main` em `a326ec8`)

> Este bloco descreve o estado real em 2026-10-03. **Tudo abaixo desta seção, até "O que NÃO está publicado", é histórico até 2026-09-30** (V1/V2, rodadas de segurança, Admin e página pública); foi mantido como registro e só recebeu notas pontuais de estado atual onde ficaria enganoso.

**Git e deploy**
- **Repositório:** https://github.com/Yas2046/nailflow — branch de trabalho **`main`**, `main` = `origin/main` = `a326ec8` (o commit de documentação desta etapa vem depois), publicada e **em produção** (a `feat/phase5-register` foi integrada à `main` em 2026-10-02 e é só histórico).
- **Commits recentes:**

  | Commit | Data | O quê |
  |---|---|---|
  | `12dcff7` | 2026-10-03 | Painel Admin com nova composição visual + Auditoria v1 (`GET /admin/audit-log` e tela `/admin/auditoria`) |
  | `50906f5` | 2026-10-03 | `public_created` só com instância própria; telefone da profissional normalizado (`55` + número) |
  | `3bcbb1a` | 2026-10-03 | Início com card "Precisa da sua ação", atalho para a Agenda (`?data=&abrir=`) e scroll/confirmação visual na página pública |
  | `501cd55` | 2026-10-03 | Documentação: confirmação e sinal |
  | `cb07d38` | 2026-10-02 | Confirmação manual/automática, reserva com expiração, sinal por Pix manual, mensagens à cliente (`message.send`) |
  | `47eccc5` / `47c2886` / `a36626b` | 2026-10-02 | Fase 1A: confirmar/recusar solicitações (Agenda, backend, bot, aviso de recusa) |
  | `6122abc` | 2026-10-02 | Antecedência mínima de 30 min para clientes |

- **Produção:** `nailflow-backend` (PM2) reiniciado em 2026-10-03 (PID 1274349 após o deploy de `12dcff7`; antes, 1253738 com `50906f5`); frontend publicado com o build de `12dcff7` (`dist` anterior preservado em `dist.bak_20261003-pre-auditoria`); banco com as migrations **até a 022** (backups `nailflow_pre-migration-020/021/022_*.dump` em `/var/backups/nailflow/`); n8n com **6 workflows ativos** (Definitivo, Notificações, Solicitação Recusada, Mensagem à Cliente, Abandono e Lembretes — ver [`N8N.md`](./N8N.md)).
- **WhatsApp/Evolution:** `chip2` **`open`** (é, de propósito, o WhatsApp pessoal da responsável, usado pelo perfil de teste Camila) e `chip2-teste` `connecting`; a `studio-simone-teles` não tem instância. Ver [`WHATSAPP_EVOLUTION.md`](./WHATSAPP_EVOLUTION.md).
- **Contas em produção:** 4 (`camila-nails-studio` — teste, com `chip2`, bio e tema azul; `teste-nailflow`; `studio-simone-teles`, sem instância; e a conta de administração).

**Funcionalidades entregues desde 2026-09-30**
- Página pública: serviços, criação de agendamento, perfil personalizável (bio, tema, foto), antecedência mínima de 30 min, scroll até o formulário e "Horário escolhido"; mostra só os próximos dias (`days=6`).
- Agendamento: `pendente` ("Aguardando confirmação"), `aguardando_pagamento`, `confirmado`; confirmação manual ou automática por profissional; sinal por Pix manual (percentual 30/50/100 ou valor fixo, chave Pix, "Pagamento recebido" na Agenda); reservas com validade (24 h aguardando confirmação, 2 h aguardando pagamento) e expiração automática (sweeper de 60 s) sem mensagem à cliente. Ver [`ROTAS_E_ENDPOINTS.md`](./ROTAS_E_ENDPOINTS.md) e [`BANCO_DE_DADOS.md`](./BANCO_DE_DADOS.md).
- Início/Agenda: card "Precisa da sua ação" (contagem, próximo vencimento, atalho que abre o detalhe do pedido); Confirmar/Recusar/Pagamento recebido no detalhe.
- Mensagens: recebimento da solicitação, instruções de Pix, confirmação, recusa e cancelamento pelo n8n; o bot cria reservas com o mesmo critério e responde com as próprias mensagens ([`FLUXOS_DO_BOT.md`](./FLUXOS_DO_BOT.md)); o aviso interno à profissional (F9) só sai para quem tem instância.

**Validado em produção** (detalhes em [`TESTES_REALIZADOS.md`](./TESTES_REALIZADOS.md)): E2E dos 4 cenários de confirmação/sinal/expiração; página pública no celular; `public_created` sem instância; e a validação manual da Home e da Agenda (card "Precisa da sua ação", "Ver na Agenda", botões e remoção do `abrir` da URL), **relatada pela responsável**. **Não validado:** entrega real do aviso à profissional (telefone cadastrado é placeholder) e envio real de lembrete/abandono com confirmação de recebimento.

**Admin — nova composição visual e Auditoria v1 (2026-10-03, `12dcff7`)**
- **Painel Admin redesenhado** (só frontend; regras e chamadas de API das ações preservadas): menu lateral fixo (a partir de `lg`; abaixo, barra superior com abas), saudação com data, resumo de profissionais (indicadores com barras de proporção; contam só contas não admin), lista em cards responsiva (avatar, status, contato, instância, cadastro), ações num menu de três pontos (Editar, Bloquear/Desbloquear, Excluir…), diálogos acessíveis (Esc, foco preso/devolvido), estados de carregamento/vazio/erro com "Tentar novamente" e a nova aba **Auditoria**. A busca e os filtros de profissionais aparecem **só como visual desativado ("Em breve")** — não funcionam. *(Superado em 2026-10-09: busca e filtros passaram a funcionar no ADM V1 — ver o bloco no topo.)*
- *(Nota de 2026-10-09: na Auditoria do ADM V1 o rótulo "Concluída" saiu das telas — todo registro é uma ação concluída — e o detalhe passou a mostrar "Feita por", com os IDs em "Detalhes técnicos". O restante desta descrição segue válido.)*
- **Tela `/admin/auditoria`:** cartões "Ações hoje" e "Últimos 7 dias"; filtro por ação (Todas/Edição/Bloqueio/Desbloqueio/Exclusão) e por período (presets + datas De/Até); lista do mais recente ao mais antigo, 15 por página, com detalhe expansível por registro (ação, resultado "Concluída", e-mail do admin, IDs, data completa e aviso de que os campos alterados não são armazenados); estados de carregamento, vazio e erro.
- **Endpoint `GET /admin/audit-log`:** somente leitura, atrás de `requireAdmin` (401 sem login, 403 se não admin) e do rate limit de 100 req/5 min; paginação (`page`, `pageSize` ≤ 50), filtros `action`, `from`, `to` (dias inteiros em `America/Sao_Paulo`) e `summary` (`today`, `last7Days`). Detalhes em [`ROTAS_E_ENDPOINTS.md`](./ROTAS_E_ENDPOINTS.md). Sem migration.
- **O que o log registra:** só ações administrativas **concluídas** — `block`, `unblock`, `update`, `delete` — com `actor_id`, `actor_email`, `action`, `target_id`, `target_business_name`, `created_at`. **Não armazena:** valores antes/depois, motivo, IP, nome do administrador (só e-mail) e falhas/tentativas recusadas. Imutabilidade só pela API (sem rota de escrita; sem trigger no banco).
- **Limpeza prévia dos dados de teste (2026-10-03):** os 104 registros que existiam eram todos de testes antigos (3 admins `admin_*_test@nailflow.com`; nenhum de admin real) e foram removidos numa transação protegida, após backup (`/var/backups/nailflow/manual/admin_audit_log_pre-cleanup_20261003-233014.csv` e `.sql`, fora do Git). Nenhuma outra tabela foi alterada.
- **Deploy:** push `3e423f6..12dcff7`; `frontend/dist` anterior preservado em `dist.bak_20261003-pre-auditoria`; só o `nailflow-backend` foi reiniciado (PID 1253738 → 1274349, necessário para a nova rota). Sem alteração em n8n, Evolution, banco ou migrations.
- **Validação em produção:** backend saudável; `/admin`, `/admin/auditoria` e `/login` respondem 200; `GET /admin/audit-log` sem login → 401. **Validação manual com login real, relatada pela responsável:** a Auditoria foi validada manualmente; um **bloqueio** de profissional feito pela própria interface funcionou e apareceu na Auditoria. Conferência somente leitura no banco: o log tem 1 registro (`block`, ator `admin@nailflow.internal`, alvo "NailFlow Teste", 2026-10-03 23:43 +02) — é o **primeiro registro real do histórico e deve ser preservado**. Observação: no momento desta documentação a profissional "NailFlow Teste" **continuava bloqueada** (`blocked_at` preenchido); desbloqueá-la, se desejado, gera um registro `unblock` legítimo.
- **Limitações atuais da Auditoria:** sem antes/depois, motivo, IP, nome do admin ou falhas; sem busca por texto (profissional/admin); sem exportação; sem filtro por administrador ou profissional; paginação por deslocamento; valores de "hoje"/"7 dias" calculados no fuso de São Paulo.

**Guia Rápido do NailFlow (commit `4decc04`, branch `feat/guia-rapido`; ainda sem push e sem deploy)**
- Implementado o "Guia rápido do NailFlow" para a profissional que está começando: **8 etapas** (O que é o NailFlow, Criando sua conta, Configurando seu espaço, Cadastrando seus serviços, Cadastrando clientes, Criando seu primeiro agendamento, Entendendo sua agenda, E agora?), com linguagem simples e capturas reais das telas (dados fictícios)
- **Versão web pública** (`/ajuda`, `/ajuda/:etapa`, sem login) e **versão para impressão** (`/ajuda/imprimir`, para salvar como PDF pelo navegador; 8 páginas A4). Integrada ao card "Primeiros passos" existente, ao menu lateral ("Ajuda") e ao ícone `?` do celular. Estrutura em [`ARQUITETURA.md`](./ARQUITETURA.md)
- Só frontend: nenhum backend, banco, n8n, Evolution ou migration foi alterado
- **Validado localmente** (prévia com API simulada, sem tocar na produção): `tsc --noEmit` passou, `vite build` passou, `git diff --check` passou; navegação entre as 8 etapas, imagens, responsividade (375 px e desktop) e a página de impressão conferidas
- **O endereço do site citado no guia** (`nailflow.duckdns.org`) fica na constante `ENDERECO_NAILFLOW`; se o domínio mudar, é uma alteração pontual e a versão para imprimir deve ser gerada de novo
- **Produção continua na versão anterior:** o `dist` publicado não tem as rotas `/ajuda`. Para publicar: merge na `main`, push, build do frontend e troca do `dist` (sem restart do backend)

**Suíte automatizada:** 296 testes, 284 passando (inclui os 8 novos de `admin-audit-log-list`, rodados em worktree limpo com banco descartável; **a suíte não é executada na árvore de produção**), **12 falhas conhecidas** (9 testes antigos que esperam `body.token` no login e 3 do bot que dependem do dia da semana — I14 em [`PENDENCIAS.md`](./PENDENCIAS.md)).

*(Nota de 2026-10-09: o Guia Rápido já foi publicado — produção estava em `808a4a6` antes do ADM V1.)* **Pendente de publicação:** o Guia Rápido (`4decc04`) ainda **não foi publicado** — falta o merge na `main`, o push e o deploy do frontend. Melhorias de UX da Agenda registradas durante a revisão do guia, ainda não feitas: tornar o agendamento clicável diretamente, deixar o botão Editar (lápis) mais evidente, corrigir "Mes" para "Mês" e revisar a capitalização das datas.

**Pendências e limitações atuais:** ver [`PENDENCIAS.md`](./PENDENCIAS.md) — em especial M16–M20 (bot responde a DMs no número conectado, "Notificações" sem guarda para instância nula em `confirmed`/`cancelled`, `DELETE /appointments/:id` sem guarda de status, sem aviso interno para reservas do bot, 409 da página pública sem scroll até o erro), F9 e M10 (foto no Perfil).

---

## Git (histórico até 2026-09-30)

- **Repositório:** https://github.com/Yas2046/nailflow
- **Branch de trabalho (em 2026-09-30):** `feat/phase5-register`
- **Último commit (em 2026-09-30):** `adf5164` — feat(public): filtrar disponibilidade por serviço
- **Sincronização (em 2026-09-30):** `feat/phase5-register` = `origin/feat/phase5-register`
- **Working tree:** limpo após os commits de 2026-09-30 (retirada do fluxo público legado sem slug, listagem pública de serviços, criação de agendamento pela página pública, fluxo completo de agendamento no frontend, disponibilidade filtrada por serviço)
- **Atenção — `main` (em 2026-09-30):** o `main` local e o `origin/main` estavam divergentes entre si e não continham a V1 nem a V2. **Resolvido em 2026-10-02** (integração concluída; `main` publicada).

### Histórico recente

```
b26d682 chore: version V2 production changes                                  (2026-09-25)
38b3fe7 feat: finalize NailFlow V2                                            (2026-09-24)
d82603c feat: finalize NailFlow V1                                            (2026-09-24)
c516245 feat(notifications): incluir waInstance no payload de notificações WhatsApp
5be11da feat(whatsapp): gestão completa de instâncias Evolution pelo NailFlow
9255bba chore(.gitignore): ignorar backups de sessão e arquivos .bak-*
022a24b chore(n8n): atualizar export do workflow definitivo
ba226de fix(botAuth): adicionar fallback waInstance e remover log de debug
5f740ba fix(ttl): corrigir TTL do ATENDIMENTO_HUMANO ignorando updated_at contaminado por trigger
5308ee3 fix(qr): renderizar QR Code via canvas com qrcode lib
de9448d docs+feat(bloco5+whatsapp): documentação de transição e CRM/WhatsApp
```

---

## Versões do produto

### V1 — `d82603c` (2026-09-24)
- Páginas **Início** e **Gastos** (despesas: `expenses`), Dashboard, Agenda, Clientes, Serviços, Perfil
- Tema/Aparência (`ThemeContext`) e toasts
- Gestão de instâncias WhatsApp pelo NailFlow (criar/remover instância Evolution, QR renderizado via canvas)
- Correções: TTL do atendimento humano, fallback `waInstance` no `botAuth`

### V2 — `38b3fe7` (2026-09-24)
- **Área administrativa**: coluna `is_admin`, middleware `requireAdmin`, rota `GET /admin/professionals`, layout próprio `AdminLayout` (sem a navegação da profissional)
- Ajustes em Agenda, Clientes, Dashboard e Gastos

### V2 — mudanças de produção versionadas em `b26d682` (2026-09-25)
Estas mudanças já estavam em produção antes do commit:
- **Antecedência máxima** por profissional (`booking_horizon_days`) usada por Agenda, página pública e bot
- **Fechamentos da agenda** (`recurring_exceptions`): data específica, dia da semana recorrente (1ª–5ª/última) e período
- **Agenda**: navegação dia/semana/mês limitada pela antecedência; aviso "Agenda aberta até …"
- **Onboarding** "Primeiros passos" na tela Início + `GET /onboarding/status`
- **Disponibilidade**: aviso de horários sugeridos enquanto nenhum dia de atendimento foi salvo
- **Correção do bot**: `getAvailableDaysWithSlots` perdia o parâmetro `$1` na query (ver [`FLUXOS_DO_BOT.md`](./FLUXOS_DO_BOT.md))
- Migrations retroativas **007–010** e `.gitignore` reforçado

### Fechamento técnico da V2 (2026-09-27, aplicado em produção, sem commit)
- **V1 fechada; V2 funcionalmente fechada; fechamento técnico avançado.** O que resta: revisão final, commit/push e, depois, validação real pelo WhatsApp (ver [`PENDENCIAS.md`](./PENDENCIAS.md))
- **Crons de Abandono e Lembretes corrigidos** (falhavam desde 2026-09-21) — ver [`N8N.md`](./N8N.md)
- **Webhooks do n8n autenticados** por cabeçalho `X-NailFlow-Webhook-Secret` (credenciais Header Auth; segredos `N8N_BOT_WEBHOOK_SECRET` e `N8N_NOTIFY_SECRET` só no `.env` e no n8n)
- **Bot:** classificador de respostas sim/não (`utils/replyClassifier.js`)
- **Agendamentos:** `clientId` de outra profissional recusado (400 "Cliente inválido.")
- **Clientes:** telefone normalizado e validado no painel (400 inválido, 409 duplicado), com a mesma regra do bot (`utils/phone.js`)
- **Migrations reproduzíveis:** 002 oficial restaurada, `002_bot_tables` movida para `_historico/`, novas 011–014; instalação nova idêntica a produção exceto o índice duplicado e comentários. **Nenhuma migration executada em produção** (não é necessário)
- **Seed compatível** com o schema atual (inclusão de `slug`)
- **Suíte automatizada: 57/57 passando**, em dois bancos descartáveis com resultado idêntico (setups de teste corrigidos: `slug` e telefone válido)

---

## Rodada de segurança V6–V17 (2026-09-28)

Auditoria numerada (itens 9–17) seguida de correções implementadas, testadas e commitadas:

- **Isolamento multi-tenant reforçado no banco**: foreign keys compostas `(id, professional_id)` (migration 017) garantem no PostgreSQL, não só na aplicação, que uma profissional nunca alcança dado de outra
- **Bloqueio/revogação de conta**: `blocked_at` + `token_version` (migration 016), checados a cada requisição autenticada direto no banco
- **Unicidade de instância WhatsApp**: índice único parcial em `wa_instance_name` (migration 015)
- **Rotas de instância WhatsApp mais seguras**: `PUT`/`DELETE /whatsapp/instance` removidas (permitiam assumir/orfanar instância sem sincronizar com a Evolution)
- **Bot**: `instance` obrigatório em todas as rotas (sem fallback), cancelamento valida dono do agendamento, CORS `*` removido de `/bot`
- **Dependências**: `qs`/`body-parser`/`express` atualizados via `npm audit fix` (sem `--force`); `react-router-dom` auditado e mantido em 6.30.6 (ver [`PENDENCIAS.md`](./PENDENCIAS.md) — não há exploração possível no uso atual)
- **Rate limiting**: por rota no Express (login, registro, conexão WhatsApp, página pública) e por IP no Nginx (`limit_req`)
- **Security headers e CSP**: HSTS, X-Content-Type-Options, X-Frame-Options, Referrer-Policy, Permissions-Policy e CSP (validada em Report-Only antes de aplicar, zero violações); `server_tokens off`; `X-Powered-By` oculto
- **Evolution API**: exposição pública fechada no Nginx (restrita por IP, confirmado o hairpin NAT do n8n/backend antes de aplicar); logs reduzidos de `VERBOSE`/`debug` para `ERROR,WARN`/`error` com rotação; imagem Docker fixada por digest exato
- **Permissões de arquivo**: `.env` (backend/frontend), `.pgpass` e o sqlite do n8n em `600`
- **Segredos em scripts**: senha do PostgreSQL removida de 5 scripts de teste em `/root/v2close-20260927/`, migrada para `/root/.pgpass`

**Pendente desta rodada** (ver [`PENDENCIAS.md`](./PENDENCIAS.md) para detalhes): PM2 (backend e n8n) ainda roda como root; 9 testes antigos esperando `body.token` no login; exports do n8n "Definitivo"/"Notificações" ainda não regenerados.

---

## Rodada Admin/Auditoria/Segurança (2026-09-29)

Trabalho de hoje, em 6 commits sequenciais em `feat/phase5-register`: `f1eb77a` → `bead346` → `ae4d3fa` → `6bcd398` → `5ae9d72` → `c49189b`.

### Agenda, Clientes e Serviços

- **Recorrência de agendamento "Por X dias"**: além de "Até uma data" (`AppointmentModal.tsx`), calcula `data inicial + X dias`; validado com casos de virada de mês/ano. Não muda o payload enviado ao backend (continua só `endsOn`)
- **Badge visual em Serviços**: "WhatsApp" (verde) ou "Somente Agenda" (neutro) no card, só para serviços ativos — mostra de relance quais serviços o bot/página pública oferece
- **Agenda sem limite de antecedência**: a navegação e criação de agendamentos na Agenda interna deixou de ser limitada por `booking_horizon_days`. Esse campo agora controla só o agendamento externo (WhatsApp + página pública); `Disponibilidade.tsx` foi ajustada para deixar isso explícito no texto

### Admin — bloquear, editar e excluir profissionais

Antes de hoje, o Admin só listava profissionais (leitura). Agora:

- **Bloquear/desbloquear** (`POST /admin/professionals/:id/block` e `.../unblock`): usa a infraestrutura que já existia (`blocked_at`, `token_version`, migration 016) — só faltavam os endpoints. Desbloqueio sobe `token_version`, forçando novo login. Impede autobloqueio
- **Editar** (`PUT /admin/professionals/:id`): reaproveita literalmente o mesmo schema/validação de `PUT /auth/me` (nome, negócio, WhatsApp, e-mail, foto); e-mail único; não permite editar a própria conta nem tocar em `slug`, `wa_instance_name`, `is_admin`, `blocked_at`, `token_version` ou senha — cada um desses tem fluxo próprio ou não deveria ser editável por aqui
- **Excluir definitivamente** (`DELETE /admin/professionals/:id`): fluxo em 3 passos — 1) snapshot da profissional e de todos os dados relacionados em `/var/backups/nailflow/deleted-professionals/` (arquivo `600`, diretório `700`, fora de `/var/www`, nunca servido pela aplicação, retenção de 90 dias autopodada a cada nova exclusão); 2) se houver `wa_instance_name`, exclui a instância na Evolution API — **se falhar, aborta e não mexe no banco**; 3) `DELETE FROM professionals` dentro de transação (os `ON DELETE CASCADE` da migration 017 apagam clientes/agendamentos/serviços/etc. na mesma operação). Exige digitar o nome exato do negócio para confirmar; impede autoexclusão e exclusão da última conta admin
- **Tela Admin responsiva**: abaixo de `md`, a tabela é substituída por cards (mesmo padrão visual de `Servicos.tsx`); desktop inalterado

### Audit log

- Nova tabela `admin_audit_log` (migration 019): `actor_id`, `actor_email`, `action` (`block`/`unblock`/`update`/`delete`), `target_id`, `target_business_name`, `created_at`. **Sem FK obrigatória** para `professionals` em nenhum dos dois lados — o registro precisa sobreviver à exclusão do ator ou do alvo
- `actor_email` e `target_business_name` ficam denormalizados de propósito, pelo mesmo motivo
- Função reutilizável `logAdminAction()` (`backend/src/utils/auditLog.js`), chamada nos 4 fluxos acima **só após sucesso confirmado** (no `delete`, só depois do `COMMIT`) — nesta primeira versão, tentativas/falhas não são registradas
- Sem senha, hash, token, `token_version` ou chave de API em nenhum registro
- ~~Ainda sem tela de auditoria~~ — a tela `/admin/auditoria` foi entregue em 2026-10-03 (`12dcff7`); ver o bloco "Admin — nova composição visual e Auditoria v1" acima

### Segurança — revisão completa do estado atual

Revisão dedicada em 2026-09-29, cobrindo autenticação/sessões, isolamento por `professional_id`, IDOR/BOLA, SQL injection, XSS, CSRF, CORS, headers, secrets/arquivos, rate limiting, dependências e as migrations 016–019. **Nenhum problema real encontrado** — nenhuma alteração de código foi necessária. Resumo:

- **Autenticação/sessões**: JWT em cookie `httpOnly`+`secure`+`sameSite=lax`; `blocked_at` e `token_version` checados a cada request autenticada (não só no login)
- **Isolamento/IDOR**: todo update/delete/get-by-id em `appointments`, `services`, `clients`, `expenses` usa `WHERE id = $1 AND professional_id = $2`; nenhuma exceção real encontrada (um `DELETE` sem esse filtro em `recurring_groups` opera só sobre um id gerado na própria request, não é explorável)
- **SQL/XSS/CSRF/CORS**: nenhuma interpolação de input de usuário em SQL (parametrização consistente); nenhum `dangerouslySetInnerHTML`/`eval`; CSRF mitigado pelo cookie `sameSite=lax`; CORS restrito ao domínio de produção com `credentials: true` (não é wildcard)
- **Headers/secrets/rate limiting**: HSTS/CSP/X-Frame-Options/etc. confirmados ao vivo via `curl` em produção; `X-Powered-By` oculto para tráfego externo; porta 3333 do Node bloqueada pelo firewall (UFW `default deny incoming`, só 22/80/443 liberados); `.env` em `600`, fora do Git; rate limit presente em login/registro
- **Dependências**: `npm audit` do backend limpo (0 vulnerabilidades); frontend com 2 vulnerabilidades **moderadas** em `react-router-dom` (não corrigidas agora — exigem bump major/breaking change; ver [`PENDENCIAS.md`](./PENDENCIAS.md), item I15)

### WhatsApp — pendência de validação prática (não mudou hoje) — histórico de 2026-09-29; C1–C3 foram **validadas em 2026-09-30 e 2026-10-01** (ver [`PENDENCIAS.md`](./PENDENCIAS.md))

Nada do trabalho de hoje envolveu WhatsApp/n8n/Evolution além da chamada de exclusão de instância já descrita acima (que só executa quando o Admin efetivamente exclui uma profissional com `wa_instance_name` configurado — não foi exercida contra nenhuma conta real). As pendências já registradas continuam de pé: ver [`PENDENCIAS.md`](./PENDENCIAS.md), itens **C1–C3** (validar mensagem real após reconectar, agendamento e cancelamento ponta a ponta pelo WhatsApp).

### 🟡 Pendências registradas hoje (não bloqueantes)

- Rate limiting nos endpoints `/admin/professionals/*` (bloquear/editar/excluir) — hoje protegidos só por JWT + `is_admin` (ver [`PENDENCIAS.md`](./PENDENCIAS.md), item M5 — **resolvido em 2026-10-01**, `26ae97f`)
- `react-router-dom`: 2 advisories moderados reconfirmados, decisão de não corrigir agora mantida (item I15)
- ~~Tela de histórico/auditoria no Admin~~ — entregue em 2026-10-03 (`12dcff7`)

### Próximos passos sugeridos

1. Validação prática do WhatsApp (C1–C3 em [`PENDENCIAS.md`](./PENDENCIAS.md)) — (em 2026-09-29, dependia de autorização e reconexão do `chip2`; feito em 2026-09-30 e 2026-10-01)
2. ~~Decidir se/quando construir uma tela de consulta do `admin_audit_log`~~ — feita em 2026-10-03 (`12dcff7`)
3. Avaliar o upgrade major do `react-router-dom` como tarefa própria, com sua rodada de testes

---

## Rodada Página Pública — Agendamento Online (2026-09-30)

Trabalho de hoje, em 6 commits sequenciais em `feat/phase5-register`: `648940b` → `7c17440` → `ec5643b` → `1617db5` → `9f88257` → `adf5164`. Precedido de uma auditoria completa do front (sem código alterado) e de um diagnóstico específico da página pública, ambos usados para priorizar o trabalho do dia.

### Correção de segurança nas rotas públicas legadas

- **Rate limit ausente em `/public/info` e `/public/availability`** (sem slug): corrigido aplicando o mesmo `publicRateLimit` já usado nas rotas por slug (`648940b`)
- **Aposentadoria do fluxo público sem slug** (`7c17440`): as rotas `/public/info` e `/public/availability`, que devolviam sempre os dados da "primeira profissional cadastrada" (vazamento entre contas assim que existisse mais de uma profissional paga), foram **removidas** do backend. `PaginaPublica.tsx` agora exige `:slug`; a rota legada `/agenda-publica` (sem slug) continua existindo mas mostra uma mensagem amigável ("Este link antigo não é mais válido...") em vez de tentar carregar qualquer dado. Confirmado que nenhum workflow n8n ativo dependia dessas rotas (só workflows já documentados como inativos em [`N8N.md`](./N8N.md) as referenciavam)

### Página pública — primeiros passos do agendamento online

Diagnóstico prévio mapeou toda a "engine" já reaproveitável (disponibilidade, timezone, validação de telefone, `EXCLUDE`/`UNIQUE` constraints do Postgres) antes de qualquer implementação. A partir daí, dois endpoints novos, só no backend (frontend não alterado ainda):

- **`GET /public/:slug/services`** (`ec5643b`): lista os serviços `active=true AND available_on_whatsapp=true` da profissional resolvida pelo slug (id, nome, preço, duração) — isolamento por `professional_id` garantido só pela resolução do slug, nunca aceito da requisição
- **`POST /public/:slug/appointments`** (`1617db5`): cria um agendamento sem autenticação, com:
  - `professional_id` resolvido exclusivamente pelo slug; `serviceId` validado contra essa profissional e `active=true AND available_on_whatsapp=true`; `clientId`/`professionalId` no corpo são ignorados (nem fazem parte do schema aceito)
  - status sempre nasce `'pendente'` (não é possível controlar pelo body)
  - cliente buscado por telefone normalizado (`utils/phone.js`); se existir, reaproveitado sem alterar nome; se não, criado vinculado à profissional do slug
  - limite de 3 agendamentos futuros (`pendente`/`confirmado`) por telefone+profissional
  - dois rate limits dedicados, mais restritos que os de leitura: 5 tentativas/10min por IP, 3 tentativas/10min por telefone normalizado+slug (a validação/normalização do telefone roda **antes** do rate limit por telefone, para a chave do limiter já vir normalizada)
  - `checkSlotAvailability()` como pré-checagem (mesma função da Agenda/bot); a `EXCLUDE` constraint do Postgres em `appointments` é a garantia final contra corrida entre duas requisições simultâneas — validado com um teste real de concorrência (`Promise.all`)
  - criação de cliente + agendamento dentro de uma única transação; `23P01`/`23505` tratados com `ROLLBACK` e resposta 409 (confirmado por teste que o cliente da requisição perdedora não fica órfão no banco)
  - sem `alternatives` na resposta de indisponibilidade nesta primeira versão; sem idempotency token; sem notificação/n8n (agendamento criado só aparece na Agenda/Dashboard da profissional)
- **Nenhuma migration foi necessária** — as constraints usadas já existiam no schema
- **15 testes novos** para o endpoint de criação (cliente novo, cliente existente sem alteração de nome, isolamento entre profissionais, serviço inativo/oculto, slug inexistente, telefone/nome inválidos, limite de futuros, horário indisponível, concorrência real, `clientId`/`professionalId` ignorados, rate limit por IP e por telefone+slug, rollback) + 3 testes para a listagem de serviços — suíte completa do backend em **107 testes, 91 passando** (16 falhas são a mesma pendência pré-existente de testes antigos de login, ver [`PENDENCIAS.md`](./PENDENCIAS.md), item I14)
- **Validação manual real** feita antes do commit final: `POST` bem-sucedido (201) contra a profissional de teste `teste-nailflow`, confirmado no banco, seguido de uma segunda tentativa idêntica corretamente rejeitada (409, `appointment_overlap`); dados de teste removidos depois

### Deploy e validação em produção (2026-09-30)

- `pm2 restart nailflow-backend` — sem restart inesperado, sem erro nos logs
- Smoke tests em produção: `GET /health` (200), `GET /services` sem token (401), `GET /public/teste-nailflow/services` (200), `POST /public/teste-nailflow/appointments` com `serviceId` inexistente (400) — nenhum agendamento real criado
- n8n e Evolution não foram tocados (uptime contínuo confirmado antes e depois do restart)

### Frontend — fluxo completo de agendamento em `PaginaPublica.tsx` (`9f88257`)

Implementado em etapas, cada uma validada com `tsc -b`/`vite build` antes de avançar:

- **Seleção de serviço**: consome `GET /public/:slug/services`, lista como botões (nome, duração, preço), guarda `selectedServiceId`; erro tratado com mensagem genérica (nunca `e.message` cru)
- **Disponibilidade por serviço**: a busca de horários passou a incluir `serviceId` na query sempre que um serviço está selecionado (usa o endpoint filtrado descrito abaixo); ao trocar de serviço, a grade antiga é limpa (`setData(null)`) antes da nova chegar, para nunca parecer clicável com a duração errada
- **Horário clicável**: os `<span>` informativos viraram `<button>`; desabilitados até haver serviço selecionado; horário escolhido guardado em `selectedSlot` e destacado visualmente
- **Formulário + revisão + confirmação**: campos de nome/telefone (validação só de "preenchido", nunca duplicando a regra de telefone do backend) → tela de revisão (serviço, data/hora, nome, telefone, editar/confirmar) → `POST /public/:slug/appointments` com exatamente os 4 campos esperados (`serviceId`, `startsAt`, `clientName`, `clientPhone` já normalizados/trim), sem enviar `clientId`/`professionalId`/`status`
- **Tela de sucesso**: deixa claro que é um **pedido pendente** ("Seu pedido foi enviado e está aguardando a confirmação da profissional"), nunca que já está confirmado
- **Tratamento de todas as respostas do `POST`**: 400/404/429/erro de rede → mensagem amigável genérica; `409 max_future_appointments` → mensagem específica, sem retry automático; `409` de indisponibilidade (`appointment_overlap`, `conflict` e demais reasons) → limpa o horário selecionado, volta ao formulário e recarrega a disponibilidade automaticamente
- **Correção de corridas de estado** (achada em revisão antes do commit): botões de serviço/horário desabilitados durante o envio (`submitting`); `loadAvailability()` passou a usar um contador de requisição (`useRef`) para descartar respostas antigas fora de ordem — evita que uma troca rápida de serviço, ou um `409` tardio, sobrescreva a disponibilidade do serviço atualmente selecionado

### Backend — disponibilidade filtrada por serviço (`adf5164`)

- **`GET /public/:slug/availability` ganhou `serviceId` opcional**: sem o parâmetro, comportamento 100% inalterado (menor duração entre os serviços públicos); com o parâmetro, valida o serviço contra a profissional do slug (`active=true AND available_on_whatsapp=true`) e usa a duração dele para calcular a grade — mesma `getAvailableSlots()` de sempre, nenhuma regra de disponibilidade duplicada
- `serviceId` inválido/de outra profissional/inativo/oculto/malformado → `400` genérico, sem detalhe interno
- **8 testes novos** (`public-availability-serviceid.test.js`): comportamento sem `serviceId` inalterado, duração menor vs. maior gerando grades diferentes de fato, isolamento entre profissionais, serviço inativo/oculto rejeitado, `serviceId` inexistente/malformado

### 🟡 Pendências registradas em 2026-09-30 (não bloqueantes) — histórico

- ~~Sem notificação (WhatsApp/n8n) quando uma cliente agenda sozinha pela rota pública~~ — **resolvido em 2026-10-01** (F9: evento `appointment.public_created`; entrega real ainda sem validação com número real, ver [`PENDENCIAS.md`](./PENDENCIAS.md)); desde 2026-10-03 só sai para profissional com instância própria
- Sem limite configurável de agendamentos futuros por telefone (hoje fixo em 3, hardcoded) — considerar se deve virar configuração por profissional no futuro (continua assim; M7 em [`PENDENCIAS.md`](./PENDENCIAS.md))

### Próximos passos sugeridos (em 2026-09-30) — histórico

1. ~~Decidir sobre notificação da profissional na criação de agendamento público~~ — feito (F9)
2. Observar os logs de produção nos primeiros dias após uso real da rota nova, dado que é a primeira rota pública de escrita do sistema
3. ~~Deploy e validação em produção do fluxo de frontend + disponibilidade por serviço~~ — feito: a página pública completa está em produção (ver o bloco "Estado atual" acima)

---

## O que NÃO está publicado

| Item | Situação |
|---|---|
| Recuperação de senha ("Esqueci minha senha") | ❌ não publicada |
| Troca de senha logada | ✅ publicada em 2026-10-08 (ADM V1, `PUT /auth/password` — versão do repositório, não a do `nailflow-next`) |
| Invalidação de sessões após troca de senha | ✅ publicada em 2026-10-08 (`token_version`; também `POST /auth/logout-all`) |
| Normalização de e-mail no login | ❌ não publicada |

A recuperação de senha **continua isolada e não publicada**. (`NODE_ENV=production` já está aplicado em produção desde 2026-09-27, fora do escopo do `nailflow-next` — cookie de sessão já sai com `Secure`.)

Existe uma **implementação isolada** desses itens em `/opt/nailflow-next` (fora do repositório e fora de produção), validada somente em ambiente de teste com banco descartável. **O Brevo (SMTP) ainda não está configurado.** Nada disso deve ser tratado como funcionalidade disponível até a publicação autorizada.

Também existe `frontend/dist-next/` (build candidato dessa implementação), ignorado pelo Git e **não servido** pelo Nginx.

---

## Arquivos fora do Git (por design)

| Arquivo/Pasta | Motivo |
|---|---|
| `backend/.env`, `frontend/.env`, `.env.*` | Segredos e configuração de produção |
| `backend/backup_*/`, `**/backup_*.sql`, `*.bak*` | Backups de dev e dumps |
| `frontend/dist/`, `frontend/dist-*/`, `dist.bak*` | Builds compilados |
| `*.pem`, `*.key`, `*.sqlite`, `*.pid`, `*.eml`, `mail-out/`, `coverage/` | Chaves, bancos locais e artefatos de teste |

Regras definidas no `.gitignore` (atualizado em `b26d682`). Sempre adicionar arquivos ao Git **por nome** — nunca `git add .`.

---

## Estado dos serviços (histórico: verificado em 2026-09-25; n8n e Evolution conferidos em 2026-09-27 — o estado de 2026-10-03 está no bloco "Estado atual" no topo)

| Serviço | Status |
|---|---|
| nailflow-backend (PM2 id 0) | online |
| n8n (PM2 id 4) | online |
| Evolution API (Docker: `evolution`, `evolution-db`, `redis`) | running |
| Nginx | active |
| PostgreSQL 16 | listening em localhost |
| UFW | active (22, 80, 443) |
| n8n — 4 workflows ativos (em 2026-09-27) | Definitivo, Notificações, Abandono e Lembretes; crons com execuções `success` em 2026-09-27. **Em 2026-10-03 são 6 ativos:** + Solicitação Recusada e Mensagem à Cliente |

### Instâncias WhatsApp

- **Em 2026-10-03:** `chip2` **`open`** (WhatsApp pessoal da responsável, usado de propósito pelo perfil de teste Camila) e `chip2-teste` `connecting`; ver [`WHATSAPP_EVOLUTION.md`](./WHATSAPP_EVOLUTION.md)
- Histórico: o `chip2` foi desconectado intencionalmente em 2026-09-27 (estava `open` em 2026-09-25) e reconectado em 2026-09-30, com a primeira mensagem real validada
- Não conectar, desconectar nem reconectar instâncias sem autorização

---

## Versões

| Componente | Versão |
|---|---|
| Node.js | v22.23.2 |
| npm | 10.9.8 |
| PostgreSQL | 16.15 |
| PM2 | 7.0.4 |
| Evolution API | 2.3.7 |
| n8n | 2.35.7 |
| React | 18.3.1 |
| TypeScript | 5.5.3 |
