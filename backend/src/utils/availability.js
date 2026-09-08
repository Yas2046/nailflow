import { pool } from '../config/db.js';
import { getZonedParts, timeStringToUtcOnDate, parseZonedDateTime } from './timezone.js';

const SLOT_STEP_MINUTES = 30; // granularidade dos horários sugeridos

function toMinutes(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
}

/**
 * Calcula os horários disponíveis de uma profissional em uma data específica,
 * considerando: expediente do dia da semana, intervalo de almoço,
 * bloqueios pontuais (blocked_times) e agendamentos já existentes.
 *
 * @param {string} professionalId
 * @param {Date} date - qualquer instante dentro do dia civil em São Paulo que se deseja consultar
 * @param {number} serviceDurationMinutes - duração do serviço a encaixar
 * @returns {Promise<Array<{start: Date, end: Date}>>}
 */
export async function getAvailableSlots(professionalId, date, serviceDurationMinutes) {
  // Determina o dia da semana e as fronteiras do dia civil em America/Sao_Paulo.
  // Em containers de produção (UTC), date.getDay() retornaria o dia errado para
  // qualquer Date entre 00:00 SP e 03:00 UTC — janela em que SP ainda está no dia anterior.
  const zonedParts = getZonedParts(date);
  const weekday = zonedParts.weekday;

  const { rows: availabilityRows } = await pool.query(
    `SELECT is_working, start_time, end_time, break_start, break_end
     FROM weekly_availability
     WHERE professional_id = $1 AND weekday = $2`,
    [professionalId, weekday]
  );

  const availability = availabilityRows[0];
  if (!availability || !availability.is_working) {
    return []; // folga nesse dia da semana
  }

  const dayStart = toMinutes(availability.start_time);
  const dayEnd = toMinutes(availability.end_time);

  // Monta lista de intervalos ocupados (em minutos desde 00:00 SP) nesse dia:
  // intervalo de almoço + bloqueios pontuais + agendamentos ativos.
  const busyRanges = [];

  if (availability.break_start && availability.break_end) {
    busyRanges.push([toMinutes(availability.break_start), toMinutes(availability.break_end)]);
  }

  // Fronteiras do dia civil em SP, expressas em UTC para as queries no banco.
  // startOfDay = 00:00 SP; endOfDay = 00:00 SP do dia seguinte (limite exclusivo).
  const startOfDay = timeStringToUtcOnDate(zonedParts, '00:00');
  const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);

  const { rows: blocks } = await pool.query(
    `SELECT starts_at, ends_at FROM blocked_times
     WHERE professional_id = $1 AND starts_at < $3 AND ends_at > $2`,
    [professionalId, startOfDay, endOfDay]
  );
  for (const b of blocks) {
    busyRanges.push([
      minutesSinceMidnight(new Date(b.starts_at), startOfDay),
      minutesSinceMidnight(new Date(b.ends_at), startOfDay),
    ]);
  }

  const { rows: appts } = await pool.query(
    `SELECT starts_at, ends_at FROM appointments
     WHERE professional_id = $1 AND status <> 'cancelado'
       AND starts_at < $3 AND ends_at > $2`,
    [professionalId, startOfDay, endOfDay]
  );
  for (const a of appts) {
    busyRanges.push([
      minutesSinceMidnight(new Date(a.starts_at), startOfDay),
      minutesSinceMidnight(new Date(a.ends_at), startOfDay),
    ]);
  }

  const slots = [];
  for (let start = dayStart; start + serviceDurationMinutes <= dayEnd; start += SLOT_STEP_MINUTES) {
    const end = start + serviceDurationMinutes;
    const overlaps = busyRanges.some(([bStart, bEnd]) => start < bEnd && end > bStart);
    if (!overlaps) {
      // Exprime os horários dos slots em UTC, ancorados à meia-noite SP.
      slots.push({
        start: new Date(startOfDay.getTime() + start * 60000),
        end: new Date(startOfDay.getTime() + end * 60000),
      });
    }
  }

  return slots;
}

function minutesSinceMidnight(date, referenceDayStart) {
  const clamped = date < referenceDayStart ? referenceDayStart : date;
  return Math.round((clamped - referenceDayStart) / 60000);
}

