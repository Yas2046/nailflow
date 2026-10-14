/**
 * Central de Suporte: API da profissional (/support/*).
 *
 * Regras que valem para todas as rotas:
 *  - A titular vem SEMPRE da sessão (req.professionalId, definido pelo requireAuth a partir do banco). Nenhum
 *    id de profissional, papel ou autor é aceito do corpo; toda consulta filtra por professional_id.
 *    Solicitação inexistente ou de outra conta devolve o mesmo 404.
 *  - Cada atividade (mensagem ou evento) é um INSERT próprio, com ON CONFLICT de alvo explícito quando há
 *    idempotência (contrato de inserção do cabeçalho da migration 023). Os triggers do banco atribuem o seq.
 *  - Toda escrita roda em UMA transação, sob SELECT ... FOR UPDATE do ticket (ou lock da profissional na
 *    criação): mensagem, mudança de status e evento são confirmados juntos ou nenhum deles.
 *  - pg devolve bigint como string: ticket_number e os seq são convertidos para Number (muito abaixo de 2^53).
 *  - Nunca se grava nem se registra o conteúdo das mensagens em log: erros do banco são reduzidos a
 *    código/constraint antes de seguir (o DETAIL de um CHECK pode conter a linha inteira).
 */
import { pool } from '../config/db.js';
import { SUPPORT_CENTER_ENABLED } from '../config/support.js';
import { withTransaction } from './appointmentsController.js';
import {
  canOpenTicket, planReply, planProfessionalReopen, reopenDeadline, isWithinReopenWindow, MAX_OPEN_TICKETS,
} from '../utils/supportStateMachine.js';
import { suggestPriority } from '../utils/supportPriority.js';
import { isUnread, nextReadSeq } from '../utils/supportUnread.js';
import {
  createTicketSchema, sendMessageSchema, reopenSchema, readSchema, preferencesSchema,
  listTicketsQuerySchema, ticketDetailQuerySchema, ticketRequestHash, messageRequestHash,
} from '../utils/supportValidation.js';
import { SupportError, MESSAGES, notFound, refuse, validate, handle, iso } from '../utils/supportHttp.js';

// ── Erros ───────────────────────────────────────────────────────────────────
// SupportError, validate, handle e sanitizeError ficam em utils/supportHttp.js (compartilhados com a ADM).

const TOO_MANY_OPEN = `Você já tem ${MAX_OPEN_TICKETS} solicitações abertas. Aguarde a resolução de alguma antes de abrir outra.`;

// ── Formatação ──────────────────────────────────────────────────────────────

function ticketDto(row) {
  const t = {
    lastActor: row.last_actor,
    lastSeq: Number(row.last_seq),
    profReadSeq: Number(row.prof_read_seq),
  };
  const open = row.status !== 'resolvida';
  let canReopenUntil = null;
  if (!open && isWithinReopenWindow(row.resolved_at, row.db_now)) canReopenUntil = iso(reopenDeadline(row.resolved_at));
  // Prioridade e cursor da ADM não fazem parte da visão da profissional.
  return {
    id: row.id,
    ticketNumber: Number(row.ticket_number),
    category: row.category,
    subject: row.subject,
    status: row.status,
    unread: isUnread('professional', t),
    activitySeq: Number(row.activity_seq),
    profReadSeq: t.profReadSeq,
    createdAt: iso(row.created_at),
    lastActivityAt: iso(row.last_activity_at),
    resolvedAt: iso(row.resolved_at),
    canReopenUntil,
  };
}

const TICKET_COLUMNS = `t.id, t.ticket_number, t.category, t.subject, t.status, t.activity_seq, t.last_seq,
  t.last_actor, t.prof_read_seq, t.last_activity_at, t.resolved_at, t.created_at, now() AS db_now`;

