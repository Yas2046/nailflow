import { z } from 'zod';
import { pool } from '../config/db.js';
import { HttpError } from '../middleware/errorHandler.js';
import { notifyN8n } from '../utils/notifyN8n.js';
import { checkSlotAvailability, getAvailableSlots } from '../utils/availability.js';
import {
  TRANSITIONS, CLIENT_ORIGINATED_SOURCES, ATTENDED_STATUSES, CANCELLABLE_STATUSES,
  PANEL_INITIAL_STATUSES, RETROACTIVE_INITIAL_STATUSES, checkStatusChange, notBeforeStart,
} from '../utils/appointmentStatus.js';
import { expireDueHolds, formatWhen } from '../utils/bookingRules.js';

const createSchema = z.object({
  clientId: z.string().uuid(),
  serviceId: z.string().uuid(),
  startsAt: z.string().datetime({ offset: true }).or(z.string().min(1)), // ISO string
  notes: z.string().optional().nullable(),
  status: z.enum(['pendente', 'aguardando_pagamento', 'confirmado', 'cancelado', 'concluido', 'nao_compareceu']).optional(),
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
    expiresAt: row.expires_at ?? null,
    depositCents: row.deposit_cents ?? null,
    paidAt: row.paid_at ?? null,
  };
}

const SELECT_BASE = `
  SELECT a.*, c.name AS client_name, c.phone AS client_phone, s.name AS service_name
  FROM appointments a
  JOIN clients c ON c.id = a.client_id
  JOIN services s ON s.id = a.service_id
`;

// Mesma resposta para UUID inexistente ou de outra profissional: não revela a outra conta.
async function assertOwnClient(clientId, professionalId) {
  const { rows } = await pool.query(
    'SELECT id FROM clients WHERE id = $1 AND professional_id = $2',
    [clientId, professionalId]
  );
  if (!rows[0]) throw new HttpError(400, 'Cliente inválido.');
}

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

    // Status inicial: o painel cria "pendente" ou "confirmado". "concluido" e "nao_compareceu"
    // só valem como registro retroativo (o atendimento já terminou; conferido abaixo com o horário
    // calculado pelo servidor). "aguardando_pagamento" e "cancelado" não existem como criação.
    const initialStatus = data.status ?? 'pendente';
    if (!PANEL_INITIAL_STATUSES.includes(initialStatus) && !RETROACTIVE_INITIAL_STATUSES.includes(initialStatus)) {
      return res.status(400).json({ error: 'Status inicial inválido para um novo agendamento.', reason: 'invalid_initial_status' });
    }

    const { rows: serviceRows } = await pool.query(
      'SELECT duration_minutes, price_cents FROM services WHERE id = $1 AND professional_id = $2',
      [data.serviceId, req.professionalId]
    );
    if (!serviceRows[0]) throw new HttpError(400, 'Serviço inválido.');
    await assertOwnClient(data.clientId, req.professionalId);

    await expireDueHolds({ professionalId: req.professionalId });
    const check = await checkSlotAvailability(req.professionalId, data.serviceId, data.startsAt);
    if (!check.available) {
      const alternatives = check.reason !== 'invalid_datetime'
        ? await suggestAlternatives(req.professionalId, data.startsAt, serviceRows[0].duration_minutes)
        : [];
      return res.status(409).json({ error: 'Horário não disponível.', reason: check.reason, alternatives });
    }
    if (RETROACTIVE_INITIAL_STATUSES.includes(initialStatus) && new Date(check.endsAt) > new Date()) {
      return res.status(400).json({
        error: 'Só é possível registrar como concluído ou com falta um atendimento que já terminou.',
        reason: 'invalid_initial_status',
      });
    }

    const { rows } = await pool.query(
      `INSERT INTO appointments (professional_id, client_id, service_id, starts_at, ends_at, status, notes, price_cents_snapshot)
       VALUES ($1,$2,$3,$4,$5,COALESCE($6,'pendente'),$7,$8)
       RETURNING *`,
      [req.professionalId, data.clientId, data.serviceId, new Date(check.startsAt), new Date(check.endsAt), data.status, data.notes ?? null, serviceRows[0].price_cents]
    );

    const { rows: full } = await pool.query(`${SELECT_BASE} WHERE a.id = $1 AND a.professional_id = $2`, [rows[0].id, req.professionalId]);
    res.status(201).json(toDto(full[0]));
  } catch (err) {
    if (err instanceof z.ZodError) return next(new HttpError(400, 'Dados de agendamento inválidos.'));
    next(err); // conflitos de horário (23P01) já tratados no errorHandler
  }
}

