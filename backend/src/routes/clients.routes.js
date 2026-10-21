import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { importClients } from '../controllers/clientsImportController.js';
import { listReturnSuggestions, updateContactPreferences } from '../controllers/clientsReturnController.js';
import {
  listClients,
  getClientHistory,
  createClient,
  updateClient,
} from '../controllers/clientsController.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.use(requireAuth);

// Importação em lote: por conta (requireAuth já definiu professionalId). A pré-visualização (dryRun) também conta.
const importRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 30,
  keyGenerator: (req) => 'imp:' + req.professionalId,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({ error: 'Muitas importações seguidas. Tente novamente em 1 hora.' });
  },
});

router.get('/', listClients);
router.get('/return-suggestions', listReturnSuggestions);   // antes de /:id
router.get('/:id', getClientHistory);
router.post('/import', importRateLimit, importClients);
router.post('/', createClient);
router.put('/:id/contact-preferences', updateContactPreferences);
router.put('/:id', updateClient);

export default router;
