/**
 * Central de Suporte: "não lida" por cursor de sequência (domínio puro). Sem horários, como na migration 023.
 *
 *   não lida p/ a profissional: last_actor = 'admin'        AND last_seq > prof_read_seq
 *   não lida p/ o ADM        : last_actor = 'professional'  AND last_seq > admin_read_seq
 *
 * last_seq/last_actor são derivados no banco da última atividade que NOTIFICA a outra parte; o ajuste de
 * prioridade e os eventos do sistema consomem seq mas não notificam (ver activityNotifies).
 */

/** Espelha o trigger support_tickets_guard: mensagens sempre notificam; eventos só se não forem de prioridade nem do sistema. */
export function activityNotifies({ kind, type, actorRole }) {
  if (kind === 'message') return true;
  if (kind === 'event') return type !== 'priority_changed' && actorRole !== 'system';
  return false;
}

/** A solicitação tem novidade para esse lado? `side` é 'professional' ou 'admin'. */
export function isUnread(side, ticket) {
  const { lastActor, lastSeq } = ticket;
  if (side === 'professional') return lastActor === 'admin' && lastSeq > ticket.profReadSeq;
  if (side === 'admin') return lastActor === 'professional' && lastSeq > ticket.adminReadSeq;
  return false;
}

export function countUnread(side, tickets) {
  return tickets.reduce((n, t) => n + (isUnread(side, t) ? 1 : 0), 0);
}

/**
 * Novo valor do cursor depois de um "marcar como lida" com upToSeq:
 * GREATEST(atual, upToSeq), limitado ao activity_seq (não se marca como lido o que ainda não existe).
 * Nunca retrocede; repetir a chamada dá o mesmo resultado; algo posterior ao upToSeq continua não lido.
 */
export function nextReadSeq({ current, upToSeq, activitySeq }) {
  const target = Math.min(upToSeq, activitySeq);
  return Math.max(current, target);
}