// ── Transação curta ─────────────────────────────────────────────────────────
// Dentro de `fn` só se usa a conexão reservada (`client`): nenhuma consulta pelo `pool` enquanto
// a transação segura uma conexão (com o pool esgotado isso travaria a API inteira). COMMIT em caso
// de sucesso, ROLLBACK em qualquer exceção, e a conexão é sempre devolvida (descartada se o
// ROLLBACK falhar).
async function withTransaction(fn) {
  const client = await pool.connect();
  let broken = false;
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { broken = true; }
    throw err;
  } finally {
    client.release(broken);
  }
}

// ── PUT /appointments/:id ───────────────────────────────────────────────────
// Regras (Fase 1): o status só muda conforme `checkStatusChange` (matriz de transições); em
// concluído/falta cliente, serviço e horário ficam travados (observação continua livre); repetir
// o mesmo status ou reenviar o mesmo cliente/serviço/horário não conta como alteração.
//
// Estrutura: (1) leitura inicial e validações que usam o pool (disponibilidade etc.), sem transação;
// (2) transação curta: relê a linha BLOQUEADA, confirma que nada mudou desde (1), decide de novo e
// faz o UPDATE; (3) DTO e avisos depois de liberar a conexão.

const APPOINTMENT_CURRENT_COLUMNS =
  'id, status, cancel_reason, expires_at, starts_at, client_id, service_id, notes';

async function readCurrent(db, id, professionalId, lock) {
  const { rows } = await db.query(
    `SELECT ${APPOINTMENT_CURRENT_COLUMNS} FROM appointments WHERE id = $1 AND professional_id = $2${lock ? ' FOR UPDATE' : ''}`,
    [id, professionalId]
  );
  return rows[0] ?? null;
}

// Avaliação pura (sem E/S) de um PUT sobre o estado `cur`. Roda antes da transação e de novo sobre
// a linha bloqueada.
function evaluateUpdate(cur, data) {
  const newStart = data.startsAt !== undefined ? new Date(data.startsAt) : null;
  const startChanged = newStart !== null && newStart.getTime() !== new Date(cur.starts_at).getTime();
  const serviceChanged = data.serviceId !== undefined && data.serviceId !== cur.service_id;
  const clientChanged = data.clientId !== undefined && data.clientId !== cur.client_id;
  // reabrir um cancelado volta a ocupar o horário: a disponibilidade precisa ser revalidada
  const reopening = cur.status === 'cancelado' && data.status !== undefined && data.status !== 'cancelado';

  if (ATTENDED_STATUSES.includes(cur.status) && (startChanged || serviceChanged || clientChanged)) {
    return {
      reject: {
        status: 409,
        body: {
          error: 'Atendimento concluído ou com falta não pode ter cliente, serviço ou horário alterados.',
          reason: 'locked_field',
          fields: [clientChanged && 'clientId', serviceChanged && 'serviceId', startChanged && 'startsAt'].filter(Boolean),
        },
      },
    };
  }

  const problem = checkStatusChange(cur, data.status, { startsAt: startChanged ? newStart : cur.starts_at });
  if (problem) return { reject: { status: 409, body: { error: problem.error, reason: problem.reason } } };

  return { newStart, startChanged, serviceChanged, clientChanged, reopening };
}

