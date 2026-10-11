/**
 * Central de Suporte: API da ADM (/admin/support/*).
 *
 * Valem as mesmas regras do supportController (transação única sob SELECT ... FOR UPDATE, um INSERT por
 * atividade com ON CONFLICT de alvo explícito, bigint -> Number, nada de texto de mensagem em log/erro) e
 * mais estas:
 *  - Só chega aqui quem passou por requireAdmin (is_admin lido do banco a cada requisição, nunca do token,
 *    do corpo ou de cabeçalhos).
 *  - A ADM enxerga todas as solicitações; o autor das respostas vem da sessão (author_id = req.professionalId).
 *  - Auditoria (migration 024) gravada na MESMA transação da mudança: support_status (mudança manual de
 *    status, inclusive reabertura/resolução), support_priority (mudança real de prioridade) e faq_create /
 *    faq_update / faq_publish / faq_unpublish. O alvo de support_* é a profissional da solicitação (id e nome
 *    do negócio); o de faq_* é o artigo (id e título). Nenhum texto de mensagem nem assunto vai à auditoria.
 *    Responder não é auditado (a conversa é o registro); a mudança automática de status causada pela resposta
 *    fica só no histórico da solicitação.
 *  - O "lido" da ADM (admin_read_seq) é compartilhado entre administradoras (limitação aceita na V1, P9).
 */
import { pool } from '../config/db.js';
import { withTransaction } from './appointmentsController.js';
import { logAdminAction } from '../utils/auditLog.js';
import { planReply, planStatusChange } from '../utils/supportStateMachine.js';
import { planPriorityChange } from '../utils/supportPriority.js';
import { isUnread, nextReadSeq } from '../utils/supportUnread.js';
import {
  sendMessageSchema, readSchema, adminStatusSchema, adminPrioritySchema, adminListTicketsQuerySchema,
  ticketDetailQuerySchema, faqArticleSchema, faqReorderSchema, messageRequestHash,
} from '../utils/supportValidation.js';
import { SupportError, MESSAGES, notFound, refuse, validate, handle, iso } from '../utils/supportHttp.js';

const clip120 = (s) => String(s ?? '').slice(0, 120);

// ── Formatação ──────────────────────────────────────────────────────────────

const TICKET_COLUMNS = `t.id, t.ticket_number, t.category, t.subject, t.status, t.priority, t.priority_source,
  t.activity_seq, t.last_seq, t.last_actor, t.admin_read_seq, t.reopen_count, t.last_activity_at, t.resolved_at,
  t.created_at, p.id AS prof_id, p.name AS prof_name, p.business_name AS prof_business`;
const FROM_TICKETS = 'FROM support_tickets t JOIN professionals p ON p.id = t.professional_id';

function ticketDto(row) {
  return {
    id: row.id,
    ticketNumber: Number(row.ticket_number),
    category: row.category,
    subject: row.subject,
    status: row.status,
    priority: row.priority,
    prioritySource: row.priority_source,
    unread: isUnread('admin', { lastActor: row.last_actor, lastSeq: Number(row.last_seq), adminReadSeq: Number(row.admin_read_seq) }),
    activitySeq: Number(row.activity_seq),
    adminReadSeq: Number(row.admin_read_seq),
    reopenCount: row.reopen_count,
    createdAt: iso(row.created_at),
    lastActivityAt: iso(row.last_activity_at),
    resolvedAt: iso(row.resolved_at),
    professional: { id: row.prof_id, name: row.prof_name, businessName: row.prof_business },
  };
}

const messageDto = (r) => ({ id: r.id, seq: Number(r.seq), authorRole: r.author_role ?? r.role, authorId: r.author_id ?? r.actor_id ?? null, body: r.body, createdAt: iso(r.created_at) });
const eventDto = (r) => ({
  id: r.id, seq: Number(r.seq), type: r.type, from: r.from_value, to: r.to_value, actorRole: r.role, actorId: r.actor_id ?? null, createdAt: iso(r.created_at),
});

async function loadTicket(db, id) {
  const { rows } = await db.query(`SELECT ${TICKET_COLUMNS} ${FROM_TICKETS} WHERE t.id = $1`, [id]);
  return rows[0] ?? null;
}

