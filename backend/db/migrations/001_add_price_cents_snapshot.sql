-- Migration F-09: adiciona price_cents_snapshot à tabela appointments.
-- Para bancos criados ANTES desta mudança, rode este script UMA VEZ:
--
--   $env:PGPASSWORD="<sua_senha>"; psql -h localhost -U postgres -d nailflow -f db/migrations/001_add_price_cents_snapshot.sql
--
-- O script é idempotente: pode ser re-executado sem efeito colateral.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'appointments' AND column_name = 'price_cents_snapshot'
  ) THEN
    -- Adiciona sem NOT NULL primeiro para poder popular linhas existentes.
    ALTER TABLE appointments ADD COLUMN price_cents_snapshot INTEGER;

    -- Popula com o preço atual do serviço (melhor estimativa para dados históricos).
    UPDATE appointments a
    SET price_cents_snapshot = s.price_cents
    FROM services s
    WHERE s.id = a.service_id;

    -- Agora aplica a restrição NOT NULL e o CHECK.
    ALTER TABLE appointments
      ALTER COLUMN price_cents_snapshot SET NOT NULL,
      ADD CONSTRAINT appointments_price_cents_snapshot_check CHECK (price_cents_snapshot >= 0);
  END IF;
END;
$$;
