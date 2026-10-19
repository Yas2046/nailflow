# Financeiro — etapa 1: estrutura de banco e base de auditoria

> **Estado (2026-10-19):** código na branch `feat/financeiro-base`, **sem commit**, **não aplicado em nenhum banco persistente nem em produção**.
> Não há rotas de pagamentos, telas nem indicadores: só a estrutura, a auditoria, os testes e os procedimentos de aplicação,
> reversão, restauração e retenção. A publicação será única, depois de validar todas as etapas.

## 1. O que a etapa entrega

| Arquivo | Papel |
|---|---|
| `backend/db/migrations/025_financeiro_base.sql` | Migration aditiva e idempotente: tabelas `financial_payments`, `financial_audit_log`, `cash_closings`; colunas novas em `appointments` e `expenses`; triggers de guarda e histórico; verificação final |
| `backend/db/migrations/_ops/025_grant_app_role.sql` | Grants mínimos da role da aplicação (uso manual, depois da 025) |
| `backend/db/migrations/_ops/025_audit_app_privileges.sql` | **Somente leitura:** audita os privilégios efetivos da role da aplicação |
| `backend/db/migrations/_rollback/025_financeiro_base.down.sql` | Rollback: só sem uso; com uso, arquiva (com manifesto de hashes) antes de remover |
| `backend/db/migrations/_ops/025_restore_from_archive.sql` | Restauração do arquivo gerado pelo rollback (também a partir de um backup) |
| `backend/src/controllers/adminController.js` | Exclusão de conta: snapshot, preview e trava de concorrência incluem as tabelas financeiras |
| `backend/tests/financeiro-*.test.js`, `backend/tests/helpers/financeTestDb.js`, `financeSeed.js` | Testes (seção 10) |

A estrutura e as regras garantidas pelo banco estão em [`BANCO_DE_DADOS.md`](./BANCO_DE_DADOS.md) ("Financeiro — estrutura base").
**Nada** classifica dado antigo: atendimentos, sinais Pix e despesas existentes **não** viram "realizados", "recebidos" ou "pagos";
`expense_date` **não** é prova de pagamento (`paid_on` é uma coluna à parte).

## 2. Ordem de aplicação (para a publicação única futura)

1. **Backup** (`pg_dump`) e conferência de que o arquivo existe e tem tamanho plausível.
2. Conferir o banco (`SELECT current_database();`), rodar a **auditoria de privilégios** (seção 3) e **parar a API** (a migration tem `lock_timeout = 3s` e aborta, sem alterar nada, se não obtiver o bloqueio).
3. Aplicar **como `postgres`** (a dona das tabelas):
   `sudo -u postgres psql -d nailflow -X -v ON_ERROR_STOP=1 -f backend/db/migrations/025_financeiro_base.sql`
4. Conceder os privilégios: `sudo -u postgres psql -d nailflow -v ON_ERROR_STOP=1 -v app_role=nailflow -f backend/db/migrations/_ops/025_grant_app_role.sql`
   (o script confere, ao final, que a aplicação **não** tem `UPDATE`/`DELETE`/`TRUNCATE` nas tabelas append-only).
5. Publicar o código **junto** (inclui a proteção de exclusão de conta). Nenhuma rota que grave nas tabelas financeiras pode existir
   antes dos testes da seção 10 passarem com ela.

## 3. Permissões e segurança

### 3.1 Funções
* Triggers de histórico, guarda de pagamentos e consulta do fechamento são **`SECURITY DEFINER`**: sem o script de grants o fluxo atual
  de **Gastos e Agenda continua funcionando** (provado pela API real nas fases 1 e 2 do teste HTTP), e a role não consegue forjar histórico
  nem chamar as funções internas (`42501`).
* **`search_path` endurecido:** toda função `fin_*` usa `pg_catalog, pg_temp` e qualifica os objetos (`public.*`). O teste cria
  `public.hashtextextended(text, integer)` como role não-dona com `CREATE` em `public` (assinatura exata que venceria a conversão implícita) e prova que
  (a) com o endurecimento o objeto hostil é ignorado, (b) desfazendo o endurecimento só do guarda o ataque funciona (`SEQUESTRADO`), (c) reaplicar a
  migration restaura o endurecimento.

