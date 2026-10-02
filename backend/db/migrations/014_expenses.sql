-- Gastos da profissional (veio da V1 sem migration). Idempotente.
-- Depende de set_updated_at(), criada em db/schema.sql (não redefinida aqui para não alterar a função existente).

CREATE TABLE IF NOT EXISTS expenses (
  id              uuid         NOT NULL DEFAULT gen_random_uuid(),
  professional_id uuid         NOT NULL,
  description     varchar(200) NOT NULL,
  category        varchar(80)  NOT NULL DEFAULT 'Outros',
  amount_cents    integer      NOT NULL,
  expense_date    date         NOT NULL,
  notes           text,
  created_at      timestamptz  NOT NULL DEFAULT now(),
  updated_at      timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT expenses_pkey PRIMARY KEY (id),
  CONSTRAINT expenses_professional_id_fkey FOREIGN KEY (professional_id)
    REFERENCES professionals(id) ON DELETE CASCADE,
  CONSTRAINT expenses_amount_cents_check CHECK (amount_cents > 0)
);

CREATE INDEX IF NOT EXISTS idx_expenses_professional ON expenses (professional_id, expense_date DESC);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_expenses_updated'
                 AND tgrelid = 'expenses'::regclass) THEN
    CREATE TRIGGER trg_expenses_updated BEFORE UPDATE ON expenses
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;
