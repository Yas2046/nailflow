// Financeiro, etapa 2: pagamentos e recebimentos pela API HTTP REAL (server.js), com a role NÃO-DONA da aplicação, em banco
// DESCARTÁVEL (guia em helpers/financeTestDb.js; FINANCEIRO_PAGAMENTOS_TEST_DB_URL, um banco só para este arquivo). Sem a
// variável, os testes de banco são ignorados. O teste aplica a 025 e a 026 (e as reverte no fim); nada toca produção.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import pg from 'pg';
import { resolveFinanceTestDb, financeDb } from './helpers/financeTestDb.js';
import { todayInBusinessTz } from '../src/utils/financeiroPagamentos.js';

const VAR = 'FINANCEIRO_PAGAMENTOS_TEST_DB_URL';
const EMAIL_LIKE = 'fin-pay-%@nf.test';
const ROLE = 'nf_fin_pay_app';
const UP26 = '026_financeiro_pagamentos_metodo.sql';
const DOWN26 = '_rollback/026_financeiro_pagamentos_metodo.down.sql';
const T = { timeout: 180_000 };

let skip = false;
let owner;
let db;
let server;
let baseUrl;
let appPool;
let secret;
let dayN = 0;

const today = todayInBusinessTz();
const daysAgo = (n) => { const d = new Date(`${today}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };
const D = { d1: daysAgo(1), d3: daysAgo(3), d5: daysAgo(5), d9: daysAgo(9) };
const one = async (sql, params) => (await owner.query(sql, params)).rows[0];
const count = async (sql, params) => (await one(sql, params)).n;

async function mkProf(tag) {
  const id = randomUUID();
  await owner.query(`INSERT INTO professionals (id, name, email, password_hash, slug, business_name) VALUES ($1, $2, $3, 'x', $4, $5)`,
    [id, `Pay ${tag}`, `fin-pay-${tag}-${id.slice(0, 8)}@nf.test`, `fin-pay-${tag}-${id.slice(0, 8)}`, `Studio ${tag}`]);
  const svc = (await one(`INSERT INTO services (professional_id, name, price_cents, duration_minutes) VALUES ($1, 'Manicure', 10000, 60) RETURNING id`, [id])).id;
  const cli = (await one(`INSERT INTO clients (professional_id, name, phone) VALUES ($1, 'Cliente', $2) RETURNING id`, [id, `5531${String(400000000 + Math.floor(Math.random() * 1e8))}`])).id;
  return { id, svc, cli, token: jwt.sign({ sub: id, ver: 1 }, secret, { expiresIn: '1h' }) };
}
/** Atendimento no status pedido (concluído por padrão), preço 10000 e, opcionalmente, valor final e sinal Pix legado. */
async function mkAppt(p, { status = 'concluido', price = 10000, finalCents = null, deposit = null, paidAt = null } = {}) {
  const start = new Date(Date.UTC(2026, 0, 1 + (++dayN), 12, 0, 0));
  const id = (await one(`INSERT INTO appointments (professional_id, client_id, service_id, starts_at, ends_at, status, price_cents_snapshot, deposit_cents, paid_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`, [p.id, p.cli, p.svc, start, new Date(start.getTime() + 3600_000), status, price, deposit, paidAt])).id;
  if (finalCents != null) await owner.query(`UPDATE appointments SET final_price_cents = $2 WHERE id = $1`, [id, finalCents]);
  return id;
}

async function api(method, path, { as, body, key, headers = {} } = {}) {
  const h = { ...headers };
  if (as) h.cookie = `nailflow_token=${as.token}`;
  if (key) h['idempotency-key'] = key;
  let payload;
  if (body !== undefined) { h['content-type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(`${baseUrl}${path}`, { method, headers: h, body: payload });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* 204 */ }
  return { status: res.status, json };
}
const k = () => `k-${randomUUID().slice(0, 20)}`;
const receive = (p, appt, body, key = k()) => api('POST', `/financeiro/atendimentos/${appt}/pagamentos`, { as: p, body, key });
const refund = (p, payId, body, key = k()) => api('POST', `/financeiro/pagamentos/${payId}/estornos`, { as: p, body, key });
const correct = (p, payId, body, key = k()) => api('POST', `/financeiro/pagamentos/${payId}/correcao`, { as: p, body, key });
const summary = (p, appt) => api('GET', `/financeiro/atendimentos/${appt}/pagamentos`, { as: p });
const rows = (appt) => owner.query(`SELECT id, kind, amount_cents, method, to_char(occurred_on,'YYYY-MM-DD') AS on, reverses_payment_id, notes, source FROM financial_payments WHERE appointment_id = $1 ORDER BY created_at, id`, [appt]).then((r) => r.rows);
const net = async (appt) => (await one(`SELECT COALESCE(SUM(CASE WHEN kind = 'recebimento' THEN amount_cents ELSE -amount_cents END), 0)::int AS n FROM financial_payments WHERE appointment_id = $1`, [appt])).n;

before(async () => {
  const r = await resolveFinanceTestDb(process.env, VAR);
  if (r.skip) { skip = r.skip; return; }
  owner = new pg.Pool({ connectionString: r.url, options: '-c TimeZone=UTC', max: 8 });
  owner.on('error', () => {});
  db = financeDb(owner);
  await db.reset({ emailLike: EMAIL_LIKE, roles: [ROLE] });
  await db.createAppRole(ROLE);
  await db.up();                 // 025
  await db.grant(ROLE);
  secret = 'fin-pay-test-secret';
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = secret;
  process.env.DATABASE_URL = db.appUrl(r.url, ROLE);
  process.env.FRONTEND_URL = 'http://localhost:5173';
  process.env.FINANCEIRO_PAGAMENTOS_ENABLED = 'true';
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
    await db.reset({ emailLike: EMAIL_LIKE, roles: [ROLE] });
  } finally {
    await owner.end();
  }
});

const dbTest = (name, fn) => test(name, T, async (t) => { if (skip) return t.skip(skip); await fn(t); });

// ── interruptor, estrutura e autenticação ──────────────────────────────────
dbTest('interruptor desligado: a rota não existe (404), mesmo autenticada', async () => {
  const A = await mkProf('flag');
  const appt = await mkAppt(A);
  process.env.FINANCEIRO_PAGAMENTOS_ENABLED = 'false';
  try {
    assert.equal((await summary(A, appt)).status, 404);
    assert.equal((await receive(A, appt, { amountCents: 100, method: 'pix', occurredOn: D.d1 })).status, 404);
    assert.equal((await api('GET', `/financeiro/atendimentos/${appt}/pagamentos`)).status, 404, 'nem sem autenticação revela a rota');
  } finally { process.env.FINANCEIRO_PAGAMENTOS_ENABLED = 'true'; }
  assert.equal(await count(`SELECT count(*)::int AS n FROM financial_payments`), 0);
});

dbTest('sem a 026 (forma "transferencia" ausente) o Financeiro responde 503 e não grava nada', async () => {
  const A = await mkProf('sem026');
  const appt = await mkAppt(A);
  const r = await receive(A, appt, { amountCents: 100, method: 'pix', occurredOn: D.d1 });
  assert.equal(r.status, 503);
  assert.equal(r.json.reason, 'structure_missing');
  assert.equal((await api('GET', `/financeiro/atendimentos/${appt}/pagamentos`)).status, 401, 'sem sessão não se descobre o estado da estrutura');
  assert.equal(await count(`SELECT count(*)::int AS n FROM financial_payments`), 0);
  await db.runFile(UP26);
  await db.runFile(UP26); // idempotente
  const def = (await one(`SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conname = 'financial_payments_method_check'`)).d;
  assert.match(def, /transferencia/);
});

dbTest('autenticação: sem sessão 401; identificador malformado 400; inexistente 404', async () => {
  const A = await mkProf('auth');
  assert.equal((await api('GET', `/financeiro/atendimentos/${randomUUID()}/pagamentos`)).status, 401);
  assert.equal((await api('POST', `/financeiro/atendimentos/${randomUUID()}/pagamentos`, { body: {}, key: k() })).status, 401);
  assert.equal((await summary(A, 'nao-e-uuid')).status, 400);
  assert.equal((await receive(A, 'nao-e-uuid', { amountCents: 1, method: 'pix', occurredOn: D.d1 })).status, 400);
  assert.equal((await summary(A, randomUUID())).status, 404);
  assert.equal((await receive(A, randomUUID(), { amountCents: 100, method: 'pix', occurredOn: D.d1 })).status, 404);
  assert.equal((await refund(A, randomUUID(), { amountCents: 100, occurredOn: D.d1, reason: 'motivo ok' })).status, 404);
});

dbTest('CSRF: origem estranha é recusada (403); sem Origin passa', async () => {
  const A = await mkProf('csrf');
  const appt = await mkAppt(A);
  const bad = await api('POST', `/financeiro/atendimentos/${appt}/pagamentos`, { as: A, key: k(), body: { amountCents: 100, method: 'pix', occurredOn: D.d1 }, headers: { origin: 'https://evil.example' } });
  assert.equal(bad.status, 403);
  assert.equal(await count(`SELECT count(*)::int AS n FROM financial_payments WHERE appointment_id = '${appt}'`), 0);
  assert.equal((await receive(A, appt, { amountCents: 100, method: 'pix', occurredOn: D.d1 })).status, 201);
});

// ── sucesso, parciais e métodos ────────────────────────────────────────────
dbTest('recebimento de atendimento concluído: 201, resumo correto e histórico com o autor', async () => {
  const A = await mkProf('ok');
  const appt = await mkAppt(A);
  const r = await receive(A, appt, { amountCents: 4000, method: 'pix', occurredOn: D.d3, notes: ' sinal e resto no fim ' });
  assert.equal(r.status, 201);
  assert.equal(r.json.replayed, false);
  assert.deepEqual({ k: r.json.pagamento.kind, a: r.json.pagamento.amountCents, m: r.json.pagamento.method, d: r.json.pagamento.occurredOn, n: r.json.pagamento.notes, s: r.json.pagamento.source },
    { k: 'recebimento', a: 4000, m: 'pix', d: D.d3, n: 'sinal e resto no fim', s: 'manual' });
  assert.deepEqual({ v: r.json.resumo.valueCents, b: r.json.resumo.valueBasis, rec: r.json.resumo.receivedCents, net: r.json.resumo.netReceivedCents, bal: r.json.resumo.balanceCents },
    { v: 10000, b: 'servico', rec: 4000, net: 4000, bal: 6000 });
  const g = await summary(A, appt);
  assert.equal(g.status, 200);
  assert.equal(g.json.movimentacoes.length, 1);
  assert.equal(g.json.movimentacoes[0].remainingCents, 4000);
  const audit = await one(`SELECT action, actor_id, entity_id FROM financial_audit_log WHERE entity_id = $1`, [r.json.pagamento.id]);
  assert.deepEqual({ a: audit.action, actor: audit.actor_id }, { a: 'payment_create', actor: A.id });
});

dbTest('vários pagamentos parciais com métodos diferentes até quitar; os seis métodos são aceitos', async () => {
  const A = await mkProf('parcial');
  const appt = await mkAppt(A, { price: 6000 });
  const methods = ['pix', 'dinheiro', 'cartao_debito', 'cartao_credito', 'transferencia', 'outra'];
  for (const m of methods) assert.equal((await receive(A, appt, { amountCents: 1000, method: m, occurredOn: D.d5 })).status, 201, m);
  const s = (await summary(A, appt)).json;
  assert.deepEqual({ rec: s.receivedCents, bal: s.balanceCents, n: s.movimentacoes.length }, { rec: 6000, bal: 0, n: 6 });
  assert.deepEqual(s.movimentacoes.map((x) => x.method), methods);
  assert.equal((await receive(A, appt, { amountCents: 1, method: 'pix', occurredOn: D.d5 })).status, 409, 'quitado: nem 1 centavo a mais');
});

// ── separar concluído de pago; sinais antigos ──────────────────────────────
dbTest('concluído NÃO é pago: nada é gravado sozinho; só atendimento concluído recebe', async () => {
  const A = await mkProf('status');
  const done = await mkAppt(A);
  const s = (await summary(A, done)).json;
  assert.deepEqual({ rec: s.receivedCents, bal: s.balanceCents, can: s.canReceive, n: s.movimentacoes.length }, { rec: 0, bal: 10000, can: true, n: 0 });
  for (const st of ['pendente', 'confirmado', 'aguardando_pagamento', 'cancelado', 'nao_compareceu']) {
    const appt = await mkAppt(A, { status: st });
    const r = await receive(A, appt, { amountCents: 100, method: 'pix', occurredOn: D.d1 });
    assert.equal(r.status, 409, st);
    assert.equal(r.json.reason, 'not_completed', st);
    assert.equal((await summary(A, appt)).json.canReceive, false, st);
    assert.equal((await rows(appt)).length, 0, st);
  }
});

dbTest('sinal Pix antigo NÃO é importado nem presumido como recebido', async () => {
  const A = await mkProf('sinal');
  const appt = await mkAppt(A, { deposit: 3000, paidAt: new Date('2026-01-02T10:00:00Z') });
  const s = (await summary(A, appt)).json;
  assert.deepEqual({ rec: s.receivedCents, bal: s.balanceCents }, { rec: 0, bal: 10000 }, 'o sinal registrado não conta como recebido');
  assert.equal((await rows(appt)).length, 0);
  // e a rota não aceita "marcar" origem de sinal: campo desconhecido é recusado
  const r = await receive(A, appt, { amountCents: 3000, method: 'pix', occurredOn: D.d1, source: 'sinal_pix_confirmado' });
  assert.equal(r.status, 400);
  assert.equal((await rows(appt)).length, 0);
  assert.equal(await count(`SELECT count(*)::int AS n FROM financial_payments WHERE source = 'sinal_pix_confirmado'`), 0);
});

// ── teto ────────────────────────────────────────────────────────────────────
dbTest('teto: total líquido (recebimentos - estornos) nunca passa do valor do serviço', async () => {
  const A = await mkProf('teto');
  const appt = await mkAppt(A);
  const first = await receive(A, appt, { amountCents: 7000, method: 'pix', occurredOn: D.d5 });
  const over = await receive(A, appt, { amountCents: 3001, method: 'dinheiro', occurredOn: D.d5 });
  assert.equal(over.status, 409);
  assert.deepEqual({ r: over.json.reason, v: over.json.valueCents, net: over.json.netReceivedCents, bal: over.json.balanceCents }, { r: 'exceeds_value', v: 10000, net: 7000, bal: 3000 });
  assert.equal((await receive(A, appt, { amountCents: 3000, method: 'dinheiro', occurredOn: D.d5 })).status, 201);
  assert.equal(await net(appt), 10000);
  // estorno libera saldo: o líquido cai e cabe de novo, mas só até o valor
  assert.equal((await refund(A, first.json.pagamento.id, { amountCents: 2500, occurredOn: D.d3, reason: 'Cliente devolveu parte' })).status, 201);
  assert.equal(await net(appt), 7500);
  assert.equal((await receive(A, appt, { amountCents: 2501, method: 'pix', occurredOn: D.d3 })).status, 409);
  assert.equal((await receive(A, appt, { amountCents: 2500, method: 'pix', occurredOn: D.d3 })).status, 201);
  assert.equal(await net(appt), 10000);
});

dbTest('o teto usa o valor final quando existe, e o preço registrado quando não', async () => {
  const A = await mkProf('final');
  const comFinal = await mkAppt(A, { price: 10000, finalCents: 8000 });
  const s = (await summary(A, comFinal)).json;
  assert.deepEqual({ v: s.valueCents, b: s.valueBasis }, { v: 8000, b: 'final' });
  assert.equal((await receive(A, comFinal, { amountCents: 8001, method: 'pix', occurredOn: D.d1 })).status, 409);
  assert.equal((await receive(A, comFinal, { amountCents: 8000, method: 'pix', occurredOn: D.d1 })).status, 201);
  const gratis = await mkAppt(A, { price: 10000, finalCents: 0 });
  assert.equal((await receive(A, gratis, { amountCents: 1, method: 'pix', occurredOn: D.d1 })).status, 409, 'valor final zero: nada a receber');
});

dbTest('concorrência: pedidos simultâneos não ultrapassam o valor (10 de 2500 em 10000 => exatamente 4)', async () => {
  const A = await mkProf('conc');
  const appt = await mkAppt(A);
  const res = await Promise.all(Array.from({ length: 10 }, () => receive(A, appt, { amountCents: 2500, method: 'pix', occurredOn: D.d1 })));
  const ok = res.filter((r) => r.status === 201).length;
  const exceeded = res.filter((r) => r.status === 409 && r.json.reason === 'exceeds_value').length;
  assert.equal(ok, 4);
  assert.equal(exceeded, 6);
  assert.equal(await net(appt), 10000);
  assert.equal((await rows(appt)).length, 4);
});

dbTest('concorrência: recebimentos e estornos misturados mantêm 0 <= líquido <= valor', async () => {
  const A = await mkProf('conc2');
  const appt = await mkAppt(A);
  const base = (await receive(A, appt, { amountCents: 6000, method: 'pix', occurredOn: D.d5 })).json.pagamento.id;
  const jobs = [
    ...Array.from({ length: 6 }, () => receive(A, appt, { amountCents: 2000, method: 'dinheiro', occurredOn: D.d3 })),
    ...Array.from({ length: 6 }, () => refund(A, base, { amountCents: 1500, occurredOn: D.d3, reason: 'estorno simultâneo' })),
  ];
  const res = await Promise.all(jobs);
  assert.ok(res.every((r) => [201, 409].includes(r.status)), res.map((r) => r.status).join());
  const n = await net(appt);
  assert.ok(n >= 0 && n <= 10000, `líquido ${n}`);
  const refunded = (await one(`SELECT COALESCE(SUM(amount_cents),0)::int AS n FROM financial_payments WHERE reverses_payment_id = $1`, [base])).n;
  assert.ok(refunded <= 6000, `estornado ${refunded} do original de 6000`);
});

// ── validação ───────────────────────────────────────────────────────────────
dbTest('validação: valores, métodos, datas, chave de idempotência e campos desconhecidos são recusados sem gravar', async () => {
  const A = await mkProf('valid');
  const appt = await mkAppt(A);
  const ok = { amountCents: 1000, method: 'pix', occurredOn: D.d1 };
  const bodies = [
    { ...ok, amountCents: 0 }, { ...ok, amountCents: -5 }, { ...ok, amountCents: 10.5 }, { ...ok, amountCents: '1000' }, { ...ok, amountCents: 10_000_001 },
    { ...ok, method: 'cheque' }, { ...ok, method: undefined },
    { ...ok, occurredOn: '2026-02-30' }, { ...ok, occurredOn: '01/10/2026' }, { ...ok, occurredOn: '2019-12-31' }, { ...ok, occurredOn: undefined },
    { ...ok, occurredOn: daysAgo(-1) },                      // amanhã
    { ...ok, professionalId: randomUUID() }, { ...ok, kind: 'estorno' }, { ...ok, reversesPaymentId: randomUUID() }, { ...ok, appointmentId: randomUUID() },
  ];
  for (const b of bodies) {
    const r = await receive(A, appt, b);
    assert.equal(r.status, 400, JSON.stringify(b));
  }
  assert.equal((await api('POST', `/financeiro/atendimentos/${appt}/pagamentos`, { as: A, body: ok })).json.reason, 'idempotency_key_required');
  for (const key of ['curta', 'a'.repeat(51), 'tem espaço aqui', 'acento-ção-aqui']) {
    const r = await api('POST', `/financeiro/atendimentos/${appt}/pagamentos`, { as: A, body: ok, key });
    assert.equal(r.status, 400, key);
    assert.equal(r.json.reason, 'idempotency_key_required', key);
  }
  assert.equal((await api('POST', `/financeiro/atendimentos/${appt}/pagamentos`, { as: A, key: k(), body: undefined })).status, 400, 'corpo ausente');
  assert.equal((await rows(appt)).length, 0, 'nada foi gravado');
});

// ── idempotência ────────────────────────────────────────────────────────────
dbTest('idempotência: mesma chave e mesmo pedido devolve o gravado (200); pedido diferente é 409; vale entre atendimentos', async () => {
  const A = await mkProf('idem');
  const a1 = await mkAppt(A);
  const a2 = await mkAppt(A);
  const key = k();
  const body = { amountCents: 3000, method: 'pix', occurredOn: D.d3 };
  const first = await receive(A, a1, body, key);
  assert.equal(first.status, 201);
  const again = await receive(A, a1, body, key);
  assert.equal(again.status, 200);
  assert.equal(again.json.replayed, true);
  assert.equal(again.json.pagamento.id, first.json.pagamento.id);
  assert.equal((await rows(a1)).length, 1, 'não duplicou');
  assert.equal((await receive(A, a1, { ...body, amountCents: 3001 }, key)).status, 409, 'valor diferente');
  assert.equal((await receive(A, a1, { ...body, method: 'dinheiro' }, key)).status, 409, 'método diferente');
  assert.equal((await receive(A, a1, { ...body, occurredOn: D.d5 }, key)).status, 409, 'data diferente');
  const other = await receive(A, a2, body, key);
  assert.equal(other.status, 409, 'mesma chave em outro atendimento');
  assert.equal(other.json.reason, 'idempotency_conflict');
  assert.equal((await rows(a2)).length, 0);
  assert.equal(await count(`SELECT count(*)::int AS n FROM financial_audit_log WHERE entity_id = '${first.json.pagamento.id}'`), 1, 'o reenvio não gerou histórico');
});

dbTest('idempotência: o reenvio funciona mesmo depois de o atendimento deixar de aceitar recebimento e de o saldo acabar', async () => {
  const A = await mkProf('idem2');
  const appt = await mkAppt(A);
  const key = k();
  const body = { amountCents: 10000, method: 'pix', occurredOn: D.d3 };
  const first = await receive(A, appt, body, key);
  assert.equal(first.status, 201);
  assert.equal((await receive(A, appt, { amountCents: 1, method: 'pix', occurredOn: D.d3 })).status, 409);
  const again = await receive(A, appt, body, key);
  assert.equal(again.status, 200);
  assert.equal(again.json.pagamento.id, first.json.pagamento.id);
});

dbTest('idempotência sob concorrência: 8 pedidos idênticos simultâneos gravam uma única vez', async () => {
  const A = await mkProf('idem3');
  const appt = await mkAppt(A);
  const key = k();
  const body = { amountCents: 2000, method: 'dinheiro', occurredOn: D.d1 };
  const res = await Promise.all(Array.from({ length: 8 }, () => receive(A, appt, body, key)));
  assert.ok(res.every((r) => [200, 201].includes(r.status)), res.map((r) => r.status).join());
  assert.equal(res.filter((r) => r.status === 201).length, 1);
  assert.equal(new Set(res.map((r) => r.json.pagamento.id)).size, 1);
  assert.equal((await rows(appt)).length, 1);
  assert.equal(await net(appt), 2000);
});

dbTest('a chave de idempotência é por profissional: outra conta pode usar a mesma chave sem conflito', async () => {
  const A = await mkProf('idemA');
  const B = await mkProf('idemB');
  const aa = await mkAppt(A);
  const bb = await mkAppt(B);
  const key = k();
  assert.equal((await receive(A, aa, { amountCents: 1000, method: 'pix', occurredOn: D.d1 }, key)).status, 201);
  assert.equal((await receive(B, bb, { amountCents: 1000, method: 'pix', occurredOn: D.d1 }, key)).status, 201);
});

// ── estornos ────────────────────────────────────────────────────────────────
dbTest('estorno: linha nova ligada ao recebimento, com motivo; o original não muda; histórico com motivo e autor', async () => {
  const A = await mkProf('est');
  const appt = await mkAppt(A);
  const rec = (await receive(A, appt, { amountCents: 5000, method: 'pix', occurredOn: D.d5 })).json.pagamento;
  const r = await refund(A, rec.id, { amountCents: 1200, occurredOn: D.d3, reason: 'Cliente devolveu um item' });
  assert.equal(r.status, 201);
  assert.deepEqual({ k: r.json.estorno.kind, a: r.json.estorno.amountCents, rev: r.json.estorno.reversesPaymentId, n: r.json.estorno.notes, m: r.json.estorno.method },
    { k: 'estorno', a: 1200, rev: rec.id, n: 'Cliente devolveu um item', m: 'pix' });
  assert.deepEqual({ rec: r.json.resumo.receivedCents, ref: r.json.resumo.refundedCents, net: r.json.resumo.netReceivedCents, bal: r.json.resumo.balanceCents }, { rec: 5000, ref: 1200, net: 3800, bal: 6200 });
  const orig = (await rows(appt)).find((x) => x.id === rec.id);
  assert.deepEqual({ a: orig.amount_cents, m: orig.method, on: orig.on, k: orig.kind }, { a: 5000, m: 'pix', on: D.d5, k: 'recebimento' }, 'o original nunca muda');
  const audit = await one(`SELECT action, reason, actor_id FROM financial_audit_log WHERE entity_id = $1`, [r.json.estorno.id]);
  assert.deepEqual(audit, { action: 'payment_refund', reason: 'Cliente devolveu um item', actor_id: A.id });
  assert.equal((await summary(A, appt)).json.movimentacoes.find((x) => x.id === rec.id).remainingCents, 3800);
});

dbTest('estorno acima do valor recebido é recusado; estornos parciais somam até o total; nunca estorna estorno', async () => {
  const A = await mkProf('est2');
  const appt = await mkAppt(A);
  const rec = (await receive(A, appt, { amountCents: 4000, method: 'dinheiro', occurredOn: D.d5 })).json.pagamento.id;
  const over = await refund(A, rec, { amountCents: 4001, occurredOn: D.d3, reason: 'acima do recebido' });
  assert.equal(over.status, 409);
  assert.deepEqual({ r: over.json.reason, rem: over.json.remainingCents }, { r: 'refund_exceeds', rem: 4000 });
  const p1 = await refund(A, rec, { amountCents: 1500, occurredOn: D.d3, reason: 'primeira devolução' });
  assert.equal(p1.status, 201);
  const p2 = await refund(A, rec, { amountCents: 2501, occurredOn: D.d3, reason: 'segunda devolução' });
  assert.equal(p2.status, 409);
  assert.equal(p2.json.remainingCents, 2500);
  assert.equal((await refund(A, rec, { amountCents: 2500, occurredOn: D.d3, reason: 'resto da devolução' })).status, 201);
  assert.equal((await refund(A, rec, { amountCents: 1, occurredOn: D.d3, reason: 'já estornado todo' })).status, 409);
  assert.equal(await net(appt), 0);
  const nonReceipt = await refund(A, p1.json.estorno.id, { amountCents: 100, occurredOn: D.d3, reason: 'estorno de estorno' });
  assert.equal(nonReceipt.status, 409);
  assert.equal(nonReceipt.json.reason, 'not_a_receipt');
});

dbTest('estorno: data não anterior ao recebimento e não futura; motivo obrigatório; valor válido', async () => {
  const A = await mkProf('est3');
  const appt = await mkAppt(A);
  const rec = (await receive(A, appt, { amountCents: 4000, method: 'pix', occurredOn: D.d3 })).json.pagamento.id;
  const bad = [
    { amountCents: 100, occurredOn: D.d5, reason: 'antes do recebimento' },
    { amountCents: 100, occurredOn: daysAgo(-1), reason: 'no futuro' },
    { amountCents: 100, occurredOn: '2026-02-30', reason: 'data impossível' },
    { amountCents: 100, occurredOn: D.d1 },
    { amountCents: 100, occurredOn: D.d1, reason: 'ab' },
    { amountCents: 100, occurredOn: D.d1, reason: '   ' },
    { amountCents: 0, occurredOn: D.d1, reason: 'valor zero' },
    { amountCents: 10.5, occurredOn: D.d1, reason: 'valor quebrado' },
    { amountCents: 100, occurredOn: D.d1, reason: 'campo extra', method: 'pix' },
  ];
  for (const b of bad) assert.equal((await refund(A, rec, b)).status, 400, JSON.stringify(b));
  assert.equal((await rows(appt)).filter((x) => x.kind === 'estorno').length, 0);
  assert.equal((await refund(A, rec, { amountCents: 100, occurredOn: D.d3, reason: 'no mesmo dia vale' })).status, 201);
});

dbTest('estorno: idempotente, e 4 estornos simultâneos nunca passam do recebido', async () => {
  const A = await mkProf('est4');
  const appt = await mkAppt(A);
  const rec = (await receive(A, appt, { amountCents: 10000, method: 'pix', occurredOn: D.d5 })).json.pagamento.id;
  const key = k();
  const body = { amountCents: 1000, occurredOn: D.d3, reason: 'mesmo pedido repetido' };
  const first = await refund(A, rec, body, key);
  const again = await refund(A, rec, body, key);
  assert.deepEqual([first.status, again.status, again.json.replayed], [201, 200, true]);
  assert.equal(first.json.estorno.id, again.json.estorno.id);
  assert.equal((await refund(A, rec, { ...body, amountCents: 1001 }, key)).status, 409, 'mesma chave, valor diferente');
  const res = await Promise.all(Array.from({ length: 4 }, () => refund(A, rec, { amountCents: 3000, occurredOn: D.d3, reason: 'estorno simultâneo' })));
  assert.equal(res.filter((r) => r.status === 201).length, 3, 'cabem 3 de 3000 em 9000 restantes');
  const refunded = (await one(`SELECT SUM(amount_cents)::int AS n FROM financial_payments WHERE reverses_payment_id = $1`, [rec])).n;
  assert.equal(refunded, 10000, '1000 do primeiro + 3 x 3000 dos simultâneos');
  assert.ok(refunded <= 10000);
});

// ── correção ────────────────────────────────────────────────────────────────
dbTest('correção: estorna o saldo e registra o recebimento correto, preservando o original e o histórico', async () => {
  const A = await mkProf('corr');
  const appt = await mkAppt(A);
  const rec = (await receive(A, appt, { amountCents: 5000, method: 'pix', occurredOn: D.d5 })).json.pagamento;
  const r = await correct(A, rec.id, { reason: 'Digitei o valor e o método errados', occurredOn: D.d3, novo: { amountCents: 4500, method: 'dinheiro', notes: 'valor conferido' } });
  assert.equal(r.status, 201);
  assert.deepEqual({ k: r.json.estorno.kind, a: r.json.estorno.amountCents, rev: r.json.estorno.reversesPaymentId, on: r.json.estorno.occurredOn }, { k: 'estorno', a: 5000, rev: rec.id, on: D.d3 });
  assert.deepEqual({ k: r.json.pagamento.kind, a: r.json.pagamento.amountCents, m: r.json.pagamento.method, on: r.json.pagamento.occurredOn }, { k: 'recebimento', a: 4500, m: 'dinheiro', on: D.d3 });
  assert.match(r.json.estorno.notes, /^Correção: Digitei o valor e o método errados$/);
  assert.match(r.json.pagamento.notes, new RegExp(`^Correção do recebimento ${rec.id}: valor conferido$`));
  assert.deepEqual({ net: r.json.resumo.netReceivedCents, bal: r.json.resumo.balanceCents }, { net: 4500, bal: 5500 });
  const all = await rows(appt);
  assert.equal(all.length, 3);
  assert.deepEqual({ a: all[0].amount_cents, m: all[0].method, k: all[0].kind }, { a: 5000, m: 'pix', k: 'recebimento' }, 'o original segue intacto');
  const acts = (await owner.query(`SELECT action, reason, actor_id FROM financial_audit_log WHERE entity_id = ANY($1::uuid[]) ORDER BY seq`, [[r.json.estorno.id, r.json.pagamento.id]])).rows;
  assert.deepEqual(acts.map((x) => x.action), ['payment_refund', 'payment_create']);
  assert.equal(acts[0].reason, 'Correção: Digitei o valor e o método errados');
  assert.ok(acts.every((x) => x.actor_id === A.id));
});

dbTest('correção é atômica: se o novo valor ultrapassa o teto, NADA é gravado (nem o estorno)', async () => {
  const A = await mkProf('corr2');
  const appt = await mkAppt(A);
  const rec = (await receive(A, appt, { amountCents: 5000, method: 'pix', occurredOn: D.d5 })).json.pagamento.id;
  const before = await rows(appt);
  const r = await correct(A, rec, { reason: 'novo valor alto demais', occurredOn: D.d3, novo: { amountCents: 10001, method: 'pix' } });
  assert.equal(r.status, 409);
  assert.equal(r.json.reason, 'exceeds_value');
  assert.deepEqual(await rows(appt), before, 'transação desfeita por inteiro');
  const ok = await correct(A, rec, { reason: 'novo valor no limite', occurredOn: D.d3, novo: { amountCents: 10000, method: 'pix' } });
  assert.equal(ok.status, 201);
  assert.equal(await net(appt), 10000);
});

dbTest('correção: idempotente; recebimento já estornado por inteiro não pode ser corrigido; só corrige o saldo de um parcialmente estornado', async () => {
  const A = await mkProf('corr3');
  const appt = await mkAppt(A);
  const rec = (await receive(A, appt, { amountCents: 6000, method: 'pix', occurredOn: D.d5 })).json.pagamento.id;
  await refund(A, rec, { amountCents: 2000, occurredOn: D.d3, reason: 'devolução parcial' });
  const key = k();
  const body = { reason: 'ajuste do restante', occurredOn: D.d1, novo: { amountCents: 3500, method: 'transferencia' } };
  const first = await correct(A, rec, body, key);
  assert.equal(first.status, 201);
  assert.equal(first.json.estorno.amountCents, 4000, 'estorna só o que ainda não tinha sido estornado');
  const again = await correct(A, rec, body, key);
  assert.deepEqual([again.status, again.json.replayed, again.json.estorno.id, again.json.pagamento.id], [200, true, first.json.estorno.id, first.json.pagamento.id]);
  assert.equal((await rows(appt)).length, 4, 'o reenvio não duplicou');
  assert.equal((await correct(A, rec, { ...body, novo: { amountCents: 3600, method: 'transferencia' } }, key)).status, 409, 'mesma chave, pedido diferente');
  const nothing = await correct(A, rec, body);
  assert.equal(nothing.status, 409);
  assert.equal(nothing.json.reason, 'nothing_to_correct');
  assert.equal(await net(appt), 3500);
});

dbTest('correção: validação (motivo, valor, método, datas) e concorrência (4 correções simultâneas do mesmo recebimento: só uma vale)', async () => {
  const A = await mkProf('corr4');
  const appt = await mkAppt(A);
  const rec = (await receive(A, appt, { amountCents: 5000, method: 'pix', occurredOn: D.d5 })).json.pagamento.id;
  const novo = { amountCents: 4000, method: 'dinheiro' };
  const bad = [{ occurredOn: D.d3, novo }, { reason: 'ab', occurredOn: D.d3, novo }, { reason: 'motivo ok', occurredOn: D.d3 }, { reason: 'motivo ok', occurredOn: D.d3, novo: { ...novo, amountCents: 0 } },
    { reason: 'motivo ok', occurredOn: D.d3, novo: { ...novo, method: 'cheque' } }, { reason: 'motivo ok', occurredOn: D.d9, novo }, { reason: 'motivo ok', occurredOn: D.d3, novo: { ...novo, occurredOn: daysAgo(-2) } },
    { reason: 'motivo ok', occurredOn: D.d3, novo, kind: 'recebimento' }];
  for (const b of bad) assert.equal((await correct(A, rec, b)).status, 400, JSON.stringify(b));
  assert.equal((await rows(appt)).length, 1);
  const res = await Promise.all(Array.from({ length: 4 }, () => correct(A, rec, { reason: 'correção simultânea', occurredOn: D.d3, novo })));
  assert.equal(res.filter((r) => r.status === 201).length, 1);
  assert.ok(res.filter((r) => r.status !== 201).every((r) => r.status === 409 && r.json.reason === 'nothing_to_correct'), res.map((r) => `${r.status}:${r.json.reason}`).join());
  assert.equal(await net(appt), 4000);
});

// ── isolamento ──────────────────────────────────────────────────────────────
dbTest('isolamento entre profissionais: a outra conta não vê, não recebe, não estorna e não corrige (404, sem vazar)', async () => {
  const A = await mkProf('isoA');
  const B = await mkProf('isoB');
  const apptA = await mkAppt(A);
  const apptB = await mkAppt(B);
  const recA = (await receive(A, apptA, { amountCents: 5000, method: 'pix', occurredOn: D.d5 })).json.pagamento.id;
  const before = await rows(apptA);
  const notFound = (r) => { assert.equal(r.status, 404); assert.equal(r.json.reason, 'not_found'); };
  notFound(await summary(B, apptA));
  notFound(await receive(B, apptA, { amountCents: 100, method: 'pix', occurredOn: D.d1 }));
  notFound(await refund(B, recA, { amountCents: 100, occurredOn: D.d3, reason: 'invasão' }));
  notFound(await correct(B, recA, { reason: 'invasão', occurredOn: D.d3, novo: { amountCents: 1, method: 'pix' } }));
  assert.deepEqual(await rows(apptA), before);
  // a resposta de "não existe" é igual à de "é de outra conta"
  const ghost = await summary(B, randomUUID());
  assert.deepEqual({ s: ghost.status, e: ghost.json.error }, { s: 404, e: (await summary(B, apptA)).json.error });
  // cada uma só enxerga o que é seu
  assert.equal((await summary(B, apptB)).json.movimentacoes.length, 0);
  assert.equal((await summary(A, apptA)).json.movimentacoes.length, 1);
});

// ── dia fechado ─────────────────────────────────────────────────────────────
dbTest('dia fechado no caixa: recebimento, estorno e correção naquela data são recusados (409) e nada é gravado; reaberto, volta a valer', async () => {
  const A = await mkProf('caixa');
  const appt = await mkAppt(A);
  const rec = (await receive(A, appt, { amountCents: 5000, method: 'pix', occurredOn: D.d9 })).json.pagamento.id;
  await owner.query(`INSERT INTO cash_closings (professional_id, closing_date, received_cents) VALUES ($1, $2, 5000)`, [A.id, D.d5]);
  const before = await rows(appt);
  const r1 = await receive(A, appt, { amountCents: 100, method: 'pix', occurredOn: D.d5 });
  assert.deepEqual([r1.status, r1.json.reason], [409, 'day_closed']);
  const r2 = await refund(A, rec, { amountCents: 100, occurredOn: D.d5, reason: 'em dia fechado' });
  assert.deepEqual([r2.status, r2.json.reason], [409, 'day_closed']);
  const r3 = await correct(A, rec, { reason: 'novo em dia fechado', occurredOn: D.d3, novo: { amountCents: 4000, method: 'pix', occurredOn: D.d5 } });
  assert.deepEqual([r3.status, r3.json.reason], [409, 'day_closed']);
  const r4 = await correct(A, rec, { reason: 'estorno em dia fechado', occurredOn: D.d5, novo: { amountCents: 4000, method: 'pix', occurredOn: D.d3 } });
  assert.deepEqual([r4.status, r4.json.reason], [409, 'day_closed']);
  assert.deepEqual(await rows(appt), before, 'nada foi gravado (a correção é atômica)');
  assert.equal((await receive(A, appt, { amountCents: 100, method: 'pix', occurredOn: D.d3 })).status, 201, 'outro dia segue livre');
  await owner.query(`UPDATE cash_closings SET status = 'aberto', reopen_reason = 'Conferência de teste' WHERE professional_id = $1 AND closing_date = $2`, [A.id, D.d5]);
  assert.equal((await receive(A, appt, { amountCents: 100, method: 'pix', occurredOn: D.d5 })).status, 201, 'reaberto, aceita');
});

// ── nada é alterado em silêncio ─────────────────────────────────────────────
dbTest('não há rota nem privilégio para editar ou apagar movimentação (append-only)', async () => {
  const A = await mkProf('imut');
  const appt = await mkAppt(A);
  const rec = (await receive(A, appt, { amountCents: 5000, method: 'pix', occurredOn: D.d5 })).json.pagamento.id;
  for (const [m, p] of [['PUT', `/financeiro/pagamentos/${rec}`], ['PATCH', `/financeiro/pagamentos/${rec}`], ['DELETE', `/financeiro/pagamentos/${rec}`], ['DELETE', `/financeiro/atendimentos/${appt}/pagamentos`]]) {
    const r = await api(m, p, { as: A, body: m === 'DELETE' ? undefined : { amountCents: 1 } });
    assert.equal(r.status, 404, `${m} ${p}`);
  }
  for (const sql of [`UPDATE financial_payments SET amount_cents = 1 WHERE id = '${rec}'`, `DELETE FROM financial_payments WHERE id = '${rec}'`, 'TRUNCATE financial_payments']) {
    await assert.rejects(appPool.query(sql), (e) => { assert.equal(e.code, '42501', sql); return true; });
  }
  assert.equal((await rows(appt)).length, 1);
});

// ── Agenda × financeiro ─────────────────────────────────────────────────────
dbTest('Agenda: atendimento com recebimento não deixa de estar concluído; depois de estornar tudo, pode; observações seguem livres', async () => {
  const A = await mkProf('agenda');
  const appt = await mkAppt(A);
  const rec = (await receive(A, appt, { amountCents: 4000, method: 'pix', occurredOn: D.d5 })).json.pagamento.id;
  for (const status of ['pendente', 'nao_compareceu']) {
    const r = await api('PUT', `/appointments/${appt}`, { as: A, body: { status } });
    assert.equal(r.status, 409, status);
    assert.equal(r.json.reason, 'has_payments', status);
  }
  assert.equal((await one(`SELECT status FROM appointments WHERE id = $1`, [appt])).status, 'concluido');
  assert.equal((await api('PUT', `/appointments/${appt}`, { as: A, body: { notes: 'observação livre' } })).status, 200);
  assert.equal((await api('PUT', `/appointments/${appt}`, { as: A, body: { status: 'concluido' } })).status, 200, 'manter concluído é aceito');
  assert.equal((await api('DELETE', `/appointments/${appt}`, { as: A })).status, 409, 'concluído não cancela');
  await refund(A, rec, { amountCents: 4000, occurredOn: D.d3, reason: 'devolução total' });
  assert.equal(await net(appt), 0);
  const free = await api('PUT', `/appointments/${appt}`, { as: A, body: { status: 'nao_compareceu' } });
  assert.equal(free.status, 200, 'sem recebimento líquido, a Agenda pode corrigir o status');
  const rr = await receive(A, appt, { amountCents: 100, method: 'pix', occurredOn: D.d1 });
  assert.deepEqual([rr.status, rr.json.reason], [409, 'not_completed'], 'e o financeiro volta a recusar');
});

dbTest('Agenda × recebimento simultâneos: ou o recebimento entra e o status fica concluído, ou o status muda e o recebimento é recusado', async () => {
  const A = await mkProf('corrida');
  for (let i = 0; i < 6; i++) {
    const appt = await mkAppt(A);
    const [pay, put] = await Promise.all([
      receive(A, appt, { amountCents: 1000, method: 'pix', occurredOn: D.d1 }),
      api('PUT', `/appointments/${appt}`, { as: A, body: { status: 'nao_compareceu' } }),
    ]);
    const st = (await one(`SELECT status FROM appointments WHERE id = $1`, [appt])).status;
    const n = await net(appt);
    if (pay.status === 201) { assert.equal(st, 'concluido', `rodada ${i}: recebeu e mudou status`); assert.equal(put.status, 409); assert.equal(n, 1000); }
    else { assert.equal(pay.status, 409); assert.equal(put.status, 200); assert.equal(st, 'nao_compareceu'); assert.equal(n, 0); }
  }
});

// ── exclusão ────────────────────────────────────────────────────────────────
dbTest('exclusão: atendimento com recebimento não pode ser apagado (FK); excluir a conta apaga tudo da conta e só dela', async () => {
  const A = await mkProf('del');
  const B = await mkProf('delB');
  const apptA = await mkAppt(A);
  const apptB = await mkAppt(B);
  await receive(A, apptA, { amountCents: 3000, method: 'pix', occurredOn: D.d3 });
  await receive(B, apptB, { amountCents: 2000, method: 'pix', occurredOn: D.d3 });
  await assert.rejects(appPool.query(`DELETE FROM appointments WHERE id = $1`, [apptA]), (e) => { assert.equal(e.code, '23503'); return true; });
  assert.equal((await rows(apptA)).length, 1);
  await owner.query(`DELETE FROM professionals WHERE id = $1`, [A.id]);
  assert.equal(await count(`SELECT count(*)::int AS n FROM financial_payments WHERE professional_id = '${A.id}'`), 0);
  assert.equal((await rows(apptB)).length, 1, 'a outra conta fica intacta');
});

// ── migration 026 ───────────────────────────────────────────────────────────
dbTest('026: rollback aborta se há recebimento por transferência; sem uso, volta a recusar; reaplicar volta a aceitar', async () => {
  const A = await mkProf('m026');
  const appt = await mkAppt(A);
  assert.equal((await receive(A, appt, { amountCents: 1000, method: 'transferencia', occurredOn: D.d1 })).status, 201);
  await assert.rejects(db.runFile(DOWN26), /rollback 026 abortado: \d+ movimentação/);
  assert.match((await one(`SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conname = 'financial_payments_method_check'`)).d, /transferencia/, 'nada foi alterado');
  // sem nenhuma movimentação por transferência (as contas de teste e suas movimentações saem pela cascata da conta)
  await owner.query(`DELETE FROM professionals WHERE email LIKE $1`, [EMAIL_LIKE]);
  await db.runFile(DOWN26);
  await db.runFile(DOWN26); // idempotente
  const B = await mkProf('m026b');
  const apptB = await mkAppt(B);
  await assert.rejects(owner.query(`INSERT INTO financial_payments (professional_id, appointment_id, kind, amount_cents, method, occurred_on) VALUES ($1, $2, 'recebimento', 100, 'transferencia', $3)`, [B.id, apptB, D.d1]),
    (e) => { assert.equal(e.code, '23514'); assert.match(e.message, /method_check/); return true; });
  assert.equal((await receive(B, apptB, { amountCents: 100, method: 'pix', occurredOn: D.d1 })).status, 503, 'sem a 026 a API recusa por inteiro (estrutura incompleta)');
  await db.runFile(UP26);
  assert.equal((await receive(B, apptB, { amountCents: 100, method: 'transferencia', occurredOn: D.d1 })).status, 201);
});
