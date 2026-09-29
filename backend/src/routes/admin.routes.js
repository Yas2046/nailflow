import { Router } from 'express';
import {
  listProfessionals, blockProfessional, unblockProfessional, updateProfessional,
  getDeleteProfessionalPreview, deleteProfessional,
} from '../controllers/adminController.js';
import { requireAdmin } from '../middleware/auth.js';

const router = Router();

router.use(requireAdmin);

router.get('/professionals', listProfessionals);
router.get('/professionals/:id/delete-preview', getDeleteProfessionalPreview);
router.put('/professionals/:id', updateProfessional);
router.post('/professionals/:id/block', blockProfessional);
router.post('/professionals/:id/unblock', unblockProfessional);
router.delete('/professionals/:id', deleteProfessional);

export default router;
