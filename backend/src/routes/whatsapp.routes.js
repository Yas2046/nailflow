import { Router } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { requireAuth } from '../middleware/auth.js';
import {
  getWhatsAppStatus,
  connectWhatsApp,
  getInstanceConfig,
  createEvolutionInstance,
  deleteEvolutionInstance,
} from '../controllers/whatsappController.js';

// Cada chamada gera um QR novo na Evolution. Um loop de tentativas já causou
// bloqueio temporário do número pelo WhatsApp (18/09) -- limite por profissional
// (não por IP, para não punir outras contas atrás do mesmo IP/rede).
const connectRateLimit = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => req.professionalId ?? ipKeyGenerator(req.ip),
  handler: (_req, res) => {
    res.status(429).json({ error: 'Muitas tentativas de conexão. Aguarde alguns minutos antes de tentar de novo.' });
  },
});

const router = Router();

router.use(requireAuth);

router.get('/status', getWhatsAppStatus);
router.post('/connect', connectRateLimit, connectWhatsApp);
// PUT/DELETE /instance foram removidos: permitiam vincular ou desvincular
// wa_instance_name sem criar/excluir a instância correspondente na Evolution
// (uma profissional podia assumir uma instância de outra, ou deixar uma
// instância órfã e ativa na Evolution). O único jeito de configurar ou
// remover a instância agora é por /evolution-instance, que sincroniza com
// a Evolution antes de gravar no banco.
router.get('/instance', getInstanceConfig);

// Gerenciamento de instância na Evolution
router.post('/evolution-instance', createEvolutionInstance);
router.delete('/evolution-instance', deleteEvolutionInstance);

export default router;
