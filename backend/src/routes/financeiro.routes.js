import { Router } from 'express';
import {
  requireFinanceiroEnabled, requireFinanceiroStructure, getAppointmentPayments, receivePayment, refundPayment, correctPayment, putFinalPrice,
} from '../controllers/financeiroController.js';
import {
  requireDespesasStructure, createDespesa, listDespesas, getDespesa, reviewDespesa, putVencimento, payDespesa, getReceivables,
} from '../controllers/financeiroDespesasController.js';
import {
  requireCaixaStructure, getCaixaDay, listCaixa, closeCaixa, reopenCaixa, getCaixaMovements, getHistory, listMovimentacoes,
} from '../controllers/financeiroCaixaController.js';
import { getRelatorio, getRelatorioXlsx, getRelatorioPdf, getAlertas } from '../controllers/financeiroRelatoriosController.js';
import { requireAuth } from '../middleware/auth.js';
import { UUID_RE } from '../utils/appointmentStatus.js';

const router = Router();

// Interruptor primeiro (desligado = a rota não existe), depois a autenticação, depois a conferência da estrutura (025 + 026).
router.use(requireFinanceiroEnabled);
router.use(requireAuth);
router.use(requireFinanceiroStructure);

// Identificador malformado é erro de entrada (400), não falha do banco.
router.param('id', (_req, res, next, id) => {
  if (!UUID_RE.test(id)) return res.status(400).json({ error: 'Identificador inválido.', reason: 'validation' });
  next();
});

router.get('/atendimentos/:id/pagamentos', getAppointmentPayments);
router.post('/atendimentos/:id/pagamentos', receivePayment);
router.put('/atendimentos/:id/preco-final', putFinalPrice);
router.post('/pagamentos/:id/estornos', refundPayment);
router.post('/pagamentos/:id/correcao', correctPayment);

// Etapa 4: contas a receber (só leitura) e despesas (exigem também a 028).
router.get('/a-receber', getReceivables);
router.get('/despesas', requireDespesasStructure, listDespesas);
router.post('/despesas', requireDespesasStructure, createDespesa);
router.get('/despesas/:id', requireDespesasStructure, getDespesa);
router.post('/despesas/:id/revisao', requireDespesasStructure, reviewDespesa);
router.put('/despesas/:id/vencimento', requireDespesasStructure, putVencimento);
router.post('/despesas/:id/pagamentos', requireDespesasStructure, payDespesa);

// Etapa 5: fechamento de caixa por método (exige a migration 029) e histórico das movimentações.
router.get('/caixa', requireCaixaStructure, listCaixa);
router.get('/caixa/:date', requireCaixaStructure, getCaixaDay);
router.get('/caixa/:date/lancamentos', requireCaixaStructure, getCaixaMovements);
router.post('/caixa/:date/fechamento', requireCaixaStructure, closeCaixa);
router.post('/caixa/:date/reabertura', requireCaixaStructure, reopenCaixa);
router.get('/movimentacoes', requireCaixaStructure, listMovimentacoes);
router.get('/relatorio', requireCaixaStructure, getRelatorio);
router.get('/relatorio.xlsx', requireCaixaStructure, getRelatorioXlsx);
router.get('/relatorio.pdf', requireCaixaStructure, getRelatorioPdf);
router.get('/alertas', requireCaixaStructure, getAlertas);
router.get('/historico/:tipo/:id', getHistory);

export default router;
