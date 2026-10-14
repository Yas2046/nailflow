import { SUPPORT_CENTER_ENABLED } from '../config/support.js';

// Com o interruptor desligado a rota nem existe (404), antes de qualquer autenticação: o comportamento
// não depende de sessão e a existência da área não é revelada.
export function requireSupportEnabled(_req, res, next) {
  if (!SUPPORT_CENTER_ENABLED) return res.status(404).json({ error: 'Recurso não encontrado.' });
  next();
}

// Contas administradoras não abrem solicitações (decisão D9): atendem pelo /admin/support.
// Roda depois de requireAuth, que expõe req.isAdmin a partir do banco (nunca do token nem do corpo).
export function requireProfessionalAccount(req, res, next) {
  if (req.isAdmin) return res.status(403).json({ error: 'Acesso não autorizado.' });
  next();
}
