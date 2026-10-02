import { pool } from '../config/db.js';

// Validade da reserva enquanto aguarda confirmação / pagamento.
export const PENDING_HOLD_HOURS = 24;
export const PAYMENT_HOLD_HOURS = 2;
export const HOLD_STATUSES = ['pendente', 'aguardando_pagamento'];

// Fragmento SQL: reserva vencida e ainda não varrida. As consultas de
// disponibilidade o usam para tratar o horário como livre.
export function expiredHoldSql(alias = '') {
  const p = alias ? `${alias}.` : '';
  return `(${p}status IN ('pendente','aguardando_pagamento') AND ${p}expires_at IS NOT NULL AND ${p}expires_at <= now())`;
}

// Estado inicial de um agendamento criado pela cliente (página pública/bot),
// conforme a configuração da profissional:
//   manual                → pendente (aguardando confirmação), vale 24h
//   automático, sem sinal → confirmado, sem validade
//   automático, com sinal → aguardando_pagamento, vale 2h
//   manual + sinal        → pendente (fluxo de pagamento ainda não implementado)
export function initialBookingState(professional, now = new Date(), depositCents = 0) {
  const automatic = professional?.confirmation_mode === 'automatic';
  const addHours = (h) => new Date(now.getTime() + h * 3600000);
  const hasDeposit = Boolean(professional?.deposit_required) && depositCents > 0;
  if (automatic && !hasDeposit) return { status: 'confirmado', expiresAt: null };
  if (automatic) return { status: 'aguardando_pagamento', expiresAt: addHours(PAYMENT_HOLD_HOURS) };
  return { status: 'pendente', expiresAt: addHours(PENDING_HOLD_HOURS) };
}

// Cancela (cancel_reason='expired') as reservas vencidas, liberando o horário.
// Atômico e idempotente: o UPDATE é condicionado ao status e ao vencimento, e
// FOR UPDATE SKIP LOCKED evita disputa com uma confirmação em andamento
// (quem confirmar antes zera expires_at e o vencimento deixa de valer).
export async function expireDueHolds({ db = pool, professionalId = null } = {}) {
  const { rowCount } = await db.query(
    `UPDATE appointments SET status = 'cancelado', cancel_reason = 'expired'
     WHERE id IN (
       SELECT id FROM appointments
       WHERE status = ANY($1::text[]) AND expires_at IS NOT NULL AND expires_at <= now()
         AND ($2::uuid IS NULL OR professional_id = $2)
       FOR UPDATE SKIP LOCKED
     )`,
    [HOLD_STATUSES, professionalId]
  );
  return rowCount;
}

// Varredura periódica (fora dos testes). Um processo só: o SQL é idempotente.
export function startHoldSweeper(intervalMs = 60000) {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await expireDueHolds();
    } catch (err) {
      console.error('Falha na varredura de reservas vencidas:', err.message);
    } finally {
      running = false;
    }
  }, intervalMs);
  timer.unref();
  return timer;
}

export function formatWhen(startsAt) {
  const d = new Date(startsAt);
  const date = d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' });
  const time = d.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
  return `${date} às ${time}`;
}

// Sinal calculado SEMPRE no backend, a partir do preço do serviço no momento
// da reserva (nada vem do frontend). 'percentage' arredonda ao centavo;
// 'fixed' nunca passa do preço do serviço.
export function calculateDepositCents(professional, priceCents) {
  if (!professional?.deposit_required || !professional.deposit_type) return 0;
  const price = Math.max(0, Number(priceCents) || 0);
  const value = Number(professional.deposit_value) || 0;
  const cents = professional.deposit_type === 'percentage'
    ? Math.round((price * value) / 100)
    : Math.min(value, price);
  return Math.max(0, cents);
}

export function formatBRL(cents) {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// Horário (SP) até o qual o pagamento vale, ex.: "15:30".
export function formatClock(date) {
  return new Date(date).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
}

// Instruções de pagamento do sinal (usadas na mensagem de WhatsApp e na
// resposta do bot). A chave Pix só sai daqui depois que a reserva foi criada.
export function paymentInstructionsText({ serviceName, startsAt, amountCents, pixKey, expiresAt }) {
  return `*${serviceName}* em ${formatWhen(startsAt)} está reservado! 💅\n`
    + `Para garantir o horário, faça o pagamento do sinal de *${formatBRL(amountCents)}* via Pix:\n`
    + `Chave Pix: ${pixKey}\n`
    + `Você tem ${PAYMENT_HOLD_HOURS} horas (até ${formatClock(expiresAt)}) — depois disso a reserva é liberada. `
    + `Assim que a profissional confirmar o pagamento, te aviso por aqui.`;
}
