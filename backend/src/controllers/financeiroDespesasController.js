// Financeiro, etapa 4: despesas (revisão, vencimento, pagamentos parciais) e contas a receber (leitura).
// Despesas reaproveitam a tabela expenses e o CRUD de Gastos (expensesController); aqui entram os ESTADOS e os pagamentos.
//  * Nada é presumido: despesa antiga fica 'a_revisar' até a profissional classificá-la (pendente ou paga, com motivo).
//  * Só despesa 'pendente' recebe pagamento; parciais somam até o valor (gatilho da 028); ao quitar, a despesa vira 'paga'.
//  * Contas a receber só LEEM: nada é gravado a partir do status do atendimento nem dos sinais Pix antigos.
import { pool } from '../config/db.js';
import { withTransaction } from './appointmentsController.js';
import { wrap, fail, setActor, requireKey, checkDate, conflict } from './financeiroController.js';
import { requestHash, todayInBusinessTz, parseDateOnly } from '../utils/financeiroPagamentos.js';
import { createDespesaSchema, resolveCategory, expensePaymentSchema, dueSchema, reviewSchema, checkDueDate, expenseState, receivableState, EXPENSE_STATES } from '../utils/financeiroDespesas.js';

/** 503 enquanto a 028 não estiver aplicada (depois da autenticação, como a conferência da 025/026). */
export async function requireDespesasStructure(req, res, next) {
  try {
    const { rows } = await pool.query(`SELECT to_regclass('public.expense_payments') IS NOT NULL
      AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_expense_payments_guard' AND NOT tgisinternal) AS ok`);
    if (rows[0].ok !== true) return res.status(503).json({ error: 'Despesas indisponíveis: a estrutura do banco (migration 028) não foi aplicada.', reason: 'structure_missing' });
    next();
  } catch (err) { next(err); }
}

const EXP_COLS = `e.id, e.description, e.category, e.amount_cents, to_char(e.expense_date, 'YYYY-MM-DD') AS expense_date, e.payment_status,
  to_char(e.due_on, 'YYYY-MM-DD') AS due_on, to_char(e.paid_on, 'YYYY-MM-DD') AS paid_on, e.paid_method, e.notes, e.created_at`;
const PAID = `LEFT JOIN LATERAL (SELECT COALESCE(SUM(x.amount_cents), 0)::int AS paid_cents, count(*)::int AS payments_count
                                   FROM expense_payments x WHERE x.expense_id = e.id AND x.professional_id = e.professional_id) p ON true`;
const STATE_SQL = `CASE WHEN e.payment_status = 'paga' THEN 'paga' WHEN e.payment_status = 'a_revisar' THEN 'a_revisar'
                        WHEN e.due_on IS NOT NULL AND e.due_on < $2::date THEN 'vencida' ELSE 'pendente' END`;

const expenseDto = (r, today) => {
  const s = expenseState(r, today);
  return {
    id: r.id, description: r.description, category: r.category, amountCents: r.amount_cents, expenseDate: r.expense_date, dueOn: r.due_on,
    paidOn: r.paid_on, paidMethod: r.paid_method, notes: r.notes, createdAt: r.created_at, status: r.payment_status,
    state: s.state, paidCents: s.paidCents, remainingCents: s.remainingCents, legacyPaid: s.legacyPaid, overdue: s.overdue, paymentsCount: r.payments_count,
  };
};
const paymentDto = (r) => ({ id: r.id, expenseId: r.expense_id, amountCents: r.amount_cents, method: r.method, paidOn: r.paid_on, notes: r.notes, createdAt: r.created_at });
const PAY_COLS = `id, expense_id, amount_cents, method, to_char(paid_on, 'YYYY-MM-DD') AS paid_on, notes, created_at, request_hash`;

