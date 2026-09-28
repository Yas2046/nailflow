-- Bloqueio de conta e revogação de sessão. blocked_at preenchido impede login
-- e derruba as sessões correntes; token_version invalida tokens já emitidos
-- (sobe no desbloqueio e, no futuro, na troca de senha) sem afetar quem já
-- está com uma sessão válida no momento. Idempotente.
ALTER TABLE professionals
  ADD COLUMN IF NOT EXISTS blocked_at    timestamptz NULL,
  ADD COLUMN IF NOT EXISTS token_version integer     NOT NULL DEFAULT 1;
