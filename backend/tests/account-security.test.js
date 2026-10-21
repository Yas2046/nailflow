// Segurança da conta: redefinição de senha por link de uso único (migration 030), exportação dos próprios dados, login sem diferenciar
// maiúsculas, cabeçalhos da API e isolamento entre profissionais (uma conta nunca lê, altera ou apaga dados de outra).
// API HTTP real, role NÃO-DONA, banco DESCARTÁVEL (ACCOUNT_SEC_TEST_DB_URL, um banco só para este arquivo; ver helpers/financeTestDb.js).
// Sem a variável o arquivo é ignorado.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import pg from 'pg';
import { resolveFinanceTestDb, financeDb, psqlScript, readSql } from './helpers/financeTestDb.js';

const VAR = 'ACCOUNT_SEC_TEST_DB_URL';
const EMAIL_LIKE = 'acs-%@nf.test';
const ROLE = 'nf_acs_app';
const T = { timeout: 120_000 };

let skip = false;
let owner;
let db;
let server;
let baseUrl;
let appPool;
let secret;

const one = async (sql, params) => (await owner.query(sql, params)).rows[0];

async function mkProf(tag, { admin = false, password = 'senha-antiga-1' } = {}) {
  const id = randomUUID();
  const email = `acs-${tag}-${id.slice(0, 8)}@nf.test`;
  await owner.query(
    `INSERT INTO professionals (id, name, email, password_hash, slug, business_name, is_admin) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id, `Acs ${tag}`, email, await bcrypt.hash(password, 4), `acs-${tag}-${id.slice(0, 8)}`, `Studio ${tag}`, admin]
  );
  const svc = (await one(`INSERT INTO services (professional_id, name, price_cents, duration_minutes) VALUES ($1, 'Manicure', 10000, 60) RETURNING id`, [id])).id;
  const cli = (await one(`INSERT INTO clients (professional_id, name, phone) VALUES ($1, 'Cliente', $2) RETURNING id`, [id, `5531${String(300000000 + Math.floor(Math.random() * 1e8))}`])).id;
  const start = new Date(Date.UTC(2026, 5, 1 + Math.floor(Math.random() * 20), 12, 0, 0));
  const appt = (await one(`INSERT INTO appointments (professional_id, client_id, service_id, starts_at, ends_at, status, price_cents_snapshot)
      VALUES ($1, $2, $3, $4, $5, 'confirmado', 10000) RETURNING id`, [id, cli, svc, start, new Date(start.getTime() + 3600_000)])).id;
  const exp = (await one(`INSERT INTO expenses (professional_id, description, category, amount_cents, expense_date) VALUES ($1, 'Esmalte', 'Materiais', 5000, '2026-06-01') RETURNING id`, [id])).id;
  return { id, email, password, svc, cli, appt, exp, token: jwt.sign({ sub: id, ver: 1 }, secret, { expiresIn: '1h' }) };
}

async function http(method, path, { as, body, headers = {} } = {}) {
  const h = { ...headers };
  if (as) h.cookie = `nailflow_token=${as.token}`;
  let payload;
  if (body !== undefined) { h['content-type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(`${baseUrl}${path}`, { method, headers: h, body: payload });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* 204 ou arquivo */ }
  return { status: res.status, json, text, headers: res.headers };
}
const login = (email, password) => http('POST', '/auth/login', { body: { email, password } });

before(async () => {
  const r = await resolveFinanceTestDb(process.env, VAR);
  if (r.skip) { skip = r.skip; return; }
  owner = new pg.Pool({ connectionString: r.url, options: '-c TimeZone=UTC', max: 5 });
  owner.on('error', () => {});
  db = financeDb(owner);
  await owner.query('DROP TABLE IF EXISTS password_reset_tokens');
  await db.reset({ emailLike: EMAIL_LIKE, roles: [ROLE] });
  await db.createAppRole(ROLE);
  await db.runFile('030_password_reset_tokens.sql');
  await db.runSql(psqlScript(await readSql('_ops/030_grant_app_role.sql'), { app_role: ROLE }));
  secret = 'acs-test-secret';
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
    await owner.query('DROP TABLE IF EXISTS password_reset_tokens');
    await db.reset({ emailLike: EMAIL_LIKE, roles: [ROLE] });
  } finally {
    await owner.end();
  }
});

const dbTest = (name, fn) => test(name, T, async (t) => { if (skip) return t.skip(skip); await fn(t); });
const tokenOf = (resetPath) => new URL(resetPath, 'http://x').searchParams.get('token');

// ── redefinição de senha ─────────────────────────────────────────────────────
dbTest('redefinição: só a administração emite; o banco guarda só o hash; o link vale uma vez e derruba as sessões', async () => {
  const admin = await mkProf('adm', { admin: true });
  const A = await mkProf('a');
  const other = await mkProf('o');

  assert.equal((await http('POST', `/admin/professionals/${A.id}/password-reset`, { as: other })).status, 403, 'profissional comum não emite');
  assert.equal((await http('POST', `/admin/professionals/${A.id}/password-reset`)).status, 401, 'sem login não emite');
  assert.equal((await http('POST', `/admin/professionals/${admin.id}/password-reset`, { as: admin })).status, 400, 'admin não usa o fluxo');

  const issued = await http('POST', `/admin/professionals/${A.id}/password-reset`, { as: admin });
  assert.equal(issued.status, 201);
  assert.equal(issued.headers.get('cache-control'), 'no-store');
  const token = tokenOf(issued.json.resetPath);
  assert.ok(token.length >= 40);
  const stored = await one(`SELECT token_hash, issued_by, used_at FROM password_reset_tokens WHERE professional_id = $1`, [A.id]);
  assert.equal(stored.token_hash, createHash('sha256').update(token).digest('hex'));
  assert.notEqual(stored.token_hash, token);
  assert.equal(stored.issued_by, admin.id);

  // sessão antiga (token_version 1) funciona antes e deixa de funcionar depois
  assert.equal((await http('GET', '/auth/me', { as: A })).status, 200);

  const bad = await http('POST', '/auth/reset-password', { body: { token, newPassword: 'curta', confirmPassword: 'curta' } });
  assert.equal(bad.status, 400);
  assert.equal((await http('POST', '/auth/reset-password', { body: { token, newPassword: 'senha-nova-123', confirmPassword: 'diferente-123' } })).status, 400);

  const ok = await http('POST', '/auth/reset-password', { body: { token, newPassword: 'senha-nova-123', confirmPassword: 'senha-nova-123' } });
  assert.equal(ok.status, 204);
  assert.equal((await login(A.email, 'senha-antiga-1')).status, 401);
  assert.equal((await login(A.email, 'senha-nova-123')).status, 200);
  assert.equal((await http('GET', '/auth/me', { as: A })).status, 401, 'sessão anterior encerrada');

  const again = await http('POST', '/auth/reset-password', { body: { token, newPassword: 'outra-senha-123', confirmPassword: 'outra-senha-123' } });
  assert.equal(again.status, 400, 'link já usado');
  const garbage = await http('POST', '/auth/reset-password', { body: { token: 'x'.repeat(43), newPassword: 'outra-senha-123', confirmPassword: 'outra-senha-123' } });
  assert.deepEqual(again.json, garbage.json, 'mesma resposta para usado e inexistente: não revela nada');
});

dbTest('redefinição: link expirado é recusado; um novo link invalida o anterior', async () => {
  const admin = await mkProf('adm2', { admin: true });
  const A = await mkProf('exp');
  const t1 = tokenOf((await http('POST', `/admin/professionals/${A.id}/password-reset`, { as: admin })).json.resetPath);
  const t2 = tokenOf((await http('POST', `/admin/professionals/${A.id}/password-reset`, { as: admin })).json.resetPath);
  assert.equal((await http('POST', '/auth/reset-password', { body: { token: t1, newPassword: 'senha-nova-123', confirmPassword: 'senha-nova-123' } })).status, 400, 'o primeiro foi invalidado');
  await owner.query(`UPDATE password_reset_tokens SET expires_at = now() - interval '1 minute' WHERE token_hash = $1`, [createHash('sha256').update(t2).digest('hex')]);
  assert.equal((await http('POST', '/auth/reset-password', { body: { token: t2, newPassword: 'senha-nova-123', confirmPassword: 'senha-nova-123' } })).status, 400, 'expirado');
  assert.equal((await login(A.email, 'senha-antiga-1')).status, 200, 'a senha antiga continua valendo');
});

dbTest('login não diferencia maiúsculas nem espaços nas pontas do e-mail', async () => {
  const A = await mkProf('case');
  assert.equal((await login(A.email.toUpperCase(), 'senha-antiga-1')).status, 200);
  assert.equal((await login(`  ${A.email}  `, 'senha-antiga-1')).status, 200);
  assert.equal((await login(A.email, 'senha-errada-1')).status, 401);
});

// ── exportação ───────────────────────────────────────────────────────────────
dbTest('exportação: só os dados da própria conta, sem senha nem segredos, como download; exige login', async () => {
  const A = await mkProf('exA');
  const B = await mkProf('exB');
  assert.equal((await http('GET', '/auth/export')).status, 401);
  const r = await http('GET', '/auth/export', { as: A });
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-disposition'), /^attachment; filename="nailflow-meus-dados-\d{4}-\d{2}-\d{2}\.json"$/);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.doesNotMatch(r.text, /password_hash|token_version|\$2[aby]\$/);
  const j = JSON.parse(r.text);
  assert.equal(j.professional.id, A.id);
  assert.deepEqual(j.clients.map((c) => c.id), [A.cli]);
  assert.deepEqual(j.services.map((c) => c.id), [A.svc]);
  assert.deepEqual(j.appointments.map((c) => c.id), [A.appt]);
  assert.deepEqual(j.expenses.map((c) => c.id), [A.exp]);
  assert.ok(!r.text.includes(B.id) && !r.text.includes(B.email), 'nada da outra conta');
});

// ── isolamento entre profissionais ───────────────────────────────────────────
dbTest('isolamento: B não lê, altera nem apaga clientes, serviços, agendamentos e gastos de A', async () => {
  const A = await mkProf('isoA');
  const B = await mkProf('isoB');
  const before = {
    cli: await one(`SELECT name, phone FROM clients WHERE id = $1`, [A.cli]),
    svc: await one(`SELECT name, price_cents FROM services WHERE id = $1`, [A.svc]),
    appt: await one(`SELECT status, notes FROM appointments WHERE id = $1`, [A.appt]),
    exp: await one(`SELECT description, amount_cents FROM expenses WHERE id = $1`, [A.exp]),
  };
  const denied = (r) => assert.ok([400, 403, 404].includes(r.status), `esperava recusa, veio ${r.status}`);

  denied(await http('GET', `/clients/${A.cli}`, { as: B }));
  denied(await http('PUT', `/clients/${A.cli}`, { as: B, body: { name: 'Invadida', phone: '5531999990000' } }));
  denied(await http('PUT', `/services/${A.svc}`, { as: B, body: { name: 'Invadido', priceCents: 1, durationMinutes: 30 } }));
  denied(await http('DELETE', `/services/${A.svc}`, { as: B }));
  denied(await http('PUT', `/appointments/${A.appt}`, { as: B, body: { notes: 'invadido' } }));
  denied(await http('PUT', `/appointments/${A.appt}`, { as: B, body: { status: 'cancelado' } }));
  denied(await http('DELETE', `/appointments/${A.appt}`, { as: B }));
  denied(await http('POST', `/appointments/${A.appt}/confirm`, { as: B }));
  denied(await http('POST', `/appointments/${A.appt}/check-in`, { as: B }));
  denied(await http('PUT', `/expenses/${A.exp}`, { as: B, body: { description: 'Invadido', category: 'Materiais', amount_cents: 1, expense_date: '2026-06-01' } }));
  denied(await http('DELETE', `/expenses/${A.exp}`, { as: B }));
  // B cria um agendamento usando cliente e serviço de A: recusado
  denied(await http('POST', '/appointments', { as: B, body: { clientId: A.cli, serviceId: B.svc, startsAt: new Date(Date.UTC(2026, 7, 1, 12)).toISOString() } }));
  denied(await http('POST', '/appointments', { as: B, body: { clientId: B.cli, serviceId: A.svc, startsAt: new Date(Date.UTC(2026, 7, 1, 12)).toISOString() } }));

  // listagens de B não vazam nada de A
  for (const path of ['/clients', '/services', '/expenses', `/appointments?from=2026-01-01T00:00:00Z&to=2027-01-01T00:00:00Z`]) {
    const r = await http('GET', path, { as: B });
    assert.equal(r.status, 200, path);
    assert.ok(!r.text.includes(A.id) && !r.text.includes(A.cli) && !r.text.includes(A.appt), `${path} vaza dados de A`);
  }

  assert.deepEqual(await one(`SELECT name, phone FROM clients WHERE id = $1`, [A.cli]), before.cli);
  assert.deepEqual(await one(`SELECT name, price_cents FROM services WHERE id = $1`, [A.svc]), before.svc);
  assert.deepEqual(await one(`SELECT status, notes FROM appointments WHERE id = $1`, [A.appt]), before.appt);
  assert.deepEqual(await one(`SELECT description, amount_cents FROM expenses WHERE id = $1`, [A.exp]), before.exp);
});

dbTest('rotas da administração recusam profissional comum; rotas privadas recusam quem não entrou', async () => {
  const A = await mkProf('perm');
  for (const [m, p] of [['GET', '/admin/professionals'], ['GET', '/admin/audit-log'], ['POST', `/admin/professionals/${A.id}/block`], ['DELETE', `/admin/professionals/${A.id}`]]) {
    assert.equal((await http(m, p, { as: A })).status, 403, `${m} ${p}`);
    assert.equal((await http(m, p)).status, 401, `${m} ${p} sem login`);
  }
  for (const p of ['/auth/me', '/clients', '/services', '/appointments', '/expenses', '/dashboard', '/onboarding/status', '/availability']) {
    assert.equal((await http('GET', p)).status, 401, `${p} sem login`);
  }
});

dbTest('cabeçalhos da API: sem x-powered-by, nosniff, sem cache em respostas autenticadas', async () => {
  const A = await mkProf('hdr');
  const r = await http('GET', '/auth/me', { as: A });
  assert.equal(r.headers.get('x-powered-by'), null);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
  const h = await http('GET', '/health');
  assert.equal(h.status, 200);
  assert.notEqual(h.headers.get('cache-control'), 'no-store');
});

// ── importação de clientes ───────────────────────────────────────────────────
const clientsOf = async (pid) => (await owner.query(`SELECT name, phone, notes, tags FROM clients WHERE professional_id = $1 ORDER BY name`, [pid])).rows;

dbTest('importação: pré-visualização não grava; a gravação ignora inválidas e duplicadas; repetir não duplica; outra conta não interfere', async () => {
  const A = await mkProf('impA');
  const B = await mkProf('impB');
  // telefones válidos no padrão do painel (55 + DDD + 8 dígitos), um em cada conta
  const existente = '553188887777';
  await owner.query(`UPDATE clients SET phone = $1 WHERE id = $2`, [existente, A.cli]);
  // telefone que só existe na conta B: NÃO é duplicado para A
  const soDeB = '553177776666';
  await owner.query(`UPDATE clients SET phone = $1 WHERE id = $2`, [soDeB, B.cli]);
  const rows = [
    { name: 'Maria Silva', phone: '(31) 98888-1111', notes: 'prefere tarde', tags: ['noiva', 'noiva'] },
    { name: 'Joana Lima', phone: '31 3333-2222' },
    { name: '', phone: '31988882222' },
    { name: 'Sem Telefone', phone: '123' },
    { name: 'Maria Repetida', phone: '31988881111' },
    { name: 'Já Cadastrada', phone: existente },
    { name: 'Telefone da Outra Conta', phone: soDeB },
  ];
  const before = await clientsOf(A.id);

  const pre = await http('POST', '/clients/import', { as: A, body: { rows, dryRun: true } });
  assert.equal(pre.status, 200);
  assert.equal(pre.json.dryRun, true);
  assert.deepEqual(pre.json.results.map((r) => r.status), ['ok', 'ok', 'invalid', 'invalid', 'duplicate_file', 'duplicate_existing', 'ok']);
  assert.equal(pre.json.summary.created, 0);
  assert.deepEqual(await clientsOf(A.id), before, 'pré-visualização não grava nada');

  const go = await http('POST', '/clients/import', { as: A, body: { rows } });
  assert.equal(go.status, 200);
  assert.equal(go.json.summary.created, 3);
  const after = await clientsOf(A.id);
  assert.equal(after.length, before.length + 3);
  const maria = after.find((c) => c.name === 'Maria Silva');
  assert.equal(maria.phone, '5531988881111'.replace(/^(55)(31)9/, '$1$2'), 'mesma normalização do cadastro manual');
  assert.equal(maria.notes, 'prefere tarde');
  assert.deepEqual(maria.tags, ['noiva'], 'etiquetas repetidas somem');
  assert.equal((await clientsOf(A.id)).filter((c) => c.name === 'Já Cadastrada').length, 0);
  assert.equal((await one(`SELECT name FROM clients WHERE id = $1`, [A.cli])).name, 'Cliente', 'cliente existente intacta');

  const again = await http('POST', '/clients/import', { as: A, body: { rows } });
  assert.equal(again.json.summary.created, 0, 'repetir a mesma planilha não cria nada');
  assert.equal((await clientsOf(A.id)).length, after.length);
  assert.equal((await clientsOf(B.id)).length, 1, 'a conta B não recebeu nada');
});

dbTest('importação: exige login, limita linhas e recusa corpo malformado', async () => {
  const A = await mkProf('impLim');
  assert.equal((await http('POST', '/clients/import', { body: { rows: [{ name: 'X', phone: '31988880000' }] } })).status, 401);
  assert.equal((await http('POST', '/clients/import', { as: A, body: { rows: [] } })).status, 400);
  const many = Array.from({ length: 501 }, (_, i) => ({ name: `C${i}`, phone: `3198888${String(1000 + i).padStart(4, '0')}` }));
  assert.equal((await http('POST', '/clients/import', { as: A, body: { rows: many, dryRun: true } })).status, 400);
  assert.equal((await http('POST', '/clients/import', { as: A, body: { rows: [{ name: 'X', phone: '31988880000' }], extra: 1 } })).status, 400);
  assert.equal((await http('POST', '/clients/import', { as: A, body: { rows: 'x' } })).status, 400);
  const ok = Array.from({ length: 500 }, (_, i) => ({ name: `Cliente ${i}`, phone: `31977${String(10000 + i).padStart(5, '0')}`, notes: 'obs '.repeat(20) }));
  const r = await http('POST', '/clients/import', { as: A, body: { rows: ok, dryRun: true } });
  assert.equal(r.status, 200, 'até 500 linhas cabem no corpo');
  assert.equal(r.json.summary.importable, 500);
});
