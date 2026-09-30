# NailFlow — Pendências e Auditoria

> Atualizado em 2026-09-30.

---

## Atenção antes de reconectar o `chip2`

- O webhook `whatsapp-nailflow` passou a exigir o cabeçalho `X-NailFlow-Webhook-Secret` em 2026-09-27 e **ainda não recebeu nenhuma mensagem real** com essa configuração
- Ao reconectar, acompanhar a primeira mensagem: se o n8n responder 403, o bot fica mudo. Rollback em [`N8N.md`](./N8N.md)
- A reconexão é feita pela responsável; `chip2` e `chip2-teste` estão desconectados intencionalmente

---

## Recuperação e troca de senha — NÃO publicadas

- Implementação isolada em `/opt/nailflow-next` (fora do Git e fora de produção), validada apenas em ambiente de teste com banco descartável e SMTP simulado
- Inclui: "Esqueci minha senha" por e-mail, troca de senha logada, invalidação de sessões anteriores, normalização de e-mail no login e `NODE_ENV=production` (cookie `Secure`)
- **Bloqueios para publicar:** conta Brevo e remetente configurados; `SMTP_PASS` inserido pela responsável no `.env` do servidor; autorização explícita
- Ordem de publicação exigida: migration → backend (`npm install`) → `.env` → restart → troca `dist` ↔ `dist-next`
- **Não documentar nem divulgar como funcionalidade disponível** até a publicação

---

## Auditoria de pendências

### 🔴 Crítico

**C1. Validar a primeira mensagem real após reconectar o `chip2`** (webhook com Header Auth, bot, classificador sim/não)

**C2. Testar agendamento completo pelo WhatsApp com uma cliente real**
- O fluxo foi validado via `/bot/process` com telefone de teste após a correção do `$1`; falta um teste ponta a ponta pelo WhatsApp (mensagem → serviço → data → horário → confirmação)

**C3. Testar cancelamento pelo WhatsApp**

**C4. Integrar V1/V2 ao `main`**
- `main` local e `origin/main` estão divergentes e não contêm V1 nem V2; todo o trabalho está em `feat/phase5-register`

~~**C5. Revisão final e commit/push das mudanças de 2026-09-27**~~ — feito em 2026-09-28 (commit da rodada de segurança V6–V17). Os 2 exports do n8n regenerados (Abandono/Lembretes) e o restante ainda pendente (Definitivo/Notificações) seguem em I9.

---

### 🟠 Importante

**I1. Publicar recuperação/troca de senha** — ver seção acima.

**I2. Node "Registrar Mensagem Bot" sem `instance`**
- Retorna 400 com mais de uma profissional cadastrada; as mensagens do bot não são gravadas em `message_history` (o envio à cliente não é afetado)
- Correção: incluir o nome da instância na chamada `POST /bot/record-sent` do workflow (altera workflow — só com autorização)

**I3. SSH aceita login de root com senha**
- `PermitRootLogin yes` e `PasswordAuthentication yes`. Recomendado passar para acesso somente por chave, **depois** de confirmar que o acesso por chave funciona (risco de perder o acesso se feito sem confirmação)

**I4. Painel do n8n público via HTTPS**
- Protegido apenas pelo login do n8n. Usar senha forte e, se possível, 2FA; restringir por Nginx fica para depois

**I5. Conexão WhatsApp via painel (QR pelo sistema) — teste completo** com instância de teste

**I6. Modo ATENDIMENTO_HUMANO — teste completo**: frase de escape, TTL de 4h, retorno automático

**I7. 3 tentativas inválidas → ATENDIMENTO_HUMANO** — validar

**I8. Variável `N8N_API_KEY`** — não é usada no código e já não consta do `.env.example`; falta removê-la do `.env` do servidor (o mesmo vale para `N8N_PROFESSIONAL_ID`, também não lida pelo código)

