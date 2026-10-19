-- Permissões da role da APLICAÇÃO sobre cash_closing_entries (migration 029). USO MANUAL, depois da 029; ver _ops/README.md.
-- Privilégios MÍNIMOS: SELECT e INSERT (append-only por gatilho E por privilégio). cash_closings já tem os da 025 (SELECT, INSERT, UPDATE).
--   sudo -u postgres psql -d nailflow -v ON_ERROR_STOP=1 -v app_role=nailflow -f backend/db/migrations/_ops/029_grant_app_role.sql
-- Idempotente. Termina conferindo e ABORTA se algo estiver diferente.

\if :{?app_role}
\else
  \echo 'defina a role da aplicacao: -v app_role=<role>'
  \quit
\endif

BEGIN;

SELECT set_config('financeiro.app_role', :'app_role', true);

GRANT SELECT, INSERT ON cash_closing_entries TO :"app_role";

DO $verify$
DECLARE
  r text := current_setting('financeiro.app_role');
  p text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
    RAISE EXCEPTION 'grant abortado: a role "%" nao existe', r;
  END IF;
  FOREACH p IN ARRAY ARRAY['SELECT', 'INSERT'] LOOP
    IF NOT has_table_privilege(r, 'public.cash_closing_entries', p) THEN
      RAISE EXCEPTION 'grant abortado: a role "%" ainda nao tem % em cash_closing_entries', r, p;
    END IF;
  END LOOP;
  FOREACH p IN ARRAY ARRAY['UPDATE', 'DELETE', 'TRUNCATE'] LOOP
    IF has_table_privilege(r, 'public.cash_closing_entries', p) THEN
      RAISE EXCEPTION 'grant abortado: a role "%" NAO deveria ter % em cash_closing_entries (append-only); revogue (se for superusuario, ignore)', r, p;
    END IF;
  END LOOP;
END
$verify$;

COMMIT;
\echo 'ok: privilegios de cash_closing_entries conferidos'
