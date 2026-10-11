-- Amplia as ações aceitas por admin_audit_log para a Central de Ajuda e Suporte
-- (FAQ, status e prioridade de solicitações), preservando block/unblock/update/delete.
--
-- A constraint existente chama-se admin_audit_log_action_check (migration 019), é um CHECK sobre
-- action varchar(20): a mais longa das novas ('support_priority') tem 16 caracteres.
-- Esta migration NÃO presume que ela existe: se não encontrar exatamente essa constraint como CHECK
-- válido sobre "action" (ou se houver OUTRO CHECK sobre "action", que continuaria rejeitando as
-- ações novas), ABORTA com mensagem clara. Ao final valida o resultado.
--
-- A auditoria registra QUEM fez O QUÊ sobre QUEM (target_id/target_business_name); nunca grava texto
-- de mensagem, assunto, senha ou outro dado sensível. Nas ações faq_* o alvo é o artigo:
-- target_id = id do artigo e target_business_name = título do artigo (limitado a 120 caracteres
-- em support_faq_articles justamente para caber em varchar(120)).
-- Não existe ação faq_reorder: reordenar a FAQ é registrado como faq_update, uma linha por artigo
-- cuja posição mudou. Mudança de status (inclusive reabertura pela ADM) = support_status;
-- mudança de prioridade = support_priority.
--
-- Idempotente (pode ser reaplicada) e transacional.
-- Rollback: db/migrations/_rollback/024_audit_actions_support.down.sql (ver README)

BEGIN;

SET LOCAL lock_timeout = '3s';

-- Pré-condição: a constraint esperada existe, é CHECK, está validada e é a única sobre "action".
DO $pre$
DECLARE
  v_def   text;
  v_other integer;
BEGIN
  SELECT pg_get_constraintdef(c.oid) INTO v_def
    FROM pg_constraint c
   WHERE c.conrelid = to_regclass('public.admin_audit_log')
     AND c.conname = 'admin_audit_log_action_check'
     AND c.contype = 'c' AND c.convalidated;
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'migration 024: constraint admin_audit_log_action_check não encontrada como CHECK válido em admin_audit_log (a migration 019 foi aplicada?)';
  END IF;
  IF v_def !~ '(^|[^a-z_])action([^a-z_]|$)' THEN
    RAISE EXCEPTION 'migration 024: admin_audit_log_action_check não é um CHECK sobre a coluna action: %', v_def;
  END IF;

  SELECT count(*) INTO v_other
    FROM pg_constraint c
   WHERE c.conrelid = to_regclass('public.admin_audit_log') AND c.contype = 'c'
     AND c.conname <> 'admin_audit_log_action_check'
     AND pg_get_constraintdef(c.oid) ~ '(^|[^a-z_])action([^a-z_]|$)';
  IF v_other > 0 THEN
    RAISE EXCEPTION 'migration 024: existe outro CHECK sobre action em admin_audit_log, que continuaria rejeitando as ações novas';
  END IF;
END
$pre$;

-- Sem IF EXISTS: a pré-condição acima já garantiu que a constraint está lá.
ALTER TABLE admin_audit_log DROP CONSTRAINT admin_audit_log_action_check;
ALTER TABLE admin_audit_log ADD CONSTRAINT admin_audit_log_action_check CHECK (action IN (
  'block', 'unblock', 'update', 'delete',
  'faq_create', 'faq_update', 'faq_publish', 'faq_unpublish',
  'support_status', 'support_priority'
));

-- Pós-condição: estrutura resultante.
DO $post$
DECLARE
  v_count integer;
  v_def   text;
  v_vals  text[];
BEGIN
  SELECT count(*) INTO v_count
    FROM pg_constraint c
   WHERE c.conrelid = to_regclass('public.admin_audit_log') AND c.contype = 'c'
     AND pg_get_constraintdef(c.oid) ~ '(^|[^a-z_])action([^a-z_]|$)';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'migration 024: esperado exatamente 1 CHECK sobre action, encontrado %', v_count;
  END IF;

  SELECT pg_get_constraintdef(c.oid) INTO v_def
    FROM pg_constraint c
   WHERE c.conrelid = to_regclass('public.admin_audit_log')
     AND c.conname = 'admin_audit_log_action_check' AND c.contype = 'c' AND c.convalidated;
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'migration 024: admin_audit_log_action_check ausente ou não validada após a alteração';
  END IF;

  SELECT array_agg(m[1] ORDER BY m[1]) INTO v_vals FROM regexp_matches(v_def, '''([a-z_]+)''::', 'g') AS m;
  IF v_vals IS DISTINCT FROM (SELECT array_agg(x ORDER BY x) FROM unnest(ARRAY['block', 'unblock', 'update', 'delete',
          'faq_create', 'faq_update', 'faq_publish', 'faq_unpublish', 'support_status', 'support_priority']) AS x) THEN
    RAISE EXCEPTION 'migration 024: conjunto de ações da constraint diferente do esperado: %', v_vals;
  END IF;
END
$post$;

COMMIT;