/**
 * Verifica se um horário EXATO está disponível para um serviço específico,
 * sem impor a grade de 30 em 30 minutos usada por getAvailableSlots().
 *
 * Usada quando a cliente (via WhatsApp/n8n) ou a profissional (via app)
 * pede um horário específico, ex.: "14:15" para um serviço de 120 minutos
 * -> precisa validar o intervalo 14:15–16:15 por inteiro.
 *
 * Considera, nesta ordem: serviço válido/ativo, expediente do dia da
 * semana, intervalo de almoço, bloqueios pontuais e agendamentos ativos
 * que já ocupam o horário. Todos os horários civis (expediente, almoço)
 * são interpretados em America/Sao_Paulo (ver utils/timezone.js).
 *
 * @param {string} professionalId
 * @param {string} serviceId
 * @param {string|Date} startsAtInput - ISO com timezone (ex.: "...Z") ou
 *   uma string "naive" tipo "2026-01-10T14:15:00", tratada como horário
 *   civil em America/Sao_Paulo.
 * @returns {Promise<
 *   { available: true, startsAt: string, endsAt: string } |
 *   { available: false, reason: string }
 * >}
 *
 * Motivos possíveis quando available = false:
 *   invalid_service        - serviço não existe para esta profissional
 *   inactive_service        - serviço existe mas está inativo
 *   invalid_datetime        - startsAt não pôde ser interpretado
 *   outside_working_hours   - fora do expediente do dia (ou dia de folga)
 *   lunch_break              - cai dentro do intervalo de almoço
 *   blocked_time             - cai dentro de um bloqueio pontual
 *   appointment_overlap     - conflita com outro agendamento ativo
 */
export async function checkSlotAvailability(professionalId, serviceId, startsAtInput, excludeAppointmentId = null) {
  const { rows: serviceRows } = await pool.query(
    'SELECT duration_minutes, active FROM services WHERE id = $1 AND professional_id = $2',
    [serviceId, professionalId]
  );
  const service = serviceRows[0];
  if (!service) {
    return { available: false, reason: 'invalid_service' };
  }
  if (!service.active) {
    return { available: false, reason: 'inactive_service' };
  }

  const startsAt = parseZonedDateTime(startsAtInput);
  if (Number.isNaN(startsAt.getTime())) {
    return { available: false, reason: 'invalid_datetime' };
  }
  const endsAt = new Date(startsAt.getTime() + service.duration_minutes * 60000);

  const zonedStart = getZonedParts(startsAt);

  const { rows: availabilityRows } = await pool.query(
    `SELECT is_working, start_time, end_time, break_start, break_end
     FROM weekly_availability
     WHERE professional_id = $1 AND weekday = $2`,
    [professionalId, zonedStart.weekday]
  );
  const availability = availabilityRows[0];
  if (!availability || !availability.is_working) {
    return { available: false, reason: 'outside_working_hours' };
  }

  const workStart = timeStringToUtcOnDate(zonedStart, availability.start_time);
  const workEnd = timeStringToUtcOnDate(zonedStart, availability.end_time);
  if (startsAt < workStart || endsAt > workEnd) {
    return { available: false, reason: 'outside_working_hours' };
  }

  if (availability.break_start && availability.break_end) {
    const breakStart = timeStringToUtcOnDate(zonedStart, availability.break_start);
    const breakEnd = timeStringToUtcOnDate(zonedStart, availability.break_end);
    if (startsAt < breakEnd && endsAt > breakStart) {
      return { available: false, reason: 'lunch_break' };
    }
  }

  const { rows: blockedRows } = await pool.query(
    `SELECT id FROM blocked_times
     WHERE professional_id = $1 AND starts_at < $3 AND ends_at > $2
     LIMIT 1`,
    [professionalId, startsAt, endsAt]
  );
  if (blockedRows.length > 0) {
    return { available: false, reason: 'blocked_time' };
  }

  const { rows: overlapRows } = await pool.query(
    `SELECT id FROM appointments
     WHERE professional_id = $1 AND status <> 'cancelado'
       AND starts_at < $3 AND ends_at > $2
       ${excludeAppointmentId ? 'AND id <> $4' : ''}
     LIMIT 1`,
    excludeAppointmentId
      ? [professionalId, startsAt, endsAt, excludeAppointmentId]
      : [professionalId, startsAt, endsAt]
  );
  if (overlapRows.length > 0) {
    return { available: false, reason: 'appointment_overlap' };
  }

  return { available: true, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() };
}
