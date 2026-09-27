// Classifica respostas sim/não do bot. Só a primeira palavra inteira decide,
// para que "segunda seria melhor" ou "sei lá" não virem confirmação.

const MAX_WORDS = 4;
const NEGATIONS = new Set(['n', 'nao', 'nunca', 'nope', 'negativo']);
// Palavras aceitas depois de um "não" sem torná-lo ambíguo ("não, obrigada").
const NO_TAIL = new Set(['quero', 'obrigada', 'obrigado', 'valeu', 'precisa', 'agora', 'por', 'favor', 'mais']);

const RULES = {
  booking: {
    yes: ['s', 'sim', 'ss', 'yes', 'ok', 'confirma', 'confirmo', 'confirmar', 'pode', 'isso', 'certo', 'claro', 'beleza', 'blz'],
    no: ['n', 'nao', 'nope', 'negativo'],
    noPhrases: ['cancela', 'cancelar'],
  },
  cancel: {
    yes: ['s', 'sim', 'ss', 'yes', 'ok', 'confirma', 'confirmo', 'pode', 'cancela', 'cancelar'],
    no: ['n', 'nao', 'nope', 'negativo'],
    noPhrases: ['manter', 'mantem', 'nao cancela'],
  },
  repeat: {
    yes: ['s', 'sim', 'ss', 'yes', 'ok', 'quero', 'pode', 'bora', 'vamos', 'claro', 'isso'],
    yesPhrases: ['com certeza'],
    no: ['n', 'nao', 'nope', 'negativo'],
    // Pedido explícito por outras opções: vale mesmo com mais palavras ("outro serviço").
    noAnyTail: ['outro', 'outra', 'outros', 'outras', 'opcoes'],
    noPhrases: ['ver opcoes', 'menu'],
  },
};

export function normalizeReply(text) {
  return String(text ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** @returns {'yes' | 'no' | 'unknown'} */
export function classifyReply(text, kind) {
  const rules = RULES[kind];
  if (!rules) throw new Error(`Tipo de resposta desconhecido: ${kind}`);

  const norm = normalizeReply(text);
  if (!norm) return 'unknown';
  if (rules.noPhrases?.includes(norm)) return 'no';
  if (rules.yesPhrases?.includes(norm)) return 'yes';

  const words = norm.split(' ');
  if (words.length > MAX_WORDS) return 'unknown';
  const [first, ...rest] = words;

  if (rules.yes.includes(first) && !words.some((w) => NEGATIONS.has(w))) return 'yes';
  if (rules.noAnyTail?.includes(first)) return 'no';
  if (rules.no.includes(first) && rest.every((w) => NO_TAIL.has(w))) return 'no';
  return 'unknown';
}
