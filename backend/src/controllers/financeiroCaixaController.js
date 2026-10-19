// Financeiro, etapa 5: fechamento diário de caixa por método, reabertura com motivo, consulta de fechamentos e histórico das movimentações.
// O ESPERADO vem só de movimentações efetivas: recebimentos - estornos (financial_payments, na data em que ocorreram) - despesas efetivamente
// pagas (expense_payments e despesas 'paga' antigas, na data de pagamento). Nada é presumido: atendimento concluído sem recebimento e despesa
// não quitada não entram. O fechamento nunca altera nem apaga movimentação; correções posteriores entram na data em que ocorreram (se o dia
// estiver fechado, a regra da 025 recusa: é preciso reabrir o dia com motivo).
// Concorrência: o fechamento e a reabertura tomam o advisory lock EXCLUSIVO do dia ('fin_day:<prof>:<dia>'); toda movimentação toma o lock
// compartilhado dele em fin_day_is_closed (migration 029). Assim o total congelado inclui tudo que já foi confirmado.
import { z } from 'zod';
import { pool } from '../config/db.js';
import { withTransaction } from './appointmentsController.js';
import { wrap, fail, setActor, checkDate } from './financeiroController.js';
import { PAYMENT_METHODS, parseDateOnly } from '../utils/financeiroPagamentos.js';

const MAX_COUNTED_CENTS = 1_000_000_000;
const counted = z.number({ invalid_type_error: 'Valor contado inválido.', required_error: 'Informe o valor contado de todos os métodos.' })
  .int('O valor contado deve ser em centavos (inteiro).').min(0, 'O valor contado não pode ser negativo.').max(MAX_COUNTED_CENTS, 'Valor acima do limite permitido.');
const closeSchema = z.object({
  counted: z.object(Object.fromEntries(PAYMENT_METHODS.map((m) => [m, counted]))).strict(),
  justification: z.string().trim().max(500, 'Justificativa muito longa.').optional().nullable(),
}).strict();
const reopenSchema = z.object({ reason: z.string().trim().min(3, 'Informe o motivo (mínimo 3 caracteres).').max(500, 'Motivo muito longo.') }).strict();

export async function requireCaixaStructure(req, res, next) {
  try {
    const { rows } = await pool.query(`SELECT to_regclass('public.cash_closing_entries') IS NOT NULL
      AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_cash_closing_entries_guard' AND NOT tgisinternal) AS ok`);
    if (rows[0].ok !== true) return res.status(503).json({ error: 'Fechamento de caixa indisponível: a estrutura do banco (migration 029) não foi aplicada.', reason: 'structure_missing' });
    next();
  } catch (err) { next(err); }
}

const dayLock = (client, pid, day) => client.query('SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))', [`fin_day:${pid}:${day}`]);
const dayParam = (req) => checkDate(req.params.date);

/** Esperado por método no dia: recebido, estornado, despesas pagas (boleto e método ausente contam em 'outra'). */
async function expectedByMethod(db, pid, day) {
  const { rows } = await db.query(
    `WITH rec AS (
       SELECT method, COALESCE(SUM(amount_cents) FILTER (WHERE kind = 'recebimento'), 0)::int AS received,
              COALESCE(SUM(amount_cents) FILTER (WHERE kind = 'estorno'), 0)::int AS refunded
         FROM financial_payments WHERE professional_id = $1 AND occurred_on = $2::date GROUP BY method
     ), exp AS (
       SELECT CASE WHEN method = 'boleto' OR method IS NULL THEN 'outra' ELSE method END AS method, SUM(amount_cents)::int AS paid,
              COALESCE(SUM(amount_cents) FILTER (WHERE method = 'boleto'), 0)::int AS boleto,
              COALESCE(SUM(amount_cents) FILTER (WHERE method IS NULL), 0)::int AS nao_informado
         FROM (SELECT method, amount_cents FROM expense_payments WHERE professional_id = $1 AND paid_on = $2::date
               UNION ALL
               SELECT e.paid_method, e.amount_cents FROM expenses e
                WHERE e.professional_id = $1 AND e.payment_status = 'paga' AND e.paid_on = $2::date
                  AND NOT EXISTS (SELECT 1 FROM expense_payments x WHERE x.expense_id = e.id AND x.professional_id = e.professional_id)) u
        GROUP BY 1
     )
     SELECT m.method, COALESCE(rec.received, 0) AS received, COALESCE(rec.refunded, 0) AS refunded, COALESCE(exp.paid, 0) AS paid,
            COALESCE(exp.boleto, 0) AS boleto, COALESCE(exp.nao_informado, 0) AS nao_informado
       FROM unnest($3::text[]) WITH ORDINALITY AS m(method, ord)
       LEFT JOIN rec ON rec.method = m.method LEFT JOIN exp ON exp.method = m.method ORDER BY m.ord`,
    [pid, day, PAYMENT_METHODS]);
  // Em 'outra' (Outros) entram, além do método "outra", o boleto e o método NÃO informado de despesas pagas antigas; os dois são
  // devolvidos à parte para a tela distingui-los (o método de registros antigos nunca é inventado).
  const metodos = rows.map((r) => ({
    method: r.method, receivedCents: r.received, refundedCents: r.refunded, expensesPaidCents: r.paid, expectedCents: r.received - r.refunded - r.paid,
    ...(r.method === 'outra' ? { expensesPaidBoletoCents: r.boleto, expensesPaidUnknownMethodCents: r.nao_informado } : {}),
  }));
  const sum = (k) => metodos.reduce((a, m) => a + m[k], 0);
  return { metodos, totais: { receivedCents: sum('receivedCents'), refundedCents: sum('refundedCents'), expensesPaidCents: sum('expensesPaidCents'), expectedCents: sum('expectedCents') } };
}

