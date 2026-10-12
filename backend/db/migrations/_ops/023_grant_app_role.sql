-- Permissões da role da APLICAÇÃO sobre os objetos da Central de Suporte (migration 023). USO MANUAL, depois da 023.
-- NÃO faz parte da instalação por ordem de migrations; ver _ops/README.md.
--
-- POR QUE EXISTE: a 023 não tem GRANT. Se ela for aplicada por uma role que NÃO é a da aplicação (em produção:
-- superusuário postgres, porque professionals pertence a postgres e a 023 faz ALTER TABLE nela), as 5 tabelas e a
-- sequência nascem de propriedade do postgres, sem acesso para a role da aplicação, e TODA operação de suporte
-- falha com "permission denied for table ..." (42501). Em bancos onde a própria role da aplicação aplica a 023
-- (bancos descartáveis dos testes) isto é desnecessário (e inofensivo).
--
-- Privilégios MÍNIMOS, o que o código usa de fato:
--   support_faq_categories      SELECT
--   support_faq_articles        SELECT, INSERT, UPDATE        (a ADM não exclui artigos)
--   support_tickets             SELECT, INSERT, UPDATE        (não há exclusão pela API)
--   support_messages            SELECT, INSERT                (imutável: sem UPDATE/DELETE)
--   support_ticket_events       SELECT, INSERT                (imutável: sem UPDATE/DELETE)
--   support_tickets_ticket_number_seq   USAGE                  (número da solicitação)
-- A exclusão de uma conta apaga as solicitações em CASCADE pela chave estrangeira, que não exige DELETE da aplicação
-- nessas tabelas (verificado em tests/support-delete-professional.test.js com a divisão de donos de produção).
--
-- Uso (como a role que tem o objeto: em produção postgres; conferir o banco antes):
--   sudo -u postgres psql -d nailflow -v ON_ERROR_STOP=1 -v app_role=nailflow \
--        -f backend/db/migrations/_ops/023_grant_app_role.sql
-- Idempotente (GRANT repetido não faz mal). Termina conferindo, e ABORTA se faltar algum privilégio.
-- Reversão: REVOKE dos mesmos privilégios (não é preciso: o rollback 023 derruba as tabelas e os GRANTs vão junto).

\if :{?app_role}
\else
  \echo 'defina a role da aplicacao: -v app_role=<role>'
  \quit
\endif

BEGIN;

SELECT set_config('support.app_role', :'app_role', true);

GRANT SELECT                 ON support_faq_categories TO :"app_role";
GRANT SELECT, INSERT, UPDATE ON support_faq_articles   TO :"app_role";
GRANT SELECT, INSERT, UPDATE ON support_tickets        TO :"app_role";
GRANT SELECT, INSERT         ON support_messages       TO :"app_role";
GRANT SELECT, INSERT         ON support_ticket_events  TO :"app_role";
GRANT USAGE ON SEQUENCE support_tickets_ticket_number_seq TO :"app_role";

DO $verify$
DECLARE
  r      text := current_setting('support.app_role');
  needed text[][] := ARRAY[
    ['support_faq_categories', 'SELECT'],
    ['support_faq_articles',   'SELECT'], ['support_faq_articles',   'INSERT'], ['support_faq_articles', 'UPDATE'],
    ['support_tickets',        'SELECT'], ['support_tickets',        'INSERT'], ['support_tickets',      'UPDATE'],
    ['support_messages',       'SELECT'], ['support_messages',       'INSERT'],
    ['support_ticket_events',  'SELECT'], ['support_ticket_events',  'INSERT']
  ];
  i int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
    RAISE EXCEPTION 'grant abortado: a role "%" nao existe', r;
  END IF;
  FOR i IN 1 .. array_length(needed, 1) LOOP
    IF NOT has_table_privilege(r, 'public.' || needed[i][1], needed[i][2]) THEN
      RAISE EXCEPTION 'grant abortado: a role "%" ainda nao tem % em %', r, needed[i][2], needed[i][1];
    END IF;
  END LOOP;
  IF NOT has_sequence_privilege(r, 'public.support_tickets_ticket_number_seq', 'USAGE') THEN
    RAISE EXCEPTION 'grant abortado: a role "%" nao tem USAGE na sequencia de numeros de solicitacao', r;
  END IF;
END
$verify$;

COMMIT;