**I9. Regenerar os exports do "Definitivo" e do "Notificações"**
- Os exports de Abandono e Lembretes já foram regenerados das versões publicadas (2026-09-27) e podem ser versionados
- Falta gerar, do mesmo jeito e sem credenciais, os do "WhatsApp NailFlow — Definitivo" e do "NailFlow — Notificações"; os arquivos antigos na pasta não refletem as versões publicadas

**I10. Validar envio real de lembrete e de abandono** após a correção dos crons (os loops internos ainda não rodaram com itens)

**I11. Notificação de confirmação/cancelamento pelo painel** — validar com o cabeçalho novo

---

**I12. Migrations 015–017, middleware e rotas da rodada de segurança (2026-09-28) sem commit**
- Unicidade de `wa_instance_name`, bloqueio de conta (`blocked_at`/`token_version`), foreign keys compostas cross-tenant, validação de ownership no bot, rate limiting de rotas sensíveis, CORS do `/bot` restrito — tudo já aplicado e testado em produção, faltando só o commit/push (ver "Resolvido" abaixo)

**I13. PM2 (backend e n8n) rodando como root**
- Auditado em 2026-09-28: sem necessidade técnica (nenhuma porta privilegiada, nenhum acesso a dispositivo) — é assim porque o PM2 foi originalmente configurado como serviço do usuário root (`pm2-root.service`)
- Risco: um RCE futuro em qualquer um dos dois processos dá acesso root ao servidor inteiro, sem contenção
- Migração para usuários dedicados desenhada mas **não implementada** — depende de mover o `database.sqlite` do n8n para fora de `/root` (operação sensível, precisa de janela de manutenção e testes)

**I14. 9 testes antigos esperando `body.token` no login**
- `auth-flow.test.js`, `price-snapshot.test.js`, `availability-check.test.js` — quebraram quando o `token` foi removido do corpo da resposta de login (a sessão passou a ser só via cookie JWT), mudança já aprovada e aplicada
- Os testes precisam ser atualizados para usar o cookie em vez de `body.token`; não é uma regressão de produção, é a suíte que ficou desatualizada

**I15. React Router mantido em 6.30.6 (decisão registrada, não uma pendência ativa)**
- Auditoria de 2026-09-28 nos dois advisories do `npm audit` (open redirect e SSR hydration) concluiu que **nenhum é explorável no NailFlow hoje**: todo destino de navegação (`<Link>`/`navigate()`) é string fixa no código, e o app usa Declarative Mode sem SSR (o segundo advisory se autoexclui para esse modo)
- Não é necessário corrigir agora; revisar só se uma funcionalidade futura introduzir navegação com destino dinâmico/vindo de URL ou API, ou uso de SSR
- **Reconfirmado em 2026-09-29** (revisão de segurança do audit log/admin): `npm audit` do frontend continua reportando as mesmas 2 vulnerabilidades moderadas em `react-router-dom` (`package.json` fixa `^6.26.0`). Correção via `npm audit fix --force` seria um bump major (breaking change, o próprio npm avisa) — decisão de não aplicar agora se mantém pelo mesmo motivo já registrado acima. Reavaliar só se as condições descritas mudarem.

### 🟡 Melhoria

**M1. Workflows duplicados no n8n**
- Remover versões antigas (WhatsApp Principal x2, Lembretes duplicado, Verificação Meta x4)

**M2. Webhooks antigos no n8n**
- `evolution-chip2` e `nailflow/mensagem-recebida` pertencem a workflows inativos

**M3. Índice duplicado em `message_history`**
- `message_history_dedup_idx` repete `idx_message_history_wa_id`; existe só em produção. Remoção deixada deliberadamente para depois — não é urgente

**M3b. `message_history.client_id`**
- Coluna não usada pelo código (0 linhas preenchidas); decidir se passa a ser gravada ou se é removida

**M4. Numeração das migrations**
- A 002 é aplicada antes da 001 e há dois "003" no histórico. Não causa erro, mas exige seguir a ordem documentada em [`BANCO_DE_DADOS.md`](./BANCO_DE_DADOS.md)

