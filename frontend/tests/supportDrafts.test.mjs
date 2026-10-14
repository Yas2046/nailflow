// Rascunhos da Central de Suporte: vínculo com a conta e limpeza.
// Rodar: node --test tests/supportDrafts.test.mjs   (Node >= 22.18; sem dependências)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  clearSupportDrafts, readSupportDraft, supportDraftKey, writeSupportDraft,
} from '../src/services/supportDrafts.ts';

class FakeStorage {
  #m = new Map();
  get length() { return this.#m.size; }
  key(i) { return [...this.#m.keys()][i] ?? null; }
  getItem(k) { return this.#m.has(k) ? this.#m.get(k) : null; }
  setItem(k, v) { this.#m.set(k, String(v)); }
  removeItem(k) { this.#m.delete(k); }
  keys() { return [...this.#m.keys()].sort(); }
}

const A = 'conta-a';
const B = 'conta-b';
const V = 'valor-de-teste'; // conteúdo neutro: os testes nunca usam texto realista
// Simula o login de `id` neste navegador (o AuthContext grava essa chave).
const loginAs = (s, id) => s.setItem('nailflow_professional', JSON.stringify({ id, name: 'n' }));

test('grava e lê por conta e por escopo', () => {
  const s = new FakeStorage();
  loginAs(s, A);
  writeSupportDraft(A, 'new', V, s);
  writeSupportDraft(A, 't-1', V + '1', s);
  assert.equal(readSupportDraft(A, 'new', s), V);
  assert.equal(readSupportDraft(A, 't-1', s), V + '1');
  assert.equal(readSupportDraft(A, 't-2', s), '');
});

test('outra conta não enxerga o rascunho (mesmo sem logout)', () => {
  const s = new FakeStorage();
  loginAs(s, A);
  writeSupportDraft(A, 'new', V, s);
  assert.equal(readSupportDraft(B, 'new', s), '');
  assert.equal(readSupportDraft(undefined, 'new', s), '');
});

test('sem conta identificada não grava nada', () => {
  const s = new FakeStorage();
  loginAs(s, A);
  writeSupportDraft(undefined, 'new', V, s);
  assert.deepEqual(s.keys(), ['nailflow_professional']);
});

test('valor vazio remove o rascunho', () => {
  const s = new FakeStorage();
  loginAs(s, A);
  writeSupportDraft(A, 'new', V, s);
  writeSupportDraft(A, 'new', '', s);
  assert.deepEqual(s.keys(), ['nailflow_professional']);
});

test('logout: clearSupportDrafts() apaga todos os rascunhos, de qualquer conta, e as chaves antigas', () => {
  const s = new FakeStorage();
  loginAs(s, A);
  writeSupportDraft(A, 'new', V, s);
  writeSupportDraft(A, 't-1', V, s);
  s.setItem(supportDraftKey(B, 'adm-9'), V);
  s.setItem('nf_support_new_draft', V); // chave antiga, sem vínculo
  s.setItem('nf_support_draft_t-1', V); // chave antiga, sem vínculo
  s.setItem('nf_theme', 'dark');
  clearSupportDrafts(undefined, s);
  assert.deepEqual(s.keys(), ['nailflow_professional', 'nf_theme']); // a identidade e o tema não são da Central
  assert.equal(readSupportDraft(A, 'new', s), '');
});

test('login: preserva só os rascunhos da conta que entrou e remove os demais e os antigos', () => {
  const s = new FakeStorage();
  loginAs(s, A);
  writeSupportDraft(A, 'new', V, s);
  s.setItem(supportDraftKey(B, 'new'), V + 'b');
  s.setItem('nf_support_new_draft', V);
  s.setItem('outra_chave', 'x');
  clearSupportDrafts(A, s);
  assert.deepEqual(s.keys(), ['nailflow_professional', 'outra_chave', supportDraftKey(A, 'new')].sort());
  assert.equal(readSupportDraft(A, 'new', s), V);
  assert.equal(readSupportDraft(B, 'new', s), '');
});

test('o id de uma conta que é prefixo de outro não preserva o rascunho da outra', () => {
  const s = new FakeStorage();
  loginAs(s, '1');
  writeSupportDraft('1', 'new', V, s);
  s.setItem(supportDraftKey('12', 'new'), V);
  clearSupportDrafts('1', s);
  assert.equal(readSupportDraft('1', 'new', s), V);
  assert.equal(readSupportDraft('12', 'new', s), '');
});

// ── identidade: uma aba desatualizada não pode recriar rascunhos ────────────────────────────────────────────────
test('identidade armazenada = A: a conta A grava', () => {
  const s = new FakeStorage();
  loginAs(s, A);
  writeSupportDraft(A, 'new', V, s);
  assert.equal(readSupportDraft(A, 'new', s), V);
});

test('identidade mudou para B (outra aba entrou com outra conta): a aba da conta A não grava', () => {
  const s = new FakeStorage();
  loginAs(s, A);
  writeSupportDraft(A, 'new', V, s);
  loginAs(s, B); // outra aba entrou como B
  writeSupportDraft(A, 'new', V + '2', s);
  writeSupportDraft(A, 't-1', V, s);
  assert.equal(readSupportDraft(A, 'new', s), V); // nada novo foi gravado
  assert.equal(readSupportDraft(A, 't-1', s), '');
  writeSupportDraft(B, 'new', V + 'b', s); // e B grava normalmente
  assert.equal(readSupportDraft(B, 'new', s), V + 'b');
});

test('identidade removida (logout em outra aba): a aba da conta A não recria o rascunho', () => {
  const s = new FakeStorage();
  loginAs(s, A);
  writeSupportDraft(A, 'new', V, s);
  s.removeItem('nailflow_professional'); // logout em outra aba
  clearSupportDrafts(undefined, s);
  writeSupportDraft(A, 'new', V, s); // a aba antiga ainda digitando
  writeSupportDraft(A, 't-1', V, s);
  assert.deepEqual(s.keys(), []);
});

test('apagar continua permitido mesmo sem identidade confirmável', () => {
  const s = new FakeStorage();
  loginAs(s, A);
  writeSupportDraft(A, 'new', V, s);
  s.removeItem('nailflow_professional');
  writeSupportDraft(A, 'new', '', s);
  assert.equal(s.getItem(supportDraftKey(A, 'new')), null);
});

for (const [nome, valor] of [
  ['JSON inválido', '{nao-json'],
  ['JSON nulo', 'null'],
  ['sem campo id', '{"name":"n"}'],
  ['id vazio', '{"id":""}'],
  ['id que não é texto', '{"id":123}'],
  ['valor que não é objeto', '"texto"'],
]) {
  test(`identidade armazenada inválida (${nome}): não grava`, () => {
    const s = new FakeStorage();
    s.setItem('nailflow_professional', valor);
    writeSupportDraft(A, 'new', V, s);
    assert.equal(s.keys().filter((k) => k.startsWith('nf_support_draft:')).length, 0);
  });
}

test('identidade armazenada inacessível (erro ao ler): não grava e não quebra', () => {
  const m = new Map();
  const s = {
    get length() { return m.size; }, key: (i) => [...m.keys()][i] ?? null,
    getItem(k) { if (k === 'nailflow_professional') throw new Error('x'); return m.get(k) ?? null; },
    setItem(k, v) { m.set(k, v); }, removeItem(k) { m.delete(k); },
  };
  assert.doesNotThrow(() => writeSupportDraft(A, 'new', V, s));
  assert.equal(m.size, 0);
});

test('armazenamento indisponível ou com erro não quebra a tela', () => {
  assert.doesNotThrow(() => writeSupportDraft(A, 'new', V, null));
  assert.equal(readSupportDraft(A, 'new', null), '');
  assert.doesNotThrow(() => clearSupportDrafts(undefined, null));
  const boom = { length: 1, key() { throw new Error('x'); }, getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); }, removeItem() { throw new Error('x'); } };
  assert.doesNotThrow(() => clearSupportDrafts(undefined, boom));
  assert.equal(readSupportDraft(A, 'new', boom), '');
  assert.doesNotThrow(() => writeSupportDraft(A, 'new', V, boom));
});

// Verificação estática dos caminhos que encerram a sessão (o projeto não tem framework de teste de componentes).
const src = (p) => fs.readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');
const body = (code, startMarker) => {
  const i = code.indexOf(startMarker);
  assert.ok(i >= 0, `trecho não encontrado: ${startMarker}`);
  return code.slice(i, i + 700);
};

test('todos os caminhos de sessão chamam a limpeza (logout, 401 e login)', () => {
  const auth = src('context/AuthContext.tsx');
  assert.match(body(auth, 'function logout()'), /clearSupportDrafts\(\)/);
  assert.match(body(auth, 'async function login('), /clearSupportDrafts\(data\.professional\.id\)/);
  const api = src('services/api.ts');
  assert.match(body(api, 'res.status === 401'), /clearSupportDrafts\(\)/);
});

test('o código da Central não usa mais as chaves antigas nem localStorage direto para rascunhos', () => {
  for (const f of ['components/support/Thread.tsx', 'pages/suporte/SuporteNova.tsx']) {
    const code = src(f);
    assert.ok(!/nf_support_(new_)?draft/.test(code), `${f}: chave antiga`);
    assert.ok(!/localStorage/.test(code), `${f}: localStorage direto`);
  }
});

test('todo logout da interface passa pelo logout do AuthContext (sem chamada direta a /auth/logout)', () => {
  const offenders = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(e.name) && /['"`]\/auth\/logout['"`]/.test(fs.readFileSync(p, 'utf8'))) offenders.push(p);
    }
  };
  walk(new URL('../src', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
  assert.equal(offenders.filter((p) => !p.endsWith('context/AuthContext.tsx')).length, 0, offenders.join(', '));
});
