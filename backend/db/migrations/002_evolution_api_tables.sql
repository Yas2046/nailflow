-- 002_evolution_api_tables.sql
-- Tabelas para integracao com Evolution API

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS conversation_states (
    professional_id UUID        NOT NULL REFERENCES professionals(id) ON DELETE CASCADE,
    phone           TEXT        NOT NULL,
    mode            TEXT        NOT NULL DEFAULT 'BOT_ATIVO'
                                CONSTRAINT conversation_states_mode_check
                                CHECK (mode IN ('BOT_ATIVO', 'ATENDIMENTO_HUMANO')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT conversation_states_pkey PRIMARY KEY (professional_id, phone)
);

CREATE INDEX IF NOT EXISTS idx_conv_states_professional
    ON conversation_states (professional_id);

CREATE TABLE IF NOT EXISTS message_history (
    id              BIGSERIAL   PRIMARY KEY,
    professional_id UUID        NOT NULL REFERENCES professionals(id) ON DELETE CASCADE,
    client_id       UUID        REFERENCES clients(id) ON DELETE SET NULL,
    phone           TEXT        NOT NULL,
    wa_message_id   TEXT,
    direction       TEXT        NOT NULL CHECK (direction IN ('inbound', 'outbound')),
    content         TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_message_history_wa_id
    ON message_history (professional_id, wa_message_id)
    WHERE wa_message_id IS NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.triggers
        WHERE trigger_name = 'trg_conversation_states_updated'
          AND event_object_table = 'conversation_states'
          AND trigger_schema = 'public'
    ) THEN
        CREATE TRIGGER trg_conversation_states_updated
            BEFORE UPDATE ON conversation_states
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;
END;
$$;
