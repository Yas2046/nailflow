-- Reverte 023_support_center.sql. USO MANUAL; nenhum processo automático executa este arquivo.
-- DESTRUTIVO: apaga solicitações, mensagens, eventos e artigos de FAQ, e a preferência
-- professionals.support_fab_hidden de todas as contas. Leia _rollback/README.md antes.
--
-- Proteção: se existir QUALQUER dado de suporte, o script aborta sem alterar nada, a menos que a
-- sessão tenha recebido a autorização explícita abaixo (mesma sessão do psql, antes do -f):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -c "SET support.confirm_destructive_rollback = 'DESTRUIR-DADOS-DE-SUPORTE'" \
--     -f db/migrations/_rollback/023_support_center.down.sql
-- Sem dados de suporte (ex.: banco descartável), roda sem a autorização.
-- A autorização é uma trava contra acidente, não um controle de acesso: quem pode executar DDL
-- neste banco pode contorná-la.
--
-- Concorrência: as tabelas são BLOQUEADAS (ACCESS EXCLUSIVE) antes de contar, e o bloqueio dura até o
-- COMMIT. Sem isso, um INSERT concorrente poderia confirmar entre a contagem e o DROP e ser destruído sem
-- passar pela autorização. Se o bloqueio não sair em 3 s (lock_timeout) ou houver deadlock, o script ABORTA
-- com mensagem clara e não apaga nada; um insert que esperava o bloqueio falha depois com "relation does
-- not exist". Isso bloqueia as tabelas de suporte e professionals durante a execução (curta): pare a API
-- antes (ver _rollback/README.md).

BEGIN;

SET LOCAL lock_timeout = '3s';

DO $lock$
DECLARE
  t text;
BEGIN
  -- Filhas antes das mães (mesma ordem dos DROPs); professionals por último.
  FOREACH t IN ARRAY ARRAY['support_ticket_events', 'support_messages', 'support_tickets',
                           'support_faq_articles', 'support_faq_categories'] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('LOCK TABLE public.%I IN ACCESS EXCLUSIVE MODE', t);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('public.professionals')
               AND attname = 'support_fab_hidden' AND NOT attisdropped) THEN
    LOCK TABLE public.professionals IN ACCESS EXCLUSIVE MODE;
  END IF;
EXCEPTION
  WHEN lock_not_available OR deadlock_detected THEN
    RAISE EXCEPTION 'rollback 023 abortado: não foi possível bloquear as tabelas de suporte (%). Nada foi apagado.', SQLERRM
      USING ERRCODE = '55P03',
            HINT = 'Há transações usando essas tabelas. Pare a API, aguarde as transações terminarem e repita.';
END
$lock$;

DO $guard$
DECLARE
  n_tickets  bigint := 0;
  n_messages bigint := 0;
  n_events   bigint := 0;
  n_articles bigint := 0;
  n_prefs    bigint := 0;
BEGIN
  IF to_regclass('public.support_tickets') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.support_tickets' INTO n_tickets;
  END IF;
  IF to_regclass('public.support_messages') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.support_messages' INTO n_messages;
  END IF;
  IF to_regclass('public.support_ticket_events') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.support_ticket_events' INTO n_events;
  END IF;
  IF to_regclass('public.support_faq_articles') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.support_faq_articles' INTO n_articles;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('public.professionals')
               AND attname = 'support_fab_hidden' AND NOT attisdropped) THEN
    EXECUTE 'SELECT count(*) FROM public.professionals WHERE support_fab_hidden' INTO n_prefs;
  END IF;

  IF n_tickets + n_messages + n_events + n_articles + n_prefs > 0
     AND COALESCE(current_setting('support.confirm_destructive_rollback', true), '') <> 'DESTRUIR-DADOS-DE-SUPORTE' THEN
    RAISE EXCEPTION 'rollback 023 abortado: há dados de suporte (solicitações=%, mensagens=%, eventos=%, artigos de FAQ=%, preferências do botão=%). Nada foi apagado.',
      n_tickets, n_messages, n_events, n_articles, n_prefs
      USING HINT = 'Faça backup e, se a remoção for mesmo intencional, informe a autorização explícita descrita no topo deste arquivo.';
  END IF;
END
$guard$;

DROP TABLE IF EXISTS public.support_ticket_events;
DROP TABLE IF EXISTS public.support_messages;
DROP TABLE IF EXISTS public.support_tickets;
DROP TABLE IF EXISTS public.support_faq_articles;
DROP TABLE IF EXISTS public.support_faq_categories;
DROP FUNCTION IF EXISTS public.support_assign_activity_seq();
DROP FUNCTION IF EXISTS public.support_apply_activity();
DROP FUNCTION IF EXISTS public.support_tickets_insert_guard();
DROP FUNCTION IF EXISTS public.support_tickets_guard();
DROP FUNCTION IF EXISTS public.support_append_only_guard();
ALTER TABLE public.professionals DROP COLUMN IF EXISTS support_fab_hidden;

COMMIT;
