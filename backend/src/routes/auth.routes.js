import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { login, logout, me, updateMe, register } from '../controllers/authController.js';
import { requireAuth } from '../middleware/auth.js';

const loginRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({
      error: 'Muitas tentativas de login. Tente novamente em 15 minutos.',
    });
  },
});

const registerRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({
      error: 'Muitos cadastros recentes deste IP. Tente novamente em 1 hora.',
    });
  },
});

const router = Router();

router.post('/login', loginRateLimit, login);
router.post('/logout', logout);
router.post('/register', registerRateLimit, register);
router.get('/me', requireAuth, me);
router.put('/me', requireAuth, updateMe);

export default router;