### 3.2 Privilégios efetivos da role `nailflow`: o que se sabe, o que é excessivo e o que as próximas etapas exigem

**Fontes (e o que cada uma prova).** Esta etapa **não acessou produção**; os fatos de produção vêm de registros anteriores:

| Fato | Fonte |
|---|---|
| A aplicação conecta como `nailflow`, **não superusuária**; `postgres` é dono de `professionals` e de quase todas as tabelas; `admin_audit_log` e `recurring_exceptions` pertencem a `nailflow` | `docs/SUPORTE_PUBLICACAO.md` (conferido em 2026-10-16) |
| Em `appointments` e `expenses`, `nailflow` tem `DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE`; nas tabelas de suporte só o mínimo do grant da 023; **`CREATE` no schema `public`: sim** (`PUBLIC`: não); **nenhum** `ALTER DEFAULT PRIVILEGES` | Catálogo de produção lido **somente para leitura** na revisão anterior (2026-10-19); **não foi relido nesta etapa** |
| O código da aplicação usa só **DML** (`SELECT/INSERT/UPDATE/DELETE`): sem DDL, `TRUNCATE`, `CREATE TRIGGER`, `REFERENCES`, `COPY` nem `SET ROLE` | Busca em `backend/src` (esta etapa) |

**Para ver o quadro completo em produção** (todas as tabelas, não só as duas lidas), rode — **só com autorização, é somente leitura** — o script
`_ops/025_audit_app_privileges.sql` (descrito em `_ops/README.md`). Ele foi validado em banco descartável: aponta o excesso antes da mitigação e não aponta nada depois.

**Privilégios excessivos** (o código não os usa): `TRUNCATE`, `TRIGGER` e `REFERENCES` nas tabelas antigas, `CREATE` no schema `public` e a **propriedade** de
`admin_audit_log` e `recurring_exceptions` (nas tabelas de que é dona, a proteção por privilégio não vale: o dono pode tudo).

**O que esses privilégios permitem, medido em banco descartável com o perfil de produção** (`financeiro-migrations.test.js`, `financeiro-http.test.js`):

| Cenário | Resultado medido |
|---|---|
| `TRUNCATE appointments CASCADE` ou `TRUNCATE professionals CASCADE` | **Recusado** (`42501`): falta `TRUNCATE` nas tabelas financeiras que as referenciam. Os dados financeiros resistem |
| `DELETE` de um atendimento que tem pagamento | **Recusado** pela chave estrangeira (`23503`) |
| `TRUNCATE expenses` (sem dependentes) | **Permitido** e **sem histórico** (o `TRUNCATE` não dispara os triggers de auditoria): lacuna de auditoria |
| Trigger criado pela role (`TRIGGER` + `CREATE` em `public`) disparado pela **cascata da exclusão de conta** | Roda como a **própria role**: sem escalação por esse caminho |
| O mesmo trigger disparado por **DML do dono** (`postgres`, em manutenção) numa tabela onde a role tem `TRIGGER` | Roda como **superusuário**: **escalação de privilégio** |

**Mitigação testada (NÃO aplicada em produção):** `REVOKE TRUNCATE, TRIGGER, REFERENCES ON ALL TABLES IN SCHEMA public FROM nailflow;` e
`REVOKE CREATE ON SCHEMA public FROM nailflow;`. Com isso: os quatro cenários acima deixam de ser possíveis (`42501`) e **Gastos e Agenda, pela API HTTP
real, ficam idênticos** (fase 4 do teste HTTP). Cuidados antes de aplicar: confirmar com a auditoria que nada além da aplicação usa `nailflow` para DDL;
tabelas novas continuam nascendo sem acesso (sem `ALTER DEFAULT PRIVILEGES`).

**Grants que as próximas etapas exigem** (o script `025_grant_app_role.sql` já os concede; nada além disso):

