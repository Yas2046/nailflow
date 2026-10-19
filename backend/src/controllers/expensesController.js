import { z } from 'zod';
import { pool } from '../config/db.js';
import { HttpError } from '../middleware/errorHandler.js';
import { financeiroReady, periodSums } from '../utils/financeiroRelatorios.js';
import { parseDateOnly } from '../utils/financeiroPagamentos.js';

const VALID_CATEGORIES = [
  'Aluguel', 'Materiais', 'Energia', 'Água', 'Internet',
  'Telefone', 'Marketing', 'Higiene', 'Equipamento', 'Outros',
];

const expenseSchema = z.object({
  description:  z.string().min(1, 'Descrição obrigatória.').max(200, 'Descrição muito longa.'),
  category:     z.string().optional(),
  amount_cents: z.number().int().positive('Valor inválido.'),
  expense_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida.'),
  notes:        z.string().max(1000).nullable().optional(),
});

// node-postgres devolve DATE como Date (meia-noite no fuso do servidor) e o JSON o vira "…T22:00:00.000Z", que as telas não leem como
// data. Devolve "AAAA-MM-DD" (a data civil original) em expense_date, due_on e paid_on.
const ymd = (d) => (d instanceof Date ? `${String(d.getFullYear()).padStart(4, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : d);
const fixDates = (r) => (r ? { ...r, expense_date: ymd(r.expense_date), ...('due_on' in r ? { due_on: ymd(r.due_on) } : {}), ...('paid_on' in r ? { paid_on: ymd(r.paid_on) } : {}) } : r);

function resolveCategory(raw) {
  return VALID_CATEGORIES.includes(raw) ? raw : 'Outros';
}

export async function listExpenses(req, res, next) {
  try {
    const { from, to } = req.query;
    const pid = req.professionalId;
    let query = 'SELECT * FROM expenses WHERE professional_id = $1';
    const params = [pid];
    if (from) { query += ` AND expense_date >= $${params.length + 1}`; params.push(from); }
    if (to)   { query += ` AND expense_date <= $${params.length + 1}`; params.push(to); }
    query += ' ORDER BY expense_date DESC, created_at DESC';
    const { rows } = await pool.query(query, params);
    res.json(rows.map(fixDates));
  } catch (err) { next(err); }
}

export async function getExpenseSummary(req, res, next) {
  try {
    const { from, to } = req.query;
    if (!from || !to) return next(new HttpError(400, 'Parâmetros from e to são obrigatórios.'));
    const pid = req.professionalId;

    // Com o Financeiro ligado: recebido líquido e despesas efetivamente pagas no período (os mesmos números do Financeiro e do Dashboard).
    if (await financeiroReady(pool)) {
      const f = parseDateOnly(String(from));
      const t = parseDateOnly(String(to));
      if (!f || !t || f > t) return next(new HttpError(400, 'Período inválido.'));
      const sums = await periodSums(pool, pid, f, t);
      return res.json({
        base: 'recebimentos',
        gastosCents: sums.totais.expensesPaidCents,
        faturadoCents: sums.totais.netReceivedCents,
        resultadoCents: sums.totais.saldoCents,
        categorias: sums.despesasPagasPorCategoria.map((c) => ({ category: c.category, totalCents: c.paidCents, count: c.count })),
      });
    }

    const [totalResult, byCategoryResult, faturadoResult] = await Promise.all([
      pool.query(
        `SELECT COALESCE(SUM(amount_cents), 0)::int AS total_cents
         FROM expenses WHERE professional_id = $1 AND expense_date >= $2 AND expense_date <= $3`,
        [pid, from, to]
      ),
      pool.query(
        `SELECT category,
                COALESCE(SUM(amount_cents), 0)::int AS total_cents,
                COUNT(*)::int AS count
         FROM expenses WHERE professional_id = $1 AND expense_date >= $2 AND expense_date <= $3
         GROUP BY category ORDER BY total_cents DESC`,
        [pid, from, to]
      ),
      pool.query(
        `SELECT COALESCE(SUM(price_cents_snapshot), 0)::int AS total_cents
         FROM appointments
         WHERE professional_id = $1 AND status = 'concluido'
           AND (starts_at AT TIME ZONE 'America/Sao_Paulo')::date >= $2::date
           AND (starts_at AT TIME ZONE 'America/Sao_Paulo')::date <= $3::date`,
        [pid, from, to]
      ),
    ]);

    const gastosCents   = totalResult.rows[0]?.total_cents ?? 0;
    const faturadoCents = faturadoResult.rows[0]?.total_cents ?? 0;

    res.json({
      gastosCents,
      faturadoCents,
      resultadoCents: faturadoCents - gastosCents,
      categorias: byCategoryResult.rows.map((r) => ({
        category:   r.category,
        totalCents: r.total_cents,
        count:      r.count,
      })),
    });
  } catch (err) { next(err); }
}

export async function createExpense(req, res, next) {
  try {
    const data = expenseSchema.parse(req.body);
    const cat  = resolveCategory(data.category);
    const { rows } = await pool.query(
      `INSERT INTO expenses (professional_id, description, category, amount_cents, expense_date, notes)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [req.professionalId, data.description.trim(), cat, data.amount_cents, data.expense_date, data.notes ?? null]
    );
    res.status(201).json(fixDates(rows[0]));
  } catch (err) {
    if (err instanceof z.ZodError) return next(new HttpError(400, err.errors[0]?.message ?? 'Dados inválidos.'));
    next(err);
  }
}

