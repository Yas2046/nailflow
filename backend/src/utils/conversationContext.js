// Extrai "slots" (intenção, serviço, data, período) de mensagens livres do
// WhatsApp, para permitir que o bot entenda pedidos como "quero fazer unha
// sexta depois das 18h" sem depender só de menus numerados.
//
// Propositalmente simples e baseado em regras (sem IA externa): cada
// extrator é independente, previsível e fácil de testar/depurar. Um slot
// não reconhecido simplesmente não é preenchido — o fluxo de menus
// existente continua funcionando normalmente como fallback.

function normalize(t) {
  return String(t || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

const WEEKDAY_NAMES = {
  domingo: 0,
  segunda: 1,
  'segunda-feira': 1,
  terca: 2,
  'terca-feira': 2,
  quarta: 3,
  'quarta-feira': 3,
  quinta: 4,
  'quinta-feira': 4,
  sexta: 5,
  'sexta-feira': 5,
  sabado: 6,
};

// Sinônimos coloquiais comuns para os serviços de nail designer. Usado só
// como candidato extra de busca — o match final ainda depende do nome real
// cadastrado pela profissional (ver extractServiceMention).
const SERVICE_SYNONYMS = {
  unha: ['manicure'],
  unhas: ['manicure'],
  pe: ['pedicure'],
  pes: ['pedicure'],
  gel: ['esmaltacao', 'gel'],
  esmalte: ['esmaltacao'],
  alongamento: ['alongamento'],
  escova: ['escova'],
};

/**
 * Intenção de agendar. Não cobre cancelar/ver — o menu numérico já resolve
 * esses casos bem, e misturar tudo aqui aumentaria o risco de falso positivo.
 */
export function extractIntent(rawText) {
  const t = normalize(rawText);
  if (/\b(quero|queria|gostaria de|pode ser|da pra|posso)\b.*\b(marcar|agendar|fazer)\b/.test(t)) return 'agendar';
  if (/^(quero|queria)\s+(marcar|agendar)/.test(t)) return 'agendar';
  return null;
}

/**
 * Procura o nome de um serviço ativo da profissional dentro do texto,
 * incluindo sinônimos coloquiais. Retorna o registro do serviço ou null.
 * Em caso de ambiguidade (mais de um serviço candidato), retorna null de
 * propósito — melhor cair no fluxo de menu existente do que adivinhar.
 */
export function extractServiceMention(rawText, services) {
  const t = normalize(rawText);
  const words = t.split(/\s+/);

  const candidates = new Set();
  for (const service of services) {
    const name = normalize(service.name);
    if (t.includes(name)) candidates.add(service.id);
  }
  for (const word of words) {
    const synonyms = SERVICE_SYNONYMS[word];
    if (!synonyms) continue;
    for (const service of services) {
      const name = normalize(service.name);
      if (synonyms.some((syn) => name.includes(syn))) candidates.add(service.id);
    }
  }

  if (candidates.size !== 1) return null;
  const id = [...candidates][0];
  return services.find((s) => s.id === id) || null;
}

/**
 * Data mencionada no texto: "hoje", "amanha" ou um dia da semana
 * ("sexta", "sabado"...). Dia da semana sempre resolve para a PRÓXIMA
 * ocorrência a partir de hoje (nunca hoje mesmo, para não confundir com
 * "hoje" explícito). Retorna um objeto Date (meio-dia, para cálculo seguro
 * de fuso) ou null se nada for reconhecido.
 */
export function extractDateMention(rawText, now = new Date()) {
  const t = normalize(rawText);

  const base = new Date(now);
  base.setHours(12, 0, 0, 0);

  if (/\bhoje\b/.test(t)) return base;
  if (/\bamanh[ãa]\b/.test(t)) {
    const d = new Date(base);
    d.setDate(d.getDate() + 1);
    return d;
  }

  for (const [name, weekday] of Object.entries(WEEKDAY_NAMES)) {
    if (!t.includes(name)) continue;
    const d = new Date(base);
    let diff = (weekday - d.getDay() + 7) % 7;
    if (diff === 0) diff = 7; // "sexta" dita numa sexta = próxima sexta, não hoje
    d.setDate(d.getDate() + diff);
    return d;
  }

  return null;
}

/**
 * Período/horário mencionado: "de manhã/tarde/noite" vira uma faixa fixa;
 * "depois das 18h"/"após 18h" e "antes das 12h" viram limites abertos.
 * Retorna { afterMinutes?, beforeMinutes? } em minutos desde 00:00, ou null.
 */
export function extractPeriodMention(rawText) {
  const t = normalize(rawText);

  const afterMatch = t.match(/\b(depois das?|apos|a partir das?)\s*(\d{1,2})h?/);
  if (afterMatch) return { afterMinutes: Number(afterMatch[2]) * 60 };

  const beforeMatch = t.match(/\bantes das?\s*(\d{1,2})h?/);
  if (beforeMatch) return { beforeMinutes: Number(beforeMatch[1]) * 60 };

  if (/\bmanh[ãa]\b/.test(t)) return { afterMinutes: 0, beforeMinutes: 12 * 60 };
  if (/\btarde\b/.test(t)) return { afterMinutes: 12 * 60, beforeMinutes: 18 * 60 };
  if (/\bnoite\b/.test(t)) return { afterMinutes: 18 * 60, beforeMinutes: 24 * 60 };

  if (/qualquer hor[áa]rio/.test(t)) return { afterMinutes: 0, beforeMinutes: 24 * 60 };

  return null;
}

/**
 * Roda todos os extratores sobre uma mensagem e devolve só os slots que
 * de fato foram reconhecidos (chaves ausentes = nada dito sobre aquilo
 * nessa mensagem). Não decide nada sozinho — quem decide o que fazer com
 * os slots é o chamador (runStateMachine).
 */
export function extractSlots(rawText, services, now = new Date()) {
  const slots = {};

  const intent = extractIntent(rawText);
  if (intent) slots.intent = intent;

  const service = extractServiceMention(rawText, services);
  if (service) slots.serviceId = service.id;

  const date = extractDateMention(rawText, now);
  if (date) slots.date = date.toISOString().split('T')[0];

  const period = extractPeriodMention(rawText);
  if (period) slots.period = period;

  return slots;
}
