// Retorno de clientes: SUGESTÕES para a profissional contatar (nunca envia nada) e as preferências de contato da cliente.
// Sugestão = cliente com atendimento concluído, sem agendamento futuro, fora de "não enviar mensagens" e de uma pausa.
// "manutencao": passou o intervalo do SERVIÇO que ela fez por último (configurável por serviço; padrão do sistema 25 dias, só um ponto de partida).
// "sem_agendar": passou o limite de dias sem agendar (padrão 45, ajustável na tela). Uma única sugestão por cliente: a mais forte.
import { z } from 'zod';
import { pool } from '../config/db.js';
import { HttpError } from '../middleware/errorHandler.js';

export const DEFAULT_MAINTENANCE_DAYS = 25;
export const DEFAULT_INACTIVE_DAYS = 45;
export const INACTIVE_MIN = 30;
export const INACTIVE_MAX = 180;
const MAX_ITEMS = 200;

async function structureAvailable(db) {
  const { rows } = await db.query(
    `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'clients' AND column_name = 'contact_opt_out')
        AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'services' AND column_name = 'return_interval_days') AS ok`
  );
  return rows[0].ok === true;
}

/** Regra pura (testável): decide se há sugestão e qual. Dias inteiros desde o último atendimento concluído. */
export function classifyReturn({ daysSince, intervalDays, inactiveDays }) {
  const interval = intervalDays ?? DEFAULT_MAINTENANCE_DAYS;
  if (daysSince >= inactiveDays) return { reason: 'sem_agendar', intervalDays: interval, intervalIsDefault: intervalDays == null };
  if (daysSince >= interval) return { reason: 'manutencao', intervalDays: interval, intervalIsDefault: intervalDays == null };
  return null;
}

// GET /clients/return-suggestions?inactiveDays=45
export async function listReturnSuggestions(req, res, next) {
  try {
    const raw = req.query.inactiveDays === undefined ? DEFAULT_INACTIVE_DAYS : Number(req.query.inactiveDays);
    if (!Number.isInteger(raw) || raw < INACTIVE_MIN || raw > INACTIVE_MAX) {
      throw new HttpError(400, `Informe de ${INACTIVE_MIN} a ${INACTIVE_MAX} dias.`);
    }
    if (!(await structureAvailable(pool))) throw new HttpError(503, 'Retorno de clientes indisponível: a migration 031 não foi aplicada.');

    const { rows } = await pool.query(
      `WITH last_done AS (
         SELECT DISTINCT ON (a.client_id) a.client_id, a.service_id, a.starts_at AS last_at
           FROM appointments a
          WHERE a.professional_id = $1 AND a.status = 'concluido'
          ORDER BY a.client_id, a.starts_at DESC
       ), upcoming AS (
         SELECT DISTINCT client_id FROM appointments
          WHERE professional_id = $1 AND status IN ('pendente', 'aguardando_pagamento', 'confirmado') AND ends_at > now()
       )
       SELECT c.id, c.name, c.phone, ld.last_at, s.name AS service_name, s.return_interval_days,
              floor(extract(epoch FROM (now() - ld.last_at)) / 86400)::int AS days_since
         FROM clients c
         JOIN last_done ld ON ld.client_id = c.id
         JOIN services s ON s.id = ld.service_id AND s.professional_id = c.professional_id
        WHERE c.professional_id = $1
          AND c.contact_opt_out = false
          AND (c.return_snoozed_until IS NULL OR c.return_snoozed_until <= now())
          AND NOT EXISTS (SELECT 1 FROM upcoming u WHERE u.client_id = c.id)
        ORDER BY ld.last_at ASC`,
      [req.professionalId]
    );

    const items = [];
    for (const r of rows) {
      const c = classifyReturn({ daysSince: r.days_since, intervalDays: r.return_interval_days, inactiveDays: raw });
      if (!c) continue;
      items.push({
        clientId: r.id, name: r.name, phone: r.phone, lastServiceName: r.service_name, lastServiceAt: r.last_at,
        daysSince: r.days_since, reason: c.reason, intervalDays: c.intervalDays, intervalIsDefault: c.intervalIsDefault,
      });
      if (items.length >= MAX_ITEMS) break;
    }
    res.json({ defaults: { maintenanceDays: DEFAULT_MAINTENANCE_DAYS, inactiveDays: DEFAULT_INACTIVE_DAYS }, inactiveDays: raw, items });
  } catch (err) {
    next(err);
  }
}

const prefsSchema = z.object({
  contactOptOut: z.boolean().optional(),
  snoozeDays: z.union([z.number().int().min(1).max(180), z.null()]).optional(),
}).strict();

// PUT /clients/:id/contact-preferences  { contactOptOut?, snoozeDays? (null limpa a pausa) }
export async function updateContactPreferences(req, res, next) {
  try {
    const data = prefsSchema.parse(req.body);
    if (data.contactOptOut === undefined && data.snoozeDays === undefined) throw new HttpError(400, 'Nada para atualizar.');
    if (!(await structureAvailable(pool))) throw new HttpError(503, 'Preferências de contato indisponíveis: a migration 031 não foi aplicada.');
    const snoozeInBody = data.snoozeDays !== undefined;
    const { rows } = await pool.query(
      `UPDATE clients SET
         contact_opt_out = COALESCE($1::boolean, contact_opt_out),
         return_snoozed_until = CASE WHEN $2::boolean THEN (CASE WHEN $3::int IS NULL THEN NULL ELSE now() + make_interval(days => $3::int) END) ELSE return_snoozed_until END
       WHERE id = $4 AND professional_id = $5
       RETURNING id, contact_opt_out, return_snoozed_until`,
      [data.contactOptOut ?? null, snoozeInBody, data.snoozeDays ?? null, req.params.id, req.professionalId]
    );
    if (!rows[0]) throw new HttpError(404, 'Cliente não encontrada.');
    res.json({ id: rows[0].id, contactOptOut: rows[0].contact_opt_out, returnSnoozedUntil: rows[0].return_snoozed_until });
  } catch (err) {
    if (err instanceof z.ZodError) return next(new HttpError(400, 'Dados inválidos.'));
    next(err);
  }
}
