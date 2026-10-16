// Guarda de Origin contra CSRF (backend/src/middleware/originGuard.js).
//
// 1) Testes SEM banco (rodam sempre): a matriz completa de decisões do middleware.
// 2) Testes COM banco (servidor real, banco DESCARTÁVEL confirmado por tests/helpers/supportTestDb.js; só com
//    SUPPORT_API_TEST_DB_URL; uma suíte de banco por vez, --test-concurrency=1): origem oficial, origem externa, rotas do ADM
//    de publicar/despublicar, login, rotas públicas, /bot, preflight do CORS e o limitador de taxa.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createOriginGuard, normalizeOrigin } from '../src/middleware/originGuard.js';
import { dbWanted, skip, startHarness } from './helpers/supportHarness.js';

const OFFICIAL = 'https://nailflow.duckdns.org';
const EVIL = 'https://evil.example';

// ── 1) middleware isolado ────────────────────────────────────────────────────

function run(guard, { method = 'POST', headers = {} } = {}) {
  const out = { status: null, body: null, next: false };
  const res = { status(code) { out.status = code; return this; }, json(body) { out.body = body; return this; } };
  guard({ method, headers }, res, () => { out.next = true; });
  return out;
}
const guard = createOriginGuard({ allowedOrigin: OFFICIAL, logger: { error() {} } });
const allowed = (r) => assert.ok(r.next && r.status === null, `deveria passar, veio ${JSON.stringify(r)}`);
const refused = (r) => { assert.equal(r.next, false, 'não deveria chamar next()'); assert.equal(r.status, 403); assert.deepEqual(r.body, { error: 'Origem não permitida.' }); };
const UNSAFE = ['POST', 'PUT', 'PATCH', 'DELETE'];

test('métodos seguros nunca são tocados, mesmo com origem externa ou Sec-Fetch-Site cross-site (inclui o preflight do CORS)', () => {
  for (const method of ['GET', 'HEAD', 'OPTIONS']) {
    allowed(run(guard, { method, headers: { origin: EVIL } }));
    allowed(run(guard, { method, headers: { origin: 'null', 'sec-fetch-site': 'cross-site' } }));
    allowed(run(guard, { method }));
  }
});

test('origem oficial passa em todos os métodos que alteram dados, inclusive com variações equivalentes', () => {
  for (const method of UNSAFE) {
    allowed(run(guard, { method, headers: { origin: OFFICIAL } }));
    allowed(run(guard, { method, headers: { origin: 'HTTPS://NAILFLOW.DUCKDNS.ORG' } }));
    allowed(run(guard, { method, headers: { origin: `${OFFICIAL}/` } }));
    allowed(run(guard, { method, headers: { origin: 'https://nailflow.duckdns.org:443' } }));
    allowed(run(guard, { method, headers: { origin: OFFICIAL, 'sec-fetch-site': 'same-origin' } }));
  }
});

test('origem externa e todas as formas de falsificação por parecença são recusadas com 403 e mensagem genérica', () => {
  const bad = [
    EVIL, 'null', 'NULL', '', '   ',
    'http://nailflow.duckdns.org',                 // outro esquema
    'https://nailflow.duckdns.org:8443',           // outra porta
    'https://nailflow-n8n.duckdns.org',            // outro subdomínio do mesmo domínio público
    'https://duckdns.org',
    'https://www.nailflow.duckdns.org',
    'https://nailflow.duckdns.org.evil.example',   // prefixo
    'https://evil.example/https://nailflow.duckdns.org',
    'https://nailflow.duckdns.org@evil.example',   // credenciais
    'https://nailflow.duckdns.org/caminho',        // origem não é pura
    'https://nailflow.duckdns.org?x=1',
    'ftp://nailflow.duckdns.org', 'file://', 'nailflow.duckdns.org', 'javascript:alert(1)', 'https://',
    'http://localhost:5173', 'https://77.237.242.192',
  ];
  for (const method of UNSAFE) for (const origin of bad) refused(run(guard, { method, headers: { origin } }));
});