const CLOSING_COLS = `id, to_char(closing_date, 'YYYY-MM-DD') AS closing_date, status, received_cents, refunded_cents, expenses_paid_cents,
  closed_at, reopened_at, reopen_reason, reopen_count`;
const closingDto = (r) => ({
  id: r.id, date: r.closing_date, status: r.status, receivedCents: r.received_cents, refundedCents: r.refunded_cents, expensesPaidCents: r.expenses_paid_cents,
  closedAt: r.closed_at, reopenedAt: r.reopened_at, reopenReason: r.reopen_reason, reopenCount: r.reopen_count,
});
const entryDto = (r) => ({
  method: r.method, expectedCents: r.expected_cents, countedCents: r.counted_cents, differenceCents: r.difference_cents,
  justification: r.justification, closedBy: r.closed_by, createdAt: r.created_at,
});

/** Versões (uma por fechamento) com as linhas por método, da mais antiga para a mais nova. */
async function versionsOf(db, pid, closingIds) {
  if (!closingIds.length) return new Map();
  const { rows } = await db.query(
    `SELECT closing_id, version, method, expected_cents, counted_cents, difference_cents, justification, closed_by, created_at
       FROM cash_closing_entries WHERE professional_id = $1 AND closing_id = ANY($2::uuid[]) ORDER BY closing_id, version, created_at, method`, [pid, closingIds]);
  const out = new Map();
  for (const r of rows) {
    const list = out.get(r.closing_id) ?? [];
    let v = list.find((x) => x.version === r.version);
    if (!v) { v = { version: r.version, closedAt: r.created_at, metodos: [] }; list.push(v); }
    v.metodos.push(entryDto(r));
    out.set(r.closing_id, list);
  }
  return out;
}

// ── GET /financeiro/caixa/:date ────────────────────────────────────────────
export const getCaixaDay = wrap(async (req, res) => {
  const pid = req.professionalId;
  const day = dayParam(req);
  const preview = await expectedByMethod(pool, pid, day);
  const { rows } = await pool.query(`SELECT ${CLOSING_COLS} FROM cash_closings WHERE professional_id = $1 AND closing_date = $2::date`, [pid, day]);
  const closing = rows[0] ? closingDto(rows[0]) : null;
  const versoes = rows[0] ? (await versionsOf(pool, pid, [rows[0].id])).get(rows[0].id) ?? [] : [];
  res.json({
    date: day, fechamento: closing, versoes, esperado: preview,
    movimentosPath: `/financeiro/caixa/${day}/lancamentos`,
  });
});

// ── GET /financeiro/caixa?from&to ──────────────────────────────────────────
export const listCaixa = wrap(async (req, res) => {
  const pid = req.professionalId;
  const opt = (v, n) => { if (v === undefined || v === '') return null; const d = parseDateOnly(String(v)); if (!d) fail(400, 'validation', `${n} inválida. Use AAAA-MM-DD.`); return d; };
  const from = opt(req.query.from, 'Data inicial');
  const to = opt(req.query.to, 'Data final');
  const limit = req.query.limit === undefined ? 60 : Number(req.query.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 366) fail(400, 'validation', 'Limite inválido (1 a 366).');
  const { rows } = await pool.query(
    `SELECT ${CLOSING_COLS} FROM cash_closings WHERE professional_id = $1 AND ($2::date IS NULL OR closing_date >= $2::date) AND ($3::date IS NULL OR closing_date <= $3::date)
      ORDER BY closing_date DESC LIMIT $4`, [pid, from, to, limit]);
  const versions = await versionsOf(pool, pid, rows.map((r) => r.id));
  res.json({
    fechamentos: rows.map((r) => {
      const vs = versions.get(r.id) ?? [];
      return { ...closingDto(r), ultimaVersao: vs.length ? vs[vs.length - 1] : null, versoes: vs.length };
    }),
  });
});