// Bloqueia a solicitação (e só ela) para a transação e traz o necessário para decidir e auditar.
async function lockTicket(client, id) {
  const { rows } = await client.query(
    `SELECT t.id, t.professional_id, t.status, t.priority, t.priority_source, p.business_name
       FROM support_tickets t JOIN professionals p ON p.id = t.professional_id
      WHERE t.id = $1 FOR UPDATE OF t`,
    [id]
  );
  if (!rows[0]) throw notFound();
  return rows[0];
}

const audit = (req, client, action, targetId, targetBusinessName) =>
  logAdminAction({ actorId: req.professionalId, actorEmail: req.actorEmail, action, targetId, targetBusinessName: clip120(targetBusinessName) }, client);

// ── GET /admin/support/summary ──────────────────────────────────────────────
export const getSummary = handle(async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT count(*) FILTER (WHERE status = 'aberta') AS abertas,
            count(*) FILTER (WHERE status = 'em_atendimento') AS em_atendimento,
            count(*) FILTER (WHERE status = 'aguardando_profissional') AS aguardando,
            count(*) FILTER (WHERE status = 'resolvida' AND resolved_at > now() - interval '7 days') AS resolvidas_7d,
            count(*) FILTER (WHERE last_actor = 'professional' AND last_seq > admin_read_seq) AS nao_lidas
       FROM support_tickets`
  );
  const r = rows[0];
  res.json({
    abertas: Number(r.abertas),
    emAtendimento: Number(r.em_atendimento),
    aguardando: Number(r.aguardando),
    resolvidas7d: Number(r.resolvidas_7d),
    naoLidas: Number(r.nao_lidas),
  });
});

// ── GET /admin/support/tickets ──────────────────────────────────────────────
const TZ = 'America/Sao_Paulo';
const likeEscape = (s) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export const listTickets = handle(async (req, res) => {
  const f = validate(adminListTicketsQuerySchema, req.query);

  const where = [];
  const params = [];
  const add = (sql, value) => { params.push(value); where.push(sql.replace('?', `$${params.length}`)); };
  if (f.status) add('t.status = ?', f.status);
  if (f.priority) add('t.priority = ?', f.priority);
  if (f.category) add('t.category = ?', f.category);
  if (f.professionalId) add('t.professional_id = ?', f.professionalId);
  if (f.from) add(`t.created_at >= (?::date)::timestamp AT TIME ZONE '${TZ}'`, f.from);
  if (f.to) add(`t.created_at < ((?::date) + 1)::timestamp AT TIME ZONE '${TZ}'`, f.to);
  if (f.unread === 'true') where.push(`(t.last_actor = 'professional' AND t.last_seq > t.admin_read_seq)`);
  if (f.q) {
    params.push(`%${likeEscape(f.q)}%`);
    const like = `$${params.length}`;
    let cond = `t.subject ILIKE ${like} ESCAPE '\\' OR p.business_name ILIKE ${like} ESCAPE '\\' OR p.name ILIKE ${like} ESCAPE '\\'`;
    const asNumber = f.q.replace(/^#/, '');
    if (/^\d{1,15}$/.test(asNumber)) { params.push(asNumber); cond += ` OR t.ticket_number = $${params.length}::bigint`; }
    where.push(`(${cond})`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const [count, items] = await Promise.all([
    pool.query(`SELECT count(*) AS total ${FROM_TICKETS} ${whereSql}`, params),
    pool.query(
      `SELECT ${TICKET_COLUMNS} ${FROM_TICKETS} ${whereSql}
        ORDER BY t.last_activity_at DESC, t.id DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, f.pageSize, (f.page - 1) * f.pageSize]
    ),
  ]);
  const total = Number(count.rows[0].total);
  res.json({ items: items.rows.map(ticketDto), page: f.page, pageSize: f.pageSize, total, totalPages: Math.max(1, Math.ceil(total / f.pageSize)) });
});

// ── GET /admin/support/tickets/:id ──────────────────────────────────────────
const SEQ_MAX = '9223372036854775807';

