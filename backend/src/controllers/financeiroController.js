// Financeiro, etapa 2: pagamentos e recebimentos por atendimento (receber, estornar, corrigir, consultar o saldo).
// Usa a estrutura da migration 025 (financial_payments: append-only, histórico automático, FKs compostas por profissional,
// dia fechado recusado pelo banco) e a 026 (forma de pagamento "transferencia").
//
// Princípios:
//  * Atendimento CONCLUÍDO não é pagamento CONFIRMADO: nada é gravado sozinho; só entra o que a profissional registrar.
//    Os sinais Pix antigos (deposit_cents/paid_at) NÃO são lidos nem importados aqui.
//  * Só se recebe de atendimento 'concluido'. Teto no servidor: recebido líquido (recebimentos - estornos) <= valor do serviço
//    (valor final quando houver; senão o preço registrado), conferido sob trava por atendimento.
//  * Nada é alterado nem apagado: correção = estorno do saldo + novo recebimento, na mesma transação, ambos com histórico.
//  * Idempotência: cabeçalho Idempotency-Key obrigatório; mesma chave e mesmo pedido devolve o resultado gravado (200);
//    mesma chave com pedido diferente é 409.
import { z } from 'zod';
import { pool } from '../config/db.js';
import { withTransaction } from './appointmentsController.js';
import {
  receiveSchema, refundSchema, correctionSchema, checkMovementDate, parseIdempotencyKey, requestHash, serviceValue, balance,
  financeiroPagamentosEnabled, FinanceError,
} from '../utils/financeiroPagamentos.js';
import { finalPriceSchema, setFinalPrice, advisoryLock } from '../utils/financeiroPrecoFinal.js';

export const fail = (status, reason, message, extra) => { throw new FinanceError(status, reason, message, extra); };

const COLS = `id, appointment_id, kind, amount_cents, method, to_char(occurred_on, 'YYYY-MM-DD') AS occurred_on, source,
              reverses_payment_id, notes, created_at, request_hash`;

const dto = (r) => ({
  id: r.id,
  appointmentId: r.appointment_id,
  kind: r.kind,
  amountCents: r.amount_cents,
  method: r.method,
  occurredOn: r.occurred_on,
  source: r.source,
  reversesPaymentId: r.reverses_payment_id,
  notes: r.notes,
  createdAt: r.created_at,
});

// ── disponibilidade ────────────────────────────────────────────────────────
// Sem cache de propósito: uma consulta de catálogo por requisição financeira, e a estrutura (025 + 026) nunca fica "presumida".
async function structureAvailable() {
  const { rows } = await pool.query(
    `SELECT to_regclass('public.financial_payments') IS NOT NULL
        AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'financial_payments_method_check'
                       AND pg_get_constraintdef(oid) LIKE '%transferencia%') AS ok`);
  return rows[0].ok === true;
}

/** Interruptor fail-closed: desligado = a rota não existe (404), mesmo autenticada. Vem ANTES da autenticação. */
export function requireFinanceiroEnabled(req, res, next) {
  if (!financeiroPagamentosEnabled()) return res.status(404).json({ error: 'Rota não encontrada.' });
  next();
}

/** Estrutura (025 + 026) ausente = 503. Vem DEPOIS da autenticação: quem não tem sessão não descobre o estado da configuração. */
export async function requireFinanceiroStructure(req, res, next) {
  try {
    if (!(await structureAvailable())) {
      return res.status(503).json({ error: 'Financeiro indisponível: a estrutura do banco não foi aplicada.', reason: 'structure_missing' });
    }
    next();
  } catch (err) { next(err); }
}

