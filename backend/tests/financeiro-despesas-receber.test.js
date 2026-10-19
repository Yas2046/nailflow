// Financeiro, etapa 4: despesas (revisão manual, vencimento, pagamentos parciais) e contas a receber (só leitura).
// Só as regras NOVAS desta etapa; pagamentos de atendimento e preço final ficam em financeiro-pagamentos*.test.js / financeiro-preco-final.test.js.
// API HTTP real, role NÃO-DONA, banco DESCARTÁVEL (FINANCEIRO_DESP_TEST_DB_URL, um banco só para este arquivo; ver helpers/financeTestDb.js).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import pg from 'pg';
import { resolveFinanceTestDb, financeDb, psqlScript, readSql } from './helpers/financeTestDb.js';
import { todayInBusinessTz } from '../src/utils/financeiroPagamentos.js';

const VAR = 'FINANCEIRO_DESP_TEST_DB_URL';
const EMAIL_LIKE = 'fin-dsp-%@nf.test';
const ROLE = 'nf_fin_dsp_app';
const UP26 = '026_financeiro_pagamentos_metodo.sql';
const UP27 = '027_financeiro_limites_banco.sql';
const UP28 = '028_financeiro_despesas.sql';
const DOWN28 = '_rollback/028_financeiro_despesas.down.sql';
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
const daysAhead = (n) => daysAgo(-n);
const one = async (sql, params) => (await owner.query(sql, params)).rows[0];
const count = async (sql, params) => (await one(sql, params)).n;

