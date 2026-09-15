import { pool } from '../config/db.js';

export async function requireBotAuth(req, res, next) {
  const bearer = req.headers.authorization?.startsWith('Bearer ')
    ? req.headers.authorization.slice(7)
    : null;

  const key = process.env.BOT_API_KEY;
  if (!key || !bearer || bearer !== key) {
    return res.status(401).json({ error: 'Bot não autorizado.' });
  }

  try {
    const { rows } = await pool.query(
      'SELECT id FROM professionals ORDER BY created_at ASC LIMIT 1'
    );
    if (!rows[0]) return res.status(404).json({ error: 'Nenhuma profissional cadastrada.' });
    req.professionalId = rows[0].id;
    next();
  } catch (err) {
    next(err);
  }
}
