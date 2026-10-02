import { Router } from 'express';
import { getOnboardingStatus } from '../controllers/onboardingController.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.get('/status', requireAuth, getOnboardingStatus);

export default router;
