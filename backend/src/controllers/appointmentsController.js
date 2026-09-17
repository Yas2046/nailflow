import { z } from 'zod';
import { pool } from '../config/db.js';
import { HttpError } from '../middleware/errorHandler.js';
import { notifyN8n } from '../utils/notifyN8n.js';
import { checkSlotAvailability, getAvailableSlots } from '../utils/availability.js';

const createSchema = z.object({
  clientId: z.string().uuid(),
  serviceId: z.string().uuid(),
  startsAt: z.string().datetime({ offset: true }).or(z.string().min(1)), // ISO string
  notes: z.string().optional().nullable(),
  status: z.enum(['pendente', 'confirmado', 'cancelado', 'concluido', 'nao_compareceu']).optional(),
});

const updateSchema = createSchema.partial();

const createRecurringSchema = z.object({
  clientId: z.string().uuid(),
  serviceId: z.string().uuid(),
  startsAt: z.string().min(1),
  frequency: z.enum(['weekly', 'biweekly']),
  endsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), // YYYY-MM-DD
  notes: z.string().optional().nullable(),
});

function toDto(row) {
  return {
    id: row.id,
    clientId: row.client_id,
    clientName: row.client_name,
    clientPhone: row.client_phone,
    serviceId: row.service_id,
    serviceName: row.service_name,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    status: row.status,
    notes: row.notes,
    priceCentsSnapshot: row.price_cents_snapshot,
    recurringGroupId: row.recurring_group_id ?? null,
  };
}

const SELECT_BASE = `
  SELECT a.*, c.name AS client_name, c.phone AS client_phone, s.name AS service_name
  FROM appointments a
  JOIN clients c ON c.id = a.client_id
  JOIN services s ON s.id = a.service_id
`;

// Retorna até 6 slots disponíveis no mesmo dia, ordenados por proximidade ao
// horário solicitado. Usado para popular o campo `alternatives` da resposta 409.
// Se qualquer coisa falhar, retorna [] silenciosamente — nunca deve quebrar a
// resposta de erro principal.
async function suggestAlternatives(professionalId, startsAtInput, durationMinutes) {
  try {
    const date = startsAtInput instanceof Date ? startsAtInput : new Date(String(startsAtInput));
    if (Number.isNaN(date.getTime())) return [];
    const slots = await getAvailableSlots(professionalId, date, durationMinutes);
    if (slots.length === 0) return [];
    const requestedMs = date.getTime();
    return slots
      .slice()
      .sort((a, b) => Math.abs(a.start.getTime() - requestedMs) - Math.abs(b.start.getTime() - requestedMs))
      .slice(0, 6)
      .map((s) => s.start.toISOString());
  } catch {
    return [];
  }
}

// GET /appointments?from=ISO&to=ISO
export async function listAppointments(req, res, next) {
  try {
    const { from, to } = req.query;
    const params = [req.professionalId];
    let where = 'WHERE a.professional_id = $1';

    if (from) {
      params.push(from);
      where += ` AND a.starts_at >= $${params.length}`;
    }
    if (to) {
      params.push(to);
      where += ` AND a.starts_at <= $${params.length}`;
    }

    const { rows } = await pool.query(`${SELECT_BASE} ${where} ORDER BY a.starts_at ASC`, params);
    res.json(rows.map(toDto));
  } catch (err) {
    next(err);
  }
}

export async function createAppointment(req, res, next) {
  try {
    const data = createSchema.parse(req.body);

    const { rows: serviceRows } = await pool.query(
      'SELECT duration_minutes, price_cents FROM services WHERE id = $1 AND professional_id = $2',
      [data.serviceId, req.professionalId]
    );
    if (!serviceRows[0]) throw new HttpError(400, 'Serviço inválido.');

    const check = await checkSlotAvailability(req.professionalId, data.serviceId, data.startsAt);
    if (!check.available) {
      const alternatives = check.reason !== 'invalid_datetime'
        ? await suggestAlternatives(req.professionalId, data.startsAt, serviceRows[0].duration_minutes)
        : [];
      return res.status(409).json({ error: 'Horário não disponível.', reason: check.reason, alternatives });
    }

    const { rows } = await pool.query(
      `INSERT INTO appointments (professional_id, client_id, service_id, starts_at, ends_at, status, notes, price_cents_snapshot)
       VALUES ($1,$2,$3,$4,$5,COALESCE($6,'pendente'),$7,$8)
       RETURNING *`,
      [req.professionalId, data.clientId, data.serviceId, new Date(check.startsAt), new Date(check.endsAt), data.status, data.notes ?? null, serviceRows[0].price_cents]
    );

    const { rows: full } = await pool.query(`${SELECT_BASE} WHERE a.id = $1`, [rows[0].id]);
    res.status(201).json(toDto(full[0]));
  } catch (err) {
    if (err instanceof z.ZodError) return next(new HttpError(400, 'Dados de agendamento inválidos.'));
    next(err); // conflitos de horário (23P01) já tratados no errorHandler
  }
}

