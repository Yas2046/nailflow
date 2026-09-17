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
    const instance = req.body?.instance ?? null;

    if (instance) {
      // Caso normal: instância informada → busca profissional pelo wa_instance_name
      const { rows } = await pool.query(
        'SELECT id FROM professionals WHERE wa_instance_name = $1',
        [instance]
      );
      if (!rows[0]) {
        return res.status(404).json({ error: `Instância desconhecida: ${instance}` });
      }
      req.professionalId = rows[0].id;
      return next();
    }

    // Instância ausente: fallback somente se houver exatamente 1 profissional cadastrada.
    // Com múltiplas profissionais a requisição é rejeitada para evitar atribuição arbitrária.
    const { rows } = await pool.query(
      'SELECT id FROM professionals ORDER BY created_at ASC'
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Nenhuma profissional cadastrada.' });
    }
    if (rows.length > 1) {
      return res.status(400).json({
        error: 'Campo "instance" obrigatório quando há múltiplas profissionais cadastradas.',
      });
    }
    req.professionalId = rows[0].id;
    next();
  } catch (err) {
    next(err);
  }
}
