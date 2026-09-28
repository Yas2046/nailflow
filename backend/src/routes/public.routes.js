import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import {
  getPublicInfo,
  getPublicAvailability,
  getPublicInfoBySlug,
  getPublicAvailabilityBySlug,
} from '../controllers/publicController.js';

// Rotas sem autenticação (página pública de agendamento): limite por IP para
// impedir scraping/flood, generoso o bastante para uso normal (carregar a
// página, trocar de data algumas vezes).
const publicRateLimit = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({ error: 'Muitas requisições. Tente novamente em alguns minutos.' });
  },
});

const router = Router();

// Rotas por slug — /public/:slug/info e /public/:slug/availability
// Devem vir antes das rotas genéricas para não conflitar.
router.get('/:slug/info', publicRateLimit, getPublicInfoBySlug);
router.get('/:slug/availability', publicRateLimit, getPublicAvailabilityBySlug);

// Rotas legadas (sem slug) — mantidas para compatibilidade com /agenda-publica
router.get('/info', getPublicInfo);
router.get('/availability', getPublicAvailability);

export default router;
