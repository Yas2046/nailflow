import { Router } from 'express';
import { listProfessionals } from '../controllers/adminController.js';
import { requireAdmin } from '../middleware/auth.js';

const router = Router();

router.use(requireAdmin);

router.get('/professionals', listProfessionals);

export default router;