// ── tratamento de erros ────────────────────────────────────────────────────
export const wrap = (fn) => async (req, res, next) => {
  try {
    await fn(req, res);
  } catch (err) {
    if (err instanceof FinanceError) return res.status(err.status).json({ error: err.message, reason: err.reason, ...err.extra });
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors[0]?.message ?? 'Dados inválidos.', reason: 'validation' });
    // Regras do banco (migration 025): mensagens fixas, sem vazar o texto do PostgreSQL.
    if (err?.code === '23514') {
      if (/fechado/.test(err.message)) return res.status(409).json({ error: 'O dia desta movimentação está fechado no caixa. Reabra o caixa ou use outra data.', reason: 'day_closed' });
      if (/excederiam/.test(err.message)) return res.status(409).json({ error: 'O estorno ultrapassa o valor recebido.', reason: 'refund_exceeds' });
      if (/ultrapassariam o valor da despesa/.test(err.message)) return res.status(409).json({ error: 'O pagamento ultrapassa o saldo da despesa.', reason: 'exceeds_expense' });
      if (/abaixo do já pago/.test(err.message)) return res.status(409).json({ error: 'O valor da despesa não pode ficar abaixo do já pago.', reason: 'below_paid' });
      if (/excederia o valor/.test(err.message)) return res.status(409).json({ error: 'O total recebido ultrapassaria o valor do serviço.', reason: 'exceeds_value' });
      if (/abaixo do líquido/.test(err.message)) return res.status(409).json({ error: 'O valor do serviço não pode ficar abaixo do já recebido.', reason: 'below_received' });
      return res.status(409).json({ error: 'Movimentação recusada por uma regra financeira.', reason: 'rule_violation' });
    }
    if (err?.code === '23505') return res.status(409).json({ error: 'Esta movimentação já foi registrada.', reason: 'duplicate' });
    next(err);
  }
};

// ── consultas ──────────────────────────────────────────────────────────────
async function findByKey(db, professionalId, key) {
  const { rows } = await db.query(`SELECT ${COLS} FROM financial_payments WHERE professional_id = $1 AND idempotency_key = $2`, [professionalId, key]);
  return rows[0] ?? null;
}

async function totals(db, appointmentId, professionalId) {
  const { rows } = await db.query(
    `SELECT COALESCE(SUM(amount_cents) FILTER (WHERE kind = 'recebimento'), 0)::int AS received,
            COALESCE(SUM(amount_cents) FILTER (WHERE kind = 'estorno'), 0)::int AS refunded
       FROM financial_payments WHERE appointment_id = $1 AND professional_id = $2`, [appointmentId, professionalId]);
  return rows[0];
}

/** Trava o atendimento (FOR SHARE: conflita com o FOR UPDATE da Agenda) e serializa os lançamentos dele (advisory lock). */
async function lockAppointment(client, appointmentId, professionalId) {
  const { rows } = await client.query(
    `SELECT id, status, price_cents_snapshot, final_price_cents FROM appointments WHERE id = $1 AND professional_id = $2 FOR SHARE`,
    [appointmentId, professionalId]);
  if (!rows[0]) return null;
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))', [`fin_pay:${appointmentId}`]);
  return rows[0];
}

export const setActor = (client, professionalId) => client.query(`SELECT set_config('nailflow.actor_id', $1, true)`, [professionalId]);