async function mkProf(tag) {
  const id = randomUUID();
  await owner.query(`INSERT INTO professionals (id, name, email, password_hash, slug, business_name) VALUES ($1, $2, $3, 'x', $4, $5)`,
    [id, `Dsp ${tag}`, `fin-dsp-${tag}-${id.slice(0, 8)}@nf.test`, `fin-dsp-${tag}-${id.slice(0, 8)}`, `Studio ${tag}`]);
  const svc = (await one(`INSERT INTO services (professional_id, name, price_cents, duration_minutes) VALUES ($1, 'Manicure', 10000, 60) RETURNING id`, [id])).id;
  const cli = (await one(`INSERT INTO clients (professional_id, name, phone) VALUES ($1, 'Cliente', $2) RETURNING id`, [id, `5531${String(400000000 + Math.floor(Math.random() * 1e8))}`])).id;
  return { id, svc, cli, token: jwt.sign({ sub: id, ver: 1 }, secret, { expiresIn: '1h' }) };
}
/** Despesa direta no banco (o estado inicial dos testes: 'a_revisar' é o DEFAULT, como nas despesas antigas). */
async function mkExp(p, { amount = 10000, status, dueOn = null } = {}) {
  if (!status) return (await one(`INSERT INTO expenses (professional_id, description, category, amount_cents, expense_date) VALUES ($1, 'Despesa', 'Outros', $2, $3) RETURNING id`, [p.id, amount, daysAgo(2)])).id;
  return (await one(`INSERT INTO expenses (professional_id, description, category, amount_cents, expense_date, payment_status, due_on) VALUES ($1, 'Despesa', 'Outros', $2, $3, $4, $5) RETURNING id`,
    [p.id, amount, daysAgo(2), status, dueOn])).id;
}
/** Atendimento concluído com término `endedDaysAgo` dias atrás. */
async function mkDone(p, { endedDaysAgo = 1, final = null, deposit = null, paidAt = null, status = 'concluido' } = {}) {
  const end = new Date(`${daysAgo(endedDaysAgo)}T${String(8 + 2 * ((++dayN) % 6)).padStart(2, '0')}:00:00Z`);   // horários distintos: a agenda não admite sobreposição
  return (await one(`INSERT INTO appointments (professional_id, client_id, service_id, starts_at, ends_at, status, price_cents_snapshot, final_price_cents, final_price_set_at, deposit_cents, paid_at)
      VALUES ($1, $2, $3, $4, $5, $6, 10000, $7, CASE WHEN $7::int IS NULL THEN NULL ELSE now() END, $8, $9) RETURNING id`,
  [p.id, p.cli, p.svc, new Date(end.getTime() - 3600_000), end, status, final, deposit, paidAt])).id;
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
const payBody = (amountCents, extra = {}) => ({ amountCents, method: 'pix', paidOn: daysAgo(1), ...extra });
const payExp = (p, id, body, key = k()) => api('POST', `/financeiro/despesas/${id}/pagamentos`, { as: p, key, body });
const review = (p, id, body) => api('POST', `/financeiro/despesas/${id}/revisao`, { as: p, body });
const getExp = (p, id) => api('GET', `/financeiro/despesas/${id}`, { as: p });
const expRow = (id) => one(`SELECT payment_status, due_on::text AS due_on, paid_on::text AS paid_on, paid_method FROM expenses WHERE id = $1`, [id]);
const histCount = (id, action) => count(`SELECT count(*)::int AS n FROM financial_audit_log WHERE action = $2 AND (entity_id = $1 OR after_data->>'expense_id' = $1::text)`, [id, action]);
const rec = (p, appt, amount, kind = 'recebimento', reverses = null) => owner.query(
  `INSERT INTO financial_payments (professional_id, appointment_id, kind, amount_cents, method, occurred_on, reverses_payment_id, notes) VALUES ($1, $2, $3, $4, 'pix', $5, $6, $7) RETURNING id`,
  [p.id, appt, kind, amount, daysAgo(1), reverses, kind === 'estorno' ? 'estorno de teste' : null]);

/** Estado limpo: contas de teste fora, 028 revertida (aborta se sobrar movimentação), 025 revertida. */
async function resetAll() {
  await owner.query(`DELETE FROM professionals WHERE email LIKE $1`, [EMAIL_LIKE]);
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
  await db.runFile(UP26);
  await db.runFile(UP27);
  await db.runFile(UP28);
  await db.grant(ROLE);
  await db.runSql(psqlScript(await readSql('_ops/028_grant_app_role.sql'), { app_role: ROLE }));
  secret = 'fin-dsp-test-secret';
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

// ── despesas: estados e revisão manual ─────────────────────────────────────
dbTest('despesa antiga fica a revisar (não é presumida paga); só a revisão manual a classifica', async () => {
  const p = await mkProf('rev');
  const id = await mkExp(p, { amount: 8000 });
  const d = (await getExp(p, id)).json;
  assert.equal(d.state, 'a_revisar');
  assert.equal(d.paidCents, 0);
  assert.equal((await payExp(p, id, payBody(1000))).json.reason, 'needs_review');
  assert.equal((await review(p, id, { to: 'pendente', dueOn: daysAhead(5) })).status, 200);
  assert.equal((await expRow(id)).payment_status, 'pendente');
  assert.equal((await review(p, id, { to: 'pendente' })).json.reason, 'not_in_review');
  assert.equal(await histCount(id, 'expense_status'), 1);
});

dbTest('revisão como paga exige data, método e motivo; grava um pagamento do valor inteiro com histórico', async () => {
  const p = await mkProf('revpaga');
  const id = await mkExp(p, { amount: 5000 });
  assert.equal((await review(p, id, { to: 'paga', paidOn: daysAgo(3), method: 'pix' })).status, 400);        // sem motivo
  assert.equal((await review(p, id, { to: 'paga', paidOn: daysAhead(2), method: 'pix', reason: 'conferi o comprovante' })).status, 400); // futura
  const ok = await review(p, id, { to: 'paga', paidOn: daysAgo(3), method: 'boleto', reason: 'conferi o comprovante' });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.state, 'paga');
  assert.equal(ok.json.paidCents, 5000);
  assert.equal(ok.json.pagamentos.length, 1);
  const row = await expRow(id);
  assert.equal(row.paid_on, daysAgo(3));
  assert.equal(row.paid_method, 'boleto');
  assert.equal(await histCount(id, 'expense_payment_create'), 1);
  const h = await one(`SELECT reason FROM financial_audit_log WHERE entity_id = $1 AND action = 'expense_status'`, [id]);
  assert.match(h.reason, /conferi o comprovante/);
});

dbTest('listagem separa a revisar, pendentes, vencidas e pagas, com totais; despesa paga sem lançamentos é sinalizada (legacyPaid)', async () => {
  const p = await mkProf('lista');
  const a = await mkExp(p, { amount: 1000 });
  const pend = await mkExp(p, { amount: 2000, status: 'pendente', dueOn: daysAhead(3) });
  const venc = await mkExp(p, { amount: 4000, status: 'pendente', dueOn: daysAgo(2) });
  const paga = (await one(`INSERT INTO expenses (professional_id, description, amount_cents, expense_date, payment_status, paid_on, paid_method)
      VALUES ($1, 'Antiga paga', 8000, $2, 'paga', $3, 'pix') RETURNING id`, [p.id, daysAgo(9), daysAgo(8)])).id;
  const r = (await api('GET', '/financeiro/despesas', { as: p })).json;
  const byId = Object.fromEntries(r.despesas.map((d) => [d.id, d]));
  assert.equal(byId[a].state, 'a_revisar');
  assert.equal(byId[pend].state, 'pendente');
  assert.equal(byId[venc].state, 'vencida');
  assert.equal(byId[venc].remainingCents, 4000);
  assert.equal(byId[paga].state, 'paga');
  assert.equal(byId[paga].legacyPaid, true);
  assert.deepEqual([r.totais.a_revisar.amountCents, r.totais.pendente.amountCents, r.totais.vencida.amountCents, r.totais.paga.amountCents], [1000, 2000, 4000, 8000]);
  assert.equal(r.totais.vencida.remainingCents, 4000);
  assert.equal((await api('GET', '/financeiro/despesas?situacao=vencida', { as: p })).json.despesas.length, 1);
  assert.equal((await api('GET', '/financeiro/despesas?situacao=xyz', { as: p })).status, 400);
  assert.equal(await count(`SELECT count(*)::int AS n FROM expense_payments WHERE professional_id = $1`, [p.id]), 0);   // nada inventado
});

dbTest('alterar vencimento: motivo obrigatório, só pendente, histórico gravado, igual não duplica', async () => {
  const p = await mkProf('venc');
  const id = await mkExp(p, { status: 'pendente', dueOn: daysAgo(1) });
  const put = (body) => api('PUT', `/financeiro/despesas/${id}/vencimento`, { as: p, body });
  assert.equal((await put({ dueOn: daysAhead(4) })).status, 400);
  assert.equal((await put({ dueOn: '2026-02-30', reason: 'prorrogado' })).status, 400);
  const ok = await put({ dueOn: daysAhead(4), reason: 'prorrogado pelo fornecedor' });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.despesa.state, 'pendente');
  assert.equal((await put({ dueOn: daysAhead(4), reason: 'prorrogado pelo fornecedor' })).json.changed, false);
  const h = await owner.query(`SELECT reason, actor_id FROM financial_audit_log WHERE entity_id = $1 AND action = 'expense_update'`, [id]);
  assert.equal(h.rows.length, 1);
  assert.equal(h.rows[0].actor_id, p.id);
  assert.match(h.rows[0].reason, /prorrogado pelo fornecedor/);
  const rev = await mkExp(p);
  assert.equal((await api('PUT', `/financeiro/despesas/${rev}/vencimento`, { as: p, body: { dueOn: daysAhead(1), reason: 'teste' } })).json.reason, 'not_pending');
});