test('sem Origin: cliente que não é navegador (n8n, curl, testes) e navegador na própria origem passam', () => {
  for (const method of UNSAFE) {
    allowed(run(guard, { method }));
    allowed(run(guard, { method, headers: { authorization: 'Bearer x' } }));
    allowed(run(guard, { method, headers: { cookie: 'nailflow_token=x' } }));
    allowed(run(guard, { method, headers: { 'sec-fetch-site': 'same-origin' } }));
    allowed(run(guard, { method, headers: { 'sec-fetch-site': 'none' } }));
    allowed(run(guard, { method, headers: { 'sec-fetch-site': 'valor-desconhecido' } }));
  }
});

test('sem Origin, mas o navegador declara contexto de outro site (Sec-Fetch-Site cross-site ou same-site): recusa', () => {
  for (const method of UNSAFE) {
    refused(run(guard, { method, headers: { 'sec-fetch-site': 'cross-site' } }));
    refused(run(guard, { method, headers: { 'sec-fetch-site': 'same-site', cookie: 'nailflow_token=x' } }));
  }
});

test('com Origin oficial a decisão é pelo Origin; Sec-Fetch-Site só é consultado quando o Origin falta', () => {
  allowed(run(guard, { headers: { origin: OFFICIAL, 'sec-fetch-site': 'cross-site' } }));
  refused(run(guard, { headers: { origin: EVIL, 'sec-fetch-site': 'same-origin' } }));
});

test('FRONTEND_URL com barra final, caminho ou maiúsculas vale como a mesma origem; a origem da requisição não pode ter caminho', () => {
  const g = createOriginGuard({ allowedOrigin: 'HTTPS://NailFlow.DuckDNS.org/app/', logger: { error() {} } });
  allowed(run(g, { headers: { origin: OFFICIAL } }));
  refused(run(g, { headers: { origin: `${OFFICIAL}/app` } }));
  assert.equal(normalizeOrigin('https://x.example:443/'), 'https://x.example');
  assert.equal(normalizeOrigin('http://x.example:80'), 'http://x.example');
  assert.equal(normalizeOrigin('http://localhost:5173'), 'http://localhost:5173');
  assert.equal(normalizeOrigin('https://x.example/p', { lenient: true }), 'https://x.example');
  for (const v of [undefined, null, 5, {}, [], 'null', '', 'x', 'https://u:p@x.example']) assert.equal(normalizeOrigin(v), null, String(v));
});

test('FORA de produção: FRONTEND_URL ausente usa o padrão de desenvolvimento; inválida desativa SÓ esta verificação e registra o erro', () => {
  const saved = process.env.FRONTEND_URL;
  delete process.env.FRONTEND_URL;
  try {
    for (const given of [undefined, '', '   ']) {
      const dev = createOriginGuard({ allowedOrigin: given, production: false, logger: { error() { assert.fail('não deveria registrar erro'); } } });
      allowed(run(dev, { headers: { origin: 'http://localhost:5173' } }));
      refused(run(dev, { headers: { origin: EVIL } }));
    }
    const viaEnv = createOriginGuard({ production: false, logger: { error() { assert.fail('não deveria registrar erro'); } } });
    allowed(run(viaEnv, { headers: { origin: 'http://localhost:5173' } }));
  } finally { if (saved === undefined) delete process.env.FRONTEND_URL; else process.env.FRONTEND_URL = saved; }

  const logged = [];
  const off = createOriginGuard({ allowedOrigin: 'nailflow.duckdns.org', production: false, logger: { error: (m) => logged.push(m) } });
  assert.equal(logged.length, 1);
  assert.match(logged[0], /FRONTEND_URL inválida.*DESATIVADA/);
  allowed(run(off, { headers: { origin: EVIL } }));   // fora de produção: não atrapalha quem desenvolve ou testa
});

// Passar `undefined` como allowedOrigin aplica o valor padrão (process.env.FRONTEND_URL): quem testa "ausente" precisa
// isolar o ambiente (o harness de banco define FRONTEND_URL para o servidor de teste).
function withoutFrontendUrl(fn) {
  const saved = process.env.FRONTEND_URL;
  delete process.env.FRONTEND_URL;
  try { return fn(); } finally { if (saved === undefined) delete process.env.FRONTEND_URL; else process.env.FRONTEND_URL = saved; }
}

