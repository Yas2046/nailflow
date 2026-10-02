-- Permite manter um serviço ativo/disponível na Agenda sem oferecê-lo pelo
-- WhatsApp ou pela página pública (ex.: pacotes internos de determinadas
-- clientes). DEFAULT true preserva o comportamento atual de todo serviço já
-- cadastrado. Idempotente.
ALTER TABLE services
  ADD COLUMN IF NOT EXISTS available_on_whatsapp BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN services.available_on_whatsapp
  IS 'Se false, o serviço continua ativo/disponível na Agenda, mas não é oferecido pelo bot nem pela página pública. Não afeta o campo active.';