// ── despesas: pagamentos parciais ──────────────────────────────────────────
dbTest('pagamentos parciais: saldo restante, quitação vira paga, excesso e repetição recusados, histórico por pagamento', async () => {
  const p = await mkProf('parc');
  const id = await mkExp(p, { amount: 10000, status: 'pendente', dueOn: daysAhead(2) });
  const r1 = await payExp(p, id, payBody(3000, { paidOn: daysAgo(4), notes: 'entrada' }));
  assert.equal(r1.status, 201);
  assert.equal(r1.json.despesa.remainingCents, 7000);
  assert.equal(r1.json.despesa.state, 'pendente');
  assert.equal((await payExp(p, id, payBody(7001))).json.reason, 'exceeds_expense');
  assert.equal((await payExp(p, id, payBody(0))).status, 400);
  assert.equal((await payExp(p, id, payBody(100, { paidOn: daysAhead(1) }))).status, 400);
  assert.equal((await payExp(p, id, payBody(100, { method: 'cheque' }))).status, 400);
  const r2 = await payExp(p, id, payBody(7000, { paidOn: daysAgo(1), method: 'dinheiro' }));
  assert.equal(r2.status, 201);
  assert.equal(r2.json.despesa.state, 'paga');
  assert.equal(r2.json.despesa.remainingCents, 0);
  assert.equal(r2.json.despesa.pagamentos.length, 2);
  const row = await expRow(id);
  assert.deepEqual([row.payment_status, row.paid_on, row.paid_method], ['paga', daysAgo(1), 'dinheiro']);
  assert.equal((await payExp(p, id, payBody(1))).json.reason, 'already_paid');
  assert.equal(await histCount(id, 'expense_payment_create'), 2);
});

