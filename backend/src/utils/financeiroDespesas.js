// Regras PURAS das despesas e das contas a receber (Financeiro, etapa 4). Reaproveita os métodos, datas e erros da etapa 2.
import { z } from 'zod';
import { PAYMENT_METHODS, MAX_AMOUNT_CENTS, MIN_DATE, parseDateOnly, todayInBusinessTz } from './financeiroPagamentos.js';

// Igual à constraint expense_payments_method_check / expenses_paid_method_check.
export const EXPENSE_METHODS = [...PAYMENT_METHODS, 'boleto'];
export const EXPENSE_STATES = ['a_revisar', 'pendente', 'vencida', 'paga'];

const cents = z.number({ invalid_type_error: 'Valor inválido.', required_error: 'Informe o valor.' })
  .int('O valor deve ser em centavos (inteiro).').positive('O valor deve ser maior que zero.').max(MAX_AMOUNT_CENTS, 'Valor acima do limite permitido.');
const method = z.enum(EXPENSE_METHODS, { errorMap: () => ({ message: 'Forma de pagamento inválida.' }) });
const date = z.string({ required_error: 'Informe a data.' });
const reason = z.string().trim().min(3, 'Informe o motivo (mínimo 3 caracteres).').max(300, 'Motivo muito longo.');

export const expensePaymentSchema = z.object({ amountCents: cents, method, paidOn: date, notes: z.string().max(300, 'Observação muito longa.').optional().nullable() }).strict();
export const dueSchema = z.object({ dueOn: date, reason }).strict();
export const reviewSchema = z.discriminatedUnion('to', [
  z.object({ to: z.literal('pendente'), dueOn: date.optional(), reason: reason.optional() }).strict(),
  z.object({ to: z.literal('paga'), paidOn: date, method, reason }).strict(),
]);

const CATEGORIES = ['Aluguel', 'Materiais', 'Energia', 'Água', 'Internet', 'Telefone', 'Marketing', 'Higiene', 'Equipamento', 'Outros'];
/** Cadastro com a situação inicial na MESMA operação (a_revisar, pendente com vencimento opcional, ou já paga com data e método). */
export const createDespesaSchema = z.object({
  description: z.string().trim().min(1, 'Descrição obrigatória.').max(200, 'Descrição muito longa.'),
  category: z.string().optional(),
  amountCents: cents,
  expenseDate: date,
  notes: z.string().max(1000).nullable().optional(),
  situacao: z.discriminatedUnion('to', [
    z.object({ to: z.literal('a_revisar') }).strict(),
    z.object({ to: z.literal('pendente'), dueOn: date.optional() }).strict(),
    z.object({ to: z.literal('paga'), paidOn: date, method }).strict(),
  ]),
}).strict();
export const resolveCategory = (raw) => (CATEGORIES.includes(raw) ? raw : 'Outros');

/** Vencimento: data real, >= 2020-01-01 e no máximo 10 anos à frente. */
export function checkDueDate(value, now = new Date()) {
  const d = parseDateOnly(value);
  if (!d) return { ok: false, error: 'Data de vencimento inválida. Use AAAA-MM-DD.' };
  if (d < MIN_DATE) return { ok: false, error: 'Vencimento anterior ao limite permitido.' };
  const limit = new Date(`${todayInBusinessTz(now)}T12:00:00Z`);
  limit.setUTCFullYear(limit.getUTCFullYear() + 10);
  if (d > limit.toISOString().slice(0, 10)) return { ok: false, error: 'Vencimento distante demais.' };
  return { ok: true, value: d };
}

/**
 * Estado derivado de uma despesa. `paga` sem lançamentos (registro antigo gravado direto) conta como quitada pelo valor, e é sinalizada
 * (legacyPaid): nenhum pagamento é inventado. 'vencida' = pendente com vencimento anterior a hoje.
 */
export function expenseState({ payment_status: status, amount_cents: amount, due_on: dueOn, paid_cents: paid = 0, payments_count: n = 0 }, today) {
  const legacyPaid = status === 'paga' && n === 0;
  const paidCents = legacyPaid ? amount : paid;
  const remainingCents = Math.max(amount - paidCents, 0);
  let state = status;
  if (status === 'pendente' && dueOn && dueOn < today) state = 'vencida';
  return { state, paidCents, remainingCents, legacyPaid, overdue: state === 'vencida' };
}

/** Conta a receber de um atendimento concluído. Vencido = saldo > 0 e atendimento concluído há mais de `graceDays` dias. */
export function receivableState({ valueCents, receivedCents, refundedCents, daysSinceService }, graceDays) {
  const netCents = receivedCents - refundedCents;
  const balanceCents = Math.max(valueCents - netCents, 0);
  return { netCents, balanceCents, overdue: balanceCents > 0 && daysSinceService > graceDays, quitado: balanceCents === 0 };
}
