/**
 * Central de Suporte: validação e normalização de entrada (domínio puro; usa zod como o resto do backend).
 *
 * - Todo schema é .strict(): campo desconhecido (inclusive professionalId) é erro, nunca ignorado.
 * - Limites contam CARACTERES (code points), como char_length do PostgreSQL, e não unidades UTF-16:
 *   um emoji vale 1. Os limites batem com os CHECKs da migration 023 (assunto 3..120, mensagem 1..5000).
 * - O texto é gravado já normalizado: CRLF -> LF, caracteres de controle removidos (mantém \n e \t),
 *   espaços das pontas aparados. O assunto vira uma linha só.
 * - request_hash: SHA-256 do conteúdo normalizado (sem o id de idempotência), em hex minúsculo de 64
 *   caracteres, como o CHECK do banco exige. Mesmo id + mesmo hash = mesma operação; hash diferente = 409.
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { CATEGORIES, PRIORITIES, STATUSES } from './supportStateMachine.js';

export const SUBJECT_MIN = 3;
export const SUBJECT_MAX = 120;
export const BODY_MAX = 5000;

const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

export const charLength = (text) => [...text].length;

/** Normaliza texto livre (mensagens). */
export function cleanBody(value) {
  return String(value).replace(/\r\n?/g, '\n').replace(CONTROL_CHARS, '').trim();
}

/** Normaliza o assunto: mesmo tratamento, em uma linha só. */
export function cleanSubject(value) {
  return cleanBody(value).replace(/\s+/g, ' ');
}

const requiredString = (label) =>
  z.string({ required_error: `${label} é obrigatório.`, invalid_type_error: `${label} deve ser um texto.` });

const subjectField = requiredString('Assunto')
  .transform(cleanSubject)
  .superRefine((v, ctx) => {
    const n = charLength(v);
    if (n < SUBJECT_MIN) ctx.addIssue({ code: 'custom', message: `O assunto precisa ter pelo menos ${SUBJECT_MIN} caracteres.` });
    if (n > SUBJECT_MAX) ctx.addIssue({ code: 'custom', message: `O assunto pode ter no máximo ${SUBJECT_MAX} caracteres.` });
  });

const bodyField = (label = 'Mensagem') =>
  requiredString(label)
    .transform(cleanBody)
    .superRefine((v, ctx) => {
      const n = charLength(v);
      if (n < 1) ctx.addIssue({ code: 'custom', message: `${label} não pode ficar em branco.` });
      if (n > BODY_MAX) ctx.addIssue({ code: 'custom', message: `${label} pode ter no máximo ${BODY_MAX} caracteres.` });
    });

const uuidField = (label) =>
  requiredString(label).uuid({ message: `${label} inválido.` });

const enumField = (values, label) =>
  z.enum(values, {
    errorMap: () => ({ message: `${label} inválido.` }),
  });

// ── Profissional ────────────────────────────────────────────────────────────

export const createTicketSchema = z
  .object({
    subject: subjectField,
    category: enumField(CATEGORIES, 'Categoria'),
    body: bodyField('Descrição'),
    clientRequestId: uuidField('Identificador da solicitação'),
    relatedTicketNumber: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
  })
  .strict();

export const sendMessageSchema = z
  .object({
    body: bodyField('Mensagem'),
    clientMessageId: uuidField('Identificador da mensagem'),
  })
  .strict();

export const reopenSchema = z.object({ body: bodyField('Mensagem') }).strict();

// Cursor de leitura: o maior seq que a tela realmente exibiu (o servidor ainda o limita ao activity_seq).
export const readSchema = z
  .object({ upToSeq: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER) })
  .strict();

export const preferencesSchema = z.object({ fabHidden: z.boolean() }).strict();

// ── ADM ─────────────────────────────────────────────────────────────────────

export const adminStatusSchema = z
  .object({
    status: enumField(STATUSES, 'Status'),
    expectedStatus: enumField(STATUSES, 'Status esperado').optional(),
  })
  .strict();

export const adminPrioritySchema = z.object({ priority: enumField(PRIORITIES, 'Prioridade') }).strict();

/**
 * Valida com um dos schemas acima.
 * { ok: true, data } ou { ok: false, errors: [{ field, message }] } (mensagens em português, sem eco do valor).
 */
export function parseSupportInput(schema, input) {
  const result = schema.safeParse(input);
  if (result.success) return { ok: true, data: result.data };
  return {
    ok: false,
    errors: result.error.issues.map((i) => ({ field: i.path.join('.') || '(corpo)', message: i.message })),
  };
}

// ── Idempotência ────────────────────────────────────────────────────────────

function sha256Json(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

/** Hash do conteúdo de uma criação (já validado/normalizado), sem clientRequestId. */
export function ticketRequestHash({ subject, category, body, relatedTicketNumber }) {
  return sha256Json(['ticket', subject, category, body, relatedTicketNumber ?? null]);
}

/** Hash do conteúdo de uma mensagem (já validada/normalizada), sem clientMessageId. */
export function messageRequestHash({ body }) {
  return sha256Json(['message', body]);
}
