// Exclusão da profissional com dados financeiros (migration 025): preview, snapshot, cascata, trava de concorrência e a
// ordem das proteções, pela API HTTP REAL (DELETE /admin/professionals/:id e GET .../delete-preview) com a role NÃO-DONA
// da aplicação, em banco descartável (guia em helpers/financeTestDb.js; FINANCEIRO_DELETE_TEST_DB_URL, um banco só para
// este arquivo). Sem a variável, os testes de banco são ignorados. Nenhuma chamada real à Evolution: fetch simulado.
//
// Garantias provadas: (1) sem a 025 a exclusão é a de sempre; (2) com a 025 o preview conta, o snapshot contém e a
// cascata apaga movimentações, histórico e fechamentos, sem tocar em outra conta; (3) movimentação ou histórico gravados
// DEPOIS do snapshot e ANTES da exclusão fazem a exclusão responder 409 sem apagar nada; (4) gravação financeira que
// chega com a exclusão em andamento espera e falha (FK), sem sobrar linha órfã.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import jwt from 'jsonwebtoken';
import pg from 'pg';
import { resolveFinanceTestDb, financeDb } from './helpers/financeTestDb.js';

const VAR = 'FINANCEIRO_DELETE_TEST_DB_URL';
const EMAIL_LIKE = 'fin-del-%@nf.test';
const ROLE = 'nf_fin_del_app';
const T = { timeout: 120_000 };

let skip = false;
let owner;
let db;
let server;
let baseUrl;
let appPool;
let snapshotDir;
let admin;
let secret;
const realFetch = global.fetch;
const evolution = { gate: null, calls: [] };

const one = async (sql, params) => (await owner.query(sql, params)).rows[0];
const count = async (table, where, params) => (await one(`SELECT count(*)::int AS n FROM ${table} WHERE ${where}`, params)).n;
const FIN = ['financial_payments', 'financial_audit_log', 'cash_closings'];
const ALL = ['clients', 'appointments', 'services', 'expenses', ...FIN];

async function mkProf(tag, { instance = null, isAdmin = false } = {}) {
  const id = randomUUID();
  await owner.query(
    `INSERT INTO professionals (id, name, email, password_hash, slug, business_name, is_admin, wa_instance_name) VALUES ($1, $2, $3, 'x', $4, $5, $6, $7)`,
    [id, `Del ${tag}`, `fin-del-${tag}-${id.slice(0, 8)}@nf.test`, `fin-del-${tag}-${id.slice(0, 8)}`, `Studio Del ${tag} ${id.slice(0, 6)}`, isAdmin, instance]);
  const svc = (await one(`INSERT INTO services (professional_id, name, price_cents, duration_minutes) VALUES ($1, 'Serviço', 10000, 30) RETURNING id`, [id])).id;
  const cli = (await one(`INSERT INTO clients (professional_id, name, phone) VALUES ($1, 'Cliente', $2) RETURNING id`, [id, `5531${String(600000000 + Math.floor(Math.random() * 1e8))}`])).id;
  const business = (await one('SELECT business_name FROM professionals WHERE id = $1', [id])).business_name;
  return { id, svc, cli, business, token: jwt.sign({ sub: id, ver: 1 }, secret, { expiresIn: '1h' }) };
}
let day = 0;
async function mkAppt(p, { deposit = null } = {}) {
  const start = new Date(Date.UTC(2026, 5, 1 + (++day), 12, 0, 0));
  return (await one(`INSERT INTO appointments (professional_id, client_id, service_id, starts_at, ends_at, status, price_cents_snapshot, deposit_cents)
      VALUES ($1, $2, $3, $4, $5, 'confirmado', 10000, $6) RETURNING id`, [p.id, p.cli, p.svc, start, new Date(start.getTime() + 3600_000), deposit])).id;
}
async function mkPay(p, a, { kind = 'recebimento', amount = 8000, reverses = null, notes = null, source = 'manual', dayStr = '2026-06-10' } = {}) {
  return (await one(`INSERT INTO financial_payments (professional_id, appointment_id, kind, amount_cents, method, occurred_on, source, reverses_payment_id, notes)
      VALUES ($1, $2, $3, $4, 'pix', $5, $6, $7, $8) RETURNING id`, [p.id, a, kind, amount, dayStr, source, reverses, notes])).id;
}
/** Dados em todas as tabelas financeiras, como numa conta com uso real. */
async function seedFinance(p) {
  const a = await mkAppt(p, { deposit: 3000 });
  const rec = await mkPay(p, a, { amount: 8000 });
  await mkPay(p, a, { kind: 'estorno', amount: 1000, reverses: rec, notes: 'Ajuste combinado', dayStr: '2026-06-12' });
  await mkPay(p, a, { amount: 3000, source: 'sinal_pix_confirmado' });
  await owner.query(`UPDATE appointments SET checked_in_at = now(), final_price_cents = 11000, finance_review = 'realizado' WHERE id = $1`, [a]);
  await owner.query(`INSERT INTO expenses (professional_id, description, amount_cents, expense_date, payment_status, paid_on, paid_method) VALUES ($1, 'Gás', 700, '2026-06-04', 'paga', '2026-06-04', 'pix')`, [p.id]);
  await owner.query(`INSERT INTO cash_closings (professional_id, closing_date, received_cents) VALUES ($1, '2026-06-20', 10000)`, [p.id]);
  return { a, rec };
}

