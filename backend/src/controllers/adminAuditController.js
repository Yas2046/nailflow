import { z } from 'zod';
import { pool } from '../config/db.js';
import { HttpError } from '../middleware/errorHandler.js';

// Consulta SOMENTE LEITURA do admin_audit_log (migration 019). O log guarda,
// por ação administrativa concluída com sucesso: quem fez (actor_id/actor_email),
// o quê (block | unblock | update | delete), em qual conta (target_id/
// target_business_name) e quando (created_at). Nada além disso existe no
// banco, e nada além disso é devolvido aqui.

const TZ = 'America/Sao_Paulo';
export const AUDIT_ACTIONS = ['block', 'unblock', 'update', 'delete'];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isRealDate(s) {
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

const dateParam = z
  .string()
  .regex(DATE_RE, 'Data inválida. Use o formato AAAA-MM-DD.')
  .refine(isRealDate, 'Data inválida.');

const querySchema = z.object({
  page: z.coerce.number({ invalid_type_error: 'Página inválida.' }).int('Página inválida.').min(1, 'Página inválida.').max(100000, 'Página inválida.').default(1),
  pageSize: z.coerce.number({ invalid_type_error: 'Tamanho de página inválido.' }).int('Tamanho de página inválido.').min(1, 'Tamanho de página inválido.').max(50, 'O tamanho máximo da página é 50.').default(20),
  action: z.enum(AUDIT_ACTIONS, { errorMap: () => ({ message: 'Ação inválida.' }) }).optional(),
  from: dateParam.optional(),
  to: dateParam.optional(),
});

// "", "all" e ausente significam "sem filtro".
function normalize(query) {
  const clean = (v) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined);
  const action = clean(query.action);
  return {
    page: clean(query.page),
    pageSize: clean(query.pageSize),
    action: action === 'all' ? undefined : action,
    from: clean(query.from),
    to: clean(query.to),
  };
}

function toDto(row) {
  return {
    id: row.id,
    action: row.action,
    actorId: row.actor_id,
    actorEmail: row.actor_email,
    targetId: row.target_id,
    targetBusinessName: row.target_business_name,
    createdAt: row.created_at,
  };
}

// GET /admin/audit-log?page=1&pageSize=20&action=block&from=2026-10-01&to=2026-10-31
// Mais recentes primeiro. `from`/`to` são datas do dia em America/Sao_Paulo (inclusivas).
// `summary` (ações hoje / últimos 7 dias) não depende dos filtros.
export async function listAuditLog(req, res, next) {
  try {
    const parsed = querySchema.safeParse(normalize(req.query));
    if (!parsed.success) {
      throw new HttpError(400, parsed.error.errors[0]?.message ?? 'Parâmetros inválidos.');
    }
    const { page, pageSize, action, from, to } = parsed.data;
    if (from && to && from > to) {
      throw new HttpError(400, 'A data inicial não pode ser depois da data final.');
    }

    const where = [];
    const params = [];
    if (action) { params.push(action); where.push(`action = $${params.length}`); }
    if (from) { params.push(from); where.push(`created_at >= ($${params.length}::date::timestamp AT TIME ZONE '${TZ}')`); }
    if (to) { params.push(to); where.push(`created_at < (($${params.length}::date + 1)::timestamp AT TIME ZONE '${TZ}')`); }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const [{ rows: countRows }, { rows: itemRows }, { rows: summaryRows }] = await Promise.all([
      pool.query(`SELECT count(*)::int AS total FROM admin_audit_log ${whereSql}`, params),
      pool.query(
        `SELECT id, action, actor_id, actor_email, target_id, target_business_name, created_at
         FROM admin_audit_log ${whereSql}
         ORDER BY created_at DESC, id DESC
         LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
        params
      ),
      pool.query(
        `SELECT
           count(*) FILTER (WHERE created_at >= (date_trunc('day', now() AT TIME ZONE '${TZ}') AT TIME ZONE '${TZ}'))::int AS today,
           count(*) FILTER (WHERE created_at >= now() - interval '7 days')::int AS last7_days
         FROM admin_audit_log`
      ),
    ]);

    const total = countRows[0].total;
    res.json({
      items: itemRows.map(toDto),
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      summary: { today: summaryRows[0].today, last7Days: summaryRows[0].last7_days },
    });
  } catch (err) {
    next(err);
  }
}
