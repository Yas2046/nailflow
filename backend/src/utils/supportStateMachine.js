/**
 * Central de Suporte: regras de estado das solicitações (domínio puro, sem banco nem Express).
 *
 * As funções só DECIDEM; quem grava (controller, sob SELECT ... FOR UPDATE) aplica o plano devolvido
 * e insere o evento descrito nele. Os valores batem com os CHECKs da migration 023 (o teste
 * support-domain.test.js confere isso lendo o SQL).
 *
 * Resultado de toda decisão:
 *   { ok: true,  noop: true }                                  nada a gravar (idempotente, 200)
 *   { ok: true,  to, event, clearsResolved, setsResolved, reopenCountDelta, notifies }
 *   { ok: false, status: 403|409, reason }                     recusa
 * `event` é { type, from, to, actorRole } (ou null) e vira uma linha de support_ticket_events.
 */

export const STATUSES = ['aberta', 'em_atendimento', 'aguardando_profissional', 'resolvida'];
export const OPEN_STATUSES = ['aberta', 'em_atendimento', 'aguardando_profissional'];
export const PRIORITIES = ['alta', 'media', 'baixa'];
export const CATEGORIES = ['agenda', 'clientes', 'servicos_config', 'perfil_acesso', 'financeiro', 'tecnico'];
export const ACTOR_ROLES = ['professional', 'admin'];

// Reabertura pela profissional: 7 x 24 h absolutas contadas do resolved_at (não é constraint: depende de now()).
export const REOPEN_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
// Decisão D5: máximo de solicitações abertas (não resolvidas) por profissional.
export const MAX_OPEN_TICKETS = 10;

const deny = (status, reason) => ({ ok: false, status, reason });
const NOOP = Object.freeze({ ok: true, noop: true });

function checkInputs(actor, status) {
  if (!ACTOR_ROLES.includes(actor)) return deny(403, 'forbidden');
  if (!STATUSES.includes(status)) return deny(409, 'invalid_status');
  return null;
}

/** Cabe mais uma solicitação aberta? (a contagem é feita sob lock da linha da profissional) */
export function canOpenTicket(openCount) {
  return Number.isInteger(openCount) && openCount >= 0 && openCount < MAX_OPEN_TICKETS;
}

/**
 * Efeito de uma RESPOSTA (mensagem) sobre o status.
 *  - em solicitação resolvida: 409 ticket_resolved (profissional reabre; ADM muda o status antes);
 *  - ADM responde: aberta/em_atendimento -> aguardando_profissional ("Aguardando você");
 *  - profissional responde: só aguardando_profissional -> em_atendimento; aberta/em_atendimento não mudam.
 * A mensagem é sempre gravada quando ok; `to` null = status inalterado. Mudança automática gera evento
 * status_changed do próprio autor.
 */
export function planReply({ actor, status }) {
  const bad = checkInputs(actor, status);
  if (bad) return bad;
  if (status === 'resolvida') return deny(409, 'ticket_resolved');

  let to = null;
  if (actor === 'admin' && status !== 'aguardando_profissional') to = 'aguardando_profissional';
  if (actor === 'professional' && status === 'aguardando_profissional') to = 'em_atendimento';

  return {
    ok: true,
    to,
    event: to ? { type: 'status_changed', from: status, to, actorRole: actor } : null,
    clearsResolved: false,
    setsResolved: false,
    reopenCountDelta: 0,
  };
}

/**
 * Mudança MANUAL de status (só ADM). Ordem das regras:
 *  1. quem não é ADM: 403;
 *  2. já está no status pedido: noop (200 sem evento), mesmo com expectedStatus desatualizado;
 *  3. expectedStatus informado e diferente do atual: 409 stale_status (outro ator mudou);
 *  4. transição inválida: 409 invalid_transition.
 * Permitido: qualquer sentido entre aberta/em_atendimento/aguardando_profissional; qualquer aberta -> resolvida;
 * resolvida -> aberta ou em_atendimento (a ADM reabre a qualquer momento; evento 'reopened', sem reopen_count).
 */
export function planStatusChange({ actor, from, to, expectedStatus } = {}) {
  const bad = checkInputs(actor, from);
  if (bad) return bad;
  if (actor !== 'admin') return deny(403, 'forbidden');
  if (!STATUSES.includes(to)) return deny(409, 'invalid_transition');
  if (from === to) return NOOP;
  if (expectedStatus !== undefined && expectedStatus !== null && expectedStatus !== from) {
    return deny(409, 'stale_status');
  }

  if (from === 'resolvida') {
    if (to !== 'aberta' && to !== 'em_atendimento') return deny(409, 'invalid_transition');
    return {
      ok: true,
      to,
      event: { type: 'reopened', from, to, actorRole: 'admin' },
      clearsResolved: true,
      setsResolved: false,
      reopenCountDelta: 0, // reopen_count conta só reaberturas da profissional
    };
  }

  return {
    ok: true,
    to,
    event: { type: 'status_changed', from, to, actorRole: 'admin' },
    clearsResolved: false,
    setsResolved: to === 'resolvida',
    reopenCountDelta: 0,
  };
}

/** Fim (exclusivo) da janela de reabertura da profissional. */
export function reopenDeadline(resolvedAt) {
  const t = toMs(resolvedAt);
  return t === null ? null : new Date(t + REOPEN_WINDOW_MS);
}

/** Dentro da janela só enquanto resolved_at + 7 dias > agora (exatamente 7 dias já expirou). */
export function isWithinReopenWindow(resolvedAt, now) {
  const t = toMs(resolvedAt);
  const n = toMs(now);
  if (t === null || n === null) return false;
  return t + REOPEN_WINDOW_MS > n;
}

/**
 * Reabertura PELA PROFISSIONAL (exige mensagem, tratada pelo chamador): resolvida -> aberta dentro da janela.
 * Zera resolved_at/resolved_by, conta reopen_count e gera o evento 'reopened'.
 */
export function planProfessionalReopen({ actor, status, resolvedAt, now }) {
  const bad = checkInputs(actor, status);
  if (bad) return bad;
  if (actor !== 'professional') return deny(403, 'forbidden');
  if (status !== 'resolvida') return deny(409, 'not_resolved');
  if (!isWithinReopenWindow(resolvedAt, now)) return deny(409, 'reopen_window_expired');
  return {
    ok: true,
    to: 'aberta',
    event: { type: 'reopened', from: 'resolvida', to: 'aberta', actorRole: 'professional' },
    clearsResolved: true,
    setsResolved: false,
    reopenCountDelta: 1,
  };
}

function toMs(value) {
  if (value === null || value === undefined) return null;
  const t = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(t) ? t : null;
}