const messageDto = (r) => ({ id: r.id, seq: Number(r.seq), authorRole: r.author_role ?? r.role, body: r.body, createdAt: iso(r.created_at) });
const eventDto = (r) => ({
  id: r.id, seq: Number(r.seq), type: r.type, from: r.from_value, to: r.to_value, actorRole: r.role, createdAt: iso(r.created_at),
});

async function loadOwnTicket(db, id, professionalId) {
  const { rows } = await db.query(
    `SELECT ${TICKET_COLUMNS} FROM support_tickets t WHERE t.id = $1 AND t.professional_id = $2`,
    [id, professionalId]
  );
  return rows[0] ?? null;
}

// ── GET /support/bootstrap ──────────────────────────────────────────────────
// Única rota que responde com o interruptor desligado ({ enabled: false }, sem tocar em dados de suporte).
export const getBootstrap = handle(async (req, res) => {
  if (!SUPPORT_CENTER_ENABLED) return res.json({ enabled: false, fabHidden: false, unreadTickets: 0, unreadIds: [] });
  if (req.isAdmin) throw new SupportError(403, MESSAGES.forbidden);

  const pid = req.professionalId;
  const [pref, unread] = await Promise.all([
    pool.query('SELECT support_fab_hidden FROM professionals WHERE id = $1', [pid]),
    pool.query(
      `SELECT id, count(*) OVER () AS total
         FROM support_tickets
        WHERE professional_id = $1 AND last_actor = 'admin' AND last_seq > prof_read_seq
        ORDER BY last_activity_at DESC, id DESC
        LIMIT 20`,
      [pid]
    ),
  ]);
  res.json({
    enabled: true,
    fabHidden: pref.rows[0]?.support_fab_hidden === true,
    unreadTickets: unread.rows.length ? Number(unread.rows[0].total) : 0,
    unreadIds: unread.rows.map((r) => r.id),
  });
});

// ── GET /support/faq ────────────────────────────────────────────────────────
export const getFaq = handle(async (_req, res) => {
  const [categories, articles] = await Promise.all([
    pool.query('SELECT slug, title, position FROM support_faq_categories ORDER BY position'),
    pool.query(
      `SELECT id, category_slug, title, body, position, published_at
         FROM support_faq_articles WHERE status = 'publicado'
        ORDER BY category_slug, position, title`
    ),
  ]);
  res.json({
    categories: categories.rows.map((c) => ({ slug: c.slug, title: c.title, position: Number(c.position) })),
    articles: articles.rows.map((a) => ({
      id: a.id, categorySlug: a.category_slug, title: a.title, body: a.body, position: Number(a.position), publishedAt: iso(a.published_at),
    })),
  });
});

