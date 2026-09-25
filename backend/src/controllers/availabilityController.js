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
    const { from, to } = req.query;
    const params = [req.professionalId];
    let where = 'WHERE professional_id = $1';
    if (from) { params.push(from); where += ` AND ends_at >= $${params.length}`; }
    if (to)   { params.push(to);   where += ` AND starts_at <= $${params.length}`; }
    const { rows } = await pool.query(
      `SELECT * FROM blocked_times ${where} ORDER BY starts_at ASC`,
      params
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

// GET /availability/horizon — retorna a antecedência máxima configurada
export async function getHorizon(req, res, next) {
  try {
    const { rows } = await pool.query(
      'SELECT booking_horizon_days FROM professionals WHERE id = $1',
      [req.professionalId]
    );
    res.json({ bookingHorizonDays: rows[0]?.booking_horizon_days ?? 60 });
  } catch (err) {
    next(err);
  }
}

const horizonSchema = z.object({
  bookingHorizonDays: z.number().int().min(7).max(365),
});

// PUT /availability/horizon — atualiza a antecedência máxima
export async function updateHorizon(req, res, next) {
  try {
    const { bookingHorizonDays } = horizonSchema.parse(req.body);
    await pool.query(
      'UPDATE professionals SET booking_horizon_days = $1 WHERE id = $2',
      [bookingHorizonDays, req.professionalId]
    );
    res.json({ bookingHorizonDays });
  } catch (err) {
    if (err instanceof z.ZodError) return next(new HttpError(400, 'Valor inválido. Informe entre 7 e 365 dias.'));
    next(err);
  }
}

const EXCEPTION_SELECT = `
  id, exception_type, weekday, week_of_month, label,
  TO_CHAR(specific_date, 'YYYY-MM-DD') AS specific_date,
  TO_CHAR(date_from, 'YYYY-MM-DD') AS date_from,
  TO_CHAR(date_to, 'YYYY-MM-DD') AS date_to
`;

// GET /availability/exceptions
export async function listExceptions(req, res, next) {
  try {
    const { rows } = await pool.query(
      `SELECT ${EXCEPTION_SELECT} FROM recurring_exceptions WHERE professional_id = $1 ORDER BY created_at ASC`,
      [req.professionalId]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const exceptionSchema = z.discriminatedUnion('exceptionType', [
  z.object({
    exceptionType: z.literal('specific_date'),
    specificDate: z.string().regex(DATE_RE, 'Data inválida (YYYY-MM-DD).'),
    label: z.string().max(100).optional().nullable(),
  }),
  z.object({
    exceptionType: z.literal('weekday_of_month'),
    weekday: z.number().int().min(0).max(6),
    weekOfMonth: z.number().int().refine((v) => [-1,1,2,3,4,5].includes(v), 'Ocorrência inválida.'),
    label: z.string().max(100).optional().nullable(),
  }),
  z.object({
    exceptionType: z.literal('date_range'),
    dateFrom: z.string().regex(DATE_RE, 'Data inicial inválida.'),
    dateTo: z.string().regex(DATE_RE, 'Data final inválida.'),
    label: z.string().max(100).optional().nullable(),
  }),
]);

// POST /availability/exceptions
export async function createException(req, res, next) {
  try {
    const data = exceptionSchema.parse(req.body);
    let rows;
    if (data.exceptionType === 'specific_date') {
      ({ rows } = await pool.query(
        `INSERT INTO recurring_exceptions (professional_id, exception_type, specific_date, label)
         VALUES ($1, 'specific_date', $2, $3) RETURNING ${EXCEPTION_SELECT}`,
        [req.professionalId, data.specificDate, data.label ?? null]
      ));
    } else if (data.exceptionType === 'weekday_of_month') {
      ({ rows } = await pool.query(
        `INSERT INTO recurring_exceptions (professional_id, exception_type, weekday, week_of_month, label)
         VALUES ($1, 'weekday_of_month', $2, $3, $4) RETURNING ${EXCEPTION_SELECT}`,
        [req.professionalId, data.weekday, data.weekOfMonth, data.label ?? null]
      ));
    } else {
      if (data.dateTo < data.dateFrom) {
        return next(new HttpError(400, 'A data final deve ser igual ou posterior à inicial.'));
      }
      ({ rows } = await pool.query(
        `INSERT INTO recurring_exceptions (professional_id, exception_type, date_from, date_to, label)
         VALUES ($1, 'date_range', $2, $3, $4) RETURNING ${EXCEPTION_SELECT}`,
        [req.professionalId, data.dateFrom, data.dateTo, data.label ?? null]
      ));
    }
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err instanceof z.ZodError) return next(new HttpError(400, err.errors[0]?.message ?? 'Dados inválidos.'));
    next(err);
  }
}

// DELETE /availability/exceptions/:id
export async function deleteException(req, res, next) {
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM recurring_exceptions WHERE id = $1 AND professional_id = $2',
      [req.params.id, req.professionalId]
    );
    if (!rowCount) throw new HttpError(404, 'Exceção não encontrada.');
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}
