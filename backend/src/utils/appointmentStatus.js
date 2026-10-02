/**
 * Transições de status usadas na Fase 1A (pré-agendamento).
 * `pendente` é exibido como "Aguardando confirmação".
 * Cada transição só vale a partir dos status listados em `from`; o UPDATE
 * condicionado a esses status é o que garante idempotência e evita corrida.
 */
export const TRANSITIONS = {
  confirm: { from: ['pendente'], to: 'confirmado' },
  reject: { from: ['pendente'], to: 'cancelado', cancelReason: 'rejected' },
};

// Origens em que a cliente espera receber resposta pelo WhatsApp.
export const CLIENT_ORIGINATED_SOURCES = ['public', 'bot'];
