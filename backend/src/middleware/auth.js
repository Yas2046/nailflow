import jwt from 'jsonwebtoken';
import { pool } from '../config/db.js';

function extractToken(req) {
  const bearer = req.headers.authorization?.startsWith('Bearer ')
    ? req.headers.authorization.slice(7)
    : null;
  return req.cookies?.nailflow_token || bearer;
}

/**
 * Exige um JWT válido (via cookie httpOnly "nailflow_token" ou header Authorization).
 * Além da assinatura/expiração, confere no banco que a profissional existe,
 * não está bloqueada (blocked_at) e que o token ainda é o "atual" dela
 * (payload.ver === token_version) -- isso permite revogar sessões (bloqueio,
 * desbloqueio, futura troca de senha) sem esperar o token expirar sozinho.
 * Em caso de sucesso, define req.professionalId -- usado por todos os
 * controllers para filtrar dados e garantir que uma profissional nunca veja
 * dados de outra.
 */
export async function requireAuth(req, res, next) {
  const token = extractToken(req);

  if (!token) {
    return res.status(401).json({ error: 'Não autenticado.' });
  }

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return res.status(401).json({ error: 'Sessão inválida ou expirada.' });
  }

  try {
    const { rows } = await pool.query(
      'SELECT blocked_at, token_version FROM professionals WHERE id = $1',
      [payload.sub]
    );
    const professional = rows[0];
    if (!professional || professional.blocked_at !== null || payload.ver !== professional.token_version) {
      return res.status(401).json({ error: 'Sessão inválida ou expirada.' });
    }
    req.professionalId = payload.sub;
    next();
  } catch (err) {
    next(err);
  }
}

export async function requireAdmin(req, res, next) {
  const token = extractToken(req);

  if (!token) {
    return res.status(401).json({ error: 'Não autenticado.' });
  }

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return res.status(401).json({ error: 'Sessão inválida ou expirada.' });
  }

  try {
    const { rows } = await pool.query(
      'SELECT is_admin, blocked_at, token_version FROM professionals WHERE id = $1',
      [payload.sub]
    );
    const professional = rows[0];
    if (!professional || professional.blocked_at !== null || payload.ver !== professional.token_version) {
      return res.status(401).json({ error: 'Sessão inválida ou expirada.' });
    }
    if (!professional.is_admin) {
      return res.status(403).json({ error: 'Acesso não autorizado.' });
    }
    req.professionalId = payload.sub;
    next();
  } catch (err) {
    next(err);
  }
}
