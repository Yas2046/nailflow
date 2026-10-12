# Central de Suporte: checklist de publicação e rollback

> Roteiro para a V1. **Nada aqui foi executado em produção.** Cada comando é do projeto como ele está hoje; os
> fatos de produção abaixo foram conferidos em 2026-10-11 por leitura (sem alterar nada). Decisões que bloqueiam a
> ativação: [`SUPORTE_DECISOES.md`](./SUPORTE_DECISOES.md). Contratos: [`ROTAS_E_ENDPOINTS.md`](./ROTAS_E_ENDPOINTS.md).

## Fatos de produção que mudam o procedimento

| Fato | Consequência |
|---|---|
| Banco `nailflow` (PostgreSQL 16, ~11 MB), acessado pelo `postgres` via socket (`sudo -u postgres psql -d nailflow`). | Migrations 023/024 aplicadas assim, como nas anteriores (`docs/BANCO_DE_DADOS.md`). |
| A aplicação conecta como a role **`nailflow`** (não superusuária). `professionals` e quase todas as tabelas pertencem a **`postgres`** (com `GRANT` à `nailflow`); `admin_audit_log` e `recurring_exceptions` pertencem a `nailflow`. | A 023 **precisa** rodar como `postgres` (faz `ALTER TABLE professionals`), e ela **não tem GRANT**: as tabelas novas nascem sem acesso para a `nailflow` e toda operação de suporte falha com `permission denied` (42501). **Reproduzido em banco descartável.** É obrigatório aplicar `backend/db/migrations/_ops/023_grant_app_role.sql` depois da 023. |
| Migrations 023 e 024 **não estão aplicadas** (conferido no catálogo). | Roteiro completo. |
| `backend/src` de produção é idêntico ao commit `9df3217`; **`frontend/src` de produção está desatualizado** em relação a ele (o `dist` servido foi gerado em outro lugar). | **Nunca** rodar `npm run build` dentro de `/var/www/nailflow/frontend`: voltaria o frontend. Construir a partir do commit aprovado, em pasta temporária. |
| Sem mudança de dependências nos cinco commits (`package.json` e lock idênticos). | Não há `npm install` no backend. |
| PM2 id 0 `nailflow-backend` (`bash -c "npm start"`, modo fork, cwd `/var/www/nailflow/backend`). `reload` em modo fork equivale a `restart` (~10 s fora do ar; o n8n repete 5 × 3 s, conforme `DEPLOY.md`). | Escolher horário calmo. |
| nginx serve `/var/www/nailflow/frontend/dist`; `/api/` vai para `localhost:3333/`; CSP `connect-src 'self'`. | A API do bundle precisa ser a mesma origem (`VITE_API_URL`). |
| Backups: `nailflow-backup.sh` (03:00, retenção de 7 dias). Precedente de backup antes de migration: `/var/backups/nailflow/nailflow_pre-migration-02N_*.dump`. | Backup manual antes da 023. Permissões: ver [`SUPORTE_BACKUPS_PROPOSTA.md`](./SUPORTE_BACKUPS_PROPOSTA.md). |
| O código novo é **fail-closed**: sem `SUPPORT_CENTER_ENABLED=true` no `.env`, `/support/*` e `/admin/support/*` respondem 404 e a interface não mostra nada. | Dá para publicar migrations, backend e frontend **sem ligar** a Central. |

## 0. Antes de começar (decisões)

- [ ] **Texto de privacidade/retenção revisado** (bloqueia ligar; ver `SUPORTE_DECISOES.md`).
- [ ] Commit aprovado e testado: HEAD da branch (ou o que for mergeado). Anote o hash: `COMMIT=<hash>`.
- [ ] Horário calmo (reinício do backend ≈ 10 s).

## 1. Backup do banco e verificação de integridade

```bash
STAMP=$(date +%Y%m%d-%H%M%S)
# o redirecionamento é feito pelo root (arquivo nasce 600 com umask 077); o dump é feito pelo postgres
( umask 077; sudo -u postgres pg_dump -Fc nailflow > /var/backups/nailflow/nailflow_pre-migration-023_$STAMP.dump )
ls -l /var/backups/nailflow/nailflow_pre-migration-023_$STAMP.dump         # tamanho plausível (hoje ~260 KB)
pg_restore --list /var/backups/nailflow/nailflow_pre-migration-023_$STAMP.dump | head -5   # lista o conteúdo: arquivo íntegro
```

