import { z } from 'zod';
import { pool } from '../config/db.js';
import { HttpError } from '../middleware/errorHandler.js';

const clientSchema = z.object({
  name: z.string().min(1),
  phone: z.string().min(8),
  notes: z.string().optional().nullable(),
  tags: z.array(
    z.string().trim().min(1, 'Tag inválida.').max(30, 'Tag deve ter no máximo 30 caracteres.')
  ).max(20, 'Máximo de 20 tags por cliente.').optional(),
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
        tags: r.tags ?? [],
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

    const [historyResult, metricsResult, servicoResult] = await Promise.all([
      pool.query(
        `SELECT a.id, a.starts_at, a.ends_at, a.status, s.name AS service_name,
                a.price_cents_snapshot, a.notes AS appointment_notes
         FROM appointments a JOIN services s ON s.id = a.service_id
         WHERE a.client_id = $1 AND a.professional_id = $2 ORDER BY a.starts_at DESC`,
        [req.params.id, req.professionalId]
      ),
      pool.query(
        `SELECT
           COUNT(*) FILTER (WHERE status = 'concluido')::int         AS total_concluidos,
           COUNT(*) FILTER (WHERE status = 'cancelado')::int         AS total_cancelados,
           COUNT(*) FILTER (WHERE status = 'nao_compareceu')::int    AS total_faltas,
           COALESCE(SUM(price_cents_snapshot) FILTER (WHERE status = 'concluido'), 0)::int AS valor_total_cents,
           COALESCE(AVG(price_cents_snapshot) FILTER (WHERE status = 'concluido'), 0)::int AS ticket_medio_cents,
           MAX(starts_at) FILTER (WHERE status = 'concluido')        AS ultimo_atendimento,
           MIN(starts_at) FILTER (WHERE status = 'concluido')        AS primeiro_atendimento,
           MIN(starts_at) FILTER (
             WHERE status IN ('pendente','confirmado') AND starts_at > now()
           )                                                          AS proximo_atendimento,
           EXTRACT(EPOCH FROM (
             MAX(starts_at) FILTER (WHERE status = 'concluido') -
             MIN(starts_at) FILTER (WHERE status = 'concluido')
           )) / 86400.0 / NULLIF(COUNT(*) FILTER (WHERE status = 'concluido') - 1, 0)
                                                                      AS freq_media_dias,
           EXTRACT(EPOCH FROM (
             now() - MAX(starts_at) FILTER (WHERE status = 'concluido')
           )) / 86400.0                                               AS inativa_dias
         FROM appointments
         WHERE client_id = $1 AND professional_id = $2`,
        [req.params.id, req.professionalId]
      ),
      pool.query(
        `SELECT s.name, COUNT(*)::int AS qtd
         FROM appointments a JOIN services s ON s.id = a.service_id
         WHERE a.client_id = $1 AND a.professional_id = $2 AND a.status = 'concluido'
         GROUP BY s.name ORDER BY qtd DESC LIMIT 1`,
        [req.params.id, req.professionalId]
      ),
    ]);

    const m = metricsResult.rows[0];
    const sf = servicoResult.rows[0];

    res.json({
      client: clientRows[0],
      metrics: {
        totalConcluidos:     m.total_concluidos,
        totalCancelados:     m.total_cancelados,
        totalFaltas:         m.total_faltas,
        valorTotalCents:     m.valor_total_cents,
        ticketMedioCents:    m.ticket_medio_cents,
        primeiroAtendimento: m.primeiro_atendimento,
        ultimoAtendimento:   m.ultimo_atendimento,
        proximoAtendimento:  m.proximo_atendimento,
        freqMediaDias:       m.freq_media_dias != null ? Math.round(Number(m.freq_media_dias)) : null,
        inativaDias:         m.inativa_dias != null ? Math.round(Number(m.inativa_dias)) : null,
        servicoFavorito:     sf?.name ?? null,
      },
      history: historyResult.rows.map((r) => ({
        id:                   r.id,
        starts_at:            r.starts_at,
        ends_at:              r.ends_at,
        status:               r.status,
        service_name:         r.service_name,
        price_cents_snapshot: r.price_cents_snapshot,
        appointment_notes:    r.appointment_notes,
      })),
    });
  } catch (err) {
    next(err);
  }
}

export async function createClient(req, res, next) {
  try {
    const data = clientSchema.parse(req.body);
    const { rows } = await pool.query(
      `INSERT INTO clients (professional_id, name, phone, notes, tags) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [req.professionalId, data.name, data.phone, data.notes ?? null, data.tags ?? []]
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
    const tagsInBody  = 'tags' in req.body;
    const { rows } = await pool.query(
      `UPDATE clients SET
         name  = COALESCE($1, name),
         phone = COALESCE($2, phone),
         notes = CASE WHEN $3 THEN $4 ELSE notes END,
         tags  = CASE WHEN $5 THEN $6 ELSE tags END
       WHERE id = $7 AND professional_id = $8 RETURNING *`,
      [
        data.name, data.phone,
        notesInBody, data.notes ?? null,
        tagsInBody,  data.tags  ?? [],
        req.params.id, req.professionalId,
      ]
    );
    if (!rows[0]) throw new HttpError(404, 'Cliente não encontrada.');
    res.json(rows[0]);
  } catch (err) {
    if (err instanceof z.ZodError) return next(new HttpError(400, 'Dados de cliente inválidos.'));
    next(err);
  }
}
