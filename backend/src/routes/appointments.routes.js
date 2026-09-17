import { Router } from 'express';
import {
  listAppointments,
  createAppointment,
  updateAppointment,
  cancelAppointment,
  createRecurring,
  cancelFromNow,
  updateFromNow,
} from '../controllers/appointmentsController.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.use(requireAuth);

router.get('/', listAppointments);
router.post('/', createAppointment);
router.post('/recurring', createRecurring);
router.put('/:id', updateAppointment);
router.put('/:id/and-following', updateFromNow);
router.delete('/:id', cancelAppointment);
router.delete('/:id/and-following', cancelFromNow);

export default router;