// Disponibilidade (usa o pool; chamar SEM transação aberta). Só roda quando o agendamento passa a
// ocupar um horário/serviço diferente do que já ocupava, ou volta a ocupá-lo (reabertura).
async function planSlot(cur, data, ev, professionalId, appointmentId) {
  if (!(ev.startChanged || ev.serviceChanged || ev.reopening)) return {};
  const serviceId = data.serviceId ?? cur.service_id;
  const { rows: serviceRows } = await pool.query(
    'SELECT duration_minutes, price_cents FROM services WHERE id = $1 AND professional_id = $2',
    [serviceId, professionalId]
  );
  if (!serviceRows[0]) throw new HttpError(400, 'Serviço inválido.');

  const newStartsAt = ev.startChanged ? ev.newStart : new Date(cur.starts_at);
  const newEndsAt = new Date(newStartsAt.getTime() + serviceRows[0].duration_minutes * 60000);
  // o preço do registro só é refeito quando o serviço realmente muda
  const newSnapshot = ev.serviceChanged ? serviceRows[0].price_cents : null;

  await expireDueHolds({ professionalId });
  const check = await checkSlotAvailability(professionalId, serviceId, newStartsAt, appointmentId);
  if (!check.available) {
    const alternatives = check.reason !== 'invalid_datetime'
      ? await suggestAlternatives(professionalId, newStartsAt, serviceRows[0].duration_minutes)
      : [];
    return { reject: { status: 409, body: { error: 'Horário não disponível.', reason: check.reason, alternatives } } };
  }
  return { newStartsAt, newEndsAt, newSnapshot };
}

const changedSince = (a, b) =>
  a.status !== b.status || a.cancel_reason !== b.cancel_reason || a.service_id !== b.service_id
  || a.client_id !== b.client_id || new Date(a.starts_at).getTime() !== new Date(b.starts_at).getTime();

// Resposta de rejeição. Reserva vencida: mesma resposta e mesmo efeito (expirar a reserva) da confirmação direta.
async function sendReject(res, reject, id, professionalId) {
  if (reject.body.reason === 'hold_expired') {
    const failure = await confirmFailure(id, professionalId);
    return res.status(409).json(failure ?? reject.body);
  }
  return res.status(reject.status).json(reject.body);
}

// Tentativa inicial + até 2 repetições quando a releitura sob lock mostra que o agendamento mudou
// (outra operação concorrente). Cada repetição recomeça do zero (releitura, avaliação e
// disponibilidade): nenhuma decisão da tentativa anterior é reaproveitada.
const UPDATE_MAX_ATTEMPTS = 3;

