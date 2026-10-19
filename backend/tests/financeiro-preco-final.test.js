// Financeiro, etapa 3: finalização na Agenda com preço final, histórico com justificativa, piso (preço final >= líquido recebido) e
// limites também no banco (migration 027). Só as regras NOVAS ou ALTERADAS; as da etapa 2 ficam em financeiro-pagamentos.test.js.
// API HTTP real, role NÃO-DONA, banco DESCARTÁVEL (FINANCEIRO_PRECO_TEST_DB_URL, um banco só para este arquivo; ver helpers/financeTestDb.js).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import pg from 'pg';
import { resolveFinanceTestDb, financeDb } from './helpers/financeTestDb.js';
import { todayInBusinessTz } from '../src/utils/financeiroPagamentos.js';

const VAR = 'FINANCEIRO_PRECO_TEST_DB_URL';
const EMAIL_LIKE = 'fin-prc-%@nf.test';
const ROLE = 'nf_fin_prc_app';
const UP26 = '026_financeiro_pagamentos_metodo.sql';
const UP27 = '027_financeiro_limites_banco.sql';
const DOWN27 = '_rollback/027_financeiro_limites_banco.down.sql';
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
const D = { d1: daysAgo(1), d3: daysAgo(3), d5: daysAgo(5) };
const one = async (sql, params) => (await owner.query(sql, params)).rows[0];
const count = async (sql, params) => (await one(sql, params)).n;

