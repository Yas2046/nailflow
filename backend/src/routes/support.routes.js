import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import {
  getBootstrap, getFaq, listTickets, getTicket, createTicket, sendMessage, reopenTicket, markRead, updatePreferences,
} from '../controllers/supportController.js';
import { requireAuth } from '../middleware/auth.js';
import { requireSupportEnabled, requireProfessionalAccount } from '../middleware/supportGuards.js';
import { UUID_RE } from '../utils/appointmentStatus.js';

// Por conta (não por IP): requireAuth roda antes e define professionalId.
const createTicketRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  keyGenerator: (req) => `sup_new:${req.professionalId}`,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({ error: 'Muitas solicitações abertas em pouco tempo. Tente novamente em 1 hora.' });
  },
});

// Mensagens e reaberturas dividem o mesmo limite.
const messageRateLimit = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 30,
  keyGenerator: (req) => `sup_msg:${req.professionalId}`,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({ error: 'Muitas mensagens em pouco tempo. Tente novamente em alguns minutos.' });
  },
});

const router = Router();

// Única rota que responde com o interruptor desligado: o frontend precisa saber para esconder o botão.
// Exige sessão; com o interruptor desligado devolve { enabled: false } sem consultar dados de suporte.
router.get('/bootstrap', requireAuth, getBootstrap);

// Daqui em diante: interruptor desligado => 404 antes de qualquer autenticação.
router.use(requireSupportEnabled);
router.use(requireAuth, requireProfessionalAccount);

// Identificador malformado é erro de entrada (400), não falha do banco (500).
router.param('id', (_req, res, next, id) => {
  if (!UUID_RE.test(id)) return res.status(400).json({ error: 'Identificador de solicitação inválido.' });
  next();
});

router.get('/faq', getFaq);
router.get('/tickets', listTickets);
router.post('/tickets', createTicketRateLimit, createTicket);
router.get('/tickets/:id', getTicket);
router.post('/tickets/:id/messages', messageRateLimit, sendMessage);
router.post('/tickets/:id/reopen', messageRateLimit, reopenTicket);
router.post('/tickets/:id/read', markRead);
router.put('/preferences', updatePreferences);

export default router;
