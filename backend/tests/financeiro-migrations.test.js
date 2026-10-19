// Testes da migration 025 (Financeiro, etapa 1): estrutura, restrições, histórico, isolamento, cascata, permissões
// e rollback. SOMENTE em banco DESCARTÁVEL (guarda em helpers/financeTestDb.js). Sem FINANCEIRO_MIGRATION_TEST_DB_URL
// os testes que tocam o banco são ignorados; a suíte normal (`npm test`) não é afetada.
//
// Os testes rodam em ordem, sobre o mesmo banco: preservação dos dados legados -> idempotência -> restrições ->
// auditoria -> permissões -> rollback. Cada um cria os dados de que precisa (profissionais "fin-test-*").
// Nada aqui toca banco persistente: sem a variável, nada roda.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { assessUrl, DISPOSABLE_MARKER } from './helpers/supportTestDb.js';
import { resolveFinanceTestDb, psqlScript, projectionHashes } from './helpers/financeTestDb.js';

const MIGRATIONS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../db/migrations');
const UP = '025_financeiro_base.sql';
const DOWN = '_rollback/025_financeiro_base.down.sql';
const GRANT = '_ops/025_grant_app_role.sql';
const CONFIRM = 'ARQUIVAR-E-REMOVER-DADOS-FINANCEIROS';
const APP_ROLE = 'nf_fin_app_test';
const HASH = createHash('sha256').update('x').digest('hex');
const T = { timeout: 120_000 };

let skip = false;
let pool;
let baseline;     // impressão digital do schema ANTES da 025
let legacyBefore; // impressão digital dos dados legados ANTES da 025
let legProf;

const q = (sql, params) => pool.query(sql, params);
const readSql = (rel) => fs.readFile(path.join(MIGRATIONS, rel), 'utf8');

async function runFile(rel, { confirm } = {}) {
  const sql = await readSql(rel);
  const client = await pool.connect();
  let failure;
  try {
    if (confirm) await client.query(`SET financeiro.confirm_destructive_rollback = '${confirm}'`);
    await client.query(sql);
  } catch (err) {
    failure = err;
    await client.query('ROLLBACK').catch(() => {});
  } finally {
    await client.query('RESET financeiro.confirm_destructive_rollback').catch(() => { failure = failure ?? new Error('RESET falhou'); });
    client.release(failure && failure.message === 'RESET falhou' ? failure : undefined);
  }
  if (failure) throw failure;
}

// Transação com configurações de sessão local (motivo/autor) e um segundo cliente opcional.
async function tx(fn, settings = {}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const [k, v] of Object.entries(settings)) await client.query('SELECT set_config($1, $2, true)', [k, v]);
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
const withReason = (reason) => ({ 'nailflow.audit_reason': reason });

async function rejectsWith(promise, code, re) {
  await assert.rejects(promise, (e) => {
    assert.equal(e.code, code, `código esperado ${code}, recebido ${e.code}: ${e.message}`);
    if (re) assert.match(e.message, re);
    return true;
  });
}

async function fingerprint() {
  const { rows } = await q(`
    SELECT md5(string_agg(x, E'\\n' ORDER BY x)) AS h FROM (
      SELECT 'col:' || table_name || '.' || column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, '') AS x
        FROM information_schema.columns WHERE table_schema = 'public'
      UNION ALL SELECT 'con:' || conrelid::regclass::text || ':' || conname || ':' || pg_get_constraintdef(oid)
        FROM pg_constraint WHERE connamespace = 'public'::regnamespace
      UNION ALL SELECT 'idx:' || indexdef FROM pg_indexes WHERE schemaname = 'public'
      UNION ALL SELECT 'trg:' || tgrelid::regclass::text || ':' || pg_get_triggerdef(oid)
        FROM pg_trigger WHERE NOT tgisinternal AND tgrelid::regclass::text !~ '^financeiro_arquivo_'
      UNION ALL SELECT 'fn:' || p.oid::regprocedure::text FROM pg_proc p WHERE pronamespace = 'public'::regnamespace
    ) s`);
  return rows[0].h;
}

async function legacyHash(profId) {
  const a = await q(`SELECT md5(coalesce(string_agg(row_to_json(t)::text, '|' ORDER BY id), '')) AS h FROM (
      SELECT id, professional_id, client_id, service_id, starts_at, ends_at, status, notes, price_cents_snapshot, reminder_sent,
             created_at, updated_at, recurring_group_id, cancel_reason, source, expires_at, deposit_cents, paid_at
        FROM appointments WHERE professional_id = $1) t`, [profId]);
  const e = await q(`SELECT md5(coalesce(string_agg(row_to_json(t)::text, '|' ORDER BY id), '')) AS h FROM (
      SELECT id, professional_id, description, category, amount_cents, expense_date, notes, created_at, updated_at
        FROM expenses WHERE professional_id = $1) t`, [profId]);
  return `${a.rows[0].h}:${e.rows[0].h}`;
}