export const getTicket = handle(async (req, res) => {
  const { before, limit } = validate(ticketDetailQuerySchema, req.query);
  const ticket = await loadTicket(pool, req.params.id);
  if (!ticket) throw notFound();

  const { rows } = await pool.query(
    `SELECT * FROM (
        SELECT 'message' AS kind, id, seq, author_role AS role, author_id AS actor_id, body, NULL::text AS type,
               NULL::text AS from_value, NULL::text AS to_value, created_at
          FROM support_messages WHERE ticket_id = $1 AND seq < $2::bigint
        UNION ALL
        SELECT 'event', id, seq, actor_role, actor_id, NULL, type, from_value, to_value, created_at
          FROM support_ticket_events WHERE ticket_id = $1 AND seq < $2::bigint
      ) a ORDER BY seq DESC LIMIT $3`,
    [req.params.id, before === undefined ? SEQ_MAX : String(before), limit + 1]
  );
  const hasMore = rows.length > limit;
  const window = rows.slice(0, limit).reverse();
  res.json({
    ticket: ticketDto(ticket),
    messages: window.filter((r) => r.kind === 'message').map(messageDto),
    events: window.filter((r) => r.kind === 'event').map(eventDto),
    hasMore,
    nextBefore: hasMore ? Number(window[0].seq) : null,
  });
});

// ── POST /admin/support/tickets/:id/messages ────────────────────────────────
export const sendMessage = handle(async (req, res) => {
  const data = validate(sendMessageSchema, req.body);
  const adminId = req.professionalId;
  const hash = messageRequestHash(data);

  const out = await withTransaction(async (client) => {
    const t = await lockTicket(client, req.params.id);

    const prior = await client.query(
      `SELECT id, seq, author_role, author_id, body, created_at, request_hash FROM support_messages
        WHERE ticket_id = $1 AND client_message_id = $2`,
      [t.id, data.clientMessageId]
    );
    if (prior.rows[0]) {
      if (prior.rows[0].request_hash !== hash) throw new SupportError(409, MESSAGES.idempotency_conflict, { reason: 'idempotency_conflict' });
      return { created: false, message: prior.rows[0] };
    }

    // Resposta da ADM: aberta/em_atendimento -> aguardando_profissional; em solicitação resolvida, 409.
    const plan = planReply({ actor: 'admin', status: t.status });
    if (!plan.ok) throw refuse(plan);

    const ins = await client.query(
      `INSERT INTO support_messages (ticket_id, professional_id, author_role, author_id, body, client_message_id, request_hash)
       VALUES ($1, $2, 'admin', $3, $4, $5, $6)
       ON CONFLICT (ticket_id, client_message_id) WHERE client_message_id IS NOT NULL DO NOTHING
       RETURNING id, seq, author_role, author_id, body, created_at`,
      [t.id, t.professional_id, adminId, data.body, data.clientMessageId, hash]
    );
    if (!ins.rows[0]) throw new SupportError(409, MESSAGES.idempotency_conflict, { reason: 'idempotency_conflict' }); // inalcançável sob o lock

    if (plan.to) {
      const upd = await client.query('UPDATE support_tickets SET status = $2 WHERE id = $1 AND status = $3', [t.id, plan.to, t.status]);
      if (upd.rowCount !== 1) throw new SupportError(409, MESSAGES.stale_status, { reason: 'stale_status' });
      await client.query(
        `INSERT INTO support_ticket_events (ticket_id, professional_id, type, from_value, to_value, actor_role, actor_id)
         VALUES ($1, $2, $3, $4, $5, 'admin', $6)`,
        [t.id, t.professional_id, plan.event.type, plan.event.from, plan.event.to, adminId]
      );
    }
    return { created: true, message: ins.rows[0] };
  });

  const ticket = await loadTicket(pool, req.params.id);
  res.status(out.created ? 201 : 200).json({ message: messageDto(out.message), ticket: ticketDto(ticket) });
});

