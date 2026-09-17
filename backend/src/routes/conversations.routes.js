import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import {
  listConversations,
  getConversationMode,
  assumeConversation,
  releaseConversation,
} from '../controllers/conversationsController.js';

const router = Router();

router.use(requireAuth);

router.get('/', listConversations);
router.get('/:phone', getConversationMode);
router.post('/assume', assumeConversation);
router.post('/release', releaseConversation);

export default router;
