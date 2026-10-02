import { z } from 'zod';
import { pool } from '../config/db.js';
import { HttpError } from '../middleware/errorHandler.js';

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
    res.json(rows);
  } catch (err) { next(err); }
}

export async function getExpenseSummary(req, res, next) {
  try {
    const { from, to } = req.query;
    if (!from || !to) return next(new HttpError(400, 'Parâmetros from e to são obrigatórios.'));
    const pid = req.professionalId;

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
    res.status(201).json(rows[0]);
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
    res.json(rows[0]);
  } catch (err) {
    if (err instanceof z.ZodError) return next(new HttpError(400, err.errors[0]?.message ?? 'Dados inválidos.'));
    next(err);
  }
}

export async function deleteExpense(req, res, next) {
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM expenses WHERE id=$1 AND professional_id=$2',
      [req.params.id, req.professionalId]
    );
    if (!rowCount) return next(new HttpError(404, 'Gasto não encontrado.'));
    res.status(204).end();
  } catch (err) { next(err); }
}

export { VALID_CATEGORIES };
