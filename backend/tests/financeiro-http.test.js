// Compatibilidade da migration 025 com Gastos e Agenda pela API HTTP REAL (server.js), com a role NÃO-DONA da aplicação,
// em banco descartável (guia em helpers/financeTestDb.js; FINANCEIRO_HTTP_TEST_DB_URL, um banco só para este arquivo).
// Sem a variável, os testes de banco são ignorados.
//
// O servidor sobe com DATABASE_URL apontando para uma role que imita nailflow em produção (sem superusuário, não dona das
// tabelas, com os privilégios das tabelas existentes e CREATE em public). A MESMA sequência de chamadas HTTP roda em três
// fases, cada uma com profissionais novos: (1) antes da 025; (2) com a 025 aplicada, SEM o script de grants; (3) com a 025
// e o script de grants. O resultado normalizado (status HTTP e campos de negócio) tem de ser idêntico nas três.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import pg from 'pg';
import { resolveFinanceTestDb, financeDb } from './helpers/financeTestDb.js';

const VAR = 'FINANCEIRO_HTTP_TEST_DB_URL';
const EMAIL_LIKE = 'fin-http-%@nf.test';
const ROLE = 'nf_fin_http_app';
const T = { timeout: 120_000 };

let skip = false;
let owner;
let db;
let server;
let baseUrl;
let appPool;
let secret;
let ownerUrl;

const count = async (sql, params) => (await owner.query(sql, params)).rows[0].n;

async function mkProf(tag) {
  const id = randomUUID();
  await owner.query(`INSERT INTO professionals (id, name, email, password_hash, slug, business_name) VALUES ($1, $2, $3, 'x', $4, $5)`,
    [id, `Http ${tag}`, `fin-http-${tag}-${id.slice(0, 8)}@nf.test`, `fin-http-${tag}-${id.slice(0, 8)}`, `Studio ${tag}`]);
  const svc = (await owner.query(`INSERT INTO services (professional_id, name, price_cents, duration_minutes) VALUES ($1, 'Manicure', 8000, 60) RETURNING id`, [id])).rows[0].id;
  const cli = (await owner.query(`INSERT INTO clients (professional_id, name, phone) VALUES ($1, 'Cliente Teste', $2) RETURNING id`, [id, `5531${String(700000000 + Math.floor(Math.random() * 1e8))}`])).rows[0].id;
  const token = jwt.sign({ sub: id, ver: 1 }, secret, { expiresIn: '1h' });
  return { id, svc, cli, token };
}

async function call(method, path, { as, body } = {}) {
  const headers = {};
  if (as) headers.cookie = `nailflow_token=${as.token}`;
  let payload;
  if (body !== undefined) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(`${baseUrl}${path}`, { method, headers, body: payload });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* 204 */ }
  return { status: res.status, json };
}

const pickExpense = (j) => j && { description: j.description, category: j.category, amount_cents: j.amount_cents, notes: j.notes };
const pickAppt = (j) => j && { status: j.status, notes: j.notes, serviceName: j.serviceName, clientName: j.clientName, priceCentsSnapshot: j.priceCentsSnapshot };

