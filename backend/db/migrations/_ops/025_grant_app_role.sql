-- Permissões da role da APLICAÇÃO sobre os objetos do Financeiro (migration 025). USO MANUAL, depois da 025.
-- NÃO faz parte da instalação por ordem de migrations; ver _ops/README.md. Mesmo motivo do 023_grant_app_role.sql:
-- a 025 não tem GRANT; se for aplicada por uma role que não é a da aplicação (em produção: postgres aplica,
-- nailflow usa), as tabelas novas nascem sem acesso para a aplicação.
--
-- Privilégios MÍNIMOS (append-only é reforçado também por privilégio, além dos triggers):
--   financial_payments    SELECT, INSERT             (sem UPDATE, DELETE nem TRUNCATE)
--   financial_audit_log   SELECT, INSERT             (sem UPDATE, DELETE nem TRUNCATE; os triggers de auditoria gravam como a aplicação)
--   cash_closings         SELECT, INSERT, UPDATE     (fechar e reabrir; sem DELETE nem TRUNCATE)
-- appointments e expenses já têm os privilégios da aplicação; as colunas novas herdam o privilégio da tabela.
-- A exclusão da conta apaga as linhas novas em CASCADE pela chave estrangeira, que não exige DELETE da aplicação.
--
-- Uso (como a role que é dona dos objetos; em produção postgres; conferir o banco antes):
--   sudo -u postgres psql -d nailflow -v ON_ERROR_STOP=1 -v app_role=nailflow \
--        -f backend/db/migrations/_ops/025_grant_app_role.sql
-- Idempotente. Termina conferindo (inclusive que a aplicação NÃO tem UPDATE/DELETE/TRUNCATE nas tabelas append-only)
-- e ABORTA se algo estiver diferente.

\if :{?app_role}
\else
  \echo 'defina a role da aplicacao: -v app_role=<role>'
  \quit
\endif

BEGIN;

SELECT set_config('financeiro.app_role', :'app_role', true);

GRANT SELECT, INSERT         ON financial_payments  TO :"app_role";
GRANT SELECT, INSERT         ON financial_audit_log TO :"app_role";
GRANT SELECT, INSERT, UPDATE ON cash_closings       TO :"app_role";

DO $verify$
DECLARE
  r text := current_setting('financeiro.app_role');
  i int;
  needed text[][] := ARRAY[
    ['financial_payments', 'SELECT'], ['financial_payments', 'INSERT'],
    ['financial_audit_log', 'SELECT'], ['financial_audit_log', 'INSERT'],
    ['cash_closings', 'SELECT'], ['cash_closings', 'INSERT'], ['cash_closings', 'UPDATE']];
  forbidden text[][] := ARRAY[
    ['financial_payments', 'UPDATE'], ['financial_payments', 'DELETE'], ['financial_payments', 'TRUNCATE'],
    ['financial_audit_log', 'UPDATE'], ['financial_audit_log', 'DELETE'], ['financial_audit_log', 'TRUNCATE'],
    ['cash_closings', 'DELETE'], ['cash_closings', 'TRUNCATE']];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
    RAISE EXCEPTION 'grant abortado: a role "%" nao existe', r;
  END IF;
  FOR i IN 1 .. array_length(needed, 1) LOOP
    IF NOT has_table_privilege(r, 'public.' || needed[i][1], needed[i][2]) THEN
      RAISE EXCEPTION 'grant abortado: a role "%" ainda nao tem % em %', r, needed[i][2], needed[i][1];
    END IF;
  END LOOP;
  FOR i IN 1 .. array_length(forbidden, 1) LOOP
    IF has_table_privilege(r, 'public.' || forbidden[i][1], forbidden[i][2]) THEN
      RAISE EXCEPTION 'grant abortado: a role "%" NAO deveria ter % em % (tabela append-only); revogue (se for superusuario, ignore)', r, forbidden[i][2], forbidden[i][1];
    END IF;
  END LOOP;
END
$verify$;

COMMIT;
\echo 'ok: privilegios do Financeiro conferidos'