export async function updateAppointment(req, res, next) {
  try {
    const data = updateSchema.parse(req.body);
    const id = req.params.id;
    const pid = req.professionalId;
    if (data.clientId) await assertOwnClient(data.clientId, pid);

    for (let attempt = 1; ; attempt += 1) {
      // (1) leitura inicial + validações (sem transação aberta)
      const pre = await readCurrent(pool, id, pid, false);
      if (!pre) throw new HttpError(404, 'Agendamento não encontrado.');
      const ev = evaluateUpdate(pre, data);
      if (ev.reject) return await sendReject(res, ev.reject, id, pid);
      const slot = await planSlot(pre, data, ev, pid, id);
      if (slot.reject) return await sendReject(res, slot.reject, id, pid);

      // (2) transação curta: só a conexão reservada
      const out = await withTransaction(async (client) => {
        const cur = await readCurrent(client, id, pid, true);
        if (!cur) return { kind: 'missing' };
        if (changedSince(pre, cur)) return { kind: 'concurrent' };
        const again = evaluateUpdate(cur, data);
        if (again.reject) return { kind: 'reject', reject: again.reject };

        // Nada a gravar (por exemplo, outra operação já aplicou o estado pedido): responde sem tocar na linha.
        const nothingToDo = (data.status === undefined || data.status === cur.status)
          && !again.startChanged && !again.serviceChanged && !again.clientChanged
          && (typeof data.notes !== 'string' || data.notes === cur.notes)
          && !(cur.cancel_reason && cur.status !== 'cancelado');
        if (nothingToDo) return { kind: 'ok', row: cur, prevStatus: cur.status };

        const { rows } = await client.query(
          `UPDATE appointments SET
             client_id = COALESCE($1, client_id),
             service_id = COALESCE($2, service_id),
             starts_at = COALESCE($3, starts_at),
             ends_at = COALESCE($4, ends_at),
             status = COALESCE($5::text, status),
             expires_at = CASE WHEN $5::text = 'confirmado' THEN NULL ELSE expires_at END,
             cancel_reason = CASE WHEN COALESCE($5::text, status) = 'cancelado' THEN cancel_reason ELSE NULL END,
             notes = COALESCE($6, notes),
             price_cents_snapshot = COALESCE($9, price_cents_snapshot)
           WHERE id = $7 AND professional_id = $8
           RETURNING *`,
          [data.clientId ?? null, data.serviceId ?? null, slot.newStartsAt ?? null, slot.newEndsAt ?? null, data.status ?? null,
           data.notes ?? null, id, pid, slot.newSnapshot ?? null]
        );
        return { kind: 'ok', row: rows[0], prevStatus: cur.status };
      });

      // (3) fora da transação: a conexão já foi devolvida
      if (out.kind === 'concurrent') {
        if (attempt < UPDATE_MAX_ATTEMPTS) continue;
        return res.status(409).json({
          error: 'Este agendamento foi alterado por outra operação. Atualize a tela e tente novamente.',
          reason: 'concurrent_change',
        });
      }
      if (out.kind === 'missing') throw new HttpError(404, 'Agendamento não encontrado.');
      if (out.kind === 'reject') return await sendReject(res, out.reject, id, pid);

      const { rows: full } = await pool.query(`${SELECT_BASE} WHERE a.id = $1 AND a.professional_id = $2`, [out.row.id, pid]);
      const dto = toDto(full[0]);

      // Aviso de confirmação só quando houve confirmação de verdade (status anterior diferente,
      // lido sob lock) e o atendimento ainda não começou. Repetição idempotente não avisa.
      let notificationSkipped;
      if (data.status === 'confirmado' && out.prevStatus !== 'confirmado') {
        if (notBeforeStart(out.row.starts_at)) {
          const { rows: instRows } = await pool.query('SELECT wa_instance_name FROM professionals WHERE id = $1', [pid]);
          notifyN8n('appointment.confirmed', { ...dto, waInstance: instRows[0]?.wa_instance_name ?? null });
        } else {
          notificationSkipped = 'past';
        }
      }

      return res.json(notificationSkipped ? { ...dto, notificationSkipped } : dto);
    }
  } catch (err) {
    if (err instanceof z.ZodError) return next(new HttpError(400, 'Dados de agendamento inválidos.'));
    next(err);
  }
}

