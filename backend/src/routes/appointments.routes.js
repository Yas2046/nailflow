import { Router } from 'express';
import {
  listAppointments,
  createAppointment,
  updateAppointment,
  cancelAppointment,
  confirmAppointment,
  rejectAppointment,
  markPaidAppointment,
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
router.post('/:id/confirm', confirmAppointment);
router.post('/:id/reject', rejectAppointment);
router.post('/:id/mark-paid', markPaidAppointment);
router.put('/:id/and-following', updateFromNow);
router.delete('/:id', cancelAppointment);
router.delete('/:id/and-following', cancelFromNow);

export default router;
