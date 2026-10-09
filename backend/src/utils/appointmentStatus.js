/**
 * Transições de status usadas na Fase 1A (pré-agendamento).
 * `pendente` é exibido como "Aguardando confirmação".
 * Cada transição só vale a partir dos status listados em `from`; o UPDATE
 * condicionado a esses status é o que garante idempotência e evita corrida.
 */
export const TRANSITIONS = {
  confirm: { from: ['pendente'], to: 'confirmado' },
  markPaid: { from: ['aguardando_pagamento'], to: 'confirmado' },
  reject: { from: ['pendente'], to: 'cancelado', cancelReason: 'rejected' },
};

// Origens em que a cliente espera receber resposta pelo WhatsApp.
export const CLIENT_ORIGINATED_SOURCES = ['public', 'bot'];

// ── Proteção e integridade (Fase 1) ─────────────────────────────────────────

// Atendimento já registrado: não se mexe em cliente, serviço nem horário.
export const ATTENDED_STATUSES = ['concluido', 'nao_compareceu'];

// Únicos status dos quais um agendamento pode ser cancelado (DELETE, lotes, bot).
export const CANCELLABLE_STATUSES = ['pendente', 'aguardando_pagamento', 'confirmado'];

// Status inicial aceito em POST /appointments (painel). Concluído e falta só como registro retroativo.
export const PANEL_INITIAL_STATUSES = ['pendente', 'confirmado'];
export const RETROACTIVE_INITIAL_STATUSES = ['concluido', 'nao_compareceu'];

// Mudanças de status aceitas por PUT /appointments/:id (e, linha a linha, pelos lotes).
// Permanecer no mesmo status nunca é uma transição e é sempre aceito.
//   - aguardando_pagamento só é produzido pelo sistema; sai pelo mark-paid ou cancelando;
//   - concluído/falta mantêm o caminho de correção de hoje (via pendente) até a Fase 2;
//   - cancelado só reabre (para pendente) quando não tem motivo (cancelado pela profissional).
const PUT_TARGETS = {
  pendente: ['confirmado', 'cancelado'],
  aguardando_pagamento: ['cancelado'],
  confirmado: ['pendente', 'concluido', 'nao_compareceu', 'cancelado'],
  concluido: ['nao_compareceu', 'pendente'],
  nao_compareceu: ['concluido', 'pendente'],
  cancelado: ['pendente'],
};

const EXPIRED_MESSAGE = 'A reserva deste horário expirou. Peça para a cliente solicitar novamente.';

function transitionMessage(from, to) {
  if (ATTENDED_STATUSES.includes(to) && from === 'pendente') {
    return 'Confirme o agendamento antes de concluí-lo ou marcar a falta.';
  }
  if (ATTENDED_STATUSES.includes(to) && from === 'aguardando_pagamento') {
    return 'Registre o pagamento (agendamento confirmado) antes de concluí-lo ou marcar a falta.';
  }
  if (from === 'cancelado') return 'Agendamento cancelado não pode ser reaberto por aqui.';
  if (to === 'cancelado' && ATTENDED_STATUSES.includes(from)) {
    return 'Um atendimento concluído ou com falta não pode ser cancelado.';
  }
  if (to === 'confirmado' && from === 'aguardando_pagamento') {
    return 'Para confirmar, marque o pagamento como recebido.';
  }
  if (to === 'confirmado') return 'Só é possível confirmar um agendamento aguardando confirmação.';
  return 'Essa mudança de status não é permitida.';
}

/**
 * Valida uma mudança de status de um agendamento já existente.
 * `row`: { status, cancel_reason, expires_at, starts_at }. `startsAt` sobrescreve row.starts_at
 * quando o mesmo pedido também muda o horário. Devolve null se permitido ou
 * { reason, error } (reason: 'invalid_transition' | 'hold_expired' | 'too_early').
 */
export function checkStatusChange(row, target, { now = new Date(), startsAt = row.starts_at } = {}) {
  if (target === undefined || target === null || target === row.status) return null;

  if (row.status === 'cancelado' && row.cancel_reason) {
    // reserva que expirou (por exemplo, entre a leitura e o lock): mesmo erro de negócio da confirmação direta
    if (target === 'confirmado' && row.cancel_reason === 'expired') return { reason: 'hold_expired', error: EXPIRED_MESSAGE };
    return { reason: 'invalid_transition', error: 'Agendamento recusado ou expirado não pode ser reaberto. Crie um novo agendamento.' };
  }
  if (!(PUT_TARGETS[row.status] ?? []).includes(target)) {
    return { reason: 'invalid_transition', error: transitionMessage(row.status, target) };
  }
  if (target === 'confirmado' && row.expires_at && new Date(row.expires_at) <= now) {
    return { reason: 'hold_expired', error: EXPIRED_MESSAGE };
  }
  if (ATTENDED_STATUSES.includes(target) && row.status === 'confirmado' && new Date(startsAt) > now) {
    return { reason: 'too_early', error: 'Só é possível concluir ou marcar a falta depois que o atendimento começa.' };
  }
  return null;
}

// true quando o atendimento ainda não começou (única situação em que a cliente recebe aviso de
// confirmação ou de cancelamento).
export function notBeforeStart(startsAt, now = new Date()) {
  return new Date(startsAt) > now;
}

// Identificador de agendamento na URL: UUID.
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
