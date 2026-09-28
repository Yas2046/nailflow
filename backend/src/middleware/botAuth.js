import { createHash, timingSafeEqual } from 'node:crypto';
import { pool } from '../config/db.js';

// Compara o Bearer com BOT_API_KEY em tempo constante. Os hashes igualam o
// tamanho dos buffers, exigência do timingSafeEqual.
export function hasValidBotKey(req) {
  const key = process.env.BOT_API_KEY;
  const auth = req.headers.authorization;
  if (!key || !auth?.startsWith('Bearer ')) return false;
  const digest = (value) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(auth.slice(7)), digest(key));
}

export async function requireBotAuth(req, res, next) {
  if (!hasValidBotKey(req)) {
    return res.status(401).json({ error: 'Bot nao autorizado.' });
  }

  try {
    // GET requests nao enviam body -- aceitar tambem via query string
    const instance = req.body?.instance ?? req.body?.waInstance ?? req.query?.instance ?? null;

    // O campo instance e sempre obrigatorio: identifica a profissional dona
    // da mensagem/agendamento. Nao ha mais fallback para "profissional unica"
    // -- ele silenciosamente atribuia dados a conta errada assim que uma 2a
    // profissional era cadastrada (foi a causa da falha do record-sent).
    if (!instance) {
      return res.status(400).json({ error: 'Campo "instance" obrigatorio.' });
    }

    const { rows } = await pool.query(
      'SELECT id, blocked_at FROM professionals WHERE wa_instance_name = $1',
      [instance]
    );
    if (!rows[0]) {
      return res.status(404).json({ error: `Instancia desconhecida: ${instance}` });
    }
    if (rows[0].blocked_at !== null) {
      return res.status(403).json({ error: 'Profissional bloqueada.' });
    }
    req.professionalId = rows[0].id;
    next();
  } catch (err) {
    next(err);
  }
}