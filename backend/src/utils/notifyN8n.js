/**
 * Notifica o n8n via webhook quando eventos relevantes acontecem.
 * Cada evento tem sua própria URL de destino — isso garante que o workflow
 * de confirmação e o de cancelamento sejam acionados independentemente.
 *
 * Variáveis de ambiente:
 *   N8N_WEBHOOK_CONFIRMED_URL       → workflow 3 (appointment.confirmed)
 *   N8N_WEBHOOK_CANCELLED_URL       → workflow 5 (appointment.cancelled)
 *   N8N_WEBHOOK_MESSAGE_URL         → mensagem genérica à cliente (message.send: o texto vai pronto
 *                                     em `text`; quem decide o conteúdo é o backend)
 *   N8N_WEBHOOK_REJECTED_URL        → avisa a cliente que a solicitação foi recusada
 *                                     (appointment.rejected; o texto vai pronto em `message`)
 *   N8N_WEBHOOK_PUBLIC_CREATED_URL  → notifica a profissional (WhatsApp) quando
 *                                     um agendamento é criado pela página pública
 *
 * Se a URL correspondente não estiver configurada, a chamada é um no-op
 * silencioso — o backend continua funcionando normalmente.
 *
 * Implementado como "fire and forget": nunca deve quebrar a resposta
 * da API caso o n8n esteja fora do ar.
 */
const EVENT_URL_VARS = {
  'appointment.confirmed': 'N8N_WEBHOOK_CONFIRMED_URL',
  'appointment.cancelled': 'N8N_WEBHOOK_CANCELLED_URL',
  'appointment.rejected': 'N8N_WEBHOOK_REJECTED_URL',
  'message.send': 'N8N_WEBHOOK_MESSAGE_URL',
  'appointment.public_created': 'N8N_WEBHOOK_PUBLIC_CREATED_URL',
};

export function notifyN8n(event, payload) {
  const envVar = EVENT_URL_VARS[event];
  if (!envVar) return;

  const url = process.env[envVar];
  if (!url) return;

  const secret = process.env.N8N_NOTIFY_SECRET;
  fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(secret ? { 'X-NailFlow-Webhook-Secret': secret } : {}),
    },
    body: JSON.stringify({ event, payload, sentAt: new Date().toISOString() }),
  }).catch((err) => {
    console.error(`Falha ao notificar n8n (${event}):`, err.message);
  });
}
