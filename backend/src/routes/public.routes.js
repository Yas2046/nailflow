import { Router } from 'express';
import {
  getPublicInfo,
  getPublicAvailability,
  getPublicInfoBySlug,
  getPublicAvailabilityBySlug,
} from '../controllers/publicController.js';

const router = Router();

// Rotas por slug — /public/:slug/info e /public/:slug/availability
// Devem vir antes das rotas genéricas para não conflitar.
router.get('/:slug/info', getPublicInfoBySlug);
router.get('/:slug/availability', getPublicAvailabilityBySlug);

// Rotas legadas (sem slug) — mantidas para compatibilidade com /agenda-publica
router.get('/info', getPublicInfo);
router.get('/availability', getPublicAvailability);

export default router;
