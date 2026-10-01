import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import {
  listProfessionals, blockProfessional, unblockProfessional, updateProfessional,
  getDeleteProfessionalPreview, deleteProfessional,
} from '../controllers/adminController.js';
import { requireAdmin } from '../middleware/auth.js';

const adminRateLimit = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 100,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({
      error: 'Muitas requisições administrativas deste IP. Tente novamente em alguns minutos.',
    });
  },
});

const router = Router();

router.use(requireAdmin);
router.use(adminRateLimit);

router.get('/professionals', listProfessionals);
router.get('/professionals/:id/delete-preview', getDeleteProfessionalPreview);
router.put('/professionals/:id', updateProfessional);
router.post('/professionals/:id/block', blockProfessional);
router.post('/professionals/:id/unblock', unblockProfessional);
router.delete('/professionals/:id', deleteProfessional);

export default router;