dbTest('idempotência do pagamento de despesa: repetição devolve o mesmo; mesma chave com outro corpo é 409; concorrência não ultrapassa o valor', async () => {
  const p = await mkProf('idem');
  const id = await mkExp(p, { amount: 10000, status: 'pendente' });
  const key = k();
  const a = await payExp(p, id, payBody(2000), key);
  const b = await payExp(p, id, payBody(2000), key);
  assert.deepEqual([a.status, b.status, b.json.replayed], [201, 200, true]);
  assert.equal(b.json.pagamento.id, a.json.pagamento.id);
  assert.equal((await payExp(p, id, payBody(2500), key)).json.reason, 'idempotency_conflict');
  assert.equal((await api('POST', `/financeiro/despesas/${id}/pagamentos`, { as: p, body: payBody(100) })).json.reason, 'idempotency_key_required');
  assert.equal(await count(`SELECT count(*)::int AS n FROM expense_payments WHERE expense_id = $1`, [id]), 1);
  const res = await Promise.all([payExp(p, id, payBody(5000)), payExp(p, id, payBody(5000)), payExp(p, id, payBody(5000))]);
  assert.deepEqual(res.map((x) => x.status).sort(), [201, 409, 409]);                                   // já pago 2000: só uma das três de 5000 cabe
  const sum = await count(`SELECT COALESCE(SUM(amount_cents), 0)::int AS n FROM expense_payments WHERE expense_id = $1`, [id]);
  assert.ok(sum <= 10000, `soma ${sum}`);
});

dbTest('isolamento por profissional: outra conta não vê, não revisa e não paga a despesa', async () => {
  const a = await mkProf('isoA');
  const b = await mkProf('isoB');
  const id = await mkExp(a, { status: 'pendente' });
  assert.equal((await getExp(b, id)).status, 404);
  assert.equal((await payExp(b, id, payBody(100))).status, 404);
  assert.equal((await review(b, id, { to: 'pendente' })).status, 404);
  assert.equal((await api('GET', '/financeiro/despesas', { as: b })).json.despesas.length, 0);
  assert.equal(await count(`SELECT count(*)::int AS n FROM expense_payments WHERE expense_id = $1`, [id]), 0);
});

// ── Gastos (rotas antigas) e banco ─────────────────────────────────────────
dbTest('Gastos: despesa paga ou com pagamento não é excluída nem fica abaixo do já pago; sem pagamento ainda se exclui', async () => {
  const p = await mkProf('gastos');
  const id = await mkExp(p, { amount: 10000, status: 'pendente' });
  assert.equal((await payExp(p, id, payBody(4000))).status, 201);
  assert.equal((await api('DELETE', `/expenses/${id}`, { as: p })).status, 409);
  assert.equal(await count(`SELECT count(*)::int AS n FROM expenses WHERE id = $1`, [id]), 1);
  const put = (amount) => api('PUT', `/expenses/${id}`, { as: p, body: { description: 'Despesa', category: 'Outros', amount_cents: amount, expense_date: daysAgo(2) } });
  assert.equal((await put(3999)).status, 409);
  assert.equal((await put(4000)).status, 200);                                  // igual ao já pago: quita (gatilho do banco só trava abaixo)
  const livre = await mkExp(p, { status: 'pendente' });
  assert.equal((await api('DELETE', `/expenses/${livre}`, { as: p })).status, 204);
  assert.equal(await histCount(livre, 'expense_delete'), 1);                    // exclusão sem pagamento continua deixando histórico
});

