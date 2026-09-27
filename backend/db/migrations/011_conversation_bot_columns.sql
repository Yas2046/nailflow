-- Colunas do bot adicionadas manualmente em produção entre 11 e 17/09. Idempotente.
ALTER TABLE conversation_states ADD COLUMN IF NOT EXISTS bot_state varchar(50) DEFAULT 'INICIO';
ALTER TABLE conversation_states ADD COLUMN IF NOT EXISTS context jsonb DEFAULT '{}'::jsonb;
ALTER TABLE conversation_states ADD COLUMN IF NOT EXISTS last_message_at timestamptz DEFAULT now();

ALTER TABLE message_history ADD COLUMN IF NOT EXISTS sender varchar(20) NOT NULL DEFAULT 'client';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'message_history_sender_check'
                 AND conrelid = 'message_history'::regclass) THEN
    ALTER TABLE message_history ADD CONSTRAINT message_history_sender_check
      CHECK (sender IN ('client', 'bot', 'professional'));
  END IF;
END $$;
