// Regras PURAS (sem E/S) dos pagamentos e recebimentos do Financeiro (etapa 2): métodos, valores, datas, chave de
// idempotência, hash do pedido e saldo. O controller (controllers/financeiroController.js) só orquestra transações.
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { getZonedParts } from './timezone.js';

// Mesma lista da constraint financial_payments_method_check (025 + 026).
export const PAYMENT_METHODS = ['pix', 'dinheiro', 'cartao_debito', 'cartao_credito', 'transferencia', 'outra'];

/** Erro de regra de negócio do Financeiro (status HTTP + reason estável + campos extras na resposta). */
export class FinanceError extends Error {
  constructor(status, reason, message, extra = {}) {
    super(message);
    this.name = 'FinanceError';
    this.status = status;
    this.reason = reason;
    this.extra = extra;
  }
}

export const MAX_AMOUNT_CENTS = 10_000_000;       // R$ 100.000,00 por lançamento: barreira contra digitação errada
export const MIN_DATE = '2020-01-01';             // nada anterior à existência do produto
const KEY_RE = /^[A-Za-z0-9_.:-]{8,50}$/;          // até 50: o servidor acrescenta ":e"/":n" (limite do banco: 64)

/** Interruptor fail-closed: só liga com o valor exato "true" (lido a cada requisição, para os testes). */
export function financeiroPagamentosEnabled(env = process.env) {
  const v = env.FINANCEIRO_PAGAMENTOS_ENABLED;
  return typeof v === 'string' && v.trim().toLowerCase() === 'true';
}

/** Data civil AAAA-MM-DD válida no calendário (rejeita 2026-02-30, 2026-13-01 e formatos soltos). Devolve a própria string ou null. */
export function parseDateOnly(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [y, m, d] = value.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return value;
}

/** Hoje (AAAA-MM-DD) no fuso do negócio. */
export function todayInBusinessTz(now = new Date()) {
  const p = getZonedParts(now);
  return `${String(p.year).padStart(4, '0')}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** { ok: true } ou { ok: false, error } para uma data de movimentação (real, >= MIN_DATE, não futura, não anterior a `notBefore`). */
export function checkMovementDate(value, { now = new Date(), notBefore = null } = {}) {
  const d = parseDateOnly(value);
  if (!d) return { ok: false, error: 'Data inválida. Use AAAA-MM-DD.' };
  if (d < MIN_DATE) return { ok: false, error: 'Data anterior ao limite permitido.' };
  if (d > todayInBusinessTz(now)) return { ok: false, error: 'A data não pode estar no futuro.' };
  if (notBefore && d < notBefore) return { ok: false, error: 'A data não pode ser anterior à do recebimento original.' };
  return { ok: true, value: d };
}

export function parseIdempotencyKey(header) {
  return typeof header === 'string' && KEY_RE.test(header) ? header : null;
}

const cents = z.number({ invalid_type_error: 'Valor inválido.', required_error: 'Informe o valor.' })
  .int('O valor deve ser em centavos (inteiro).').positive('O valor deve ser maior que zero.')
  .max(MAX_AMOUNT_CENTS, 'Valor acima do limite permitido.');
const method = z.enum(PAYMENT_METHODS, { errorMap: () => ({ message: 'Forma de pagamento inválida.' }) });
const dateStr = z.string({ required_error: 'Informe a data.' });
const notes = z.string().max(300, 'Observação muito longa.').optional().nullable();
const reason = z.string({ required_error: 'Informe o motivo.' }).trim().min(3, 'Informe o motivo (mínimo 3 caracteres).').max(300, 'Motivo muito longo.');

export const receiveSchema = z.object({ amountCents: cents, method, occurredOn: dateStr, notes }).strict();
export const refundSchema = z.object({ amountCents: cents, occurredOn: dateStr, reason }).strict();
export const correctionSchema = z.object({
  reason,
  occurredOn: dateStr,
  novo: z.object({ amountCents: cents, method, occurredOn: dateStr.optional(), notes }).strict(),
}).strict();

/** Hash estável (sha256 hex minúsculo, 64) do pedido: operação + conta + campos de negócio, em ordem fixa de chaves. */
export function requestHash(op, professionalId, payload) {
  const canon = (v) => (v && typeof v === 'object' && !Array.isArray(v)
    ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`
    : JSON.stringify(v ?? null));
  return createHash('sha256').update(canon({ op, professionalId, payload })).digest('hex');
}

/** Valor do serviço para o teto: valor final quando existe; senão o preço registrado no agendamento. */
export function serviceValue({ final_price_cents: finalCents, price_cents_snapshot: snapshot }) {
  return finalCents != null ? { cents: finalCents, basis: 'final' } : { cents: snapshot, basis: 'servico' };
}

/** Saldo de um atendimento. recebido/estornado em centavos; líquido = recebido - estornado. */
export function balance(valueCents, receivedCents, refundedCents) {
  const net = receivedCents - refundedCents;
  return { valueCents, receivedCents, refundedCents, netCents: net, balanceCents: valueCents - net };
}