async function call(method, urlPath, { as, body } = {}) {
  const headers = {};
  if (as) headers.cookie = `nailflow_token=${as.token}`;
  let payload;
  if (body !== undefined) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await realFetch(`${baseUrl}${urlPath}`, { method, headers, body: payload });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* 204 */ }
  return { status: res.status, json };
}
const preview = (p) => call('GET', `/admin/professionals/${p.id}/delete-preview`, { as: admin });
const del = (p) => call('DELETE', `/admin/professionals/${p.id}`, { as: admin, body: { businessNameConfirmation: p.business } });
const snapshotOf = async (profId) => {
  const files = (await fs.readdir(snapshotDir)).filter((f) => f.includes(profId));
  assert.equal(files.length, 1, `um snapshot da conta ${profId}`);
  const full = path.join(snapshotDir, files[0]);
  return { json: JSON.parse(await fs.readFile(full, 'utf8')), mode: (await fs.stat(full)).mode & 0o777, text: await fs.readFile(full, 'utf8') };
};
async function waitForLockWait(timeoutMs = 8000) {
  const t0 = Date.now();
  for (;;) {
    const n = (await one(`SELECT count(*)::int AS n FROM pg_stat_activity WHERE usename = $1 AND wait_event_type = 'Lock'`, [ROLE])).n;
    if (n > 0) return;
    if (Date.now() - t0 > timeoutMs) throw new Error('nenhuma sessão da aplicação ficou esperando lock');
    await new Promise((r) => setTimeout(r, 25));
  }
}

before(async () => {
  const r = await resolveFinanceTestDb(process.env, VAR);
  if (r.skip) { skip = r.skip; return; }
  owner = new pg.Pool({ connectionString: r.url, options: '-c TimeZone=UTC', max: 6 });
  db = financeDb(owner);
  await db.reset({ emailLike: EMAIL_LIKE, roles: [ROLE] });
  await db.createAppRole(ROLE);

  secret = 'fin-delete-test-secret';
  snapshotDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fin-del-snap-'));
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = secret;
  process.env.DATABASE_URL = db.appUrl(r.url, ROLE);
  process.env.DELETED_PROFESSIONAL_BACKUP_DIR = snapshotDir;
  process.env.EVOLUTION_API_URL = 'http://127.0.0.1:9';
  process.env.EVOLUTION_API_KEY ||= 'chave-de-teste';
  for (const k of ['N8N_WEBHOOK_CONFIRMED_URL', 'N8N_WEBHOOK_CANCELLED_URL', 'N8N_WEBHOOK_REJECTED_URL', 'N8N_WEBHOOK_MESSAGE_URL', 'N8N_BOT_WEBHOOK_URL']) process.env[k] = '';
  // Evolution simulada: a exclusão da instância pode ser segurada por um portão para manter a transação aberta.
  global.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : (input?.url ?? String(input));
    const m = url.match(/\/instance\/delete\/([^/?]+)/);
    if (m && decodeURIComponent(m[1]).startsWith('fin-del-')) {
      evolution.calls.push(decodeURIComponent(m[1]));
      return (async () => { if (evolution.gate) await evolution.gate; return new Response('{}', { status: 200 }); })();
    }
    return realFetch(input, init);
  };
  ({ pool: appPool } = await import('../src/config/db.js'));
  const { default: app } = await import('../src/server.js');
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  admin = await mkProf('admin', { isAdmin: true });
});

after(async () => {
  if (!owner) return;
  try {
    global.fetch = realFetch;
    if (server) await new Promise((resolve) => server.close(resolve));
    await appPool?.end().catch(() => {});
    await owner.query(`DELETE FROM admin_audit_log WHERE actor_id = $1`, [admin?.id]).catch(() => {});
    await db.reset({ emailLike: EMAIL_LIKE, roles: [ROLE] });
    if (snapshotDir) await fs.rm(snapshotDir, { recursive: true, force: true });
  } finally {
    await owner.end();
  }
});

