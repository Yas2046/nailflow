// Retorno de clientes (sugestões, intervalo por serviço, preferências de contato) e vitrine da página pública (Instagram e galeria).
// Migrations 031 e 032 (retorno/vitrine e reserva atômica de lembretes). API HTTP real, role NÃO-DONA, banco DESCARTÁVEL (RETORNO_VITRINE_TEST_DB_URL; ver helpers/financeTestDb.js). Sem a variável, ignorado.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import pg from 'pg';
import { resolveFinanceTestDb, financeDb, psqlScript, readSql } from './helpers/financeTestDb.js';
import nodeHttp from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeInstagram, instagramUrl } from '../src/utils/instagram.js';
import { createRunner, loadWorkflow, WorkflowCrash } from './helpers/n8nWorkflowRunner.js';
// Os controladores importam config/db.js (pool). Importar no topo criaria o pool ANTES de before() definir DATABASE_URL; por isso são
// importados dentro dos testes (depois do before).

const VAR = 'RETORNO_VITRINE_TEST_DB_URL';
const EMAIL_LIKE = 'rtv-%@nf.test';
const ROLE = 'nf_rtv_app';
const T = { timeout: 120_000 };
const PNG_1X1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';

let skip = false;
let owner;
let db;
let server;
let baseUrl;
let appPool;
let secret;
const one = async (sql, params) => (await owner.query(sql, params)).rows[0];

async function mkProf(tag) {
  const id = randomUUID();
  await owner.query(`INSERT INTO professionals (id, name, email, password_hash, slug, business_name) VALUES ($1, $2, $3, 'x', $4, $5)`,
    [id, `Rtv ${tag}`, `rtv-${tag}-${id.slice(0, 8)}@nf.test`, `rtv-${tag}-${id.slice(0, 8)}`, `Studio ${tag}`]);
  const slug = (await one('SELECT slug FROM professionals WHERE id = $1', [id])).slug;
  return { id, slug, token: jwt.sign({ sub: id, ver: 1 }, secret, { expiresIn: '1h' }) };
}
const mkService = async (p, name, interval = null) => (await one(
  `INSERT INTO services (professional_id, name, price_cents, duration_minutes, return_interval_days) VALUES ($1, $2, 10000, 60, $3) RETURNING id`, [p.id, name, interval])).id;
