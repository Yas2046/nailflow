import { pool } from '../config/db.js';

// Chave da conversa do bot: só os dígitos do JID do WhatsApp.
export function cleanPhone(raw) {
  return String(raw).replace('@s.whatsapp.net', '').replace(/\D/g, '');
}

// Número já com DDI (como vem do WhatsApp). Celular BR com 13 dígitos perde o 9
// para ficar no formato de 12 dígitos usado nas fichas de cliente.
export function normalizeBrPhone(phone) {
  const digits = String(phone).replace(/\D/g, '');
  if (digits.length === 13 && digits.startsWith('55') && digits[4] === '9') {
    return digits.slice(0, 4) + digits.slice(5);
  }
  return digits;
}

// Número digitado no painel: aceita sem DDI (DDD + número) e aplica a mesma regra do bot.
// Não é usado pelo bot, que recebe números estrangeiros com 10–11 dígitos já com DDI.
export function normalizeClientPhone(raw) {
  let digits = String(raw ?? '').replace(/\D/g, '');
  if (digits.length === 10 || digits.length === 11) digits = `55${digits}`;
  return normalizeBrPhone(digits);
}

// 55 + DDD (sem zero) + 8 dígitos.
export function isValidBrPhone(normalized) {
  return /^55[1-9]{2}\d{8}$/.test(normalized);
}

/**
 * Procura a ficha de cliente de uma profissional pelo telefone, aceitando fichas
 * antigas gravadas com 13 dígitos (com o 9). `includeWithoutDdi` também casa fichas
 * antigas gravadas sem o 55 — usado só na checagem de duplicidade do painel.
 */
export async function findClientByPhone(professionalId, phone, { excludeId = null, includeWithoutDdi = false } = {}) {
  const normalized = normalizeBrPhone(phone);
  const { rows } = await pool.query(
    `SELECT * FROM clients
     WHERE professional_id = $1
       AND (
         regexp_replace(phone, '\\D', '', 'g') = $2
         OR (
           length(regexp_replace(phone, '\\D', '', 'g')) = 13
           AND left(regexp_replace(phone, '\\D', '', 'g'), 4) || right(regexp_replace(phone, '\\D', '', 'g'), 8) = $2
         )
         OR (
           $4::boolean
           AND length(regexp_replace(phone, '\\D', '', 'g')) IN (10, 11)
           AND (
             '55' || regexp_replace(phone, '\\D', '', 'g') = $2
             OR '55' || left(regexp_replace(phone, '\\D', '', 'g'), 2) || right(regexp_replace(phone, '\\D', '', 'g'), 8) = $2
           )
         )
       )
       AND ($3::uuid IS NULL OR id <> $3::uuid)
     ORDER BY created_at ASC
     LIMIT 1`,
    [professionalId, normalized, excludeId, includeWithoutDdi]
  );
  return rows[0] ?? null;
}