// ── POST /financeiro/caixa/:date/fechamento ────────────────────────────────
export const closeCaixa = wrap(async (req, res) => {
  const pid = req.professionalId;
  const day = dayParam(req);
  const data = closeSchema.parse(req.body);
  const justification = data.justification?.trim() || null;
  const out = await withTransaction(async (client) => {
    await setActor(client, pid);
    await dayLock(client, pid, day);                               // espera movimentações em curso; as seguintes enxergam o dia fechado
    const cur = (await client.query(`SELECT ${CLOSING_COLS} FROM cash_closings WHERE professional_id = $1 AND closing_date = $2::date FOR UPDATE`, [pid, day])).rows[0];
    if (cur?.status === 'fechado') fail(409, 'already_closed', 'Este dia já está fechado. Reabra o caixa com um motivo para fechar de novo.');
    const exp = await expectedByMethod(client, pid, day);
    const lines = exp.metodos.map((m) => ({ ...m, countedCents: data.counted[m.method], differenceCents: data.counted[m.method] - m.expectedCents }));
    const diverge = lines.filter((l) => l.differenceCents !== 0);
    if (diverge.length && (!justification || justification.length < 3)) {
      fail(422, 'justification_required', 'Há diferença entre o esperado e o contado: informe a justificativa (mínimo 3 caracteres).', {
        divergencias: diverge.map((l) => ({ method: l.method, expectedCents: l.expectedCents, countedCents: l.countedCents, differenceCents: l.differenceCents })),
      });
    }
    const t = exp.totais;
    let row;
    if (!cur) {
      row = (await client.query(
        `INSERT INTO cash_closings (professional_id, closing_date, received_cents, refunded_cents, expenses_paid_cents) VALUES ($1, $2::date, $3, $4, $5) RETURNING ${CLOSING_COLS}`,
        [pid, day, t.receivedCents, t.refundedCents, t.expensesPaidCents])).rows[0];
    } else {
      row = (await client.query(
        `UPDATE cash_closings SET status = 'fechado', received_cents = $3, refunded_cents = $4, expenses_paid_cents = $5 WHERE id = $1 AND professional_id = $2 RETURNING ${CLOSING_COLS}`,
        [cur.id, pid, t.receivedCents, t.refundedCents, t.expensesPaidCents])).rows[0];
    }
    for (const l of lines) {
      await client.query(
        `INSERT INTO cash_closing_entries (professional_id, closing_id, version, method, expected_cents, counted_cents, difference_cents, justification, closed_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [pid, row.id, row.reopen_count, l.method, l.expectedCents, l.countedCents, l.differenceCents, l.differenceCents !== 0 ? justification : null, pid]);
    }
    return { row, lines };
  });
  res.status(201).json({
    fechamento: closingDto(out.row),
    metodos: out.lines.map((l) => ({ method: l.method, expectedCents: l.expectedCents, countedCents: l.countedCents, differenceCents: l.differenceCents })),
  });
});

// ── POST /financeiro/caixa/:date/reabertura ────────────────────────────────
export const reopenCaixa = wrap(async (req, res) => {
  const pid = req.professionalId;
  const day = dayParam(req);
  const { reason } = reopenSchema.parse(req.body);
  const row = await withTransaction(async (client) => {
    await setActor(client, pid);
    await dayLock(client, pid, day);
    const cur = (await client.query(`SELECT ${CLOSING_COLS} FROM cash_closings WHERE professional_id = $1 AND closing_date = $2::date FOR UPDATE`, [pid, day])).rows[0];
    if (!cur) fail(404, 'not_found', 'Não há fechamento para este dia.');
    if (cur.status !== 'fechado') fail(409, 'already_open', 'Este dia já está aberto.');
    if (cur.reopen_reason && cur.reopen_reason.trim() === reason) fail(400, 'reason_repeated', 'Informe um motivo diferente do da reabertura anterior.');
    return (await client.query(
      `UPDATE cash_closings SET status = 'aberto', reopen_reason = $3 WHERE id = $1 AND professional_id = $2 RETURNING ${CLOSING_COLS}`, [cur.id, pid, reason])).rows[0];
  });
  res.json({ fechamento: closingDto(row) });
});

// ── GET /financeiro/caixa/:date/lancamentos ────────────────────────────────
export const getCaixaMovements = wrap(async (req, res) => {
  const pid = req.professionalId;
  const day = dayParam(req);
  const pay = await pool.query(
    `SELECT fp.id, fp.appointment_id, fp.kind, fp.method, fp.amount_cents, fp.source, fp.reverses_payment_id, fp.notes, fp.created_at, c.name AS client_name
       FROM financial_payments fp JOIN appointments a ON a.id = fp.appointment_id AND a.professional_id = fp.professional_id
       JOIN clients c ON c.id = a.client_id AND c.professional_id = a.professional_id
      WHERE fp.professional_id = $1 AND fp.occurred_on = $2::date ORDER BY fp.created_at, fp.id`, [pid, day]);
  const ep = await pool.query(
    `SELECT x.id, x.expense_id, x.method, x.amount_cents, x.notes, x.created_at, e.description
       FROM expense_payments x JOIN expenses e ON e.id = x.expense_id AND e.professional_id = x.professional_id
      WHERE x.professional_id = $1 AND x.paid_on = $2::date ORDER BY x.created_at, x.id`, [pid, day]);
  const legacy = await pool.query(
    `SELECT e.id, e.description, e.amount_cents, COALESCE(e.paid_method, 'outra') AS method, e.paid_method AS original_method FROM expenses e
      WHERE e.professional_id = $1 AND e.payment_status = 'paga' AND e.paid_on = $2::date
        AND NOT EXISTS (SELECT 1 FROM expense_payments x WHERE x.expense_id = e.id AND x.professional_id = e.professional_id) ORDER BY e.created_at, e.id`, [pid, day]);
  res.json({
    date: day,
    recebimentos: pay.rows.map((r) => ({
      id: r.id, appointmentId: r.appointment_id, clientName: r.client_name, kind: r.kind, method: r.method, amountCents: r.amount_cents, source: r.source,
      reversesPaymentId: r.reverses_payment_id, notes: r.notes, createdAt: r.created_at,
      historicoPath: `/financeiro/historico/payment/${r.id}`, atendimentoPath: `/financeiro/atendimentos/${r.appointment_id}/pagamentos`,
    })),
    pagamentosDespesa: ep.rows.map((r) => ({
      id: r.id, expenseId: r.expense_id, description: r.description, method: r.method, amountCents: r.amount_cents, notes: r.notes, createdAt: r.created_at,
      historicoPath: `/financeiro/historico/expense_payment/${r.id}`, despesaPath: `/financeiro/despesas/${r.expense_id}`,
    })),
    despesasPagasAntigas: legacy.rows.map((r) => ({
      expenseId: r.id, description: r.description, method: r.method, originalMethod: r.original_method, methodInformed: r.original_method != null, amountCents: r.amount_cents,
      historicoPath: `/financeiro/historico/expense/${r.id}`, despesaPath: `/financeiro/despesas/${r.id}`,
    })),
  });
});

// ── GET /financeiro/movimentacoes?from&to[&tipo&metodo&limit] ───────────────
// Lista só leitura das movimentações efetivas do período (recebimentos, estornos e pagamentos de despesa), mais os totais do período
// inteiro (independentes do limite). Despesas 'paga' antigas sem lançamentos entram com o método original (pode ser nulo = não informado).
const MOV_TYPES = ['recebimento', 'estorno', 'despesa'];
const MOV_METHODS = [...PAYMENT_METHODS, 'boleto', 'nao_informado'];
export const listMovimentacoes = wrap(async (req, res) => {
  const pid = req.professionalId;
  const from = req.query.from ? parseDateOnly(String(req.query.from)) : null;
  const to = req.query.to ? parseDateOnly(String(req.query.to)) : null;
  if (!from || !to) fail(400, 'validation', 'Informe o período (from e to, AAAA-MM-DD).');
  if (from > to) fail(400, 'validation', 'A data inicial não pode ser posterior à final.');
  if ((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 > 366) fail(400, 'validation', 'Período máximo de 366 dias.');
  const tipo = req.query.tipo ? String(req.query.tipo) : null;
  if (tipo && !MOV_TYPES.includes(tipo)) fail(400, 'validation', `Tipo inválido (${MOV_TYPES.join(', ')}).`);
  const metodo = req.query.metodo ? String(req.query.metodo) : null;
  if (metodo && !MOV_METHODS.includes(metodo)) fail(400, 'validation', 'Método inválido.');
  const limit = req.query.limit === undefined ? 200 : Number(req.query.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) fail(400, 'validation', 'Limite inválido (1 a 500).');
  const cte = `
    WITH mv AS (
      SELECT fp.id, fp.kind AS tipo, to_char(fp.occurred_on, 'YYYY-MM-DD') AS day, fp.method AS method, fp.amount_cents, fp.appointment_id, NULL::uuid AS expense_id,
             c.name AS label, fp.notes, fp.created_at, a.starts_at, fp.reverses_payment_id
        FROM financial_payments fp JOIN appointments a ON a.id = fp.appointment_id AND a.professional_id = fp.professional_id
        JOIN clients c ON c.id = a.client_id AND c.professional_id = a.professional_id
       WHERE fp.professional_id = $1 AND fp.occurred_on BETWEEN $2::date AND $3::date
      UNION ALL
      SELECT x.id, 'despesa', to_char(x.paid_on, 'YYYY-MM-DD'), x.method, x.amount_cents, NULL, x.expense_id, e.description, x.notes, x.created_at, NULL, NULL
        FROM expense_payments x JOIN expenses e ON e.id = x.expense_id AND e.professional_id = x.professional_id
       WHERE x.professional_id = $1 AND x.paid_on BETWEEN $2::date AND $3::date
      UNION ALL
      SELECT e.id, 'despesa', to_char(e.paid_on, 'YYYY-MM-DD'), e.paid_method, e.amount_cents, NULL, e.id, e.description, e.notes, e.created_at, NULL, NULL
        FROM expenses e WHERE e.professional_id = $1 AND e.payment_status = 'paga' AND e.paid_on BETWEEN $2::date AND $3::date
         AND NOT EXISTS (SELECT 1 FROM expense_payments x WHERE x.expense_id = e.id AND x.professional_id = e.professional_id)
    ), f AS (
      SELECT * FROM mv WHERE ($4::text IS NULL OR tipo = $4) AND ($5::text IS NULL OR COALESCE(method, 'nao_informado') = $5)
    )`;
  const params = [pid, from, to, tipo, metodo];
  const { rows } = await pool.query(`${cte} SELECT * FROM f ORDER BY day DESC, created_at DESC, id LIMIT $6`, [...params, limit]);
  const { rows: [t] } = await pool.query(
    `${cte} SELECT count(*)::int AS n, COALESCE(SUM(amount_cents) FILTER (WHERE tipo = 'recebimento'), 0)::float8 AS rec,
            COALESCE(SUM(amount_cents) FILTER (WHERE tipo = 'estorno'), 0)::float8 AS est, COALESCE(SUM(amount_cents) FILTER (WHERE tipo = 'despesa'), 0)::float8 AS dep FROM f`, params);
  res.json({
    from, to, truncated: t.n > rows.length,
    totais: { quantidade: t.n, recebidoCents: t.rec, estornadoCents: t.est, despesasPagasCents: t.dep, saldoCents: t.rec - t.est - t.dep },
    itens: rows.map((r) => {
      const isPay = r.tipo === 'recebimento' || r.tipo === 'estorno';
      return {
        id: r.id, tipo: r.tipo, date: r.day, method: r.method, methodInformed: r.method != null, amountCents: r.amount_cents, label: r.label, notes: r.notes,
        createdAt: r.created_at, appointmentId: r.appointment_id, appointmentStartsAt: r.starts_at, expenseId: r.expense_id, reversesPaymentId: r.reverses_payment_id,
        historicoPath: isPay ? `/financeiro/historico/payment/${r.id}` : `/financeiro/historico/${r.id === r.expense_id ? 'expense' : 'expense_payment'}/${r.id}`,
      };
    }),
  });
});

// ── GET /financeiro/historico/:tipo/:id ────────────────────────────────────
const HISTORY_TYPES = ['payment', 'expense', 'expense_payment', 'cash_closing', 'appointment'];
export const getHistory = wrap(async (req, res) => {
  const tipo = req.params.tipo;
  if (!HISTORY_TYPES.includes(tipo)) fail(400, 'validation', `Tipo inválido (${HISTORY_TYPES.join(', ')}).`);
  const { rows } = await pool.query(
    `SELECT seq, action, actor_id, reason, before_data, after_data, created_at FROM financial_audit_log
      WHERE professional_id = $1 AND entity_type = $2 AND entity_id = $3 ORDER BY seq`, [req.professionalId, tipo, req.params.id]);
  res.json({
    tipo, id: req.params.id,
    historico: rows.map((r) => ({ seq: Number(r.seq), action: r.action, actorId: r.actor_id, reason: r.reason, before: r.before_data, after: r.after_data, createdAt: r.created_at })),
  });
});
