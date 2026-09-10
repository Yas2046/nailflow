import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { login, logout, me } from '../controllers/authController.js';
import { requireAuth } from '../middleware/auth.js';

const loginRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  limit: 10,                 // máximo de 10 tentativas por janela
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({
      error: 'Muitas tentativas de login. Tente novamente em 15 minutos.',
    });
  },
});

const router = Router();

router.post('/login', loginRateLimit, login);
router.post('/logout', logout);
router.get('/me', requireAuth, me);

export default router;
