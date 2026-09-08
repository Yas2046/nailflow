import { Router } from 'express';
import {
  listClients,
  getClientHistory,
  createClient,
  updateClient,
} from '../controllers/clientsController.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.use(requireAuth);

router.get('/', listClients);
router.get('/:id', getClientHistory);
router.post('/', createClient);
router.put('/:id', updateClient);

export default router;
