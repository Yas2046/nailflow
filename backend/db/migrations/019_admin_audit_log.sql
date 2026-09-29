-- Log de auditoria administrativa: registra ações concluídas com SUCESSO
-- (block/unblock/update/delete) feitas por um admin sobre uma profissional.
-- actor_email e target_business_name ficam denormalizados de propósito --
-- o registro precisa sobreviver mesmo que a conta do ator ou do alvo sejam
-- excluídas depois (por isso não há FK obrigatória para nenhuma das duas).
-- Nesta primeira versão só tentativas bem-sucedidas são registradas.
-- Idempotente.

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id                   uuid         NOT NULL DEFAULT gen_random_uuid(),
  actor_id             uuid         NOT NULL,
  actor_email          varchar(160) NOT NULL,
  action               varchar(20)  NOT NULL,
  target_id            uuid         NOT NULL,
  target_business_name varchar(120) NOT NULL,
  created_at           timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT admin_audit_log_pkey PRIMARY KEY (id),
  CONSTRAINT admin_audit_log_action_check CHECK (action IN ('block', 'unblock', 'update', 'delete'))
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_log_actor ON admin_audit_log (actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_target ON admin_audit_log (target_id, created_at DESC);