| Tabela | Necessário | Observação |
|---|---|---|
| `financial_payments` | `SELECT`, `INSERT` | Sem `UPDATE`/`DELETE`/`TRUNCATE` (append-only por trigger **e** por privilégio). Estorno é uma linha nova |
| `financial_audit_log` | `SELECT`, `INSERT` | O `INSERT` só é necessário se a API gravar entradas `correction` diretamente; o histórico automático é gravado pelas funções `SECURITY DEFINER`. **Decidir na etapa 2:** se a API não gravar `correction` direto, remover o `INSERT` (e expor uma função própria) fecha a possibilidade de forjar histórico |
| `cash_closings` | `SELECT`, `INSERT`, `UPDATE` | Sem `DELETE`; o trigger só aceita fechar e reabrir com motivo |
| `appointments`, `expenses` | os existentes | As colunas novas herdam o privilégio da tabela |

Se a 025 for aplicada por outra role que não a dona, as proteções por privilégio não valem: o script de grants aborta.

## 4. Rollback

Ver [`_rollback/README.md`](../backend/db/migrations/_rollback/README.md). Resumo: sem uso, remove; com uso e sem autorização, **aborta**;
com autorização, **arquiva tudo** em `financeiro_arquivo_AAAAMMDD_HH24MISS`, confere contagem e hash de cada tabela contra a origem, grava o
manifesto e só então remove. Nunca roda sozinho em produção; **não foi executado em nenhum banco persistente**.

## 5. Restauração

Pré-condições (o script **aborta sem alterar nada** se alguma falhar): executar como **superusuário**; 025 **reaplicada** (e, se a etapa 2 estiver aplicada, também a **026**: o arquivo pode ter `transferencia`) e estrutura
**pristina** (tabelas novas vazias e nenhum atendimento/despesa com as colunas novas preenchidas; API parada); schema de arquivo com `_manifest`
e **cada tabela conferindo** com ele; toda conta, atendimento e despesa referenciados ainda existem.

O que faz, numa transação: desliga os triggers só nela (`session_replication_role = replica`, para preservar `final_price_set_at`,
`finance_reviewed_at`, `closed_at`, `updated_at` e não duplicar histórico), insere movimentações, histórico (preservando `seq` e `id`) e
fechamentos, preenche as colunas novas **só** das linhas arquivadas, reposiciona a sequência (depois do maior `seq` do arquivo inteiro) e **confere de novo**
contagem e hash de tudo. Qualquer divergência desfaz tudo. O schema de arquivo é mantido. Depois, rode o script de grants.

```bash
sudo -u postgres psql -d nailflow -X -v ON_ERROR_STOP=1 -v archive_schema=financeiro_arquivo_AAAAMMDD_HH24MISS \
     -f backend/db/migrations/_ops/025_restore_from_archive.sql
# se contas foram excluídas depois do rollback, acrescente (opção explícita):  -v skip_deleted_accounts=on
```

**Contas excluídas depois do rollback.** Por padrão a restauração **aborta** (nada é gravado) se o arquivo tem dados de conta que já não existe. Com
`-v skip_deleted_accounts=on` ela restaura **só as contas que existem**, deixa o resto no arquivo (e informa quantas linhas, por tabela) e confere o resultado
contra o subconjunto correspondente do arquivo. Sem essa opção, **uma única conta excluída impediria restaurar todas as outras**.

## 6. Retenção, exclusão da conta e recuperação

**Os dados arquivados pelo rollback não dependem apenas do snapshot administrativo de 30 dias.** Há quatro conjuntos de cópias, com retenções diferentes:

