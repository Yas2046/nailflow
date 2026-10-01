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

// Nome de serviço "combo" (ex.: "Manicure + Pedicure"). Detectado só pelo
// separador "+" no nome cadastrado — não depende de nenhuma lista fixa de
// serviços, então funciona para qualquer combo que a profissional crie.
function isCompositeServiceName(normalizedName) {
  return normalizedName.includes('+');
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
  const directMatches = new Set();
  for (const service of services) {
    const name = normalize(service.name);
    if (t.includes(name)) {
      candidates.add(service.id);
      directMatches.add(service.id);
    }
  }
  // Mesmo problema do sinônimo, mas no match direto: o nome completo de um
  // combo ("manicure + pedicure") contém o nome de outros serviços como
  // substring. Se o combo foi encontrado por si só no texto, os serviços
  // simples cujo nome é só um pedaço dele não contam como candidatos à
  // parte — sem isso, digitar o nome do combo inteiro virava "ambíguo".
  for (const service of services) {
    const name = normalize(service.name);
    if (!isCompositeServiceName(name) || !directMatches.has(service.id)) continue;
    for (const other of services) {
      if (other.id === service.id) continue;
      const otherName = normalize(other.name);
      if (!isCompositeServiceName(otherName) && name.includes(otherName)) {
        candidates.delete(other.id);
      }
    }
  }
  for (const word of words) {
    const synonyms = SERVICE_SYNONYMS[word];
    if (!synonyms) continue;
    for (const service of services) {
      const name = normalize(service.name);
      // Um nome composto (ex.: "Manicure + Pedicure") nunca vira candidato
      // só por sinônimo — ele contém o nome de outros serviços como
      // substring ("manicure", "pedicure"), o que faria "unha" ou "pé"
      // ficarem ambíguos entre o serviço simples e o combo sem necessidade.
      // O combo continua reconhecível pelo match direto do nome completo
      // no texto, acima.
      if (isCompositeServiceName(name)) continue;
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

// Hora por extenso (só os valores plausíveis para expediente de salão:
// 0–20h). Não cobre todo o 0–23 de propósito — "vinte e duas e meia" é
// raríssimo nesse domínio e aumentaria o risco de falso positivo.
const HOUR_WORDS = {
  zero: 0, uma: 1, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7,
  oito: 8, nove: 9, dez: 10, onze: 11, doze: 12, treze: 13, catorze: 14,
  quatorze: 14, quinze: 15, dezesseis: 16, dezessete: 17, dezoito: 18,
  dezenove: 19, vinte: 20,
};

function resolveHourToken(token) {
  if (/^\d{1,2}$/.test(token)) {
    const n = Number(token);
    return n <= 23 ? n : null;
  }
  return Object.prototype.hasOwnProperty.call(HOUR_WORDS, token) ? HOUR_WORDS[token] : null;
}

/**
 * Horário exato mencionado em texto livre: "10:30", "10h30", "10h",
 * "às 10:30", "10 e meia", "dez e meia". Retorna { hour, minute } só
 * quando existe EXATAMENTE uma leitura possível no texto — se a mensagem
 * menciona mais de um horário diferente (ex.: "10:30 ou 11:00"), ou
 * nenhum, retorna null de propósito: melhor não selecionar nada do que
 * adivinhar errado (quem chama decide o que fazer com null).
 *
 * Propositalmente restrito a padrões com separador explícito (":", "h",
 * "e meia") — um número solto como "3" ou "35" nunca é tratado como
 * horário aqui, para não confundir com número de menu, preço ou parte de
 * um telefone/data.
 */
export function extractTimeMention(rawText) {
  const t = normalize(rawText);
  const candidates = new Map();

  for (const m of t.matchAll(/\b(\d{1,2})\s*(?:h\s*(\d{2})|:(\d{2}))\b/g)) {
    const hour = Number(m[1]);
    const minute = Number(m[2] ?? m[3]);
    if (hour <= 23 && minute <= 59) candidates.set(`${hour}:${minute}`, { hour, minute });
  }

  for (const m of t.matchAll(/\b(\d{1,2})h\b/g)) {
    const hour = Number(m[1]);
    if (hour <= 23) candidates.set(`${hour}:0`, { hour, minute: 0 });
  }

  for (const m of t.matchAll(/\b(\d{1,2}|[a-z]+)\s+e\s+meia\b/g)) {
    const hour = resolveHourToken(m[1]);
    if (hour != null) candidates.set(`${hour}:30`, { hour, minute: 30 });
  }

  if (candidates.size !== 1) return null;
  return [...candidates.values()][0];
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
