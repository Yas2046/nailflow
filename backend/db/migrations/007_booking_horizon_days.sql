-- Migration 007 — Antecedência máxima de agendamento por profissional
-- Retroativa: reproduz a coluna já existente em produção (aplicada em 2026-09-24).
-- Idempotente: ADD COLUMN IF NOT EXISTS; contas existentes recebem o padrão de 60 dias.

ALTER TABLE professionals
  ADD COLUMN IF NOT EXISTS booking_horizon_days SMALLINT NOT NULL DEFAULT 60;

COMMENT ON COLUMN professionals.booking_horizon_days
  IS 'Quantos dias à frente a agenda fica aberta (7 a 365; validado na API). Usado pela Agenda, página pública e bot.';
