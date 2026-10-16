// Aviso de privacidade do formulário da Central de Suporte: conteúdo, contato visível, ausência do link da política
// enquanto ela não estiver publicada e proteção contra habilitação indevida do link.
// Este arquivo NÃO depende da página /privacidade, dos links de rodapé nem dos documentos de LGPD: só do módulo do
// aviso, do componente e do formulário. Quando o módulo da política existe, ele também confere a coerência entre os dois.
// Rodar:  node --test tests/support-notice.test.mjs        (Node >= 22.18; sem dependências)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as N from '../src/content/avisoPrivacidade.ts';
import { evaluateLinkGuard, readPublishedFlag } from './helpers/policyLinkGuard.mjs';

const url = (rel) => new URL(`../src/${rel}`, import.meta.url);
const src = (rel) => fs.readFileSync(url(rel), 'utf8');
const has = (rel) => fs.existsSync(url(rel));
const SRC_ROOT = fileURLToPath(new URL('../src/', import.meta.url));
const DOCS_DIR = fileURLToPath(new URL('../../docs/', import.meta.url));

const NOTICE_SRC = src('content/avisoPrivacidade.ts');
const COMPONENT = src('components/support/SupportPrivacyNotice.tsx');
const POLICY_MODULE = 'content/politicaPrivacidade.ts';
// A política só existe quando o commit da página de privacidade também existe; sem ela, as checagens cruzadas são puladas.
const P = has(POLICY_MODULE) ? await import('../src/content/politicaPrivacidade.ts') : null;

// (undefined não entra: como argumento explícito, o JavaScript usa o valor padrão, que é o contato informado.)
const BAD_CONTACTS = ['', '   ', null, 'A INFORMAR', 'a definir', '[[A INFORMAR: contato]]', '[CONFIRMAR]', 'TODO', 'TBD', 'XXX', 'pendente', 'N/A', '...', '-', 'lorem ipsum dolor'];

// ── conteúdo exportado pelo módulo do aviso ─────────────────────────────────

test('o módulo do aviso não importa nada e exporta só o que o aviso precisa', () => {
  assert.ok(!/^\s*(import\s|export\s+\*|export\s*\{[^}]*\}\s*from)/m.test(NOTICE_SRC), 'o módulo do aviso não pode importar nem reexportar outros módulos');
  assert.deepEqual(
    Object.keys(N).sort(),
    ['POLICY_PAGE_PUBLISHED', 'PRIVACY_CONTACT', 'SUPPORT_NOTICE_TEXT', 'SUPPORT_NOTICE_TITLE', 'noticeContact'],
  );
});