async function summarize(db, appointmentId, professionalId) {
  const { rows: ap } = await db.query(
    `SELECT id, status, price_cents_snapshot, final_price_cents FROM appointments WHERE id = $1 AND professional_id = $2`, [appointmentId, professionalId]);
  if (!ap[0]) return null;
  const { rows } = await db.query(`SELECT ${COLS} FROM financial_payments WHERE appointment_id = $1 AND professional_id = $2 ORDER BY created_at, id`, [appointmentId, professionalId]);
  const value = serviceValue(ap[0]);
  const received = rows.filter((r) => r.kind === 'recebimento').reduce((s, r) => s + r.amount_cents, 0);
  const refunded = rows.filter((r) => r.kind === 'estorno').reduce((s, r) => s + r.amount_cents, 0);
  const b = balance(value.cents, received, refunded);
  const refundedBy = new Map();
  for (const r of rows) if (r.kind === 'estorno') refundedBy.set(r.reverses_payment_id, (refundedBy.get(r.reverses_payment_id) ?? 0) + r.amount_cents);
  const { rows: hist } = await db.query(
    `SELECT created_at, before_data->>'final_price_cents' AS de, after_data->>'final_price_cents' AS para, reason
       FROM financial_audit_log WHERE entity_type = 'appointment' AND entity_id = $1 AND professional_id = $2 AND action = 'appointment_final_price' ORDER BY seq`,
    [appointmentId, professionalId]);
  return {
    appointmentId,
    status: ap[0].status,
    finalPriceCents: ap[0].final_price_cents,
    finalPriceHistory: hist.map((h) => ({ at: h.created_at, fromCents: h.de == null ? null : Number(h.de), toCents: h.para == null ? null : Number(h.para), reason: h.reason })),
    canReceive: ap[0].status === 'concluido',
    valueCents: b.valueCents,
    valueBasis: value.basis,
    receivedCents: b.receivedCents,
    refundedCents: b.refundedCents,
    netReceivedCents: b.netCents,
    balanceCents: b.balanceCents,
    movimentacoes: rows.map((r) => ({
      ...dto(r),
      ...(r.kind === 'recebimento' ? { refundedCents: refundedBy.get(r.id) ?? 0, remainingCents: r.amount_cents - (refundedBy.get(r.id) ?? 0) } : {}),
    })),
  };
}

function ensureCompleted(appt) {
  if (appt.status !== 'concluido') {
    fail(409, 'not_completed', 'Só é possível registrar recebimento de um atendimento concluído.');
  }
}
function ensureWithinValue(appt, netCents, addCents) {
  const value = serviceValue(appt).cents;
  if (netCents + addCents > value) {
    fail(409, 'exceeds_value', 'O total recebido ultrapassaria o valor do serviço.', { valueCents: value, netReceivedCents: netCents, balanceCents: value - netCents });
  }
}
export function requireKey(req) {
  const key = parseIdempotencyKey(req.get('Idempotency-Key'));
  if (!key) fail(400, 'idempotency_key_required', 'Informe o cabeçalho Idempotency-Key (8 a 50 caracteres: letras, números, _ . : -).');
  return key;
}
export function checkDate(value, opts) {
  const c = checkMovementDate(value, opts);
  if (!c.ok) fail(400, 'invalid_date', c.error);
  return c.value;
}
export const conflict = () => fail(409, 'idempotency_conflict', 'Esta chave de idempotência já foi usada com outro pedido.');

const INSERT = `INSERT INTO financial_payments
  (professional_id, appointment_id, kind, amount_cents, method, occurred_on, reverses_payment_id, notes, idempotency_key, request_hash)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
  ON CONFLICT (professional_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
  RETURNING ${COLS}`;

// ── GET /financeiro/atendimentos/:id/pagamentos ────────────────────────────
export const getAppointmentPayments = wrap(async (req, res) => {
  const summary = await summarize(pool, req.params.id, req.professionalId);
  if (!summary) fail(404, 'not_found', 'Atendimento não encontrado.');
  res.json(summary);
});

// ── POST /financeiro/atendimentos/:id/pagamentos ───────────────────────────
export const receivePayment = wrap(async (req, res) => {
  const pid = req.professionalId;
  const appointmentId = req.params.id;
  const key = requireKey(req);
  const data = receiveSchema.parse(req.body);
  const occurredOn = checkDate(data.occurredOn);
  const notes = data.notes?.trim() || null;
  const hash = requestHash('receive', pid, { appointmentId, amountCents: data.amountCents, method: data.method, occurredOn, notes });

  const out = await withTransaction(async (client) => {
    await setActor(client, pid);
    const appt = await lockAppointment(client, appointmentId, pid);
    if (!appt) fail(404, 'not_found', 'Atendimento não encontrado.');
    const existing = await findByKey(client, pid, key);
    if (existing) {
      if (existing.request_hash !== hash) conflict();
      return { replayed: true, row: existing };
    }
    ensureCompleted(appt);
    const t = await totals(client, appointmentId, pid);
    ensureWithinValue(appt, t.received - t.refunded, data.amountCents);
    const { rows } = await client.query(INSERT, [pid, appointmentId, 'recebimento', data.amountCents, data.method, occurredOn, null, notes, key, hash]);
    if (!rows[0]) {                                    // mesma chave gravada por outro pedido (outro atendimento) entre a leitura e o INSERT
      const again = await findByKey(client, pid, key);
      if (again && again.request_hash === hash) return { replayed: true, row: again };
      conflict();
    }
    return { replayed: false, row: rows[0] };
  });
  res.status(out.replayed ? 200 : 201).json({ replayed: out.replayed, pagamento: dto(out.row), resumo: await summarize(pool, appointmentId, pid) });
});

