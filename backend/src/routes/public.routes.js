import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import {
  getPublicInfoBySlug,
  getPublicAvailabilityBySlug,
  getPublicServicesBySlug,
  validatePublicClientPhone,
  createPublicAppointment,
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
router.get('/:slug/services', publicRateLimit, getPublicServicesBySlug);

// Criação de agendamento pela página pública: dois limites dedicados, mais
// restritos que os de leitura (é uma rota de escrita). O limite por
// telefone+slug só pode aplicar depois de validatePublicClientPhone, que
// normaliza o número usado como parte da chave do limiter.
const publicAppointmentIpRateLimit = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({ error: 'Muitas tentativas. Tente novamente em alguns minutos.' });
  },
});

const publicAppointmentPhoneRateLimit = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 3,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => `${req.params.slug}:${req.normalizedClientPhone}`,
  handler: (_req, res) => {
    res.status(429).json({ error: 'Muitas tentativas de agendamento para este número. Tente novamente em alguns minutos.' });
  },
});

router.post(
  '/:slug/appointments',
  publicAppointmentIpRateLimit,
  validatePublicClientPhone,
  publicAppointmentPhoneRateLimit,
  createPublicAppointment
);

export default router;
