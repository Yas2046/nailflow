-- Permissões da role da APLICAÇÃO sobre password_reset_tokens (migration 030). USO MANUAL, depois da 030; ver _ops/README.md.
-- Privilégios mínimos: SELECT, INSERT, UPDATE (marcar uso). Sem DELETE: o cascade da exclusão da conta roda com o dono da tabela.
--   sudo -u postgres psql -d nailflow -v ON_ERROR_STOP=1 -v app_role=nailflow -f backend/db/migrations/_ops/030_grant_app_role.sql
\if :{?app_role}
\else
  \echo 'defina a role da aplicacao: -v app_role=<role>'
  \quit
\endif
BEGIN;
GRANT SELECT, INSERT, UPDATE ON password_reset_tokens TO :"app_role";
COMMIT;
