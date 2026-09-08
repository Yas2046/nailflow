import { z } from 'zod';
import { pool } from '../config/db.js';
import { getAvailableSlots, checkSlotAvailability } from '../utils/availability.js';
import { parseZonedDateTime } from '../utils/timezone.js';
import { HttpError } from '../middleware/errorHandler.js';

export async function getWeeklyAvailability(req, res, next) {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM weekly_availability WHERE professional_id = $1 ORDER BY weekday ASC',
      [req.professionalId]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
}

const dayInput = z.object({
  weekday: z.number().int().min(0).max(6),
  isWorking: z.boolean(),
  startTime: z.string().nullable().optional(),
  endTime: z.string().nullable().optional(),
  breakStart: z.string().nullable().optional(),
  breakEnd: z.string().nullable().optional(),
});
const updateSchema = z.array(dayInput);

// PUT /availability — recebe os 7 dias de uma vez e faz upsert
export async function updateWeeklyAvailability(req, res, next) {
  try {
    const days = updateSchema.parse(req.body);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const day of days) {
        await client.query(
          `INSERT INTO weekly_availability (professional_id, weekday, is_working, start_time, end_time, break_start, break_end)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           ON CONFLICT (professional_id, weekday) DO UPDATE SET
             is_working = EXCLUDED.is_working,
             start_time = EXCLUDED.start_time,
             end_time = EXCLUDED.end_time,
             break_start = EXCLUDED.break_start,
             break_end = EXCLUDED.break_end`,
          [req.professionalId, day.weekday, day.isWorking, day.startTime, day.endTime, day.breakStart, day.breakEnd]
        );
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    res.status(204).end();
  } catch (err) {
    if (err instanceof z.ZodError) return next(new HttpError(400, 'Dados de disponibilidade inválidos.'));
    next(err);
  }
}

export async function listBlockedTimes(req, res, next) {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM blocked_times WHERE professional_id = $1 ORDER BY starts_at DESC',
      [req.professionalId]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
}

const blockSchema = z.object({
  startsAt: z.string().min(1),
  endsAt: z.string().min(1),
  reason: z.string().optional().nullable(),
});

export async function createBlockedTime(req, res, next) {
  try {
    const data = blockSchema.parse(req.body);
    const { rows } = await pool.query(
      `INSERT INTO blocked_times (professional_id, starts_at, ends_at, reason) VALUES ($1,$2,$3,$4) RETURNING *`,
      [req.professionalId, data.startsAt, data.endsAt, data.reason ?? null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err instanceof z.ZodError) return next(new HttpError(400, 'Dados de bloqueio inválidos.'));
    next(err);
  }
}

export async function deleteBlockedTime(req, res, next) {
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM blocked_times WHERE id = $1 AND professional_id = $2',
      [req.params.id, req.professionalId]
    );
    if (!rowCount) throw new HttpError(404, 'Bloqueio não encontrado.');
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}

// GET /availability/slots?date=YYYY-MM-DD&serviceId=uuid  (uso interno, autenticado)
export async function getSlots(req, res, next) {
  try {
    const { date, serviceId } = req.query;
    if (!date || !serviceId) throw new HttpError(400, 'Informe date e serviceId.');

    const { rows: serviceRows } = await pool.query(
      'SELECT duration_minutes FROM services WHERE id = $1 AND professional_id = $2',
      [serviceId, req.professionalId]
    );
    if (!serviceRows[0]) throw new HttpError(400, 'Serviço inválido.');

    const slots = await getAvailableSlots(req.professionalId, parseZonedDateTime(`${date}T00:00:00`), serviceRows[0].duration_minutes);
    res.json(slots);
  } catch (err) {
    next(err);
  }
}

// GET /availability/check?serviceId=uuid&startsAt=ISO
// Verifica um horário EXATO (não precisa ser múltiplo de 30 min), considerando
// expediente, almoço, bloqueios e outros agendamentos. Ver utils/availability.js
// (checkSlotAvailability) para a lista de motivos de indisponibilidade.
export async function checkAvailability(req, res, next) {
  try {
    const { serviceId, startsAt } = req.query;
    if (!serviceId || !startsAt) throw new HttpError(400, 'Informe serviceId e startsAt.');

    const result = await checkSlotAvailability(req.professionalId, serviceId, startsAt);
    res.json(result);
  } catch (err) {
    next(err);
  }
}
