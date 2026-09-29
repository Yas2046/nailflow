import { Router } from 'express';
import { listProfessionals, blockProfessional, unblockProfessional, updateProfessional } from '../controllers/adminController.js';
import { requireAdmin } from '../middleware/auth.js';

const router = Router();

router.use(requireAdmin);

router.get('/professionals', listProfessionals);
router.put('/professionals/:id', updateProfessional);
router.post('/professionals/:id/block', blockProfessional);
router.post('/professionals/:id/unblock', unblockProfessional);

export default router;