| Cópia | Onde fica | Quem cria | Retenção | Cobre |
|---|---|---|---|---|
| **Schema de arquivo** `financeiro_arquivo_*` | No próprio banco | Rollback autorizado da 025 | **Sem prazo**: nenhuma rotina o apaga, e a exclusão de uma conta **não** o apaga (as cópias não têm FK). Só descarte manual | Movimentações, histórico, fechamentos, colunas novas e o manifesto de hashes |
| **Backup diário** (`/var/backups/nailflow/nailflow_*.dump`, cron 03:00) | Arquivos `pg_dump -Fc` | `nailflow-backup.sh` | **7 dias** (`find -mtime +7 -delete`, só no nível do diretório) | O banco inteiro, **incluindo** o schema de arquivo e as tabelas financeiras (provado no ensaio da seção 9) |
| **Snapshot administrativo de exclusão de conta** (`/var/backups/nailflow/deleted-professionals`, JSON 600/700) | Arquivo por conta excluída | Exclusão de profissional | **30 dias** (`SNAPSHOT_RETENTION_DAYS`, poda a cada exclusão e pelo script `scripts/prune-deleted-snapshots.js`; `.retention-hold` preserva) | **Só a conta excluída**, e só o que está nas tabelas **no momento** da exclusão: rede de segurança operacional, **não** é arquivo financeiro |
| **Exportação manual do arquivo** (`pg_dump -n`, ver abaixo) | `/var/backups/nailflow/manual/` | Quem exportar | Até descartar manualmente (a subpasta `manual/` não é varrida: o `find` usa `-maxdepth 1`) | O schema de arquivo exportado |

### Exclusão da conta × arquivo: exatamente o que permanece

Medido em `financeiro-delete.test.js` e `financeiro-restore.test.js` (banco descartável, API real):

| Situação no momento da exclusão | O que permanece depois | Por quanto tempo | Como recuperar |
|---|---|---|---|
| **A. Uso normal (025 aplicada, sem rollback prévio).** Os dados financeiros da conta são apagados em cascata do banco | O **snapshot** da exclusão (JSON com movimentações, histórico, fechamentos, despesas e atendimentos com as colunas novas) e os **backups diários** que ainda tiverem a conta | Snapshot: **30 dias**. Backups: **7 dias** | **Não há importador automático do snapshot:** a recuperação é manual a partir do JSON. Os backups recuperam-se com `pg_restore` em **outro** banco (ensaio da seção 9) e extração dos dados |
| **B. Existe um schema de arquivo (rollback anterior) e a conta é excluída.** A estrutura financeira não existe nesse momento | Os dados financeiros **arquivados** da conta **permanecem no schema de arquivo** (as cinco tabelas), **sem prazo**. O snapshot **não** os contém (a estrutura não existia) | Arquivo: sem prazo (descarte manual). Backups: 7 dias | A restauração **não devolve** a conta (ela foi excluída): padrão aborta; com `skip_deleted_accounts=on` restaura as outras contas e **mantém** as linhas dela no arquivo. Os dados dela continuam **consultáveis** no arquivo (`SELECT`) ou exportáveis (`pg_dump -n`); devolvê-los exigiria recriar a conta, o que **não é suportado** |
| **C. Exportação manual do arquivo existe** | A exportação (inclusive a de contas depois excluídas) | Até quem a gerou descartar | `pg_restore` em outro banco e o script de restauração |

**Consequências e riscos**

* O schema de arquivo é a cópia **durável** (no banco). Os backups o contêm, mas **só por 7 dias**: para guardá-lo por mais tempo, exporte-o:
  `sudo -u postgres pg_dump -Fc -n financeiro_arquivo_AAAAMMDD_HH24MISS nailflow > /var/backups/nailflow/manual/financeiro_arquivo_AAAAMMDD_HH24MISS.dump`
  e confira com `pg_restore --list`.
* **Inconsistência a decidir (LGPD):** a exclusão de uma conta é definitiva para o banco, mas **não** alcança o schema de arquivo nem as exportações. Os dados
  de uma conta excluída (descrições e observações de despesas, motivos, valores por atendimento) permanecem lá até o descarte manual. Apagar só as linhas
  de uma conta dentro do arquivo **não é suportado** (invalidaria o manifesto): o descarte é do **schema inteiro**, depois de restaurar ou exportar o que for
  preciso e conforme a política de retenção.
* Os dumps manuais `nailflow_pre-*.dump` também casam com `nailflow_*.dump` e são podados em 7 dias.

