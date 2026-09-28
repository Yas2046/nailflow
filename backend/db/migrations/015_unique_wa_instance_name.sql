-- Garante uma instância WhatsApp por profissional: o nome não pode se repetir.
-- NULL continua permitido (profissional sem instância). Idempotente.
CREATE UNIQUE INDEX IF NOT EXISTS professionals_wa_instance_name_key
  ON professionals (wa_instance_name)
  WHERE wa_instance_name IS NOT NULL;