async function loadExpense(db, id, pid, { lock = false } = {}) {
  const { rows } = await db.query(
    `SELECT ${EXP_COLS}, p.paid_cents, p.payments_count FROM expenses e ${PAID} WHERE e.id = $1 AND e.professional_id = $2${lock ? ' FOR NO KEY UPDATE OF e' : ''}`, [id, pid]);
  return rows[0] ?? null;
}
async function detail(db, id, pid) {
  const today = todayInBusinessTz();
  const row = await loadExpense(db, id, pid);
  if (!row) return null;
  const { rows } = await db.query(`SELECT ${PAY_COLS} FROM expense_payments WHERE expense_id = $1 AND professional_id = $2 ORDER BY created_at, id`, [id, pid]);
  return { ...expenseDto(row, today), pagamentos: rows.map(paymentDto) };
}
const BUSINESS_TZ = 'America/Sao_Paulo';
const advisory = (client, id) => client.query('SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))', [`fin_exp:${id}`]);

function queryDate(v, name) {
  if (v === undefined || v === '') return null;
  const d = parseDateOnly(String(v));
  if (!d) fail(400, 'validation', `${name} inválida. Use AAAA-MM-DD.`);
  return d;
}

// ── GET /financeiro/despesas ───────────────────────────────────────────────
export const listDespesas = wrap(async (req, res) => {
  const pid = req.professionalId;
  const today = todayInBusinessTz();
  const situacao = req.query.situacao === undefined || req.query.situacao === '' ? null : String(req.query.situacao);
  if (situacao && !EXPENSE_STATES.includes(situacao)) fail(400, 'validation', 'Situação inválida (a_revisar, pendente, vencida ou paga).');
  const from = queryDate(req.query.from, 'Data inicial');
  const to = queryDate(req.query.to, 'Data final');
  const limit = req.query.limit === undefined ? 200 : Number(req.query.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) fail(400, 'validation', 'Limite inválido (1 a 500).');
  const base = `SELECT ${EXP_COLS}, p.paid_cents, p.payments_count, ${STATE_SQL} AS state FROM expenses e ${PAID}
                WHERE e.professional_id = $1 AND ($3::date IS NULL OR e.expense_date >= $3::date) AND ($4::date IS NULL OR e.expense_date <= $4::date)`;
  const { rows } = await pool.query(
    `SELECT * FROM (${base}) t WHERE ($5::text IS NULL OR t.state = $5) ORDER BY COALESCE(t.due_on, t.expense_date) ASC, t.created_at ASC LIMIT $6`,
    [pid, today, from, to, situacao, limit]);
  const { rows: agg } = await pool.query(
    `SELECT state, count(*)::int AS n, COALESCE(SUM(amount_cents), 0)::float8 AS amount,
            COALESCE(SUM(CASE WHEN payment_status = 'paga' AND payments_count = 0 THEN amount_cents ELSE paid_cents END), 0)::float8 AS paid
       FROM (${base}) t GROUP BY state`, [pid, today, from, to]);
  const totals = Object.fromEntries(EXPENSE_STATES.map((s) => [s, { count: 0, amountCents: 0, paidCents: 0, remainingCents: 0 }]));
  for (const a of agg) {
    totals[a.state] = { count: a.n, amountCents: a.amount, paidCents: a.paid, remainingCents: Math.max(a.amount - a.paid, 0) };
  }
  res.json({ today, despesas: rows.map((r) => expenseDto(r, today)), totais: totals });
});