export async function updateAppointment(req, res, next) {
  try {
    const data = updateSchema.parse(req.body);

    let newStartsAt;
    let newEndsAt;
    let newSnapshot;

    if (data.startsAt || data.serviceId) {
      // Precisamos recalcular ends_at se a data/serviço mudou.
      const { rows: current } = await pool.query(
        'SELECT starts_at, service_id FROM appointments WHERE id = $1 AND professional_id = $2',
        [req.params.id, req.professionalId]
      );
      if (!current[0]) throw new HttpError(404, 'Agendamento não encontrado.');

      const serviceId = data.serviceId || current[0].service_id;
      const { rows: serviceRows } = await pool.query(
        'SELECT duration_minutes, price_cents FROM services WHERE id = $1 AND professional_id = $2',
        [serviceId, req.professionalId]
      );
      if (!serviceRows[0]) throw new HttpError(400, 'Serviço inválido.');

      newStartsAt = new Date(data.startsAt || current[0].starts_at);
      newEndsAt = new Date(newStartsAt.getTime() + serviceRows[0].duration_minutes * 60000);

      // Atualiza snapshot somente quando o serviço muda de fato.
      if (data.serviceId) {
        newSnapshot = serviceRows[0].price_cents;
      }

      const check = await checkSlotAvailability(req.professionalId, serviceId, newStartsAt, req.params.id);
      if (!check.available) {
        const alternatives = check.reason !== 'invalid_datetime'
          ? await suggestAlternatives(req.professionalId, newStartsAt, serviceRows[0].duration_minutes)
          : [];
        return res.status(409).json({ error: 'Horário não disponível.', reason: check.reason, alternatives });
      }
    }

    const { rows } = await pool.query(
      `UPDATE appointments SET
         client_id = COALESCE($1, client_id),
         service_id = COALESCE($2, service_id),
         starts_at = COALESCE($3, starts_at),
         ends_at = COALESCE($4, ends_at),
         status = COALESCE($5, status),
         notes = COALESCE($6, notes),
         price_cents_snapshot = COALESCE($9, price_cents_snapshot)
       WHERE id = $7 AND professional_id = $8
       RETURNING *`,
      [data.clientId, data.serviceId, newStartsAt, newEndsAt, data.status, data.notes, req.params.id, req.professionalId, newSnapshot ?? null]
    );
    if (!rows[0]) throw new HttpError(404, 'Agendamento não encontrado.');

    const { rows: full } = await pool.query(`${SELECT_BASE} WHERE a.id = $1`, [rows[0].id]);
    const dto = toDto(full[0]);

    if (data.status === 'confirmado') {
      notifyN8n('appointment.confirmed', dto);
    }

    res.json(dto);
  } catch (err) {
    if (err instanceof z.ZodError) return next(new HttpError(400, 'Dados de agendamento inválidos.'));
    next(err);
  }
}

// DELETE = cancelamento lógico (mantém histórico), não remove a linha.
export async function cancelAppointment(req, res, next) {
  try {
    const { rows } = await pool.query(
      `UPDATE appointments SET status = 'cancelado' WHERE id = $1 AND professional_id = $2 RETURNING *`,
      [req.params.id, req.professionalId]
    );
    if (!rows[0]) throw new HttpError(404, 'Agendamento não encontrado.');

    const { rows: full } = await pool.query(`${SELECT_BASE} WHERE a.id = $1`, [rows[0].id]);
    notifyN8n('appointment.cancelled', toDto(full[0]));

    res.status(204).end();
  } catch (err) {
    next(err);
  }
}