dbTest('banco: pagamentos de despesa são append-only (dono e aplicação) e só o dono do dado os enxerga', async () => {
  const p = await mkProf('banco');
  const id = await mkExp(p, { amount: 5000, status: 'pendente' });
  const pay = (await payExp(p, id, payBody(1000))).json.pagamento.id;
  await assert.rejects(owner.query(`UPDATE expense_payments SET amount_cents = 1 WHERE id = $1`, [pay]), /append|somente|não pode/i);
  await assert.rejects(owner.query(`DELETE FROM expense_payments WHERE id = $1`, [pay]), /append|somente|não pode/i);
  await assert.rejects(appPool.query(`UPDATE expense_payments SET amount_cents = 1 WHERE id = $1`, [pay]), /permission denied/);
  await assert.rejects(appPool.query(`DELETE FROM expense_payments WHERE id = $1`, [pay]), /permission denied/);
  await assert.rejects(owner.query(`DELETE FROM expenses WHERE id = $1`, [id]), /foreign key|viola/i);   // sem cascata a partir da despesa
  await assert.rejects(owner.query(`INSERT INTO expense_payments (professional_id, expense_id, amount_cents, method, paid_on) VALUES ($1, $2, 4001, 'pix', $3)`, [p.id, id, daysAgo(1)]), /ultrapassariam/);
});

// ── contas a receber ───────────────────────────────────────────────────────
dbTest('a receber: usa preço final, recebimentos e estornos; separa recebido, pendente e vencido; só concluídos; nada é gravado', async () => {
  const p = await mkProf('rcb');
  const aberto = await mkDone(p, { endedDaysAgo: 2, final: 12000 });
  const r = (await rec(p, aberto, 5000)).rows[0].id;
  await rec(p, aberto, 1000, 'estorno', r);
  const vencido = await mkDone(p, { endedDaysAgo: 30 });                       // 10000 pelo serviço, sem recebimento, há 30 dias
  const quitado = await mkDone(p, { endedDaysAgo: 3 });
  await rec(p, quitado, 10000);
  await mkDone(p, { endedDaysAgo: 1, status: 'confirmado' });                  // não concluído: fora
  const before = await count(`SELECT count(*)::int AS n FROM financial_payments WHERE professional_id = $1`, [p.id]);
  const res = (await api('GET', '/financeiro/a-receber', { as: p })).json;
  const item = Object.fromEntries(res.itens.map((i) => [i.appointmentId, i]));
  assert.equal(res.itens.length, 2);                                           // quitado e não concluído ficam fora por padrão
  assert.deepEqual([item[aberto].valueCents, item[aberto].valueBasis, item[aberto].netReceivedCents, item[aberto].balanceCents, item[aberto].overdue], [12000, 'final', 4000, 8000, false]);
  assert.deepEqual([item[vencido].valueBasis, item[vencido].balanceCents, item[vencido].overdue], ['servico', 10000, true]);
  assert.equal(item[aberto].paymentsPath, `/financeiro/atendimentos/${aberto}/pagamentos`);
  assert.deepEqual(res.totais, { atendimentos: 3, valorCents: 32000, recebidoLiquidoCents: 14000, recebidoCents: 15000, estornadoCents: 1000, saldoPendenteCents: 8000, saldoVencidoCents: 10000, emAberto: 2, vencidos: 1 });
  assert.equal((await api('GET', '/financeiro/a-receber?incluirQuitados=true', { as: p })).json.itens.length, 3);
  assert.equal((await api('GET', '/financeiro/a-receber?graceDays=60', { as: p })).json.totais.saldoVencidoCents, 0);
  assert.equal((await api('GET', '/financeiro/a-receber?graceDays=-1', { as: p })).status, 400);
  assert.equal(await count(`SELECT count(*)::int AS n FROM financial_payments WHERE professional_id = $1`, [p.id]), before);
});

