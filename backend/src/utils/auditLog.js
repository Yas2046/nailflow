import { pool } from '../config/db.js';

// Registra uma ação administrativa já CONCLUÍDA com sucesso (ver migration
// 019 -- admin_audit_log). actor_email e target_business_name ficam
// denormalizados de propósito: sobrevivem mesmo que a conta do ator ou do
// alvo sejam excluídas depois. Nunca chamar para tentativas ou falhas --
// nesta primeira versão o log só cobre sucesso.
export async function logAdminAction({ actorId, actorEmail, action, targetId, targetBusinessName }) {
  await pool.query(
    `INSERT INTO admin_audit_log (actor_id, actor_email, action, target_id, target_business_name)
     VALUES ($1, $2, $3, $4, $5)`,
    [actorId, actorEmail, action, targetId, targetBusinessName]
  );
}
