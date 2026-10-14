/**
 * Central de Suporte: prioridade sugerida e ajuste manual (domínio puro).
 *
 * A profissional não vê a prioridade; ela só ordena a fila da ADM. A sugestão automática usa termos
 * versionados aqui (lista inicial da spec §5, ainda sujeita à decisão D15/P8) sobre o texto normalizado:
 * minúsculas, sem acentos, só letras e números separados por um espaço. Termos casam como palavra/frase
 * inteira ("perdi" não casa "perdida").
 */
import { PRIORITIES } from './supportStateMachine.js';

// Alta: só conta na categoria "tecnico" (menos "urgente", que vale em qualquer categoria).
export const HIGH_TERMS = [
  'nao consigo entrar',
  'nao abre',
  'fora do ar',
  'perdi',
  'sumiu',
  'apagou',
  'cobranca',
];
export const URGENT_TERMS = ['urgente'];
// Média em qualquer categoria.
export const MEDIUM_TERMS = ['erro', 'nao funciona', 'falha'];
// Média por categoria (sem termos de alta).
export const MEDIUM_CATEGORIES = ['tecnico', 'perfil_acesso'];

/** minúsculas, sem acentos, apenas [a-z0-9] separados por um espaço (e espaço nas pontas). */
export function normalizeForMatch(text) {
  const folded = String(text ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  return ` ${folded} `;
}

const hasTerm = (haystack, terms) => terms.some((t) => haystack.includes(` ${t} `));

/** Prioridade sugerida para uma solicitação nova. Categoria desconhecida cai nas regras de texto. */
export function suggestPriority({ category, subject, body } = {}) {
  const text = normalizeForMatch(`${subject ?? ''} ${body ?? ''}`);
  const tecnico = category === 'tecnico';

  if (hasTerm(text, URGENT_TERMS)) return 'alta';
  if (tecnico && hasTerm(text, HIGH_TERMS)) return 'alta';
  if (MEDIUM_CATEGORIES.includes(category)) return 'media';
  if (hasTerm(text, MEDIUM_TERMS)) return 'media';
  return 'baixa';
}

/**
 * A regra automática nunca sobrescreve um ajuste manual da ADM.
 * Devolve a prioridade que deve valer dado o estado atual e a nova sugestão.
 */
export function resolveAutoPriority({ source, current, suggested }) {
  if (source === 'manual') return current;
  return PRIORITIES.includes(suggested) ? suggested : current;
}

/**
 * Ajuste MANUAL de prioridade (só ADM). Não notifica a profissional (o evento priority_changed consome seq
 * mas não gera "não lida" no banco).
 *  - prioridade inválida: 400 invalid_priority;
 *  - mesma prioridade e já manual: noop (200 sem evento);
 *  - mesma prioridade ainda 'auto': só passa a 'manual', sem evento;
 *  - diferente: grava e gera evento priority_changed.
 */
export function planPriorityChange({ actor, current, source, to }) {
  if (actor !== 'admin') return { ok: false, status: 403, reason: 'forbidden' };
  if (!PRIORITIES.includes(to)) return { ok: false, status: 400, reason: 'invalid_priority' };
  if (to === current) {
    if (source === 'manual') return { ok: true, noop: true };
    return { ok: true, to, source: 'manual', event: null };
  }
  return {
    ok: true,
    to,
    source: 'manual',
    event: { type: 'priority_changed', from: current, to, actorRole: 'admin' },
  };
}
