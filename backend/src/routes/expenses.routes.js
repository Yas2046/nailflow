import { Router } from 'express';
import { listExpenses, getExpenseSummary, createExpense, updateExpense, deleteExpense } from '../controllers/expensesController.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

router.get('/summary', getExpenseSummary);
router.get('/', listExpenses);
router.post('/', createExpense);
router.put('/:id', updateExpense);
router.delete('/:id', deleteExpense);

export default router;
