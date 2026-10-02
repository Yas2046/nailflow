-- Migration 010 — Marcar a conta de administração da plataforma
-- Retroativa: reproduz a coluna já existente em produção (criada na V2).
-- Idempotente: ADD COLUMN IF NOT EXISTS; contas existentes recebem false.

ALTER TABLE professionals
  ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT false;