dbTest('a receber: sinal Pix antigo não vira recebimento (segue para conferência), confirmado conta uma vez; outra conta não vê', async () => {
  const p = await mkProf('sinal');
  const other = await mkProf('sinalB');
  const antigo = await mkDone(p, { endedDaysAgo: 2, deposit: 3000, paidAt: new Date(`${daysAgo(10)}T12:00:00Z`) });
  const conf = await mkDone(p, { endedDaysAgo: 2, deposit: 3000, paidAt: new Date(`${daysAgo(10)}T12:00:00Z`) });
  await owner.query(`INSERT INTO financial_payments (professional_id, appointment_id, kind, amount_cents, method, occurred_on, source) VALUES ($1, $2, 'recebimento', 3000, 'pix', $3, 'sinal_pix_confirmado')`, [p.id, conf, daysAgo(1)]);
  const res = (await api('GET', '/financeiro/a-receber', { as: p })).json;
  const item = Object.fromEntries(res.itens.map((i) => [i.appointmentId, i]));
  assert.deepEqual([item[antigo].receivedCents, item[antigo].balanceCents, item[antigo].sinalLegado.naoContadoComoRecebido], [0, 10000, true]);
  assert.deepEqual([item[conf].receivedCents, item[conf].balanceCents, item[conf].sinalLegado.conferido], [3000, 7000, true]);
  assert.equal((await api('GET', '/financeiro/a-receber', { as: other })).json.itens.length, 0);
});

// ── rollbacks ──────────────────────────────────────────────────────────────
dbTest('rollbacks: 028 aborta com pagamento de despesa registrado e a 025 aborta com a 028 aplicada; nada é alterado', async () => {
  const before = await count(`SELECT count(*)::int AS n FROM expense_payments`);
  assert.ok(before > 0);
  await assert.rejects(db.runFile(DOWN28), /rollback 028 abortado/);
  await assert.rejects(db.down({ confirm: 'ARQUIVAR-E-REMOVER-DADOS-FINANCEIROS' }), /rollback 025 abortado: a migration 028/);
  assert.equal(await count(`SELECT count(*)::int AS n FROM expense_payments`), before);
  assert.equal((await one(`SELECT to_regclass('public.financial_payments') IS NOT NULL AS x`)).x, true);
});

// ── cadastro atômico (etapa 7) ─────────────────────────────────────────────
dbTest('cadastro atômico: despesa e situação inicial na mesma operação; falha em qualquer parte não deixa registro', async () => {
  const p = await mkProf('atomo');
  const create = (situacao, extra = {}) => api('POST', '/financeiro/despesas', { as: p, body: { description: 'Atômica', category: 'Materiais', amountCents: 6000, expenseDate: daysAgo(1), situacao, ...extra } });
  const rev = await create({ to: 'a_revisar' });
  assert.deepEqual([rev.status, rev.json.state, rev.json.paymentsCount], [201, 'a_revisar', 0]);
  const pend = await create({ to: 'pendente', dueOn: daysAgo(-5) });
  assert.deepEqual([pend.status, pend.json.state, pend.json.dueOn], [201, 'pendente', daysAgo(-5)]);
  const paga = await create({ to: 'paga', paidOn: daysAgo(1), method: 'boleto' });
  assert.deepEqual([paga.status, paga.json.state, paga.json.paidCents, paga.json.pagamentos.length, paga.json.paidMethod], [201, 'paga', 6000, 1, 'boleto']);
  const before = await count(`SELECT count(*)::int AS n FROM expenses WHERE professional_id = $1`, [p.id]);
  assert.equal((await create({ to: 'paga', paidOn: daysAgo(-2), method: 'pix' })).status, 400);        // pagamento no futuro
  assert.equal((await create({ to: 'pendente', dueOn: '2026-02-30' })).status, 400);
  assert.equal((await create({ to: 'paga', paidOn: daysAgo(1) })).status, 400);                        // sem método
  assert.equal((await create({ to: 'a_revisar' }, { amountCents: 0 })).status, 400);
  assert.equal(await count(`SELECT count(*)::int AS n FROM expenses WHERE professional_id = $1`, [p.id]), before);   // nada ficou pelo caminho
  assert.equal((await api('POST', '/financeiro/despesas', { body: {} })).status, 401);
});
