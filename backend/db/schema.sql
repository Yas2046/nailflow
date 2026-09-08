-- =========================================================
-- NailFlow — Schema PostgreSQL
-- =========================================================
-- Requer a extensão btree_gist para a EXCLUDE constraint
-- que impede sobreposição de agendamentos.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- =========================================================
-- PROFESSIONALS
-- Login único do sistema nesta v1 (uma profissional por conta).
-- =========================================================
CREATE TABLE professionals (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            VARCHAR(120)  NOT NULL,
  email           VARCHAR(160)  NOT NULL UNIQUE,
  password_hash   TEXT          NOT NULL,
  phone_whatsapp  VARCHAR(20)   NOT NULL, -- usado no botão "Falar pelo WhatsApp"
  business_name   VARCHAR(120)  DEFAULT 'NailFlow',
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- =========================================================
-- CLIENTS
-- Sem senha/login — cadastradas pela profissional.
-- =========================================================
CREATE TABLE clients (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  professional_id   UUID NOT NULL REFERENCES professionals(id) ON DELETE CASCADE,
  name              VARCHAR(120) NOT NULL,
  phone             VARCHAR(20)  NOT NULL,
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (professional_id, phone)
);
CREATE INDEX idx_clients_professional ON clients(professional_id);

-- =========================================================
-- SERVICES
-- =========================================================
CREATE TABLE services (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  professional_id  UUID NOT NULL REFERENCES professionals(id) ON DELETE CASCADE,
  name             VARCHAR(120) NOT NULL,
  description      TEXT,
  price_cents      INTEGER NOT NULL CHECK (price_cents >= 0),
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes > 0),
  active           BOOLEAN NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_services_professional ON services(professional_id);

-- =========================================================
-- WEEKLY_AVAILABILITY
-- Um registro por dia da semana (0=domingo ... 6=sábado).
-- is_working = false representa folga fixa (ex.: domingo).
-- =========================================================
CREATE TABLE weekly_availability (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  professional_id   UUID NOT NULL REFERENCES professionals(id) ON DELETE CASCADE,
  weekday           SMALLINT NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  is_working        BOOLEAN NOT NULL DEFAULT true,
  start_time        TIME,
  end_time          TIME,
  break_start       TIME, -- intervalo de almoço (opcional)
  break_end         TIME,
  UNIQUE (professional_id, weekday),
  CHECK (
    is_working = false
    OR (start_time IS NOT NULL AND end_time IS NOT NULL AND start_time < end_time)
  )
);

-- =========================================================
-- BLOCKED_TIMES
-- Bloqueios pontuais: folga de um dia, férias (intervalo),
-- ou horário específico bloqueado manualmente.
-- =========================================================
CREATE TABLE blocked_times (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  professional_id  UUID NOT NULL REFERENCES professionals(id) ON DELETE CASCADE,
  starts_at        TIMESTAMPTZ NOT NULL,
  ends_at          TIMESTAMPTZ NOT NULL,
  reason           VARCHAR(160),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);
CREATE INDEX idx_blocked_times_professional ON blocked_times(professional_id, starts_at, ends_at);

-- =========================================================
-- APPOINTMENTS
-- period é uma coluna gerada (tsrange) usada só para a
-- EXCLUDE constraint anti-sobreposição.
-- =========================================================
CREATE TABLE appointments (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  professional_id  UUID NOT NULL REFERENCES professionals(id) ON DELETE CASCADE,
  client_id        UUID NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  service_id       UUID NOT NULL REFERENCES services(id) ON DELETE RESTRICT,
  starts_at        TIMESTAMPTZ NOT NULL,
  ends_at          TIMESTAMPTZ NOT NULL,
  status           VARCHAR(20) NOT NULL DEFAULT 'pendente'
                     CHECK (status IN ('pendente','confirmado','cancelado','concluido','nao_compareceu')),
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  -- Impede dois agendamentos sobrepostos para a mesma profissional,
  -- exceto os que já estão cancelados (liberam o horário).
  EXCLUDE USING gist (
    professional_id WITH =,
    tstzrange(starts_at, ends_at) WITH &&
  ) WHERE (status <> 'cancelado')
);
CREATE INDEX idx_appointments_professional_date ON appointments(professional_id, starts_at);
CREATE INDEX idx_appointments_client ON appointments(client_id);

-- =========================================================
-- Trigger genérico para updated_at
-- =========================================================
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_professionals_updated BEFORE UPDATE ON professionals
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_clients_updated BEFORE UPDATE ON clients
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_services_updated BEFORE UPDATE ON services
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_appointments_updated BEFORE UPDATE ON appointments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