let phoneN = 0;
const mkClient = async (p, name) => (await one(`INSERT INTO clients (professional_id, name, phone) VALUES ($1, $2, $3) RETURNING id`, [p.id, name, `5531${String(900000000 + ++phoneN)}`])).id;
/** Atendimento concluído há `daysAgo` dias (ou futuro confirmado com daysAgo negativo). */
async function mkAppt(p, clientId, serviceId, daysAgo, status = 'concluido') {
  const start = new Date(Date.now() - daysAgo * 86_400_000);
  await owner.query(`INSERT INTO appointments (professional_id, client_id, service_id, starts_at, ends_at, status, price_cents_snapshot) VALUES ($1, $2, $3, $4, $5, $6, 10000)`,
    [p.id, clientId, serviceId, start, new Date(start.getTime() + 3600_000), status]);
}
async function http(method, path, { as, body } = {}) {
  const h = {};
  if (as) h.cookie = `nailflow_token=${as.token}`;
  let payload;
  if (body !== undefined) { h['content-type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(`${baseUrl}${path}`, { method, headers: h, body: payload });
  const buf = Buffer.from(await res.arrayBuffer());
  let json = null;
  try { json = JSON.parse(buf.toString('utf8')); } catch { /* imagem ou 204 */ }
  return { status: res.status, json, buf, headers: res.headers };
}

before(async () => {
  const r = await resolveFinanceTestDb(process.env, VAR);
  if (r.skip) { skip = r.skip; return; }
  owner = new pg.Pool({ connectionString: r.url, options: '-c TimeZone=UTC', max: 5 });
  owner.on('error', () => {});
  db = financeDb(owner);
  await db.runFile('_rollback/032_reminder_attempts.down.sql').catch(() => {});
  await owner.query('DROP TABLE IF EXISTS portfolio_photos');
  await db.runFile('_rollback/031_retorno_vitrine.down.sql').catch(() => {});
  await db.reset({ emailLike: EMAIL_LIKE, roles: [ROLE] });
  await db.createAppRole(ROLE);
  await db.runFile('031_retorno_vitrine.sql');
  await db.runSql(psqlScript(await readSql('_ops/031_grant_app_role.sql'), { app_role: ROLE }));
  await db.runFile('032_reminder_attempts.sql');
  await db.runSql(psqlScript(await readSql('_ops/032_grant_app_role.sql'), { app_role: ROLE }));
  secret = 'rtv-test-secret';
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = secret;
  process.env.DATABASE_URL = db.appUrl(r.url, ROLE);
  process.env.FRONTEND_URL = 'http://localhost:5173';
  for (const v of ['N8N_WEBHOOK_CONFIRMED_URL', 'N8N_WEBHOOK_CANCELLED_URL', 'N8N_WEBHOOK_REJECTED_URL', 'N8N_WEBHOOK_MESSAGE_URL', 'N8N_BOT_WEBHOOK_URL']) process.env[v] = '';
  ({ pool: appPool } = await import('../src/config/db.js'));
  const { default: app } = await import('../src/server.js');
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (!owner) return;
  try {
    if (server) await new Promise((resolve) => server.close(resolve));
    await appPool?.end().catch(() => {});
    await owner.query(`DELETE FROM professionals WHERE email LIKE $1`, [EMAIL_LIKE]);
    await db.runFile('_rollback/032_reminder_attempts.down.sql').catch(() => {});
    await db.runFile('_rollback/031_retorno_vitrine.down.sql').catch(() => {});
    await db.reset({ emailLike: EMAIL_LIKE, roles: [ROLE] });
  } finally {
    await owner.end();
  }
});

const dbTest = (name, fn) => test(name, T, async (t) => { if (skip) return t.skip(skip); await fn(t); });

// ── regras puras (não precisam de banco) ─────────────────────────────────────
test('classifyReturn: manutenção pelo intervalo do serviço, sem agendar pelo limite, uma única sugestão', async () => {
  const { classifyReturn, DEFAULT_MAINTENANCE_DAYS } = await import('../src/controllers/clientsReturnController.js');
  assert.equal(classifyReturn({ daysSince: 10, intervalDays: null, inactiveDays: 45 }), null);
  assert.equal(classifyReturn({ daysSince: 24, intervalDays: null, inactiveDays: 45 }), null);
  assert.deepEqual(classifyReturn({ daysSince: 25, intervalDays: null, inactiveDays: 45 }), { reason: 'manutencao', intervalDays: DEFAULT_MAINTENANCE_DAYS, intervalIsDefault: true });
  assert.deepEqual(classifyReturn({ daysSince: 20, intervalDays: 15, inactiveDays: 45 }), { reason: 'manutencao', intervalDays: 15, intervalIsDefault: false });
  assert.equal(classifyReturn({ daysSince: 20, intervalDays: 30, inactiveDays: 45 }), null, 'serviço com intervalo maior: ainda não é hora');
  assert.equal(classifyReturn({ daysSince: 45, intervalDays: 15, inactiveDays: 45 }).reason, 'sem_agendar', 'passou do limite: a sugestão mais forte vence');
  assert.equal(classifyReturn({ daysSince: 70, intervalDays: null, inactiveDays: 60 }).reason, 'sem_agendar');
});

test('Instagram: aceita @usuario, usuario e URL; recusa o inválido; monta o link sozinho', () => {
  assert.deepEqual(normalizeInstagram('@Studio.Aline'), { ok: true, value: 'studio.aline' });
  assert.deepEqual(normalizeInstagram('https://www.instagram.com/studio_aline/?hl=pt'), { ok: true, value: 'studio_aline' });
  assert.deepEqual(normalizeInstagram('instagram.com/aline'), { ok: true, value: 'aline' });
  assert.deepEqual(normalizeInstagram('  '), { ok: true, value: null });
  assert.deepEqual(normalizeInstagram(null), { ok: true, value: null });
  for (const bad of ['a b', 'javascript:alert(1)', 'https://evil.com/x', 'a..b', '.aline', 'x'.repeat(31), '<script>']) assert.equal(normalizeInstagram(bad).ok, false, bad);
  assert.equal(instagramUrl('studio.aline'), 'https://www.instagram.com/studio.aline/');
  assert.equal(instagramUrl(null), null);
  assert.equal(instagramUrl('a b'), null);
});

test('galeria: a assinatura do arquivo precisa combinar com o tipo declarado', async () => {
  const { matchesSignature } = await import('../src/controllers/portfolioController.js');
  const png = Buffer.from(PNG_1X1.split(',')[1], 'base64');
  assert.equal(matchesSignature('image/png', png), true);
  assert.equal(matchesSignature('image/jpeg', png), false);
  assert.equal(matchesSignature('image/png', Buffer.from('isto é só texto, não uma imagem')), false);
  assert.equal(matchesSignature('image/jpeg', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0])), true);
  assert.equal(matchesSignature('image/webp', Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')])), true);
  assert.equal(matchesSignature('image/gif', png), false);
});

// ── retorno de clientes ──────────────────────────────────────────────────────
dbTest('sugestões: manutenção e sem agendar, por serviço; exclui quem já tem horário, pediu para não receber, está em pausa ou é de outra conta', async () => {
  const A = await mkProf('retA');
  const B = await mkProf('retB');
  const longa = await mkService(A, 'Alongamento', 20);      // intervalo configurado: 20 dias
  const gel = await mkService(A, 'Esmaltação em gel', null); // sem intervalo: padrão 25
  const mk = async (name, svc, days, status) => { const c = await mkClient(A, name); await mkAppt(A, c, svc, days, status ?? 'concluido'); return c; };

  const cedo = await mk('Cedo Demais', longa, 10);
  const manut = await mk('Manutenção Alongamento', longa, 22);
  const gelOk = await mk('Gel Padrão', gel, 26);
  const gelCedo = await mk('Gel Cedo', gel, 24);
  const sumida = await mk('Sumida', gel, 70);
  const comHorario = await mk('Com Horário Marcado', longa, 40);
  await mkAppt(A, comHorario, longa, -5, 'confirmado');
  const optOut = await mk('Não Quer Mensagens', longa, 41);
  const pausa = await mk('Em Pausa', longa, 42);
  const semConcluido = await mkClient(A, 'Nunca Concluiu');
  await mkAppt(A, semConcluido, longa, 44, 'cancelado');
  await owner.query(`UPDATE clients SET contact_opt_out = true WHERE id = $1`, [optOut]);
  await owner.query(`UPDATE clients SET return_snoozed_until = now() + interval '5 days' WHERE id = $1`, [pausa]);
  const outraConta = await mkClient(B, 'Cliente da Outra Conta');
  await mkAppt(B, outraConta, await mkService(B, 'Alongamento B', 5), 50);

  const r = await http('GET', '/clients/return-suggestions', { as: A });
  assert.equal(r.status, 200, 'a rota não pode ser engolida por /clients/:id');
  assert.deepEqual(r.json.defaults, { maintenanceDays: 25, inactiveDays: 45 });
  const byName = Object.fromEntries(r.json.items.map((i) => [i.name, i]));
  assert.deepEqual(Object.keys(byName).sort(), ['Gel Padrão', 'Manutenção Alongamento', 'Sumida']);
  assert.equal(byName['Manutenção Alongamento'].reason, 'manutencao');
  assert.equal(byName['Manutenção Alongamento'].intervalDays, 20);
  assert.equal(byName['Manutenção Alongamento'].intervalIsDefault, false);
  assert.equal(byName['Gel Padrão'].reason, 'manutencao');
  assert.equal(byName['Gel Padrão'].intervalIsDefault, true);
  assert.equal(byName['Sumida'].reason, 'sem_agendar');
  assert.equal(byName['Sumida'].lastServiceName, 'Esmaltação em gel');
  assert.ok(byName['Sumida'].daysSince >= 70 && byName['Sumida'].daysSince <= 71);
  assert.deepEqual(r.json.items.map((i) => i.name), ['Sumida', 'Gel Padrão', 'Manutenção Alongamento'], 'mais antigas primeiro (70, 26 e 22 dias)');
  assert.equal(new Set(r.json.items.map((i) => i.clientId)).size, r.json.items.length, 'uma sugestão por cliente');
  assert.ok(![cedo, gelCedo, comHorario, optOut, pausa, semConcluido, outraConta].some((id) => r.json.items.some((i) => i.clientId === id)));
  assert.ok(!JSON.stringify(r.json).includes(B.id));

  const m60 = await http('GET', '/clients/return-suggestions?inactiveDays=60', { as: A });
  assert.equal(m60.json.items.find((i) => i.name === 'Sumida').reason, 'sem_agendar');
  const m90 = await http('GET', '/clients/return-suggestions?inactiveDays=90', { as: A });
  assert.equal(m90.json.items.find((i) => i.name === 'Sumida').reason, 'manutencao', 'com limite de 90 dias, ela ainda é só manutenção');
  for (const bad of ['10', '999', 'abc', '45.5']) assert.equal((await http('GET', `/clients/return-suggestions?inactiveDays=${bad}`, { as: A })).status, 400, bad);
  assert.equal((await http('GET', '/clients/return-suggestions')).status, 401);
});

dbTest('preferências de contato: "não enviar" e pausa tiram a cliente das sugestões; só a dona altera', async () => {
  const A = await mkProf('prefA');
  const B = await mkProf('prefB');
  const svc = await mkService(A, 'Alongamento', 10);
  const c = await mkClient(A, 'Maria');
  await mkAppt(A, c, svc, 30);
  const has = async () => (await http('GET', '/clients/return-suggestions', { as: A })).json.items.some((i) => i.clientId === c);
  assert.equal(await has(), true);

  assert.equal((await http('PUT', `/clients/${c}/contact-preferences`, { as: B, body: { contactOptOut: true } })).status, 404, 'outra conta não altera');
  assert.equal(await has(), true);

  const snooze = await http('PUT', `/clients/${c}/contact-preferences`, { as: A, body: { snoozeDays: 14 } });
  assert.equal(snooze.status, 200);
  assert.ok(new Date(snooze.json.returnSnoozedUntil) > new Date());
  assert.equal(await has(), false, 'em pausa');
  await http('PUT', `/clients/${c}/contact-preferences`, { as: A, body: { snoozeDays: null } });
  assert.equal(await has(), true, 'pausa removida');

  const opt = await http('PUT', `/clients/${c}/contact-preferences`, { as: A, body: { contactOptOut: true } });
  assert.equal(opt.json.contactOptOut, true);
  assert.equal(await has(), false);
  const list = (await http('GET', '/clients', { as: A })).json.find((x) => x.id === c);
  assert.equal(list.contactOptOut, true, 'a lista de clientes mostra a preferência');
  await http('PUT', `/clients/${c}/contact-preferences`, { as: A, body: { contactOptOut: false } });
  assert.equal(await has(), true);

  for (const body of [{}, { snoozeDays: 0 }, { snoozeDays: 181 }, { contactOptOut: 'sim' }, { outro: 1 }]) assert.equal((await http('PUT', `/clients/${c}/contact-preferences`, { as: A, body })).status, 400, JSON.stringify(body));
  assert.equal((await http('PUT', `/clients/${randomUUID()}/contact-preferences`, { as: A, body: { contactOptOut: true } })).status, 404);
});

dbTest('serviços: intervalo de retorno opcional, validado, que pode ser limpo', async () => {
  const A = await mkProf('svc');
  const mk = (body) => http('POST', '/services', { as: A, body: { name: `S${Math.random()}`, priceCents: 5000, durationMinutes: 30, ...body } });
  const c1 = await mk({ returnIntervalDays: 20 });
  assert.equal(c1.status, 201);
  assert.equal(c1.json.returnIntervalDays, 20);
  assert.equal((await mk({})).json.returnIntervalDays, null);
  for (const bad of [0, 366, 1.5, 'x']) assert.equal((await mk({ returnIntervalDays: bad })).status, 400, String(bad));
  const up = await http('PUT', `/services/${c1.json.id}`, { as: A, body: { returnIntervalDays: 35 } });
  assert.equal(up.json.returnIntervalDays, 35);
  const keep = await http('PUT', `/services/${c1.json.id}`, { as: A, body: { name: 'Renomeado' } });
  assert.equal(keep.json.returnIntervalDays, 35, 'editar outra coisa não zera o intervalo');
  const clear = await http('PUT', `/services/${c1.json.id}`, { as: A, body: { returnIntervalDays: null } });
  assert.equal(clear.json.returnIntervalDays, null);
  assert.equal((await http('GET', '/services', { as: A })).json.find((s) => s.id === c1.json.id).returnIntervalDays, null);
});

// ── vitrine ──────────────────────────────────────────────────────────────────
dbTest('Instagram: salvo normalizado, exposto só como link montado pelo sistema na página pública; recusa o inválido', async () => {
  const A = await mkProf('ig');
  assert.equal((await http('GET', `/public/${A.slug}/info`)).json.instagramUrl, null);
  const ok = await http('PUT', '/auth/me', { as: A, body: { instagram: '@Studio.Aline' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.instagram, 'studio.aline');
  assert.equal((await http('GET', '/auth/me', { as: A })).json.instagram, 'studio.aline');
  assert.equal((await http('GET', `/public/${A.slug}/info`)).json.instagramUrl, 'https://www.instagram.com/studio.aline/');
  for (const bad of ['javascript:alert(1)', 'https://evil.com/x', 'a b', 'x'.repeat(31)]) assert.equal((await http('PUT', '/auth/me', { as: A, body: { instagram: bad } })).status, 400, bad);
  assert.equal((await one('SELECT instagram FROM professionals WHERE id = $1', [A.id])).instagram, 'studio.aline', 'o inválido não gravou');
  assert.equal((await http('PUT', '/auth/me', { as: A, body: { bio: 'olá' } })).json.instagram, 'studio.aline', 'salvar outro campo não apaga o Instagram');
  assert.equal((await http('PUT', '/auth/me', { as: A, body: { instagram: null } })).json.instagram, null);
  assert.equal((await http('GET', `/public/${A.slug}/info`)).json.instagramUrl, null);
});

dbTest('galeria: envio validado, limite de 6, só a dona remove, a página pública serve a imagem só para o slug certo', async () => {
  const A = await mkProf('galA');
  const B = await mkProf('galB');
  assert.equal((await http('POST', '/portfolio', { body: { dataUrl: PNG_1X1 } })).status, 401);

  const up = await http('POST', '/portfolio', { as: A, body: { dataUrl: PNG_1X1 } });
  assert.equal(up.status, 201);
  const id = up.json.id;
  assert.deepEqual((await http('GET', '/portfolio', { as: A })).json.photos.map((p) => p.id), [id]);
  assert.equal((await http('GET', '/portfolio', { as: B })).json.photos.length, 0, 'a galeria de A não aparece para B');

  // validações
  assert.equal((await http('POST', '/portfolio', { as: A, body: { dataUrl: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=' } })).status, 400);
  assert.equal((await http('POST', '/portfolio', { as: A, body: { dataUrl: `data:image/png;base64,${Buffer.from('texto qualquer').toString('base64')}` } })).status, 400, 'assinatura não confere');
  assert.equal((await http('POST', '/portfolio', { as: A, body: { dataUrl: 'http://exemplo.com/foto.png' } })).status, 400);
  const grande = `data:image/jpeg;base64,${Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(310_000, 1)]).toString('base64')}`;
  assert.equal((await http('POST', '/portfolio', { as: A, body: { dataUrl: grande } })).status, 400, 'acima de 300 KB');
  assert.equal((await http('POST', '/portfolio', { as: A, body: { dataUrl: PNG_1X1, extra: 1 } })).status, 400);

  // limite de 6
  for (let i = 0; i < 5; i += 1) assert.equal((await http('POST', '/portfolio', { as: A, body: { dataUrl: PNG_1X1 } })).status, 201);
  const sete = await http('POST', '/portfolio', { as: A, body: { dataUrl: PNG_1X1 } });
  assert.equal(sete.status, 409);
  assert.equal((await one('SELECT count(*)::int AS n FROM portfolio_photos WHERE professional_id = $1', [A.id])).n, 6);

  // página pública
  const gal = await http('GET', `/public/${A.slug}/gallery`);
  assert.equal(gal.json.photos.length, 6);
  const img = await http('GET', `/public/${A.slug}/photos/${id}`);
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('content-type'), 'image/png');
  assert.match(img.headers.get('cache-control'), /public/);
  assert.equal(img.buf.subarray(0, 4).toString('latin1'), 'PNG');
  assert.equal((await http('GET', `/public/${B.slug}/photos/${id}`)).status, 404, 'foto de A não sai pelo slug de B');
  assert.equal((await http('GET', `/public/${A.slug}/photos/nao-e-uuid`)).status, 404);
  assert.equal((await http('GET', `/public/${B.slug}/gallery`)).json.photos.length, 0);

  // remoção: só a dona
  assert.equal((await http('DELETE', `/portfolio/${id}`, { as: B })).status, 404);
  assert.equal((await http('GET', `/public/${A.slug}/photos/${id}`)).status, 200, 'B não apagou');
  assert.equal((await http('DELETE', `/portfolio/${id}`, { as: A })).status, 204);
  assert.equal((await http('GET', `/public/${A.slug}/photos/${id}`)).status, 404);
  assert.equal((await http('POST', '/portfolio', { as: A, body: { dataUrl: PNG_1X1 } })).status, 201, 'liberou espaço');

  // conta bloqueada some da vitrine
  await owner.query('UPDATE professionals SET blocked_at = now() WHERE id = $1', [A.id]);
  assert.equal((await http('GET', `/public/${A.slug}/gallery`)).json.photos.length, 0);
});

// ── lembretes de agendamento (infraestrutura existente: n8n chama /bot/appointments-tomorrow e /bot/mark-reminder-sent) ──
// Nenhuma mensagem é enviada aqui: o teste só exercita as rotas que o n8n consulta, com a chave do bot de teste.
async function bot(method, path, instance, body) {
  const res = await fetch(`${baseUrl}${path}${path.includes('?') ? '&' : '?'}instance=${encodeURIComponent(instance)}`, {
    method,
    headers: { authorization: `Bearer ${process.env.BOT_API_KEY}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify({ ...body, instance }) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

dbTest('lembretes: só confirmados na janela de 24h, sem repetir, refeitos ao remarcar, respeitando "não enviar mensagens" e o isolamento', async () => {
  process.env.BOT_API_KEY = 'rtv-bot-test-key';
  const A = await mkProf('remA');
  const B = await mkProf('remB');
  const instA = `rtv-inst-a-${A.id.slice(0, 6)}`;
  const instB = `rtv-inst-b-${B.id.slice(0, 6)}`;
  await owner.query('UPDATE professionals SET wa_instance_name = $1 WHERE id = $2', [instA, A.id]);
  await owner.query('UPDATE professionals SET wa_instance_name = $1 WHERE id = $2', [instB, B.id]);
  const svc = await mkService(A, 'Manicure');
  const hoursAhead = (h) => new Date(Date.now() + h * 3_600_000);
  const mk = async (name, startsAt, status = 'confirmado') => {
    const c = await mkClient(A, name);
    const id = (await one(`INSERT INTO appointments (professional_id, client_id, service_id, starts_at, ends_at, status, price_cents_snapshot) VALUES ($1, $2, $3, $4, $5, $6, 10000) RETURNING id`,
      [A.id, c, svc, startsAt, new Date(startsAt.getTime() + 300_000), status])).id;   // 5 min: vários na mesma janela sem colidir
    return { id, clientId: c };
  };
  const due = async (inst = instA) => (await bot('GET', '/bot/appointments-tomorrow', inst)).json.map((r) => r.id);

  const ok = await mk('Na Janela', hoursAhead(24));
  const cedo = await mk('Cedo Demais', hoursAhead(10));
  const tarde = await mk('Longe Demais', hoursAhead(40));
  const pendente = await mk('Pendente', hoursAhead(24.2), 'pendente');
  const cancelado = await mk('Cancelado', hoursAhead(24.1), 'cancelado');
  const optOut = await mk('Sem Mensagens', hoursAhead(23.8));
  await owner.query('UPDATE clients SET contact_opt_out = true WHERE id = $1', [optOut.clientId]);

  assert.deepEqual(await due(), [ok.id], 'só a confirmada, dentro da janela e que aceita mensagens');
  assert.deepEqual(await due(instB), [], 'a outra conta não vê');
  assert.equal((await bot('GET', '/bot/appointments-tomorrow', 'instancia-inexistente')).status, 404);
  const semChave = await fetch(`${baseUrl}/bot/appointments-tomorrow?instance=${instA}`);
  assert.equal(semChave.status, 401);

  // enviado: não aparece de novo (prevenção de duplicidade); a outra conta não consegue marcar
  assert.equal((await bot('POST', '/bot/mark-reminder-sent', instB, { appointmentId: ok.id })).status, 200);
  assert.deepEqual(await due(), [ok.id], 'B não marca o agendamento de A');
  assert.equal((await bot('POST', '/bot/mark-reminder-sent', instA, { appointmentId: ok.id })).status, 200);
  assert.deepEqual(await due(), []);
  assert.equal((await one('SELECT reminder_sent FROM appointments WHERE id = $1', [ok.id])).reminder_sent, true);

  // editar só a observação NÃO reabre o lembrete
  assert.equal((await http('PUT', `/appointments/${ok.id}`, { as: A, body: { notes: 'só uma anotação' } })).status, 200);
  assert.equal((await one('SELECT reminder_sent FROM appointments WHERE id = $1', [ok.id])).reminder_sent, true);

  // remarcar para outro horário: o lembrete passa a valer para o horário novo
  const novo = hoursAhead(24.4);
  const novoIso = new Date(Math.round(novo.getTime() / 60000) * 60000).toISOString();
  const re = await http('PUT', `/appointments/${ok.id}`, { as: A, body: { startsAt: novoIso } });
  assert.equal(re.status, 200, JSON.stringify(re.json));
  assert.equal((await one('SELECT reminder_sent FROM appointments WHERE id = $1', [ok.id])).reminder_sent, false, 'remarcado: lembrete refeito');
  assert.deepEqual(await due(), [ok.id]);

  // cancelar tira da lista
  assert.equal((await http('DELETE', `/appointments/${ok.id}`, { as: A })).status, 204);
  assert.deepEqual(await due(), []);
});

// ── envio seguro de lembretes: reserva atômica, resultado, falhas, vencimento (migration 032). Nada é enviado: só as rotas. ──
dbTest('lembretes: reserva atômica sob concorrência, resultado idempotente, falhas com limite, reserva vencida exige revisão', async () => {
  process.env.BOT_API_KEY = 'rtv-bot-test-key';
  const A = await mkProf('clmA');
  const B = await mkProf('clmB');
  const instA = `rtv-clm-a-${A.id.slice(0, 6)}`;
  const instB = `rtv-clm-b-${B.id.slice(0, 6)}`;
  await owner.query('UPDATE professionals SET wa_instance_name = $1 WHERE id = $2', [instA, A.id]);
  await owner.query('UPDATE professionals SET wa_instance_name = $1 WHERE id = $2', [instB, B.id]);
  const svc = await mkService(A, 'Manicure');
  let n = 0;
  const mk = async (status = 'confirmado', optOut = false) => {
    const c = await mkClient(A, `Clm ${++n}`);
    if (optOut) await owner.query('UPDATE clients SET contact_opt_out = true WHERE id = $1', [c]);
    const start = new Date(Date.now() + 24 * 3_600_000 + n * 600_000);
    return (await one(`INSERT INTO appointments (professional_id, client_id, service_id, starts_at, ends_at, status, price_cents_snapshot) VALUES ($1, $2, $3, $4, $5, $6, 10000) RETURNING id`,
      [A.id, c, svc, start, new Date(start.getTime() + 300_000), status])).id;
  };
  const claim = (id, inst = instA) => bot('POST', '/bot/reminders/claim', inst, { appointmentId: id });
  const result = (att, body, inst = instA) => bot('POST', `/bot/reminders/${att}/result`, inst, body);
  const sentFlag = async (id) => (await one('SELECT reminder_sent FROM appointments WHERE id = $1', [id])).reminder_sent;

  // 12 reservas simultâneas do mesmo lembrete: exatamente uma vence
  const a1 = await mk();
  const race = await Promise.all(Array.from({ length: 12 }, () => claim(a1)));
  assert.equal(race.filter((r) => r.status === 201).length, 1, 'só uma reserva pode vencer');
  assert.ok(race.filter((r) => r.status === 409).every((r) => r.json.claimed === false && r.json.reason === 'in_progress'));
  assert.equal(Number((await one('SELECT count(*) FROM reminder_attempts WHERE appointment_id = $1', [a1])).count), 1);
  const att1 = race.find((r) => r.status === 201).json.attemptId;

  // outra conta não reserva nem encerra o que não é dela
  assert.equal((await claim(a1, instB)).status, 404);
  assert.equal((await result(att1, { status: 'sent' }, instB)).status, 404);
  // entradas inválidas
  assert.equal((await bot('POST', '/bot/reminders/claim', instA, { appointmentId: 'x' })).status, 400);
  assert.equal((await result(att1, { status: 'talvez' })).status, 400);

  // resultado "sent": marca o agendamento; repetir é inofensivo; contradizer é recusado; nova reserva é recusada
  assert.equal(await sentFlag(a1), false);
  assert.deepEqual((await result(att1, { status: 'sent' })).json, { ok: true, changed: true });
  assert.equal(await sentFlag(a1), true);
  assert.deepEqual((await result(att1, { status: 'sent' })).json, { ok: true, changed: false });
  assert.equal((await result(att1, { status: 'failed', errorCode: 'x' })).status, 409);
  const again = await claim(a1);
  assert.deepEqual([again.status, again.json.reason], [409, 'already_sent']);

  // falha informada permite nova tentativa, com código curto (sem texto livre); no 3º fracasso para
  const a2 = await mk();
  for (let i = 1; i <= 3; i++) {
    const c = await claim(a2);
    assert.equal(c.status, 201, JSON.stringify(c.json));
    assert.equal(c.json.attemptNo, i);
    assert.equal((await result(c.json.attemptId, { status: 'failed', errorCode: 'whatsapp_offline' })).status, 200);
  }
  const maxed = await claim(a2);
  assert.deepEqual([maxed.status, maxed.json.reason], [409, 'max_attempts']);
  assert.equal(await sentFlag(a2), false, 'falha não marca como enviado');
  const bad = await claim(await mk());
  assert.equal((await result(bad.json.attemptId, { status: 'failed', errorCode: 'Número do João 3199' })).status, 400, 'texto livre/dado pessoal não é aceito');

  // reserva vencida sem resultado: não reenvia sozinho (pode já ter sido enviada); relatório tardio ainda é aceito
  const a3 = await mk();
  const c3 = await claim(a3);
  await owner.query("UPDATE reminder_attempts SET lease_expires_at = now() - interval '1 minute' WHERE id = $1", [c3.json.attemptId]);
  const rev = await claim(a3);
  assert.deepEqual([rev.status, rev.json.reason], [409, 'needs_review']);
  assert.equal((await one('SELECT status FROM reminder_attempts WHERE id = $1', [c3.json.attemptId])).status, 'expired');
  assert.equal((await result(c3.json.attemptId, { status: 'sent' })).status, 200);
  assert.equal(await sentFlag(a3), true);

  // agendamento remarcado durante o envio: o horário novo não é dado como enviado e ganha lembrete próprio
  const a4 = await mk();
  const c4 = await claim(a4);
  const novo = new Date(Date.now() + 30 * 3_600_000);
  await owner.query('UPDATE appointments SET starts_at = $2, ends_at = $3 WHERE id = $1', [a4, novo, new Date(novo.getTime() + 300_000)]);
  assert.equal((await result(c4.json.attemptId, { status: 'sent' })).status, 200);
  assert.equal(await sentFlag(a4), false, 'o horário novo ainda precisa do seu lembrete');
  assert.equal((await claim(a4)).status, 201, 'lembrete do horário novo pode ser reservado');

  // regras de elegibilidade: não confirmado, cliente sem mensagens, já marcado pelo fluxo antigo
  assert.equal((await claim(await mk('pendente'))).json.reason, 'not_confirmed');
  assert.equal((await claim(await mk('confirmado', true))).json.reason, 'contact_opt_out');
  const a5 = await mk();
  assert.equal((await bot('POST', '/bot/mark-reminder-sent', instA, { appointmentId: a5 })).status, 200);
  assert.equal((await claim(a5)).json.reason, 'already_sent');
  // sem chave do bot: 401
  const semChave = await fetch(`${baseUrl}/bot/reminders/claim?instance=${instA}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ appointmentId: a5 }) });
  assert.equal(semChave.status, 401);
});

// ── PROPOSTA de workflow n8n (claim/result): estrutura do JSON e execução em ambiente isolado ──
// Executor mínimo (helpers/n8nWorkflowRunner.js), Evolution simulada em 127.0.0.1 e a API local. Só endereços mapeados são aceitos: nada sai da máquina.
const PROPOSTA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../n8n/workflows/proposta_lembretes_com_claim.json');

// Asserção ESTÁTICA: só confere o texto da proposta. O executor simulado não implementa o "reset" do splitInBatches, então este teste
// NÃO prova o comportamento real do n8n (isso foi verificado à parte, na 2.35.7, cenário S8c); ele apenas impede que a propriedade seja perdida.
test('proposta n8n: "Para cada agendamento" mantém options.reset reiniciando o laço só quando entra um conjunto novo (estático)', () => {
  const w = loadWorkflow(PROPOSTA);
  const node = w.nodes.find((n) => n.name === 'Para cada agendamento');
  assert.ok(node, 'nó "Para cada agendamento" precisa existir');
  assert.equal(node.parameters?.options?.reset, "={{ $prevNode.name === 'Tem lembretes?' }}");
});

test('proposta n8n: o envio só é alcançável depois de reservar; envio sem retry; resultado com retry; sem o marcador antigo', () => {
  const w = loadWorkflow(PROPOSTA);
  const byName = Object.fromEntries(w.nodes.map((n) => [n.name, n]));
  assert.match(w.name, /PROPOSTA/);
  const next = (name, idx) => (w.connections[name]?.main?.[idx] ?? []).map((c) => c.node);
  // sem a aresta "Reservou? = sim", o nó de envio fica inalcançável a partir do gatilho
  const reach = (skip) => {
    const seen = new Set(); const st = ['A cada 30 minutos'];
    while (st.length) {
      const n = st.pop(); if (seen.has(n)) continue; seen.add(n);
      (w.connections[n]?.main ?? []).forEach((outs, idx) => outs.forEach((c) => { if (!(skip && n === 'Reservou?' && idx === 0)) st.push(c.node); }));
    }
    return seen;
  };
  assert.ok(reach(false).has('Enviar via Evolution'));
  assert.ok(!reach(true).has('Enviar via Evolution'), 'enviar sem reserva positiva deve ser impossível');
  assert.deepEqual(next('Para cada agendamento', 1), ['Reservar envio']);
  assert.deepEqual(next('Reservar envio', 0), ['Reservou?']);
  assert.ok(!byName['Enviar via Evolution'].retryOnFail, 'reenviar duplicaria a mensagem');
  assert.equal(byName['Enviar via Evolution'].onError, 'continueErrorOutput');
  for (const n of ['Informar enviado', 'Informar falha']) assert.equal(byName[n].retryOnFail, true, n); // idempotente: repetir é seguro
  assert.ok(!byName['Reservar envio'].retryOnFail, 'reserva perdida = ninguém envia, nunca duplica');
  assert.ok(!JSON.stringify(w).includes('mark-reminder-sent'));
  for (const n of w.nodes.filter((x) => x.type.endsWith('.code'))) assert.equal(n.parameters.mode, 'runOnceForEachItem', n.name);
  for (const n of ['Reservar envio', 'Enviar via Evolution', 'Informar enviado', 'Informar falha']) assert.ok(byName[n].parameters.options.timeout > 0, `${n}: timeout explícito`);
  assert.deepEqual(next('Falha definitiva?', 1), ['Para cada agendamento'], 'falha ambígua não é informada como falha');
  assert.equal(byName['Buscar agendamentos'].onError, 'continueRegularOutput', 'falha em UMA instância (ex.: 403 de profissional bloqueada) não pode derrubar o ciclo das demais');
});

let evo;
const EVO_KEY = 'evolution-chave-de-teste';
async function startEvolution() {
  const calls = [];
  const state = { mode: 'ok', calls };
  const server = nodeHttp.createServer((req, res) => {
    let b = '';
    req.on('data', (d) => { b += d; });
    req.on('end', () => {
      let body = null; try { body = JSON.parse(b); } catch { /* corpo inválido */ }
      calls.push({ instance: decodeURIComponent(req.url.split('/').pop()), body, apikey: req.headers.apikey, validJson: body !== null });
      if (state.mode === 'hang') return;   // nunca responde: o timeout do nó decide
      if (state.mode === '500') { res.writeHead(500); return res.end('{"error":"falha simulada"}'); }
      res.writeHead(201, { 'content-type': 'application/json' }); res.end('{"key":{"id":"mock"}}');
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { state, calls, url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }) };
}
const runner = (opts = {}) => createRunner({
  workflow: opts.workflow ?? loadWorkflow(PROPOSTA),
  urlMap: [['http://127.0.0.1:3333', baseUrl], ['https://nailflow-evolution.duckdns.org', evo.url]],
  credentials: { 'Header Auth account 2': { header: 'authorization', value: `Bearer ${process.env.BOT_API_KEY}` }, 'Header Auth account': { header: 'apikey', value: EVO_KEY } },
  abortBefore: opts.abortBefore ?? null,
});

async function wfScenario(tag) {
  process.env.BOT_API_KEY = 'rtv-bot-test-key';
  const P = await mkProf(tag);
  const inst = `rtv-wf-${tag}-${P.id.slice(0, 6)}`;
  // só esta profissional entra no ciclo (outras do arquivo de teste ficam sem instância)
  await owner.query("UPDATE professionals SET wa_instance_name = NULL WHERE wa_instance_name LIKE 'rtv-%'");
  await owner.query('UPDATE professionals SET wa_instance_name = $1 WHERE id = $2', [inst, P.id]);
  const svc = await mkService(P, 'Manicure');
  let n = 0;
  const mk = async (name) => {
    const c = await mkClient(P, name);
    const start = new Date(Date.now() + 24 * 3_600_000 + n++ * 600_000);
    const id = (await one(`INSERT INTO appointments (professional_id, client_id, service_id, starts_at, ends_at, status, price_cents_snapshot) VALUES ($1, $2, $3, $4, $5, 'confirmado', 10000) RETURNING id`,
      [P.id, c, svc, start, new Date(start.getTime() + 300_000)])).id;
    return { id, clientId: c, start };
  };
  const sends = () => evo.calls.filter((c) => c.instance === inst);
  const flag = async (id) => (await one('SELECT reminder_sent FROM appointments WHERE id = $1', [id])).reminder_sent;
  const attempts = async (id) => (await owner.query('SELECT attempt_no, status, error_code FROM reminder_attempts WHERE appointment_id = $1 ORDER BY attempt_no', [id])).rows;
  return { P, inst, mk, sends, flag, attempts };
}

dbTest('workflow n8n (simulado): duas execuções sobrepostas enviam cada lembrete uma única vez; aspas no nome não quebram o envio', async () => {
  evo = await startEvolution();
  try {
    const { inst, mk, sends, flag, attempts } = await wfScenario('ovl');
    const a = await mk('"Ana" Souza');
    const b = await mk('Bia Lima');
    const c = await mk('Carla Dias');
    await Promise.all([runner().run(), runner().run()]);   // o cron de 30 min enxerga o mesmo agendamento em duas execuções seguidas
    assert.equal(sends().length, 3, 'um envio por agendamento, mesmo com duas execuções ao mesmo tempo');
    assert.deepEqual(sends().map((x) => x.body.text.match(/Oi, (.+?)!/)[1]).sort(), ['"Ana"', 'Bia', 'Carla']);
    assert.ok(sends().every((x) => x.validJson && x.apikey === EVO_KEY && /^\d+$/.test(x.body.number) && /às \d{2}:\d{2}\./.test(x.body.text)));
    for (const x of [a, b, c]) { assert.equal(await flag(x.id), true); assert.deepEqual((await attempts(x.id)).map((r) => r.status), ['sent']); }
    await runner().run();                                    // terceira execução: nada novo
    assert.equal(sends().length, 3);
  } finally { await evo.close(); }
});

dbTest('workflow n8n (simulado): falha da Evolution é registrada, tenta de novo na execução seguinte e para na 3ª falha', async () => {
  evo = await startEvolution();
  try {
    const { mk, sends, flag, attempts } = await wfScenario('fal');
    const a = await mk('Dani Rocha');
    evo.state.mode = '500';
    await runner().run();
    assert.equal(await flag(a.id), false, 'falha não marca como enviado');
    assert.deepEqual(await attempts(a.id), [{ attempt_no: 1, status: 'failed', error_code: 'evolution_http_500' }]);
    evo.state.mode = 'ok';
    await runner().run();                                    // nova tentativa depois da falha informada
    assert.equal(await flag(a.id), true);
    assert.deepEqual((await attempts(a.id)).map((r) => r.status), ['failed', 'sent']);
    assert.equal(sends().length, 2, 'uma tentativa que falhou + uma que enviou');
    // 3 falhas seguidas: para de tentar
    const b = await mk('Eva Costa');
    evo.state.mode = '500';
    for (let i = 0; i < 4; i++) await runner().run();
    assert.equal((await attempts(b.id)).length, 3, 'no máximo 3 tentativas');
    assert.equal(sends().filter((x) => x.body.text.includes('Eva')).length, 3);
    assert.equal(await flag(b.id), false);
  } finally { await evo.close(); }
});

dbTest('workflow n8n (simulado): queda do n8n depois do envio e antes do resultado não reenvia (vai para revisão)', async () => {
  evo = await startEvolution();
  try {
    const { mk, sends, flag, attempts } = await wfScenario('crs');
    const a = await mk('Fabi Nunes');
    await assert.rejects(runner({ abortBefore: 'Informar enviado' }).run(), WorkflowCrash);
    assert.equal(sends().length, 1, 'a mensagem foi enviada');
    assert.equal(await flag(a.id), false, 'o resultado não chegou ao backend');
    await runner().run();                                    // reserva ainda vigente: ninguém reenvia
    assert.equal(sends().length, 1);
    await owner.query("UPDATE reminder_attempts SET lease_expires_at = now() - interval '1 minute' WHERE appointment_id = $1", [a.id]);
    await runner().run();                                    // reserva vencida: resultado desconhecido, continua sem reenviar
    await runner().run();
    assert.equal(sends().length, 1, 'nunca duplica');
    assert.deepEqual((await attempts(a.id)).map((r) => r.status), ['expired']);
  } finally { await evo.close(); }
});

dbTest('workflow n8n (simulado): remarcação gera um lembrete novo (uma vez); cancelada e cliente sem mensagens não recebem', async () => {
  evo = await startEvolution();
  try {
    const { P, mk, sends, flag } = await wfScenario('rem');
    const a = await mk('Gabi Teles');
    const cancel = await mk('Hana Reis');
    const opt = await mk('Iris Melo');
    await owner.query('UPDATE clients SET contact_opt_out = true WHERE id = $1', [opt.clientId]);
    assert.equal((await http('DELETE', `/appointments/${cancel.id}`, { as: P })).status, 204);
    await runner().run();
    assert.deepEqual(sends().map((x) => x.body.text.match(/Oi, (.+?)!/)[1]), ['Gabi'], 'só a confirmada que aceita mensagens');
    // remarcada para outro horário dentro da janela: novo lembrete, uma vez
    const novo = new Date(Math.round((Date.now() + 24.45 * 3_600_000) / 60000) * 60000).toISOString();
    const re = await http('PUT', `/appointments/${a.id}`, { as: P, body: { startsAt: novo } });
    assert.equal(re.status, 200, JSON.stringify(re.json));
    assert.equal(await flag(a.id), false);
    await runner().run();
    await runner().run();
    assert.equal(sends().length, 2, 'um lembrete para o horário original e um para o novo');
    assert.equal(await flag(a.id), true);
  } finally { await evo.close(); }
});

dbTest('workflow n8n (simulado): o executor recusa qualquer endereço que não seja o de teste', async () => {
  evo = await startEvolution();
  try {
    const w = loadWorkflow(PROPOSTA);
    w.nodes.find((n) => n.name === 'Buscar instancias').parameters.url = 'https://nailflow.exemplo.invalid/bot/instances';
    await assert.rejects(runner({ workflow: w }).run(), /endereço não permitido/);
    assert.equal(evo.calls.length, 0);
  } finally { await evo.close(); }
});

dbTest('workflow n8n (simulado): envio sem resposta (timeout) é AMBÍGUO: não vira falha, não reenvia e vai para revisão', async () => {
  evo = await startEvolution();
  try {
    const { mk, sends, flag, attempts } = await wfScenario('tmo');
    const a = await mk('Jade Pires');
    const w = loadWorkflow(PROPOSTA);
    w.nodes.find((n) => n.name === 'Enviar via Evolution').parameters.options.timeout = 300;   // acelera o teste
    evo.state.mode = 'hang';
    await runner({ workflow: w }).run();
    assert.equal(sends().length, 1, 'o pedido chegou à Evolution (pode até ter sido entregue)');
    assert.deepEqual((await attempts(a.id)).map((r) => r.status), ['claimed'], 'nenhuma falha é informada');
    evo.state.mode = 'ok';
    await runner().run();                                    // reserva ainda vigente
    await owner.query("UPDATE reminder_attempts SET lease_expires_at = now() - interval '1 minute' WHERE appointment_id = $1", [a.id]);
    await runner().run();
    await runner().run();
    assert.equal(sends().length, 1, 'nunca reenvia depois de um envio ambíguo');
    assert.deepEqual((await attempts(a.id)).map((r) => r.status), ['expired']);
    assert.equal(await flag(a.id), false);
  } finally { await evo.close(); }
});

dbTest('workflow n8n (simulado): conexão recusada é falha DEFINITIVA (nada saiu): registra e tenta de novo depois', async () => {
  evo = await startEvolution();
  const { mk, flag, attempts } = await wfScenario('rec');
  const a = await mk('Kelly Alves');
  await evo.close();                                         // porta fechada: ECONNREFUSED
  await runner().run();
  assert.deepEqual(await attempts(a.id), [{ attempt_no: 1, status: 'failed', error_code: 'evolution_sem_conexao' }]);
  evo = await startEvolution();                              // outra porta: o runner usa evo.url atual
  try {
    await runner().run();
    assert.equal(await flag(a.id), true);
    assert.deepEqual((await attempts(a.id)).map((r) => r.status), ['failed', 'sent']);
  } finally { await evo.close(); }
});

// ── profissional BLOQUEADA na 2ª posição da fila dos crons ──
// Produção: /bot/instances listava a bloqueada, o requireBotAuth respondia 403 a ela e o n8n encerrava o ciclo inteiro (as seguintes ficavam sem lembrete).
// Aqui: (1) o endpoint já não lista bloqueadas; (2) mesmo que a lista antiga volte (proxy local), a proposta pula a bloqueada e processa a seguinte;
// (3) controle: sem o onError o ciclo morre no 403. O executor simulado NÃO reproduz o laço aninhado do n8n real (ver n8n-isolado/cenarios.mjs, S8c).
dbTest('bloqueada na 2ª posição: /bot/instances não a lista; com a lista antiga a proposta pula o 403 e processa a seguinte (e sem o onError o ciclo morre)', async () => {
  process.env.BOT_API_KEY = 'rtv-bot-test-key';
  evo = await startEvolution();
  let proxy;
  try {
    await owner.query("UPDATE professionals SET wa_instance_name = NULL WHERE wa_instance_name LIKE 'rtv-%'");
    const A = await mkProf('blqA'); const B = await mkProf('blqB'); const C = await mkProf('blqC');   // ordem de criação = ordem da fila
    const inst = (P, t) => `rtv-blq-${t}-${P.id.slice(0, 6)}`;
    const iA = inst(A, 'a'), iB = inst(B, 'b'), iC = inst(C, 'c');
    for (const [P, i] of [[A, iA], [B, iB], [C, iC]]) await owner.query('UPDATE professionals SET wa_instance_name = $1 WHERE id = $2', [i, P.id]);
    await owner.query('UPDATE professionals SET blocked_at = now() WHERE id = $1', [B.id]);
    // C tem um lembrete na janela de 24h; A e B não têm (a 1ª sem lembretes mantém o laço interno intocado)
    const svc = await mkService(C, 'Manicure');
    const cli = await mkClient(C, 'Dora Alves');
    const start = new Date(Date.now() + 24 * 3_600_000);
    const apptC = (await one(`INSERT INTO appointments (professional_id, client_id, service_id, starts_at, ends_at, status, price_cents_snapshot) VALUES ($1,$2,$3,$4,$5,'confirmado',10000) RETURNING id`,
      [C.id, cli, svc, start, new Date(start.getTime() + 300_000)])).id;

    // (1) backend corrigido
    const lista = (await bot('GET', '/bot/instances', iA)).json.map((x) => x.wa_instance_name).filter((n) => n.startsWith('rtv-blq-'));
    assert.deepEqual(lista, [iA, iC], 'a bloqueada fica fora da lista, a ordem se mantém');
    // a própria bloqueada continua recebendo 403 se alguém chamar com a instância dela (regra do requireBotAuth intacta)
    assert.equal((await bot('GET', '/bot/appointments-tomorrow', iB)).status, 403);

    // (2) lista antiga simulada por um proxy local: devolve as 3 instâncias (inclui a bloqueada); o resto é repassado ao backend real
    proxy = nodeHttp.createServer((req, res) => {
      if (req.method === 'GET' && req.url.startsWith('/bot/instances')) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify([iA, iB, iC].map((i) => ({ wa_instance_name: i })))); }
      const chunks = []; req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const up = nodeHttp.request(baseUrl + req.url, { method: req.method, headers: req.headers }, (ur) => { res.writeHead(ur.statusCode, ur.headers); ur.pipe(res); });
        up.on('error', () => { res.writeHead(502); res.end(); }); up.end(Buffer.concat(chunks));
      });
    });
    await new Promise((r) => proxy.listen(0, '127.0.0.1', r));
    const mk = (w) => createRunner({
      workflow: w, urlMap: [['http://127.0.0.1:3333', `http://127.0.0.1:${proxy.address().port}`], ['https://nailflow-evolution.duckdns.org', evo.url]],
      credentials: { 'Header Auth account 2': { header: 'authorization', value: `Bearer ${process.env.BOT_API_KEY}` }, 'Header Auth account': { header: 'apikey', value: EVO_KEY } },
    });
    const enviosC = () => evo.calls.filter((c) => c.instance === iC).length;
    // controle: sem o onError o 403 da bloqueada encerra o ciclo e a seguinte não é processada
    const semFix = loadWorkflow(PROPOSTA);
    delete semFix.nodes.find((n) => n.name === 'Buscar agendamentos').onError;
    await assert.rejects(mk(semFix).run(), /Buscar agendamentos/);
    assert.equal(enviosC(), 0, 'defeito reproduzido: a seguinte não foi processada');
    assert.equal(await (async () => (await one('SELECT reminder_sent FROM appointments WHERE id = $1', [apptC])).reminder_sent)(), false);
    // proposta corrigida: o 403 é tratado e a seguinte é processada
    await mk(loadWorkflow(PROPOSTA)).run();
    assert.equal(enviosC(), 1, 'a seguinte à bloqueada foi processada');
    assert.equal((await one('SELECT reminder_sent FROM appointments WHERE id = $1', [apptC])).reminder_sent, true);
    assert.equal(evo.calls.filter((c) => c.instance === iB).length, 0, 'a bloqueada nunca recebe envio');
  } finally {
    if (proxy) await new Promise((r) => { proxy.closeAllConnections?.(); proxy.close(r); });
    await evo.close();
    await owner.query("UPDATE professionals SET wa_instance_name = NULL, blocked_at = NULL WHERE email LIKE 'rtv-blq%'");
  }
});
