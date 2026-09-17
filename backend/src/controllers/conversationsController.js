import { pool } from '../config/db.js';
import { z } from 'zod';

const phoneSchema = z.string().min(8).max(20).regex(/^\d+$/);

export async function listConversations(req, res) {
  try {
    const result = await pool.query(
      `SELECT phone, mode, updated_at
       FROM conversation_states
       WHERE professional_id = $1
       ORDER BY updated_at DESC`,
      [req.professionalId]
    );
    res.json(result.rows);
  } catch (err) {
    if (err.code === '42P01') return res.json([]);
    throw err;
  }
}

export async function getConversationMode(req, res) {
  const parsed = phoneSchema.safeParse(req.params.phone);
  if (!parsed.success) return res.status(400).json({ error: 'phone invalido' });
  try {
    const result = await pool.query(
      `SELECT mode FROM conversation_states WHERE professional_id = $1 AND phone = $2`,
      [req.professionalId, parsed.data]
    );
    res.json({ phone: parsed.data, mode: result.rows[0]?.mode ?? 'BOT_ATIVO' });
  } catch (err) {
    if (err.code === '42P01') return res.json({ phone: parsed.data, mode: 'BOT_ATIVO' });
    throw err;
  }
}

export async function assumeConversation(req, res) {
  let phone;
  try {
    const parsed = phoneSchema.safeParse(req.body?.phone);
    if (!parsed.success) return res.status(400).json({ error: 'phone invalido ou ausente' });
    phone = parsed.data;
    const result = await pool.query(
      `INSERT INTO conversation_states (professional_id, phone, mode)
       VALUES ($1, $2, 'ATENDIMENTO_HUMANO')
       ON CONFLICT (professional_id, phone)
       DO UPDATE SET mode = 'ATENDIMENTO_HUMANO', updated_at = NOW()
       RETURNING phone, mode`,
      [req.professionalId, phone]
    );
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '42P01') return res.json({ phone, mode: 'BOT_ATIVO', migrationPending: true });
    throw err;
  }
}

export async function releaseConversation(req, res) {
  let phone;
  try {
    const parsed = phoneSchema.safeParse(req.body?.phone);
    if (!parsed.success) return res.status(400).json({ error: 'phone invalido ou ausente' });
    phone = parsed.data;
    const result = await pool.query(
      `INSERT INTO conversation_states (professional_id, phone, mode)
       VALUES ($1, $2, 'BOT_ATIVO')
       ON CONFLICT (professional_id, phone)
       DO UPDATE SET mode = 'BOT_ATIVO', updated_at = NOW()
       RETURNING phone, mode`,
      [req.professionalId, phone]
    );
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '42P01') return res.json({ phone, mode: 'BOT_ATIVO', migrationPending: true });
    throw err;
  }
}