// ── POST /admin/support/tickets/:id/status ──────────────────────────────────
export const changeStatus = handle(async (req, res) => {
  const data = validate(adminStatusSchema, req.body);
  const adminId = req.professionalId;

  await withTransaction(async (client) => {
    const t = await lockTicket(client, req.params.id);
    const plan = planStatusChange({ actor: 'admin', from: t.status, to: data.status, expectedStatus: data.expectedStatus });
    if (!plan.ok) throw refuse(plan);
    if (plan.noop) return; // já está nesse status: 200 sem evento nem auditoria

    const upd = await client.query(
      `UPDATE support_tickets
          SET status = $2,
              resolved_at = CASE WHEN $3::boolean THEN now() WHEN $4::boolean THEN NULL ELSE resolved_at END,
              resolved_by = CASE WHEN $3::boolean THEN $5::uuid WHEN $4::boolean THEN NULL ELSE resolved_by END
        WHERE id = $1 AND status = $6`,
      [t.id, plan.to, plan.setsResolved, plan.clearsResolved, adminId, t.status]
    );
    if (upd.rowCount !== 1) throw new SupportError(409, MESSAGES.stale_status, { reason: 'stale_status' });
    await client.query(
      `INSERT INTO support_ticket_events (ticket_id, professional_id, type, from_value, to_value, actor_role, actor_id)
       VALUES ($1, $2, $3, $4, $5, 'admin', $6)`,
      [t.id, t.professional_id, plan.event.type, plan.event.from, plan.event.to, adminId]
    );
    await audit(req, client, 'support_status', t.professional_id, t.business_name);
  });

  res.json({ ticket: ticketDto(await loadTicket(pool, req.params.id)) });
});

// ── PUT /admin/support/tickets/:id/priority ─────────────────────────────────
export const changePriority = handle(async (req, res) => {
  const data = validate(adminPrioritySchema, req.body);
  const adminId = req.professionalId;

  await withTransaction(async (client) => {
    const t = await lockTicket(client, req.params.id);
    const plan = planPriorityChange({ actor: 'admin', current: t.priority, source: t.priority_source, to: data.priority });
    if (!plan.ok) throw new SupportError(plan.status, MESSAGES[plan.reason] ?? 'Prioridade inválida.', { reason: plan.reason });
    if (plan.noop) return;

    await client.query('UPDATE support_tickets SET priority = $2, priority_source = $3 WHERE id = $1', [t.id, plan.to, plan.source]);
    if (plan.event) {
      // Evento de prioridade consome seq mas não notifica a profissional (regra do banco).
      await client.query(
        `INSERT INTO support_ticket_events (ticket_id, professional_id, type, from_value, to_value, actor_role, actor_id)
         VALUES ($1, $2, $3, $4, $5, 'admin', $6)`,
        [t.id, t.professional_id, plan.event.type, plan.event.from, plan.event.to, adminId]
      );
      await audit(req, client, 'support_priority', t.professional_id, t.business_name);
    }
  });

  res.json({ ticket: ticketDto(await loadTicket(pool, req.params.id)) });
});

