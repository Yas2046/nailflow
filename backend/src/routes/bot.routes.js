import { Router } from 'express';
import { requireBotAuth, hasValidBotKey } from '../middleware/botAuth.js';
import {
  processMessage,
  recordSentMessage,
  getConversation,
  setConversation,
  getAbandonedConversations,
  markAbandonmentNotified,
  getAppointmentsTomorrow,
  markReminderSent,
  claimReminder,
  reportReminderResult,
  getProfessionalInstances,
} from '../controllers/botController.js';

const router = Router();

// Middleware que valida somente o BOT_API_KEY, sem resolver professionalId.
// Usado por GET /instances que nao pertence a uma profissional especifica.
function requireBotKey(req, res, next) {
  if (!hasValidBotKey(req)) {
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
// Envio seguro de lembretes: reservar antes de enviar e informar o resultado (evita duplicidade; migration 032)
router.post('/reminders/claim', claimReminder);
router.post('/reminders/:attemptId/result', reportReminderResult);

export default router;