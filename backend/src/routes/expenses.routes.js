import { Router } from 'express';
import { listExpenses, createExpense, updateExpense, deleteExpense } from '../controllers/expensesController.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

router.get('/', listExpenses);
router.post('/', createExpense);
router.put('/:id', updateExpense);
router.delete('/:id', deleteExpense);

export default router;
