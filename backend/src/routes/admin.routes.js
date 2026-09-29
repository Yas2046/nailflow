import { Router } from 'express';
import { listProfessionals, blockProfessional, unblockProfessional } from '../controllers/adminController.js';
import { requireAdmin } from '../middleware/auth.js';

const router = Router();

router.use(requireAdmin);

router.get('/professionals', listProfessionals);
router.post('/professionals/:id/block', blockProfessional);
router.post('/professionals/:id/unblock', unblockProfessional);

export default router;