// ── POST /admin/support/tickets/:id/read ────────────────────────────────────
export const markRead = handle(async (req, res) => {
  const { upToSeq } = validate(readSchema, req.body);
  await withTransaction(async (client) => {
    const { rows } = await client.query('SELECT activity_seq, admin_read_seq FROM support_tickets WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (!rows[0]) throw notFound();
    const current = Number(rows[0].admin_read_seq);
    const next = nextReadSeq({ current, upToSeq, activitySeq: Number(rows[0].activity_seq) });
    if (next > current) await client.query('UPDATE support_tickets SET admin_read_seq = $2::bigint WHERE id = $1', [req.params.id, String(next)]);
  });
  res.status(204).end();
});

// ── FAQ ─────────────────────────────────────────────────────────────────────

const articleDto = (a) => ({
  id: a.id, categorySlug: a.category_slug, title: a.title, body: a.body, position: Number(a.position), status: a.status,
  publishedAt: iso(a.published_at), createdAt: iso(a.created_at), updatedAt: iso(a.updated_at), createdBy: a.created_by, updatedBy: a.updated_by,
});

const notFoundArticle = () => new SupportError(404, 'Artigo não encontrado.');

async function lockArticle(client, id) {
  const { rows } = await client.query('SELECT * FROM support_faq_articles WHERE id = $1 FOR UPDATE', [id]);
  if (!rows[0]) throw notFoundArticle();
  return rows[0];
}

export const getFaq = handle(async (_req, res) => {
  const [categories, articles] = await Promise.all([
    pool.query('SELECT slug, title, position FROM support_faq_categories ORDER BY position'),
    pool.query(
      `SELECT a.* FROM support_faq_articles a JOIN support_faq_categories c ON c.slug = a.category_slug
        ORDER BY c.position, a.position, a.title, a.id`
    ),
  ]);
  res.json({
    categories: categories.rows.map((c) => ({ slug: c.slug, title: c.title, position: Number(c.position) })),
    articles: articles.rows.map(articleDto),
  });
});

export const createArticle = handle(async (req, res) => {
  const data = validate(faqArticleSchema, req.body);
  const adminId = req.professionalId;
  const article = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO support_faq_articles (category_slug, title, body, position, created_by, updated_by)
       VALUES ($1, $2, $3,
               COALESCE($4::int, (SELECT COALESCE(max(position), 0) + 1 FROM support_faq_articles WHERE category_slug = $1)),
               $5, $5)
       RETURNING *`,
      [data.categorySlug, data.title, data.body, data.position ?? null, adminId]
    );
    await audit(req, client, 'faq_create', rows[0].id, rows[0].title);
    return rows[0];
  });
  res.status(201).json({ article: articleDto(article) });
});

export const updateArticle = handle(async (req, res) => {
  const data = validate(faqArticleSchema, req.body);
  const adminId = req.professionalId;
  const article = await withTransaction(async (client) => {
    const cur = await lockArticle(client, req.params.id);
    const same = cur.category_slug === data.categorySlug && cur.title === data.title && cur.body === data.body
      && (data.position === undefined || Number(cur.position) === data.position);
    if (same) return cur; // nada mudou: 200 sem auditoria
    const { rows } = await client.query(
      `UPDATE support_faq_articles
          SET category_slug = $2, title = $3, body = $4, position = COALESCE($5::int, position), updated_by = $6
        WHERE id = $1 RETURNING *`,
      [cur.id, data.categorySlug, data.title, data.body, data.position ?? null, adminId]
    );
    await audit(req, client, 'faq_update', cur.id, rows[0].title);
    return rows[0];
  });
  res.json({ article: articleDto(article) });
});

function setPublished(publish) {
  return handle(async (req, res) => {
    const adminId = req.professionalId;
    const article = await withTransaction(async (client) => {
      const cur = await lockArticle(client, req.params.id);
      if ((cur.status === 'publicado') === publish) return cur; // já está assim: 200 sem auditoria
      const { rows } = await client.query(
        `UPDATE support_faq_articles
            SET status = $2, published_at = CASE WHEN $2 = 'publicado' THEN now() ELSE NULL END, updated_by = $3
          WHERE id = $1 RETURNING *`,
        [cur.id, publish ? 'publicado' : 'rascunho', adminId]
      );
      await audit(req, client, publish ? 'faq_publish' : 'faq_unpublish', cur.id, cur.title);
      return rows[0];
    });
    res.json({ article: articleDto(article) });
  });
}
export const publishArticle = setPublished(true);
export const unpublishArticle = setPublished(false);

// Reordenar: a lista deve conter EXATAMENTE os artigos da categoria (rascunhos inclusive). Posições 1..n.
// Cada artigo cuja posição mudou gera uma linha faq_update na auditoria.
export const reorderFaq = handle(async (req, res) => {
  const data = validate(faqReorderSchema, req.body);
  const adminId = req.professionalId;
  await withTransaction(async (client) => {
    const { rows } = await client.query(
      'SELECT id, title, position FROM support_faq_articles WHERE category_slug = $1 ORDER BY id FOR UPDATE',
      [data.categorySlug]
    );
    const known = new Set(rows.map((r) => r.id));
    if (known.size !== data.orderedIds.length || !data.orderedIds.every((id) => known.has(id))) {
      throw new SupportError(400, 'A lista deve conter exatamente os artigos da categoria.', { fields: [{ field: 'orderedIds', message: 'A lista deve conter exatamente os artigos da categoria.' }] });
    }
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const [i, id] of data.orderedIds.entries()) {
      const a = byId.get(id);
      if (Number(a.position) === i + 1) continue;
      await client.query('UPDATE support_faq_articles SET position = $2, updated_by = $3 WHERE id = $1', [id, i + 1, adminId]);
      await audit(req, client, 'faq_update', id, a.title);
    }
  });
  res.status(204).end();
});
