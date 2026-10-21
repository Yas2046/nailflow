-- Reverte 031_retorno_vitrine.sql. USO MANUAL. ATENÇÃO: apaga as fotos da vitrine e as preferências de contato/intervalos gravados nas colunas novas.
-- Não toca em clientes, serviços, agendamentos nem no Financeiro além de remover as colunas acrescentadas.
BEGIN;
DROP TABLE IF EXISTS portfolio_photos;
ALTER TABLE services      DROP CONSTRAINT IF EXISTS services_return_interval_check;
ALTER TABLE professionals DROP CONSTRAINT IF EXISTS professionals_instagram_check;
ALTER TABLE services      DROP COLUMN IF EXISTS return_interval_days;
ALTER TABLE clients       DROP COLUMN IF EXISTS contact_opt_out;
ALTER TABLE clients       DROP COLUMN IF EXISTS return_snoozed_until;
ALTER TABLE professionals DROP COLUMN IF EXISTS instagram;
COMMIT;
