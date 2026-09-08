import jwt from 'jsonwebtoken';

/**
 * Exige um JWT válido (via cookie httpOnly "nailflow_token" ou header Authorization).
 * Em caso de sucesso, define req.professionalId — usado por todos os controllers
 * para filtrar dados e garantir que uma profissional nunca veja dados de outra.
 */
export function requireAuth(req, res, next) {
  const bearer = req.headers.authorization?.startsWith('Bearer ')
    ? req.headers.authorization.slice(7)
    : null;
  const token = req.cookies?.nailflow_token || bearer;

  if (!token) {
    return res.status(401).json({ error: 'Não autenticado.' });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.professionalId = payload.sub;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Sessão inválida ou expirada.' });
  }
}
