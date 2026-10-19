// Cliente tipado das APIs do Financeiro (/financeiro/*). Só repassa o que o backend decide: nenhuma regra financeira aqui.
// Operações que gravam levam Idempotency-Key: a MESMA chave é reutilizada em reenvios do mesmo formulário (repetição devolve o mesmo resultado).
import { api, API_URL } from './api';

export function newIdempotencyKey(): string {
  const c = globalThis.crypto;
  return c?.randomUUID ? c.randomUUID() : `k-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
const idem = (key: string) => ({ 'Idempotency-Key': key });
const qs = (o: Record<string, string | number | boolean | null | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};

export type PaymentMethod = 'pix' | 'dinheiro' | 'cartao_debito' | 'cartao_credito' | 'transferencia' | 'outra';
export const PAYMENT_METHODS: PaymentMethod[] = ['pix', 'dinheiro', 'cartao_debito', 'cartao_credito', 'transferencia', 'outra'];
export const EXPENSE_METHODS: string[] = [...PAYMENT_METHODS, 'boleto'];

// ── histórico ──────────────────────────────────────────────────────────────
export interface HistoryItem { seq: number; action: string; actorId: string | null; reason: string | null; before: unknown; after: unknown; createdAt: string }
export interface HistoryResponse { tipo: string; id: string; historico: HistoryItem[] }

// ── movimentações ──────────────────────────────────────────────────────────
export interface Movimentacao {
  id: string; tipo: 'recebimento' | 'estorno' | 'despesa'; date: string; method: string | null; methodInformed: boolean; amountCents: number;
  label: string; notes: string | null; createdAt: string; appointmentId: string | null; appointmentStartsAt: string | null; expenseId: string | null;
  reversesPaymentId: string | null; historicoPath: string;
}
export interface MovimentacoesResponse {
  from: string; to: string; truncated: boolean;
  totais: { quantidade: number; recebidoCents: number; estornadoCents: number; despesasPagasCents: number; saldoCents: number };
  itens: Movimentacao[];
}

// ── atendimento (recebimentos) ─────────────────────────────────────────────
export interface PaymentRow {
  id: string; kind: 'recebimento' | 'estorno'; amountCents: number; method: string; occurredOn: string; source?: string; notes: string | null;
  reversesPaymentId: string | null; createdAt: string; refundedCents?: number; remainingCents?: number;
}
export interface AppointmentFinance {
  appointmentId: string; status: string; finalPriceCents: number | null; canReceive: boolean; valueCents: number; valueBasis: 'final' | 'servico';
  receivedCents: number; refundedCents: number; netReceivedCents: number; balanceCents: number; movimentacoes: PaymentRow[];
  finalPriceHistory?: Array<{ at: string; fromCents: number | null; toCents: number | null; reason: string | null }>;
}

// ── a receber ──────────────────────────────────────────────────────────────
export interface ReceivableItem {
  appointmentId: string; paymentsPath: string; clientName: string; serviceName: string; startsAt: string; endsAt: string; daysSinceService: number;
  valueCents: number; valueBasis: 'final' | 'servico'; receivedCents: number; refundedCents: number; netReceivedCents: number; balanceCents: number;
  overdue: boolean; quitado: boolean; movimentacoes: number;
  sinalLegado: { depositCents: number; conferido: boolean; naoContadoComoRecebido: boolean } | null;
}
export interface ReceivablesResponse {
  today: string; graceDays: number;
  totais: { atendimentos: number; valorCents: number; recebidoLiquidoCents: number; recebidoCents: number; estornadoCents: number; saldoPendenteCents: number; saldoVencidoCents: number; emAberto: number; vencidos: number };
  itens: ReceivableItem[];
}

// ── despesas ───────────────────────────────────────────────────────────────
export type ExpenseState = 'a_revisar' | 'pendente' | 'vencida' | 'paga';
export interface ExpensePaymentRow { id: string; expenseId: string; amountCents: number; method: string; paidOn: string; notes: string | null; createdAt: string }
export interface DespesaItem {
  id: string; description: string; category: string; amountCents: number; expenseDate: string; dueOn: string | null; paidOn: string | null; paidMethod: string | null;
  notes: string | null; createdAt: string; status: string; state: ExpenseState; paidCents: number; remainingCents: number; legacyPaid: boolean; overdue: boolean; paymentsCount: number;
}
export interface DespesaDetail extends DespesaItem { pagamentos: ExpensePaymentRow[] }
export interface DespesasResponse {
  today: string; despesas: DespesaItem[];
  totais: Record<ExpenseState, { count: number; amountCents: number; paidCents: number; remainingCents: number }>;
}
export type ReviewBody =
  | { to: 'pendente'; dueOn?: string; reason?: string }
  | { to: 'paga'; paidOn: string; method: string; reason: string };

// ── caixa ──────────────────────────────────────────────────────────────────
export interface CaixaMetodo {
  method: PaymentMethod; receivedCents: number; refundedCents: number; expensesPaidCents: number; expectedCents: number;
  expensesPaidBoletoCents?: number; expensesPaidUnknownMethodCents?: number;
}
export interface CaixaEsperado { metodos: CaixaMetodo[]; totais: { receivedCents: number; refundedCents: number; expensesPaidCents: number; expectedCents: number } }
export interface CaixaEntry { method: PaymentMethod; expectedCents: number; countedCents: number; differenceCents: number; justification: string | null; closedBy: string | null; createdAt: string }
export interface CaixaVersion { version: number; closedAt: string; metodos: CaixaEntry[] }
export interface Fechamento {
  id: string; date: string; status: 'fechado' | 'aberto'; receivedCents: number; refundedCents: number; expensesPaidCents: number;
  closedAt: string; reopenedAt: string | null; reopenReason: string | null; reopenCount: number;
}
export interface CaixaDay { date: string; fechamento: Fechamento | null; versoes: CaixaVersion[]; esperado: CaixaEsperado }
export interface CaixaList { fechamentos: Array<Fechamento & { ultimaVersao: CaixaVersion | null; versoes: number }> }
export interface CaixaMovements {
  date: string;
  recebimentos: Array<{ id: string; appointmentId: string; clientName: string; kind: 'recebimento' | 'estorno'; method: string; amountCents: number; notes: string | null; historicoPath: string }>;
  pagamentosDespesa: Array<{ id: string; expenseId: string; description: string; method: string; amountCents: number; notes: string | null; historicoPath: string }>;
  despesasPagasAntigas: Array<{ expenseId: string; description: string; method: string; originalMethod: string | null; methodInformed: boolean; amountCents: number; historicoPath: string }>;
}

export const financeiro = {
  /** Usado só para saber se o módulo existe neste servidor (404 = desligado, 503 = estrutura ausente). */
  probe: () => api.get<CaixaList>('/financeiro/caixa?limit=1'),
  history: (path: string) => api.get<HistoryResponse>(path),
  movimentacoes: (p: { from: string; to: string; tipo?: string; metodo?: string }) => api.get<MovimentacoesResponse>(`/financeiro/movimentacoes${qs({ ...p, limit: 500 })}`),

  appointment: (id: string) => api.get<AppointmentFinance>(`/financeiro/atendimentos/${id}/pagamentos`),
  receive: (id: string, key: string, body: { amountCents: number; method: PaymentMethod; occurredOn: string; notes?: string }) =>
    api.post<{ replayed: boolean; resumo: AppointmentFinance }>(`/financeiro/atendimentos/${id}/pagamentos`, body, idem(key)),
  refund: (paymentId: string, key: string, body: { amountCents: number; occurredOn: string; reason: string }) =>
    api.post<{ replayed: boolean; resumo: AppointmentFinance }>(`/financeiro/pagamentos/${paymentId}/estornos`, body, idem(key)),

  setFinalPrice: (id: string, body: { finalPriceCents: number; reason?: string }) => api.put<{ changed: boolean; resumo: AppointmentFinance }>(`/financeiro/atendimentos/${id}/preco-final`, body),
  correct: (paymentId: string, key: string, body: { reason: string; occurredOn: string; novo: { amountCents: number; method: PaymentMethod; occurredOn?: string; notes?: string } }) =>
    api.post<{ replayed: boolean; resumo: AppointmentFinance }>(`/financeiro/pagamentos/${paymentId}/correcao`, body, idem(key)),

  receivables: (p: { incluirQuitados?: boolean }) => api.get<ReceivablesResponse>(`/financeiro/a-receber${qs({ ...p, limit: 500 })}`),

  despesas: (p: { situacao?: string }) => api.get<DespesasResponse>(`/financeiro/despesas${qs({ ...p, limit: 500 })}`),
  despesa: (id: string) => api.get<DespesaDetail>(`/financeiro/despesas/${id}`),
  reviewDespesa: (id: string, body: ReviewBody) => api.post<DespesaDetail>(`/financeiro/despesas/${id}/revisao`, body),
  setVencimento: (id: string, body: { dueOn: string; reason: string }) => api.put<{ changed: boolean; despesa: DespesaDetail }>(`/financeiro/despesas/${id}/vencimento`, body),
  payDespesa: (id: string, key: string, body: { amountCents: number; method: string; paidOn: string; notes?: string }) =>
    api.post<{ replayed: boolean; despesa: DespesaDetail }>(`/financeiro/despesas/${id}/pagamentos`, body, idem(key)),
  /** Cadastro/edição/exclusão reutilizam as rotas de Gastos (/expenses). */
  /** Cadastro atômico (despesa + situação inicial numa só operação). */
  createDespesa: (body: { description: string; category: string; amountCents: number; expenseDate: string; notes: string | null; situacao: { to: 'a_revisar' } | { to: 'pendente'; dueOn?: string } | { to: 'paga'; paidOn: string; method: string } }) => api.post<DespesaDetail>('/financeiro/despesas', body),
  createExpense: (body: { description: string; category: string; amount_cents: number; expense_date: string; notes: string | null }) => api.post<{ id: string }>('/expenses', body),
  updateExpense: (id: string, body: { description: string; category: string; amount_cents: number; expense_date: string; notes: string | null }) => api.put<{ id: string }>(`/expenses/${id}`, body),
  deleteExpense: (id: string) => api.delete<void>(`/expenses/${id}`),

  relatorio: (p: { from: string; to: string }) => api.get<RelatorioResponse>(`/financeiro/relatorio${qs(p)}`),
  alertas: () => api.get<AlertasResponse>('/financeiro/alertas'),

  caixaList: () => api.get<CaixaList>('/financeiro/caixa?limit=60'),
  caixaDay: (date: string) => api.get<CaixaDay>(`/financeiro/caixa/${date}`),
  caixaMovements: (date: string) => api.get<CaixaMovements>(`/financeiro/caixa/${date}/lancamentos`),
  closeCaixa: (date: string, body: { counted: Record<PaymentMethod, number>; justification?: string }) => api.post<{ fechamento: Fechamento }>(`/financeiro/caixa/${date}/fechamento`, body),
  reopenCaixa: (date: string, reason: string) => api.post<{ fechamento: Fechamento }>(`/financeiro/caixa/${date}/reabertura`, { reason }),
};

// ── relatório e alertas (etapa 8) ──────────────────────────────────────────
export interface RelatorioResponse {
  periodo: { from: string; to: string; hoje: string };
  resumo: { receivedCents: number; refundedCents: number; netReceivedCents: number; expensesPaidCents: number; saldoCents: number };
  recebimentosPorMetodo: Array<{ method: PaymentMethod; receivedCents: number; refundedCents: number; netCents: number }>;
  despesasPagasPorMetodo: Array<{ method: string; paidCents: number }>;
  despesasPagasPorCategoria: Array<{ category: string; paidCents: number; count: number }>;
  pendencias: {
    aReceber: { pendenteCents: number; vencidoCents: number; emAberto: number; vencidos: number };
    despesas: Record<'aRevisar' | 'pendentes' | 'vencidas', { count: number; amountCents: number; remainingCents: number }>;
  };
  caixa: { diasFechados: number; diasReabertos: number; comDivergencia: number };
}
export interface Alerta { type: string; severity: 'alta' | 'media' | 'baixa'; title: string; count: number; amountCents: number; path: string }
export interface AlertasResponse { hoje: string; total: number; alertas: Alerta[] }

/** Baixa o arquivo do relatório (cookie de sessão) e o entrega ao navegador; erros da API viram mensagem. */
export async function downloadRelatorio(kind: 'xlsx' | 'pdf', range: { from: string; to: string }): Promise<void> {
  const res = await fetch(`${API_URL}/financeiro/relatorio.${kind}?from=${range.from}&to=${range.to}`, { credentials: 'include' });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error((j as { error?: string }).error || `Erro ${res.status}`);
  }
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = `financeiro-${range.from}-a-${range.to}.${kind}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
