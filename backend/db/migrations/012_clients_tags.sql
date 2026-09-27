-- Tags de CRM das clientes (antes aplicada por script externo). Idempotente.
ALTER TABLE clients ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}'::text[];