// POST /appointments/recurring
// Cria série de agendamentos recorrentes (semanal ou a cada 2 semanas).
// Abordagem best-effort: cria os slots disponíveis, pula os conflitos.
export async function createRecurring(req, res, next) {
  try {
    const data = createRecurringSchema.parse(req.body);

    const { rows: serviceRows } = await pool.query(
      'SELECT duration_minutes, price_cents FROM services WHERE id = $1 AND professional_id = $2',
      [data.serviceId, req.professionalId]
    );
    if (!serviceRows[0]) throw new HttpError(400, 'Serviço inválido.');

    const { rows: clientRows } = await pool.query(
      'SELECT id FROM clients WHERE id = $1 AND professional_id = $2',
      [data.clientId, req.professionalId]
    );
    if (!clientRows[0]) throw new HttpError(400, 'Cliente inválido.');

    const intervalDays = data.frequency === 'weekly' ? 7 : 14;
    const endsOn = new Date(data.endsOn + 'T23:59:59Z');

    // Gera todas as datas da série
    const firstDate = new Date(data.startsAt);
    if (Number.isNaN(firstDate.getTime())) throw new HttpError(400, 'Data inválida.');

    const dates = [];
    let cur = new Date(firstDate);
    while (cur <= endsOn) {
      dates.push(new Date(cur));
      cur = new Date(cur.getTime() + intervalDays * 86400000);
    }

    if (dates.length === 0) throw new HttpError(400, 'Nenhuma ocorrência gerada. Verifique as datas.');
    if (dates.length > 52) throw new HttpError(400, 'Série muito longa. Máximo 52 ocorrências.');

    // Cria o grupo de recorrência
    const { rows: groupRows } = await pool.query(
      `INSERT INTO recurring_groups (professional_id, frequency, ends_on)
       VALUES ($1, $2, $3) RETURNING id`,
      [req.professionalId, data.frequency, data.endsOn]
    );
    const groupId = groupRows[0].id;

    const created = [];
    const skipped = [];

    for (const date of dates) {
      const check = await checkSlotAvailability(req.professionalId, data.serviceId, date);
      if (!check.available) {
        skipped.push({ startsAt: date.toISOString(), reason: check.reason });
        continue;
      }

      await pool.query(
        `INSERT INTO appointments (professional_id, client_id, service_id, starts_at, ends_at, status, notes, price_cents_snapshot, recurring_group_id)
         VALUES ($1,$2,$3,$4,$5,'pendente',$6,$7,$8)`,
        [
          req.professionalId,
          data.clientId,
          data.serviceId,
          new Date(check.startsAt),
          new Date(check.endsAt),
          data.notes ?? null,
          serviceRows[0].price_cents,
          groupId,
        ]
      );
      created.push({ startsAt: date.toISOString() });
    }

    // Se nenhuma ocorrência foi criada, remove o grupo órfão
    if (created.length === 0) {
      await pool.query('DELETE FROM recurring_groups WHERE id = $1', [groupId]);
    }

    res.status(201).json({ groupId: created.length > 0 ? groupId : null, created, skipped });
  } catch (err) {
    if (err instanceof z.ZodError) return next(new HttpError(400, 'Dados de recorrência inválidos.'));
    next(err);
  }
}

// DELETE /appointments/:id/and-following
// Cancela este agendamento e todos os futuros do mesmo grupo.
export async function cancelFromNow(req, res, next) {
  try {
    const { rows: target } = await pool.query(
      'SELECT id, starts_at, recurring_group_id FROM appointments WHERE id = $1 AND professional_id = $2',
      [req.params.id, req.professionalId]
    );
    if (!target[0]) throw new HttpError(404, 'Agendamento não encontrado.');
    if (!target[0].recurring_group_id) throw new HttpError(400, 'Agendamento não pertence a uma série.');

    await pool.query(
      `UPDATE appointments SET status = 'cancelado'
       WHERE professional_id = $1
         AND recurring_group_id = $2
         AND starts_at >= $3
         AND status <> 'cancelado'`,
      [req.professionalId, target[0].recurring_group_id, target[0].starts_at]
    );

    res.status(204).end();
  } catch (err) {
    next(err);
  }
}

// PUT /appointments/:id/and-following
// Atualiza status e/ou notes deste agendamento e todos os futuros do mesmo grupo.
// Não suporta mudança de horário ou serviço (limitação v1).
export async function updateFromNow(req, res, next) {
  try {
    const schema = z.object({
      status: z.enum(['pendente', 'confirmado', 'cancelado', 'concluido', 'nao_compareceu']).optional(),
      notes: z.string().optional().nullable(),
    });
    const data = schema.parse(req.body);

    const { rows: target } = await pool.query(
      'SELECT id, starts_at, recurring_group_id FROM appointments WHERE id = $1 AND professional_id = $2',
      [req.params.id, req.professionalId]
    );
    if (!target[0]) throw new HttpError(404, 'Agendamento não encontrado.');
    if (!target[0].recurring_group_id) throw new HttpError(400, 'Agendamento não pertence a uma série.');

    await pool.query(
      `UPDATE appointments SET
         status = COALESCE($1, status),
         notes  = COALESCE($2, notes)
       WHERE professional_id = $3
         AND recurring_group_id = $4
         AND starts_at >= $5`,
      [data.status ?? null, data.notes ?? null, req.professionalId, target[0].recurring_group_id, target[0].starts_at]
    );

    const { rows: full } = await pool.query(`${SELECT_BASE} WHERE a.id = $1`, [req.params.id]);
    res.json(toDto(full[0]));
  } catch (err) {
    if (err instanceof z.ZodError) return next(new HttpError(400, 'Dados inválidos.'));
    next(err);
  }
}
