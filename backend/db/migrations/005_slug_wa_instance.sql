-- Migration 005 — Adicionar slug e wa_instance_name em professionals
-- Idempotente: usa ADD COLUMN IF NOT EXISTS e UPDATE com WHERE
-- Não altera comportamento existente — apenas prepara para multi-tenancy

-- 1. Adicionar coluna slug (identificador URL-safe por profissional)
ALTER TABLE professionals
  ADD COLUMN IF NOT EXISTS slug VARCHAR(80);

-- 2. Adicionar coluna wa_instance_name (nome da instância WhatsApp na Evolution API)
ALTER TABLE professionals
  ADD COLUMN IF NOT EXISTS wa_instance_name VARCHAR(80);

-- 3. Preencher profissional existente com valores concretos
--    slug derivado de business_name: 'Camila Nails Studio' -> 'camila-nails-studio'
--    wa_instance_name: instância ativa no Evolution API
UPDATE professionals
  SET slug            = 'camila-nails-studio',
      wa_instance_name = 'chip2'
  WHERE slug IS NULL;

-- 4. Tornar slug NOT NULL e UNIQUE agora que todas as linhas têm valor
--    (usa constraint nomeada para poder verificar existência antes)
DO $$
BEGIN
  -- NOT NULL
  BEGIN
    ALTER TABLE professionals ALTER COLUMN slug SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  -- UNIQUE constraint
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'professionals_slug_key'
      AND conrelid = 'professionals'::regclass
  ) THEN
    ALTER TABLE professionals ADD CONSTRAINT professionals_slug_key UNIQUE (slug);
  END IF;
END;
$$;

-- 5. Índice para buscas por slug (leitura frequente na rota pública)
CREATE INDEX IF NOT EXISTS idx_professionals_slug
  ON professionals(slug);

-- 6. Índice para buscas por wa_instance_name (usado no whatsappController)
CREATE INDEX IF NOT EXISTS idx_professionals_wa_instance
  ON professionals(wa_instance_name);

COMMENT ON COLUMN professionals.slug
  IS 'Identificador URL-safe único por profissional (ex: camila-nails-studio). Usado na página pública.';

COMMENT ON COLUMN professionals.wa_instance_name
  IS 'Nome da instância no Evolution API correspondente a esta profissional (ex: chip2).';
