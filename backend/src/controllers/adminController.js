import { z } from 'zod';
import { pool } from '../config/db.js';
import { HttpError } from '../middleware/errorHandler.js';
import { updateMeSchema } from './authController.js';

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

// PUT /admin/professionals/:id
// Reaproveita o mesmo schema/regras de PUT /auth/me (updateMeSchema): mesmos
// campos (name, business_name, phone_whatsapp, email, avatar_b64), mesma
// checagem de e-mail único. Não permite editar slug, wa_instance_name,
// is_admin, blocked_at, token_version ou senha -- de propósito: cada um
// desses tem um fluxo próprio (wa_instance_name depende da Evolution API,
// blocked_at/token_version já têm o endpoint de bloqueio, slug é a URL
// pública e não deve mudar, e não existe troca de senha no sistema ainda).
export async function updateProfessional(req, res, next) {
  try {
    const { id } = req.params;
    if (id === req.professionalId) {
      throw new HttpError(400, 'Use a tela de perfil para editar a própria conta.');
    }

    const { name, business_name, phone_whatsapp, email, avatar_b64 } = updateMeSchema.parse(req.body);
    const hasAvatar = Object.prototype.hasOwnProperty.call(req.body, 'avatar_b64');

    const { rows: conflict } = await pool.query(
      'SELECT id FROM professionals WHERE email = $1 AND id != $2',
      [email, id]
    );
    if (conflict.length > 0) throw new HttpError(409, 'Este e-mail já está em uso por outra conta.');

    let rows;
    if (hasAvatar) {
      ({ rows } = await pool.query(
        `UPDATE professionals
           SET name = $1, business_name = $2, phone_whatsapp = $3, email = $4, avatar_b64 = $5
         WHERE id = $6
         RETURNING id, name, email, business_name, phone_whatsapp, wa_instance_name, created_at, is_admin, blocked_at`,
        [name, business_name, phone_whatsapp, email, avatar_b64 ?? null, id]
      ));
    } else {
      ({ rows } = await pool.query(
        `UPDATE professionals
           SET name = $1, business_name = $2, phone_whatsapp = $3, email = $4
         WHERE id = $5
         RETURNING id, name, email, business_name, phone_whatsapp, wa_instance_name, created_at, is_admin, blocked_at`,
        [name, business_name, phone_whatsapp, email, id]
      ));
    }

    if (!rows[0]) throw new HttpError(404, 'Profissional não encontrada.');
    res.json(rows[0]);
  } catch (err) {
    if (err instanceof z.ZodError)
      return next(new HttpError(400, err.errors[0]?.message ?? 'Dados inválidos.'));
    next(err);
  }
}
