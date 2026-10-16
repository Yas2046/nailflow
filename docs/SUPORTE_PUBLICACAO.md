# Central de Suporte: checklist de publicação e rollback

> Roteiro para a V1. **Estado em 2026-10-16:** as migrations 023/024 e o backend (`main` em `c404c8e`, em execução desde
> 2026-10-15 11:21 UTC) **já estão em produção**, e o `dist` servido (build de 2026-10-15) já carrega a interface da
> Central, mas **a Central está desativada** (`SUPPORT_CENTER_ENABLED` ausente: as rotas respondem 404 e nada aparece).
> **Ainda não publicados:** o aviso de privacidade novo do formulário (branch `feat/suporte-aviso-privacidade`), o guarda de
> `Origin` contra CSRF (backend, **exige reinício**), a FAQ inicial e a flag. Os fatos de produção abaixo foram conferidos por leitura em 2026-10-16 (sem alterar nada), **exceto a
> linha de backups, atualizada em 2026-10-13** depois da correção dos backups, que **foi executada** (ver
> [`SUPORTE_BACKUPS_PROPOSTA.md`](./SUPORTE_BACKUPS_PROPOSTA.md), seção 0). Decisões que bloqueiam a ativação:
> [`SUPORTE_DECISOES.md`](./SUPORTE_DECISOES.md). Contratos: [`ROTAS_E_ENDPOINTS.md`](./ROTAS_E_ENDPOINTS.md).

## Fatos de produção que mudam o procedimento

| Fato | Consequência |
|---|---|
| Banco `nailflow` (PostgreSQL 16, ~11 MB), acessado pelo `postgres` via socket (`sudo -u postgres psql -d nailflow`). | Migrations 023/024 foram aplicadas assim, como as anteriores (`docs/BANCO_DE_DADOS.md`). |
| A aplicação conecta como a role **`nailflow`** (não superusuária). `professionals` e quase todas as tabelas pertencem a **`postgres`** (com `GRANT` à `nailflow`); `admin_audit_log` e `recurring_exceptions` pertencem a `nailflow`. | A 023 **precisa** rodar como `postgres` (faz `ALTER TABLE professionals`), e ela **não tem GRANT**: as tabelas novas nascem sem acesso para a `nailflow` e toda operação de suporte falha com `permission denied` (42501). **Reproduzido em banco descartável.** É obrigatório aplicar `backend/db/migrations/_ops/023_grant_app_role.sql` depois da 023. |
| Migrations 023 e 024 **já estão aplicadas em produção**: conferido em 2026-10-16, o catálogo de produção é idêntico ao de um banco construído com essas migrations, e os `GRANT`s da role `nailflow` batem com `_ops/023_grant_app_role.sql`. | A seção 3 é só **verificação em leitura**; não reaplicar. |
| `backend/src` e `frontend/src` de produção estão no commit `c404c8e` (`main`, checkout limpo). O backend roda esse código desde 2026-10-15 11:21 UTC e o `dist` servido (`index-C9UyQW3Z.js`) é reproduzível: um build de `main` com a URL real da API sai **idêntico byte a byte**. | **Nunca** rodar `npm run build` dentro de `/var/www/nailflow/frontend`: voltaria o frontend. Construir a partir do commit aprovado, em pasta temporária. |
| Sem mudança de dependências nos commits da branch (`package.json` e lock idênticos). | Não há `npm install` no backend. |
| PM2 id 0 `nailflow-backend` (`bash -c "npm start"`, modo fork, cwd `/var/www/nailflow/backend`). `reload` em modo fork equivale a `restart` (~10 s fora do ar; o n8n repete 5 × 3 s, conforme `DEPLOY.md`). | Escolher horário calmo. |
| nginx serve `/var/www/nailflow/frontend/dist`; `/api/` vai para `localhost:3333/`; CSP `connect-src 'self'`. | A API do bundle precisa ser a mesma origem (`VITE_API_URL`). |
| Backups (conferido em 2026-10-13, depois da correção): `nailflow-backup.sh` novo instalado (SHA-256 `d450310b…a1b9`), cron das 03:00 inalterado, retenção de 7 dias. `/var/backups/nailflow` e `manual/` em `700 root:root`; `backup.log` em `600 root:root`; os 9 dumps antigos seguem `664 postgres:postgres` dentro do diretório 700; os novos nascem `600 root:root`. Precedente de backup antes de migration: `/var/backups/nailflow/nailflow_pre-migration-02N_*.dump`. | Backup manual antes da 023, **no formato compatível com o diretório 700** (arquivo aberto pelo `root`, seção 1). A forma `pg_dump -f <arquivo>` (arquivo criado pelo `postgres`) **falha**. A primeira execução noturna do script novo (2026-10-14) e a restauração real ainda estão **pendentes** de verificação: ver [`SUPORTE_BACKUPS_PROPOSTA.md`](./SUPORTE_BACKUPS_PROPOSTA.md), seção 0. |
| O código novo é **fail-closed**: sem `SUPPORT_CENTER_ENABLED=true` no `.env`, `/support/*` e `/admin/support/*` respondem 404 e a interface não mostra nada. | Foi assim que as migrations e o backend foram publicados; o frontend do aviso e a FAQ também entram **antes** de ligar a Central. |
| `FRONTEND_URL` de produção é `https://nailflow.duckdns.org` (visto no cabeçalho CORS ao vivo, sem ler o `.env`) e o `.env` define `NODE_ENV=production`. | Com o guarda de `Origin`, em produção essa variável **ausente ou inválida impede o servidor de iniciar**: conferir antes de reiniciar (seção 4). |

## 0. Antes de começar (decisões)

- [ ] **Aviso de privacidade do formulário** (bloqueia ligar; ver `SUPORTE_DECISOES.md`). A política de privacidade completa
  **não** é pré-requisito (decisão de 2026-10-16): ver os itens A, B e C abaixo.