Prova de restauração (opcional, recomendada): restaurar em um banco **descartável**, nunca sobre `nailflow`. O
procedimento testado está em `SUPORTE_BACKUPS_PROPOSTA.md` (cluster de teste, banco `nf_*_test`).

## 2. Frontend atual e preservação do `dist`

```bash
cp -a /var/www/nailflow/frontend/dist /var/www/nailflow/frontend/dist.bak_$STAMP-pre-suporte
tar czf /root/backup_backend_src_pre_suporte_$STAMP.tgz -C /var/www/nailflow/backend src db
# estado de referência: o frontend atual responde e o login funciona (anotar o resultado)
curl -s -o /dev/null -w "%{http_code}\n" https://nailflow.duckdns.org/ ; curl -s localhost:3333/health
```

## 3. Migrations 023 e 024, na ordem, como `postgres`

Rodar os arquivos **do commit aprovado** (`git archive $COMMIT backend/db | tar -x -C /tmp/nf-mig`), conferindo o
banco antes (`SELECT current_database();` deve ser `nailflow`).

```bash
cd /tmp/nf-mig/backend/db/migrations
sudo -u postgres psql -d nailflow -v ON_ERROR_STOP=1 -f 023_support_center.sql
sudo -u postgres psql -d nailflow -v ON_ERROR_STOP=1 -f 024_audit_actions_support.sql
sudo -u postgres psql -d nailflow -v ON_ERROR_STOP=1 -v app_role=nailflow -f _ops/023_grant_app_role.sql   # OBRIGATÓRIO
```

Conferir:

```sql
SELECT count(*) FROM support_faq_categories;                                    -- 6
SELECT has_table_privilege('nailflow', 'support_tickets', 'INSERT');            -- t
SELECT has_sequence_privilege('nailflow', 'support_tickets_ticket_number_seq', 'USAGE');  -- t
SELECT pg_get_constraintdef(oid) LIKE '%support_status%' FROM pg_constraint WHERE conname = 'admin_audit_log_action_check';  -- t
```

Efeito com o backend **antigo** ainda no ar: nenhum (ele não toca nas tabelas novas). A 023 trava `professionals`
por instantes (`ACCESS EXCLUSIVE`) e as duas migrations usam `lock_timeout` de 3 s: se abortarem por bloqueio,
nada foi alterado; repetir em horário mais calmo. As duas são idempotentes.

## 4. Backend com a Central **desligada**

Conferir que `SUPPORT_CENTER_ENABLED` **não** está `true` em `/var/www/nailflow/backend/.env` (ausente = desligada;
não é preciso editar o arquivo). Copiar `src/` do commit aprovado (sem `.env`, sem `node_modules`) e reiniciar:

```bash
git -C /root/nf-guia archive $COMMIT backend/src | tar -x -C /tmp/nf-stage
cp -a /tmp/nf-stage/backend/src/. /var/www/nailflow/backend/src/
pm2 restart 0 --update-env      # ~10 s fora do ar (DEPLOY.md)
```

Validar: `curl -s localhost:3333/health` = 200; `pm2 logs nailflow-backend --lines 50` sem erro de inicialização;
com a Central desligada, `GET /support/faq` e `GET /admin/support/summary` = **404**; `GET /support/bootstrap` sem
sessão = 401 e, com sessão, `{"enabled":false,...}`.

## 5. Frontend com a URL real (sem expor segredos)

Em pasta temporária (nunca em `/var/www/nailflow/frontend`, cujo `src/` está desatualizado):

```bash
git -C /root/nf-guia archive $COMMIT frontend | tar -x -C /tmp/nf-fe
install -m 600 /var/www/nailflow/frontend/.env /tmp/nf-fe/frontend/.env     # VITE_API_URL; NÃO imprimir o conteúdo
cd /tmp/nf-fe/frontend && npm ci && npm run build                            # tsc -b && vite build
```

Antes de trocar o `dist` (lição do deploy de 2026-10-10): (1) `grep -c "localhost:3333"` no bundle = **0**;
(2) a string de `VITE_API_URL` aparece no bundle o mesmo número de vezes que no bundle atual; (3) idealmente,
provar equivalência com o build anterior trocando só a URL. Trocar e apagar o `.env` temporário:

