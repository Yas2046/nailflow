// Financeiro, etapa 8: relatório do período (JSON, Excel, PDF), alertas internos e migração de Dashboard/Gastos para recebimentos reais.
// Só as regras NOVAS. API HTTP real, role NÃO-DONA, banco DESCARTÁVEL (FINANCEIRO_REL_TEST_DB_URL).
// API HTTP real, role NÃO-DONA, banco DESCARTÁVEL (FINANCEIRO_REL_TEST_DB_URL, um banco só para este arquivo; ver helpers/financeTestDb.js).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import pg from 'pg';
import { resolveFinanceTestDb, financeDb, psqlScript, readSql } from './helpers/financeTestDb.js';
import { todayInBusinessTz } from '../src/utils/financeiroPagamentos.js';

const VAR = 'FINANCEIRO_REL_TEST_DB_URL';
const EMAIL_LIKE = 'fin-rel-%@nf.test';
const ROLE = 'nf_fin_rel_app';
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
let snapDir;

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
    [id, `Rel ${tag}`, `fin-rel-${tag}-${id.slice(0, 8)}@nf.test`, `fin-rel-${tag}-${id.slice(0, 8)}`, `Studio ${tag}`]);
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
  secret = 'fin-rel-test-secret';
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = secret;
  process.env.DATABASE_URL = db.appUrl(r.url, ROLE);
  process.env.FRONTEND_URL = 'http://localhost:5173';
  snapDir = await (await import('node:fs/promises')).mkdtemp((await import('node:path')).join((await import('node:os')).tmpdir(), 'fin-rel-snap-'));
  process.env.DELETED_PROFESSIONAL_BACKUP_DIR = snapDir;
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

import ExcelJS from 'exceljs';

async function raw(path, as) {
  const res = await fetch(`${baseUrl}${path}`, { headers: as ? { cookie: `nailflow_token=${as.token}` } : {} });
  return { status: res.status, type: res.headers.get('content-type'), disp: res.headers.get('content-disposition'), buf: Buffer.from(await res.arrayBuffer()) };
}
const rel = (p, from = D, to = D) => api('GET', `/financeiro/relatorio?from=${from}&to=${to}`, { as: p });

dbTest('relatório: totais do período (datas inclusivas, fora do período não entra), mesmos números do caixa e de A receber', async () => {
  const p = await mkProf('rel');
  await seedDay(p);
  const a = await mkDone(p);
  await rec(p, a, 7777, 'pix', daysAgo(10));                                  // fora do período
  const r = (await rel(p)).json;
  assert.deepEqual(r.resumo, { receivedCents: 8000, refundedCents: 1000, netReceivedCents: 7000, expensesPaidCents: 2700, saldoCents: 4300 });
  assert.deepEqual(r.recebimentosPorMetodo.map((m) => [m.method, m.netCents]), [['pix', 4000], ['dinheiro', 3000], ['cartao_debito', 0], ['cartao_credito', 0], ['transferencia', 0], ['outra', 0]]);
  assert.deepEqual(r.despesasPagasPorMetodo.map((m) => [m.method, m.paidCents]), [['boleto', 700], ['dinheiro', 2000]]);
  const wide = (await rel(p, daysAgo(11), daysAgo(0))).json;                   // inclui os dois dias
  assert.equal(wide.resumo.receivedCents, 8000 + 7777);
  const caixa = (await api('GET', `/financeiro/caixa/${D}`, { as: p })).json;
  assert.equal(caixa.esperado.totais.expectedCents, r.resumo.saldoCents);       // saldo do período = esperado do caixa do dia
  const ar = (await api('GET', '/financeiro/a-receber', { as: p })).json.totais;
  assert.deepEqual([r.pendencias.aReceber.pendenteCents, r.pendencias.aReceber.vencidoCents], [ar.saldoPendenteCents, ar.saldoVencidoCents]);
  assert.deepEqual([r.pendencias.despesas.pendentes.remainingCents, r.pendencias.despesas.aRevisar.count], [9999, 0]);   // 9999 pendente; a de 2000 foi quitada por lançamento
  assert.equal((await api('GET', `/financeiro/relatorio?from=${D}`, { as: p })).status, 400);
  assert.equal((await rel(p, D, daysAgo(5))).status, 400);                       // início depois do fim
  assert.equal((await rel(p, '2024-01-01', '2026-01-01')).status, 400);          // > 366 dias
  assert.equal((await api('GET', `/financeiro/relatorio?from=${D}&to=${D}`)).status, 401);
});

