import { Router } from 'express';
import {
  listAppointments,
  createAppointment,
  updateAppointment,
  cancelAppointment,
} from '../controllers/appointmentsController.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.use(requireAuth);

router.get('/', listAppointments);
router.post('/', createAppointment);
router.put('/:id', updateAppointment);
router.delete('/:id', cancelAppointment);

export default router;
