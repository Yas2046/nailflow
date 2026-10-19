-- Financeiro (etapa 2): acrescenta a forma de pagamento "transferencia" a financial_payments.method.
-- MOTIVO: a constraint da 025 (financial_payments_method_check) aceita só pix, dinheiro, cartao_debito, cartao_credito e outra;
-- a etapa 2 também precisa de transferência. A 025 NÃO é alterada: esta migration só AMPLIA a lista (compatível: todo valor
-- aceito antes continua aceito). Aditiva, idempotente e transacional. Rollback: _rollback/026_financeiro_pagamentos_metodo.down.sql
-- (recusa-se a rodar se já houver recebimento por transferência: financial_payments é append-only e o dado não pode ser reescrito).
-- Aplicar como a dona das tabelas (em produção, postgres), DEPOIS da 025. ALTER TABLE não dispara os triggers de linha.

BEGIN;

SET LOCAL lock_timeout = '3s';

DO $pre$
BEGIN
  IF to_regclass('public.financial_payments') IS NULL THEN
    RAISE EXCEPTION 'migration 026: financial_payments não existe (aplique a migration 025 antes)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'financial_payments_method_check' AND conrelid = 'public.financial_payments'::regclass) THEN
    RAISE EXCEPTION 'migration 026: constraint financial_payments_method_check não encontrada (a 025 foi aplicada?)';
  END IF;
END
$pre$;

ALTER TABLE public.financial_payments DROP CONSTRAINT financial_payments_method_check;
ALTER TABLE public.financial_payments ADD CONSTRAINT financial_payments_method_check
  CHECK (method IN ('pix', 'dinheiro', 'cartao_debito', 'cartao_credito', 'transferencia', 'outra'));

DO $verify$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
   WHERE conname = 'financial_payments_method_check' AND conrelid = 'public.financial_payments'::regclass AND convalidated;
  IF v_def IS NULL OR v_def NOT LIKE '%transferencia%' OR v_def NOT LIKE '%cartao_credito%' OR v_def NOT LIKE '%pix%' THEN
    RAISE EXCEPTION 'migration 026: constraint de forma de pagamento diferente do esperado: %', v_def;
  END IF;
END
$verify$;

COMMIT;
