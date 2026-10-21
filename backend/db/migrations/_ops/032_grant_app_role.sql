-- Permissões da role da APLICAÇÃO sobre reminder_attempts (migration 032). USO MANUAL, depois da 032; ver _ops/README.md.
-- Privilégios mínimos: SELECT, INSERT, UPDATE (reservar, registrar resultado, vencer reserva). Sem DELETE: o cascade da exclusão da conta/agendamento roda com o dono da tabela.
--   sudo -u postgres psql -d nailflow -v ON_ERROR_STOP=1 -v app_role=nailflow -f backend/db/migrations/_ops/032_grant_app_role.sql
\if :{?app_role}
\else
  \echo 'defina a role da aplicacao: -v app_role=<role>'
  \quit
\endif
BEGIN;
GRANT SELECT, INSERT, UPDATE ON reminder_attempts TO :"app_role";
COMMIT;
