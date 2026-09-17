import jwt from 'jsonwebtoken';

/**
 * Exige autenticação válida para acessar rotas privadas.
 * Define req.professionalId — usado por todos os controllers para filtrar
 * dados e garantir que uma profissional nunca veja dados de outra.
 *
 * Aceita dois mecanismos, verificados nesta ordem:
 *   1. Header X-Api-Key — integrações de serviço (n8n). Valida contra
 *      N8N_API_KEY e define professionalId via N8N_PROFESSIONAL_ID.
 *   2. JWT — cookie httpOnly "nailflow_token" ou Authorization: Bearer.
 */
export function requireAuth(req, res, next) {
  // 1. API Key para integrações de serviço (ex.: n8n)
  const apiKey = req.headers['x-api-key'];
  if (apiKey) {
    if (apiKey !== process.env.N8N_API_KEY || !process.env.N8N_PROFESSIONAL_ID) {
      return res.status(401).json({ error: 'API Key inválida.' });
    }
    req.professionalId = process.env.N8N_PROFESSIONAL_ID;
    return next();
  }

  // 2. JWT via cookie httpOnly ou Authorization: Bearer
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