- [ ] **Backups conferidos:** o log da noite anterior mostra a execução das 03:00 do script novo sem `ERRO`, existe o
  dump novo e o diretório continua `700 root:root` (primeira noite conferida em 2026-10-14 por leitura (sem `ERRO`, dump novo presente); repetir no dia da publicação); a guarda de
  cópias de dumps foi removida **com autorização separada** ou continua dentro do prazo decidido (ver
  `SUPORTE_BACKUPS_PROPOSTA.md`, seção 0). Quem executar o backup do passo 1 deve ser o `root` (diretório 700).
- [ ] **Privacidade e retenção** ([`SUPORTE_PRIVACIDADE_RETENCAO.md`](./SUPORTE_PRIVACIDADE_RETENCAO.md)):
  - **A. Publicação e ativação da Central (bloqueia ligar):** publicar o aviso curto do formulário, o componente
    `SupportPrivacyNotice` com o texto de `frontend/src/content/avisoPrivacidade.ts`. Ele mostra o contato de privacidade e **não**
    linka a política enquanto `POLICY_PAGE_PUBLISHED` for `false`. O aviso antigo ("mantidas conforme a política de privacidade do
    NailFlow", política que não está publicada) **não pode** ficar no ar com a Central ligada. Hoje o aviso novo está na branch
    de desenvolvimento `feat/suporte-aviso-privacidade`, ainda não publicado em produção, e o texto em produção é o antigo. Como validar e compilar sem publicar a política: `DEPLOY.md` (build só do aviso) e
    `node --test frontend/tests/support-notice.test.mjs`;
  - **B. Publicação futura da política de privacidade (não faz parte desta publicação e não bloqueia ligar):** página `/privacidade`,
    rota, links de rodapé e documentos de LGPD ficam para depois da revisão jurídica e do preenchimento dos campos pendentes. O
    link do aviso para a política só pode ser habilitado nessa publicação futura (`POLICY_PAGE_PUBLISHED = true`), e os testes
    recusam habilitá-lo sem política pronta, sem marcadores, sem rota, sem página e sem documentos livres de pendência;
  - **C. Trava específica da política (`PRIVACY_RELEASE_CHECK=1`):** vale para o build que **publica a política** (rota `/privacidade`,
    links de rodapé ou `POLICY_PAGE_PUBLISHED = true`; se `/privacidade` aparecer no bundle, é esse caso). Nele, rodar
    `PRIVACY_RELEASE_CHECK=1 node --test frontend/tests/privacy.test.mjs` (Node >= 22.18). Ele falha enquanto houver campo
    pendente, marcador (TODO, A INFORMAR, A DEFINIR, [CONFIRMAR]) ou revisão jurídica sem revisor e data. O teste não prova que a
    revisão aconteceu: quem publica confirma isso por fora. **Não publicar a política se falhar.** A trava **não foi enfraquecida**
    e **não é exigida** para o build só do aviso (A);
  - **retenção dos snapshots de exclusão (30 dias), estado conferido em 2026-10-16 por leitura:** o `.retention-hold` **já existe**
    (criado em 2026-10-14, `600 root`) e lista **563** dos **569** snapshots. Os **6** fora dele são sintéticos, gerados em
    2026-10-16 por uma execução de testes (nomes `temp_delete_*` e `temp_audit_*@nailflow.com`); só completam 30 dias em
    2026-11-15 e **não** foram apagados. O snapshot mais antigo é de 2026-09-29 (hoje com 17 dias; completaria 30 em 2026-10-29,
    mas está no hold). A limpeza por tempo (`pruneSnapshots`) roda **na exclusão de uma conta pela ADM** e respeita o hold; o
    cron de limpeza (`ops/cron/support-retention.cron.example`) **não** está instalado e fica para depois, com autorização.
    **Esta publicação não exclui nenhuma conta** (a conta de teste, Camila Souza, é preservada: seção 7); portanto não gera snapshot nem aciona a limpeza.
    Se alguma exclusão de conta vier a ocorrer depois, conferir antes que o hold continua em pé: `wc -l < /var/backups/nailflow/deleted-professionals/.retention-hold` = 563;
  - rotina de chamados resolvidos (6 meses) agendada com autorização, **antes do primeiro vencimento**;
  - rotação de 14 dias dos logs do PM2 instalada (`ops/logrotate/nailflow-pm2`, com autorização);
  - auditoria: `audit_enabled=on` **só** depois da validação de privacidade (desligada por padrão).
- [x] Frontend refinado, rascunhos por conta e correção da exclusão de profissional x WhatsApp **no `main` (`c404c8e`) e em produção** (`c86c9dc`, `cedf8e3`, `dfd91ce`); 22 cenários E2E repetidos em 2026-10-14 com este código (22 OK, ambiente descartável, não versionados). A correção da exclusão já saiu junto, em `c404c8e`.
- [ ] Commit aprovado e testado: o HEAD da branch `feat/suporte-aviso-privacidade`. O **código** (backend e frontend) foi revisado, testado e ensaiado
  no commit `a68b87e` (e é idêntico desde `67bc07e`); commits posteriores só podem alterar `docs/`. Ele contém o aviso, a guarda de `Origin`, a carga
  da FAQ e estes documentos. **A política de privacidade não pode estar nele** (itens B e C acima; os 9 arquivos dela ficam sem commit e
  `git archive` só exporta o que está commitado). Definir `COMMIT=$(git -C /root/nf-guia rev-parse HEAD)` e provar que o código é o revisado:
  `git -C /root/nf-guia diff --stat a68b87e $COMMIT -- backend frontend` **sem nenhuma linha** de saída.
- [ ] **`COMMIT` e `STAMP` são variáveis de shell:** só podem ser reutilizados na **mesma sessão** em que foram definidos. Se a sessão cair
  (ou for aberta outra), **não** invente um novo `STAMP`: redefina `COMMIT` e recupere o `STAMP` dos arquivos já criados
  (`ls /var/backups/nailflow/nailflow_pre-suporte_*.dump /var/www/nailflow/frontend/dist-prev-* /root/server.js.pre-guard-*`).
- [ ] Horário calmo: **dois** reinícios do backend, de ≈ 10 s cada (o do guarda de `Origin`, seção 4, e o da ativação, seção 7).
- [ ] Pré-checagem de `FRONTEND_URL` em produção (seção 4): sem ela o servidor não sobe.

## Ordem de execução (resumo; os comandos estão nas seções indicadas)

Uma única sessão de shell como `root`. **Os números das seções não são a ordem de execução**: a guarda de `Origin` (seção 4) vem **depois** do
frontend (seções 5 e 6), para trocar primeiro o que não exige reinício. Cada etapa só começa se a anterior cumpriu o critério.

| # | Etapa | Seção | Critério de sucesso | Parar e reverter se |
|---|---|---|---|---|
| 0 | Pré-voo em leitura e variáveis (`COMMIT`, `STAMP`) | 0, 2 | produção `c404c8e` limpa; flag ausente (0); `/support/faq` 404; contagem exata de `FRONTEND_URL` = 1 e cabeçalho CORS oficial; `diff --stat a68b87e $COMMIT -- backend frontend` vazio; 80 GB livres | qualquer item diferente |
| 1 | Backup do banco (`pre-suporte`) e `dist.bak` | 1, 2 | dump `600 root:root`, `pg_restore --list` lista as tabelas; `dist.bak_$STAMP-pre-suporte` criado | dump vazio ou erro |
| 2 | Verificar migrations 023/024 (somente leitura) | 3 | 6 categorias; 3 privilégios `t`; constraint `t` | qualquer `f` ou contagem diferente |
| 3 | Build em `/tmp`, `dist-new` e conferência do bundle | 5 | `localhost:3333` 0; `VITE_API_URL` 1; contato 1; nome civil, `/privacidade`, texto antigo 0; dono e modo iguais ao `dist` | qualquer contagem fora do esperado (apagar `dist-new`; o site não foi tocado) |
| 4 | Troca do `dist` e validação com a Central desligada | 5, 6 | `/` 200; login da Camila e da ADM; **nenhum** botão/menu de Suporte; `/suporte` "indisponível"; `/support/faq` 404 | falha de login ou página quebrada: restaurar o `dist` (nível 2) |
| 5 | Guarda de `Origin`: copiar 2 arquivos e `pm2 restart 0` (**1º reinício**) | 4 | 403, 403, 401, 401; CORS oficial; health 200; 0 erros `originGuard`; canário do n8n só `success`; login e gravação simples no navegador | qualquer 403 "Origem não permitida" em uso legítimo, ou servidor sem subir: reverter a guarda (nível 2) |
| 6 | Carga das 12 FAQs | 6-A | antes: banco `nailflow` e 0 artigos; `artigos_inseridos = 12` e `do_lote_no_banco_agora = 12`; Central ainda 404 | banco diferente de `nailflow` ou erro: a transação desfaz tudo |
| 7 | **PONTO DE DECISÃO** (humano) | — | etapas 1-6 verdes; sessão de shell e variáveis ainda válidas; ninguém pediu para esperar | qualquer dúvida: **não** ativar |
| 8 | Ativação da flag (**2º reinício**) | 7 | `.env` +1 linha; modo `600`; health 200; bootstrap `enabled:true` para a Camila | erro 500 ou botão ausente: remover a linha, conferir o hash, `pm2 restart 0` (nível 1) |
| 9 | Teste real com Camila e ADM (Central e FAQ apenas) | 7 | 12 artigos para a Camila; chamado criado, respondido, lido e resolvido; `[TESTE]` termina em rascunho; Auditoria com `support_*` e `faq_*` | 500, 403 inesperado ou qualquer notificação: parar e desligar a flag |
| 10 | Monitoramento por 48 h | 8 | ver seção 8 | ver rollback |

**Já comprovado no ensaio isolado (cópia restaurada do dump das 03:00, backend de `49efb12`/`a68b87e` em modo produção, porta aleatória, sem n8n/Evolution):**
restauração, estrutura, grants, carga idempotente da FAQ, guarda (403/401/CORS), bootstrap, 12 artigos, chamado de ponta a ponta, permissões ADM x profissional,
`[TESTE]` em rascunho e auditoria. **Só se valida em produção:** o `FRONTEND_URL` real em uso no reinício, o canário do n8n, o login e a gravação no
navegador pelo domínio real, a troca do `dist` servido pelo nginx e o teste de cada conta real. A confirmação **em execução** dos headers do n8n/Evolution
continua **pendente** até o canário da etapa 5 passar.

**Proibido durante todo o teste:** criar ou excluir contas, conectar instâncias WhatsApp, confirmar, cancelar, rejeitar ou criar agendamentos, enviar
mensagens reais. A conta Camila Souza / Camila Nails Studio (`chip2`) e os dados dela são preservados.

## 1. Backup do banco e verificação de integridade

```bash
STAMP=$(date +%Y%m%d-%H%M%S)      # só vale nesta sessão de shell (ver seção 0); COMMIT também
# o redirecionamento é feito pelo root (arquivo nasce 600 com umask 077); o dump é feito pelo postgres
( umask 077; sudo -u postgres pg_dump -Fc nailflow > /var/backups/nailflow/nailflow_pre-suporte_$STAMP.dump )
ls -l /var/backups/nailflow/nailflow_pre-suporte_$STAMP.dump         # tamanho plausível (hoje ~330 KB)
pg_restore --list /var/backups/nailflow/nailflow_pre-suporte_$STAMP.dump | head -5   # lista o conteúdo: arquivo íntegro
```

Com `/var/backups/nailflow` em `700 root:root`, só o `root` consegue gravar e ler o arquivo; por isso o
redirecionamento acima (`>`) é feito pelo shell do `root` e o `postgres` apenas envia os dados. Não use
`pg_dump … -f <arquivo>` neste diretório (o `postgres` não grava nele).

Prova de restauração: **ensaiada em 2026-10-16** com o dump das 03:00 (`nailflow_2026-10-16_030001.dump`) restaurado no cluster descartável da
porta 55433 (`/tmp/nf-del-iso`, banco `nf_restore_20261016_030001_test`, artefatos em `/root/restore-rehearsal-20261016/`): `pg_restore` com código 0 e **0
erros**, 17 tabelas, 195 funções, 16 triggers, schema igual ao de produção (só difere a formatação de CHECK), grants da role `nailflow` completos,
carga das 12 FAQs idempotente e fluxo completo da Central em modo produção. Em caso real, restaurar **sempre** em banco descartável, nunca sobre
`nailflow`, com o `root` entregando o arquivo por entrada padrão (`sudo -u postgres pg_restore … < arquivo`). Para o dump `pre-suporte` desta
publicação basta a listagem (`pg_restore --list`) acima; o ensaio completo já foi feito com o dump do dia.

## 2. Frontend atual e preservação do `dist`

```bash
cp -a /var/www/nailflow/frontend/dist /var/www/nailflow/frontend/dist.bak_$STAMP-pre-suporte
# o backend recebe só 2 arquivos (seção 4); o "backup" deles é o próprio git de produção (volta com git checkout). Ponto de partida (leitura):
git -C /var/www/nailflow rev-parse --short HEAD; git -C /var/www/nailflow status --short | wc -l      # c404c8e; 0
# estado de referência: o frontend atual responde e o login funciona (anotar o resultado)
curl -s -o /dev/null -w "%{http_code}\n" https://nailflow.duckdns.org/ ; curl -s localhost:3333/health
```

## 3. Migrations 023 e 024: **já aplicadas em produção** (só verificar, em leitura)

**Não reaplicar.** Conferir que continuam como esperado (somente leitura; nada é alterado):

```bash
sudo -u postgres env PGOPTIONS='-c default_transaction_read_only=on' psql -d nailflow -X -At <<'SQL'
SELECT count(*) FROM support_faq_categories;                                      -- 6
SELECT has_table_privilege('nailflow', 'support_tickets', 'INSERT');              -- t
SELECT has_sequence_privilege('nailflow', 'support_tickets_ticket_number_seq', 'USAGE');  -- t
SELECT pg_get_constraintdef(oid) LIKE '%support_status%' FROM pg_constraint WHERE conname = 'admin_audit_log_action_check';  -- t
SQL
```

**Referência, só para uma instalação nova (banco sem a Central):** rodar os arquivos **do commit aprovado**
(`git archive $COMMIT backend/db | tar -x -C /tmp/nf-mig`), conferindo o banco antes (`SELECT current_database();` deve ser
`nailflow`).

```bash
cd /tmp/nf-mig/backend/db/migrations
sudo -u postgres psql -d nailflow -v ON_ERROR_STOP=1 -f 023_support_center.sql
sudo -u postgres psql -d nailflow -v ON_ERROR_STOP=1 -f 024_audit_actions_support.sql
sudo -u postgres psql -d nailflow -v ON_ERROR_STOP=1 -v app_role=nailflow -f _ops/023_grant_app_role.sql   # OBRIGATÓRIO
```

Conferir depois da instalação de referência:

```sql
SELECT count(*) FROM support_faq_categories;                                    -- 6
SELECT has_table_privilege('nailflow', 'support_tickets', 'INSERT');            -- t
SELECT has_sequence_privilege('nailflow', 'support_tickets_ticket_number_seq', 'USAGE');  -- t
SELECT pg_get_constraintdef(oid) LIKE '%support_status%' FROM pg_constraint WHERE conname = 'admin_audit_log_action_check';  -- t
```

Efeito com o backend **antigo** ainda no ar: nenhum (ele não toca nas tabelas novas). A 023 trava `professionals`
por instantes (`ACCESS EXCLUSIVE`) e as duas migrations usam `lock_timeout` de 3 s: se abortarem por bloqueio,
nada foi alterado; repetir em horário mais calmo. As duas são idempotentes.

## 4. Backend: guarda de `Origin` contra CSRF (única alteração de backend; **exige reinício**)

O backend já roda o `main` (`c404c8e`) desde 2026-10-15 11:21 UTC e as migrations já estão aplicadas. Esta publicação leva ao
backend **só dois arquivos** do commit aprovado: `backend/src/middleware/originGuard.js` (novo) e `backend/src/server.js`
(+4 linhas). O guarda recusa (**403**, "Origem não permitida.") requisição que **altera dados** (POST, PUT, PATCH, DELETE)
com `Origin` diferente de `FRONTEND_URL` (inclui `null`). **Sem `Origin`** (n8n, Evolution, curl) a requisição passa, salvo se o
navegador declarar `Sec-Fetch-Site` `cross-site` ou `same-site`. GET, HEAD e OPTIONS (preflight) não são tocados, e o CORS não
muda. Roda antes da autenticação e dos limitadores. **Em produção, `FRONTEND_URL` ausente ou inválida impede o servidor de
iniciar** (a proteção nunca fica desligada em silêncio). Testes: `backend/tests/origin-guard.test.js` (21, com banco
descartável); a revisão que motivou a mudança está em `PENDENCIAS.md` (revisão de CSRF).

**Pré-checagem obrigatória, somente leitura, ANTES de copiar e reiniciar.** A produção precisa ter `FRONTEND_URL` igual à origem
oficial; o preflight mostra o valor em uso sem ler o `.env` (as contagens abaixo não imprimem valores):

```bash
curl -s -i -X OPTIONS localhost:3333/support/tickets -H 'Origin: https://evil.example' -H 'Access-Control-Request-Method: POST' | grep -i '^access-control-allow-origin'   # https://nailflow.duckdns.org
grep -cx 'FRONTEND_URL=https://nailflow.duckdns.org' /var/www/nailflow/backend/.env   # 1 (linha exata; imprime só a contagem)
grep -c '^NODE_ENV=production$' /var/www/nailflow/backend/.env                # 1
git -C /var/www/nailflow rev-parse --short HEAD; git -C /var/www/nailflow status --short | wc -l     # c404c8e; 0
pm2 describe nailflow-backend | grep -E "status|uptime|restarts"
grep -c '^SUPPORT_CENTER_ENABLED=' /var/www/nailflow/backend/.env             # 0 (ausente = desligada)
```

Se o cabeçalho **não** mostrar `https://nailflow.duckdns.org` **ou** a contagem exata da linha `FRONTEND_URL` não for **1** (aspas, espaço
ou outro valor fazem o `dotenv` ler diferente do que roda hoje), **não publicar**: em produção o servidor não subiria e o site
cairia no reinício.

**Copiar só os dois arquivos e reiniciar** (antes da ativação da Central, para validar a guarda sozinha; não copiar o `src/` inteiro):

```bash
rm -rf /tmp/nf-guard && mkdir -p /tmp/nf-guard
git -C /root/nf-guia archive $COMMIT backend/src/server.js backend/src/middleware/originGuard.js | tar -x -C /tmp/nf-guard
# cópia de segurança do server.js ATUAL (é ela que a reversão usa; guarde o $STAMP)
cp -p /var/www/nailflow/backend/src/server.js /root/server.js.pre-guard-$STAMP && ls -l /root/server.js.pre-guard-$STAMP
test ! -e /var/www/nailflow/backend/src/middleware/originGuard.js && echo "originGuard.js não existia (ok)"
cp -p /tmp/nf-guard/backend/src/middleware/originGuard.js /var/www/nailflow/backend/src/middleware/originGuard.js
cp -p /tmp/nf-guard/backend/src/server.js /var/www/nailflow/backend/src/server.js
pm2 restart 0       # ~10 s fora do ar; o n8n repete 5 × 3 s (DEPLOY.md)
```

**Validação CSRF** (curl local; usa um e-mail inexistente). **Como ler:** 403 vem da guarda, antes de qualquer consulta ao banco; 401 prova que a guarda
deixou passar e que a autenticação recusou as credenciais; **qualquer 400/500 aqui indica corpo inválido ou erro, e não é um resultado aceitável** (parar e investigar):

```bash
# senha com 6+ caracteres (o login valida min(6): com menos, o corpo é rejeitado antes da autenticação e a resposta é 500, não 401)
B=http://localhost:3333; J='Content-Type: application/json'; D='{"email":"csrf-check@teste.local","password":"abcdefg"}'
curl -s -o /dev/null -w "%{http_code}\n" -X POST $B/auth/login -H "$J" -H 'Origin: https://evil.example' -d "$D"        # 403 = recusado PELA GUARDA (origem externa)
curl -s -o /dev/null -w "%{http_code}\n" -X POST $B/auth/login -H "$J" -H 'Origin: null' -d "$D"                         # 403
curl -s -o /dev/null -w "%{http_code}\n" -X POST $B/auth/login -H "$J" -H 'Origin: https://nailflow.duckdns.org' -d "$D"  # 401 = passou pela guarda e foi recusado pela AUTENTICAÇÃO (e-mail inexistente)
curl -s -o /dev/null -w "%{http_code}\n" -X POST $B/auth/login -H "$J" -d "$D"                                            # 401 (sem Origin: passa pela guarda; n8n, curl)
curl -s -i -X OPTIONS $B/support/tickets -H 'Origin: https://evil.example' -H 'Access-Control-Request-Method: POST' | grep -i '^access-control-allow-origin'   # https://nailflow.duckdns.org (CORS inalterado)
curl -s $B/health; pm2 describe nailflow-backend | grep -E "status|uptime|restarts"       # ok; online; uptime zerado; +1 reinício
pm2 logs nailflow-backend --lines 40 --nostream | grep -c originGuard                      # 0 (nenhum erro da guarda)
```

**Canário do n8n (somente leitura, logo após o reinício).** Em produção o workflow principal "WhatsApp NailFlow — Definitivo" roda a cada poucos
segundos (≈ 2.100 execuções com sucesso em 48 h) e chama `POST /bot/process` sem `Origin`. Conferir que **continua com sucesso depois do reinício**:

```bash
python3 -I - <<'PY'
import sqlite3
c = sqlite3.connect("file:/root/.n8n/database.sqlite?mode=ro", uri=True)
for st, n, m in c.execute("select e.status, count(*), max(e.startedAt) from execution_entity e join workflow_entity w on w.id = e.workflowId where w.name like 'WhatsApp NailFlow%' and e.startedAt > datetime('now','-10 minutes') group by 1"): print(st, n, m)
PY
```

Esperado: só `success` (e nenhum `error`) nos 10 min seguintes ao reinício. **Linha de base conhecida e anterior à publicação (não é efeito da guarda):**
"Lembretes de Agendamento" e "Abandono de Conversa" já falham todo ciclo com a mensagem **"Profissional bloqueada."** (96 e 192 erros em 48 h, até 2026-10-16 17:30);
continuam iguais. O que seria **efeito da guarda** é a mensagem **"Origem não permitida."**, que **não** deve aparecer em nenhuma execução. Se aparecer,
rollback nível 2 (guarda).

Depois, **no navegador**: login da profissional e do ADM e uma gravação simples (por exemplo editar o Perfil) precisam
funcionar; **qualquer gravação do site com 403 "Origem não permitida." é motivo de rollback imediato** (tabela abaixo). Conferir
também a próxima execução do workflow principal no n8n (sucesso): `/bot` não é afetado, porque não envia `Origin`.

**Efeito no checkout de produção:** ele passa a ter `server.js` modificado e `originGuard.js` não rastreado até o merge no
`main`. **Antes do `git pull` em produção**, restaurar **somente esses dois arquivos** a partir da cópia de segurança (nunca `git checkout .`
nem `git clean`, que apagariam outras alterações): `cp -p /root/server.js.pre-guard-$STAMP /var/www/nailflow/backend/src/server.js && rm /var/www/nailflow/backend/src/middleware/originGuard.js`
e conferir que `git -C /var/www/nailflow status --short` ficou vazio (senão o pull recusa o arquivo não rastreado).

Validar também que a Central segue desligada: `curl -s localhost:3333/health` = 200; `pm2 logs nailflow-backend --lines 50` sem erro de inicialização;
com a Central desligada, `GET /support/faq` e `GET /admin/support/summary` = **404**; `GET /support/bootstrap` sem
sessão = 401 e, com sessão, `{"enabled":false,...}`.

## 5. Frontend com a URL real (sem expor segredos)

Em pasta temporária (nunca em `/var/www/nailflow/frontend`: um `npm run build` ali já troca o `dist` servido):

```bash
rm -rf /tmp/nf-fe && mkdir -p /tmp/nf-fe          # pasta nova: nunca misturar com restos de outra tentativa
git -C /root/nf-guia archive $COMMIT frontend | tar -x -C /tmp/nf-fe
install -m 600 /var/www/nailflow/frontend/.env /tmp/nf-fe/frontend/.env     # VITE_API_URL; NÃO imprimir o conteúdo
cd /tmp/nf-fe/frontend && npm ci && npm run build                            # tsc -b && vite build
```

**Preparar `dist-new` por inteiro e validá-lo ANTES de tocar no `dist` servido** (lição do deploy de 2026-10-10). A cópia fica no mesmo
volume e na mesma pasta pai, para que os dois renomeios finais sejam instantâneos:

```bash
FE=/var/www/nailflow/frontend
rm -rf $FE/dist-new && cp -a /tmp/nf-fe/frontend/dist $FE/dist-new
shred -u /tmp/nf-fe/frontend/.env                     # o .env temporário não é mais necessário
test -s $FE/dist-new/index.html && ls $FE/dist-new/assets | head
stat -c '%U:%G %a %n' $FE/dist $FE/dist-new $FE/dist-new/index.html     # mesmo dono e modo que o dist atual (root:root 755/644)
```

Validar o conteúdo **em `dist-new`** (nada disso toca o que está no ar): (1) `grep -c "localhost:3333"` nos `.js` = **0**; (2) a string de
`VITE_API_URL` aparece o mesmo número de vezes que no bundle atual (hoje **1**; sem imprimir o valor: `U=$(grep '^VITE_API_URL=' $FE/.env | cut -d= -f2-); grep -o -F -- "$U" $FE/dist-new/assets/*.js | wc -l` e o mesmo em `$FE/dist/assets/index-C9UyQW3Z.js`); (3) idealmente, provar equivalência com o build anterior trocando
só a URL; (4) conferências do aviso (contato 1; nome civil, `/privacidade` e texto antigo 0), em `DEPLOY.md`, apontando o laço para
`$FE/dist-new/assets/*.js`. **Parar se qualquer contagem fugir do esperado** (apagar `dist-new` e investigar; o site não foi tocado).

**Troca.** São **dois renomeios em sequência, não uma operação atômica**: entre eles o `dist` não existe por uma fração de segundo
(requisições nesse instante recebem erro do nginx; o navegador repete). Não há garantia maior que essa:

```bash
cd $FE && mv dist dist-prev-$STAMP && mv dist-new dist
ls dist-prev-$STAMP | head -3; test -s dist/index.html && curl -s -o /dev/null -w "%{http_code}\n" https://nailflow.duckdns.org/    # 200
```

**Preservação e restauração do `dist` anterior:** ele fica inteiro em `dist-prev-$STAMP` (e há a cópia `dist.bak_$STAMP-pre-suporte` da
seção 2). Restaurar: `cd $FE && mv dist dist-failed-$STAMP && mv dist-prev-$STAMP dist`. Se a troca parar **entre** os dois `mv` (sem `dist`),
basta `cd $FE && mv dist-prev-$STAMP dist`. Conferir depois: `test -s $FE/dist/index.html` e `curl` em `/` = 200. Só apagar `dist-prev-*`,
`dist-failed-*` e `dist.bak_*` depois da janela de monitoramento e com autorização.

## 6. Validação com a Central desligada

Navegador (profissional e ADM): login funciona; agenda, clientes e finanças como antes; **nenhum** botão
"Ajuda/Suporte" novo nem item "Suporte" no menu da ADM; `/suporte` mostra "indisponível"; ADM: lista de
profissionais e prévia de exclusão carregam (agora com `supportTickets: 0`; **só olhar: não confirmar nenhuma exclusão**); Auditoria abre (o filtro "Suporte"
existe, sem registros). Se algo falhar: voltar o `dist` (seção Rollback, nível 2).

## 6-A. Carga inicial da FAQ (12 artigos), ainda com a Central desligada

A FAQ nasce com **0 artigos**: sem a carga, as profissionais não encontrariam respostas. Os 12 artigos aprovados estão em
`docs/SUPORTE_FAQ_INICIAL.md` e os scripts gerados dele ficam em `backend/db/migrations/_ops/` (`support_faq_initial.sql` e
`support_faq_initial_revert.sql`; ver o `README.md` da pasta). Foram testados em banco descartável
(`backend/tests/support-faq-seed.test.js`) e **nunca foram executados em produção**. Características: ids fixos (rodar de novo
não duplica), uma única transação, só insere nas 6 categorias que a 023 criou, não toca em chamados, mensagens nem em artigos
de outras origens, e **não grava na Auditoria** (sem autoria: `created_by` e `updated_by` nulos). Entram **publicados**;
`-v artigo_status=rascunho` os insere como rascunho. O `postgres` não lê `/root`: o `root` abre o arquivo e o entrega por entrada
padrão.

```bash
git -C /root/nf-guia archive $COMMIT backend/db/migrations/_ops | tar -x -C /tmp/nf-ops      # scripts do commit aprovado
OPS=/tmp/nf-ops/backend/db/migrations/_ops
# antes (leitura): banco e quantidade
sudo -u postgres env PGOPTIONS='-c default_transaction_read_only=on' psql -d nailflow -X -At -c "SELECT current_database(), count(*) FROM support_faq_articles"   # nailflow|0
# carga (imprime só contagens): esperado artigos_inseridos = 12 e do_lote_no_banco_agora = 12
sudo -u postgres psql -d nailflow -X -v ON_ERROR_STOP=1 < $OPS/support_faq_initial.sql
```

**Reverter só a FAQ** (o backup da seção 1 já cobre a tabela): apaga **somente** os 12 ids da carga; artigos criados pela tela,
chamados e mensagens não são tocados. Se algum artigo do lote foi **editado** depois, o script aborta sem apagar nada e informa
quantos; só com `-v forcar_editados=on` apaga esses também. Reordenar ou publicar/despublicar não conta como edição.

```bash
sudo -u postgres psql -d nailflow -X -v ON_ERROR_STOP=1 < $OPS/support_faq_initial_revert.sql
```

## 7. Ativação controlada e teste real

Este é o **segundo** reinício do backend (o primeiro foi o da seção 4; só ative depois de validar a guarda). A flag é lida do `.env` quando o backend inicia (`dotenv`), e ela **não** está no ambiente armazenado do PM2: basta `pm2 restart 0`
(o `--update-env` não é necessário). **Não copiar o `.env`** (mais uma cópia de segredos): registrar só o hash e a contagem de
linhas, acrescentar a linha e, para reverter, remover **só essa linha** e conferir que o hash voltou ao de antes. Nenhum comando
abaixo imprime valores do arquivo.

```bash
cd /var/www/nailflow/backend
# 1) estado ANTES, sem copiar o arquivo e sem imprimir valores (anote os dois)
HASH_ANTES=$(sha256sum .env | cut -c1-16); LINHAS_ANTES=$(wc -l < .env); MODO_ANTES=$(stat -c %a .env); echo "$HASH_ANTES $LINHAS_ANTES $MODO_ANTES"
# 2) a flag ainda não existe (0) e o arquivo termina com quebra de linha (aparece \n); sem isso a nova linha grudaria na última variável
grep -c '^SUPPORT_CENTER_ENABLED=' .env; tail -c1 .env | od -An -c
# 3) acrescentar a linha (só o valor exato "true" liga)
printf 'SUPPORT_CENTER_ENABLED=true\n' >> .env
# 4) conferir sem imprimir valores: exatamente +1 linha, 1 linha da flag e o mesmo modo (600)
echo $(( $(wc -l < .env) - LINHAS_ANTES )); grep -c '^SUPPORT_CENTER_ENABLED=true$' .env; stat -c %a .env
pm2 restart 0       # ~10 s fora do ar; o n8n repete 5 × 3 s (DEPLOY.md)
```

**Reverter a flag (nível 1 do rollback):**

```bash
cd /var/www/nailflow/backend
sed -i '/^SUPPORT_CENTER_ENABLED=/d' .env
# prova de que o arquivo voltou exatamente ao que era (use o HASH_ANTES anotado): deve imprimir "restaurado"
[ "$(sha256sum .env | cut -c1-16)" = "$HASH_ANTES" ] && echo restaurado || echo "ATENCAO: difere do estado anterior"
stat -c %a .env; pm2 restart 0
```

**Contas do teste.** Profissional de teste: **Camila Souza / Camila Nails Studio** (instância WhatsApp `chip2`). Administradora: **Admin NailFlow**
(usada à parte, para validar permissões administrativas). Não use a conta "Teste NailFlow" (bloqueada, instância `chip2-teste`). Quem tem as senhas
faz o login: **senhas nunca são digitadas por automação nem registradas**. A conta da Camila **é uma conta real de teste com dados** (agenda,
clientes, mensagens e o vínculo WhatsApp `chip2`): **preservar tudo; não criar contas, não excluir a conta e não alterar o vínculo**. Para não
disparar notificações, o teste usa **somente a Central de Suporte e a FAQ**: **não** confirmar, cancelar nem rejeitar agendamentos, **não** fazer
agendamento público, **não** conectar nem reconectar o WhatsApp. A Central não envia nada a n8n/Evolution (conferido no código). Se algum passo
puder notificar alguém, **parar e confirmar destinatário e instância antes**.

Roteiro (profissional: Camila; ADM: Admin NailFlow): bootstrap `enabled:true` para a profissional e **403**
para a ADM; criar solicitação (aparece na fila da ADM, não lida); ADM responde ("Aguardando você"); a profissional
vê não lida, abre e marca como lida; resolver; reabrir dentro de 7 dias; criar, publicar e despublicar **um artigo de teste
com título `[TESTE]`** (ver abaixo); conferir na Auditoria `support_status`, `support_priority` e `faq_*`. **Artigo `[TESTE]` (não há rota de exclusão de artigo):** use o título `[TESTE] Verificação da publicação` e **anote o ID** do artigo criado. Ele
nasce como **rascunho**: publique, confira que aparece para a conta de teste, **despublique** e **deixe-o como rascunho** (a profissional não vê
rascunho; só a ADM). **Não o apague nesta etapa.** A remoção posterior só ocorre com **autorização explícita** e pelo **ID exato**, como `postgres`,
depois de conferir o alvo em leitura e dentro de uma transação (modelo, **não executar sem autorização**):

```sql
-- 1) conferir (leitura): deve voltar exatamente 1 linha, título [TESTE...] e status rascunho
SELECT id, title, status FROM support_faq_articles WHERE id = '<ID-ANOTADO>';
-- 2) com autorização: só se a linha acima for a esperada
BEGIN; DELETE FROM support_faq_articles WHERE id = '<ID-ANOTADO>' AND title LIKE '[TESTE]%' AND status = 'rascunho'; -- 1 linha
COMMIT;   -- ROLLBACK se o DELETE não afetar exatamente 1 linha
```

Os registros de Auditoria (`faq_*`) desse artigo permanecem (a tabela não tem FK).

**O que fica no banco depois do teste (de propósito):** a conta da Camila, com tudo o que ela já tem, **permanece intacta**, e os **chamados**
(e mensagens e eventos) criados nos testes **permanecem no banco até uma eventual limpeza autorizada**: a API não tem exclusão de
solicitação, e a rotina de retenção (`_ops/support_retention.sql`) só apaga chamados **resolvidos há mais de 6 meses** e não está agendada.
Para não deixar chamados em aberto, **resolva** os chamados de teste pela ADM ao final (título com `[ENSAIO]` para identificá-los). **Nenhuma
exclusão de conta, de chamado ou de artigo faz parte desta publicação**; qualquer limpeza posterior exige **autorização explícita**, com os IDs
exatos conferidos em leitura antes.

## 8. Monitoramento (primeiras 48 h)

- **Logs:** `pm2 logs nailflow-backend`: procurar `support: erro de banco` (loga só código/constraint, nunca o texto), `permission denied`
  (grants da seção 3 faltando) e qualquer `Origem não permitida` inesperado (403 da guarda em uso legítimo).
- **Reinícios:** `pm2 describe nailflow-backend` (contador de reinícios e uptime). Hoje o contador está em **242**; esta publicação adiciona **2**
  reinícios planejados (guarda e ativação) e **mais nenhum** deve aparecer nas 48 h (`unstable restarts` = 0).
- **n8n (headers em execução, ainda pendente de confirmação):** conferir a **próxima execução** de cada workflow que chama `/bot/*`
  (principal "WhatsApp NailFlow — Definitivo", "Lembretes de Agendamento" e "Abandono de Conversa") **com sucesso**, sem 403 "Origem não
  permitida". Isso fecha a confirmação de que n8n/Evolution não enviam `Origin`; se aparecer 403 nelas, rollback nível 2 (guarda).
- Respostas 429 nos limitadores (criação 5/h por conta; mensagens 30/10 min; ADM 300 leituras e 60 escritas / 5 min).
- **Backup das tabelas da Central:** depois das 03:00 de cada dia, `pg_restore --list /var/backups/nailflow/nailflow_$(date +%F)_0300*.dump | grep -c 'TABLE DATA.* support_'` deve listar as 5 tabelas `support_*` (dados), e o log (`backup.log`) sem `ERRO`.
- Sinal de problema: profissionais relatando botão ausente (bootstrap falhando) ou 500 ao enviar mensagem.

## Rollback (do mais leve ao mais pesado)

| Nível | Quando | Como | Perde dados? |
|---|---|---|---|
| 1. Desligar | Qualquer problema na Central | Remover a linha da flag do `.env` (procedimento da seção 7, que confere o hash do arquivo) + `pm2 restart 0`. As rotas viram 404 e a interface some. | **Não.** Conversas e FAQ ficam no banco. |
| 1b. Retirar a FAQ inicial | Conteúdo errado na FAQ | `support_faq_initial_revert.sql` (seção 6-A): apaga só os 12 artigos da carga; não toca em artigos criados pela tela nem em chamados. | Só os 12 artigos. |
| 2. Voltar o código | Problema no frontend ou no backend novo | Frontend: `mv dist dist-failed-$STAMP && mv dist-prev-$STAMP dist`. Backend (guarda de `Origin`): `cp -p /root/server.js.pre-guard-$STAMP /var/www/nailflow/backend/src/server.js && rm /var/www/nailflow/backend/src/middleware/originGuard.js && pm2 restart 0` (restaura só esses 2 arquivos a partir da cópia feita na seção 4; não usa `git checkout`/`clean`, então nenhuma outra alteração é apagada; conferir `git -C /var/www/nailflow status --short` vazio e a validação da seção 4 devolvendo 401 (e não 403) para o login com `Origin: https://evil.example` e a senha de 6+ caracteres da seção 4, o que prova a guarda removida). O código antigo ignora as tabelas e a coluna novas. | **Não.** |
| 3. Reverter a 024 | Só se for indispensável | `_rollback/024_audit_actions_support.down.sql`. **Aborta** se já houver auditoria `faq_*`/`support_*` (proteção). Padrão recomendado: **deixar aplicada** (é aditiva). | Não apaga nada. |
| 4. Reverter a 023 | Só se for indispensável | **Destrutivo e irreversível:** apaga solicitações, mensagens, eventos, artigos de FAQ e a preferência `support_fab_hidden` de todas as contas. Parar a API, backup novo, exportar antes se quiser guardar (`pg_dump -Fc -t 'support_*' nailflow`, com o arquivo aberto pelo `root`, `> arquivo`, como na seção 1), autorizar na mesma sessão (`SET support.confirm_destructive_rollback = 'DESTRUIR-DADOS-DE-SUPORTE'`). Detalhes e limites (`lock_timeout` de 3 s, locks em `professionals`) em `backend/db/migrations/_rollback/README.md`. | **Sim**, tudo da Central. A auditoria permanece (sem FK). |

Depois do nível 4 o backend novo continua funcionando com a Central desligada (a exclusão de conta detecta a ausência
das tabelas). Reaplicar a 023 recria tudo vazio; o `GRANT` da seção 3 precisa ser repetido.
