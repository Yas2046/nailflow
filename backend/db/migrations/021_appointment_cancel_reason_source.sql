-- Fase 1A (pré-agendamento): motivo do cancelamento e origem do agendamento.
-- Aditiva e idempotente. Linhas existentes ficam NULL (origem desconhecida/painel).
--   cancel_reason: 'rejected' (profissional recusou uma solicitação pendente).
--   source:        'public' (página pública) ou 'bot' (WhatsApp). NULL = painel/legado.
ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS cancel_reason VARCHAR(20),
  ADD COLUMN IF NOT EXISTS source VARCHAR(10);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'appointments_source_check'
                 AND conrelid = 'appointments'::regclass) THEN
    ALTER TABLE appointments
      ADD CONSTRAINT appointments_source_check CHECK (source IS NULL OR source IN ('public', 'bot'));
  END IF;
END
$$;