**Decisão pendente do responsável (não decidida nesta etapa):** prazo legal/contábil de retenção dos registros financeiros, inclusive os de contas excluídas, e a
política de descarte do schema de arquivo e das exportações. Até lá, nenhuma rotina de poda foi criada para o schema de arquivo.

## 7. Exclusão da profissional com dados financeiros

`adminController.js`: o snapshot passa a incluir `financial_payments`, `financial_audit_log` e `cash_closings` (quando as três existem; sem a
025 o comportamento é o de sempre); o preview mostra `financialPayments`, `financialAuditEntries` e `cashClosings`; e a exclusão, **depois de travar
a conta (`FOR UPDATE`)**, confere que nada financeiro foi gravado depois do snapshot. Se foi, responde **409** e **não apaga nada** (o snapshot já
gravado fica). A trava funciona porque toda gravação financeira tem FK para a conta e pede `FOR KEY SHARE` nela: quem gravou e ainda não confirmou
faz a exclusão esperar (e depois ser contado); quem chega com a exclusão em andamento espera e falha (FK), sem deixar linha órfã. A cascata do banco
foi testada com a role **não-dona** da aplicação.

## 8. Falhas da suíte: o que é preexistente, o que é do ambiente e o que é da aplicação

Dez testes falham, **os mesmos antes e depois da 025** (mesmo teste, mesma mensagem). **Nenhum** é causado pela 025:

| Teste | Causa verificada | Classificação |
|---|---|---|
| `auth-flow` (2) | Esperam `body.token` no login; o login passou a devolver só o cookie (`authController.js`) | Teste desatualizado, **preexistente** (`PENDENCIAS.md` I14) |
| `price-snapshot` (6) | Obtêm `authToken = loginBody.token` (inexistente) e as chamadas seguintes dão 401 | Teste desatualizado, **preexistente** (I14) |
| `availability-check` (1) | Assina um JWT **sem** a claim `ver`; `requireAuth` compara com `token_version` (migration 016) e responde 401 | Teste desatualizado, **preexistente** (I14) |
| `public-profile` (1): "migration 020 pode ser aplicada duas vezes…" | O teste **aplica DDL** (`ALTER TABLE professionals`, migration 020) pelo pool da aplicação; falha com `must be owner of table professionals` (`42501`) quando a aplicação **não** é dona | **Efeito do ambiente** (propriedade), **não** da aplicação |

Sobre `public-profile`, verificado em banco descartável: **como dona 16 de 16 passam; como não-dona 15 de 16** (o único que falha é o do DDL). Os outros 15 testes
exercitam o comportamento da aplicação (página pública, tema, bio, foto) e passam com a role não-dona. O teste **não foi alterado** para passar. Em produção a migration 020
é aplicada por `postgres`, nunca pela aplicação: o teste só faz sentido com a role dona (**pendência de teste:** rodar os testes que aplicam DDL com a URL do dono).

## 9. Ensaio de `pg_dump` / `pg_restore` com a 025 e dados no schema de arquivo

`financeiro-dump.test.js`, em banco descartável, com os mesmos flags do backup de produção (`pg_dump -Fc`, como em `nailflow-backup.sh`) e `pg_restore --exit-on-error` em um banco novo
criado de `template0`. Sem avisos nem erros em nenhum dos dois comandos.

* **Ensaio 1 — recuperação a partir de backup.** Estado "025 reaplicada + schema de arquivo do rollback". Dump, restauração em outro banco, e o **script de restauração rodado no banco restaurado**:
  contagem e hash de **todas as colunas** das cinco tabelas recuperadas **idênticos** aos anteriores ao rollback.
* **Ensaio 2 — fidelidade total** (dados vivos **e** schema de arquivo): **toda tabela** de `public` e dos schemas de arquivo com a **mesma contagem e o mesmo hash**;
  mesmas colunas, constraints, índices, triggers e funções; mesmos **donos e ACLs** (inclusive `fin_audit()` sem `EXECUTE` para o público); mesmas funções `SECURITY DEFINER` com
  `search_path = pg_catalog, pg_temp`; mesmas sequências. O banco de origem **não muda** com o dump.
