// Financeiro, etapa 5: fechamento de caixa por método (esperado x contado), justificativa, reabertura com motivo, histórico por versão,
// períodos fechados e concorrência. Só as regras NOVAS; recebimentos/estornos/despesas ficam nos arquivos das etapas 2 a 4.
// API HTTP real, role NÃO-DONA, banco DESCARTÁVEL (FINANCEIRO_CAIXA_TEST_DB_URL, um banco só para este arquivo; ver helpers/financeTestDb.js).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import pg from 'pg';
import { resolveFinanceTestDb, financeDb, psqlScript, readSql } from './helpers/financeTestDb.js';
import { todayInBusinessTz } from '../src/utils/financeiroPagamentos.js';

const VAR = 'FINANCEIRO_CAIXA_TEST_DB_URL';
const EMAIL_LIKE = 'fin-cax-%@nf.test';
const ROLE = 'nf_fin_cax_app';
const UPS = ['026_financeiro_pagamentos_metodo.sql', '027_financeiro_limites_banco.sql', '028_financeiro_despesas.sql', '029_financeiro_fechamento_caixa.sql'];
const DOWN28 = '_rollback/028_financeiro_despesas.down.sql';
const DOWN29 = '_rollback/029_financeiro_fechamento_caixa.down.sql';
const T = { timeout: 180_000 };

let skip = false;
let owner;
let db;
let server;
let baseUrl;
let appPool;
let secret;
let seq = 0;

