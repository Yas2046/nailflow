-- Reverte 024_audit_actions_support.sql: volta o CHECK às 4 ações originais. USO MANUAL.
-- Não apaga auditoria: se já existirem registros com as ações novas, ABORTA sem alterar nada.
-- Também aborta se a constraint esperada não existir como CHECK válido sobre "action".
-- Leia _rollback/README.md antes.

BEGIN;

SET LOCAL lock_timeout = '3s';

DO $guard$
DECLARE
  n   integer;
  def text;
BEGIN
  SELECT pg_get_constraintdef(c.oid) INTO def
    FROM pg_constraint c
   WHERE c.conrelid = to_regclass('public.admin_audit_log')
     AND c.conname = 'admin_audit_log_action_check' AND c.contype = 'c' AND c.convalidated;
  IF def IS NULL THEN
    RAISE EXCEPTION 'rollback 024 abortado: constraint admin_audit_log_action_check não encontrada como CHECK válido';
  END IF;

  SELECT count(*) INTO n FROM admin_audit_log WHERE action NOT IN ('block', 'unblock', 'update', 'delete');
  IF n > 0 THEN
    RAISE EXCEPTION 'rollback 024 abortado: % registro(s) de auditoria com ações de suporte/FAQ. Nada foi alterado.', n
      USING HINT = 'O rollback não apaga auditoria. Decida o destino desses registros antes de reverter.';
  END IF;
END
$guard$;

ALTER TABLE admin_audit_log DROP CONSTRAINT admin_audit_log_action_check;
ALTER TABLE admin_audit_log ADD CONSTRAINT admin_audit_log_action_check
  CHECK (action IN ('block', 'unblock', 'update', 'delete'));

COMMIT;