async function loadReceipt(db, paymentId, pid) {
  const { rows } = await db.query(`SELECT ${COLS} FROM financial_payments WHERE id = $1 AND professional_id = $2`, [paymentId, pid]);
  return rows[0] ?? null;
}
async function refundedOf(db, paymentId, pid) {
  const { rows } = await db.query(`SELECT COALESCE(SUM(amount_cents), 0)::int AS n FROM financial_payments WHERE reverses_payment_id = $1 AND professional_id = $2`, [paymentId, pid]);
  return rows[0].n;
}

// ── POST /financeiro/pagamentos/:id/estornos ───────────────────────────────
export const refundPayment = wrap(async (req, res) => {
  const pid = req.professionalId;
  const paymentId = req.params.id;
  const key = requireKey(req);
  const data = refundSchema.parse(req.body);
  const reason = data.reason;
  const hash = requestHash('refund', pid, { paymentId, amountCents: data.amountCents, occurredOn: data.occurredOn, reason });

  const out = await withTransaction(async (client) => {
    await setActor(client, pid);
    const orig0 = await loadReceipt(client, paymentId, pid);
    if (!orig0) fail(404, 'not_found', 'Recebimento não encontrado.');
    const appt = await lockAppointment(client, orig0.appointment_id, pid);
    const existing = await findByKey(client, pid, key);
    if (existing) {
      if (existing.request_hash !== hash) conflict();
      return { replayed: true, row: existing, appointmentId: orig0.appointment_id };
    }
    if (!appt) fail(404, 'not_found', 'Atendimento não encontrado.');
    if (orig0.kind !== 'recebimento') fail(409, 'not_a_receipt', 'Só é possível estornar um recebimento.');
    const occurredOn = checkDate(data.occurredOn, { notBefore: orig0.occurred_on });
    const remaining = orig0.amount_cents - await refundedOf(client, paymentId, pid);
    if (data.amountCents > remaining) fail(409, 'refund_exceeds', 'O estorno ultrapassa o valor ainda não estornado deste recebimento.', { remainingCents: remaining });
    const { rows } = await client.query(INSERT, [pid, orig0.appointment_id, 'estorno', data.amountCents, orig0.method, occurredOn, paymentId, reason, key, hash]);
    if (!rows[0]) {
      const again = await findByKey(client, pid, key);
      if (again && again.request_hash === hash) return { replayed: true, row: again, appointmentId: orig0.appointment_id };
      conflict();
    }
    return { replayed: false, row: rows[0], appointmentId: orig0.appointment_id };
  });
  res.status(out.replayed ? 200 : 201).json({ replayed: out.replayed, estorno: dto(out.row), resumo: await summarize(pool, out.appointmentId, pid) });
});

