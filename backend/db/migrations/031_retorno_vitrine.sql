-- Retorno de clientes e vitrine da página pública. Só ACRESCENTA colunas e uma tabela; nada existente muda de significado.
--  services.return_interval_days : intervalo (dias) em que a profissional espera a cliente voltar para este serviço (opcional; vazio = padrão do sistema)
--  clients.contact_opt_out       : "não enviar mensagens de retorno" (preferência de contato da cliente, respeitada nas sugestões)
--  clients.return_snoozed_until  : não sugerir retorno desta cliente até esta data (evita sugestão repetida depois de contatar)
--  professionals.instagram       : usuário do Instagram mostrado como link na página pública (sem @)
--  portfolio_photos              : até 6 fotos de trabalhos por profissional (bytea, JPEG/PNG/WebP, até 300 KB cada; o limite de 6 é da aplicação)
-- Idempotente e transacional. Rollback: _rollback/031_retorno_vitrine.down.sql (apaga as fotos e as preferências gravadas nas colunas novas).
BEGIN;
SET LOCAL lock_timeout = '3s';

ALTER TABLE services      ADD COLUMN IF NOT EXISTS return_interval_days integer;
ALTER TABLE clients       ADD COLUMN IF NOT EXISTS contact_opt_out boolean NOT NULL DEFAULT false;
ALTER TABLE clients       ADD COLUMN IF NOT EXISTS return_snoozed_until timestamptz;
ALTER TABLE professionals ADD COLUMN IF NOT EXISTS instagram varchar(30);

DO $c$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'services_return_interval_check') THEN
    ALTER TABLE services ADD CONSTRAINT services_return_interval_check CHECK (return_interval_days IS NULL OR return_interval_days BETWEEN 1 AND 365);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'professionals_instagram_check') THEN
    ALTER TABLE professionals ADD CONSTRAINT professionals_instagram_check CHECK (instagram IS NULL OR instagram ~ '^[A-Za-z0-9._]{1,30}$');
  END IF;
END
$c$;

CREATE TABLE IF NOT EXISTS portfolio_photos (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  professional_id uuid        NOT NULL REFERENCES professionals(id) ON DELETE CASCADE,
  mime            varchar(12) NOT NULL CHECK (mime IN ('image/jpeg', 'image/png', 'image/webp')),
  data            bytea       NOT NULL CHECK (octet_length(data) BETWEEN 1 AND 300000),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS portfolio_photos_professional_idx ON portfolio_photos (professional_id, created_at);

DO $verify$
BEGIN
  IF to_regclass('public.portfolio_photos') IS NULL
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'services' AND column_name = 'return_interval_days')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'clients' AND column_name = 'contact_opt_out')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'clients' AND column_name = 'return_snoozed_until')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'professionals' AND column_name = 'instagram') THEN
    RAISE EXCEPTION 'migration 031: estrutura incompleta após a aplicação';
  END IF;
END
$verify$;

COMMIT;