dbTest('Excel detalhado: abas e linhas do período, valores numéricos, isolamento por profissional', async () => {
  const p = await mkProf('xls');
  const q = await mkProf('xlsB');
  await seedDay(p);
  const res = await raw(`/financeiro/relatorio.xlsx?from=${D}&to=${D}`, p);
  assert.equal(res.status, 200);
  assert.match(res.type, /spreadsheetml/);
  assert.match(res.disp, new RegExp(`financeiro-${D}-a-${D}\\.xlsx`));
  assert.equal(res.buf.subarray(0, 2).toString(), 'PK');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(res.buf);
  assert.deepEqual(wb.worksheets.map((w) => w.name), ['Resumo', 'Por método', 'Despesas pagas por método', 'Despesas pagas por categoria', 'Recebimentos', 'Despesas pagas', 'Despesas em aberto', 'A receber', 'Fechamentos']);
  const rows = (name) => wb.getWorksheet(name).getSheetValues().slice(2).filter((r) => r && r.length);
  const recebs = rows('Recebimentos');
  assert.equal(recebs.length, 3);
  assert.deepEqual(recebs.map((r) => r[6]).sort((a, b) => a - b), [-10, 30, 50]);   // estorno negativo, em reais numéricos
  assert.equal(rows('Despesas pagas').length, 2);
  const resumo = Object.fromEntries(rows('Resumo').map((r) => [r[1], r[2]]));
  assert.equal(resumo['Recebido líquido'], 70);
  assert.equal(resumo['Saldo de caixa do período (recebido líquido − despesas pagas)'], 43);
  assert.equal(rows('A receber').length, 2);                                       // os dois concluídos sem recebimento do seedDay
  const other = new ExcelJS.Workbook();
  await other.xlsx.load((await raw(`/financeiro/relatorio.xlsx?from=${D}&to=${D}`, q)).buf);
  assert.equal(other.getWorksheet('Recebimentos').rowCount, 1);                    // só o cabeçalho
  assert.equal((await raw(`/financeiro/relatorio.xlsx?from=${D}&to=${D}`)).status, 401);
});

dbTest('PDF resumido: documento válido, só da própria conta', async () => {
  const p = await mkProf('pdf');
  await seedDay(p);
  const res = await raw(`/financeiro/relatorio.pdf?from=${D}&to=${D}`, p);
  assert.equal(res.status, 200);
  assert.equal(res.type, 'application/pdf');
  assert.equal(res.buf.subarray(0, 5).toString(), '%PDF-');
  assert.ok(res.buf.length > 1500);
  assert.equal((await raw(`/financeiro/relatorio.pdf?from=${D}&to=${D}`)).status, 401);
  assert.equal((await raw('/financeiro/relatorio.pdf?from=x&to=y', p)).status, 400);
});

dbTest('alertas internos com caminho para a pendência; isolados por conta', async () => {
  const p = await mkProf('alr');
  const q = await mkProf('alrB');
  await mkExpense(p, 4000, { status: 'pendente' });
  await owner.query(`UPDATE expenses SET due_on = $2 WHERE professional_id = $1`, [p.id, daysAgo(2)]);
  await owner.query(`INSERT INTO expenses (professional_id, description, category, amount_cents, expense_date) VALUES ($1, 'Antiga', 'Outros', 1500, $2)`, [p.id, daysAgo(9)]);
  const old = await mkDone(p);
  await owner.query(`UPDATE appointments SET ends_at = now() - interval '30 days', starts_at = now() - interval '30 days 1 hour' WHERE id = $1`, [old]);
  const recent = await mkDone(p);
  await owner.query(`UPDATE appointments SET ends_at = now() - interval '1 day', starts_at = now() - interval '1 day 1 hour' WHERE id = $1`, [recent]);
  assert.equal((await closeDay(p, D, { counted: countedOf({ pix: 100 }), justification: 'contagem divergente' })).status, 201);
  const r = (await api('GET', '/financeiro/alertas', { as: p })).json;
  const by = Object.fromEntries(r.alertas.map((a) => [a.type, a]));
  assert.deepEqual(Object.keys(by).sort(), ['a_receber_pendente', 'a_receber_vencido', 'despesas_a_revisar', 'despesas_vencidas', 'divergencia_caixa']);
  assert.deepEqual([by.despesas_vencidas.count, by.despesas_vencidas.amountCents, by.despesas_vencidas.path], [1, 4000, '/financeiro/despesas?situacao=vencida']);
  assert.deepEqual([by.a_receber_vencido.count, by.a_receber_vencido.amountCents], [1, 100000]);
  assert.equal(by.a_receber_pendente.count, 1);
  assert.equal(by.despesas_a_revisar.path, '/financeiro/despesas?situacao=a_revisar');
  assert.equal(by.divergencia_caixa.path, `/financeiro/caixa?data=${D}`);
  assert.equal(r.total, 5);
  assert.deepEqual((await api('GET', '/financeiro/alertas', { as: q })).json, { hoje: today, total: 0, alertas: [] });
});

