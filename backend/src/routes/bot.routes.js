import { Router } from 'express';
import { requireBotAuth } from '../middleware/botAuth.js';
import {
  processMessage,
  recordSentMessage,
  getConversation,
  setConversation,
} from '../controllers/botController.js';

const router = Router();

router.use(requireBotAuth);

router.post('/process', processMessage);
router.post('/record-sent', recordSentMessage);
router.get('/conversation/:phone', getConversation);
router.post('/conversation/:phone', setConversation);

export default router;