export async function updateExpense(req, res, next) {
  try {
    const data = expenseSchema.parse(req.body);
    const cat  = resolveCategory(data.category);
    const { rows } = await pool.query(
      `UPDATE expenses SET description=$1, category=$2, amount_cents=$3, expense_date=$4, notes=$5
       WHERE id=$6 AND professional_id=$7 RETURNING *`,
      [data.description.trim(), cat, data.amount_cents, data.expense_date, data.notes ?? null, req.params.id, req.professionalId]
    );
    if (!rows.length) return next(new HttpError(404, 'Gasto não encontrado.'));
    res.json(fixDates(rows[0]));
  } catch (err) {
    if (err instanceof z.ZodError) return next(new HttpError(400, err.errors[0]?.message ?? 'Dados inválidos.'));
    if (err?.code === '23514' && /abaixo do já pago/.test(err.message)) return next(new HttpError(409, 'O valor da despesa não pode ficar abaixo do já pago.'));
    if (err?.code === '23514' && /fechado/.test(err.message)) return next(new HttpError(409, 'O dia deste gasto está fechado no caixa.'));
    next(err);
  }
}

export async function deleteExpense(req, res, next) {
  try {
    // Movimentação realizada não se apaga em silêncio: despesa paga ou com pagamentos registrados é preservada (histórico).
    // Só vale com a migration 028 aplicada; sem ela, o comportamento é o de antes.
    const has028 = (await pool.query(`SELECT to_regclass('public.expense_payments') IS NOT NULL AS ok`)).rows[0].ok;
    const found = has028 ? await pool.query(
      `SELECT e.payment_status, EXISTS (SELECT 1 FROM expense_payments x WHERE x.expense_id = e.id AND x.professional_id = e.professional_id) AS has_payments
         FROM expenses e WHERE e.id=$1 AND e.professional_id=$2`,
      [req.params.id, req.professionalId]
    ) : { rows: [] };
    if (found.rows[0] && (found.rows[0].payment_status === 'paga' || found.rows[0].has_payments)) {
      return next(new HttpError(409, 'Despesa com pagamento registrado não pode ser excluída.'));
    }
    const { rowCount } = await pool.query(
      'DELETE FROM expenses WHERE id=$1 AND professional_id=$2',
      [req.params.id, req.professionalId]
    );
    if (!rowCount) return next(new HttpError(404, 'Gasto não encontrado.'));
    res.status(204).end();
  } catch (err) {
    if (err?.code === '23503') return next(new HttpError(409, 'Despesa com pagamento registrado não pode ser excluída.'));
    if (err?.code === '23514' && /fechado/.test(err.message)) return next(new HttpError(409, 'O dia deste gasto está fechado no caixa.'));
    next(err);
  }
}

export { VALID_CATEGORIES };
