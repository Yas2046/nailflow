-- Rollback da migration 027: remove os DOIS gatilhos e suas funções. Não toca em dados nem na 025/026. Idempotente.
-- Depois disso o teto de recebimento e o piso do valor voltam a ser garantidos só pela API (etapas 2 e 3).
BEGIN;
SET LOCAL lock_timeout = '3s';
DROP TRIGGER IF EXISTS trg_financial_payments_cap ON public.financial_payments;
DROP TRIGGER IF EXISTS trg_appointments_fin_value_floor ON public.appointments;
DROP FUNCTION IF EXISTS public.fin_payments_cap_guard();
DROP FUNCTION IF EXISTS public.fin_appointments_value_floor();
COMMIT;