// ── POST /financeiro/pagamentos/:id/correcao ───────────────────────────────
// Corrigir um recebimento lançado errado: estorna o SALDO dele e registra o recebimento correto, numa só transação.
// Nada é editado: o original, o estorno e o novo recebimento ficam no histórico, com o motivo.
export const correctPayment = wrap(async (req, res) => {
  const pid = req.professionalId;
  const paymentId = req.params.id;
  const key = requireKey(req);
  const data = correctionSchema.parse(req.body);
  const novoNotes = data.novo.notes?.trim() || null;
  const novoDate = data.novo.occurredOn ?? data.occurredOn;
  const hash = requestHash('correct', pid, { paymentId, reason: data.reason, occurredOn: data.occurredOn, novo: { amountCents: data.novo.amountCents, method: data.novo.method, occurredOn: novoDate, notes: novoNotes } });
  const keyE = `${key}:e`;
  const keyN = `${key}:n`;

  const out = await withTransaction(async (client) => {
    await setActor(client, pid);
    const orig = await loadReceipt(client, paymentId, pid);
    if (!orig) fail(404, 'not_found', 'Recebimento não encontrado.');
    const appt = await lockAppointment(client, orig.appointment_id, pid);
    const existing = await findByKey(client, pid, keyE);
    if (existing) {
      if (existing.request_hash !== hash) conflict();
      const novo = await findByKey(client, pid, keyN);
      return { replayed: true, estorno: existing, novo, appointmentId: orig.appointment_id };
    }
    if (!appt) fail(404, 'not_found', 'Atendimento não encontrado.');
    if (orig.kind !== 'recebimento') fail(409, 'not_a_receipt', 'Só é possível corrigir um recebimento.');
    const refundDate = checkDate(data.occurredOn, { notBefore: orig.occurred_on });
    const newDate = checkDate(novoDate);
    ensureCompleted(appt);
    const remaining = orig.amount_cents - await refundedOf(client, paymentId, pid);
    if (remaining <= 0) fail(409, 'nothing_to_correct', 'Este recebimento já foi totalmente estornado.');
    const { rows: er } = await client.query(INSERT, [pid, orig.appointment_id, 'estorno', remaining, orig.method, refundDate, paymentId, `Correção: ${data.reason}`, keyE, hash]);
    if (!er[0]) conflict();
    const t = await totals(client, orig.appointment_id, pid);
    ensureWithinValue(appt, t.received - t.refunded, data.novo.amountCents);
    const note = `Correção do recebimento ${paymentId}${novoNotes ? `: ${novoNotes}` : ''}`;
    const { rows: nr } = await client.query(INSERT, [pid, orig.appointment_id, 'recebimento', data.novo.amountCents, data.novo.method, newDate, null, note, keyN, hash]);
    if (!nr[0]) conflict();
    return { replayed: false, estorno: er[0], novo: nr[0], appointmentId: orig.appointment_id };
  });
  res.status(out.replayed ? 200 : 201).json({
    replayed: out.replayed, estorno: dto(out.estorno), pagamento: out.novo ? dto(out.novo) : null,
    resumo: await summarize(pool, out.appointmentId, pid),
  });
});

// ── PUT /financeiro/atendimentos/:id/preco-final ───────────────────────────
// Define ou altera o preço final de um atendimento CONCLUÍDO, com justificativa (obrigatória se difere do preço do serviço ou altera um
// valor final já definido). Nunca abaixo do líquido já recebido. O mesmo valor de novo não muda nada (changed: false).
export const putFinalPrice = wrap(async (req, res) => {
  const pid = req.professionalId;
  const appointmentId = req.params.id;
  const data = finalPriceSchema.parse(req.body);
  const out = await withTransaction(async (client) => {
    // FOR NO KEY UPDATE conflita com o FOR SHARE dos recebimentos e não com a FK adiada de quem grava direto no banco.
    const { rows } = await client.query(
      `SELECT id, status, price_cents_snapshot, final_price_cents FROM appointments WHERE id = $1 AND professional_id = $2 FOR NO KEY UPDATE`,
      [appointmentId, pid]);
    if (!rows[0]) fail(404, 'not_found', 'Atendimento não encontrado.');
    await advisoryLock(client, appointmentId);
    return setFinalPrice(client, { appointmentId, professionalId: pid, row: rows[0], newCents: data.finalPriceCents, reason: data.reason });
  });
  res.status(200).json({ changed: out.changed, resumo: await summarize(pool, appointmentId, pid) });
});
