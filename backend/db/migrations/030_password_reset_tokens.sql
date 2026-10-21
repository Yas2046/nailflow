-- Redefinição de senha por link de uso único, emitido pela administração (não há envio de e-mail neste sistema).
-- O token em si NUNCA é gravado: só o SHA-256 dele. O link expira e vale uma vez. Apagar a conta apaga os tokens (ON DELETE CASCADE).
-- issued_by guarda quem emitiu (sem FK, para sobreviver a mudanças da conta da administradora); é a trilha de auditoria desta ação.
-- Idempotente e transacional. Rollback: _rollback/030_password_reset_tokens.down.sql
BEGIN;
SET LOCAL lock_timeout = '3s';

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  professional_id uuid        NOT NULL REFERENCES professionals(id) ON DELETE CASCADE,
  token_hash      char(64)    NOT NULL UNIQUE,
  issued_by       uuid,
  expires_at      timestamptz NOT NULL,
  used_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT password_reset_tokens_hash_hex CHECK (token_hash ~ '^[0-9a-f]{64}$')
);
CREATE INDEX IF NOT EXISTS password_reset_tokens_professional_idx ON password_reset_tokens (professional_id);

DO $verify$
BEGIN
  IF to_regclass('public.password_reset_tokens') IS NULL THEN
    RAISE EXCEPTION 'migration 030: password_reset_tokens não foi criada';
  END IF;
END
$verify$;

COMMIT;
