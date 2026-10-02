-- Foto de perfil da profissional em base64 (veio da V1 sem migration). Idempotente.
ALTER TABLE professionals ADD COLUMN IF NOT EXISTS avatar_b64 text;
