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
  getProfessionalInstances,
} from '../controllers/botController.js';

const router = Router();

// Middleware que valida somente o BOT_API_KEY, sem resolver professionalId.
// Usado por GET /instances que nao pertence a uma profissional especifica.
function requireBotKey(req, res, next) {
  const bearer = req.headers.authorization?.startsWith('Bearer ')
    ? req.headers.authorization.slice(7)
    : null;
  const key = process.env.BOT_API_KEY;
  if (!key || !bearer || bearer !== key) {
    return res.status(401).json({ error: 'Bot nao autorizado.' });
  }
  next();
}

// Listagem de instancias (cron multi-profissional) -- nao precisa de professionalId
router.get('/instances', requireBotKey, getProfessionalInstances);

// Todas as demais rotas exigem autenticacao completa (BOT_API_KEY + resolucao de professionalId)
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