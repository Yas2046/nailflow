-- NailFlow Bot Tables
-- Run once on the production database

CREATE TABLE IF NOT EXISTS conversation_states (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  professional_id  UUID NOT NULL REFERENCES professionals(id) ON DELETE CASCADE,
  phone            VARCHAR(30) NOT NULL,
  mode             VARCHAR(20) NOT NULL DEFAULT 'BOT_ATIVO',
  bot_state        VARCHAR(50) DEFAULT 'INICIO',
  context          JSONB DEFAULT '{}',
  last_message_at  TIMESTAMPTZ DEFAULT now(),
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now(),
  UNIQUE(professional_id, phone)
);

CREATE TABLE IF NOT EXISTS message_history (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  professional_id  UUID NOT NULL REFERENCES professionals(id) ON DELETE CASCADE,
  phone            VARCHAR(30) NOT NULL,
  wa_message_id    VARCHAR(100),
  direction        VARCHAR(10) NOT NULL CHECK (direction IN ('in','out')),
  sender           VARCHAR(20) NOT NULL CHECK (sender IN ('client','bot','professional')),
  content          TEXT NOT NULL,
  message_type     VARCHAR(30) DEFAULT 'text',
  created_at       TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS message_history_dedup_idx
  ON message_history(professional_id, wa_message_id)
  WHERE wa_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS message_history_phone_idx
  ON message_history(professional_id, phone, created_at DESC);

CREATE INDEX IF NOT EXISTS conversation_states_phone_idx
  ON conversation_states(professional_id, phone);