**M5. Rate limiting nos endpoints administrativos**
- `block`/`unblock`/`update`/`delete` de profissionais (`/admin/professionals/*`) não têm rate limit próprio, diferente de login/registro. Risco baixo hoje (já exige JWT + `is_admin`), mas seria defesa em profundidade — achado da revisão de segurança de 2026-09-29

**M7. Limite de agendamentos futuros por telefone (rota pública) é fixo, não configurável**
- `POST /public/:slug/appointments` limita a 3 agendamentos futuros pendentes/confirmados por telefone+profissional, hardcoded no controller. Considerar se deve virar configuração por profissional no futuro — achado da implementação de 2026-09-30

**M6. Migração do número real da profissional**
1. Criar nova instância Evolution
2. Parear com o número real (⚠️ uma tentativa de QR, sem loop)
3. Atualizar `wa_instance_name` no banco
4. Conferir o webhook na Evolution
- **NUNCA conectar o número real sem testes e autorização explícita**

---

### 🟢 Futuro

**F1. Campanhas de WhatsApp** (envio em massa / reativação de clientes inativas) — não implementado
**F2. Monitoramento de produção** — alertas de queda do bot e de falha dos crons (a falha de 2026-09-21 passou dias sem ser percebida; e um cron pode terminar "success" sem trabalhar)
**F3. Autenticação** — revisar expiração do JWT; refresh token; CSRF
**F4. Rate limiting por número no bot**
**F5. Export de dados (LGPD)**
**F6. Logs estruturados** (Winston/Pino)
**F7. Versão pública para portfólio** — repositório separado, com histórico novo e sem infraestrutura/segredos
**F9. Notificação da profissional ao receber agendamento pela página pública** — hoje o agendamento criado pela rota pública só aparece na Agenda/Dashboard; decisão pendente sobre avisar via WhatsApp/n8n em tempo real

---

## Resolvido