// ── GET /support/tickets ────────────────────────────────────────────────────
const likeEscape = (s) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export const listTickets = handle(async (req, res) => {
  const { status, q, page, pageSize } = validate(listTicketsQuerySchema, req.query);
  const pid = req.professionalId;

  const where = ['t.professional_id = $1'];
  const params = [pid];
  if (status) { params.push(status); where.push(`t.status = $${params.length}`); }
  if (q) {
    const asNumber = q.replace(/^#/, '');
    params.push(`%${likeEscape(q)}%`);
    let cond = `t.subject ILIKE $${params.length} ESCAPE '\\'`;
    if (/^\d{1,15}$/.test(asNumber)) { params.push(asNumber); cond += ` OR t.ticket_number = $${params.length}::bigint`; }
    where.push(`(${cond})`);
  }
  const whereSql = where.join(' AND ');

  const [count, items] = await Promise.all([
    pool.query(`SELECT count(*) AS total FROM support_tickets t WHERE ${whereSql}`, params),
    pool.query(
      `SELECT ${TICKET_COLUMNS} FROM support_tickets t WHERE ${whereSql}
        ORDER BY t.last_activity_at DESC, t.id DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pageSize, (page - 1) * pageSize]
    ),
  ]);
  const total = Number(count.rows[0].total);
  res.json({ items: items.rows.map(ticketDto), page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) });
});

// ── GET /support/tickets/:id ────────────────────────────────────────────────
const SEQ_MAX = '9223372036854775807';

export const getTicket = handle(async (req, res) => {
  const { before, limit } = validate(ticketDetailQuerySchema, req.query);
  const pid = req.professionalId;
  const ticket = await loadOwnTicket(pool, req.params.id, pid);
  if (!ticket) throw notFound();

  // Janela das últimas atividades (mensagens e eventos juntos, por seq). Prioridade não é visível à profissional.
  const { rows } = await pool.query(
    `SELECT * FROM (
        SELECT 'message' AS kind, id, seq, author_role AS role, body, NULL::text AS type,
               NULL::text AS from_value, NULL::text AS to_value, created_at
          FROM support_messages WHERE ticket_id = $1 AND professional_id = $2 AND seq < $3::bigint
        UNION ALL
        SELECT 'event', id, seq, actor_role, NULL, type, from_value, to_value, created_at
          FROM support_ticket_events
         WHERE ticket_id = $1 AND professional_id = $2 AND type <> 'priority_changed' AND seq < $3::bigint
      ) a ORDER BY seq DESC LIMIT $4`,
    [req.params.id, pid, before === undefined ? SEQ_MAX : String(before), limit + 1]
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

// ── POST /support/tickets ───────────────────────────────────────────────────
export const createTicket = handle(async (req, res) => {
  const data = validate(createTicketSchema, req.body);
  const pid = req.professionalId;
  const hash = ticketRequestHash(data);

  const out = await withTransaction(async (client) => {
    // Serializa as criações da mesma profissional: o limite de abertas e a idempotência são decididos
    // com este lock (xact: solta no COMMIT/ROLLBACK).
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`support_open:${pid}`]);

    const prior = await client.query(
      'SELECT id, request_hash FROM support_tickets WHERE professional_id = $1 AND client_request_id = $2',
      [pid, data.clientRequestId]
    );
    if (prior.rows[0]) {
      if (prior.rows[0].request_hash !== hash) throw new SupportError(409, MESSAGES.idempotency_conflict, { reason: 'idempotency_conflict' });
      return { created: false, id: prior.rows[0].id };
    }

    const open = await client.query(
      `SELECT count(*) AS n FROM support_tickets WHERE professional_id = $1 AND status <> 'resolvida'`,
      [pid]
    );
    if (!canOpenTicket(Number(open.rows[0].n))) throw new SupportError(409, TOO_MANY_OPEN, { reason: 'too_many_open' });

    let relatedId = null;
    if (data.relatedTicketNumber !== undefined) {
      const rel = await client.query(
        'SELECT id FROM support_tickets WHERE ticket_number = $1::bigint AND professional_id = $2',
        [String(data.relatedTicketNumber), pid]
      );
      if (!rel.rows[0]) throw new SupportError(400, 'Solicitação relacionada não encontrada.', { fields: [{ field: 'relatedTicketNumber', message: 'Solicitação relacionada não encontrada.' }] });
      relatedId = rel.rows[0].id;
    }

    const ins = await client.query(
      `INSERT INTO support_tickets
         (professional_id, category, subject, priority, priority_source, related_ticket_id, client_request_id, request_hash)
       VALUES ($1, $2, $3, $4, 'auto', $5, $6, $7)
       ON CONFLICT (professional_id, client_request_id) WHERE client_request_id IS NOT NULL DO NOTHING
       RETURNING id`,
      [pid, data.category, data.subject, suggestPriority(data), relatedId, data.clientRequestId, hash]
    );
    if (!ins.rows[0]) throw new SupportError(409, MESSAGES.idempotency_conflict, { reason: 'idempotency_conflict' }); // inalcançável sob o lock
    const ticketId = ins.rows[0].id;

    // Uma atividade por INSERT: evento 'created' (seq 1) e depois a descrição como primeira mensagem (seq 2).
    await client.query(
      `INSERT INTO support_ticket_events (ticket_id, professional_id, type, actor_role, actor_id)
       VALUES ($1, $2, 'created', 'professional', $2)
       ON CONFLICT (ticket_id) WHERE type = 'created' DO NOTHING`,
      [ticketId, pid]
    );
    await client.query(
      `INSERT INTO support_messages (ticket_id, professional_id, author_role, author_id, body)
       VALUES ($1, $2, 'professional', $2, $3)`,
      [ticketId, pid, data.body]
    );
    return { created: true, id: ticketId };
  });

  const ticket = await loadOwnTicket(pool, out.id, pid);
  res.status(out.created ? 201 : 200).json({ ticket: ticketDto(ticket) });
});

// ── POST /support/tickets/:id/messages ──────────────────────────────────────
export const sendMessage = handle(async (req, res) => {
  const data = validate(sendMessageSchema, req.body);
  const pid = req.professionalId;
  const hash = messageRequestHash(data);

  const out = await withTransaction(async (client) => {
    const locked = await client.query(
      'SELECT id, status FROM support_tickets WHERE id = $1 AND professional_id = $2 FOR UPDATE',
      [req.params.id, pid]
    );
    const t = locked.rows[0];
    if (!t) throw notFound();

    // Repetição do mesmo identificador: devolve a mensagem original (mesmo conteúdo) ou 409 (conteúdo diferente).
    // Vem antes da regra de "resolvida": reenviar algo já gravado não deve virar erro.
    const prior = await client.query(
      `SELECT id, seq, author_role, body, created_at, request_hash FROM support_messages
        WHERE ticket_id = $1 AND client_message_id = $2`,
      [t.id, data.clientMessageId]
    );
    if (prior.rows[0]) {
      if (prior.rows[0].request_hash !== hash) throw new SupportError(409, MESSAGES.idempotency_conflict, { reason: 'idempotency_conflict' });
      return { created: false, message: prior.rows[0] };
    }

    const plan = planReply({ actor: 'professional', status: t.status });
    if (!plan.ok) throw refuse(plan);

    const ins = await client.query(
      `INSERT INTO support_messages (ticket_id, professional_id, author_role, author_id, body, client_message_id, request_hash)
       VALUES ($1, $2, 'professional', $2, $3, $4, $5)
       ON CONFLICT (ticket_id, client_message_id) WHERE client_message_id IS NOT NULL DO NOTHING
       RETURNING id, seq, author_role, body, created_at`,
      [t.id, pid, data.body, data.clientMessageId, hash]
    );
    if (!ins.rows[0]) throw new SupportError(409, MESSAGES.idempotency_conflict, { reason: 'idempotency_conflict' }); // inalcançável sob o lock

    if (plan.to) {
      const upd = await client.query(
        'UPDATE support_tickets SET status = $3 WHERE id = $1 AND professional_id = $2 AND status = $4',
        [t.id, pid, plan.to, t.status]
      );
      if (upd.rowCount !== 1) throw new SupportError(409, 'A solicitação foi alterada. Atualize e tente de novo.', { reason: 'stale_status' });
      await client.query(
        `INSERT INTO support_ticket_events (ticket_id, professional_id, type, from_value, to_value, actor_role, actor_id)
         VALUES ($1, $2, $3, $4, $5, 'professional', $2)`,
        [t.id, pid, plan.event.type, plan.event.from, plan.event.to]
      );
    }
    return { created: true, message: ins.rows[0] };
  });

  const ticket = await loadOwnTicket(pool, req.params.id, pid);
  res.status(out.created ? 201 : 200).json({ message: messageDto(out.message), ticket: ticketDto(ticket) });
});

// ── POST /support/tickets/:id/reopen ────────────────────────────────────────
export const reopenTicket = handle(async (req, res) => {
  const data = validate(reopenSchema, req.body);
  const pid = req.professionalId;

  await withTransaction(async (client) => {
    // Mesmo lock da criação (e na mesma ordem: lock da profissional, depois o da solicitação): criar e reabrir
    // concorrentes são serializados e a contagem de abertas vale para os dois.
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`support_open:${pid}`]);
    const locked = await client.query(
      `SELECT id, status, resolved_at, now() AS db_now FROM support_tickets
        WHERE id = $1 AND professional_id = $2 FOR UPDATE`,
      [req.params.id, pid]
    );
    const t = locked.rows[0];
    if (!t) throw notFound();

    // O prazo de 7 x 24 h é decidido com o relógio do banco, o mesmo que gravou resolved_at.
    const plan = planProfessionalReopen({ actor: 'professional', status: t.status, resolvedAt: t.resolved_at, now: t.db_now });
    if (!plan.ok) throw refuse(plan);

    // Reabrir torna a solicitação "aberta" de novo: vale o mesmo limite da criação (D5). A resolvida em questão
    // não entra na contagem; recusa antes de qualquer escrita.
    const open = await client.query(
      `SELECT count(*) AS n FROM support_tickets WHERE professional_id = $1 AND status <> 'resolvida'`,
      [pid]
    );
    if (!canOpenTicket(Number(open.rows[0].n))) throw new SupportError(409, TOO_MANY_OPEN, { reason: 'too_many_open' });

    const upd = await client.query(
      `UPDATE support_tickets
          SET status = $3, resolved_at = NULL, resolved_by = NULL, reopen_count = reopen_count + $4
        WHERE id = $1 AND professional_id = $2 AND status = 'resolvida'`,
      [t.id, pid, plan.to, plan.reopenCountDelta]
    );
    if (upd.rowCount !== 1) throw new SupportError(409, MESSAGES.not_resolved, { reason: 'not_resolved' });

    await client.query(
      `INSERT INTO support_ticket_events (ticket_id, professional_id, type, from_value, to_value, actor_role, actor_id)
       VALUES ($1, $2, $3, $4, $5, 'professional', $2)`,
      [t.id, pid, plan.event.type, plan.event.from, plan.event.to]
    );
    await client.query(
      `INSERT INTO support_messages (ticket_id, professional_id, author_role, author_id, body)
       VALUES ($1, $2, 'professional', $2, $3)`,
      [t.id, pid, data.body]
    );
  });

  const ticket = await loadOwnTicket(pool, req.params.id, pid);
  res.json({ ticket: ticketDto(ticket) });
});

// ── POST /support/tickets/:id/read ──────────────────────────────────────────
// Cursor monotônico: GREATEST(atual, upToSeq) limitado ao activity_seq (nextReadSeq, aqui feito no SQL).
export const markRead = handle(async (req, res) => {
  const { upToSeq } = validate(readSchema, req.body);
  const pid = req.professionalId;

  await withTransaction(async (client) => {
    const { rows } = await client.query(
      'SELECT activity_seq, prof_read_seq FROM support_tickets WHERE id = $1 AND professional_id = $2 FOR UPDATE',
      [req.params.id, pid]
    );
    if (!rows[0]) throw notFound();
    const next = nextReadSeq({ current: Number(rows[0].prof_read_seq), upToSeq, activitySeq: Number(rows[0].activity_seq) });
    if (next > Number(rows[0].prof_read_seq)) {
      await client.query('UPDATE support_tickets SET prof_read_seq = $3::bigint WHERE id = $1 AND professional_id = $2', [req.params.id, pid, String(next)]);
    }
  });
  res.status(204).end();
});

// ── PUT /support/preferences ────────────────────────────────────────────────
export const updatePreferences = handle(async (req, res) => {
  const { fabHidden } = validate(preferencesSchema, req.body);
  const { rows } = await pool.query(
    'UPDATE professionals SET support_fab_hidden = $2 WHERE id = $1 RETURNING support_fab_hidden',
    [req.professionalId, fabHidden]
  );
  res.json({ fabHidden: rows[0].support_fab_hidden === true });
});
