/**
 * Central de Suporte: utilitários HTTP compartilhados pelas APIs da profissional (/support) e da ADM
 * (/admin/support). Erros de regra viram { error, reason?, fields? } com o status correto; erros do banco
 * são reduzidos antes de seguir para o errorHandler (que registra o erro inteiro) para que o texto das
 * mensagens, presente no DETAIL de um CHECK, nunca vá a log nem à resposta.
 */
import { HttpError } from '../middleware/errorHandler.js';
import { parseSupportInput } from './supportValidation.js';

export class SupportError extends Error {
  constructor(status, error, extra = {}) {
    super(error);
    this.status = status;
    this.body = { error, ...extra };
  }
}

export const MESSAGES = {
  ticket_resolved: 'Esta solicitação está resolvida. Reabra para enviar uma nova mensagem.',
  not_resolved: 'Esta solicitação não está resolvida.',
  reopen_window_expired: 'O prazo de 7 dias para reabrir esta solicitação terminou. Abra uma nova solicitação.',
  idempotency_conflict: 'Este identificador já foi usado com outro conteúdo.',
  stale_status: 'A solicitação foi alterada por outra pessoa. Atualize e tente de novo.',
  invalid_transition: 'Esta mudança de status não é permitida.',
  forbidden: 'Acesso não autorizado.',
  invalid_status: 'Estado da solicitação inválido.',
};

export const notFound = () => new SupportError(404, 'Solicitação não encontrada.');
export const refuse = (plan) => new SupportError(plan.status, MESSAGES[plan.reason] ?? 'Operação não permitida.', { reason: plan.reason });

export function validate(schema, input) {
  const r = parseSupportInput(schema, input);
  if (!r.ok) throw new SupportError(400, r.errors[0].message, { fields: r.errors });
  return r.data;
}

export function sanitizeError(err) {
  const isPg = err && typeof err.code === 'string' && /^[0-9A-Z]{5}$/.test(err.code) && ('severity' in err || 'routine' in err);
  if (!isPg) return err;
  console.error('support: erro de banco', { code: err.code, constraint: err.constraint, table: err.table, routine: err.routine });
  return new HttpError(500, 'Erro interno do servidor.');
}

export const handle = (fn) => async (req, res, next) => {
  try {
    await fn(req, res);
  } catch (err) {
    if (err instanceof SupportError) return res.status(err.status).json(err.body);
    next(sanitizeError(err));
  }
};

export const iso = (d) => (d ? new Date(d).toISOString() : null);
