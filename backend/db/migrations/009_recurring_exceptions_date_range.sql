-- Migration 009 — Bloqueio de período em recurring_exceptions
-- Retroativa: reproduz o estado atual de produção (aplicado em 2026-09-24).
-- Idempotente: ADD COLUMN IF NOT EXISTS; a restrição só é recriada se ainda
-- não aceitar 'date_range' (em produção, nada muda).

ALTER TABLE recurring_exceptions
  ADD COLUMN IF NOT EXISTS date_from DATE,
  ADD COLUMN IF NOT EXISTS date_to   DATE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'recurring_exceptions'::regclass
      AND conname  = 'recurring_exceptions_exception_type_check'
      AND pg_get_constraintdef(oid) LIKE '%date_range%'
  ) THEN
    ALTER TABLE recurring_exceptions
      DROP CONSTRAINT IF EXISTS recurring_exceptions_exception_type_check;
    ALTER TABLE recurring_exceptions
      ADD CONSTRAINT recurring_exceptions_exception_type_check
      CHECK (exception_type IN ('specific_date', 'weekday_of_month', 'date_range'));
  END IF;
END;
$$;

COMMENT ON COLUMN recurring_exceptions.date_from
  IS 'Início do período fechado (inclusive). Usado quando exception_type = date_range.';
COMMENT ON COLUMN recurring_exceptions.date_to
  IS 'Fim do período fechado (inclusive). A API garante date_to >= date_from.';
