-- Fases 1B/2 (parte backend): modo de confirmação, sinal (estrutura apenas) e
-- reserva com validade. Aditiva e idempotente; os valores padrão replicam o
-- comportamento atual (confirmação manual, sem sinal, sem expiração).
--   professionals.confirmation_mode: 'manual' | 'automatic'
--   professionals.deposit_required / deposit_type / deposit_value / pix_key:
--     sinal por Pix manual ('percentage' = 1..100 (a API aceita 30/50/100),
--     'fixed' = centavos). Tudo por profissional.
--   appointments.deposit_cents: valor do sinal calculado no momento da reserva
--     (não muda se o preço do serviço mudar depois); paid_at: quando a
--     profissional marcou o pagamento como recebido.
--   appointments.expires_at: fim da reserva de pendente/aguardando_pagamento.
--     NULL = sem expiração (agendamentos anteriores e criados pela Agenda).
--   appointments.status passa a aceitar 'aguardando_pagamento'.
ALTER TABLE professionals
  ADD COLUMN IF NOT EXISTS confirmation_mode VARCHAR(10) NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS deposit_required BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS deposit_type VARCHAR(10),
  ADD COLUMN IF NOT EXISTS deposit_value INTEGER,
  ADD COLUMN IF NOT EXISTS pix_key VARCHAR(77);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'professionals_confirmation_mode_check'
                 AND conrelid = 'professionals'::regclass) THEN
    ALTER TABLE professionals
      ADD CONSTRAINT professionals_confirmation_mode_check
      CHECK (confirmation_mode IN ('manual', 'automatic'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'professionals_deposit_check'
                 AND conrelid = 'professionals'::regclass) THEN
    ALTER TABLE professionals
      ADD CONSTRAINT professionals_deposit_check
      CHECK (
        (deposit_type IS NULL AND deposit_value IS NULL)
        OR (deposit_type = 'percentage' AND deposit_value BETWEEN 1 AND 100)
        OR (deposit_type = 'fixed' AND deposit_value > 0)
      );
  END IF;
END
$$;

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deposit_cents INTEGER CHECK (deposit_cents IS NULL OR deposit_cents >= 0),
  ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;

ALTER TABLE appointments DROP CONSTRAINT IF EXISTS appointments_status_check;
ALTER TABLE appointments
  ADD CONSTRAINT appointments_status_check
  CHECK (status IN ('pendente', 'aguardando_pagamento', 'confirmado', 'cancelado', 'concluido', 'nao_compareceu'));

CREATE INDEX IF NOT EXISTS idx_appointments_expires_at
  ON appointments (expires_at)
  WHERE expires_at IS NOT NULL AND status IN ('pendente', 'aguardando_pagamento');
