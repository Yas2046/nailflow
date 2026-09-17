import { Router } from 'express';
import { requireBotAuth } from '../middleware/botAuth.js';
import {
  processMessage,
  recordSentMessage,
  getConversation,
  setConversation,
  getAbandonedConversations,
  markAbandonmentNotified,
  getAppointmentsTomorrow,
  markReminderSent,
} from '../controllers/botController.js';

const router = Router();

router.use(requireBotAuth);

router.post('/process', processMessage);
router.post('/record-sent', recordSentMessage);
router.get('/conversation/:phone', getConversation);
router.post('/conversation/:phone', setConversation);

// Cron helpers (chamados pelo n8n)
router.get('/abandoned-conversations', getAbandonedConversations);
router.post('/mark-abandonment-notified', markAbandonmentNotified);
router.get('/appointments-tomorrow', getAppointmentsTomorrow);
router.post('/mark-reminder-sent', markReminderSent);

export default router;