/** Mesma sequência de chamadas HTTP; devolve o rastro normalizado (rótulo, status, campos de negócio). */
async function scenario(tag) {
  const A = await mkProf(`${tag}-a`);
  const B = await mkProf(`${tag}-b`);
  const trace = [];
  const step = async (label, method, path, opts, pick) => {
    const r = await call(method, path, opts);
    trace.push([label, r.status, pick ? pick(r.json) : null]);
    return r;
  };
  const range = 'from=2026-10-01&to=2026-10-31';

  // ── Gastos ──
  await step('gastos: lista vazia', 'GET', `/expenses?${range}`, { as: A }, (j) => j.length);
  const created = await step('gastos: criar', 'POST', '/expenses',
    { as: A, body: { description: 'Esmaltes', category: 'Materiais', amount_cents: 1500, expense_date: '2026-10-05', notes: 'lote 1' } }, pickExpense);
  const eid = created.json.id;
  await step('gastos: criar inválido (valor 0)', 'POST', '/expenses',
    { as: A, body: { description: 'x', amount_cents: 0, expense_date: '2026-10-05' } }, (j) => j.error);
  await step('gastos: categoria desconhecida vira Outros', 'POST', '/expenses',
    { as: A, body: { description: 'Outro', category: 'Inexistente', amount_cents: 700, expense_date: '2026-10-06' } }, (j) => j.category);
  await step('gastos: listar', 'GET', `/expenses?${range}`, { as: A }, (j) => j.map(pickExpense));
  await step('gastos: resumo', 'GET', `/expenses/summary?${range}`, { as: A }, (j) => ({ gastosCents: j.gastosCents, resultadoCents: j.resultadoCents, categorias: j.categorias }));
  await step('gastos: editar', 'PUT', `/expenses/${eid}`,
    { as: A, body: { description: 'Esmaltes', category: 'Materiais', amount_cents: 1800, expense_date: '2026-10-05', notes: 'lote 1 corrigido' } }, pickExpense);
  await step('gastos: outra profissional não edita', 'PUT', `/expenses/${eid}`,
    { as: B, body: { description: 'invasão', amount_cents: 1, expense_date: '2026-10-05' } }, (j) => j.error);
  await step('gastos: outra profissional não apaga', 'DELETE', `/expenses/${eid}`, { as: B }, (j) => j?.error ?? null);
  await step('gastos: outra profissional não vê', 'GET', `/expenses?${range}`, { as: B }, (j) => j.length);
  await step('gastos: apagar', 'DELETE', `/expenses/${eid}`, { as: A });
  await step('gastos: apagar de novo', 'DELETE', `/expenses/${eid}`, { as: A }, (j) => j.error);
  await step('gastos: lista depois de apagar', 'GET', `/expenses?${range}`, { as: A }, (j) => j.map(pickExpense));

  // ── Agenda ──
  const base = new Date(Date.now() + 10 * 86400_000);
  base.setUTCHours(15, 0, 0, 0);
  const at = (mins) => new Date(base.getTime() + mins * 60_000).toISOString();
  const appt = await step('agenda: criar confirmado', 'POST', '/appointments',
    { as: A, body: { clientId: A.cli, serviceId: A.svc, startsAt: at(0), status: 'confirmado' } }, pickAppt);
  const aid = appt.json.id;
  await step('agenda: listar', 'GET', `/appointments?from=${at(-1440)}&to=${at(1440)}`, { as: A }, (j) => j.map(pickAppt));
  await step('agenda: editar observação', 'PUT', `/appointments/${aid}`, { as: A, body: { notes: 'cliente prefere francesinha' } }, pickAppt);
  await step('agenda: remarcar', 'PUT', `/appointments/${aid}`, { as: A, body: { startsAt: at(120) } }, pickAppt);
  await step('agenda: concluir antes da hora é recusado', 'PUT', `/appointments/${aid}`, { as: A, body: { status: 'concluido' } }, (j) => j.reason);
  await step('agenda: outra profissional não altera', 'PUT', `/appointments/${aid}`, { as: B, body: { notes: 'invasão' } }, (j) => j.error);
  await step('agenda: outra profissional não vê', 'GET', `/appointments?from=${at(-1440)}&to=${at(1440)}`, { as: B }, (j) => j.length);
  await step('agenda: cancelar pelo status', 'PUT', `/appointments/${aid}`, { as: A, body: { status: 'cancelado' } }, pickAppt);
  await step('agenda: cancelar de novo (idempotente)', 'DELETE', `/appointments/${aid}`, { as: A });
  await step('agenda: dashboard', 'GET', '/dashboard', { as: A }, (j) => Object.keys(j).sort());
  return { trace, A, B };
}

before(async () => {
  const r = await resolveFinanceTestDb(process.env, VAR);
  if (r.skip) { skip = r.skip; return; }
  ownerUrl = r.url;
  owner = new pg.Pool({ connectionString: r.url, options: '-c TimeZone=UTC', max: 4 });
  db = financeDb(owner);
  await db.reset({ emailLike: EMAIL_LIKE, roles: [ROLE] });
  await db.createAppRole(ROLE);

  secret = 'fin-http-test-secret';
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = secret;
  process.env.DATABASE_URL = db.appUrl(r.url, ROLE);
  for (const k of ['N8N_WEBHOOK_CONFIRMED_URL', 'N8N_WEBHOOK_CANCELLED_URL', 'N8N_WEBHOOK_REJECTED_URL', 'N8N_WEBHOOK_MESSAGE_URL', 'N8N_BOT_WEBHOOK_URL']) process.env[k] = '';
  process.env.EVOLUTION_API_URL = 'http://127.0.0.1:9';
  ({ pool: appPool } = await import('../src/config/db.js'));
  const { default: app } = await import('../src/server.js');
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  const who = (await appPool.query('SELECT current_user AS u, (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS su')).rows[0];
  assert.equal(who.u, ROLE);
  assert.equal(who.su, false);
});

after(async () => {
  if (!owner) return;
  try {
    if (server) await new Promise((resolve) => server.close(resolve));
    await appPool?.end().catch(() => {});
    await db.reset({ emailLike: EMAIL_LIKE, roles: [ROLE] });
  } finally {
    await owner.end();
  }
});

const dbTest = (name, fn) => test(name, T, async (t) => { if (skip) return t.skip(skip); await fn(t); });
const run = {};

dbTest('fase 1: antes da 025 (a role é não-dona, sem as tabelas financeiras)', async () => {
  assert.equal(await db.hasStructure(), false);
  run.antes = await scenario('antes');
  // sanidade do cenário: os resultados são os esperados, não só iguais entre si
  const byLabel = Object.fromEntries(run.antes.trace.map(([l, s, b]) => [l, { s, b }]));
  assert.equal(byLabel['gastos: criar'].s, 201);
  assert.equal(byLabel['gastos: criar inválido (valor 0)'].s, 400);
  assert.equal(byLabel['gastos: outra profissional não edita'].s, 404);
  assert.equal(byLabel['gastos: apagar'].s, 204);
  assert.equal(byLabel['agenda: criar confirmado'].s, 201);
  assert.equal(byLabel['agenda: remarcar'].s, 200);
  assert.equal(byLabel['agenda: concluir antes da hora é recusado'].s, 409);
  assert.equal(byLabel['agenda: cancelar pelo status'].b.status, 'cancelado');
  assert.equal(byLabel['agenda: dashboard'].s, 200);
});

