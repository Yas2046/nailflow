-- Migration 004
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS reminder_sent BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_appointments_reminder ON appointments(professional_id, reminder_sent, starts_at);