* **No banco restaurado:** append-only, teto de estorno, dia fechado e idempotência continuam valendo; a role da aplicação lê e insere mas não altera nem apaga (`42501`) e não
  chama as funções internas; a sequência do histórico continua em `max(seq) + 1`; e o arquivo confere com o **próprio manifesto**, tabela por tabela.
* **Artefato conhecido:** após `pg_restore`, o PostgreSQL reescreve o **texto** de expressões (CHECK, predicados de índice parcial, WHEN): listas `IN (...)` de colunas varchar e a parentização de
  cadeias `AND`. Acontece também com constraints **antigas** (`admin_audit_log_action_check`, `support_messages_body_check`, `idx_appointments_expires_at`). Quem comparar o schema por texto verá
  essa diferença; o teste compara essas expressões pela sequência de identificadores, operadores e literais e prova o comportamento exercitando as restrições.
* **Não feito:** rodar o `nailflow-backup.sh` real nem restaurar um dump de produção (tocariam produção).

## 10. Testes

Todos em **bancos descartáveis** de um cluster criado só para isso (PostgreSQL 16, porta própria, só bancos `nf_*_test`, marcador
`NAILFLOW_DISPOSABLE_TEST_DB`), com credenciais de teste. Cada arquivo usa o **seu** banco (variável própria), porque `npm test` roda os arquivos em paralelo.
As conexões de teste fixam `TimeZone=UTC` (uma versão anterior dependia do fuso de cada conexão do pool e fazia um teste falhar de forma intermitente, 3 em 6 execuções; era artefato do teste, as linhas eram idênticas).

| Arquivo | Variável | Testes | O que prova |
|---|---|---|---|
| `financeiro-migrations.test.js` | `FINANCEIRO_MIGRATION_TEST_DB_URL` | 27 | Preservação dos dados legados, reaplicação idempotente, restrições, histórico, isolamento, append-only, estornos e idempotência (inclusive simultâneos), fechamento de caixa, cascata, grants, `search_path` endurecido, **privilégios excessivos e mitigação**, rollback |
| `financeiro-http.test.js` | `FINANCEIRO_HTTP_TEST_DB_URL` | 4 | **API HTTP real** com a role não-dona: Gastos e Agenda idênticos antes da 025, com a 025 sem grants, com grants e **com os privilégios mínimos propostos** |
| `financeiro-delete.test.js` | `FINANCEIRO_DELETE_TEST_DB_URL` | 8 | Preview, snapshot, cascata (role não-dona), 409 por movimentação ou histórico gravados após o snapshot, escritor tardio, conta sem a 025, e **exclusão com schema de arquivo existente** |
| `financeiro-restore.test.js` | `FINANCEIRO_RESTORE_TEST_DB_URL` | 9 | Rollback + reaplicação + restauração com hashes de todas as colunas; recusas; **`skip_deleted_accounts`** |
| `financeiro-dump.test.js` | `FINANCEIRO_DUMP_TEST_DB_URL` | 4 | Ensaio de `pg_dump`/`pg_restore` (seção 9) |

Para rodar: crie o cluster e os bancos (base `schema.sql` + migrations 001..024, **sem** a 025), exporte `NAILFLOW_ALLOW_TEST_DDL=1` e as cinco
variáveis (usuário da URL = superusuário do cluster descartável) e execute `node --test tests/financeiro-*.test.js`. Sem as variáveis, os testes de banco são **ignorados**.

### Resultados da última execução (2026-10-19)

* **Testes do Financeiro:** **52 de 52** passam, em **3 execuções seguidas**, com os cinco arquivos em paralelo, cada um no seu banco; ao final os bancos ficam limpos (sem estrutura, contas, arquivos ou roles de teste).
  O arquivo de restauração, sozinho, passou **10 de 10** vezes depois da correção do fuso.
