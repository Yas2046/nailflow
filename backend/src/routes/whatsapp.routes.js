import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { getWhatsAppStatus } from '../controllers/whatsappController.js';

const router = Router();

router.use(requireAuth);

router.get('/status', getWhatsAppStatus);

export default router;