async function mkProf(tag) {
  const id = randomUUID();
  await owner.query(`INSERT INTO professionals (id, name, email, password_hash, slug, business_name) VALUES ($1, $2, $3, 'x', $4, $5)`,
    [id, `Prc ${tag}`, `fin-prc-${tag}-${id.slice(0, 8)}@nf.test`, `fin-prc-${tag}-${id.slice(0, 8)}`, `Studio ${tag}`]);
  const svc = (await one(`INSERT INTO services (professional_id, name, price_cents, duration_minutes) VALUES ($1, 'Manicure', 10000, 60) RETURNING id`, [id])).id;
  const cli = (await one(`INSERT INTO clients (professional_id, name, phone) VALUES ($1, 'Cliente', $2) RETURNING id`, [id, `5531${String(300000000 + Math.floor(Math.random() * 1e8))}`])).id;
  return { id, svc, cli, token: jwt.sign({ sub: id, ver: 1 }, secret, { expiresIn: '1h' }) };
}
/** Atendimento no passado (a Agenda aceita concluir), no status pedido, preço 10000. */
async function mkAppt(p, { status = 'confirmado', deposit = null } = {}) {
  const start = new Date(Date.UTC(2026, 0, 1 + (++dayN), 12, 0, 0));
  return (await one(`INSERT INTO appointments (professional_id, client_id, service_id, starts_at, ends_at, status, price_cents_snapshot, deposit_cents)
      VALUES ($1, $2, $3, $4, $5, $6, 10000, $7) RETURNING id`, [p.id, p.cli, p.svc, start, new Date(start.getTime() + 3600_000), status, deposit])).id;
}
async function api(method, path, { as, body, key } = {}) {
  const h = {};
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
const agenda = (p, appt, body) => api('PUT', `/appointments/${appt}`, { as: p, body });
const preco = (p, appt, body) => api('PUT', `/financeiro/atendimentos/${appt}/preco-final`, { as: p, body });
const receive = (p, appt, amountCents) => api('POST', `/financeiro/atendimentos/${appt}/pagamentos`, { as: p, key: k(), body: { amountCents, method: 'pix', occurredOn: D.d3 } });
const refund = (p, payId, amountCents) => api('POST', `/financeiro/pagamentos/${payId}/estornos`, { as: p, key: k(), body: { amountCents, occurredOn: D.d1, reason: 'estorno de teste' } });
const summary = (p, appt) => api('GET', `/financeiro/atendimentos/${appt}/pagamentos`, { as: p });
const apptRow = (id) => one(`SELECT status, final_price_cents, final_price_set_at, notes FROM appointments WHERE id = $1`, [id]);
const payCount = (appt) => count(`SELECT count(*)::int AS n FROM financial_payments WHERE appointment_id = $1`, [appt]);
const direct = (p, appt, cents, kind = 'recebimento', extra = {}) => owner.query(
  `INSERT INTO financial_payments (professional_id, appointment_id, kind, amount_cents, method, occurred_on, source, reverses_payment_id, notes)
   VALUES ($1, $2, $3, $4, 'pix', $5, $6, $7, $8) RETURNING id`, [p.id, appt, kind, cents, D.d3, extra.source ?? 'manual', extra.reverses ?? null, extra.notes ?? null]);

before(async () => {
  const r = await resolveFinanceTestDb(process.env, VAR);
  if (r.skip) { skip = r.skip; return; }
  owner = new pg.Pool({ connectionString: r.url, options: '-c TimeZone=UTC', max: 10 });
  owner.on('error', () => {});
  db = financeDb(owner);
  await db.reset({ emailLike: EMAIL_LIKE, roles: [ROLE] });
  await db.createAppRole(ROLE);
  await db.up();                       // 025
  await db.runFile(UP26);
  await db.runFile(UP27);
  await db.grant(ROLE);
  secret = 'fin-prc-test-secret';
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

// ── concluir não é pagar ────────────────────────────────────────────────────
dbTest('concluir na Agenda NÃO registra pagamento: recebido 0, saldo = valor do serviço, sem preço final', async () => {
  const A = await mkProf('concluir');
  const appt = await mkAppt(A);
  const r = await agenda(A, appt, { status: 'concluido' });
  assert.equal(r.status, 200);
  assert.deepEqual({ st: r.json.status, fp: r.json.finalPriceCents }, { st: 'concluido', fp: null });
  assert.equal(await payCount(appt), 0);
  const s = (await summary(A, appt)).json;
  assert.deepEqual({ rec: s.receivedCents, bal: s.balanceCents, basis: s.valueBasis, can: s.canReceive, hist: s.finalPriceHistory.length }, { rec: 0, bal: 10000, basis: 'servico', can: true, hist: 0 });
});

dbTest('concluir com preço final: justificativa obrigatória se difere do serviço; tudo ou nada; histórico com autor e motivo', async () => {
  const A = await mkProf('final');
  const appt = await mkAppt(A);
  const semMotivo = await agenda(A, appt, { status: 'concluido', finalPriceCents: 8000 });
  assert.deepEqual([semMotivo.status, semMotivo.json.reason], [400, 'reason_required']);
  assert.deepEqual(await apptRow(appt).then((x) => [x.status, x.final_price_cents]), ['confirmado', null], 'recusado: a conclusão também não aconteceu');
  const ok = await agenda(A, appt, { status: 'concluido', finalPriceCents: 8000, finalPriceReason: 'Desconto combinado com a cliente', notes: 'ok' });
  assert.equal(ok.status, 200);
  assert.deepEqual({ st: ok.json.status, fp: ok.json.finalPriceCents, n: ok.json.notes }, { st: 'concluido', fp: 8000, n: 'ok' });
  const s = (await summary(A, appt)).json;
  assert.deepEqual({ v: s.valueCents, b: s.valueBasis, rec: s.receivedCents, bal: s.balanceCents }, { v: 8000, b: 'final', rec: 0, bal: 8000 });
  assert.deepEqual(s.finalPriceHistory.map((h) => [h.fromCents, h.toCents, h.reason]), [[null, 8000, 'Desconto combinado com a cliente']]);
  const audit = await one(`SELECT actor_id, reason FROM financial_audit_log WHERE entity_id = $1 AND action = 'appointment_final_price'`, [appt]);
  assert.deepEqual(audit, { actor_id: A.id, reason: 'Desconto combinado com a cliente' });
  assert.equal(await payCount(appt), 0, 'definir o preço final não registra pagamento');
  // igual ao preço do serviço, na primeira definição, não exige justificativa
  const igual = await mkAppt(A);
  assert.equal((await agenda(A, igual, { status: 'concluido', finalPriceCents: 10000 })).status, 200);
});

dbTest('preço final só com o atendimento concluído; Financeiro desligado recusa o preço mas a Agenda segue como antes', async () => {
  const A = await mkProf('regras');
  const a1 = await mkAppt(A);
  const r = await agenda(A, a1, { status: 'confirmado', finalPriceCents: 9000, finalPriceReason: 'não pode ainda' });
  assert.deepEqual([r.status, r.json.reason], [409, 'not_completed']);
  assert.equal((await apptRow(a1)).final_price_cents, null);
  const a2 = await mkAppt(A);
  process.env.FINANCEIRO_PAGAMENTOS_ENABLED = 'false';
  try {
    const off = await agenda(A, a2, { status: 'concluido', finalPriceCents: 9000, finalPriceReason: 'financeiro desligado' });
    assert.deepEqual([off.status, off.json.reason], [409, 'financeiro_indisponivel']);
    assert.equal((await apptRow(a2)).status, 'confirmado', 'nada mudou');
    const plain = await agenda(A, a2, { status: 'concluido', notes: 'comportamento de sempre' });
    assert.equal(plain.status, 200, 'sem preço final a Agenda funciona igual, com o Financeiro desligado');
    assert.equal(plain.json.finalPriceCents, null);
  } finally { process.env.FINANCEIRO_PAGAMENTOS_ENABLED = 'true'; }
  // campos inválidos na Agenda
  const a3 = await mkAppt(A);
  for (const body of [{ finalPriceCents: -1 }, { finalPriceCents: 10.5 }, { finalPriceCents: '100' }, { finalPriceCents: 10_000_001 }, { finalPriceCents: 5000, finalPriceReason: 'ab' }]) {
    assert.equal((await agenda(A, a3, { status: 'concluido', ...body })).status, 400, JSON.stringify(body));
  }
  assert.equal((await apptRow(a3)).status, 'confirmado');
});

// ── rota do preço final ─────────────────────────────────────────────────────
dbTest('PUT preco-final: define e altera com justificativa e histórico; mesmo valor não muda nada; validação e isolamento', async () => {
  const A = await mkProf('rota');
  const B = await mkProf('rotaB');
  const appt = await mkAppt(A, { status: 'concluido' });
  const first = await preco(A, appt, { finalPriceCents: 8000, reason: 'Desconto' });
  assert.deepEqual([first.status, first.json.changed, first.json.resumo.valueCents, first.json.resumo.valueBasis], [200, true, 8000, 'final']);
  const semMotivo = await preco(A, appt, { finalPriceCents: 7000 });
  assert.deepEqual([semMotivo.status, semMotivo.json.reason], [400, 'reason_required']);
  assert.equal((await preco(A, appt, { finalPriceCents: 7000, reason: 'Corrigi o valor' })).status, 200);
  const same = await preco(A, appt, { finalPriceCents: 7000, reason: 'mesmo valor de novo' });
  assert.deepEqual([same.status, same.json.changed], [200, false]);
  const hist = (await summary(A, appt)).json.finalPriceHistory;
  assert.deepEqual(hist.map((h) => [h.fromCents, h.toCents, h.reason]), [[null, 8000, 'Desconto'], [8000, 7000, 'Corrigi o valor']], 'o histórico preserva cada alteração');
  const igual = await mkAppt(A, { status: 'concluido' });
  assert.equal((await preco(A, igual, { finalPriceCents: 10000 })).json.changed, true, 'primeira definição igual ao serviço dispensa justificativa');
  const naoConcluido = await mkAppt(A, { status: 'confirmado' });
  assert.deepEqual(await preco(A, naoConcluido, { finalPriceCents: 5000, reason: 'ainda não concluiu' }).then((r) => [r.status, r.json.reason]), [409, 'not_completed']);
  for (const body of [{ finalPriceCents: -1 }, { finalPriceCents: 10.5 }, { finalPriceCents: '100' }, { finalPriceCents: 10_000_001 }, { reason: 'sem valor' },
    { finalPriceCents: 5000, reason: 'ab' }, { finalPriceCents: 5000, reason: 'ok motivo', professionalId: A.id }, {}]) {
    assert.equal((await preco(A, appt, body)).status, 400, JSON.stringify(body));
  }
  assert.equal((await preco(B, appt, { finalPriceCents: 1000, reason: 'invasão' })).status, 404, 'outra conta: como se não existisse');
  assert.equal((await api('PUT', `/financeiro/atendimentos/${appt}/preco-final`, { body: { finalPriceCents: 1, reason: 'sem sessão' } })).status, 401);
  assert.equal((await apptRow(appt)).final_price_cents, 7000);
});

// ── piso: nunca abaixo do líquido recebido ──────────────────────────────────
dbTest('piso: o preço final não fica abaixo do líquido recebido; estorno libera; o teto passa a ser o novo valor', async () => {
  const A = await mkProf('piso');
  const appt = await mkAppt(A, { status: 'concluido' });
  const rec = (await receive(A, appt, 6000)).json.pagamento.id;
  const below = await preco(A, appt, { finalPriceCents: 5999, reason: 'abaixo do recebido' });
  assert.deepEqual([below.status, below.json.reason, below.json.netReceivedCents], [409, 'below_received', 6000]);
  assert.equal((await apptRow(appt)).final_price_cents, null, 'nada foi gravado');
  assert.equal((await preco(A, appt, { finalPriceCents: 6000, reason: 'igual ao recebido' })).status, 200, 'igual ao líquido é permitido');
  const over = await receive(A, appt, 1);
  assert.deepEqual([over.status, over.json.reason], [409, 'exceeds_value'], 'o teto agora é o valor final');
  assert.equal((await refund(A, rec, 2000)).status, 201);                       // líquido 4000
  assert.equal((await preco(A, appt, { finalPriceCents: 4000, reason: 'segundo ajuste' })).status, 200);
  assert.equal((await preco(A, appt, { finalPriceCents: 0, reason: 'cortesia' })).status, 409, 'líquido 4000 > 0');
  assert.equal((await refund(A, rec, 4000)).status, 201);                       // líquido 0
  assert.equal((await preco(A, appt, { finalPriceCents: 0, reason: 'cortesia' })).status, 200);
  assert.deepEqual(await receive(A, appt, 1).then((r) => [r.status, r.json.reason]), [409, 'exceeds_value']);
});

dbTest('piso pela Agenda: PUT recusado não grava NADA (nem as observações enviadas junto)', async () => {
  const A = await mkProf('pisoAgenda');
  const appt = await mkAppt(A, { status: 'concluido' });
  await receive(A, appt, 5000);
  const r = await agenda(A, appt, { notes: 'não deve gravar', finalPriceCents: 3000, finalPriceReason: 'abaixo do recebido' });
  assert.deepEqual([r.status, r.json.reason, r.json.netReceivedCents], [409, 'below_received', 5000]);
  const row = await apptRow(appt);
  assert.deepEqual([row.final_price_cents, row.notes], [null, null]);
  const ok = await agenda(A, appt, { finalPriceCents: 5000, finalPriceReason: 'igual ao recebido', notes: 'grava' });
  assert.deepEqual([ok.status, ok.json.finalPriceCents, ok.json.notes], [200, 5000, 'grava']);
});

dbTest('concorrência: receber e baixar o preço final ao mesmo tempo nunca deixa líquido > valor', async () => {
  const A = await mkProf('corrida');
  for (let i = 0; i < 6; i++) {
    const appt = await mkAppt(A, { status: 'concluido' });
    const [pay, fp] = await Promise.all([receive(A, appt, 6000), preco(A, appt, { finalPriceCents: 5000, reason: 'ajuste simultâneo' })]);
    const row = await apptRow(appt);
    const net = (await one(`SELECT COALESCE(SUM(CASE WHEN kind = 'recebimento' THEN amount_cents ELSE -amount_cents END), 0)::int AS n FROM financial_payments WHERE appointment_id = $1`, [appt])).n;
    const value = row.final_price_cents ?? 10000;
    assert.ok(net <= value, `rodada ${i}: líquido ${net} > valor ${value}`);
    assert.notDeepEqual([pay.status, fp.status], [201, 200], `rodada ${i}: as duas não podem valer juntas`);
    assert.ok([pay.status, fp.status].some((s) => s === 201 || s === 200), `rodada ${i}: uma delas deveria valer`);
  }
});

// ── limites no banco (migration 027), com SQL direto, sem passar pela API ───
dbTest('banco: recebimento que ultrapassa o valor é recusado mesmo por SQL direto; simultâneos são serializados; valor final conta', async () => {
  const A = await mkProf('bancoCap');
  const appt = await mkAppt(A, { status: 'concluido', deposit: 3000 });
  const tooMuch = (e) => { assert.equal(e.code, '23514'); assert.match(e.message, /excederia o valor do serviço/); return true; };
  await assert.rejects(direct(A, appt, 10001), tooMuch);
  const first = (await direct(A, appt, 6000)).rows[0].id;
  await assert.rejects(direct(A, appt, 4001), tooMuch);
  await direct(A, appt, 4000);
  await assert.rejects(direct(A, appt, 1), tooMuch);
  await direct(A, appt, 1000, 'estorno', { reverses: first, notes: 'estorno direto' });          // estorno nunca é barrado pelo teto
  await direct(A, appt, 1000);                                                                    // e libera saldo
  await assert.rejects(direct(A, appt, 1), tooMuch);
  // simultâneos por SQL direto (sem a trava da API): exatamente 3 de 3000 em 10000
  const B = await mkAppt(A, { status: 'concluido' });
  const res = await Promise.allSettled(Array.from({ length: 8 }, () => direct(A, B, 3000)));
  assert.equal(res.filter((r) => r.status === 'fulfilled').length, 3);
  assert.ok(res.filter((r) => r.status === 'rejected').every((r) => r.reason.code === '23514'));
  assert.equal((await one(`SELECT SUM(amount_cents)::int AS n FROM financial_payments WHERE appointment_id = $1`, [B])).n, 9000);
  // o valor final entra na conta
  const C = await mkAppt(A, { status: 'concluido' });
  await owner.query(`UPDATE appointments SET final_price_cents = 5000 WHERE id = $1`, [C]);
  await assert.rejects(direct(A, C, 5001), tooMuch);
  await direct(A, C, 5000);
  // sinal Pix confirmado também conta (5000 do final já recebidos => o sinal de 3000 estoura)
  await assert.rejects(direct(A, C, 3000, 'recebimento', { source: 'sinal_pix_confirmado' }), tooMuch);
});

dbTest('banco: o valor do atendimento não desce abaixo do líquido recebido, por nenhuma via; outras atualizações seguem livres', async () => {
  const A = await mkProf('bancoFloor');
  const appt = await mkAppt(A, { status: 'concluido' });
  await direct(A, appt, 6000);
  const below = (e) => { assert.equal(e.code, '23514'); assert.match(e.message, /abaixo do líquido/); return true; };
  await assert.rejects(owner.query(`UPDATE appointments SET final_price_cents = 5999 WHERE id = $1`, [appt]), below);
  await assert.rejects(owner.query(`UPDATE appointments SET price_cents_snapshot = 5999 WHERE id = $1`, [appt]), below);
  await assert.rejects(appPool.query(`UPDATE appointments SET price_cents_snapshot = 100 WHERE id = $1`, [appt]), below, 'nem pela role da aplicação');
  await owner.query(`UPDATE appointments SET final_price_cents = 6000 WHERE id = $1`, [appt]);
  // limpar o valor final cai no preço do serviço (a 025 exige motivo para mexer num valor final já definido)
  const c = await owner.connect();
  try {
    await c.query('BEGIN');
    await c.query(`SELECT set_config('nailflow.audit_reason', 'teste do piso', true)`);
    await assert.rejects(c.query(`UPDATE appointments SET final_price_cents = NULL, price_cents_snapshot = 5000 WHERE id = $1`, [appt]), below);
  } finally { await c.query('ROLLBACK').catch(() => {}); c.release(); }
  await owner.query(`UPDATE appointments SET notes = 'segue livre', status = 'concluido' WHERE id = $1`, [appt]);
  const noPayments = await mkAppt(A, { status: 'confirmado' });
  await owner.query(`UPDATE appointments SET price_cents_snapshot = 1 WHERE id = $1`, [noPayments]);   // sem recebimento: livre
  assert.equal((await apptRow(appt)).final_price_cents, 6000);
});

// ── migration 027 ───────────────────────────────────────────────────────────
dbTest('027: idempotente; o rollback remove só os dois gatilhos (dados intactos) e é idempotente; reaplicar volta a proteger', async () => {
  const A = await mkProf('m027');
  const appt = await mkAppt(A, { status: 'concluido' });
  await direct(A, appt, 10000);
  await db.runFile(UP27);                               // reaplicar não muda nada
  await assert.rejects(direct(A, appt, 1), (e) => e.code === '23514');
  const before = await count(`SELECT count(*)::int AS n FROM financial_payments WHERE appointment_id = '${appt}'`);
  await db.runFile(DOWN27);
  await db.runFile(DOWN27);
  assert.equal(await count(`SELECT count(*)::int AS n FROM pg_trigger WHERE tgname IN ('trg_financial_payments_cap', 'trg_appointments_fin_value_floor')`), 0);
  assert.equal(await count(`SELECT count(*)::int AS n FROM pg_proc WHERE proname IN ('fin_payments_cap_guard', 'fin_appointments_value_floor')`), 0);
  assert.equal(await count(`SELECT count(*)::int AS n FROM financial_payments WHERE appointment_id = '${appt}'`), before, 'dados intactos');
  assert.equal(await count(`SELECT count(*)::int AS n FROM pg_trigger WHERE tgname = 'trg_financial_payments_guard'`), 1, 'a 025 segue inteira');
  await direct(A, appt, 1);                             // sem a 027 o banco já não barra (a API barra)
  await db.runFile(UP27);
  await assert.rejects(direct(A, appt, 1), (e) => e.code === '23514', 'reaplicada, volta a barrar (o dado antigo acima do valor não é revisado)');
});

// ── mapeamento dos erros dos gatilhos da 027 pela API ───────────────────────
// A API confere o saldo ANTES de gravar, então o erro do banco só aparece se essa leitura estiver desatualizada (outro escritor, corrida).
// Para exercitar o mapeamento com o erro REAL do banco, a consulta de saldo da API é falseada (devolve 0) só dentro do teste.
const STALE = { active: false, received: 0, net: 0 };
async function withStaleBalance(fn) {
  const realConnect = appPool.connect.bind(appPool);
  const state = STALE;                            // estado ÚNICO: clientes reutilizados do pool não guardam o de uma chamada anterior
  state.active = true; state.received = 0; state.net = 0;
  const patch = (c) => {
    if (c.__stale) return c;                      // o cliente volta ao pool: o desvio fica inerte quando state.active é falso
    c.__stale = true;
    const q = c.query.bind(c);
    c.query = (text, params, cb) => {
      if (state.active && typeof text === 'string') {
        if (text.includes("FILTER (WHERE kind = 'recebimento')")) { state.received += 1; return Promise.resolve({ rows: [{ received: 0, refunded: 0 }] }); }
        if (text.includes('FROM financial_payments') && text.includes("CASE WHEN kind = 'recebimento' THEN amount_cents ELSE -amount_cents END")) { state.net += 1; return Promise.resolve({ rows: [{ net: 0 }] }); }
      }
      return q(text, params, cb);
    };
    return c;
  };
  // pool.query do pg chama connect(callback); o código da aplicação usa connect() com await: as duas formas precisam funcionar
  appPool.connect = (cb) => (typeof cb === 'function'
    ? realConnect((err, c, done) => cb(err, c ? patch(c) : c, done))
    : realConnect().then(patch));
  try { return await fn(state); } finally { state.active = false; appPool.connect = realConnect; }
}

dbTest('mapeamento 027: teto do banco vira 409 exceeds_value (e não 500) pela API de recebimento', async () => {
  const A = await mkProf('mapTeto');
  const appt = await mkAppt(A, { status: 'concluido' });
  assert.equal((await receive(A, appt, 6000)).status, 201);
  await withStaleBalance(async (hits) => {
    const r = await receive(A, appt, 5000);                       // a API "acha" que o líquido é 0; o banco sabe que é 6000
    assert.ok(hits.received > 0, 'a leitura de saldo foi realmente falseada');
    assert.deepEqual([r.status, r.json.reason], [409, 'exceeds_value']);
  });
  assert.equal(await payCount(appt), 1, 'o banco recusou: nada foi gravado');
});

dbTest('mapeamento 027: piso do banco vira 409 below_received (e não 500) na rota do preço final e na Agenda', async () => {
  const A = await mkProf('mapPiso');
  const appt = await mkAppt(A, { status: 'concluido' });
  assert.equal((await receive(A, appt, 6000)).status, 201);
  await withStaleBalance(async (hits) => {
    const viaRota = await preco(A, appt, { finalPriceCents: 5000, reason: 'abaixo do recebido' });
    assert.ok(hits.net > 0, 'a leitura de saldo foi realmente falseada');
    assert.deepEqual([viaRota.status, viaRota.json.reason], [409, 'below_received']);
    const viaAgenda = await agenda(A, appt, { notes: 'não deve gravar', finalPriceCents: 5000, finalPriceReason: 'abaixo do recebido' });
    assert.deepEqual([viaAgenda.status, viaAgenda.json.reason], [409, 'below_received']);
  });
  const row = await apptRow(appt);
  assert.deepEqual([row.final_price_cents, row.notes], [null, null], 'o banco recusou: nada foi gravado');
});