test('EM PRODUÇÃO: FRONTEND_URL ausente, vazia ou inválida lança erro (a proteção nunca fica desligada em silêncio); a válida funciona', () => withoutFrontendUrl(() => {
  const noLog = { error() { assert.fail('em produção o erro é lançado, não apenas registrado'); } };
  for (const bad of [undefined, null, '', '   ', 'nailflow.duckdns.org', 'ftp://nailflow.duckdns.org', 'https://', 'null', 'javascript:alert(1)', 5, {}]) {
    assert.throws(() => createOriginGuard({ allowedOrigin: bad, production: true, logger: noLog }), /em produção, FRONTEND_URL precisa ser a origem oficial/, `deveria lançar para ${JSON.stringify(bad)}`);
  }
  const ok = createOriginGuard({ allowedOrigin: OFFICIAL, production: true, logger: noLog });
  allowed(run(ok, { headers: { origin: OFFICIAL } }));
  refused(run(ok, { headers: { origin: EVIL } }));
  allowed(run(createOriginGuard({ allowedOrigin: `${OFFICIAL}/`, production: true, logger: noLog }), { headers: { origin: OFFICIAL } }));
  // a mensagem não repete o valor configurado
  assert.throws(() => createOriginGuard({ allowedOrigin: 'valor-secreto-xyz', production: true, logger: noLog }), (e) => !e.message.includes('valor-secreto-xyz'));
}));

test('EM PRODUÇÃO, lido do ambiente: NODE_ENV=production sem FRONTEND_URL lança; NODE_ENV diferente não', () => {
  const saved = { node: process.env.NODE_ENV, url: process.env.FRONTEND_URL };
  delete process.env.FRONTEND_URL;
  try {
    process.env.NODE_ENV = 'production';
    assert.throws(() => createOriginGuard({ logger: { error() {} } }), /em produção, FRONTEND_URL/);
    process.env.FRONTEND_URL = OFFICIAL;
    allowed(run(createOriginGuard(), { headers: { origin: OFFICIAL } }));
    for (const env of ['test', 'development', undefined]) {
      if (env === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = env;
      delete process.env.FRONTEND_URL;
      assert.doesNotThrow(() => createOriginGuard({ logger: { error() {} } }), `NODE_ENV=${env}`);
    }
  } finally {
    if (saved.node === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = saved.node;
    if (saved.url === undefined) delete process.env.FRONTEND_URL; else process.env.FRONTEND_URL = saved.url;
  }
});

// ── inicialização do servidor real em modo produção (processo separado; porta aleatória; sem .env nem banco real) ──
// O ambiente do filho é MÍNIMO e hermético: não herda nada deste processo (nada de DATABASE_URL real), roda em um diretório
// vazio (o dotenv não acha .env) e usa uma porta livre aleatória, nunca a 3333.
const SERVER_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/server.js');

async function freePort() {
  for (;;) {
    const port = await new Promise((resolve, reject) => {
      const s = net.createServer();
      s.once('error', reject);
      s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
    });
    if (port !== 3333) return port;
  }
}

async function startServerProcess(extraEnv) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-origin-boot-'));
  const port = await freePort();
  const env = { PATH: process.env.PATH, JWT_SECRET: 'segredo-de-teste-da-inicializacao', DATABASE_URL: 'postgres://nao_existe:nao_existe@127.0.0.1:1/nao_existe', PORT: String(port), ...extraEnv };
  const child = spawn(process.execPath, [SERVER_FILE], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d) => { stdout += d; });
  child.stderr.on('data', (d) => { stderr += d; });
  const exited = new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })));
  const cleanup = () => { try { child.kill('SIGKILL'); } catch { /* já saiu */ } fs.rmSync(cwd, { recursive: true, force: true }); };
  return { child, port, exited, out: () => ({ stdout, stderr }), cleanup };
}

test('produção sem FRONTEND_URL, vazia ou inválida: o processo NÃO inicia (sai com erro claro e não escuta porta)', { timeout: 60_000 }, async () => {
  for (const [label, url] of [['ausente', undefined], ['vazia', ''], ['sem esquema', 'nailflow.duckdns.org'], ['esquema inválido', 'ftp://nailflow.duckdns.org']]) {
    const p = await startServerProcess({ NODE_ENV: 'production', ...(url === undefined ? {} : { FRONTEND_URL: url }) });
    try {
      const result = await Promise.race([p.exited, new Promise((r) => setTimeout(() => r({ code: 'TIMEOUT' }), 20_000))]);
      assert.notEqual(result.code, 'TIMEOUT', `${label}: o processo deveria ter encerrado`);
      assert.notEqual(result.code, 0, `${label}: deveria sair com erro`);
      const { stdout, stderr } = p.out();
      assert.match(stderr, /em produção, FRONTEND_URL precisa ser a origem oficial/, `${label}: mensagem clara no erro padrão`);
      assert.ok(!/rodando em/.test(stdout), `${label}: não pode ter começado a escutar`);
    } finally { p.cleanup(); }
  }
});