// DELETE = cancelamento lógico (mantém histórico), não remove a linha.
// Só cancela pendente, aguardando pagamento ou confirmado. Repetir em quem já está cancelado é
// idempotente (204, sem novo aviso); concluído ou falta recebe 409. A cliente só é avisada quando
// o registro realmente mudou e o atendimento ainda não começou.
export async function cancelAppointment(req, res, next) {
  try {
    const { rows } = await pool.query(
      `UPDATE appointments SET status = 'cancelado'
       WHERE id = $1 AND professional_id = $2 AND status = ANY($3::text[])
       RETURNING id, starts_at`,
      [req.params.id, req.professionalId, CANCELLABLE_STATUSES]
    );

    if (rows[0]) {
      if (notBeforeStart(rows[0].starts_at)) {
        const { rows: full } = await pool.query(`${SELECT_BASE} WHERE a.id = $1 AND a.professional_id = $2`, [rows[0].id, req.professionalId]);
        const { rows: instRowsC } = await pool.query('SELECT wa_instance_name FROM professionals WHERE id = $1', [req.professionalId]);
        notifyN8n('appointment.cancelled', { ...toDto(full[0]), waInstance: instRowsC[0]?.wa_instance_name ?? null });
      }
      return res.status(204).end();
    }

    const { rows: cur } = await pool.query(
      'SELECT status FROM appointments WHERE id = $1 AND professional_id = $2',
      [req.params.id, req.professionalId]
    );
    if (!cur[0]) throw new HttpError(404, 'Agendamento não encontrado.');
    if (cur[0].status === 'cancelado') return res.status(204).end();
    return res.status(409).json({
      error: 'Um atendimento concluído ou com falta não pode ser cancelado.',
      reason: 'invalid_transition',
    });
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
    await expireDueHolds({ professionalId: req.professionalId });

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

// ── Operações em lote sobre uma série recorrente ────────────────────────────
// Cada agendamento é avaliado individualmente (mesmas regras do PUT/DELETE de um só). Os que não
// passam são ignorados e voltam no resumo; nunca ressuscitam cancelados nem mexem em concluídos ou
// faltas sem permissão. As linhas ficam bloqueadas em ordem fixa (starts_at, id) durante o lote.

const BATCH_SKIPPED_LIMIT = 20;

function batchSummary(total, updated, unchanged, skipped) {
  const reasons = {};
  for (const s of skipped) reasons[s.reason] = (reasons[s.reason] ?? 0) + 1;
  return {
    updated,
    unchanged,
    skipped: skipped.length,
    total,
    reasons,
    skippedItems: skipped.slice(0, BATCH_SKIPPED_LIMIT),
    skippedMore: Math.max(0, skipped.length - BATCH_SKIPPED_LIMIT),
  };
}

async function lockSeries(client, appointmentId, professionalId) {
  const { rows: target } = await client.query(
    'SELECT id, starts_at, recurring_group_id FROM appointments WHERE id = $1 AND professional_id = $2',
    [appointmentId, professionalId]
  );
  if (!target[0]) throw new HttpError(404, 'Agendamento não encontrado.');
  if (!target[0].recurring_group_id) throw new HttpError(400, 'Agendamento não pertence a uma série.');
  const { rows } = await client.query(
    `SELECT id, status, cancel_reason, expires_at, starts_at, notes
       FROM appointments
      WHERE professional_id = $1 AND recurring_group_id = $2 AND starts_at >= $3
      ORDER BY starts_at, id
      FOR UPDATE`,
    [professionalId, target[0].recurring_group_id, target[0].starts_at]
  );
  return rows;
}

const skippedItem = (row, reason) => ({ id: row.id, startsAt: row.starts_at, status: row.status, reason });

// DELETE /appointments/:id/and-following
export async function cancelFromNow(req, res, next) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const rows = await lockSeries(client, req.params.id, req.professionalId);

    let updated = 0;
    let unchanged = 0;
    const skipped = [];
    for (const row of rows) {
      if (row.status === 'cancelado') { unchanged += 1; continue; }
      if (!CANCELLABLE_STATUSES.includes(row.status)) { skipped.push(skippedItem(row, 'attended_protected')); continue; }
      await client.query(`UPDATE appointments SET status = 'cancelado' WHERE id = $1`, [row.id]);
      updated += 1;
    }
    await client.query('COMMIT');
    res.json(batchSummary(rows.length, updated, unchanged, skipped));
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* sem transação aberta */ }
    next(err);
  } finally {
    client.release();
  }
}

// PUT /appointments/:id/and-following
// Atualiza status e/ou notes deste agendamento e dos futuros do mesmo grupo, um a um.
// Não suporta mudança de horário ou serviço (limitação v1). Concluídos e faltas nunca mudam de
// status por lote (`attended_protected`); a correção continua individual. Tudo ou nada: uma única
// transação, e o DTO do alvo é buscado depois de devolver a conexão.
export async function updateFromNow(req, res, next) {
  try {
    const schema = z.object({
      status: z.enum(['pendente', 'aguardando_pagamento', 'confirmado', 'cancelado', 'concluido', 'nao_compareceu']).optional(),
      notes: z.string().optional().nullable(),
    });
    const data = schema.parse(req.body);

    const summary = await withTransaction(async (client) => {
      const rows = await lockSeries(client, req.params.id, req.professionalId);
      const now = new Date();

      let updated = 0;
      let unchanged = 0;
      const skipped = [];
      for (const row of rows) {
        if (row.status === 'cancelado') {
          // cancelado nunca é alterado por lote (nem reaberto, nem recebe observação)
          if (data.status === 'cancelado') unchanged += 1;
          else if (data.status !== undefined || data.notes) skipped.push(skippedItem(row, 'cancelled'));
          else unchanged += 1;
          continue;
        }
        if (ATTENDED_STATUSES.includes(row.status) && data.status !== undefined && data.status !== row.status) {
          skipped.push(skippedItem(row, 'attended_protected'));
          continue;
        }
        const problem = checkStatusChange(row, data.status, { now });
        if (problem) { skipped.push(skippedItem(row, problem.reason)); continue; }

        const statusChange = data.status !== undefined && data.status !== row.status;
        const notesChange = typeof data.notes === 'string' && data.notes !== row.notes;
        if (!statusChange && !notesChange) { unchanged += 1; continue; }

        await client.query(
          `UPDATE appointments SET
             status = COALESCE($1::text, status),
             expires_at = CASE WHEN $1::text = 'confirmado' THEN NULL ELSE expires_at END,
             cancel_reason = CASE WHEN COALESCE($1::text, status) = 'cancelado' THEN cancel_reason ELSE NULL END,
             notes = COALESCE($2, notes)
           WHERE id = $3`,
          [statusChange ? data.status : null, notesChange ? data.notes : null, row.id]
        );
        updated += 1;
      }
      return batchSummary(rows.length, updated, unchanged, skipped);
    });

    const { rows: full } = await pool.query(`${SELECT_BASE} WHERE a.id = $1 AND a.professional_id = $2`, [req.params.id, req.professionalId]);
    res.json({ ...toDto(full[0]), ...summary });
  } catch (err) {
    if (err instanceof z.ZodError) return next(new HttpError(400, 'Dados inválidos.'));
    next(err);
  }
}

