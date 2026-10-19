-- Rollback da migration 026: volta financial_payments_method_check à lista da 025 (sem "transferencia").
-- NÃO reescreve nem apaga movimentação: financial_payments é append-only. Se já existir recebimento ou estorno por
-- transferência, ABORTA sem alterar nada (a constraint nova continua valendo). O caminho seguro então é deixar a 026 aplicada.
-- Pare a API antes (a rota de pagamentos aceita "transferencia" enquanto a 026 está aplicada). Idempotente.

BEGIN;

SET LOCAL lock_timeout = '3s';

DO $down$
DECLARE
  v_n bigint;
BEGIN
  IF to_regclass('public.financial_payments') IS NULL THEN
    RAISE NOTICE 'rollback 026: financial_payments não existe; nada a fazer';
    RETURN;
  END IF;
  LOCK TABLE public.financial_payments IN ACCESS EXCLUSIVE MODE;   -- nada é gravado entre a contagem e a troca da constraint
  SELECT count(*) INTO v_n FROM public.financial_payments WHERE method = 'transferencia';
  IF v_n > 0 THEN
    RAISE EXCEPTION 'rollback 026 abortado: % movimentação(ões) usam a forma "transferencia" e não podem ser reescritas (append-only). Nada foi alterado.', v_n;
  END IF;
  ALTER TABLE public.financial_payments DROP CONSTRAINT IF EXISTS financial_payments_method_check;
  ALTER TABLE public.financial_payments ADD CONSTRAINT financial_payments_method_check
    CHECK (method IN ('pix', 'dinheiro', 'cartao_debito', 'cartao_credito', 'outra'));
END
$down$;

COMMIT;