dbTest('fase 2: 025 aplicada SEM o script de grants: Gastos e Agenda idênticos e histórico gravado pelas funções SECURITY DEFINER', async () => {
  await db.up();
  run.semGrants = await scenario('sem-grants');
  assert.deepEqual(run.semGrants.trace, run.antes.trace, 'mesmos status e campos de negócio da fase 1');
  // o histórico do Gastos foi gravado mesmo sem privilégio da role na tabela; a Agenda não gerou histórico financeiro
  const acts = (await owner.query(`SELECT action FROM financial_audit_log WHERE professional_id = $1 ORDER BY seq`, [run.semGrants.A.id])).rows.map((r) => r.action);
  assert.deepEqual(acts, ['expense_create', 'expense_create', 'expense_update', 'expense_delete']);
  assert.equal(await count(`SELECT count(*)::int AS n FROM financial_audit_log WHERE entity_type = 'appointment'`), 0);
  // a role não lê nem grava as tabelas novas
  for (const sql of ['SELECT 1 FROM financial_payments', 'SELECT 1 FROM financial_audit_log', 'SELECT 1 FROM cash_closings',
    `INSERT INTO financial_audit_log (professional_id, entity_type, entity_id, action, reason) VALUES (gen_random_uuid(), 'payment', gen_random_uuid(), 'correction', 'forjado')`]) {
    await assert.rejects(appPool.query(sql), (e) => { assert.equal(e.code, '42501', sql); return true; });
  }
  // a resposta da API ganha os campos novos da despesa; os campos antigos seguem iguais
  const c = await call('POST', '/expenses', { as: run.semGrants.A, body: { description: 'Campos novos', amount_cents: 100, expense_date: '2026-10-07' } });
  assert.equal(c.status, 201);
  assert.equal(c.json.payment_status, 'a_revisar');
  assert.equal(c.json.paid_on, null);
});

dbTest('fase 3: 025 com o script de grants: Gastos e Agenda idênticos; append-only vale também por privilégio', async () => {
  await db.grant(ROLE);
  run.comGrants = await scenario('com-grants');
  assert.deepEqual(run.comGrants.trace, run.antes.trace);
  const acts = (await owner.query(`SELECT action FROM financial_audit_log WHERE professional_id = $1 ORDER BY seq`, [run.comGrants.A.id])).rows.map((r) => r.action);
  assert.deepEqual(acts, ['expense_create', 'expense_create', 'expense_update', 'expense_delete']);
  // com os grants, a aplicação lê e insere; continua sem UPDATE/DELETE/TRUNCATE nas tabelas append-only
  await appPool.query('SELECT count(*) FROM financial_payments');
  await appPool.query('SELECT count(*) FROM financial_audit_log');
  for (const sql of ['UPDATE financial_payments SET amount_cents = 1', 'DELETE FROM financial_payments', 'TRUNCATE financial_payments',
    `UPDATE financial_audit_log SET reason = 'abc'`, 'DELETE FROM financial_audit_log', 'TRUNCATE financial_audit_log', 'DELETE FROM cash_closings', 'TRUNCATE cash_closings']) {
    await assert.rejects(appPool.query(sql), (e) => { assert.equal(e.code, '42501', sql); return true; });
  }
});

dbTest('fase 4: com os privilégios mínimos propostos (sem TRUNCATE, TRIGGER, REFERENCES e sem CREATE em public) Gastos e Agenda seguem idênticos', async () => {
  // o código da aplicação não usa nenhum destes privilégios (busca em backend/src: sem DDL, TRUNCATE, CREATE TRIGGER, REFERENCES, COPY)
  await owner.query(`REVOKE TRUNCATE, TRIGGER, REFERENCES ON ALL TABLES IN SCHEMA public FROM ${ROLE}`);
  await owner.query(`REVOKE CREATE ON SCHEMA public FROM ${ROLE}`);
  for (const sql of ['TRUNCATE expenses', 'TRUNCATE appointments CASCADE', 'CREATE TABLE public.zz_nao_pode (a int)',
    `CREATE FUNCTION public.zz_nao_pode() RETURNS int LANGUAGE sql AS 'SELECT 1'`]) {
    await assert.rejects(appPool.query(sql), (e) => { assert.equal(e.code, '42501', sql); return true; });
  }
  run.minimo = await scenario('minimo');
  assert.deepEqual(run.minimo.trace, run.antes.trace, 'mesmos status e campos de negócio das fases anteriores');
  const acts = (await owner.query(`SELECT action FROM financial_audit_log WHERE professional_id = $1 ORDER BY seq`, [run.minimo.A.id])).rows.map((r) => r.action);
  assert.deepEqual(acts, ['expense_create', 'expense_create', 'expense_update', 'expense_delete']);
});
