import { pool } from '../config/db.js';

const VALID_CATEGORIES = [
  'Aluguel', 'Materiais', 'Energia', 'Água', 'Internet',
  'Telefone', 'Marketing', 'Higiene', 'Equipamento', 'Outros',
];

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

export async function createExpense(req, res, next) {
  try {
    const pid = req.professionalId;
    const { description, category, amount_cents, expense_date, notes } = req.body;

    if (!description?.trim()) return res.status(400).json({ error: 'Descrição obrigatória.' });
    if (!amount_cents || amount_cents <= 0) return res.status(400).json({ error: 'Valor inválido.' });
    if (!expense_date) return res.status(400).json({ error: 'Data obrigatória.' });
    const cat = VALID_CATEGORIES.includes(category) ? category : 'Outros';

    const { rows } = await pool.query(
      `INSERT INTO expenses (professional_id, description, category, amount_cents, expense_date, notes)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [pid, description.trim(), cat, amount_cents, expense_date, notes?.trim() || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
}

export async function updateExpense(req, res, next) {
  try {
    const pid = req.professionalId;
    const { id } = req.params;
    const { description, category, amount_cents, expense_date, notes } = req.body;

    if (!description?.trim()) return res.status(400).json({ error: 'Descrição obrigatória.' });
    if (!amount_cents || amount_cents <= 0) return res.status(400).json({ error: 'Valor inválido.' });
    if (!expense_date) return res.status(400).json({ error: 'Data obrigatória.' });
    const cat = VALID_CATEGORIES.includes(category) ? category : 'Outros';

    const { rows } = await pool.query(
      `UPDATE expenses SET description=$1, category=$2, amount_cents=$3, expense_date=$4, notes=$5
       WHERE id=$6 AND professional_id=$7 RETURNING *`,
      [description.trim(), cat, amount_cents, expense_date, notes?.trim() || null, id, pid]
    );
    if (!rows.length) return res.status(404).json({ error: 'Gasto não encontrado.' });
    res.json(rows[0]);
  } catch (err) { next(err); }
}

export async function deleteExpense(req, res, next) {
  try {
    const pid = req.professionalId;
    const { id } = req.params;
    const { rowCount } = await pool.query(
      'DELETE FROM expenses WHERE id=$1 AND professional_id=$2',
      [id, pid]
    );
    if (!rowCount) return res.status(404).json({ error: 'Gasto não encontrado.' });
    res.status(204).end();
  } catch (err) { next(err); }
}

export { VALID_CATEGORIES };
