import { Router } from 'express';
import {
  listServices,
  createService,
  updateService,
  deleteService,
} from '../controllers/servicesController.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.use(requireAuth);

router.get('/', listServices);
router.post('/', createService);
router.put('/:id', updateService);
router.delete('/:id', deleteService);

export default router;
