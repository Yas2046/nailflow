-- Rollback da migration 028. NÃO apaga movimentação financeira: se existir qualquer pagamento de despesa, ou histórico de pagamento de
-- despesa, ABORTA sem alterar nada (expense_payments e financial_audit_log são append-only; o dado só sai pela exclusão da conta).
-- O caminho seguro depois de uso real é deixar a 028 aplicada (ou exportar com pg_dump -t antes e só então decidir).
-- Sem uso: remove tabela, gatilhos, funções e a UNIQUE de expenses, e devolve as listas de financial_audit_log às da 025.
-- Pare a API antes. Idempotente. O rollback da 025 também EXIGE que a 028 já tenha sido revertida.
BEGIN;

SET LOCAL lock_timeout = '3s';

-- A migration 029 usa expense_payments nos totais do caixa: reverta a 029 antes.
DO $g029$
BEGIN
  IF to_regclass('public.cash_closing_entries') IS NOT NULL THEN
    RAISE EXCEPTION 'rollback 028 abortado: a migration 029 (cash_closing_entries) ainda esta aplicada; rode antes _rollback/029_financeiro_fechamento_caixa.down.sql. Nada foi alterado.';
  END IF;
END
$g029$;

DO $down$
DECLARE
  v_pay   bigint := 0;
  v_audit bigint := 0;
BEGIN
  IF to_regclass('public.expense_payments') IS NOT NULL THEN
    LOCK TABLE public.expense_payments IN ACCESS EXCLUSIVE MODE;
    SELECT count(*) INTO v_pay FROM public.expense_payments;
  END IF;
  IF to_regclass('public.financial_audit_log') IS NOT NULL THEN
    LOCK TABLE public.financial_audit_log IN ACCESS EXCLUSIVE MODE;
    SELECT count(*) INTO v_audit FROM public.financial_audit_log WHERE entity_type = 'expense_payment' OR action = 'expense_payment_create';
  END IF;
  IF v_pay > 0 OR v_audit > 0 THEN
    RAISE EXCEPTION 'rollback 028 abortado: há % pagamento(s) de despesa e % registro(s) de histórico de pagamento de despesa (append-only). Nada foi alterado.', v_pay, v_audit;
  END IF;
END
$down$;

DROP TRIGGER IF EXISTS trg_expenses_fin_paid_floor ON public.expenses;
DROP FUNCTION IF EXISTS public.fin_expenses_paid_floor();
DROP TABLE IF EXISTS public.expense_payments;
DROP FUNCTION IF EXISTS public.fin_expense_payments_guard();
DROP FUNCTION IF EXISTS public.fin_expense_payments_sync();
DROP FUNCTION IF EXISTS public.fin_expense_payments_audit();
ALTER TABLE public.expenses DROP CONSTRAINT IF EXISTS expenses_id_professional_id_key;

DO $r$
BEGIN
  IF to_regclass('public.financial_audit_log') IS NOT NULL THEN
    ALTER TABLE public.financial_audit_log DROP CONSTRAINT IF EXISTS financial_audit_log_entity_type_check;
    ALTER TABLE public.financial_audit_log ADD CONSTRAINT financial_audit_log_entity_type_check
      CHECK (entity_type IN ('payment', 'expense', 'appointment', 'cash_closing'));
    ALTER TABLE public.financial_audit_log DROP CONSTRAINT IF EXISTS financial_audit_log_action_check;
    ALTER TABLE public.financial_audit_log ADD CONSTRAINT financial_audit_log_action_check CHECK (action IN (
      'payment_create', 'payment_refund',
      'expense_create', 'expense_update', 'expense_status', 'expense_delete',
      'appointment_checkin', 'appointment_final_price', 'appointment_review',
      'cash_close', 'cash_reopen', 'correction'));
  END IF;
END
$r$;

COMMIT;
