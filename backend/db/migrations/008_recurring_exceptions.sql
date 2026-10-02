-- Migration 008 — Fechamentos da agenda (data específica e recorrência mensal)
-- Retroativa: reproduz a tabela já existente em produção (criada em 2026-09-24).
-- Idempotente: CREATE TABLE / CREATE INDEX IF NOT EXISTS.
-- O tipo 'date_range' (período) é acrescentado na migration 009.

CREATE TABLE IF NOT EXISTS recurring_exceptions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  professional_id UUID NOT NULL REFERENCES professionals(id) ON DELETE CASCADE,
  exception_type  VARCHAR(20) NOT NULL
                  CONSTRAINT recurring_exceptions_exception_type_check
                  CHECK (exception_type IN ('specific_date', 'weekday_of_month')),
  specific_date   DATE,
  weekday         SMALLINT CHECK (weekday BETWEEN 0 AND 6),
  week_of_month   SMALLINT CHECK (week_of_month BETWEEN -1 AND 5 AND week_of_month <> 0),
  label           VARCHAR(100),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_recurring_exceptions_professional
  ON recurring_exceptions(professional_id);

COMMENT ON TABLE recurring_exceptions
  IS 'Dias em que a agenda da profissional fica fechada. Avaliado em utils/availability.js (isRecurringException).';
COMMENT ON COLUMN recurring_exceptions.week_of_month
  IS 'Ocorrência do dia da semana no mês: 1 a 5, ou -1 para a última.';
