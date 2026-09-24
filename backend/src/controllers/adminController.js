import { pool } from '../config/db.js';

export async function listProfessionals(req, res, next) {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, email, phone_whatsapp, business_name,
              wa_instance_name, created_at, is_admin
       FROM professionals
       ORDER BY created_at ASC`
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
}
