-- Migration 003: suporte a agendamentos recorrentes.
-- Cria tabela recurring_groups e adiciona FK em appointments.
--
-- Executar UMA VEZ no banco de produção:
--   $env:PGPASSWORD="<senha>"; psql -h localhost -U postgres -d nailflow -f backend/db/migrations/003_recurring_appointments.sql
--
-- Idempotente: pode ser re-executado sem efeito colateral.

DO $$
BEGIN

  -- Tabela de grupos de recorrência
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'recurring_groups'
  ) THEN
    CREATE TABLE recurring_groups (
      id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      professional_id UUID        NOT NULL REFERENCES professionals(id) ON DELETE CASCADE,
      frequency       VARCHAR(20) NOT NULL CHECK (frequency IN ('weekly', 'biweekly')),
      ends_on         DATE        NOT NULL,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX recurring_groups_professional_idx ON recurring_groups(professional_id);
  END IF;

  -- Coluna de FK em appointments
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'appointments' AND column_name = 'recurring_group_id'
  ) THEN
    ALTER TABLE appointments
      ADD COLUMN recurring_group_id UUID
      REFERENCES recurring_groups(id) ON DELETE SET NULL;

    CREATE INDEX appointments_recurring_group_idx ON appointments(recurring_group_id)
      WHERE recurring_group_id IS NOT NULL;
  END IF;

END;
$$;

-- Garante que o usuário da aplicação tenha acesso à nova tabela.
-- Idempotente: GRANT em tabela já concedida não gera erro.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nailflow') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE recurring_groups TO nailflow';
  END IF;
END;
$$;
