import { z } from 'zod';
import { pool } from '../config/db.js';
import { HttpError } from '../middleware/errorHandler.js';

const clientSchema = z.object({
  name: z.string().min(1),
  phone: z.string().min(8),
  notes: z.string().optional().nullable(),
});

export async function listClients(req, res, next) {
  try {
    const { rows } = await pool.query(
      `SELECT c.*,
              COUNT(a.id) FILTER (WHERE a.status = 'concluido') AS total_atendimentos,
              MAX(a.starts_at) FILTER (WHERE a.status = 'concluido') AS ultimo_atendimento
       FROM clients c
       LEFT JOIN appointments a ON a.client_id = c.id
       WHERE c.professional_id = $1
       GROUP BY c.id
       ORDER BY c.name ASC`,
      [req.professionalId]
    );
    res.json(
      rows.map((r) => ({
        id: r.id,
        name: r.name,
        phone: r.phone,
        notes: r.notes,
        totalAtendimentos: Number(r.total_atendimentos),
        ultimoAtendimento: r.ultimo_atendimento,
      }))
    );
  } catch (err) {
    next(err);
  }
}

export async function getClientHistory(req, res, next) {
  try {
    const { rows: clientRows } = await pool.query(
      'SELECT * FROM clients WHERE id = $1 AND professional_id = $2',
      [req.params.id, req.professionalId]
    );
    if (!clientRows[0]) throw new HttpError(404, 'Cliente não encontrada.');

    const { rows: history } = await pool.query(
      `SELECT a.id, a.starts_at, a.ends_at, a.status, s.name AS service_name
       FROM appointments a JOIN services s ON s.id = a.service_id
       WHERE a.client_id = $1 ORDER BY a.starts_at DESC`,
      [req.params.id]
    );
    res.json({ client: clientRows[0], history });
  } catch (err) {
    next(err);
  }
}

export async function createClient(req, res, next) {
  try {
    const data = clientSchema.parse(req.body);
    const { rows } = await pool.query(
      `INSERT INTO clients (professional_id, name, phone, notes) VALUES ($1,$2,$3,$4) RETURNING *`,
      [req.professionalId, data.name, data.phone, data.notes ?? null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err instanceof z.ZodError) return next(new HttpError(400, 'Dados de cliente inválidos.'));
    next(err);
  }
}

export async function updateClient(req, res, next) {
  try {
    const data = clientSchema.partial().parse(req.body);
    const notesInBody = 'notes' in req.body;
    const { rows } = await pool.query(
      `UPDATE clients SET
         name  = COALESCE($1, name),
         phone = COALESCE($2, phone),
         notes = CASE WHEN $3 THEN $4 ELSE notes END
       WHERE id = $5 AND professional_id = $6 RETURNING *`,
      [data.name, data.phone, notesInBody, data.notes ?? null, req.params.id, req.professionalId]
    );
    if (!rows[0]) throw new HttpError(404, 'Cliente não encontrada.');
    res.json(rows[0]);
  } catch (err) {
    if (err instanceof z.ZodError) return next(new HttpError(400, 'Dados de cliente inválidos.'));
    next(err);
  }
}
