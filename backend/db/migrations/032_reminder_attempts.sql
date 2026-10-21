-- Registro de tentativas de lembrete e proteção contra envio duplicado (claim atômico). Só ACRESCENTA uma tabela.
-- Um lembrete é identificado por (agendamento, horário do atendimento): remarcar abre um lembrete novo.
--   claimed : o remetente (n8n) reservou o envio; vale até lease_expires_at
--   sent    : o remetente confirmou o envio
--   failed  : o remetente informou que NÃO enviou (código de erro curto, sem texto livre nem dado pessoal); permite nova tentativa (limite na aplicação)
--   expired : a reserva venceu sem resultado -> resultado DESCONHECIDO; não reenvia sozinho (evita duplicar), exige revisão
-- O índice único parcial garante no banco que só existe uma reserva em aberto ou um envio confirmado por lembrete.
-- Idempotente e transacional. Rollback: _rollback/032_reminder_attempts.down.sql
BEGIN;
SET LOCAL lock_timeout = '3s';

CREATE TABLE IF NOT EXISTS reminder_attempts (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  professional_id  uuid        NOT NULL REFERENCES professionals(id) ON DELETE CASCADE,
  appointment_id   uuid        NOT NULL REFERENCES appointments(id)  ON DELETE CASCADE,
  starts_at        timestamptz NOT NULL,
  attempt_no       integer     NOT NULL CHECK (attempt_no >= 1),
  status           varchar(10) NOT NULL CHECK (status IN ('claimed', 'sent', 'failed', 'expired')),
  claimed_at       timestamptz NOT NULL DEFAULT now(),
  lease_expires_at timestamptz NOT NULL,
  finished_at      timestamptz,
  error_code       varchar(40) CHECK (error_code IS NULL OR error_code ~ '^[a-z0-9_]{1,40}$'),
  UNIQUE (appointment_id, starts_at, attempt_no)
);
CREATE UNIQUE INDEX IF NOT EXISTS reminder_attempts_one_active
  ON reminder_attempts (appointment_id, starts_at) WHERE status IN ('claimed', 'sent');
CREATE INDEX IF NOT EXISTS reminder_attempts_professional_idx ON reminder_attempts (professional_id, claimed_at);

DO $verify$
BEGIN
  IF to_regclass('public.reminder_attempts') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'reminder_attempts_one_active') THEN
    RAISE EXCEPTION 'migration 032: estrutura incompleta após a aplicação';
  END IF;
END
$verify$;

COMMIT;
