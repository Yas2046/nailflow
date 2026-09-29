import { pool } from '../config/db.js';
import { HttpError } from '../middleware/errorHandler.js';

export async function listProfessionals(req, res, next) {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, email, phone_whatsapp, business_name,
              wa_instance_name, created_at, is_admin, blocked_at
       FROM professionals
       ORDER BY created_at ASC`
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
}

// POST /admin/professionals/:id/block
// Preenche blocked_at. Não altera token_version: o bloqueio já derruba a
// sessão em qualquer request (requireAuth/requireAdmin checam blocked_at a
// cada chamada), então não é preciso invalidar o token separadamente.
export async function blockProfessional(req, res, next) {
  try {
    const { id } = req.params;
    if (id === req.professionalId) {
      throw new HttpError(400, 'Você não pode bloquear a própria conta.');
    }
    const { rows } = await pool.query(
      `UPDATE professionals SET blocked_at = now() WHERE id = $1
       RETURNING id, blocked_at`,
      [id]
    );
    if (!rows[0]) throw new HttpError(404, 'Profissional não encontrada.');
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
}

// POST /admin/professionals/:id/unblock
// Limpa blocked_at e sobe token_version (conforme previsto na migration 016)
// para invalidar qualquer token emitido antes do desbloqueio, forçando novo login.
export async function unblockProfessional(req, res, next) {
  try {
    const { id } = req.params;
    const { rows } = await pool.query(
      `UPDATE professionals
         SET blocked_at = NULL, token_version = token_version + 1
       WHERE id = $1
       RETURNING id, blocked_at`,
      [id]
    );
    if (!rows[0]) throw new HttpError(404, 'Profissional não encontrada.');
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
}