test('produção com FRONTEND_URL válida: o processo inicia, escuta a porta e a guarda recusa Origin externo e aceita o oficial', { timeout: 60_000 }, async () => {
  const p = await startServerProcess({ NODE_ENV: 'production', FRONTEND_URL: OFFICIAL });
  try {
    const deadline = Date.now() + 20_000;
    while (!/rodando em/.test(p.out().stdout)) {
      if (Date.now() > deadline) assert.fail(`o servidor não iniciou a tempo\n${JSON.stringify(p.out())}`);
      await new Promise((r) => setTimeout(r, 50));
    }
    const base = `http://127.0.0.1:${p.port}`;
    assert.equal((await fetch(`${base}/health`)).status, 200);
    const login = (origin) => fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) }, body: '{}' });
    assert.equal((await login(EVIL)).status, 403, 'origem externa recusada pela guarda');
    assert.notEqual((await login(OFFICIAL)).status, 403, 'origem oficial segue para a rota (400 de validação)');
    assert.notEqual((await login()).status, 403, 'sem Origin segue para a rota');
    assert.ok(!/originGuard/.test(p.out().stderr), 'nenhum erro da guarda no log');
  } finally { p.cleanup(); }
});

test('fora de produção, o servidor inicia mesmo sem FRONTEND_URL (padrão de desenvolvimento)', { timeout: 60_000 }, async () => {
  const p = await startServerProcess({ NODE_ENV: 'development' });
  try {
    const deadline = Date.now() + 20_000;
    while (!/rodando em/.test(p.out().stdout)) {
      if (Date.now() > deadline) assert.fail(`o servidor não iniciou a tempo\n${JSON.stringify(p.out())}`);
      await new Promise((r) => setTimeout(r, 50));
    }
    const base = `http://127.0.0.1:${p.port}`;
    assert.equal((await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://localhost:5173' }, body: '{}' })).status === 403, false);
    assert.equal((await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', origin: EVIL }, body: '{}' })).status, 403);
  } finally { p.cleanup(); }
});

// ── 2) servidor real (banco descartável) ─────────────────────────────────────

const opts = { skip, timeout: 120_000 };
const BOT_KEY = 'chave-de-teste-do-bot-origin-guard';
let h;
let admin;
const createdArticles = [];

before(async () => {
  if (!dbWanted) return;
  h = await startHarness({ FRONTEND_URL: OFFICIAL, BOT_API_KEY: BOT_KEY });
  admin = await h.newProf({ admin: true });
});
after(async () => {
  if (!h) return;
  if (createdArticles.length) await h.pool.query('DELETE FROM support_faq_articles WHERE id = ANY($1::uuid[])', [createdArticles]);
  await h.stop();
});

async function send(method, urlPath, { as, origin, headers = {}, type, payload } = {}) {
  const hdrs = { ...headers };
  if (as) hdrs.cookie = `nailflow_token=${as.token}`;
  if (origin !== undefined) hdrs.origin = origin;
  if (type) hdrs['content-type'] = type;
  const res = await fetch(`${h.baseUrl}${urlPath}`, { method, headers: hdrs, body: payload === undefined ? undefined : (typeof payload === 'string' ? payload : JSON.stringify(payload)) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* sem corpo */ }
  return { status: res.status, json, headers: res.headers };
}
const J = 'application/json';
const ticketBody = (n) => ({ subject: `Origem ${n}`, category: 'agenda', body: 'Texto de teste da guarda de origem.', clientRequestId: randomUUID() });
const ticketCount = async (profId) => (await h.pool.query('SELECT count(*)::int AS n FROM support_tickets WHERE professional_id = $1', [profId])).rows[0].n;
const auditCount = async () => (await h.pool.query('SELECT count(*)::int AS n FROM admin_audit_log')).rows[0].n;
const articleStatus = async (id) => (await h.pool.query('SELECT status, published_at FROM support_faq_articles WHERE id = $1', [id])).rows[0];

test('profissional: com Origin oficial e sem Origin a solicitação é criada; origem externa, "null" e Sec-Fetch-Site cross-site são recusados sem criar nada', opts, async () => {
  const prof = await h.newProf();
  assert.equal((await send('POST', '/support/tickets', { as: prof, origin: OFFICIAL, type: J, payload: ticketBody(1) })).status, 201);
  assert.equal((await send('POST', '/support/tickets', { as: prof, type: J, payload: ticketBody(2) })).status, 201, 'sem Origin (cliente que não é navegador)');
  assert.equal((await send('POST', '/support/tickets', { as: prof, headers: { 'sec-fetch-site': 'same-origin' }, type: J, payload: ticketBody(3) })).status, 201);
  const before = await ticketCount(prof.id);
  for (const [label, o] of [['externa', { origin: EVIL }], ['null', { origin: 'null' }], ['subdomínio', { origin: 'https://nailflow-n8n.duckdns.org' }], ['cross-site sem Origin', { headers: { 'sec-fetch-site': 'cross-site' } }]]) {
    const r = await send('POST', '/support/tickets', { as: prof, ...o, type: J, payload: ticketBody(label) });
    assert.equal(r.status, 403, label);
    assert.deepEqual(r.json, { error: 'Origem não permitida.' }, label);
  }
  assert.equal(await ticketCount(prof.id), before, 'nenhuma solicitação pode ter sido criada pelas requisições recusadas');
});

test('formato do corpo continua validado: text/plain com Origin oficial segue sendo 400 (a guarda não substitui a validação)', opts, async () => {
  const prof = await h.newProf();
  const r = await send('POST', '/support/tickets', { as: prof, origin: OFFICIAL, type: 'text/plain', payload: JSON.stringify(ticketBody('t')) });
  assert.equal(r.status, 400);
});

test('requisições recusadas pela guarda não consomem o limitador de taxa (5 solicitações por hora)', opts, async () => {
  const prof = await h.newProf();
  for (let i = 0; i < 8; i++) assert.equal((await send('POST', '/support/tickets', { as: prof, origin: EVIL, type: J, payload: ticketBody(`x${i}`) })).status, 403);
  assert.equal((await send('POST', '/support/tickets', { as: prof, origin: OFFICIAL, type: J, payload: ticketBody('legitima') })).status, 201, 'a cota continua intacta');
});

test('ADM: publicar e despublicar artigo (rotas sem corpo) só valem com origem oficial ou sem Origin; origem externa não altera nada nem grava auditoria', opts, async () => {
  const created = await send('POST', '/admin/support/faq/articles', { as: admin, origin: OFFICIAL, type: J, payload: { categorySlug: 'agenda', title: 'Artigo da guarda de origem', body: 'Texto do artigo de teste.' } });
  assert.equal(created.status, 201);
  const id = created.json?.article?.id ?? created.json?.id;
  assert.ok(id, 'id do artigo criado');
  createdArticles.push(id);
  assert.equal((await articleStatus(id)).status, 'rascunho');
  const audits = await auditCount();

  for (const [label, o] of [['origem externa', { origin: EVIL }], ['null', { origin: 'null' }], ['externa com text/plain', { origin: EVIL, type: 'text/plain' }], ['cross-site sem Origin', { headers: { 'sec-fetch-site': 'cross-site' } }]]) {
    const r = await send('POST', `/admin/support/faq/articles/${id}/publish`, { as: admin, ...o });
    assert.equal(r.status, 403, `publish: ${label}`);
  }
  assert.equal((await articleStatus(id)).status, 'rascunho', 'nada foi publicado');
  assert.equal(await auditCount(), audits, 'recusas não gravam auditoria');

  assert.equal((await send('POST', `/admin/support/faq/articles/${id}/publish`, { as: admin, origin: OFFICIAL })).status, 200);
  assert.equal((await articleStatus(id)).status, 'publicado');
  for (const o of [{ origin: EVIL }, { origin: 'null' }, { headers: { 'sec-fetch-site': 'same-site' } }]) {
    assert.equal((await send('POST', `/admin/support/faq/articles/${id}/unpublish`, { as: admin, ...o })).status, 403);
  }
  assert.equal((await articleStatus(id)).status, 'publicado', 'nada foi despublicado');
  assert.equal((await send('POST', `/admin/support/faq/articles/${id}/unpublish`, { as: admin })).status, 200, 'sem Origin (cliente que não é navegador)');
  assert.equal((await articleStatus(id)).status, 'rascunho');
  assert.equal((await send('POST', `/admin/support/faq/articles/${id}/publish`, { as: admin, origin: OFFICIAL })).status, 200);
});

test('ADM: a guarda roda antes da autenticação; a autorização continua valendo (sem cookie 401; profissional comum 403; admin externo 403 pela origem)', opts, async () => {
  const art = createdArticles[0];
  const prof = await h.newProf();
  assert.equal((await send('POST', `/admin/support/faq/articles/${art}/publish`, { origin: EVIL })).status, 403, 'sem cookie e origem externa: recusado pela origem');
  assert.equal((await send('POST', `/admin/support/faq/articles/${art}/publish`, { origin: OFFICIAL })).status, 401, 'sem cookie e origem oficial: segue para a autenticação');
  assert.equal((await send('POST', `/admin/support/faq/articles/${art}/publish`, { as: prof, origin: OFFICIAL })).status, 403, 'profissional comum com origem oficial: negado pela autorização');
});

test('regressões: GET e o preflight do CORS não mudam (origem externa continua lendo/recebendo os mesmos cabeçalhos de antes)', opts, async () => {
  const prof = await h.newProf();
  const get = await send('GET', '/support/tickets', { as: prof, origin: EVIL });
  assert.equal(get.status, 200);
  assert.equal(get.headers.get('access-control-allow-origin'), OFFICIAL, 'o CORS continua devolvendo só a origem oficial');
  const pre = await send('OPTIONS', '/support/tickets', { origin: EVIL, headers: { 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' } });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('access-control-allow-origin'), OFFICIAL);
  assert.equal(pre.headers.get('access-control-allow-credentials'), 'true');
  assert.equal((await send('GET', '/health', { origin: EVIL })).status, 200);
});

test('regressões: login e rotas públicas com origem oficial funcionam como antes; origem externa é recusada', opts, async () => {
  const cred = { email: 'ninguem@teste.local', password: 'senha-errada-123' };
  assert.equal((await send('POST', '/auth/login', { origin: EVIL, type: J, payload: cred })).status, 403);
  assert.equal((await send('POST', '/auth/login', { origin: OFFICIAL, type: J, payload: cred })).status, 401, 'credencial inválida segue 401, não 403');
  assert.equal((await send('POST', '/auth/login', { type: J, payload: cred })).status, 401, 'sem Origin também segue 401');
  const pub = { clientName: 'Cliente', clientPhone: '5531999999999', serviceId: randomUUID(), startsAt: new Date(Date.now() + 86_400_000).toISOString() };
  const slug = `inexistente-${randomUUID().slice(0, 8)}`;
  const ok = await send('POST', `/public/${slug}/appointments`, { origin: OFFICIAL, type: J, payload: pub });
  assert.ok([400, 404].includes(ok.status), `rota pública com origem oficial não pode ser 403 (veio ${ok.status})`);
  assert.equal((await send('POST', `/public/${slug}/appointments`, { origin: EVIL, type: J, payload: pub })).status, 403);
});

test('regressões: /bot (n8n e Evolution, servidor a servidor, sem Origin e com Bearer) não é afetado', opts, async () => {
  const bearer = { authorization: `Bearer ${BOT_KEY}` };
  const semOrigin = await send('POST', '/bot/process', { headers: bearer, type: J, payload: { phone: '5531999999999', text: 'oi' } });
  assert.equal(semOrigin.status, 400, 'passa pela guarda e pela chave; a rota pede o campo instance');
  assert.match(semOrigin.json?.error ?? '', /instance/i);
  const chaveErrada = await send('POST', '/bot/process', { headers: { authorization: 'Bearer errada' }, type: J, payload: {} });
  assert.equal(chaveErrada.status, 401, 'chave errada segue 401');
  assert.equal((await send('GET', '/bot/instances', { headers: bearer })).status, 200);
  assert.equal((await send('POST', '/bot/process', { headers: bearer, origin: EVIL, type: J, payload: { phone: '5531999999999', text: 'oi' } })).status, 403,
    'um pedido com Origin externo (ou seja, vindo de um navegador de outro site) é recusado mesmo com a chave');
});