* **Sensibilidade (os testes não são vacuosos):** desfazer o endurecimento do `search_path` só do guarda faz o ataque funcionar; rodar o teste de exclusão com o controller **original** reprova **7** dos 8 testes (o que passa, a corrida contra a FK, é protegido pelo próprio banco).
* **Suíte completa do backend, antes e depois da 025, em ambiente equivalente:** mesma versão do código, mesmo schema base e `seed.sql`, mesmo Node e cluster, mesmo ambiente (`env -i` com `DATABASE_URL`, `JWT_SECRET`, `FRONTEND_URL`, URLs do n8n vazias, Evolution inválida),
  a aplicação com a **role não-dona** (sem superusuário, com os privilégios das tabelas existentes e `CREATE` em `public`, e, no lado "depois", os grants da 025), e as variáveis do Suporte (`SUPPORT_API_TEST_DB_URL`, `SUPPORT_MIGRATION_TEST_DB_URL`, `NAILFLOW_ALLOW_TEST_DDL=1`) com bancos próprios para cada lado. Um arquivo de teste por vez.

| | Antes da 025 (A) | Depois da 025 (B) |
|---|---|---|
| Testes | 618 | 618 |
| Passam | 557 | 557 |
| Falham | 10 | 10 |
| Ignorados | 51 | 51 |

  Resultado **idêntico** por arquivo, por nome de teste e por mensagem de erro das falhas.
  * **Suporte executado (189 testes, todos passam, nos dois lados):** `support-admin-api` 27, `support-api` 43, `support-audit-filter` 5, `support-delete-professional` 11, `support-domain` 27, `support-faq-seed` 12, `support-migrations` 56, `support-retention` 8.
  * **Falhas (10, as mesmas nos dois lados, nenhuma causada pela 025):** ver a seção 8 (9 testes antigos desatualizados e 1 que aplica DDL e exige a role dona).
  * **Ignorados (51):** só os cinco arquivos do Financeiro (26 + 4 + 8 + 9 + 4), que rodam à parte nos seus bancos, com as variáveis próprias.

### O que **não** foi executado (limitações)

* Nenhum teste contra **produção** ou banco persistente; a role não-dona é uma **simulação** de `nailflow` (privilégios modelados a partir do catálogo de produção lido na revisão anterior e dos registros em `docs/`). Os privilégios **efetivos atuais** de produção, em todas as tabelas, **não** foram relidos: use o script de auditoria.
* Não houve `pg_dump`/`pg_restore` de **produção** nem execução do `nailflow-backup.sh`; o ensaio usou os mesmos flags em banco descartável. A exportação do schema de arquivo com `pg_dump -n` está documentada, mas **não foi executada**.
* Não há rotas de pagamentos: nada exercita gravação financeira pela API (só pelo banco), e a concorrência foi testada nos cenários descritos (não em carga).
* O n8n e o WhatsApp não fazem parte destes testes.

## 11. Pendências

1. Decisão de **retenção** dos registros financeiros (inclusive de contas excluídas) e política de descarte do schema de arquivo e das exportações (seção 6).
2. **Auditar os privilégios reais de `nailflow` em produção** com o script somente leitura e decidir a mitigação (`REVOKE TRUNCATE, TRIGGER, REFERENCES` e `CREATE` em `public`), testada aqui mas **não aplicada**.
3. Regras que continuam na **API** das próximas etapas: recebido ≤ valor final, datas no futuro (fuso do negócio), apagar despesa `paga` e o cálculo dos totais do fechamento. Decidir também se a API grava `correction` direto (privilégio `INSERT` na auditoria).
4. Rotas de pagamentos, check-in/finalização na Agenda, indicadores e frontend: **não iniciados**; só após os testes da seção 10 passarem com elas.
5. Os testes que aplicam DDL pelo pool da aplicação (`public-profile`) devem usar a URL do dono; e os 9 testes desatualizados de login/token (`PENDENCIAS.md` I14) seguem por atualizar (fora do escopo).
6. Publicação única: backup, migration, grants, PM2 e build conforme o roteiro; **sem** autorização expressa, nada disso é feito.