```bash
mv /var/www/nailflow/frontend/dist /var/www/nailflow/frontend/dist-prev-$STAMP
cp -a /tmp/nf-fe/frontend/dist /var/www/nailflow/frontend/dist
shred -u /tmp/nf-fe/frontend/.env
```

## 6. Validação com a Central desligada

Navegador (profissional e ADM): login funciona; agenda, clientes e finanças como antes; **nenhum** botão
"Ajuda/Suporte" novo nem item "Suporte" no menu da ADM; `/suporte` mostra "indisponível"; ADM: lista de
profissionais e prévia de exclusão carregam (agora com `supportTickets: 0`); Auditoria abre (o filtro "Suporte"
existe, sem registros). Se algo falhar: voltar o `dist` (seção Rollback, nível 2).

## 7. Ativação controlada e teste real

```bash
cp -p /var/www/nailflow/backend/.env /var/backups/nailflow/env_pre-suporte_$STAMP.bak   # 600, como os anteriores
# editar /var/www/nailflow/backend/.env: SUPPORT_CENTER_ENABLED=true   (só o valor exato "true" liga)
pm2 restart 0 --update-env
```

Roteiro com **uma conta de teste** (não uma cliente real): bootstrap `enabled:true` para a profissional e **403**
para a ADM; criar solicitação (aparece na fila da ADM, não lida); ADM responde ("Aguardando você"); a profissional
vê não lida, abre e marca como lida; resolver; reabrir dentro de 7 dias; criar, publicar e despublicar um artigo de
FAQ; conferir na Auditoria `support_status`, `support_priority` e `faq_*`. Ao terminar, **excluir a conta de teste
pela ADM** (a API não tem exclusão de solicitação; a exclusão da conta leva as conversas junto e deixa o snapshot
600 em `deleted-professionals/`).

## 8. Monitoramento (primeiras 48 h)

- `pm2 logs nailflow-backend`: procurar `support: erro de banco` (loga só código/constraint, nunca o texto) e
  `permission denied` (grants da seção 3 faltando); `pm2 describe nailflow-backend` (contador de reinícios).
- Respostas 429 nos limitadores (criação 5/h por conta; mensagens 30/10 min; ADM 300 leituras e 60 escritas / 5 min).
- Backup das 03:00 incluindo as tabelas novas: `pg_restore --list <dump do dia> | grep support_`.
- Sinal de problema: profissionais relatando botão ausente (bootstrap falhando) ou 500 ao enviar mensagem.

## Rollback (do mais leve ao mais pesado)

| Nível | Quando | Como | Perde dados? |
|---|---|---|---|
| 1. Desligar | Qualquer problema na Central | `SUPPORT_CENTER_ENABLED=false` (ou remover a linha) no `.env` + `pm2 restart 0 --update-env`. As rotas viram 404 e a interface some. | **Não.** Conversas e FAQ ficam no banco. |
| 2. Voltar o código | Problema no frontend ou no backend novo | Frontend: `mv dist dist-failed-$STAMP && mv dist-prev-$STAMP dist`. Backend: restaurar `src` do `tar` da seção 2 + `pm2 restart 0`. O código antigo ignora as tabelas e a coluna novas. | **Não.** |
| 3. Reverter a 024 | Só se for indispensável | `_rollback/024_audit_actions_support.down.sql`. **Aborta** se já houver auditoria `faq_*`/`support_*` (proteção). Padrão recomendado: **deixar aplicada** (é aditiva). | Não apaga nada. |
| 4. Reverter a 023 | Só se for indispensável | **Destrutivo e irreversível:** apaga solicitações, mensagens, eventos, artigos de FAQ e a preferência `support_fab_hidden` de todas as contas. Parar a API, backup novo, exportar antes se quiser guardar (`pg_dump -Fc -t 'support_*' nailflow`), autorizar na mesma sessão (`SET support.confirm_destructive_rollback = 'DESTRUIR-DADOS-DE-SUPORTE'`). Detalhes e limites (`lock_timeout` de 3 s, locks em `professionals`) em `backend/db/migrations/_rollback/README.md`. | **Sim**, tudo da Central. A auditoria permanece (sem FK). |

Depois do nível 4 o backend novo continua funcionando com a Central desligada (a exclusão de conta detecta a ausência
das tabelas). Reaplicar a 023 recria tudo vazio; o `GRANT` da seção 3 precisa ser repetido.
