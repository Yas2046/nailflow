import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import {
  getWhatsAppStatus,
  connectWhatsApp,
  getInstanceConfig,
  setInstanceConfig,
  removeInstanceConfig,
  createEvolutionInstance,
  deleteEvolutionInstance,
} from '../controllers/whatsappController.js';

const router = Router();

router.use(requireAuth);

router.get('/status', getWhatsAppStatus);
router.post('/connect', connectWhatsApp);
router.get('/instance', getInstanceConfig);
router.put('/instance', setInstanceConfig);
router.delete('/instance', removeInstanceConfig);

// Gerenciamento de instância na Evolution
router.post('/evolution-instance', createEvolutionInstance);
router.delete('/evolution-instance', deleteEvolutionInstance);

export default router;