| Item | Quando | Como |
|---|---|---|
| `POST nailflow/notificacoes` → 404 | até 2026-09-22 | Workflow "Notificações" ativado; webhook registrado |
| Commitar Bloco 5 CRM + rotas WhatsApp | V1 (`d82603c`) | Versionados |
| Bot sem resposta após escolher serviço (`$1` ausente) | 2026-09-24 | Query corrigida; versionada em `b26d682` |
| Backend (3333) e n8n (5678) expostos na internet | 2026-09-25 | UFW ativo; públicas só 22/80/443 |
| Mudanças de produção sem commit e migrations não versionadas | 2026-09-25 | Commit `b26d682` com migrations 007–010 |
| `.gitignore` incompleto (`.env.*`, `dist-*`, dumps, chaves) | 2026-09-25 | Atualizado em `b26d682` |
| Multi-profissional real | até 2026-09-25 | Várias profissionais cadastradas; crons e bot iteram por instância |
| Crons de Abandono e Lembretes falhando desde 2026-09-21 | 2026-09-27 | Loop por instância com saídas corrigidas, Always Output Data e condição de "Tem lembretes?" (ver [`N8N.md`](./N8N.md)) |
| Webhooks do n8n sem autenticação | 2026-09-27 | Header Auth com `X-NailFlow-Webhook-Secret` nos dois webhooks ativos |
| Bot confirmava respostas ambíguas ("segunda seria melhor") | 2026-09-27 | `classifyReply` |
| Agendamento aceitava `clientId` de outra profissional | 2026-09-27 | `assertOwnClient` (400) |
| Telefone de cliente gravado como digitado no painel | 2026-09-27 | Normalização, 400 e 409 (`utils/phone.js`) |
| Migrations não reproduziam produção (51 divergências; 002 obsoleta na ordem) | 2026-09-27 | 002 oficial restaurada, obsoleta em `_historico/`, novas 011–014 |
| `expenses` não documentada | 2026-09-27 | [`BANCO_DE_DADOS.md`](./BANCO_DE_DADOS.md) |
| `.env.example` com nomes antigos | até 2026-09-27 | Usa `N8N_WEBHOOK_CONFIRMED_URL` / `N8N_WEBHOOK_CANCELLED_URL` e os nomes dos novos segredos, sem valores |
| Exemplo de QR com valor real em `WHATSAPP_EVOLUTION.md` | 2026-09-27 | Trocado por placeholder |
| Exports de Abandono e Lembretes errados (saídas do loop trocadas) | 2026-09-27 | Regenerados com `n8n export:workflow --published` das versões `d566c2fe` / `9da88cb4`; sem segredos |
| `seed.sql` quebrado e 30 testes falhando (sem `slug`) | 2026-09-27 | `slug` no seed e nos setups de teste; telefone válido no `price-snapshot`; suíte 57/57 em dois bancos descartáveis |
| `wa_instance_name` sem unicidade (duas profissionais podiam assumir a mesma instância) | 2026-09-28 | Índice único parcial (migration 015) |
| `PUT`/`DELETE /whatsapp/instance` permitiam assumir/orfanar instância sem sincronizar com a Evolution | 2026-09-28 | Rotas removidas; só `/evolution-instance` configura/remove, sincronizando com a Evolution |
| Sem forma de bloquear/revogar sessão de uma profissional | 2026-09-28 | `blocked_at` + `token_version` (migration 016), checados a cada `requireAuth`/`requireAdmin`/`botAuth` direto no banco |
| Isolamento entre profissionais garantido só na aplicação, não no banco | 2026-09-28 | Foreign keys compostas `(id, professional_id)` em clients/services/recurring_groups → appointments/message_history (migration 017) |
| `/bot/record-sent` sem `waInstance` obrigatório | 2026-09-28 | `instance` agora obrigatório (400 se ausente), sem fallback |
| Cancelamento pelo bot sem checar dono do agendamento | 2026-09-28 | `findClientByPhone` + `client_id` exigido no `WHERE` do SELECT e do UPDATE |
| CORS `*` nas rotas `/bot` | 2026-09-28 | Removido; `/bot` herda o CORS restritivo global |
| `qs` — vulnerabilidade do `npm audit` (Item 17) | 2026-09-28 | `npm audit fix` (sem `--force`): `qs` 6.15.3→6.16.0, `body-parser`, `express` — patch dentro do range já fixado no `package.json` |
| Sem rate limit em rotas sensíveis (login, registro, conexão WhatsApp, página pública) | 2026-09-28 | Rate limit por rota no Express (`express-rate-limit`) + `limit_req` no Nginx |
| Sem security headers / CSP | 2026-09-28 | HSTS, X-Content-Type-Options, X-Frame-Options, Referrer-Policy, Permissions-Policy e CSP (validada em Report-Only antes de aplicar); `server_tokens off`; `X-Powered-By` ocultado |
| Evolution API exposta publicamente pelo Nginx | 2026-09-28 | `location /` restrito por IP (loopback + IP público da própria VPS, confirmado por teste ao vivo do hairpin NAT do n8n/backend) |
| Evolution com logs em `VERBOSE`/`debug` (volume alto, dados sensíveis) | 2026-09-28 | `LOG_LEVEL=ERROR,WARN`, `LOG_BAILEYS=error`, rotação de log do container |
| Imagem Docker da Evolution na tag `latest` (pode mudar sem aviso) | 2026-09-28 | Fixada por digest exato (`@sha256:...`) |
| `.env`, `.pgpass`, sqlite do n8n com permissão `644` | 2026-09-28 | `600` (conteúdo verificado inalterado) |
| Senha do PostgreSQL em texto puro em 5 scripts (`/root/v2close-20260927/`) | 2026-09-28 | Migrados para `/root/.pgpass` (`600`); `PGPASSWORD`/`DATABASE_URL` com credencial removidos dos 5 scripts; validado com `psql`/`pg_dump`/`node` sem regressão |
| Admin não tinha como bloquear/desbloquear uma profissional (só via SQL manual) | 2026-09-29 | `POST /admin/professionals/:id/block` e `.../unblock` (migrations 016 já existiam; endpoints novos), com confirmação na UI e impedimento de autobloqueio |
| Admin não tinha como editar cadastro de outra profissional | 2026-09-29 | `PUT /admin/professionals/:id`, reaproveitando o schema/regras de `PUT /auth/me`; não permite editar `slug`/`wa_instance_name`/`is_admin`/`blocked_at`/`token_version`/senha |
| Admin não tinha como excluir uma profissional | 2026-09-29 | `DELETE /admin/professionals/:id`: snapshot em disco (permissão 600/700, fora de `/var/www`, retenção de 90 dias) → exclui instância na Evolution se houver (aborta sem tocar no banco se falhar) → exclusão em transação; exige digitar o nome do negócio; impede autoexclusão e exclusão do último admin |
| Nenhuma ação administrativa (bloquear/editar/excluir) deixava rastro de quem fez o quê | 2026-09-29 | Tabela `admin_audit_log` (migration 019) + `logAdminAction()`, chamada nos 4 fluxos só em caso de sucesso; `actor_email`/`target_business_name` denormalizados para sobreviver à exclusão de qualquer uma das contas |
| Tela Admin ilegível/espremida no celular (única página do app com `<table>` crua) | 2026-09-29 | Tabela mantida em `md:` e acima; abaixo disso, cards responsivos (mesmo padrão visual de `Servicos.tsx`) |
| Revisão completa de segurança (auth, isolamento/IDOR, SQLi/XSS/CSRF/CORS, headers, secrets, rate limiting, dependências, migrations 016–019) | 2026-09-29 | Nenhum problema real encontrado; ver [`STATUS_ATUAL.md`](./STATUS_ATUAL.md) para o resumo e os 🟡 acima (M5, I15) para o que ficou registrado como pendência não bloqueante |
| `/public/info` e `/public/availability` (sem slug) sem rate limit | 2026-09-30 | `publicRateLimit` aplicado às duas rotas legadas |
| `/public/info` e `/public/availability` (sem slug) devolviam sempre a "primeira profissional cadastrada" — vazamento entre contas | 2026-09-30 | Rotas removidas; `PaginaPublica.tsx` exige `:slug`; `/agenda-publica` (sem slug) mostra mensagem de link antigo em vez de qualquer dado |
| Página pública não tinha como listar os serviços de uma profissional | 2026-09-30 | `GET /public/:slug/services` — só `active=true AND available_on_whatsapp=true`, isolado por slug |
| Não existia forma de criar agendamento sem autenticação (fluxo público) | 2026-09-30 | `POST /public/:slug/appointments` — status sempre `pendente`, limite de 3 futuros por telefone, rate limit dedicado (IP e telefone+slug), transação com rollback em `23P01`/`23505`, `EXCLUDE` constraint do Postgres como garantia final de concorrência (15 testes novos, incluindo teste de corrida real) |
| Frontend do agendamento online pela página pública (antigo F8) | 2026-09-30 | `PaginaPublica.tsx`: seleção de serviço, horário clicável, formulário de nome/telefone, revisão e confirmação, tela de sucesso deixando claro que é um pedido pendente; todos os `409`/`429`/`400`/`404`/erro de rede tratados com mensagens amigáveis (`9f88257`) |
| Disponibilidade da página pública sempre calculada pela menor duração entre os serviços, mesmo com um serviço específico já escolhido | 2026-09-30 | `GET /public/:slug/availability` ganhou `serviceId` opcional; sem ele, comportamento inalterado; com ele, valida o serviço contra a profissional do slug e usa a duração real dele (`adf5164`, 8 testes novos) |
| Corridas de estado no frontend do agendamento público (troca de serviço/horário durante um `POST` em andamento; resposta antiga de disponibilidade sobrescrevendo a atual) | 2026-09-30 | Botões de serviço/horário desabilitados durante `submitting`; `loadAvailability()` usa contador de requisição (`useRef`) para descartar respostas fora de ordem (incluído no commit `9f88257`) |
