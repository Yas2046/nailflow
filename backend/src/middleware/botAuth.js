import { pool } from '../config/db.js';

export async function requireBotAuth(req, res, next) {
  const bearer = req.headers.authorization?.startsWith('Bearer ')
    ? req.headers.authorization.slice(7)
    : null;

  const key = process.env.BOT_API_KEY;
  if (!key || !bearer || bearer !== key) {
    return res.status(401).json({ error: 'Bot nao autorizado.' });
  }

  try {
    // GET requests nao enviam body -- aceitar tambem via query string
    const instance = req.body?.instance ?? req.query?.instance ?? null;

    if (instance) {
      const { rows } = await pool.query(
        'SELECT id FROM professionals WHERE wa_instance_name = $1',
        [instance]
      );
      if (!rows[0]) {
        return res.status(404).json({ error: `Instancia desconhecida: ${instance}` });
      }
      req.professionalId = rows[0].id;
      return next();
    }

    const { rows } = await pool.query(
      'SELECT id FROM professionals ORDER BY created_at ASC'
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Nenhuma profissional cadastrada.' });
    }
    if (rows.length > 1) {
      return res.status(400).json({
        error: 'Campo "instance" obrigatorio quando ha multiplas profissionais cadastradas.',
      });
    }
    req.professionalId = rows[0].id;
    next();
  } catch (err) {
    next(err);
  }
}