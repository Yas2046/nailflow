import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { addPhoto, deletePhoto, listMyPhotos } from '../controllers/portfolioController.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

// Envio de foto: por conta (as fotos são pequenas, mas o corpo é maior que o padrão).
const uploadRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 30,
  keyGenerator: (req) => 'pho:' + req.professionalId,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({ error: 'Muitos envios de foto seguidos. Tente novamente em 1 hora.' });
  },
});

router.get('/', listMyPhotos);
router.post('/', uploadRateLimit, addPhoto);
router.delete('/:id', deletePhoto);

export default router;