// Motivo do 409 quando a confirmação não aconteceu. Reserva vencida (ainda que
// não varrida) vira expirada na hora, liberando o horário. null = não existe.
async function confirmFailure(id, professionalId, invalidMsg = 'Só é possível confirmar um agendamento aguardando confirmação.') {
  const { rows } = await pool.query(
    `SELECT status, cancel_reason, (expires_at IS NOT NULL AND expires_at <= now()) AS due
     FROM appointments WHERE id = $1 AND professional_id = $2`,
    [id, professionalId]
  );
  const cur = rows[0];
  if (!cur) return null;
  const expiredMsg = 'A reserva deste horário expirou. Peça para a cliente solicitar novamente.';
  if (cur.status === 'cancelado' && cur.cancel_reason === 'expired') return { error: expiredMsg, reason: 'hold_expired' };
  if (['pendente', 'aguardando_pagamento'].includes(cur.status) && cur.due) {
    await expireDueHolds({ professionalId });
    return { error: expiredMsg, reason: 'hold_expired' };
  }
  return { error: invalidMsg, reason: 'invalid_transition' };
}

async function loadFullDto(id, professionalId) {
  const { rows } = await pool.query(`${SELECT_BASE} WHERE a.id = $1 AND a.professional_id = $2`, [id, professionalId]);
  return rows[0] ? { row: rows[0], dto: toDto(rows[0]) } : null;
}

// POST /appointments/:id/confirm — pendente → confirmado. Repetir é idempotente
// (200, changed:false) e NÃO reenvia a mensagem.
export async function confirmAppointment(req, res, next) {
  try {
    const t = TRANSITIONS.confirm;
    const { rows } = await pool.query(
      `UPDATE appointments SET status = $3, expires_at = NULL
       WHERE id = $1 AND professional_id = $2 AND status = ANY($4::text[])
         AND (expires_at IS NULL OR expires_at > now()) RETURNING id`,
      [req.params.id, req.professionalId, t.to, t.from]
    );
    const full = await loadFullDto(req.params.id, req.professionalId);
    if (!full) throw new HttpError(404, 'Agendamento não encontrado.');

    if (rows[0]) {
      // atendimento que já começou ou terminou: confirma, mas não avisa a cliente
      if (!notBeforeStart(full.row.starts_at)) return res.json({ ...full.dto, changed: true, notificationSkipped: 'past' });
      const { rows: inst } = await pool.query('SELECT wa_instance_name FROM professionals WHERE id = $1', [req.professionalId]);
      notifyN8n('appointment.confirmed', { ...full.dto, waInstance: inst[0]?.wa_instance_name ?? null });
      return res.json({ ...full.dto, changed: true });
    }
    if (full.row.status === t.to) return res.json({ ...full.dto, changed: false });
    return res.status(409).json(await confirmFailure(req.params.id, req.professionalId));
  } catch (err) {
    next(err);
  }
}

