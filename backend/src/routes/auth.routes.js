import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { login, logout, logoutAll, changePassword, me, updateMe, register, getBookingSettings, updateBookingSettings } from '../controllers/authController.js';
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

// Por conta (não por IP): requireAuth roda antes e define professionalId.
// Troca de senha conta só as falhas (senha atual errada), para frear força bruta.
const passwordRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => `pwd:${req.professionalId}`,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({ error: 'Muitas tentativas de troca de senha. Tente novamente em 15 minutos.' });
  },
});

const logoutAllRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  keyGenerator: (req) => `lall:${req.professionalId}`,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({ error: 'Muitas solicitações. Tente novamente em 15 minutos.' });
  },
});

const router = Router();

router.post('/login', loginRateLimit, login);
router.post('/logout', logout);
router.post('/register', registerRateLimit, register);
router.get('/me', requireAuth, me);
router.put('/me', requireAuth, updateMe);
router.put('/password', requireAuth, passwordRateLimit, changePassword);
router.post('/logout-all', requireAuth, logoutAllRateLimit, logoutAll);
router.get('/booking-settings', requireAuth, getBookingSettings);
router.put('/booking-settings', requireAuth, updateBookingSettings);

export default router;
