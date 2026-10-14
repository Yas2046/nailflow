import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import {
  getSummary, listTickets, getTicket, sendMessage, changeStatus, changePriority, markRead,
  getFaq, createArticle, updateArticle, publishArticle, unpublishArticle, reorderFaq,
} from '../controllers/adminSupportController.js';
import { requireAdmin } from '../middleware/auth.js';
import { requireSupportEnabled } from '../middleware/supportGuards.js';
import { UUID_RE } from '../utils/appointmentStatus.js';

// Limitadores PRÓPRIOS, por conta de administradora (requireAdmin roda antes e define professionalId). Esta rota é
// montada ANTES de /admin no server.js justamente para não consumir o limite de 100 req/5 min por IP do /admin:
// o polling da caixa de entrada (60 s) e da conversa (20 s) esgotaria esse limite.
const readLimit = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 300,
  keyGenerator: (req) => `asup_r:${req.professionalId}`,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({ error: 'Muitas requisições ao suporte. Tente novamente em alguns minutos.' });
  },
});

const writeLimit = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 60,
  keyGenerator: (req) => `asup_w:${req.professionalId}`,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({ error: 'Muitas alterações no suporte em pouco tempo. Tente novamente em alguns minutos.' });
  },
});

const router = Router();

// Interruptor desligado => 404 antes de qualquer autenticação. Depois, só administradora (is_admin no banco).
router.use(requireSupportEnabled);
router.use(requireAdmin);
router.use(readLimit);

router.param('id', (_req, res, next, id) => {
  if (!UUID_RE.test(id)) return res.status(400).json({ error: 'Identificador inválido.' });
  next();
});

router.get('/summary', getSummary);
router.get('/tickets', listTickets);
router.get('/tickets/:id', getTicket);
router.post('/tickets/:id/messages', writeLimit, sendMessage);
router.post('/tickets/:id/status', writeLimit, changeStatus);
router.put('/tickets/:id/priority', writeLimit, changePriority);
router.post('/tickets/:id/read', markRead);

router.get('/faq', getFaq);
router.post('/faq/articles', writeLimit, createArticle);
router.put('/faq/articles/:id', writeLimit, updateArticle);
router.post('/faq/articles/:id/publish', writeLimit, publishArticle);
router.post('/faq/articles/:id/unpublish', writeLimit, unpublishArticle);
router.put('/faq/reorder', writeLimit, reorderFaq);
// Sem DELETE de artigo nem de mensagem: despublicar cobre a necessidade e preserva a história.

export default router;