// ── POST /financeiro/despesas ──────────────────────────────────────────────
// Cadastro ATÔMICO: cria a despesa e já aplica a situação informada (pendente/paga) numa só transação; se qualquer parte falhar, nada é gravado.
export const createDespesa = wrap(async (req, res) => {
  const pid = req.professionalId;
  const data = createDespesaSchema.parse(req.body);
  const expenseDate = parseDateOnly(data.expenseDate);
  if (!expenseDate || expenseDate < '2020-01-01') fail(400, 'invalid_date', 'Data da despesa inválida.');
  const sit = data.situacao;
  const dueOn = sit.to === 'pendente' && sit.dueOn !== undefined
    ? (() => { const c = checkDueDate(sit.dueOn); if (!c.ok) fail(400, 'invalid_date', c.error); return c.value; })() : null;
  const paidOn = sit.to === 'paga' ? checkDate(sit.paidOn) : null;
  const id = await withTransaction(async (client) => {
    await setActor(client, pid);
    const { rows } = await client.query(
      `INSERT INTO expenses (professional_id, description, category, amount_cents, expense_date, notes) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [pid, data.description, resolveCategory(data.category), data.amountCents, expenseDate, data.notes ?? null]);
    const newId = rows[0].id;
    if (sit.to !== 'a_revisar') {
      await advisory(client, newId);
      if (sit.to === 'paga') await client.query(`SELECT set_config('nailflow.audit_reason', $1, true)`, ['Cadastro com pagamento informado']);
      await client.query(`UPDATE expenses SET payment_status = 'pendente', due_on = $3 WHERE id = $1 AND professional_id = $2`, [newId, pid, dueOn]);
      if (sit.to === 'paga') {
        await client.query(
          `INSERT INTO expense_payments (professional_id, expense_id, amount_cents, method, paid_on, notes) VALUES ($1, $2, $3, $4, $5, 'Cadastro com pagamento informado')`,
          [pid, newId, data.amountCents, sit.method, paidOn]);
      }
    }
    return newId;
  });
  res.status(201).json(await detail(pool, id, pid));
});

// ── GET /financeiro/despesas/:id ───────────────────────────────────────────
export const getDespesa = wrap(async (req, res) => {
  const d = await detail(pool, req.params.id, req.professionalId);
  if (!d) fail(404, 'not_found', 'Despesa não encontrada.');
  res.json(d);
});

// ── POST /financeiro/despesas/:id/revisao ──────────────────────────────────
// Revisão MANUAL de uma despesa 'a_revisar': vira 'pendente' (com vencimento opcional) ou 'paga' (data, método e motivo obrigatórios; vira
// um pagamento do valor inteiro). Repetir recebe 409 (not_in_review): a revisão acontece uma vez.
export const reviewDespesa = wrap(async (req, res) => {
  const pid = req.professionalId;
  const id = req.params.id;
  const data = reviewSchema.parse(req.body);
  const dueOn = data.to === 'pendente' && data.dueOn !== undefined
    ? (() => { const c = checkDueDate(data.dueOn); if (!c.ok) fail(400, 'invalid_date', c.error); return c.value; })() : null;
  const paidOn = data.to === 'paga' ? checkDate(data.paidOn) : null;
  await withTransaction(async (client) => {
    await setActor(client, pid);
    const exp = await loadExpense(client, id, pid, { lock: true });
    if (!exp) fail(404, 'not_found', 'Despesa não encontrada.');
    await advisory(client, id);
    if (exp.payment_status !== 'a_revisar') fail(409, 'not_in_review', 'Só uma despesa a revisar pode ser revisada.');
    if (data.reason) await client.query(`SELECT set_config('nailflow.audit_reason', $1, true)`, [data.reason]);
    await client.query(`UPDATE expenses SET payment_status = 'pendente', due_on = $3 WHERE id = $1 AND professional_id = $2`, [id, pid, dueOn]);
    if (data.to === 'paga') {
      await client.query(
        `INSERT INTO expense_payments (professional_id, expense_id, amount_cents, method, paid_on, notes) VALUES ($1, $2, $3, $4, $5, $6)`,
        [pid, id, exp.amount_cents, data.method, paidOn, `Revisão manual: ${data.reason}`.slice(0, 500)]);
    }
  });
  res.json(await detail(pool, id, pid));
});

// ── PUT /financeiro/despesas/:id/vencimento ────────────────────────────────
export const putVencimento = wrap(async (req, res) => {
  const pid = req.professionalId;
  const id = req.params.id;
  const data = dueSchema.parse(req.body);
  const c = checkDueDate(data.dueOn);
  if (!c.ok) fail(400, 'invalid_date', c.error);
  const changed = await withTransaction(async (client) => {
    await setActor(client, pid);
    const exp = await loadExpense(client, id, pid, { lock: true });
    if (!exp) fail(404, 'not_found', 'Despesa não encontrada.');
    if (exp.payment_status !== 'pendente') fail(409, 'not_pending', 'Só é possível alterar o vencimento de uma despesa pendente.');
    if (exp.due_on === c.value) return false;
    await client.query(`SELECT set_config('nailflow.audit_reason', $1, true)`, [data.reason]);
    await client.query(`UPDATE expenses SET due_on = $3 WHERE id = $1 AND professional_id = $2`, [id, pid, c.value]);
    return true;
  });
  res.json({ changed, despesa: await detail(pool, id, pid) });
});

// ── POST /financeiro/despesas/:id/pagamentos ───────────────────────────────
export const payDespesa = wrap(async (req, res) => {
  const pid = req.professionalId;
  const id = req.params.id;
  const key = requireKey(req);
  const data = expensePaymentSchema.parse(req.body);
  const paidOn = checkDate(data.paidOn);
  const notes = data.notes?.trim() || null;
  const hash = requestHash('expense-pay', pid, { expenseId: id, amountCents: data.amountCents, method: data.method, paidOn, notes });
  const findByKey = async (db) => (await db.query(`SELECT ${PAY_COLS} FROM expense_payments WHERE professional_id = $1 AND idempotency_key = $2`, [pid, key])).rows[0] ?? null;

  const out = await withTransaction(async (client) => {
    await setActor(client, pid);
    const exp = await loadExpense(client, id, pid, { lock: true });
    if (!exp) fail(404, 'not_found', 'Despesa não encontrada.');
    await advisory(client, id);
    const existing = await findByKey(client);
    if (existing) {
      if (existing.request_hash !== hash) conflict();
      return { replayed: true, row: existing };
    }
    if (exp.payment_status === 'a_revisar') fail(409, 'needs_review', 'Revise a despesa (pendente ou paga) antes de registrar pagamentos.');
    if (exp.payment_status === 'paga') fail(409, 'already_paid', 'Esta despesa já está paga.');
    const remaining = exp.amount_cents - exp.paid_cents;
    if (data.amountCents > remaining) fail(409, 'exceeds_expense', 'O pagamento ultrapassa o saldo da despesa.', { remainingCents: remaining });
    const { rows } = await client.query(
      `INSERT INTO expense_payments (professional_id, expense_id, amount_cents, method, paid_on, notes, idempotency_key, request_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (professional_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING RETURNING ${PAY_COLS}`,
      [pid, id, data.amountCents, data.method, paidOn, notes, key, hash]);
    if (!rows[0]) {
      const again = await findByKey(client);
      if (again && again.request_hash === hash) return { replayed: true, row: again };
      conflict();
    }
    return { replayed: false, row: rows[0] };
  });
  res.status(out.replayed ? 200 : 201).json({ replayed: out.replayed, pagamento: paymentDto(out.row), despesa: await detail(pool, id, pid) });
});

// ── GET /financeiro/a-receber ──────────────────────────────────────────────
// Atendimentos CONCLUÍDOS: valor (final ou do serviço), recebido líquido (recebimentos - estornos), saldo e vencido. Só leitura.
// "Vencido": saldo > 0 e atendimento concluído há mais de `graceDays` dias (padrão 7; o atendimento não tem data de vencimento própria).
// Sinais Pix antigos (deposit_cents/paid_at) aparecem só como INFORMAÇÃO e nunca entram em recebido.
export const getReceivables = wrap(async (req, res) => {
  const pid = req.professionalId;
  const today = todayInBusinessTz();
  const from = queryDate(req.query.from, 'Data inicial');
  const to = queryDate(req.query.to, 'Data final');
  const graceDays = req.query.graceDays === undefined ? 7 : Number(req.query.graceDays);
  if (!Number.isInteger(graceDays) || graceDays < 0 || graceDays > 365) fail(400, 'validation', 'graceDays inválido (0 a 365).');
  const limit = req.query.limit === undefined ? 200 : Number(req.query.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) fail(400, 'validation', 'Limite inválido (1 a 500).');
  const incluirQuitados = String(req.query.incluirQuitados ?? 'false') === 'true';

  const base = `
    WITH base AS (
      SELECT a.id, a.starts_at, a.ends_at, a.final_price_cents, a.deposit_cents, a.paid_at, c.name AS client_name, s.name AS service_name,
             COALESCE(a.final_price_cents, a.price_cents_snapshot, 0) AS value_cents,
             COALESCE(p.received, 0) AS received, COALESCE(p.refunded, 0) AS refunded, COALESCE(p.n, 0) AS n, COALESCE(p.sinal, false) AS sinal,
             ($2::date - (a.ends_at AT TIME ZONE $3::text)::date) AS days_since
        FROM appointments a
        JOIN clients c ON c.id = a.client_id AND c.professional_id = a.professional_id
        JOIN services s ON s.id = a.service_id AND s.professional_id = a.professional_id
        LEFT JOIN LATERAL (
          SELECT COALESCE(SUM(fp.amount_cents) FILTER (WHERE fp.kind = 'recebimento'), 0)::int AS received,
                 COALESCE(SUM(fp.amount_cents) FILTER (WHERE fp.kind = 'estorno'), 0)::int AS refunded,
                 count(*)::int AS n, bool_or(fp.source = 'sinal_pix_confirmado') AS sinal
            FROM financial_payments fp WHERE fp.appointment_id = a.id AND fp.professional_id = a.professional_id) p ON true
       WHERE a.professional_id = $1 AND a.status = 'concluido'
         AND ($4::date IS NULL OR (a.starts_at AT TIME ZONE $3::text)::date >= $4::date)
         AND ($5::date IS NULL OR (a.starts_at AT TIME ZONE $3::text)::date <= $5::date)
    ), calc AS (
      SELECT *, GREATEST(value_cents - (received - refunded), 0) AS balance FROM base
    )`;
  const params = [pid, today, BUSINESS_TZ, from, to, graceDays];
  const { rows } = await pool.query(
    `${base} SELECT *, (balance > 0 AND days_since > $6) AS overdue FROM calc WHERE ($7::boolean OR balance > 0)
       ORDER BY (balance > 0 AND days_since > $6) DESC, ends_at ASC LIMIT $8`, [...params, incluirQuitados, limit]);
  const { rows: [t] } = await pool.query(
    `${base} SELECT count(*)::int AS appointments, COALESCE(SUM(value_cents), 0)::float8 AS value, COALESCE(SUM(received), 0)::float8 AS received,
            COALESCE(SUM(refunded), 0)::float8 AS refunded,
            COALESCE(SUM(balance) FILTER (WHERE balance > 0 AND days_since <= $6), 0)::float8 AS pending,
            COALESCE(SUM(balance) FILTER (WHERE balance > 0 AND days_since > $6), 0)::float8 AS overdue,
            count(*) FILTER (WHERE balance > 0)::int AS open_count, count(*) FILTER (WHERE balance > 0 AND days_since > $6)::int AS overdue_count FROM calc`, params);
  const items = rows.map((r) => {
    const s = receivableState({ valueCents: r.value_cents, receivedCents: r.received, refundedCents: r.refunded, daysSinceService: r.days_since }, graceDays);
    const hasDeposit = r.deposit_cents != null && r.deposit_cents > 0;
    return {
      appointmentId: r.id, paymentsPath: `/financeiro/atendimentos/${r.id}/pagamentos`,
      clientName: r.client_name, serviceName: r.service_name, startsAt: r.starts_at, endsAt: r.ends_at, daysSinceService: r.days_since,
      valueCents: r.value_cents, valueBasis: r.final_price_cents != null ? 'final' : 'servico',
      receivedCents: r.received, refundedCents: r.refunded, netReceivedCents: s.netCents, balanceCents: s.balanceCents, overdue: s.overdue, quitado: s.quitado,
      movimentacoes: r.n,
      sinalLegado: hasDeposit ? { depositCents: r.deposit_cents, conferido: r.sinal, naoContadoComoRecebido: !r.sinal } : null,
    };
  });
  res.json({
    today, graceDays,
    totais: {
      atendimentos: t.appointments, valorCents: t.value, recebidoLiquidoCents: t.received - t.refunded, recebidoCents: t.received, estornadoCents: t.refunded,
      saldoPendenteCents: t.pending, saldoVencidoCents: t.overdue, emAberto: t.open_count, vencidos: t.overdue_count,
    },
    itens: items,
  });
});