const dbTest = (name, fn) => test(name, T, async (t) => { if (skip) return t.skip(skip); await fn(t); });

dbTest('sem a 025: preview e exclusão continuam como antes (sem chaves financeiras no snapshot)', async () => {
  assert.equal(await db.hasStructure(), false);
  const p = await mkProf('legado');
  await mkAppt(p, { deposit: 2000 });
  await owner.query(`INSERT INTO expenses (professional_id, description, amount_cents, expense_date) VALUES ($1, 'Despesa antiga', 900, '2026-05-01')`, [p.id]);
  const pv = await preview(p);
  assert.equal(pv.status, 200);
  assert.equal(pv.json.appointments, 1);
  assert.equal(pv.json.expenses, 1);
  assert.equal(pv.json.financialPayments, 0);
  assert.equal(pv.json.financialAuditEntries, 0);
  assert.equal(pv.json.cashClosings, 0);
  assert.equal((await del(p)).status, 204);
  const snap = await snapshotOf(p.id);
  assert.equal(snap.json.expenses.length, 1);
  assert.ok(!('financial_payments' in snap.json) && !('financial_audit_log' in snap.json) && !('cash_closings' in snap.json));
  assert.ok(!('payment_status' in snap.json.expenses[0]), 'sem a 025 a despesa não tem as colunas novas');
  for (const t of ['clients', 'appointments', 'services', 'expenses']) assert.equal(await count(t, 'professional_id = $1', [p.id]), 0);
  assert.equal(await count('professionals', 'id = $1', [p.id]), 0);
});

dbTest('com a 025 (e os grants): preview conta as tabelas financeiras', async () => {
  await db.up();
  await db.grant(ROLE);
  const p = await mkProf('preview');
  await seedFinance(p);
  const pv = await preview(p);
  assert.equal(pv.status, 200);
  assert.equal(pv.json.financialPayments, 3);
  assert.equal(pv.json.cashClosings, 1);
  assert.equal(pv.json.financialAuditEntries, await count('financial_audit_log', 'professional_id = $1', [p.id]));
  assert.ok(pv.json.financialAuditEntries >= 7);
  assert.equal(pv.json.expenses, 1);
  const none = await mkProf('preview-vazio');
  const pv0 = await preview(none);
  assert.equal(pv0.json.financialPayments, 0);
  assert.equal(pv0.json.cashClosings, 0);
  state.previewProf = p;
});

const state = {};

dbTest('exclusão: snapshot contém movimentações, histórico, fechamentos e colunas novas; a cascata, como role não-dona, apaga só a conta', async () => {
  const gone = state.previewProf;
  const keep = await mkProf('fica');
  await seedFinance(keep);
  const before = {};
  for (const t of ALL) before[t] = await count(t, 'professional_id = $1', [gone.id]);
  const keepBefore = {};
  for (const t of ALL) keepBefore[t] = await count(t, 'professional_id = $1', [keep.id]);
  assert.ok(before.financial_payments === 3 && before.cash_closings === 1 && before.financial_audit_log >= 7);

  assert.equal((await del(gone)).status, 204);

  const snap = await snapshotOf(gone.id);
  assert.equal(snap.mode, 0o600);
  assert.ok(!/password_hash/.test(snap.text) && !('password_hash' in snap.json.professional));
  for (const t of ALL) assert.equal(snap.json[t].length, before[t], `snapshot de ${t}`);
  assert.deepEqual(snap.json.financial_payments.map((x) => x.amount_cents).sort((a, b) => a - b), [1000, 3000, 8000]);
  assert.equal(snap.json.cash_closings[0].received_cents, 10000);
  assert.equal(snap.json.expenses[0].payment_status, 'paga', 'colunas novas de despesas no snapshot');
  assert.equal(snap.json.appointments[0].finance_review, 'realizado', 'colunas novas de atendimentos no snapshot');
  assert.equal(snap.json.appointments[0].final_price_cents, 11000);
  assert.ok(snap.json.financial_audit_log.some((x) => x.action === 'payment_refund'));

  for (const t of [...ALL, 'recurring_groups']) assert.equal(await count(t, 'professional_id = $1', [gone.id]), 0, `${t} da conta excluída`);
  assert.equal(await count('professionals', 'id = $1', [gone.id]), 0);
  for (const t of ALL) assert.equal(await count(t, 'professional_id = $1', [keep.id]), keepBefore[t], `${t} da outra conta intacto`);
  state.keep = keep;
});

