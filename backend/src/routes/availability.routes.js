import { Router } from 'express';
import {
  getWeeklyAvailability,
  updateWeeklyAvailability,
  listBlockedTimes,
  createBlockedTime,
  deleteBlockedTime,
  getSlots,
  checkAvailability,
} from '../controllers/availabilityController.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.use(requireAuth);

// Expediente semanal
router.get('/', getWeeklyAvailability);
router.put('/', updateWeeklyAvailability);

// Horários livres calculados (uso interno/autenticado, ex.: tela de Agenda)
router.get('/slots', getSlots);

// Verificação de um horário exato (não precisa ser múltiplo de 30 min)
router.get('/check', checkAvailability);

// Bloqueios pontuais (folgas, compromissos)
router.get('/blocked', listBlockedTimes);
router.post('/blocked', createBlockedTime);
router.delete('/blocked/:id', deleteBlockedTime);

export default router;
