import { z } from 'zod';
import { pool } from '../config/db.js';
import { HttpError } from '../middleware/errorHandler.js';

const serviceSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  priceCents: z.number().int().nonnegative(),
  durationMinutes: z.number().int().positive(),
  active: z.boolean().optional(),
});

function toDto(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    priceCents: row.price_cents,
    durationMinutes: row.duration_minutes,
    active: row.active,
  };
}

export async function listServices(req, res, next) {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM services WHERE professional_id = $1 ORDER BY active DESC, name ASC',
      [req.professionalId]
    );
    res.json(rows.map(toDto));
  } catch (err) {
    next(err);
  }
}

export async function createService(req, res, next) {
  try {
    const data = serviceSchema.parse(req.body);
    const { rows } = await pool.query(
      `INSERT INTO services (professional_id, name, description, price_cents, duration_minutes, active)
       VALUES ($1,$2,$3,$4,$5,COALESCE($6, true)) RETURNING *`,
      [req.professionalId, data.name, data.description ?? null, data.priceCents, data.durationMinutes, data.active]
    );
    res.status(201).json(toDto(rows[0]));
  } catch (err) {
    if (err instanceof z.ZodError) return next(new HttpError(400, 'Dados de serviço inválidos.'));
    next(err);
  }
}

export async function updateService(req, res, next) {
  try {
    const data = serviceSchema.partial().parse(req.body);
    const descriptionInBody = 'description' in req.body;
    const { rows } = await pool.query(
      `UPDATE services SET
         name             = COALESCE($1, name),
         description      = CASE WHEN $2 THEN $3 ELSE description END,
         price_cents      = COALESCE($4, price_cents),
         duration_minutes = COALESCE($5, duration_minutes),
         active           = COALESCE($6, active)
       WHERE id = $7 AND professional_id = $8 RETURNING *`,
      [data.name, descriptionInBody, data.description ?? null, data.priceCents, data.durationMinutes, data.active, req.params.id, req.professionalId]
    );
    if (!rows[0]) throw new HttpError(404, 'Serviço não encontrado.');
    res.json(toDto(rows[0]));
  } catch (err) {
    if (err instanceof z.ZodError) return next(new HttpError(400, 'Dados de serviço inválidos.'));
    next(err);
  }
}

export async function deleteService(req, res, next) {
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM services WHERE id = $1 AND professional_id = $2',
      [req.params.id, req.professionalId]
    );
    if (!rowCount) throw new HttpError(404, 'Serviço não encontrado.');
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}
