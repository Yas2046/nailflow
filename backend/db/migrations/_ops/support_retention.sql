-- Rotina de retenção da Central de Suporte (docs/SUPORTE_PRIVACIDADE_RETENCAO.md). NÃO está agendada.
--
-- Executar como a role que tem DELETE/UPDATE nas tabelas (em produção: postgres, pelo socket), por exemplo:
--   sudo -u postgres psql -d nailflow -v ON_ERROR_STOP=1 -f backend/db/migrations/_ops/support_retention.sql
-- Confira antes o banco (SELECT current_database();). Esta pasta (_ops) nunca é executada pela instalação.
--
-- O QUE FAZ
--  1) CHAMADOS RESOLVIDOS (sempre): apaga o chamado resolvido há mais de :tickets_months meses (padrão 6, mínimo 1),
--     contados da ÚLTIMA resolução (resolved_at é zerado ao reabrir). Mensagens e eventos caem em cascata
--     (ON DELETE CASCADE). Chamados abertos, em atendimento ou aguardando NUNCA são tocados.
--  2) AUDITORIA ADMINISTRATIVA (somente com -v audit_enabled=on): linhas com mais de :audit_identifiable_months
--     meses (padrão 12) têm actor_email e target_business_name trocados por '[anonimizado]' (a ação, a data e os ids
--     ficam); linhas com mais de :audit_total_months meses (padrão 36) são apagadas. DESLIGADA POR PADRÃO: a
--     ativação depende da validação de privacidade (SUPORTE_PRIVACIDADE_RETENCAO.md). audit_enabled só aceita
--     on, off, true, false, 1 ou 0; qualquer outro valor aborta antes de alterar algo.
--
-- Variáveis (-v nome=valor): tickets_months, audit_enabled, audit_identifiable_months, audit_total_months.
-- Imprime só contagens. Tudo ocorre em UMA transação: qualquer erro desfaz tudo. lock_timeout de 5 s.

\set ON_ERROR_STOP on
\if :{?tickets_months}
\else
  \set tickets_months 6
\endif
\if :{?audit_identifiable_months}
\else
  \set audit_identifiable_months 12
\endif
\if :{?audit_total_months}
\else
  \set audit_total_months 36
\endif
\if :{?audit_enabled}
\else
  \set audit_enabled off
\endif

BEGIN;
SET LOCAL lock_timeout = '5s';

-- O psql não interpola variáveis dentro de $$...$$: os parâmetros vão para configurações da transação.
SELECT set_config('nf_retention.tickets_months', :'tickets_months', true) AS p1,
       set_config('nf_retention.audit_identifiable_months', :'audit_identifiable_months', true) AS p2,
       set_config('nf_retention.audit_total_months', :'audit_total_months', true) AS p3,
       set_config('nf_retention.audit_enabled', :'audit_enabled', true) AS p4 \gset _

-- Validação dos parâmetros (inteiros e coerentes) antes de qualquer alteração.
DO $v$
DECLARE
  t  integer := current_setting('nf_retention.tickets_months')::integer;
  ai integer := current_setting('nf_retention.audit_identifiable_months')::integer;
  v_total integer := current_setting('nf_retention.audit_total_months')::integer;
BEGIN
  IF t < 1 THEN
    RAISE EXCEPTION 'tickets_months deve ser >= 1 (a reabertura pela profissional dura 7 dias); recebido %', t;
  END IF;
  IF ai < 1 OR v_total <= ai THEN
    RAISE EXCEPTION 'audit_identifiable_months deve ser >= 1 e audit_total_months deve ser maior que ele; recebidos % e %', ai, v_total;
  END IF;
  -- O psql trata um valor não booleano em \if como "falso" sem abortar; por isso o valor é validado aqui,
  -- antes de qualquer alteração (um erro de digitação nunca deve ser lido como "auditoria desligada" em silêncio).
  IF current_setting('nf_retention.audit_enabled') NOT IN ('on', 'off', 'true', 'false', '1', '0') THEN
    RAISE EXCEPTION 'audit_enabled deve ser on, off, true, false, 1 ou 0; recebido "%"', current_setting('nf_retention.audit_enabled');
  END IF;
  IF to_regclass('public.support_tickets') IS NULL THEN
    RAISE EXCEPTION 'support_tickets não existe neste banco (migration 023 não aplicada)';
  END IF;
END $v$;

SELECT current_database() AS banco, :'tickets_months'::integer AS meses_chamados_resolvidos, :'audit_enabled' AS auditoria;

-- 1) Chamados resolvidos vencidos (contagens antes de apagar; mensagens e eventos saem por cascata).
SELECT
  (SELECT count(*) FROM support_tickets
    WHERE status = 'resolvida' AND resolved_at < now() - make_interval(months => :'tickets_months'::integer)) AS chamados_a_apagar,
  (SELECT count(*) FROM support_messages m JOIN support_tickets t ON t.id = m.ticket_id
    WHERE t.status = 'resolvida' AND t.resolved_at < now() - make_interval(months => :'tickets_months'::integer)) AS mensagens_a_apagar,
  (SELECT count(*) FROM support_ticket_events e JOIN support_tickets t ON t.id = e.ticket_id
    WHERE t.status = 'resolvida' AND t.resolved_at < now() - make_interval(months => :'tickets_months'::integer)) AS eventos_a_apagar;

WITH apagados AS (
  DELETE FROM support_tickets
   WHERE status = 'resolvida' AND resolved_at < now() - make_interval(months => :'tickets_months'::integer)
  RETURNING 1
)
SELECT count(*) AS chamados_apagados FROM apagados;

-- 2) Auditoria administrativa (opt-in).
\if :audit_enabled
  WITH anon AS (
    UPDATE admin_audit_log
       SET actor_email = '[anonimizado]', target_business_name = '[anonimizado]'
     WHERE created_at < now() - make_interval(months => :'audit_identifiable_months'::integer)
       AND created_at >= now() - make_interval(months => :'audit_total_months'::integer)   -- as que serão apagadas abaixo não contam
       AND (actor_email <> '[anonimizado]' OR target_business_name <> '[anonimizado]')
    RETURNING 1
  )
  SELECT count(*) AS auditoria_anonimizada FROM anon;

  WITH del AS (
    DELETE FROM admin_audit_log
     WHERE created_at < now() - make_interval(months => :'audit_total_months'::integer)
    RETURNING 1
  )
  SELECT count(*) AS auditoria_apagada FROM del;
\else
  SELECT 'DESLIGADA (audit_enabled != on): nada foi feito na auditoria' AS auditoria_administrativa;
\endif

COMMIT;