dbTest('Dashboard e Gastos usam recebimentos e despesas pagas reais; concluído sem recebimento não conta; sem o Financeiro valem os indicadores antigos', async () => {
  const p = await mkProf('dsh');
  await mkDone(p);                                                             // concluído SEM recebimento (preço 100000)
  const b = await mkDone(p);
  await rec(p, b, 6000, 'pix', today);
  await rec(p, b, 1000, 'pix', today, 'estorno', (await one(`SELECT id FROM financial_payments WHERE appointment_id = $1`, [b])).id);
  const e = await mkExpense(p, 2500);
  await owner.query(`INSERT INTO expense_payments (professional_id, expense_id, amount_cents, method, paid_on) VALUES ($1, $2, 2500, 'pix', $3)`, [p.id, e, today]);
  await mkExpense(p, 9999, { status: 'pendente' });                            // lançada, não paga: não é gasto do mês no Financeiro
  const month = today.slice(0, 7);
  const dash = (await api('GET', '/dashboard', { as: p })).json;
  assert.equal(dash.mes.base, 'recebimentos');
  assert.deepEqual([dash.mes.faturamentoRealizadoCents, dash.mes.despesasPagasCents], [5000, 2500]);
  assert.equal(dash.faturamento6Meses.find((x) => x.mes === month).totalCents, 5000);
  assert.equal(dash.gastos6Meses.find((x) => x.mes === month).totalCents, 2500);
  assert.equal(dash.mes.aReceberCents, 200000 - 5000);                           // dois concluídos de R$ 1.000 menos o líquido recebido
  const sum = (await api('GET', `/expenses/summary?from=${today.slice(0, 8)}01&to=${today}`, { as: p })).json;
  assert.deepEqual([sum.base, sum.faturadoCents, sum.gastosCents, sum.resultadoCents], ['recebimentos', 5000, 2500, 2500]);
  assert.deepEqual(sum.categorias, [{ category: 'Outros', totalCents: 2500, count: 1 }]);
  const lst = (await api('GET', `/expenses?from=${daysAgo(30)}&to=${today}`, { as: p })).json;                // datas civis AAAA-MM-DD (não timestamp deslocado)
  assert.equal(lst.find((x) => x.amount_cents === 2500).expense_date, daysAgo(6));
  assert.match(lst[0].expense_date, /^\d{4}-\d{2}-\d{2}$/);
  process.env.FINANCEIRO_PAGAMENTOS_ENABLED = 'false';
  try {
    const legacy = (await api('GET', '/dashboard', { as: p })).json;
    assert.equal(legacy.mes.base, 'concluidos');
    assert.equal((await api('GET', `/expenses/summary?from=${today.slice(0, 8)}01&to=${today}`, { as: p })).json.base, undefined);
  } finally { process.env.FINANCEIRO_PAGAMENTOS_ENABLED = 'true'; }
});

dbTest('exclusão de conta: o snapshot inclui pagamentos de despesa e fechamento por método (sem perder dados financeiros)', async () => {
  const fs = await import('node:fs/promises');
  const p = await mkProf('exc');
  await seedDay(p);
  assert.equal((await closeDay(p, D, { counted: countedOf({ pix: 4000, dinheiro: 1000 }), justification: 'boleto fora do caixa' })).status, 201);
  const adminId = randomUUID();
  await owner.query(`INSERT INTO professionals (id, name, email, password_hash, slug, business_name, is_admin) VALUES ($1, 'Admin', $2, 'x', $3, 'Studio Admin', true)`,
    [adminId, `fin-rel-admin-${adminId.slice(0, 8)}@nf.test`, `fin-rel-admin-${adminId.slice(0, 8)}`]);
  const admin = { token: jwt.sign({ sub: adminId, ver: 1 }, secret, { expiresIn: '1h' }) };
  const call = async (method, path, body) => {
    const res = await fetch(`${baseUrl}${path}`, { method, headers: { cookie: `nailflow_token=${admin.token}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  try {
    assert.equal((await call('DELETE', `/admin/professionals/${p.id}`, { businessNameConfirmation: 'Studio exc' })).status, 204);
    const files = (await fs.readdir(snapDir)).filter((f) => f.includes(p.id));
    assert.equal(files.length, 1);
    const snap = JSON.parse(await fs.readFile(`${snapDir}/${files[0]}`, 'utf8'));
    assert.deepEqual([snap.expense_payments.length, snap.cash_closing_entries.length, snap.cash_closings.length, snap.financial_payments.length], [1, 6, 1, 3]);
    assert.equal(await count(`SELECT count(*)::int AS n FROM expense_payments WHERE professional_id = $1`, [p.id]), 0);   // cascata só depois do snapshot
  } finally {
    await owner.query(`DELETE FROM admin_audit_log WHERE actor_id = $1`, [adminId]).catch(() => {});
  }
});