test('nada do que o módulo exporta (nem o seu código) carrega dados da política, nome civil ou texto de política publicada', () => {
  const exported = JSON.stringify({ ...N, contactResult: N.noticeContact() });
  for (const [label, text] of [['exportado', exported], ['código-fonte', NOTICE_SRC]]) {
    // O contato (e-mail) contém partes do nome e é visível de propósito; o nome civil não pode aparecer fora dele.
    const withoutContact = text.split(N.PRIVACY_CONTACT).join('');
    assert.ok(!/Yasmin|Teles|Vales/i.test(withoutContact), `${label}: nome civil`);
    assert.ok(!/Rascunho|aprovado juridicamente|\[\[|A INFORMAR|JURÍDICO/.test(text), `${label}: texto de rascunho da política`);
    assert.ok(!/Hub Europe|Contabo|Cloud VPS|Auto Backup|Let.s Encrypt|DuckDNS|Google Fonts/.test(text), `${label}: dados de hospedagem ou fornecedores`);
    assert.ok(!/controllerName|legalReview|serverRegion|legalBasisText|internationalTransferText/.test(text), `${label}: campos da política`);
    assert.ok(!/política de privacidade do NailFlow|mantidas conforme/i.test(text), `${label}: promete política publicada`);
  }
  const emails = exported.match(/[\w.+-]+@[\w-]+\.[\w.-]+/g) ?? [];
  assert.ok(emails.length >= 1 && emails.every((e) => e === N.PRIVACY_CONTACT), 'o único e-mail exportado é o contato de privacidade');
});

// ── aviso e contato ─────────────────────────────────────────────────────────

test('o texto do aviso é informativo: sem prazos, sem promessa de política, sem aceite', () => {
  for (const frag of ['equipe de suporte', 'equipe técnica', 'cópias de segurança', 'senhas', 'dados de cartão', 'dados de clientes', 'Anexos não são aceitos']) {
    assert.ok(N.SUPPORT_NOTICE_TEXT.includes(frag), `aviso sem: ${frag}`);
  }
  assert.ok(!/\d/.test(N.SUPPORT_NOTICE_TEXT), 'o aviso não cita prazos nem números');
  assert.ok(N.SUPPORT_NOTICE_TITLE.length > 0);
  assert.ok(!/<input|checkbox|onChange|useState/.test(COMPONENT), 'o aviso é só informativo: sem caixa de aceite nem estado');
});

test('o contato de privacidade é um e-mail, aparece nos dois ramos do aviso e nunca é um marcador', () => {
  assert.match(N.PRIVACY_CONTACT, /^[^@\s]+@[^@\s]+\.[^@\s]+$/);
  assert.equal(N.noticeContact(), N.PRIVACY_CONTACT);
  assert.equal(N.noticeContact('  alguem@exemplo.com  '), 'alguem@exemplo.com', 'aparado');
  for (const v of BAD_CONTACTS) assert.equal(N.noticeContact(v), null, `noticeContact(${JSON.stringify(v)}) deveria ser null`);
  assert.match(COMPONENT, /noticeContact\(\)/);
  assert.ok(COMPONENT.includes('Dúvidas sobre seus dados: {contact}'), 'sem a página publicada, o aviso mostra o contato');
  assert.ok(COMPONENT.includes('ou fale com {contact}'), 'com a página publicada, o aviso também mostra o contato');
});

test('quando o módulo da política existe, o contato é o mesmo e a regra de marcadores é equivalente', { skip: !P && 'módulo da política ainda não está neste commit' }, () => {
  assert.equal(P.POLICY_FIELDS.privacyContact, N.PRIVACY_CONTACT, 'um único lugar para trocar o contato');
  assert.equal(P.SUPPORT_NOTICE_TEXT, N.SUPPORT_NOTICE_TEXT);
  assert.equal(P.SUPPORT_NOTICE_TITLE, N.SUPPORT_NOTICE_TITLE);
  for (const v of BAD_CONTACTS.filter((x) => typeof x === 'string')) {
    if (P.isPlaceholder(v)) assert.equal(N.noticeContact(v), null, `${JSON.stringify(v)} é marcador na política e precisa ser rejeitado no aviso`);
  }
});

// ── link da política desabilitado por padrão ────────────────────────────────

test('estado atual: a página da política não está publicada e o aviso não tem link para ela', () => {
  assert.equal(N.POLICY_PAGE_PUBLISHED, false, 'ao habilitar o link, atualize este teste junto com a publicação da página');
  const open = COMPONENT.indexOf('POLICY_PAGE_PUBLISHED ? (');
  const close = COMPONENT.indexOf(') : contact ? (');
  const link = COMPONENT.indexOf('to="/privacidade"');
  assert.ok(open > 0 && close > open, 'estrutura do componente alterada');
  assert.ok(link > open && link < close, 'o link precisa ficar só dentro do ramo "publicada"');
  assert.equal(COMPONENT.split('/privacidade').length - 1, 1, 'uma única referência a /privacidade no componente');
  for (const dir of ['components/support', 'pages/suporte']) {
    for (const f of fs.readdirSync(url(dir))) {
      if (f === 'SupportPrivacyNotice.tsx') continue;
      assert.ok(!src(`${dir}/${f}`).includes('/privacidade'), `${dir}/${f} aponta para /privacidade`);
    }
  }
});

test('o componente depende só do módulo do aviso e do roteador, e não pode alterar a chave localmente', () => {
  const imports = [...COMPONENT.matchAll(/from '([^']+)'/g)].map((m) => m[1]).sort();
  assert.deepEqual(imports, ['../../content/avisoPrivacidade', 'react-router-dom']);
  assert.ok(!/politicaPrivacidade|POLICY_FIELDS|isPolicyReady|buildPolicy/.test(COMPONENT), 'o aviso não pode usar a política completa');
  assert.ok(!/POLICY_PAGE_PUBLISHED\s*(=|:)/.test(COMPONENT), 'a chave não pode ser redefinida no componente');
});

// ── proteção contra habilitação indevida (executável: roda a guarda sobre a árvore real e sobre árvores sintéticas) ──

/** Monta uma árvore mínima (src/ e docs/) em pasta temporária e devolve os caminhos para a guarda. */
function makeTree({ flag = 'true', policy = 'ready', route = true, importPage = true, page = true, docs = 'ok' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-guard-'));
  const put = (rel, text) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); };
  const declaration = flag.startsWith('=') ? `export const POLICY_PAGE_PUBLISHED ${flag};` : `export const POLICY_PAGE_PUBLISHED: boolean = ${flag};`;
  put('src/content/avisoPrivacidade.ts', `${declaration}\n`);
  const stub = (ready, text) => `export const isPolicyReady = () => ${ready};\nexport const pendingFields = () => ${ready ? '[]' : "['legalReview']"};\nexport const buildPolicy = () => [];\nexport const policyPlainText = () => ${JSON.stringify(text)};\n`;
  if (policy === 'ready') put('src/content/politicaPrivacidade.ts', stub(true, 'Texto pronto, sem marcadores.'));
  if (policy === 'pending') put('src/content/politicaPrivacidade.ts', stub(false, 'Texto com pendências.'));
  if (policy === 'markers') put('src/content/politicaPrivacidade.ts', stub(true, 'Texto com [[JURÍDICO: base legal]] pendente.'));
  put('src/App.tsx', `${importPage ? "import Privacidade from './pages/Privacidade';\n" : ''}${route ? '<Route path="/privacidade" element={<Privacidade />} />\n' : ''}`);
  if (page) put('src/pages/Privacidade.tsx', 'export default function Privacidade() { return null; }\n');
  if (docs === 'ok') put('docs/ATENDIMENTO_TITULARES.md', '# Atendimento\nSem pendências.\n');
  if (docs === 'markers') put('docs/ATENDIMENTO_TITULARES.md', '# Atendimento\nPrazo: [A DEFINIR pela responsável]\n');
  return { srcRoot: path.join(root, 'src'), docsDir: path.join(root, 'docs'), cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

async function guardOn(options) {
  const tree = makeTree(options);
  try { return await evaluateLinkGuard(tree); } finally { tree.cleanup(); }
}

test('GUARDA (estado real): a chave só pode estar ligada com política pronta, sem marcadores, rota, página e documentos sem pendência', async () => {
  const result = await evaluateLinkGuard({ srcRoot: SRC_ROOT, docsDir: DOCS_DIR });
  assert.equal(result.published, N.POLICY_PAGE_PUBLISHED, 'a guarda lê a mesma chave que o módulo exporta');
  assert.deepEqual(result.violations, [], 'POLICY_PAGE_PUBLISHED=true sem os pré-requisitos');
});

test('GUARDA (executada): com tudo pronto a chave ligada é aceita; com a chave desligada nada é exigido', async () => {
  assert.deepEqual((await guardOn()).violations, []);
  const off = await guardOn({ flag: 'false', policy: 'absent', route: false, importPage: false, page: false, docs: 'absent' });
  assert.equal(off.published, false);
  assert.deepEqual(off.violations, [], 'desligada nunca é violação');
});

test('GUARDA (executada): cada pré-requisito que falta, com a chave ligada, é uma violação específica', async () => {
  const cases = [
    ['política inexistente', { policy: 'absent' }, /política \(content\/politicaPrivacidade\.ts\) não existe/],
    ['política com pendências', { policy: 'pending' }, /não está pronta \(pendências: legalReview\)/],
    ['texto da política com marcador', { policy: 'markers' }, /1 marcador\(es\)/],
    ['rota não registrada', { route: false }, /rota \/privacidade não está registrada/],
    ['página não importada', { importPage: false }, /não importa a página Privacidade/],
    ['arquivo da página inexistente', { page: false }, /pages\/Privacidade\.tsx não existe/],
    ['documento com marcadores', { docs: 'markers' }, /ATENDIMENTO_TITULARES\.md ainda tem marcadores/],
    ['documento inexistente', { docs: 'absent' }, /ATENDIMENTO_TITULARES\.md não existe/],
  ];
  for (const [label, options, expected] of cases) {
    const { violations } = await guardOn(options);
    assert.equal(violations.length, 1, `${label}: esperava exatamente 1 violação, veio ${JSON.stringify(violations)}`);
    assert.match(violations[0], expected, label);
  }
  const everything = await guardOn({ policy: 'absent', route: false, importPage: false, page: false, docs: 'absent' });
  assert.equal(everything.violations.length, 5, 'sem nada pronto: política, rota, importação, página e documento');
});

test('GUARDA (executada): declaração da chave em formato não reconhecido faz a guarda FALHAR em vez de passar', async () => {
  const tree = makeTree({ flag: '= Boolean(1)' });
  try {
    assert.throws(() => readPublishedFlag(tree.srcRoot), /não encontrada ou em formato não reconhecido/);
    await assert.rejects(evaluateLinkGuard(tree), /formato não reconhecido/);
  } finally { tree.cleanup(); }
});

test('GUARDA (executada sobre o código real): ligar a chave numa cópia do módulo real é recusado enquanto a política não estiver pronta', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-guard-real-'));
  try {
    for (const rel of ['content/avisoPrivacidade.ts', 'content/politicaPrivacidade.ts', 'App.tsx', 'pages/Privacidade.tsx']) {
      if (!has(rel)) continue; // no commit só do aviso, a política, a rota e a página ainda não existem
      fs.mkdirSync(path.dirname(path.join(root, 'src', rel)), { recursive: true });
      fs.copyFileSync(url(rel), path.join(root, 'src', rel));
    }
    const copy = path.join(root, 'src', 'content', 'avisoPrivacidade.ts');
    const original = fs.readFileSync(copy, 'utf8');
    const flipped = original.replace(/(export const POLICY_PAGE_PUBLISHED\s*(?::\s*boolean)?\s*=\s*)false(\s*;)/, '$1true$2');
    assert.notEqual(flipped, original, 'não foi possível ligar a chave na cópia: formato da declaração mudou');
    fs.writeFileSync(copy, flipped);
    const { published, violations } = await evaluateLinkGuard({ srcRoot: path.join(root, 'src'), docsDir: DOCS_DIR });
    assert.equal(published, true);
    if (violations.length === 0) {
      t.skip('a política, a rota, a página e os documentos já estão prontos: habilitar a chave passou a ser legítimo');
      return;
    }
    assert.ok(violations.length >= 1, 'ligar a chave com a política pendente precisa ser recusado');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// ── formulário e constante antiga ───────────────────────────────────────────

test('o formulário usa o componente do aviso e não cita mais uma política inexistente', () => {
  const nova = src('pages/suporte/SuporteNova.tsx');
  const service = src('services/support.ts');
  assert.match(nova, /import SupportPrivacyNotice from '\.\.\/\.\.\/components\/support\/SupportPrivacyNotice';/);
  assert.match(nova, /<SupportPrivacyNotice \/>/);
  assert.ok(!/PRIVACY_NOTICE/.test(nova + service), 'constante antiga ainda referenciada ou definida');
  assert.ok(!/política de privacidade do NailFlow|mantidas conforme/i.test(nova + service + COMPONENT + NOTICE_SRC), 'texto antigo sobre política publicada');
});

test('o comentário em support.ts descreve o comportamento real do aviso', () => {
  const service = src('services/support.ts');
  const lines = service.split('\n');
  const at = lines.findIndex((l) => l.includes('avisoPrivacidade'));
  assert.ok(at >= 0, 'comentário sobre o aviso ausente');
  const line = `${lines[at]} ${lines[at + 1] ?? ''}`; // o comentário ocupa duas linhas
  assert.ok(line.includes('content/avisoPrivacidade.ts'), 'aponta para o módulo do aviso');
  assert.ok(line.includes('POLICY_PAGE_PUBLISHED'), 'cita a chave do link');
  assert.ok(/contato/.test(line), 'cita o contato de privacidade');
  assert.ok(!/aponta para \/privacidade/.test(service), 'comentário antigo: o aviso não aponta para /privacidade');
});
