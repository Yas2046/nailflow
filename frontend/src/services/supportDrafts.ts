// Rascunhos da Central de Suporte (texto que a pessoa ainda não enviou).
// Ficam no localStorage, vinculados à conta (id da profissional) e são apagados ao sair: outra pessoa que usar o
// mesmo navegador não pode ver nem recuperar o que a sessão anterior escreveu.

const PREFIX = 'nf_support_draft:';
// Identidade autenticada guardada pelo AuthContext (login/logout/updateProfessional).
const IDENTITY_KEY = 'nailflow_professional';
// Chaves antigas (sem vínculo com a conta): nunca mais são lidas, só removidas.
const LEGACY_PREFIXES = ['nf_support_new_draft', 'nf_support_draft_'];

type DraftStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;

function defaultStore(): DraftStore | null {
  try { return localStorage; } catch { return null; }
}

/**
 * Id da conta autenticada neste navegador, lido do armazenamento a cada chamada (outra aba pode ter feito logout ou
 * entrado com outra conta). `null` quando não dá para confirmar: ausente, ilegível ou sem armazenamento.
 */
function currentIdentity(store: DraftStore): string | null {
  try {
    const raw = store.getItem(IDENTITY_KEY);
    if (!raw) return null;
    const id = (JSON.parse(raw) as { id?: unknown } | null)?.id;
    return typeof id === 'string' && id ? id : null;
  } catch { return null; }
}

export function supportDraftKey(ownerId: string, scope: string): string {
  return `${PREFIX}${ownerId}:${scope}`;
}

export function readSupportDraft(ownerId: string | undefined, scope: string, store: DraftStore | null = defaultStore()): string {
  if (!ownerId || !store) return '';
  try { return store.getItem(supportDraftKey(ownerId, scope)) ?? ''; } catch { return ''; }
}

/**
 * Valor vazio remove o rascunho. Só grava texto se a conta autenticada no armazenamento ainda for `ownerId`: uma aba
 * desatualizada (logout ou outra conta em outra aba) não recria rascunhos. Sem identidade confirmável, não grava.
 * Remover é sempre permitido (só apaga a chave da própria conta).
 */
export function writeSupportDraft(ownerId: string | undefined, scope: string, value: string, store: DraftStore | null = defaultStore()): void {
  if (!ownerId || !store) return;
  try {
    if (!value) store.removeItem(supportDraftKey(ownerId, scope));
    else if (currentIdentity(store) === ownerId) store.setItem(supportDraftKey(ownerId, scope), value);
  } catch { /* sem armazenamento: o rascunho só não persiste */ }
}

/**
 * Apaga os rascunhos da Central. Sem argumento, apaga todos (logout, sessão expirada). Com `keepOwnerId`, preserva
 * só os dessa conta (login: remove os de outras contas e as chaves antigas sem vínculo).
 */
export function clearSupportDrafts(keepOwnerId?: string, store: DraftStore | null = defaultStore()): void {
  if (!store) return;
  try {
    const keep = keepOwnerId ? `${PREFIX}${keepOwnerId}:` : null;
    const doomed: string[] = [];
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i);
      if (!k) continue;
      const mine = k.startsWith(PREFIX);
      const legacy = LEGACY_PREFIXES.some((p) => k.startsWith(p));
      if ((mine && !(keep && k.startsWith(keep))) || legacy) doomed.push(k);
    }
    doomed.forEach((k) => store.removeItem(k));
  } catch { /* sem armazenamento */ }
}
