-- Permissões da role da APLICAÇÃO sobre portfolio_photos (migration 031). USO MANUAL, depois da 031; ver _ops/README.md.
-- As colunas novas de services/clients/professionals herdam os privilégios que a role já tem nessas tabelas.
--   sudo -u postgres psql -d nailflow -v ON_ERROR_STOP=1 -v app_role=nailflow -f backend/db/migrations/_ops/031_grant_app_role.sql
\if :{?app_role}
\else
  \echo 'defina a role da aplicacao: -v app_role=<role>'
  \quit
\endif
BEGIN;
GRANT SELECT, INSERT, DELETE ON portfolio_photos TO :"app_role";
COMMIT;