let seq = 0;
async function mkProf(tag) {
  const id = randomUUID();
  await q(`INSERT INTO professionals (id, name, email, password_hash, slug) VALUES ($1, $2, $3, $4, $5)`,
    [id, `Fin ${tag}`, `fin-test-${tag}-${id.slice(0, 8)}@nf.test`, 'x', `fin-test-${tag}-${id.slice(0, 8)}`]);
  const svc = (await q(`INSERT INTO services (professional_id, name, price_cents, duration_minutes) VALUES ($1, 'Serviço', 10000, 30) RETURNING id`, [id])).rows[0].id;
  const cli = (await q(`INSERT INTO clients (professional_id, name, phone) VALUES ($1, 'Cliente', $2) RETURNING id`, [id, `5511${String(900000000 + (++seq))}`])).rows[0].id;
  return { id, svc, cli };
}
async function mkAppt(p, { status = 'confirmado', deposit = null, paidAt = null, price = 10000, hours = 1 } = {}) {
  const start = new Date(Date.UTC(2026, 5, 1 + (++seq), 12, 0, 0));
  const end = new Date(start.getTime() + hours * 3600_000);
  return (await q(`INSERT INTO appointments (professional_id, client_id, service_id, starts_at, ends_at, status, price_cents_snapshot, deposit_cents, paid_at)
                   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [p.id, p.cli, p.svc, start, end, status, price, deposit, paidAt])).rows[0].id;
}
const payIns = (p, appt, { kind = 'recebimento', amount = 10000, method = 'pix', day = '2026-06-10', source = 'manual', reverses = null, notes = null, key = null, hash = null } = {}) =>
  q(`INSERT INTO financial_payments (professional_id, appointment_id, kind, amount_cents, method, occurred_on, source, reverses_payment_id, notes, idempotency_key, request_hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
    [p.id, appt, kind, amount, method, day, source, reverses, notes, key, hash]);
const auditOf = (entityId) => q(`SELECT action, reason, actor_id, before_data, after_data FROM financial_audit_log WHERE entity_id = $1 ORDER BY seq`, [entityId]).then((r) => r.rows);
const count = async (table, where = 'true', params = []) => (await q(`SELECT count(*)::int AS n FROM ${table} WHERE ${where}`, params)).rows[0].n;

async function wipeTestData() {
  await q(`DELETE FROM professionals WHERE email LIKE 'fin-test-%@nf.test'`);
}
async function dropArchives() {
  const { rows } = await q(`SELECT nspname FROM pg_namespace WHERE nspname LIKE 'financeiro\\_arquivo\\_%'`);
  for (const r of rows) await q(`DROP SCHEMA "${r.nspname}" CASCADE`);
}

before(async () => {
  const r = await resolveFinanceTestDb();
  if (r.skip) { skip = r.skip; return; }
  pool = new pg.Pool({ connectionString: r.url, options: '-c TimeZone=UTC', max: 6 });
  // Estado limpo: remove uma 025 deixada por execução anterior (com arquivo, se houver dados) e os dados de teste.
  await q('SELECT 1');
  if ((await q(`SELECT to_regclass('public.financial_payments') IS NOT NULL AS x`)).rows[0].x) {
    await wipeTestData();
    await runFile(DOWN, { confirm: CONFIRM });
  }
  await wipeTestData();
  await dropArchives();
  await q(`DROP ROLE IF EXISTS ${APP_ROLE}`).catch(() => {});
  baseline = await fingerprint();
  // Dados LEGADOS, criados antes da 025 e nunca mais tocados pelos testes: servem de prova de preservação.
  legProf = await mkProf('legado');
  await mkAppt(legProf, { status: 'pendente' });
  await mkAppt(legProf, { status: 'confirmado' });
  await mkAppt(legProf, { status: 'concluido' });
  await mkAppt(legProf, { status: 'nao_compareceu' });
  await mkAppt(legProf, { status: 'aguardando_pagamento', deposit: 3000 });
  await mkAppt(legProf, { status: 'confirmado', deposit: 5000, paidAt: new Date('2026-06-01T10:00:00Z') });
  for (const d of ['2026-05-02', '2026-05-20', '2026-06-03']) {
    await q(`INSERT INTO expenses (professional_id, description, category, amount_cents, expense_date) VALUES ($1, 'Despesa legada', 'Outros', 2500, $2)`, [legProf.id, d]);
  }
  legacyBefore = await legacyHash(legProf.id);
});

after(async () => {
  if (!pool) return;
  try {
    if ((await q(`SELECT to_regclass('public.financial_payments') IS NOT NULL AS x`)).rows[0].x) {
      await wipeTestData();
      await runFile(DOWN, { confirm: CONFIRM });
    }
    await wipeTestData();
    await dropArchives();
    await q(`DROP OWNED BY ${APP_ROLE}`).catch(() => {});
    await q(`DROP ROLE IF EXISTS ${APP_ROLE}`).catch(() => {});
  } finally {
    await pool.end();
  }
});

const dbTest = (name, fn) => test(name, T, async (t) => { if (skip) return t.skip(skip); await fn(t); });

// ── Guarda do alvo ─────────────────────────────────────────────────────────
test('guarda: aceita só banco de loopback, nf_*_test e com opt-in', () => {
  const ok = 'postgres://u@127.0.0.1:55434/nf_fin_test';
  assert.deepEqual(assessUrl(ok, { NAILFLOW_ALLOW_TEST_DDL: '1' }).why, []);
  assert.ok(assessUrl(ok, {}).why.some((w) => /opt-in/.test(w)));
  assert.ok(assessUrl('postgres://u@db.exemplo.com/nf_fin_test', { NAILFLOW_ALLOW_TEST_DDL: '1' }).why.some((w) => /loopback/.test(w)));
  assert.ok(assessUrl('postgres://u@127.0.0.1/nailflow', { NAILFLOW_ALLOW_TEST_DDL: '1' }).why.some((w) => /nf_\*_test/.test(w)));
  assert.ok(assessUrl('postgres://u@127.0.0.1/nf_fin_test?host=outro', { NAILFLOW_ALLOW_TEST_DDL: '1' }).why.some((w) => /host/.test(w)));
  assert.equal(DISPOSABLE_MARKER, 'NAILFLOW_DISPOSABLE_TEST_DB');
});

// ── Preservação dos dados existentes ───────────────────────────────────────
dbTest('aplicar a 025 não altera nem classifica nenhum dado legado', async () => {
  const apptsBefore = await count('appointments');
  const expBefore = await count('expenses');
  await runFile(UP);
  assert.equal(await legacyHash(legProf.id), legacyBefore, 'linhas legadas (colunas antigas) idênticas');
  assert.equal(await count('appointments'), apptsBefore);
  assert.equal(await count('expenses'), expBefore);
  // Atendimentos: nenhuma coluna nova preenchida (nada vira realizado/com check-in/revisado/valor final).
  assert.equal(await count('appointments', `checked_in_at IS NOT NULL OR final_price_cents IS NOT NULL OR final_price_set_at IS NOT NULL
                                              OR finance_review IS NOT NULL OR finance_reviewed_at IS NOT NULL`), 0);
  // Despesas: todas "a revisar", sem data de pagamento (expense_date NÃO é prova de pagamento).
  assert.equal(await count('expenses', `payment_status = 'a_revisar' AND paid_on IS NULL AND paid_method IS NULL AND due_on IS NULL`), expBefore);
  // Sinais Pix antigos NÃO viram pagamentos; nada foi gravado no histórico.
  assert.equal(await count('financial_payments'), 0);
  assert.equal(await count('financial_audit_log'), 0);
  assert.equal(await count('cash_closings'), 0);
  assert.equal(await count('appointments', 'deposit_cents IS NOT NULL'), 2);
  assert.equal(await count('appointments', 'paid_at IS NOT NULL'), 1);
});

dbTest('reaplicar a 025 não muda nada (estrutura idêntica) e preserva os dados', async () => {
  const fp = await fingerprint();
  await runFile(UP);
  assert.equal(await fingerprint(), fp);
  assert.equal(await legacyHash(legProf.id), legacyBefore);
  assert.equal(await count('financial_audit_log'), 0);
});

dbTest('estrutura: FKs, cascatas, índices parciais e funções com search_path fixo', async () => {
  const { rows: fks } = await q(`SELECT conname, confdeltype, condeferrable, condeferred FROM pg_constraint
    WHERE contype = 'f' AND conrelid IN ('financial_payments'::regclass, 'financial_audit_log'::regclass, 'cash_closings'::regclass)`);
  const by = Object.fromEntries(fks.map((f) => [f.conname, f]));
  for (const c of ['financial_payments_professional_fkey', 'financial_audit_log_professional_fkey', 'cash_closings_professional_fkey']) {
    assert.equal(by[c].confdeltype, 'c', `${c} deve ser ON DELETE CASCADE`);
  }
  assert.equal(by.financial_payments_appointment_fkey.confdeltype, 'a');
  assert.equal(by.financial_payments_appointment_fkey.condeferred, true);
  assert.equal(by.financial_payments_reverses_fkey.confdeltype, 'a');
  const { rows: idx } = await q(`SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname IN
    ('uq_financial_payments_idempotency','uq_financial_payments_deposit_once','idx_appointments_finance_review_pending','idx_expenses_pending','idx_expenses_paid_on')`);
  assert.equal(idx.length, 5);
  assert.match(idx.find((i) => i.indexname === 'uq_financial_payments_idempotency').indexdef, /UNIQUE.*WHERE \(idempotency_key IS NOT NULL\)/);
  assert.match(idx.find((i) => i.indexname === 'idx_appointments_finance_review_pending').indexdef, /finance_reviewed_at IS NULL/);
  const { rows: fns } = await q(`SELECT proname FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname LIKE 'fin\\_%'
    AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(proconfig, '{}')) c WHERE c = 'search_path=pg_catalog, pg_temp')`);
  assert.deepEqual(fns, []);
});

// ── Atendimentos: check-in, valor final, revisão ───────────────────────────
dbTest('atendimentos: restrições das colunas novas', async () => {
  const p = await mkProf('appt');
  const a = await mkAppt(p);
  await rejectsWith(q(`UPDATE appointments SET final_price_cents = -1 WHERE id = $1`, [a]), '23514');
  await rejectsWith(q(`UPDATE appointments SET finance_review = 'pago' WHERE id = $1`, [a]), '23514');
  await rejectsWith(q(`UPDATE appointments SET final_price_set_at = now() WHERE id = $1`, [a]), '23514', /pair_check/);
  await rejectsWith(q(`UPDATE appointments SET finance_reviewed_at = now() WHERE id = $1`, [a]), '23514', /pair_check/);
  // alterar outros campos não toca nas colunas novas nem gera histórico
  await q(`UPDATE appointments SET notes = 'x' WHERE id = $1`, [a]);
  assert.deepEqual(await auditOf(a), []);
});

dbTest('atendimentos: check-in, valor final e revisão geram histórico; corrigir exige motivo', async () => {
  const p = await mkProf('appt2');
  const a = await mkAppt(p);
  await q(`UPDATE appointments SET checked_in_at = '2026-06-02T12:05:00Z' WHERE id = $1`, [a]);
  await q(`UPDATE appointments SET final_price_cents = 9000 WHERE id = $1`, [a]);
  const row = (await q(`SELECT final_price_set_at, status FROM appointments WHERE id = $1`, [a])).rows[0];
  assert.ok(row.final_price_set_at, 'final_price_set_at derivado pelo banco');
  assert.equal(row.status, 'confirmado', 'o status não muda sozinho');
  await q(`UPDATE appointments SET finance_review = 'realizado' WHERE id = $1`, [a]);
  assert.ok((await q(`SELECT finance_reviewed_at FROM appointments WHERE id = $1`, [a])).rows[0].finance_reviewed_at);
  assert.deepEqual((await auditOf(a)).map((x) => x.action), ['appointment_checkin', 'appointment_final_price', 'appointment_review']);

  await rejectsWith(q(`UPDATE appointments SET final_price_cents = 8000 WHERE id = $1`, [a]), '23514', /motivo/);
  await rejectsWith(q(`UPDATE appointments SET checked_in_at = NULL WHERE id = $1`, [a]), '23514', /motivo/);
  await rejectsWith(q(`UPDATE appointments SET finance_review = 'cancelado' WHERE id = $1`, [a]), '23514', /motivo/);
  const actor = randomUUID();
  await tx((c) => c.query(`UPDATE appointments SET final_price_cents = 8000 WHERE id = $1`, [a]),
    { ...withReason('Desconto combinado com a cliente'), 'nailflow.actor_id': actor });
  const last = (await auditOf(a)).at(-1);
  assert.equal(last.action, 'appointment_final_price');
  assert.equal(last.reason, 'Desconto combinado com a cliente');
  assert.equal(last.actor_id, actor);
  assert.deepEqual(last.before_data, { final_price_cents: 9000 });
  assert.deepEqual(last.after_data, { final_price_cents: 8000 });
});

// ── Despesas ───────────────────────────────────────────────────────────────
dbTest('despesas: restrições do estado de pagamento; despesa nova nasce "a revisar"', async () => {
  const p = await mkProf('exp');
  const ins = (extra = '', vals = []) => q(`INSERT INTO expenses (professional_id, description, amount_cents, expense_date ${extra.split('|')[0] ?? ''})
      VALUES ($1, 'Aluguel', 5000, '2026-06-05' ${extra.split('|')[1] ?? ''}) RETURNING id, payment_status`, [p.id, ...vals]);
  const e = (await ins()).rows[0];
  assert.equal(e.payment_status, 'a_revisar', 'o código atual não informa o estado: nasce a revisar, nunca paga');
  await rejectsWith(ins(', payment_status|, \'paga\''), '23514', /payment_state_check/);                       // paga sem paid_on
  await rejectsWith(ins(', payment_status, paid_on|, \'pendente\', \'2026-06-05\''), '23514', /payment_state_check/); // pendente com paid_on
  await rejectsWith(ins(', payment_status, paid_on, paid_method|, \'paga\', \'2026-06-05\', \'ouro\''), '23514', /paid_method_check/);
  await rejectsWith(ins(', payment_status|, \'quitada\''), '23514', /payment_status_check/);
  const ok = (await ins(', payment_status, paid_on, paid_method|, \'paga\', \'2026-06-06\', \'pix\'')).rows[0];
  assert.equal(ok.payment_status, 'paga');
  assert.equal((await auditOf(e.id))[0].action, 'expense_create');
});

dbTest('despesas: pagar, corrigir despesa paga exige motivo, apagar gera histórico', async () => {
  const p = await mkProf('exp2');
  const e = (await q(`INSERT INTO expenses (professional_id, description, amount_cents, expense_date) VALUES ($1, 'Material', 4000, '2026-06-05') RETURNING id`, [p.id])).rows[0].id;
  // a revisar -> pendente -> paga (a primeira passagem para paga não exige motivo)
  await q(`UPDATE expenses SET payment_status = 'pendente', due_on = '2026-06-20' WHERE id = $1`, [e]);
  await q(`UPDATE expenses SET payment_status = 'paga', paid_on = '2026-06-18', paid_method = 'dinheiro' WHERE id = $1`, [e]);
  assert.deepEqual((await auditOf(e)).map((x) => x.action), ['expense_create', 'expense_status', 'expense_status']);
  await q(`UPDATE expenses SET notes = 'observação' WHERE id = $1`, [e]); // campo sem efeito financeiro: segue livre
  await rejectsWith(q(`UPDATE expenses SET amount_cents = 4500 WHERE id = $1`, [e]), '23514', /motivo/);
  await rejectsWith(q(`UPDATE expenses SET payment_status = 'pendente', paid_on = NULL, paid_method = NULL WHERE id = $1`, [e]), '23514', /motivo/);
  await tx((c) => c.query(`UPDATE expenses SET amount_cents = 4500 WHERE id = $1`, [e]), withReason('Valor do recibo conferido'));
  const last = (await auditOf(e)).at(-1);
  assert.equal(last.reason, 'Valor do recibo conferido');
  assert.equal(last.before_data.amount_cents, 4000);
  assert.equal(last.after_data.amount_cents, 4500);
  await q(`DELETE FROM expenses WHERE id = $1`, [e]);
  const del = (await auditOf(e)).at(-1);
  assert.equal(del.action, 'expense_delete');
  assert.equal(del.before_data.amount_cents, 4500, 'o histórico sobrevive à despesa apagada');
});

// ── Movimentações ──────────────────────────────────────────────────────────
dbTest('pagamentos: restrições de valor, forma, tipo, estorno e idempotência', async () => {
  const p = await mkProf('pay');
  const a = await mkAppt(p);
  const ok = (await payIns(p, a, { amount: 6000 })).rows[0].id;
  await rejectsWith(payIns(p, a, { amount: 0 }), '23514');
  await rejectsWith(payIns(p, a, { amount: -5 }), '23514');
  await rejectsWith(payIns(p, a, { method: 'cheque' }), '23514', /method_check/);
  await rejectsWith(payIns(p, a, { kind: 'doacao' }), '23514', /kind_check/);
  await rejectsWith(payIns(p, a, { reverses: ok }), '23514', /reverses_kind_check/);                       // recebimento com original
  await rejectsWith(payIns(p, a, { kind: 'estorno', notes: 'devolvido' }), '23514', /reverses_kind_check|estorno precisa referenciar/); // estorno sem original
  await rejectsWith(payIns(p, a, { kind: 'estorno', reverses: ok, amount: 100 }), '23514', /refund_reason_check/);       // estorno sem motivo
  await rejectsWith(payIns(p, a, { kind: 'estorno', reverses: ok, amount: 100, notes: 'ab' }), '23514', /refund_reason_check/);
  await rejectsWith(payIns(p, a, { kind: 'estorno', source: 'sinal_pix_confirmado', reverses: ok, amount: 100, notes: 'devolvido' }), '23514', /source_kind_check|não tem sinal/);
  await rejectsWith(payIns(p, a, { key: 'chave-longa-1' }), '23514', /idempotency_pair_check/);
  await rejectsWith(payIns(p, a, { key: 'curta', hash: HASH }), '23514', /idempotency_key_check/);
  await rejectsWith(payIns(p, a, { key: 'chave-longa-1', hash: 'xyz' }), '23514', /request_hash_check|idempotency_pair/);
  // idempotência: a mesma chave não grava duas vezes para a mesma profissional; outra profissional pode reutilizá-la
  await payIns(p, a, { key: 'chave-pagamento-1', hash: HASH });
  await rejectsWith(payIns(p, a, { key: 'chave-pagamento-1', hash: HASH }), '23505', /uq_financial_payments_idempotency/);
  const r = await q(`INSERT INTO financial_payments (professional_id, appointment_id, kind, amount_cents, method, occurred_on, idempotency_key, request_hash)
      VALUES ($1, $2, 'recebimento', 10000, 'pix', '2026-06-10', 'chave-pagamento-1', $3)
      ON CONFLICT (professional_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING RETURNING id`, [p.id, a, HASH]);
  assert.equal(r.rowCount, 0, 'com alvo explícito o reenvio não grava nada');
  assert.equal(await count('financial_payments', 'appointment_id = $1', [a]), 2);
  assert.equal(await count('financial_audit_log', `entity_type = 'payment' AND professional_id = $1`, [p.id]), 2, 'o reenvio não deixa histórico');
  const p2 = await mkProf('pay-b');
  const a2 = await mkAppt(p2);
  await payIns(p2, a2, { key: 'chave-pagamento-1', hash: HASH });
});

dbTest('pagamentos: pagamentos parciais do mesmo atendimento e histórico', async () => {
  const p = await mkProf('parcial');
  const a = await mkAppt(p);
  const first = (await payIns(p, a, { amount: 4000, method: 'pix' })).rows[0].id;
  const second = (await payIns(p, a, { amount: 3000, method: 'dinheiro', day: '2026-06-11' })).rows[0].id;
  assert.equal((await q(`SELECT sum(amount_cents)::int AS s FROM financial_payments WHERE appointment_id = $1`, [a])).rows[0].s, 7000);
  assert.deepEqual((await auditOf(first)).map((x) => x.action), ['payment_create']);
  assert.equal((await auditOf(second))[0].after_data.method, 'dinheiro');
});

dbTest('pagamentos: isolamento por profissional (FK composta)', async () => {
  const p1 = await mkProf('iso-a');
  const p2 = await mkProf('iso-b');
  const a1 = await mkAppt(p1);
  const a2 = await mkAppt(p2);
  // atendimento de outra profissional: o banco recusa (FK composta, checada no COMMIT)
  await rejectsWith(payIns(p1, a2), '23503', /financial_payments_appointment_fkey/);
  await rejectsWith(payIns(p2, a1), '23503', /financial_payments_appointment_fkey/);
  const pay2 = (await payIns(p2, a2)).rows[0].id;
  // estorno de recebimento de outra profissional
  await rejectsWith(payIns(p1, a1, { kind: 'estorno', reverses: pay2, notes: 'indevido' }), '23514', /estorno precisa referenciar/);
  assert.equal(await count('financial_payments', 'professional_id = $1', [p1.id]), 0);
  // o histórico também só aceita ações conhecidas
  await rejectsWith(q(`INSERT INTO financial_audit_log (professional_id, entity_type, entity_id, action) VALUES ($1, 'payment', gen_random_uuid(), 'nao_existe')`, [p1.id]), '23514');
});

dbTest('estornos: parciais até o valor do recebimento, mesmo atendimento, data coerente, motivo obrigatório', async () => {
  const p = await mkProf('estorno');
  const a = await mkAppt(p);
  const b = await mkAppt(p);
  const pay = (await payIns(p, a, { amount: 10000, day: '2026-06-10' })).rows[0].id;
  const refund = (amount, extra = {}) => payIns(p, a, { kind: 'estorno', reverses: pay, amount, notes: 'Cliente desistiu', day: '2026-06-12', ...extra });
  const r1 = (await refund(4000)).rows[0].id;
  await refund(6000);
  await rejectsWith(refund(1), '23514', /excederiam/);
  await rejectsWith(payIns(p, b, { kind: 'estorno', reverses: pay, amount: 100, notes: 'outro atendimento' }), '23514', /mesmo atendimento/);
  const pay2 = (await payIns(p, a, { amount: 5000, day: '2026-06-15' })).rows[0].id;
  await rejectsWith(payIns(p, a, { kind: 'estorno', reverses: pay2, amount: 100, notes: 'data anterior', day: '2026-06-14' }), '23514', /anterior/);
  const r3 = (await payIns(p, a, { kind: 'estorno', reverses: r1, amount: 100, notes: 'estorno de estorno' }).catch((e) => e));
  assert.equal(r3.code, '23514', 'só recebimento pode ser estornado');
  const hist = await auditOf(r1);
  assert.equal(hist[0].action, 'payment_refund');
  assert.equal(hist[0].reason, 'Cliente desistiu');
  // o recebimento original nunca foi alterado
  assert.equal((await q(`SELECT amount_cents FROM financial_payments WHERE id = $1`, [pay])).rows[0].amount_cents, 10000);
});

dbTest('estornos: duas tentativas simultâneas não passam do valor do recebimento', async () => {
  const p = await mkProf('estorno-conc');
  const a = await mkAppt(p);
  const pay = (await payIns(p, a, { amount: 10000 })).rows[0].id;
  const res = await Promise.allSettled([1, 2, 3, 4].map(() =>
    payIns(p, a, { kind: 'estorno', reverses: pay, amount: 4000, notes: 'tentativa simultânea', day: '2026-06-12' })));
  assert.equal(res.filter((r) => r.status === 'fulfilled').length, 2, 'cabem exatamente dois de 4000 em 10000');
  assert.equal((await q(`SELECT sum(amount_cents)::int AS s FROM financial_payments WHERE reverses_payment_id = $1`, [pay])).rows[0].s, 8000);
});

dbTest('idempotência: reenvios simultâneos da mesma chave gravam uma única vez', async () => {
  const p = await mkProf('idem');
  const a = await mkAppt(p);
  const run = () => q(`INSERT INTO financial_payments (professional_id, appointment_id, kind, amount_cents, method, occurred_on, idempotency_key, request_hash)
      VALUES ($1, $2, 'recebimento', 2500, 'pix', '2026-06-10', 'chave-concorrente', $3)
      ON CONFLICT (professional_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING RETURNING id`, [p.id, a, HASH]);
  const out = await Promise.all([run(), run(), run(), run(), run()]);
  assert.equal(out.reduce((n, r) => n + r.rowCount, 0), 1);
  assert.equal(await count('financial_payments', 'appointment_id = $1', [a]), 1);
});

dbTest('pagamentos e histórico são append-only; apagar atendimento com pagamento é recusado', async () => {
  const p = await mkProf('append');
  const a = await mkAppt(p);
  const pay = (await payIns(p, a)).rows[0].id;
  await rejectsWith(q(`UPDATE financial_payments SET amount_cents = 1 WHERE id = $1`, [pay]), '23514', /append-only/);
  await rejectsWith(q(`DELETE FROM financial_payments WHERE id = $1`, [pay]), '23514', /append-only/);
  await rejectsWith(q(`UPDATE financial_audit_log SET reason = 'x1x' WHERE entity_id = $1`, [pay]), '23514', /append-only/);
  await rejectsWith(q(`DELETE FROM financial_audit_log WHERE entity_id = $1`, [pay]), '23514', /append-only/);
  await rejectsWith(q(`DELETE FROM appointments WHERE id = $1`, [a]), '23503', /financial_payments_appointment_fkey/);
  assert.equal(await count('financial_payments', 'id = $1', [pay]), 1);
  assert.equal(await count('financial_audit_log', 'entity_id = $1', [pay]), 1);
});

dbTest('sinal Pix: confirmar é ato explícito, uma vez por atendimento, limitado ao sinal registrado', async () => {
  const p = await mkProf('sinal');
  const comSinal = await mkAppt(p, { status: 'confirmado', deposit: 3000, paidAt: new Date('2026-06-01T10:00:00Z') });
  const semSinal = await mkAppt(p);
  assert.equal(await count('financial_payments', 'appointment_id = $1', [comSinal]), 0, 'o sinal antigo não virou pagamento sozinho');
  await rejectsWith(payIns(p, semSinal, { amount: 1000, source: 'sinal_pix_confirmado' }), '23514', /não tem sinal/);
  await rejectsWith(payIns(p, comSinal, { amount: 3001, source: 'sinal_pix_confirmado' }), '23514', /excede o sinal/);
  await payIns(p, comSinal, { amount: 3000, source: 'sinal_pix_confirmado' });
  await rejectsWith(payIns(p, comSinal, { amount: 1000, source: 'sinal_pix_confirmado' }), '23505', /uq_financial_payments_deposit_once/);
  const row = (await q(`SELECT deposit_cents, paid_at FROM appointments WHERE id = $1`, [comSinal])).rows[0];
  assert.equal(row.deposit_cents, 3000, 'os campos legados do sinal ficam como estavam');
  assert.ok(row.paid_at);
});

// ── Fechamento de caixa ────────────────────────────────────────────────────
dbTest('fechamento: fechar, reabrir com motivo, fechar de novo; dia fechado bloqueia lançamentos; histórico completo', async () => {
  const p = await mkProf('caixa');
  const a = await mkAppt(p);
  const day = '2026-07-01';
  const cl = (await q(`INSERT INTO cash_closings (professional_id, closing_date, received_cents, refunded_cents, expenses_paid_cents)
      VALUES ($1, $2, 12000, 2000, 3000) RETURNING id, status, reopen_count`, [p.id, day])).rows[0];
  assert.equal(cl.status, 'fechado');
  await rejectsWith(q(`INSERT INTO cash_closings (professional_id, closing_date) VALUES ($1, $2)`, [p.id, day]), '23505', /cash_closings_day_key/);
  await rejectsWith(q(`INSERT INTO cash_closings (professional_id, closing_date, status) VALUES ($1, '2026-07-02', 'aberto')`, [p.id]), '23514');
  await rejectsWith(q(`INSERT INTO cash_closings (professional_id, closing_date, received_cents) VALUES ($1, '2026-07-02', -1)`, [p.id]), '23514');
  // dia fechado recusa recebimento, estorno e despesa paga com data nesse dia
  await rejectsWith(payIns(p, a, { day }), '23514', /fechado/);
  await rejectsWith(q(`INSERT INTO expenses (professional_id, description, amount_cents, expense_date, payment_status, paid_on)
      VALUES ($1, 'Luz', 1000, $2, 'paga', $2)`, [p.id, day]), '23514', /fechado/);
  // lançamento em outro dia continua livre
  const other = (await payIns(p, a, { day: '2026-07-02' })).rows[0].id;
  assert.ok(other);
  // fechado não se altera; reabrir exige motivo novo
  await rejectsWith(q(`UPDATE cash_closings SET received_cents = 1 WHERE id = $1`, [cl.id]), '23514', /transição/);
  await rejectsWith(q(`UPDATE cash_closings SET status = 'aberto' WHERE id = $1`, [cl.id]), '23514', /motivo|reopened_check/);
  await rejectsWith(q(`UPDATE cash_closings SET status = 'aberto', reopen_reason = 'ab' WHERE id = $1`, [cl.id]), '23514');
  await rejectsWith(q(`UPDATE cash_closings SET status = 'aberto', reopen_reason = 'Lançamento esquecido', received_cents = 1 WHERE id = $1`, [cl.id]), '23514', /totais/);
  await rejectsWith(q(`UPDATE cash_closings SET closing_date = '2026-07-03' WHERE id = $1`, [cl.id]), '23514', /imutável|transição/);
  await rejectsWith(q(`DELETE FROM cash_closings WHERE id = $1`, [cl.id]), '23514', /não podem ser apagados/);
  await q(`UPDATE cash_closings SET status = 'aberto', reopen_reason = 'Lançamento esquecido' WHERE id = $1`, [cl.id]);
  const reopened = (await q(`SELECT status, reopen_count, reopened_at, received_cents FROM cash_closings WHERE id = $1`, [cl.id])).rows[0];
  assert.equal(reopened.status, 'aberto');
  assert.equal(reopened.reopen_count, 1);
  assert.ok(reopened.reopened_at);
  assert.equal(reopened.received_cents, 12000, 'os totais antigos ficam preservados até novo fechamento');
  // dia reaberto aceita lançamento; depois fecha de novo com os totais novos
  await payIns(p, a, { day, amount: 500 });
  await q(`UPDATE cash_closings SET status = 'fechado', received_cents = 12500 WHERE id = $1`, [cl.id]);
  await rejectsWith(payIns(p, a, { day, amount: 100 }), '23514', /fechado/);
  const hist = await auditOf(cl.id);
  assert.deepEqual(hist.map((h) => h.action), ['cash_close', 'cash_reopen', 'cash_close']);
  assert.equal(hist[1].reason, 'Lançamento esquecido');
  assert.equal(hist[1].before_data.received_cents, 12000);
  assert.equal(hist[2].after_data.received_cents, 12500);
  assert.equal(hist[2].after_data.reopen_count, 1);
});

dbTest('fechamento: despesa paga em dia fechado não pode ser corrigida nem apagada sem reabrir o caixa', async () => {
  const p = await mkProf('caixa2');
  const e = (await q(`INSERT INTO expenses (professional_id, description, amount_cents, expense_date, payment_status, paid_on, paid_method)
      VALUES ($1, 'Internet', 9000, '2026-08-01', 'paga', '2026-08-01', 'pix') RETURNING id`, [p.id])).rows[0].id;
  const cl = (await q(`INSERT INTO cash_closings (professional_id, closing_date) VALUES ($1, '2026-08-01') RETURNING id`, [p.id])).rows[0].id;
  await rejectsWith(tx((c) => c.query(`UPDATE expenses SET amount_cents = 9500 WHERE id = $1`, [e]), withReason('Corrigir valor')), '23514', /fechado/);
  await rejectsWith(q(`DELETE FROM expenses WHERE id = $1`, [e]), '23514', /fechado/);
  await q(`UPDATE cash_closings SET status = 'aberto', reopen_reason = 'Correção de despesa' WHERE id = $1`, [cl]);
  await tx((c) => c.query(`UPDATE expenses SET amount_cents = 9500 WHERE id = $1`, [e]), withReason('Corrigir valor'));
  assert.equal((await q(`SELECT amount_cents FROM expenses WHERE id = $1`, [e])).rows[0].amount_cents, 9500);
});

dbTest('histórico: motivo obrigatório nas ações que o exigem; ações e entidades fechadas', async () => {
  const p = await mkProf('hist');
  const ins = (action, reason = null, type = 'payment') => q(
    `INSERT INTO financial_audit_log (professional_id, entity_type, entity_id, action, reason) VALUES ($1, $2, gen_random_uuid(), $3, $4)`,
    [p.id, type, action, reason]);
  await rejectsWith(ins('correction'), '23514', /reason_required/);
  await rejectsWith(ins('payment_refund'), '23514', /reason_required/);
  await rejectsWith(ins('cash_reopen'), '23514', /reason_required/);
  await rejectsWith(ins('correction', 'ab'), '23514', /reason_check/);
  await rejectsWith(ins('apagou_tudo', 'motivo ok'), '23514', /action_check/);
  await rejectsWith(ins('correction', 'motivo ok', 'cliente'), '23514', /entity_type_check/);
  await ins('correction', 'Correção manual registrada');
  await rejectsWith(q(`INSERT INTO financial_audit_log (professional_id, entity_type, entity_id, action, before_data) VALUES ($1, 'payment', gen_random_uuid(), 'payment_create', '[1]')`, [p.id]), '23514', /before_check/);
  // ordem estável por seq
  const { rows } = await q(`SELECT seq FROM financial_audit_log WHERE professional_id = $1 ORDER BY seq`, [p.id]);
  assert.ok(rows.every((r, i) => i === 0 || Number(r.seq) > Number(rows[i - 1].seq)));
});

// ── Exclusão da conta em cascata ───────────────────────────────────────────
dbTest('exclusão da profissional apaga os dados financeiros dela e só os dela (sem violar FK nem append-only)', async () => {
  const keep = await mkProf('cascata-fica');
  const gone = await mkProf('cascata-vai');
  for (const p of [keep, gone]) {
    const a = await mkAppt(p, { deposit: 2000 });
    const pay = (await payIns(p, a, { amount: 8000, day: '2026-09-01' })).rows[0].id;
    await payIns(p, a, { kind: 'estorno', reverses: pay, amount: 1000, notes: 'Ajuste', day: '2026-09-02' });
    await payIns(p, a, { amount: 2000, source: 'sinal_pix_confirmado', day: '2026-09-03' });
    await q(`UPDATE appointments SET final_price_cents = 9000, checked_in_at = now(), finance_review = 'realizado' WHERE id = $1`, [a]);
    await q(`INSERT INTO expenses (professional_id, description, amount_cents, expense_date, payment_status, paid_on) VALUES ($1, 'Gás', 700, '2026-09-04', 'paga', '2026-09-04')`, [p.id]);
    await q(`INSERT INTO cash_closings (professional_id, closing_date) VALUES ($1, '2026-09-10')`, [p.id]);
  }
  const tables = ['financial_payments', 'financial_audit_log', 'cash_closings', 'expenses', 'appointments'];
  const before = Object.fromEntries(await Promise.all(tables.map(async (t) => [t, await count(t, 'professional_id = $1', [keep.id])])));
  assert.ok(await count('financial_audit_log', 'professional_id = $1', [gone.id]) >= 6);
  await q(`DELETE FROM professionals WHERE id = $1`, [gone.id]);
  for (const t of tables) assert.equal(await count(t, 'professional_id = $1', [gone.id]), 0, `${t} da conta excluída`);
  for (const t of tables) assert.equal(await count(t, 'professional_id = $1', [keep.id]), before[t], `${t} da outra conta intacto`);
});

// ── Permissões da role da aplicação ────────────────────────────────────────
dbTest('role da aplicação: grants mínimos funcionam e append-only vale também por privilégio', async () => {
  await q(`CREATE ROLE ${APP_ROLE} NOLOGIN`);
  await q(`GRANT USAGE ON SCHEMA public TO ${APP_ROLE}`);
  await q(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${APP_ROLE}`);
  await q(`GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO ${APP_ROLE}`);
  await q(`REVOKE ALL ON financial_payments, financial_audit_log, cash_closings FROM ${APP_ROLE}`);
  // o script de grants é de psql (meta-comandos e variáveis): aqui é aplicado com as mesmas instruções SQL
  const script = (await readSql(GRANT))
    .split('\n').filter((l) => !/^\\(if|else|endif|quit|echo)/.test(l.trim()) && !/^\s*\\echo/.test(l))
    .join('\n').replace(/:'app_role'/g, `'${APP_ROLE}'`).replace(/:"app_role"/g, APP_ROLE);
  await q(script);

  const p = await mkProf('role');
  const a = await mkAppt(p);
  const app = await pool.connect();
  try {
    await app.query(`SET ROLE ${APP_ROLE}`);
    const pay = (await app.query(`INSERT INTO financial_payments (professional_id, appointment_id, kind, amount_cents, method, occurred_on)
        VALUES ($1, $2, 'recebimento', 5000, 'pix', '2026-10-01') RETURNING id`, [p.id, a])).rows[0].id;
    await app.query(`INSERT INTO financial_payments (professional_id, appointment_id, kind, amount_cents, method, occurred_on, notes, reverses_payment_id)
        VALUES ($1, $2, 'estorno', 1000, 'pix', '2026-10-02', 'Devolução', $3)`, [p.id, a, pay]);
    await app.query(`UPDATE appointments SET final_price_cents = 5000, checked_in_at = now() WHERE id = $1`, [a]);
    await app.query(`INSERT INTO expenses (professional_id, description, amount_cents, expense_date) VALUES ($1, 'Teste', 100, '2026-10-01')`, [p.id]);
    await app.query(`INSERT INTO cash_closings (professional_id, closing_date) VALUES ($1, '2026-10-05')`, [p.id]);
    await app.query(`UPDATE cash_closings SET status = 'aberto', reopen_reason = 'Reabertura de teste' WHERE professional_id = $1`, [p.id]);
    assert.ok((await app.query(`SELECT count(*)::int AS n FROM financial_audit_log WHERE professional_id = $1`, [p.id])).rows[0].n >= 6,
      'os triggers de auditoria gravam como a role da aplicação');
    for (const sql of [
      `UPDATE financial_payments SET amount_cents = 1`, `DELETE FROM financial_payments`, `TRUNCATE financial_payments`,
      `UPDATE financial_audit_log SET reason = 'abc'`, `DELETE FROM financial_audit_log`, `TRUNCATE financial_audit_log`,
      `DELETE FROM cash_closings`, `TRUNCATE cash_closings`]) {
      await app.query('SAVEPOINT s').catch(() => {});
      await assert.rejects(app.query(sql), (e) => { assert.equal(e.code, '42501', `${sql}: ${e.message}`); return true; });
      await app.query('ROLLBACK TO SAVEPOINT s').catch(() => {});
    }
  } finally {
    await app.query('RESET ROLE').catch(() => {});
    app.release();
  }
});

dbTest('search_path endurecido: funções fin_* só enxergam pg_catalog e resistem a objetos criados por role não-dona em public', async () => {
  const role = 'nf_fin_hostile_test';
  const { rows: fns } = await q(`SELECT proname, proconfig, prosecdef FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname LIKE 'fin\\_%'`);
  assert.ok(fns.length >= 15, `funções fin_* encontradas: ${fns.length}`);
  for (const f of fns) assert.deepEqual(f.proconfig, ['search_path=pg_catalog, pg_temp'], `search_path de ${f.proname}`);
  assert.ok(fns.filter((f) => f.prosecdef).length >= 8, 'as funções SECURITY DEFINER continuam como tais');

  // Role não-dona com CREATE em public, como nailflow em produção, e com os grants do script.
  await q(`CREATE ROLE ${role} NOLOGIN`);
  await q(`GRANT USAGE, CREATE ON SCHEMA public TO ${role}`);
  await q(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${role}`);
  await q(`GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO ${role}`);
  await q(`REVOKE ALL ON financial_payments, financial_audit_log, cash_closings FROM ${role}`);
  await q(psqlScript(await readSql(GRANT), { app_role: role }));

  const p = await mkProf('hostil');
  const a = await mkAppt(p);
  const pay = (await payIns(p, a, { amount: 5000 })).rows[0].id;
  const refund = (c, n) => c.query(`INSERT INTO financial_payments (professional_id, appointment_id, kind, amount_cents, method, occurred_on, notes, reverses_payment_id)
      VALUES ($1, $2, 'estorno', 100, 'pix', '2026-06-20', $3, $4)`, [p.id, a, `tentativa ${n}`, pay]);
  const hostile = await pool.connect();
  try {
    await hostile.query(`SET ROLE ${role}`);
    // assinatura exata que vence a conversão implícita de pg_catalog.hashtextextended(text, bigint): o guarda de
    // pagamentos chama hashtextextended(texto, 0), com 0 inteiro
    await hostile.query(`CREATE FUNCTION public.hashtextextended(text, integer) RETURNS bigint LANGUAGE plpgsql AS $f$ BEGIN RAISE EXCEPTION 'SEQUESTRADO'; END $f$`);
    await refund(hostile, 1); // endurecido: o objeto hostil é ignorado

    // Mutação: desfazer o endurecimento SÓ do guarda prova que o ataque é real (o teste não é vacuoso).
    await q(`ALTER FUNCTION fin_payments_guard() SET search_path = public, pg_temp`);
    await assert.rejects(refund(hostile, 2), /SEQUESTRADO/);

    // Reaplicar a migration devolve o endurecimento (CREATE OR REPLACE refaz a configuração).
    await runFile(UP);
    const { rows: again } = await q(`SELECT proconfig FROM pg_proc WHERE proname = 'fin_payments_guard' AND pronamespace = 'public'::regnamespace`);
    assert.deepEqual(again[0].proconfig, ['search_path=pg_catalog, pg_temp']);
    await refund(hostile, 3);
    assert.equal(await count('financial_payments', 'reverses_payment_id = $1', [pay]), 2, 'só as tentativas 1 e 3 gravaram');
  } finally {
    await hostile.query('RESET ROLE').catch(() => {});
    hostile.release();
    await q(`DROP FUNCTION IF EXISTS public.hashtextextended(text, integer)`).catch(() => {});
    await q(`DROP OWNED BY ${role}`).catch(() => {});
    await q(`DROP ROLE IF EXISTS ${role}`).catch(() => {});
  }
});

dbTest('sem o script de grants o fluxo EXISTENTE continua funcionando (histórico por SECURITY DEFINER) e ninguém forja histórico', async () => {
  const role = 'nf_fin_nogrant_test';
  await q(`CREATE ROLE ${role} NOLOGIN`);
  await q(`GRANT USAGE ON SCHEMA public TO ${role}`);
  await q(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${role}`);
  await q(`GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO ${role}`);
  await q(`REVOKE ALL ON financial_payments, financial_audit_log, cash_closings FROM ${role}`);
  const p = await mkProf('nogrant');
  const a = await mkAppt(p);
  const app = await pool.connect();
  try {
    await app.query(`SET ROLE ${role}`);
    // o que o código atual faz com despesas e atendimentos segue funcionando
    const e = (await app.query(`INSERT INTO expenses (professional_id, description, amount_cents, expense_date) VALUES ($1, 'Teste', 100, '2026-10-01') RETURNING id`, [p.id])).rows[0].id;
    await app.query(`UPDATE expenses SET amount_cents = 200 WHERE id = $1`, [e]);
    await app.query(`UPDATE appointments SET notes = 'ok', status = 'cancelado' WHERE id = $1`, [a]);
    await app.query(`DELETE FROM expenses WHERE id = $1`, [e]);
    assert.deepEqual((await auditOf(e)).map((x) => x.action), ['expense_create', 'expense_update', 'expense_delete'],
      'o histórico foi gravado mesmo sem privilégio direto na tabela');
    // mas a role não consegue gravar histórico por conta própria nem chamar as funções internas
    await assert.rejects(app.query(`INSERT INTO financial_audit_log (professional_id, entity_type, entity_id, action, reason) VALUES ($1, 'payment', gen_random_uuid(), 'correction', 'forjado')`, [p.id]),
      (err) => { assert.equal(err.code, '42501'); return true; });
    await assert.rejects(app.query(`SELECT fin_audit($1, 'payment', gen_random_uuid(), 'correction', NULL, NULL, 'forjado')`, [p.id]),
      (err) => { assert.equal(err.code, '42501'); return true; });
    await assert.rejects(app.query(`SELECT fin_day_is_closed($1, '2026-10-01')`, [p.id]),
      (err) => { assert.equal(err.code, '42501'); return true; });
    await assert.rejects(app.query(`SELECT count(*) FROM financial_payments`), (err) => { assert.equal(err.code, '42501'); return true; });
  } finally {
    await app.query('RESET ROLE').catch(() => {});
    app.release();
    await q(`DROP OWNED BY ${role}`).catch(() => {});
    await q(`DROP ROLE IF EXISTS ${role}`).catch(() => {});
  }
});

dbTest('privilégios excessivos como em produção (TRUNCATE, TRIGGER, CREATE em public): o que permitem sobre o Financeiro e a mitigação', async () => {
  const role = 'nf_fin_excess_test';
  const owner = (await q('SELECT current_user AS u')).rows[0].u;
  // perfil de produção (docs/SUPORTE_PUBLICACAO.md e catálogo): privilégios totais nas tabelas existentes + CREATE em public;
  // as tabelas da 025 só recebem os grants do script
  await q(`CREATE ROLE ${role} NOLOGIN`);
  await q(`GRANT USAGE, CREATE ON SCHEMA public TO ${role}`);
  await q(`GRANT ALL ON ALL TABLES IN SCHEMA public TO ${role}`);
  await q(`GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO ${role}`);
  await q(`REVOKE ALL ON financial_payments, financial_audit_log, cash_closings FROM ${role}`);
  await q(psqlScript(await readSql(GRANT), { app_role: role }));

  const p = await mkProf('excesso');
  const a = await mkAppt(p);
  await payIns(p, a, { amount: 5000 });
  const exp = (await q(`INSERT INTO expenses (professional_id, description, amount_cents, expense_date) VALUES ($1, 'Será truncada', 100, '2026-06-01') RETURNING id`, [p.id])).rows[0].id;
  const app = await pool.connect();
  const asRole = async (sql) => app.query(sql);
  const denied = (code) => (e) => { assert.equal(e.code, code, e.message); return true; };
  try {
    await app.query(`SET ROLE ${role}`);
    // A) os dados financeiros resistem ao excesso: TRUNCATE ... CASCADE e DELETE de atendimento com pagamento são recusados
    await assert.rejects(asRole('TRUNCATE appointments CASCADE'), denied('42501'));
    await assert.rejects(asRole('TRUNCATE professionals CASCADE'), denied('42501'));
    await assert.rejects(asRole(`DELETE FROM appointments WHERE id = '${a}'`), denied('23503'));
    assert.equal(await count('financial_payments', 'appointment_id = $1', [a]), 1);
    assert.equal(await count('appointments', 'id = $1', [a]), 1);
    // ... mas TRUNCATE de uma tabela SEM dependentes apaga sem disparar os triggers de histórico (lacuna de auditoria).
    // Dentro de uma transação desfeita ao final, para não apagar as despesas dos outros testes.
    await asRole('BEGIN');
    await asRole('TRUNCATE expenses');
    assert.equal(Number((await asRole(`SELECT count(*) AS n FROM expenses WHERE id = '${exp}'`)).rows[0].n), 0, 'o TRUNCATE apagou');
    const acts = (await asRole(`SELECT action FROM financial_audit_log WHERE entity_id = '${exp}' ORDER BY seq`)).rows.map((r) => r.action);
    assert.deepEqual(acts, ['expense_create'], 'o TRUNCATE não deixou histórico de exclusão');
    await asRole('ROLLBACK');
    assert.equal(await count('expenses', 'id = $1', [exp]), 1, 'transação desfeita: sem rastro');

    // B) TRIGGER + CREATE em public: um trigger criado pela role executa com os privilégios de QUEM dispara o comando
    await asRole(`CREATE TABLE public.zz_evidence (quem text, superusuario boolean)`);
    await asRole(`CREATE FUNCTION public.zz_probe() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN
        INSERT INTO public.zz_evidence SELECT current_user::text, (SELECT rolsuper FROM pg_roles WHERE rolname = current_user); RETURN NULL; END $f$`);
    await asRole(`CREATE TRIGGER zz_probe AFTER DELETE ON clients FOR EACH ROW EXECUTE FUNCTION public.zz_probe()`);
    const victim = await mkProf('excesso-vitima'); // uma conta com cliente; a exclusão da conta é feita PELA ROLE da aplicação
    await asRole(`DELETE FROM professionals WHERE id = '${victim.id}'`);
    let evidence = (await q('SELECT quem, superusuario FROM zz_evidence')).rows;
    assert.ok(evidence.length >= 1, 'o trigger da role foi executado durante a exclusão da conta');
    // medido, não presumido: na cascata da exclusão de conta o trigger roda como a PRÓPRIA role (sem escalação por esse caminho)
    assert.deepEqual(evidence[0], { quem: role, superusuario: false });
    await q('TRUNCATE zz_evidence');
    // manutenção: DML executado pelo DONO (postgres, em produção) em tabela onde a role tem TRIGGER roda o código da role como DONO
    const victim2 = await mkProf('excesso-manutencao');
    await q(`DELETE FROM clients WHERE professional_id = $1`, [victim2.id]);
    evidence = (await q('SELECT quem, superusuario FROM zz_evidence')).rows;
    assert.deepEqual(evidence[0], { quem: owner, superusuario: true }, 'escalação de privilégio quando a manutenção roda como dono');

    // C) mitigação: sem TRUNCATE/TRIGGER/REFERENCES e sem CREATE em public, nada disso é possível e o DML continua
    await q(`REVOKE TRUNCATE, TRIGGER, REFERENCES ON ALL TABLES IN SCHEMA public FROM ${role}`);
    await q(`REVOKE CREATE ON SCHEMA public FROM ${role}`);
    await assert.rejects(asRole('TRUNCATE expenses'), denied('42501'));
    await assert.rejects(asRole(`CREATE TRIGGER zz_probe2 AFTER DELETE ON clients FOR EACH ROW EXECUTE FUNCTION public.zz_probe()`), denied('42501'));
    await assert.rejects(asRole(`CREATE FUNCTION public.zz_probe3() RETURNS int LANGUAGE sql AS 'SELECT 1'`), denied('42501'));
    await assert.rejects(asRole('CREATE TABLE public.zz_outra (x int)'), denied('42501'));
    const e2 = (await asRole(`INSERT INTO expenses (professional_id, description, amount_cents, expense_date) VALUES ('${p.id}', 'DML segue', 100, '2026-06-02') RETURNING id`)).rows[0].id;
    await asRole(`UPDATE expenses SET amount_cents = 150 WHERE id = '${e2}'`);
    await asRole(`DELETE FROM expenses WHERE id = '${e2}'`);
    assert.deepEqual((await q(`SELECT action FROM financial_audit_log WHERE entity_id = $1 ORDER BY seq`, [e2])).rows.map((r) => r.action), ['expense_create', 'expense_update', 'expense_delete']);
  } finally {
    await app.query('RESET ROLE').catch(() => {});
    app.release();
    await q('DROP TRIGGER IF EXISTS zz_probe ON clients').catch(() => {});
    await q('DROP FUNCTION IF EXISTS public.zz_probe()').catch(() => {});
    await q('DROP TABLE IF EXISTS public.zz_evidence').catch(() => {});
    await q(`DROP OWNED BY ${role}`).catch(() => {});
    await q(`DROP ROLE IF EXISTS ${role}`).catch(() => {});
  }
});

// ── Rollback ───────────────────────────────────────────────────────────────
dbTest('rollback com dados financeiros em uso aborta sem alterar nada', async () => {
  const fp = await fingerprint();
  const counts = { pay: await count('financial_payments'), audit: await count('financial_audit_log'), close: await count('cash_closings') };
  assert.ok(counts.pay > 0 && counts.audit > 0 && counts.close > 0);
  await rejectsWith(runFile(DOWN), 'P0001', /rollback 025 abortado: há dados financeiros em uso/);
  await rejectsWith(runFile(DOWN, { confirm: 'sim' }), 'P0001', /abortado/);
  assert.equal(await fingerprint(), fp);
  assert.equal(await count('financial_payments'), counts.pay);
  assert.equal(await count('financial_audit_log'), counts.audit);
  assert.equal((await q(`SELECT count(*)::int AS n FROM pg_namespace WHERE nspname LIKE 'financeiro\\_arquivo\\_%'`)).rows[0].n, 0);
});

dbTest('rollback autorizado arquiva TUDO antes de remover e preserva os dados anteriores à 025', async () => {
  const counts = {
    financial_payments: await count('financial_payments'), financial_audit_log: await count('financial_audit_log'),
    cash_closings: await count('cash_closings'),
  };
  const apptsNew = await count('appointments', `checked_in_at IS NOT NULL OR final_price_cents IS NOT NULL OR finance_review IS NOT NULL`);
  const expNew = await count('expenses', `payment_status <> 'a_revisar' OR paid_on IS NOT NULL OR due_on IS NOT NULL`);
  const payments = (await q(`SELECT md5(string_agg(id::text || amount_cents::text || kind || occurred_on::text, '|' ORDER BY id)) AS h FROM financial_payments`)).rows[0].h;
  const totalAppts = await count('appointments');
  const totalExp = await count('expenses');
  assert.ok(apptsNew > 0 && expNew > 0);
  const hashesBefore = await projectionHashes(pool);

  await runFile(DOWN, { confirm: CONFIRM });

  const { rows: schemas } = await q(`SELECT nspname FROM pg_namespace WHERE nspname LIKE 'financeiro\\_arquivo\\_%'`);
  assert.equal(schemas.length, 1);
  const s = schemas[0].nspname;
  // manifesto: contagem e hash de TODAS as colunas de cada tabela, gravados antes de remover a estrutura
  const manifest = Object.fromEntries((await q(`SELECT table_name, row_count::int AS n, md5 FROM "${s}"._manifest`)).rows.map((r) => [r.table_name, { n: r.n, h: r.md5 }]));
  assert.deepEqual(manifest, hashesBefore, 'o manifesto do arquivo reproduz os hashes anteriores ao rollback');
  for (const [t, n] of Object.entries(counts)) {
    assert.equal((await q(`SELECT count(*)::int AS n FROM "${s}"."${t}"`)).rows[0].n, n, `${t} arquivada`);
  }
  assert.equal((await q(`SELECT count(*)::int AS n FROM "${s}".appointments_financeiro`)).rows[0].n, apptsNew);
  assert.equal((await q(`SELECT count(*)::int AS n FROM "${s}".expenses_financeiro`)).rows[0].n, expNew);
  assert.equal((await q(`SELECT md5(string_agg(id::text || amount_cents::text || kind || occurred_on::text, '|' ORDER BY id)) AS h FROM "${s}".financial_payments`)).rows[0].h, payments);
  // a estrutura voltou ao estado anterior à 025, e nenhuma linha antiga foi tocada ou perdida
  assert.equal(await fingerprint(), baseline, 'schema idêntico ao anterior à 025');
  assert.equal(await legacyHash(legProf.id), legacyBefore, 'dados legados idênticos');
  assert.equal(await count('appointments'), totalAppts);
  assert.equal(await count('expenses'), totalExp);
  for (const t of ['financial_payments', 'financial_audit_log', 'cash_closings']) {
    assert.equal((await q(`SELECT to_regclass('public.${t}') IS NULL AS gone`)).rows[0].gone, true);
  }
  await runFile(DOWN); // idempotente: sem estrutura, não faz nada
});

dbTest('rollback sem uso remove a estrutura sem arquivar; reaplicar depois do rollback funciona', async () => {
  const before = (await q(`SELECT count(*)::int AS n FROM pg_namespace WHERE nspname LIKE 'financeiro\\_arquivo\\_%'`)).rows[0].n;
  await runFile(UP);
  assert.equal(await count('financial_payments'), 0);
  await runFile(DOWN); // nada em uso: não precisa de autorização
  assert.equal(await fingerprint(), baseline);
  assert.equal((await q(`SELECT count(*)::int AS n FROM pg_namespace WHERE nspname LIKE 'financeiro\\_arquivo\\_%'`)).rows[0].n, before, 'nada novo arquivado');
  assert.equal(await legacyHash(legProf.id), legacyBefore);
  await runFile(UP);
  assert.equal(await count('financial_payments'), 0);
  assert.equal(await legacyHash(legProf.id), legacyBefore);
});
