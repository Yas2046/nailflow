import { Router } from 'express';
import { getPublicInfo, getPublicAvailability } from '../controllers/publicController.js';

// Rotas sem autenticação — consumidas pela página pública de visualização
// de horários (PaginaPublica.tsx). Nunca expõem dados de clientes ou
// detalhes de agendamentos, apenas nome do negócio, WhatsApp e slots livres.
const router = Router();

router.get('/info', getPublicInfo);
router.get('/availability', getPublicAvailability);

export default router;
