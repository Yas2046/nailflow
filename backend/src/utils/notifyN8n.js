/**
 * Notifica o n8n via webhook quando eventos relevantes acontecem
 * (confirmação, cancelamento). Só dispara se N8N_WEBHOOK_URL estiver
 * configurada — no MVP sem n8n, isso é um no-op silencioso.
 *
 * Implementado como "fire and forget": nunca deve quebrar a resposta
 * da API caso o n8n esteja fora do ar.
 */
export function notifyN8n(event, payload) {
  const url = process.env.N8N_WEBHOOK_URL;
  if (!url) return;

  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event, payload, sentAt: new Date().toISOString() }),
  }).catch((err) => {
    console.error(`Falha ao notificar n8n (${event}):`, err.message);
  });
}