dbTest('concorrência: movimentação gravada DEPOIS do snapshot e ANTES da exclusão faz a exclusão responder 409 e não apaga nada', async () => {
  const p = await mkProf('corrida-pagto');
  const { a } = await seedFinance(p);
  const payBefore = await count('financial_payments', 'professional_id = $1', [p.id]);
  // um escritor grava um pagamento e ainda não confirma: segura FOR KEY SHARE na conta, e o snapshot (que lê só o
  // confirmado) não o inclui
  const writer = await owner.connect();
  try {
    await writer.query('BEGIN');
    await writer.query(`INSERT INTO financial_payments (professional_id, appointment_id, kind, amount_cents, method, occurred_on)
        VALUES ($1, $2, 'recebimento', 1234, 'dinheiro', '2026-06-15')`, [p.id, a]);
    const pending = del(p);
    await waitForLockWait();
    await writer.query('COMMIT');
    const res = await pending;
    assert.equal(res.status, 409);
    assert.match(res.json.error, /movimentação financeira/);
  } finally {
    await writer.query('ROLLBACK').catch(() => {});
    writer.release();
  }
  assert.equal(await count('professionals', 'id = $1', [p.id]), 1, 'a conta não foi excluída');
  assert.equal(await count('financial_payments', 'professional_id = $1', [p.id]), payBefore + 1, 'o pagamento novo continua gravado');
  const snap = await snapshotOf(p.id); // o snapshot foi gravado antes e fica como rede de segurança
  assert.equal(snap.json.financial_payments.length, payBefore);
  // sem concorrência, a mesma conta é excluída normalmente e o snapshot novo já inclui o pagamento
  await fs.rm(snapshotDir, { recursive: true, force: true });
  await fs.mkdir(snapshotDir, { recursive: true, mode: 0o700 });
  assert.equal((await del(p)).status, 204);
  assert.equal((await snapshotOf(p.id)).json.financial_payments.length, payBefore + 1);
  assert.equal(await count('financial_payments', 'professional_id = $1', [p.id]), 0);
});

dbTest('concorrência: histórico gravado depois do snapshot (alteração de despesa não confirmada) também faz a exclusão responder 409', async () => {
  const p = await mkProf('corrida-hist');
  await seedFinance(p);
  const e = (await one(`INSERT INTO expenses (professional_id, description, amount_cents, expense_date) VALUES ($1, 'Corrida', 100, '2026-06-01') RETURNING id`, [p.id])).id;
  const auditBefore = await count('financial_audit_log', 'professional_id = $1', [p.id]);
  const writer = await owner.connect();
  try {
    await writer.query('BEGIN');
    await writer.query(`UPDATE expenses SET amount_cents = 150 WHERE id = $1`, [e]); // o trigger grava histórico (FK para a conta)
    const pending = del(p);
    await waitForLockWait();
    await writer.query('COMMIT');
    const res = await pending;
    assert.equal(res.status, 409);
  } finally {
    await writer.query('ROLLBACK').catch(() => {});
    writer.release();
  }
  assert.equal(await count('professionals', 'id = $1', [p.id]), 1);
  assert.equal(await count('financial_audit_log', 'professional_id = $1', [p.id]), auditBefore + 1);
  state.cleanup = p;
});

dbTest('concorrência: gravação financeira que chega com a exclusão em andamento espera e falha; não sobra linha órfã', async () => {
  const p = await mkProf('corrida-tarde', { instance: `fin-del-${randomUUID().slice(0, 8)}` });
  const { a } = await seedFinance(p);
  let release;
  evolution.gate = new Promise((resolve) => { release = resolve; });
  evolution.calls.length = 0;
  try {
    // a exclusão apaga a conta e fica segurando a transação aberta no passo da Evolution (antes do COMMIT)
    const pending = del(p);
    const t0 = Date.now();
    while (evolution.calls.length === 0) {
      if (Date.now() - t0 > 8000) throw new Error('a exclusão não chegou ao passo da Evolution');
      await new Promise((r) => setTimeout(r, 25));
    }
    // um escritor chega agora: precisa de FOR KEY SHARE na conta, que está apagada (não confirmada) pela exclusão
    const writer = await owner.connect();
    const insert = writer.query(`INSERT INTO financial_payments (professional_id, appointment_id, kind, amount_cents, method, occurred_on)
        VALUES ($1, $2, 'recebimento', 999, 'pix', '2026-06-16')`, [p.id, a]).then(() => 'gravou', (err) => err);
    await waitForLockWaitFor(owner);
    release();
    assert.equal((await pending).status, 204);
    const outcome = await insert;
    writer.release();
    assert.notEqual(outcome, 'gravou', 'o escritor não pode gravar na conta excluída');
    assert.equal(outcome.code, '23503', `violação de FK esperada, recebido: ${outcome.message}`);
  } finally {
    release?.();
    evolution.gate = null;
  }
  assert.equal(await count('professionals', 'id = $1', [p.id]), 0);
  for (const t of FIN) assert.equal(await count(t, 'professional_id = $1', [p.id]), 0, `${t}: nenhuma linha órfã`);
});