const today = todayInBusinessTz();
const daysAgo = (n) => { const d = new Date(`${today}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };
const D = daysAgo(3);
const one = async (sql, params) => (await owner.query(sql, params)).rows[0];
const count = async (sql, params) => (await one(sql, params)).n;
const METHODS = ['pix', 'dinheiro', 'cartao_debito', 'cartao_credito', 'transferencia', 'outra'];
const countedOf = (over = {}) => ({ pix: 0, dinheiro: 0, cartao_debito: 0, cartao_credito: 0, transferencia: 0, outra: 0, ...over });

async function mkProf(tag) {
  const id = randomUUID();
  await owner.query(`INSERT INTO professionals (id, name, email, password_hash, slug, business_name) VALUES ($1, $2, $3, 'x', $4, $5)`,
    [id, `Cax ${tag}`, `fin-cax-${tag}-${id.slice(0, 8)}@nf.test`, `fin-cax-${tag}-${id.slice(0, 8)}`, `Studio ${tag}`]);
  const svc = (await one(`INSERT INTO services (professional_id, name, price_cents, duration_minutes) VALUES ($1, 'Manicure', 10000, 60) RETURNING id`, [id])).id;
  const cli = (await one(`INSERT INTO clients (professional_id, name, phone) VALUES ($1, 'Cliente', $2) RETURNING id`, [id, `5531${String(600000000 + Math.floor(Math.random() * 1e8))}`])).id;
  return { id, svc, cli, token: jwt.sign({ sub: id, ver: 1 }, secret, { expiresIn: '1h' }) };
}
async function mkDone(p, status = 'concluido') {
  const end = new Date(`${daysAgo(5)}T${String(8 + 2 * ((++seq) % 6)).padStart(2, '0')}:00:00Z`);
  return (await one(`INSERT INTO appointments (professional_id, client_id, service_id, starts_at, ends_at, status, price_cents_snapshot)
      VALUES ($1, $2, $3, $4, $5, $6, 100000) RETURNING id`, [p.id, p.cli, p.svc, new Date(end.getTime() - 3600_000), end, status])).id;
}
const rec = async (p, appt, amount, method, day = D, kind = 'recebimento', reverses = null) => (await one(
  `INSERT INTO financial_payments (professional_id, appointment_id, kind, amount_cents, method, occurred_on, reverses_payment_id, notes)
   VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`, [p.id, appt, kind, amount, method, day, reverses, kind === 'estorno' ? 'estorno de teste' : null])).id;
async function mkExpense(p, amount, { status = 'pendente', method = null, paidOn = null } = {}) {
  return (await one(`INSERT INTO expenses (professional_id, description, category, amount_cents, expense_date, payment_status, paid_on, paid_method)
      VALUES ($1, 'Despesa', 'Outros', $2, $3, $4, $5, $6) RETURNING id`, [p.id, amount, daysAgo(6), status, paidOn, method])).id;
}
/** Dia D: pix 5000 (estorno 1000), dinheiro 3000, despesa paga em dinheiro 2000 (lançamento), despesa antiga paga em boleto 700. */
async function seedDay(p) {
  const a = await mkDone(p);
  const r = await rec(p, a, 5000, 'pix');
  await rec(p, a, 1000, 'pix', D, 'estorno', r);
  await rec(p, a, 3000, 'dinheiro');
  await mkDone(p);                                                    // concluído SEM recebimento: não entra
  await mkExpense(p, 9999);                                           // pendente: não entra
  const e = await mkExpense(p, 2000);
  await owner.query(`INSERT INTO expense_payments (professional_id, expense_id, amount_cents, method, paid_on) VALUES ($1, $2, 2000, 'dinheiro', $3)`, [p.id, e, D]);
  await mkExpense(p, 700, { status: 'paga', method: 'boleto', paidOn: D });
  return { a, r };
}
const EXPECTED = { pix: 4000, dinheiro: 1000, cartao_debito: 0, cartao_credito: 0, transferencia: 0, outra: -700 };

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
const closeDay = (p, day, body) => api('POST', `/financeiro/caixa/${day}/fechamento`, { as: p, body });
const reopen = (p, day, reason) => api('POST', `/financeiro/caixa/${day}/reabertura`, { as: p, body: { reason } });
const entries = (pid) => owner.query(`SELECT version, method, expected_cents, counted_cents, difference_cents, justification FROM cash_closing_entries WHERE professional_id = $1 ORDER BY version, method`, [pid]);
const receiveApi = (p, appt, amountCents, occurredOn) => api('POST', `/financeiro/atendimentos/${appt}/pagamentos`, { as: p, key: k(), body: { amountCents, method: 'pix', occurredOn } });

async function resetAll() {
  await owner.query(`DELETE FROM professionals WHERE email LIKE $1`, [EMAIL_LIKE]);
  if ((await one(`SELECT to_regclass('public.cash_closing_entries') IS NOT NULL AS x`)).x) await db.runFile(DOWN29);
  if ((await one(`SELECT to_regclass('public.expense_payments') IS NOT NULL AS x`)).x) await db.runFile(DOWN28);
  await db.reset({ emailLike: EMAIL_LIKE, roles: [ROLE] });
}

before(async () => {
  const r = await resolveFinanceTestDb(process.env, VAR);
  if (r.skip) { skip = r.skip; return; }
  owner = new pg.Pool({ connectionString: r.url, options: '-c TimeZone=UTC', max: 10 });
  owner.on('error', () => {});
  db = financeDb(owner);
  await resetAll();
  await db.createAppRole(ROLE);
  await db.up();
  for (const f of UPS) await db.runFile(f);
  await db.grant(ROLE);
  for (const g of ['_ops/028_grant_app_role.sql', '_ops/029_grant_app_role.sql']) await db.runSql(psqlScript(await readSql(g), { app_role: ROLE }));
  secret = 'fin-cax-test-secret';
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
    await resetAll();
  } finally {
    await owner.end();
  }
});

const dbTest = (name, fn) => test(name, T, async (t) => { if (skip) return t.skip(skip); await fn(t); });

dbTest('esperado por método = recebido - estornos - despesas efetivamente pagas; não presume atendimento concluído nem despesa pendente', async () => {
  const p = await mkProf('esp');
  await seedDay(p);
  const r = (await api('GET', `/financeiro/caixa/${D}`, { as: p })).json;
  assert.deepEqual(Object.fromEntries(r.esperado.metodos.map((m) => [m.method, m.expectedCents])), EXPECTED);
  assert.deepEqual(r.esperado.totais, { receivedCents: 8000, refundedCents: 1000, expensesPaidCents: 2700, expectedCents: 4300 });
  assert.equal(r.fechamento, null);
  const vazio = (await api('GET', `/financeiro/caixa/${daysAgo(10)}`, { as: p })).json;
  assert.equal(vazio.esperado.totais.expectedCents, 0);
  assert.equal(await count(`SELECT count(*)::int AS n FROM cash_closings WHERE professional_id = $1`, [p.id]), 0);   // consultar não grava
});

dbTest('fechamento: contado por método, totais congelados, uma linha por método, duplicidade recusada, entradas validadas', async () => {
  const p = await mkProf('fecha');
  await seedDay(p);
  assert.equal((await closeDay(p, D, { counted: { pix: 4000 } })).status, 400);                               // faltam métodos
  assert.equal((await closeDay(p, D, { counted: countedOf({ pix: -1 }) })).status, 400);
  assert.equal((await closeDay(p, daysAgo(-1), { counted: countedOf() })).status, 400);                       // futuro
  assert.equal((await closeDay(p, D, { counted: { ...countedOf(), cheque: 1 } })).status, 400);
  const ok = await closeDay(p, D, { counted: countedOf({ pix: 4000, dinheiro: 1000, outra: 0 }), justification: 'boleto pago fora do caixa' });
  assert.equal(ok.status, 201);                                                                              // outra: esperado -700, contado 0 -> divergência justificada
  assert.equal((await api('GET', `/financeiro/caixa/${D}`, { as: p })).json.fechamento.status, 'fechado');
});

dbTest('divergência exige justificativa; sem divergência fecha sem ela; justificativa só nas linhas divergentes', async () => {
  const p = await mkProf('div');
  await seedDay(p);
  const falta = await closeDay(p, D, { counted: countedOf({ pix: 4000, dinheiro: 900, outra: -0 }) });
  assert.equal(falta.status, 422);
  assert.equal(falta.json.reason, 'justification_required');
  assert.deepEqual(falta.json.divergencias.map((d) => d.method).sort(), ['dinheiro', 'outra']);
  assert.equal(await count(`SELECT count(*)::int AS n FROM cash_closings WHERE professional_id = $1`, [p.id]), 0);   // nada gravado
  const ok = await closeDay(p, D, { counted: countedOf({ pix: 4000, dinheiro: 900 }), justification: 'troco devolvido a uma cliente' });
  assert.equal(ok.status, 201);
  assert.deepEqual([ok.json.fechamento.status, ok.json.fechamento.receivedCents, ok.json.fechamento.refundedCents, ok.json.fechamento.expensesPaidCents], ['fechado', 8000, 1000, 2700]);
  const e = (await entries(p.id)).rows;
  assert.equal(e.length, 6);
  const by = Object.fromEntries(e.map((r) => [r.method, r]));
  assert.deepEqual([by.pix.difference_cents, by.pix.justification], [0, null]);
  assert.deepEqual([by.dinheiro.expected_cents, by.dinheiro.counted_cents, by.dinheiro.difference_cents], [1000, 900, -100]);
  assert.match(by.dinheiro.justification, /troco devolvido/);
  assert.equal(by.outra.difference_cents, 700);
  assert.equal((await closeDay(p, D, { counted: countedOf({ pix: 4000, dinheiro: 900 }), justification: 'repetido' })).json.reason, 'already_closed');
  const h = await one(`SELECT actor_id FROM financial_audit_log WHERE professional_id = $1 AND action = 'cash_close'`, [p.id]);
  assert.equal(h.actor_id, p.id);
});

dbTest('dia fechado recusa lançamento retroativo nele, mas estorno real de hoje (de recebimento de dia fechado) é aceito; originais intactos', async () => {
  const p = await mkProf('per');
  const { a, r } = await seedDay(p);
  assert.equal((await closeDay(p, D, { counted: countedOf({ pix: 4000, dinheiro: 1000 }), justification: 'boleto fora do caixa' })).status, 201);
  assert.equal((await receiveApi(p, a, 500, D)).json.reason, 'day_closed');
  const before = await one(`SELECT amount_cents, occurred_on::text AS d FROM financial_payments WHERE id = $1`, [r]);
  const ref = await api('POST', `/financeiro/pagamentos/${r}/estornos`, { as: p, key: k(), body: { amountCents: 500, occurredOn: today, reason: 'cliente devolveu hoje' } });
  assert.equal(ref.status, 201);
  assert.deepEqual(await one(`SELECT amount_cents, occurred_on::text AS d FROM financial_payments WHERE id = $1`, [r]), before);   // original não muda
  const hoje = (await api('GET', `/financeiro/caixa/${today}`, { as: p })).json;
  assert.equal(hoje.esperado.metodos.find((m) => m.method === 'pix').expectedCents, -500);        // entra no dia em que ocorreu
  const dia = (await api('GET', `/financeiro/caixa/${D}`, { as: p })).json;
  assert.equal(dia.fechamento.status, 'fechado');
  assert.equal(dia.esperado.totais.refundedCents, 1000);                                           // dia fechado não mudou
});

dbTest('reabertura: motivo obrigatório e diferente, histórico por versão preservado, novo fechamento incorpora o lançamento', async () => {
  const p = await mkProf('reab');
  const { a } = await seedDay(p);
  assert.equal((await reopen(p, D, 'sem fechamento ainda')).status, 404);
  assert.equal((await closeDay(p, D, { counted: countedOf({ pix: 4000, dinheiro: 1000 }), justification: 'boleto fora do caixa' })).status, 201);
  assert.equal((await reopen(p, D, 'ab')).status, 400);
  const re = await reopen(p, D, 'esqueci um recebimento em dinheiro');
  assert.equal(re.status, 200);
  assert.deepEqual([re.json.fechamento.status, re.json.fechamento.reopenCount], ['aberto', 1]);
  assert.equal((await reopen(p, D, 'outro motivo qualquer')).json.reason, 'already_open');
  assert.equal((await receiveApi(p, a, 800, D)).status, 201);                           // agora aceito, na data real
  const fe = await closeDay(p, D, { counted: countedOf({ pix: 4800, dinheiro: 1000 }), justification: 'boleto fora do caixa' });
  assert.equal(fe.status, 201);
  assert.equal(fe.json.fechamento.reopenCount, 1);
  const day = (await api('GET', `/financeiro/caixa/${D}`, { as: p })).json;
  assert.deepEqual(day.versoes.map((v) => v.version), [0, 1]);
  assert.equal(day.versoes[0].metodos.find((m) => m.method === 'pix').expectedCents, 4000);   // versão antiga intacta
  assert.equal(day.versoes[1].metodos.find((m) => m.method === 'pix').expectedCents, 4800);
  const list = (await api('GET', '/financeiro/caixa', { as: p })).json.fechamentos;
  assert.equal(list.length, 1);
  assert.equal(list[0].versoes, 2);
  assert.equal((await reopen(p, D, 'esqueci um recebimento em dinheiro')).json.reason, 'reason_repeated');
  const acts = (await owner.query(`SELECT action, reason FROM financial_audit_log WHERE professional_id = $1 AND entity_type = 'cash_closing' ORDER BY seq`, [p.id])).rows;
  assert.deepEqual(acts.map((x) => x.action), ['cash_close', 'cash_reopen', 'cash_close']);
  assert.match(acts[1].reason, /esqueci um recebimento/);
});

dbTest('concorrência: dois fechamentos simultâneos geram um só; recebimento concorrente ou entra nos totais ou é recusado', async () => {
  const p = await mkProf('conc');
  const a = await mkDone(p);
  await rec(p, a, 3000, 'pix');
  const body = { counted: countedOf({ pix: 3000 }) };
  const dup = await Promise.all([closeDay(p, D, body), closeDay(p, D, body)]);
  assert.deepEqual(dup.map((x) => x.status).sort(), [201, 409]);
  assert.equal(await count(`SELECT count(*)::int AS n FROM cash_closing_entries WHERE professional_id = $1`, [p.id]), 6);
  const q = await mkProf('conc2');
  const b = await mkDone(q);
  await rec(q, b, 3000, 'pix');
  const [fe, pg] = await Promise.all([closeDay(q, D, { counted: countedOf({ pix: 3000 }), justification: 'pode haver recebimento concorrente' }), receiveApi(q, b, 700, D)]);
  const noDia = await count(`SELECT COALESCE(SUM(amount_cents), 0)::int AS n FROM financial_payments WHERE professional_id = $1 AND occurred_on = $2`, [q.id, D]);
  const esperado = (await one(`SELECT COALESCE(SUM(e.expected_cents), 0)::int AS n FROM cash_closing_entries e WHERE e.professional_id = $1`, [q.id])).n;
  assert.ok([201, 422].includes(fe.status), `fechamento ${fe.status}`);
  if (fe.status === 201) assert.equal(esperado, noDia, 'o congelado precisa incluir tudo que ficou gravado no dia');
  assert.ok(pg.status === 201 || pg.status === 409);
});

dbTest('isolamento: outra conta não vê fechamento, lançamentos nem histórico, e não reabre', async () => {
  const a = await mkProf('isoA');
  const b = await mkProf('isoB');
  const { r } = await seedDay(a);
  assert.equal((await closeDay(a, D, { counted: countedOf({ pix: 4000, dinheiro: 1000 }), justification: 'boleto fora do caixa' })).status, 201);
  assert.equal((await api('GET', `/financeiro/caixa/${D}`, { as: b })).json.fechamento, null);
  assert.equal((await api('GET', '/financeiro/caixa', { as: b })).json.fechamentos.length, 0);
  const mv = (await api('GET', `/financeiro/caixa/${D}/lancamentos`, { as: b })).json;
  assert.deepEqual([mv.recebimentos.length, mv.pagamentosDespesa.length, mv.despesasPagasAntigas.length], [0, 0, 0]);
  assert.equal((await api('GET', `/financeiro/historico/payment/${r}`, { as: b })).json.historico.length, 0);
  assert.equal((await reopen(b, D, 'tentativa de outra conta')).status, 404);
});

dbTest('lançamentos do dia levam ao histórico de cada movimentação', async () => {
  const p = await mkProf('mov');
  const { r } = await seedDay(p);
  const mv = (await api('GET', `/financeiro/caixa/${D}/lancamentos`, { as: p })).json;
  assert.deepEqual([mv.recebimentos.length, mv.pagamentosDespesa.length, mv.despesasPagasAntigas.length], [3, 1, 1]);
  const item = mv.recebimentos.find((x) => x.id === r);
  assert.equal(item.historicoPath, `/financeiro/historico/payment/${r}`);
  const h = (await api('GET', item.historicoPath, { as: p })).json;
  assert.deepEqual(h.historico.map((x) => x.action), ['payment_create']);
  assert.equal((await api('GET', `/financeiro/historico/qualquer/${r}`, { as: p })).status, 400);
});

dbTest('banco: entradas append-only, só em dia fechado, diferença exige justificativa; rollbacks abortam com dados', async () => {
  const p = await mkProf('banco');
  await seedDay(p);
  assert.equal((await closeDay(p, D, { counted: countedOf({ pix: 4000, dinheiro: 1000 }), justification: 'boleto fora do caixa' })).status, 201);
  const closing = (await one(`SELECT id FROM cash_closings WHERE professional_id = $1`, [p.id])).id;
  await assert.rejects(owner.query(`UPDATE cash_closing_entries SET counted_cents = 1 WHERE closing_id = $1`, [closing]), /append-only/);
  await assert.rejects(owner.query(`DELETE FROM cash_closing_entries WHERE closing_id = $1`, [closing]), /append-only/);
  await assert.rejects(appPool.query(`UPDATE cash_closing_entries SET counted_cents = 1 WHERE closing_id = $1`, [closing]), /permission denied/);
  await assert.rejects(appPool.query(`DELETE FROM cash_closing_entries WHERE closing_id = $1`, [closing]), /permission denied/);
  await assert.rejects(owner.query(`INSERT INTO cash_closing_entries (professional_id, closing_id, version, method, expected_cents, counted_cents, difference_cents) VALUES ($1, $2, 5, 'pix', 0, 0, 0)`, [p.id, closing]), /precisa estar fechado/);
  await assert.rejects(owner.query(`INSERT INTO cash_closing_entries (professional_id, closing_id, version, method, expected_cents, counted_cents, difference_cents) VALUES ($1, $2, 0, 'pix', 0, 5, 5)`, [p.id, closing]), /justification_check|check/);
  await assert.rejects(db.runFile(DOWN29), /rollback 029 abortado/);
  await assert.rejects(db.runFile(DOWN28), /rollback 028 abortado: a migration 029/);
  await assert.rejects(db.down({ confirm: 'ARQUIVAR-E-REMOVER-DADOS-FINANCEIROS' }), /rollback 025 abortado: a migration 02[89]/);
  assert.ok(await count(`SELECT count(*)::int AS n FROM cash_closing_entries`) >= 6);
});

dbTest('Outros distingue boleto e método não informado sem inventar método; movimentações do período com filtros, totais e isolamento', async () => {
  const p = await mkProf('mov2');
  const q = await mkProf('mov2b');
  await seedDay(p);
  await mkExpense(p, 300, { status: 'paga', method: null, paidOn: D });
  const day = (await api('GET', `/financeiro/caixa/${D}`, { as: p })).json;
  const outra = day.esperado.metodos.find((m) => m.method === 'outra');
  assert.deepEqual([outra.expensesPaidCents, outra.expensesPaidBoletoCents, outra.expensesPaidUnknownMethodCents, outra.expectedCents], [1000, 700, 300, -1000]);
  assert.equal(day.esperado.metodos.find((m) => m.method === 'pix').expensesPaidBoletoCents, undefined);
  const lan = (await api('GET', `/financeiro/caixa/${D}/lancamentos`, { as: p })).json;
  assert.deepEqual(lan.despesasPagasAntigas.map((x) => [x.originalMethod, x.methodInformed]).sort(), [[null, false], ['boleto', true]]);
  const url = (extra = '') => `/financeiro/movimentacoes?from=${D}&to=${D}${extra}`;
  const all = (await api('GET', url(), { as: p })).json;
  assert.deepEqual(all.totais, { quantidade: 6, recebidoCents: 8000, estornadoCents: 1000, despesasPagasCents: 3000, saldoCents: 4000 });
  assert.equal((await api('GET', url('&tipo=estorno'), { as: p })).json.itens.length, 1);
  assert.equal((await api('GET', url('&metodo=nao_informado'), { as: p })).json.itens.length, 1);
  assert.equal((await api('GET', url('&metodo=boleto'), { as: p })).json.itens.length, 1);
  const lim = (await api('GET', url('&limit=2'), { as: p })).json;
  assert.deepEqual([lim.itens.length, lim.truncated, lim.totais.quantidade], [2, true, 6]);
  const pay = all.itens.find((i) => i.tipo === 'recebimento');
  assert.equal((await api('GET', pay.historicoPath, { as: p })).json.historico[0].action, 'payment_create');
  assert.equal((await api('GET', url('&tipo=xx'), { as: p })).status, 400);
  assert.equal((await api('GET', '/financeiro/movimentacoes', { as: p })).status, 400);
  assert.equal((await api('GET', url(), { as: q })).json.itens.length, 0);
});
