-- Personalização da página pública: apresentação curta (bio) e cor da página.
-- Aditiva e idempotente. public_theme é independente do tema do painel
-- (que fica só no localStorage de quem usa o painel). Os valores permitidos
-- espelham os presets de cor do frontend (vinho, verde, azul).
ALTER TABLE professionals
  ADD COLUMN IF NOT EXISTS bio VARCHAR(280),
  ADD COLUMN IF NOT EXISTS public_theme VARCHAR(20) NOT NULL DEFAULT 'vinho';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'professionals_public_theme_check'
      AND conrelid = 'professionals'::regclass
  ) THEN
    ALTER TABLE professionals
      ADD CONSTRAINT professionals_public_theme_check
      CHECK (public_theme IN ('vinho', 'verde', 'azul'));
  END IF;
END;
$$;

COMMENT ON COLUMN professionals.bio
  IS 'Apresentação curta exibida na página pública (máx. 280 caracteres).';
COMMENT ON COLUMN professionals.public_theme
  IS 'Preset de cor da página pública (vinho, verde ou azul). Independente do tema do painel.';