// POST /appointments/:id/mark-paid — aguardando_pagamento → confirmado (sinal Pix
// recebido). Atômico e idempotente; recusa reserva vencida (hold_expired) e
// qualquer outro estado. Só então a cliente recebe a mensagem de confirmação.
export async function markPaidAppointment(req, res, next) {
  try {
    const t = TRANSITIONS.markPaid;
    const { rows } = await pool.query(
      `UPDATE appointments SET status = $3, expires_at = NULL, paid_at = now()
       WHERE id = $1 AND professional_id = $2 AND status = ANY($4::text[])
         AND (expires_at IS NULL OR expires_at > now()) RETURNING id`,
      [req.params.id, req.professionalId, t.to, t.from]
    );
    const full = await loadFullDto(req.params.id, req.professionalId);
    if (!full) throw new HttpError(404, 'Agendamento não encontrado.');

    if (rows[0]) {
      if (!notBeforeStart(full.row.starts_at)) return res.json({ ...full.dto, changed: true, notificationSkipped: 'past' });
      const { rows: inst } = await pool.query('SELECT wa_instance_name FROM professionals WHERE id = $1', [req.professionalId]);
      notifyN8n('appointment.confirmed', { ...full.dto, waInstance: inst[0]?.wa_instance_name ?? null });
      return res.json({ ...full.dto, changed: true });
    }
    if (full.row.status === t.to && full.row.paid_at) return res.json({ ...full.dto, changed: false });
    return res.status(409).json(
      await confirmFailure(req.params.id, req.professionalId, 'Só é possível marcar o pagamento de um agendamento aguardando pagamento.')
    );
  } catch (err) {
    next(err);
  }
}

// POST /appointments/:id/reject — pendente → cancelado (cancel_reason='rejected').
// Avisa a cliente só quando o agendamento veio da página pública ou do bot.
export async function rejectAppointment(req, res, next) {
  try {
    const t = TRANSITIONS.reject;
    const { rows } = await pool.query(
      `UPDATE appointments SET status = $3, cancel_reason = $5
       WHERE id = $1 AND professional_id = $2 AND status = ANY($4::text[]) RETURNING id, source`,
      [req.params.id, req.professionalId, t.to, t.from, t.cancelReason]
    );
    const full = await loadFullDto(req.params.id, req.professionalId);
    if (!full) throw new HttpError(404, 'Agendamento não encontrado.');

    if (rows[0]) {
      if (CLIENT_ORIGINATED_SOURCES.includes(rows[0].source) && !notBeforeStart(full.row.starts_at)) {
        // atendimento que já começou ou terminou: recusa o pedido, mas não avisa a cliente
        return res.json({ ...full.dto, changed: true, notificationSkipped: 'past' });
      }
      if (CLIENT_ORIGINATED_SOURCES.includes(rows[0].source)) {
        const { rows: inst } = await pool.query('SELECT wa_instance_name FROM professionals WHERE id = $1', [req.professionalId]);
        const firstName = (full.dto.clientName || '').split(' ')[0];
        notifyN8n('appointment.rejected', {
          ...full.dto,
          waInstance: inst[0]?.wa_instance_name ?? null,
          message: `Olá${firstName ? `, ${firstName}` : ''}! Infelizmente não consegui confirmar seu horário de *${full.dto.serviceName}* em ${formatWhen(full.dto.startsAt)}. 😕 Se quiser, escolha outro horário pela página de agendamento ou me chame por aqui. 💅`,
        });
      }
      return res.json({ ...full.dto, changed: true });
    }
    if (full.row.status === t.to && full.row.cancel_reason === t.cancelReason) {
      return res.json({ ...full.dto, changed: false });
    }
    if (full.row.status === 'cancelado' && full.row.cancel_reason === 'expired') {
      return res.status(409).json({ error: 'A reserva deste horário já expirou.', reason: 'hold_expired' });
    }
    return res.status(409).json({ error: 'Só é possível recusar um agendamento aguardando confirmação.', reason: 'invalid_transition' });
  } catch (err) {
    next(err);
  }
}
