-- Permissões da role da APLICAÇÃO sobre expense_payments (migration 028). USO MANUAL, depois da 028; ver _ops/README.md.
-- Privilégios MÍNIMOS: SELECT e INSERT (append-only por trigger E por privilégio: sem UPDATE, DELETE nem TRUNCATE).
-- O histórico e a quitação da despesa são gravados pelos gatilhos SECURITY DEFINER da 028; expenses já tem os privilégios da aplicação.
--   sudo -u postgres psql -d nailflow -v ON_ERROR_STOP=1 -v app_role=nailflow -f backend/db/migrations/_ops/028_grant_app_role.sql
-- Idempotente. Termina conferindo e ABORTA se algo estiver diferente.

\if :{?app_role}
\else
  \echo 'defina a role da aplicacao: -v app_role=<role>'
  \quit
\endif

BEGIN;

SELECT set_config('financeiro.app_role', :'app_role', true);

GRANT SELECT, INSERT ON expense_payments TO :"app_role";

DO $verify$
DECLARE
  r text := current_setting('financeiro.app_role');
  p text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
    RAISE EXCEPTION 'grant abortado: a role "%" nao existe', r;
  END IF;
  FOREACH p IN ARRAY ARRAY['SELECT', 'INSERT'] LOOP
    IF NOT has_table_privilege(r, 'public.expense_payments', p) THEN
      RAISE EXCEPTION 'grant abortado: a role "%" ainda nao tem % em expense_payments', r, p;
    END IF;
  END LOOP;
  FOREACH p IN ARRAY ARRAY['UPDATE', 'DELETE', 'TRUNCATE'] LOOP
    IF has_table_privilege(r, 'public.expense_payments', p) THEN
      RAISE EXCEPTION 'grant abortado: a role "%" NAO deveria ter % em expense_payments (append-only); revogue (se for superusuario, ignore)', r, p;
    END IF;
  END LOOP;
END
$verify$;

COMMIT;
\echo 'ok: privilegios de expense_payments conferidos'