// espera uma sessão QUALQUER (do dono, o escritor) bloqueada por lock
async function waitForLockWaitFor(pool) {
  const t0 = Date.now();
  for (;;) {
    const n = (await pool.query(`SELECT count(*)::int AS n FROM pg_stat_activity WHERE usename <> $1 AND wait_event_type = 'Lock' AND query ILIKE '%financial_payments%'`, [ROLE])).rows[0].n;
    if (n > 0) return;
    if (Date.now() - t0 > 8000) throw new Error('o escritor não ficou esperando lock');
    await new Promise((r) => setTimeout(r, 25));
  }
}

dbTest('exclusão de conta sem movimentação financeira continua simples com a 025 aplicada', async () => {
  const p = await mkProf('sem-fin');
  await mkAppt(p);
  assert.equal((await del(p)).status, 204);
  const snap = await snapshotOf(p.id);
  assert.deepEqual([snap.json.financial_payments.length, snap.json.cash_closings.length], [0, 0]);
  assert.equal(await count('professionals', 'id = $1', [p.id]), 0);
});

dbTest('exclusão com um schema de arquivo existente: o snapshot não tem as tabelas financeiras e os dados da conta permanecem SÓ no arquivo', async () => {
  const p = await mkProf('arquivo');
  await seedFinance(p);
  const before = {};
  for (const t of FIN) before[t] = await count(t, 'professional_id = $1', [p.id]);
  assert.ok(before.financial_payments === 3 && before.cash_closings === 1 && before.financial_audit_log >= 7);

  await db.down({ confirm: 'ARQUIVAR-E-REMOVER-DADOS-FINANCEIROS' }); // arquiva e remove a estrutura
  const [schema] = await db.archives();
  assert.ok(schema);
  assert.equal(await db.hasStructure(), false);
  const inArchive = async (profId) => {
    const out = {};
    for (const t of FIN) out[t] = (await one(`SELECT count(*)::int AS n FROM "${schema}"."${t}" WHERE professional_id = $1`, [profId])).n;
    return out;
  };
  assert.deepEqual(await inArchive(p.id), before, 'o arquivo guarda os dados da conta');

  // com a estrutura ausente, a exclusão pela API não conhece as tabelas financeiras (nada a apagar nelas)
  const pv = await preview(p);
  assert.equal(pv.status, 200);
  assert.deepEqual([pv.json.financialPayments, pv.json.financialAuditEntries, pv.json.cashClosings], [0, 0, 0]);
  assert.equal((await del(p)).status, 204);
  const snap = await snapshotOf(p.id);
  assert.ok(!FIN.some((t) => t in snap.json), 'o snapshot não contém as tabelas financeiras (elas não existiam nesse momento)');
  assert.ok(snap.json.appointments.length === 1 && !('finance_review' in snap.json.appointments[0]), 'só as colunas anteriores à 025');
  assert.equal(await count('professionals', 'id = $1', [p.id]), 0);

  // a exclusão da conta NÃO apagou os dados dela no arquivo
  assert.deepEqual(await inArchive(p.id), before);

  // recuperação: reaplicar a 025; a restauração estrita recusa (conta excluída); com a opção explícita restaura as outras contas
  await db.up();
  await assert.rejects(db.restore(schema), /pertencem a conta\(s\) excluída\(s\)/);
  await db.restore(schema, { skipDeleted: true });
  assert.equal(await count('financial_payments', 'professional_id = $1', [p.id]), 0, 'a conta excluída não volta');
  assert.deepEqual(await inArchive(p.id), before, 'e continua guardada no arquivo até o descarte manual');
  const livePayments = (await one(`SELECT count(*)::int AS n FROM financial_payments`)).n;
  const archivedExisting = (await one(`SELECT count(*)::int AS n FROM "${schema}".financial_payments t WHERE EXISTS (SELECT 1 FROM professionals x WHERE x.id = t.professional_id)`)).n;
  assert.equal(livePayments, archivedExisting, 'restauradas exatamente as movimentações das contas que existem');
  assert.ok(livePayments > 0);
});
