-- Migration 003: tornar phone_whatsapp opcional (nullable)
-- Profissionais recém-cadastradas podem preencher o número WhatsApp
-- depois, na página de Perfil/Configurações.
ALTER TABLE professionals ALTER COLUMN phone_whatsapp DROP NOT NULL;
