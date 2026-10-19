-- Auditoria SOMENTE LEITURA dos privilégios efetivos da role da aplicação. USO MANUAL; ver _ops/README.md e docs/FINANCEIRO_ETAPA1.md.
-- Não altera nada: a sessão é aberta em modo somente leitura e só há SELECT. Serve para conferir, em qualquer banco (inclusive o
-- de produção, por quem tem autorização), os privilégios de `nailflow` contra o que o código usa e o que a 025 exige.
--
--   sudo -u postgres psql -d nailflow -X -v app_role=nailflow -f backend/db/migrations/_ops/025_audit_app_privileges.sql
--
-- O que o código da aplicação usa (conferido por busca em backend/src): SELECT/INSERT/UPDATE/DELETE (DML). Não há DDL, TRUNCATE,
-- CREATE TRIGGER, REFERENCES, COPY nem SET ROLE. Portanto TRUNCATE, TRIGGER, REFERENCES e CREATE no schema public são EXCESSIVOS.
-- Por que importam: (a) TRUNCATE apaga uma tabela sem disparar os triggers de histórico; (b) TRIGGER + CREATE em public permitem
-- criar um trigger cuja função roda com os privilégios de QUEM executa o comando (inclusive o dono, quando a manutenção ou a
-- cascata de uma exclusão de conta roda como postgres); (c) tabelas que pertencem à própria role não podem ser protegidas por
-- privilégio.

\if :{?app_role}
\else
  \echo 'defina a role da aplicacao: -v app_role=<role>'
  \quit
\endif

SET default_transaction_read_only = on;

\echo
\echo '== 1. A role (esperado: nao superusuaria, sem createdb/createrole/replication/bypassrls, sem membership)'
SELECT rolname, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls,
       (SELECT count(*) FROM pg_auth_members m WHERE m.member = r.oid) AS membro_de
  FROM pg_roles r WHERE rolname = :'app_role';

\echo
\echo '== 2. Schema public (esperado: CREATE = f para a role; PUBLIC sem CREATE)'
SELECT n.nspname, n.nspowner::regrole AS dono,
       has_schema_privilege(:'app_role', n.oid, 'USAGE')  AS role_usage,
       has_schema_privilege(:'app_role', n.oid, 'CREATE') AS role_create,
       has_schema_privilege('public', n.oid, 'CREATE')    AS public_create
  FROM pg_namespace n WHERE n.nspname = 'public';

\echo
\echo '== 3. ALTER DEFAULT PRIVILEGES (esperado: 0 linhas; tabelas novas nascem sem acesso)'
SELECT count(*) AS default_acl FROM pg_default_acl;

\echo
\echo '== 4. Tabelas cujo DONO e a role (esperado: nenhuma; nessas, append-only por privilegio nao vale)'
SELECT schemaname, tablename FROM pg_tables WHERE tableowner = :'app_role' AND schemaname = 'public' ORDER BY 2;

\echo
\echo '== 5. Privilegios EXCESSIVOS (TRUNCATE, TRIGGER, REFERENCES) por tabela (esperado: nenhuma linha)'
SELECT c.relname AS tabela,
       concat_ws(', ',
         CASE WHEN has_table_privilege(:'app_role', c.oid, 'TRUNCATE')   THEN 'TRUNCATE' END,
         CASE WHEN has_table_privilege(:'app_role', c.oid, 'TRIGGER')    THEN 'TRIGGER' END,
         CASE WHEN has_table_privilege(:'app_role', c.oid, 'REFERENCES') THEN 'REFERENCES' END) AS excessivos
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
   AND (has_table_privilege(:'app_role', c.oid, 'TRUNCATE') OR has_table_privilege(:'app_role', c.oid, 'TRIGGER')
        OR has_table_privilege(:'app_role', c.oid, 'REFERENCES'))
 ORDER BY 1;

\echo
\echo '== 6. Tabelas financeiras da 025: privilegios necessarios x efetivos (coluna "situacao" deve ser OK em todas)'
WITH esperado(tabela, priv) AS (VALUES
  ('financial_payments', 'SELECT'), ('financial_payments', 'INSERT'),
  ('financial_audit_log', 'SELECT'), ('financial_audit_log', 'INSERT'),
  ('cash_closings', 'SELECT'), ('cash_closings', 'INSERT'), ('cash_closings', 'UPDATE')),
todas(tabela, priv) AS (
  SELECT t.tabela, p.priv FROM (VALUES ('financial_payments'), ('financial_audit_log'), ('cash_closings')) t(tabela)
  CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) p(priv))
SELECT t.tabela, t.priv,
       (e.tabela IS NOT NULL) AS necessario,
       CASE WHEN to_regclass('public.' || t.tabela) IS NULL THEN 'TABELA AUSENTE (025 nao aplicada)'
            ELSE has_table_privilege(:'app_role', 'public.' || t.tabela, t.priv)::text END AS efetivo,
       CASE WHEN to_regclass('public.' || t.tabela) IS NULL THEN '-'
            WHEN e.tabela IS NOT NULL AND has_table_privilege(:'app_role', 'public.' || t.tabela, t.priv) THEN 'OK'
            WHEN e.tabela IS NULL AND NOT has_table_privilege(:'app_role', 'public.' || t.tabela, t.priv) THEN 'OK'
            WHEN e.tabela IS NOT NULL THEN 'FALTA CONCEDER'
            ELSE 'EXCESSIVO' END AS situacao
  FROM todas t LEFT JOIN esperado e ON e.tabela = t.tabela AND e.priv = t.priv
 ORDER BY t.tabela, t.priv;

\echo
\echo '== 7. Funcoes internas (esperado: a role NAO executa fin_audit nem fin_day_is_closed)'
SELECT p.oid::regprocedure AS funcao, p.prosecdef AS security_definer, p.proconfig AS config,
       has_function_privilege(:'app_role', p.oid, 'EXECUTE') AS role_executa
  FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('fin_audit', 'fin_day_is_closed') ORDER BY 1;

\echo
\echo '== 8. Funcoes fin_* sem search_path = pg_catalog, pg_temp (esperado: nenhuma linha)'
SELECT p.oid::regprocedure AS funcao, p.proconfig FROM pg_proc p
 WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'fin\_%'
   AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, '{}')) c WHERE c = 'search_path=pg_catalog, pg_temp');

\echo
\echo '== 9. Resumo dos privilegios da role em todas as tabelas de public (para registro)'
SELECT c.relname AS tabela, c.relowner::regrole AS dono,
       concat_ws(',',
         CASE WHEN has_table_privilege(:'app_role', c.oid, 'SELECT') THEN 'S' END,
         CASE WHEN has_table_privilege(:'app_role', c.oid, 'INSERT') THEN 'I' END,
         CASE WHEN has_table_privilege(:'app_role', c.oid, 'UPDATE') THEN 'U' END,
         CASE WHEN has_table_privilege(:'app_role', c.oid, 'DELETE') THEN 'D' END,
         CASE WHEN has_table_privilege(:'app_role', c.oid, 'TRUNCATE') THEN 'T!' END,
         CASE WHEN has_table_privilege(:'app_role', c.oid, 'REFERENCES') THEN 'R!' END,
         CASE WHEN has_table_privilege(:'app_role', c.oid, 'TRIGGER') THEN 'G!' END) AS privilegios
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') ORDER BY 1;
