// Restauração do arquivo financeiro (rollback da 025 -> reaplicação -> _ops/025_restore_from_archive.sql).
// SOMENTE em banco DESCARTÁVEL (guia em helpers/financeTestDb.js), com FINANCEIRO_RESTORE_TEST_DB_URL (um banco só para
// este arquivo; o usuário da URL é superusuário do cluster descartável). Sem a variável, os testes de banco são ignorados.
//
// Prova: depois de rollback + reaplicação + restauração, contagem e hash de TODAS as colunas das cinco projeções
// (movimentações, histórico, fechamentos, colunas novas de atendimentos e de despesas) são idênticos aos de antes do
// rollback, e os dados anteriores à 025 não mudam. Também prova as recusas: destino não pristino, manifesto adulterado,
// registros órfãos, schema inexistente ou sem manifesto, e execução por quem não é superusuário.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import pg from 'pg';
import { resolveFinanceTestDb, financeDb, projectionHashes, CONFIRM } from './helpers/financeTestDb.js';

const VAR = 'FINANCEIRO_RESTORE_TEST_DB_URL';
const EMAIL_LIKE = 'fin-rst-%@nf.test';
const ROLE = 'nf_fin_rst_role';
const HASH = createHash('sha256').update('restore').digest('hex');
const T = { timeout: 120_000 };

let skip = false;
let pool;
let db;
let seq = 0;
const q = (sql, params) => pool.query(sql, params);
const count = async (table, where = 'true') => (await q(`SELECT count(*)::int AS n FROM ${table} WHERE ${where}`)).rows[0].n;

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

async function mkProf(tag) {
  const id = randomUUID();
  await q(`INSERT INTO professionals (id, name, email, password_hash, slug) VALUES ($1, $2, $3, 'x', $4)`,
    [id, `Rst ${tag}`, `fin-rst-${tag}-${id.slice(0, 8)}@nf.test`, `fin-rst-${tag}-${id.slice(0, 8)}`]);
  const svc = (await q(`INSERT INTO services (professional_id, name, price_cents, duration_minutes) VALUES ($1, 'Serviço', 10000, 30) RETURNING id`, [id])).rows[0].id;
  const cli = (await q(`INSERT INTO clients (professional_id, name, phone) VALUES ($1, 'Cliente', $2) RETURNING id`, [id, `5521${String(800000000 + (++seq))}`])).rows[0].id;
  return { id, svc, cli };
}
async function mkAppt(p, { deposit = null, paidAt = null, status = 'confirmado' } = {}) {
  const start = new Date(Date.UTC(2026, 5, 1 + (++seq), 12, 0, 0));
  return (await q(`INSERT INTO appointments (professional_id, client_id, service_id, starts_at, ends_at, status, price_cents_snapshot, deposit_cents, paid_at)
      VALUES ($1, $2, $3, $4, $5, $6, 10000, $7, $8) RETURNING id`,
    [p.id, p.cli, p.svc, start, new Date(start.getTime() + 3600_000), status, deposit, paidAt])).rows[0].id;
}
const pay = (p, a, o = {}) => q(
  `INSERT INTO financial_payments (professional_id, appointment_id, kind, amount_cents, method, occurred_on, source, reverses_payment_id, notes, idempotency_key, request_hash)
   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
  [p.id, a, o.kind ?? 'recebimento', o.amount ?? 1000, o.method ?? 'pix', o.day ?? '2026-06-10', o.source ?? 'manual', o.reverses ?? null, o.notes ?? null, o.key ?? null, o.hash ?? null]);

async function legacyHash(profIds) {
  const a = await q(`SELECT md5(coalesce(string_agg(row_to_json(t)::text, '|' ORDER BY id), '')) AS h FROM (
      SELECT id, professional_id, client_id, service_id, starts_at, ends_at, status, notes, price_cents_snapshot, reminder_sent, created_at, updated_at,
             recurring_group_id, cancel_reason, source, expires_at, deposit_cents, paid_at FROM appointments WHERE professional_id = ANY($1::uuid[])) t`, [profIds]);
  const e = await q(`SELECT md5(coalesce(string_agg(row_to_json(t)::text, '|' ORDER BY id), '')) AS h FROM (
      SELECT id, professional_id, description, category, amount_cents, expense_date, notes, created_at, updated_at FROM expenses WHERE professional_id = ANY($1::uuid[])) t`, [profIds]);
  return `${a.rows[0].h}:${e.rows[0].h}`;
}


async function legacyRows(profIds) {
  const a = await q(`SELECT row_to_json(t)::text AS j FROM (SELECT id, professional_id, client_id, service_id, starts_at, ends_at, status, notes, price_cents_snapshot, reminder_sent, created_at, updated_at,
      recurring_group_id, cancel_reason, source, expires_at, deposit_cents, paid_at FROM appointments WHERE professional_id = ANY($1::uuid[]) ORDER BY id) t`, [profIds]);
  const e = await q(`SELECT row_to_json(t)::text AS j FROM (SELECT id, professional_id, description, category, amount_cents, expense_date, notes, created_at, updated_at FROM expenses WHERE professional_id = ANY($1::uuid[]) ORDER BY id) t`, [profIds]);
  return { appointments: a.rows.map((r) => JSON.parse(r.j)), expenses: e.rows.map((r) => JSON.parse(r.j)) };
}

/** Dados financeiros completos em todas as tabelas, com correções, estorno, sinal confirmado, reabertura de caixa e histórico. */
async function seedFinancialData() {
  const p1 = await mkProf('um');
  const p2 = await mkProf('dois');
  const a1 = await mkAppt(p1, { deposit: 3000, paidAt: new Date('2026-06-01T10:00:00Z') });
  const a2 = await mkAppt(p1);
  const a3 = await mkAppt(p1);
  const b1 = await mkAppt(p2);
  const actor = randomUUID();

  const rec = (await pay(p1, a1, { amount: 8000, day: '2026-06-10' })).rows[0].id;
  await pay(p1, a1, { kind: 'estorno', amount: 1000, reverses: rec, notes: 'Cliente devolveu um item', day: '2026-06-12' });
  await pay(p1, a1, { amount: 3000, source: 'sinal_pix_confirmado', day: '2026-06-10' });
  await pay(p1, a2, { amount: 5000, method: 'cartao_credito', day: '2026-06-11', key: 'chave-restauracao-1', hash: HASH });
  await pay(p2, b1, { amount: 2500, method: 'dinheiro', day: '2026-06-10' });

  await q(`UPDATE appointments SET checked_in_at = '2026-06-02T12:05:00Z', final_price_cents = 11000 WHERE id = $1`, [a1]);
  await tx((c) => c.query(`UPDATE appointments SET final_price_cents = 10500 WHERE id = $1`, [a1]), { 'nailflow.audit_reason': 'Desconto combinado', 'nailflow.actor_id': actor });
  await q(`UPDATE appointments SET finance_review = 'realizado' WHERE id = $1`, [a2]);
  await q(`UPDATE appointments SET finance_review = 'sem_movimentacao', checked_in_at = '2026-06-03T09:00:00Z' WHERE id = $1`, [a3]);

  await q(`INSERT INTO expenses (professional_id, description, category, amount_cents, expense_date) VALUES ($1, 'Despesa legada', 'Outros', 2500, '2026-05-02')`, [p1.id]);
  await q(`INSERT INTO expenses (professional_id, description, amount_cents, expense_date, payment_status, due_on) VALUES ($1, 'Aluguel', 90000, '2026-06-05', 'pendente', '2026-06-20')`, [p1.id]);
  const e3 = (await q(`INSERT INTO expenses (professional_id, description, amount_cents, expense_date, payment_status, paid_on, paid_method, notes)
      VALUES ($1, 'Materiais', 4000, '2026-06-05', 'paga', '2026-06-12', 'pix', 'nota 1') RETURNING id`, [p1.id])).rows[0].id;
  await tx((c) => c.query(`UPDATE expenses SET amount_cents = 4500 WHERE id = $1`, [e3]), { 'nailflow.audit_reason': 'Valor do recibo', 'nailflow.actor_id': actor });
  await q(`INSERT INTO expenses (professional_id, description, amount_cents, expense_date, payment_status, due_on) VALUES ($1, 'Internet', 12000, '2026-06-06', 'pendente', '2026-06-25')`, [p2.id]);

  // fechamentos: um fechado, um fechado-reaberto-fechado, um reaberto (aberto), e um de outra conta
  await q(`INSERT INTO cash_closings (professional_id, closing_date, received_cents, refunded_cents, expenses_paid_cents) VALUES ($1, '2026-06-10', 11000, 0, 0)`, [p1.id]);
  await q(`UPDATE cash_closings SET status = 'aberto', reopen_reason = 'Esqueci um recebimento' WHERE professional_id = $1 AND closing_date = '2026-06-10'`, [p1.id]);
  await q(`UPDATE cash_closings SET status = 'fechado', received_cents = 11500 WHERE professional_id = $1 AND closing_date = '2026-06-10'`, [p1.id]);
  await q(`INSERT INTO cash_closings (professional_id, closing_date, received_cents, refunded_cents, expenses_paid_cents) VALUES ($1, '2026-06-12', 0, 1000, 4500)`, [p1.id]);
  await q(`INSERT INTO cash_closings (professional_id, closing_date) VALUES ($1, '2026-06-13')`, [p1.id]);
  await q(`UPDATE cash_closings SET status = 'aberto', reopen_reason = 'Conferência pendente' WHERE professional_id = $1 AND closing_date = '2026-06-13'`, [p1.id]);
  await q(`INSERT INTO cash_closings (professional_id, closing_date, received_cents) VALUES ($1, '2026-06-10', 2500)`, [p2.id]);
  return { p1, p2, a1, a2, a3, b1, e3 };
}

before(async () => {
  const r = await resolveFinanceTestDb(process.env, VAR);
  if (r.skip) { skip = r.skip; return; }
  pool = new pg.Pool({ connectionString: r.url, options: '-c TimeZone=UTC', max: 4 });
  db = financeDb(pool);
  await db.reset({ emailLike: EMAIL_LIKE, roles: [ROLE] });
});

after(async () => {
  if (!pool) return;
  try {
    await db.reset({ emailLike: EMAIL_LIKE, roles: [ROLE] });
  } finally {
    await pool.end();
  }
});

const dbTest = (name, fn) => test(name, T, async (t) => { if (skip) return t.skip(skip); await fn(t); });
const state = {};

dbTest('preparação: 025 aplicada e dados financeiros completos em todas as cinco tabelas', async () => {
  await db.up();
  Object.assign(state, await seedFinancialData());
  state.before = await projectionHashes(pool);
  state.legacy = await legacyHash([state.p1.id, state.p2.id]);
  state.maxSeq = Number((await q('SELECT max(seq) AS m FROM financial_audit_log')).rows[0].m);
  for (const [t, v] of Object.entries(state.before)) assert.ok(v.n > 0, `${t} precisa ter dados para o teste valer`);
  assert.ok(state.before.financial_audit_log.n >= 15);
  // há de tudo: estorno, sinal confirmado, fechamento reaberto e ainda aberto, despesa paga corrigida
  assert.equal(await count('financial_payments', `kind = 'estorno'`), 1);
  assert.equal(await count('financial_payments', `source = 'sinal_pix_confirmado'`), 1);
  assert.equal(await count('cash_closings', `status = 'aberto'`), 1);
  assert.ok(await count('cash_closings', 'reopen_count >= 1') >= 2);
  assert.equal(await count('financial_audit_log', `action = 'cash_reopen'`), 2);
});

dbTest('rollback autorizado: manifesto do arquivo reproduz os hashes e os dados anteriores à 025 ficam intactos', async () => {
  await db.down({ confirm: CONFIRM });
  const [schema] = await db.archives();
  assert.ok(schema, 'schema de arquivo criado');
  state.archive1 = schema;
  const manifest = Object.fromEntries((await q(`SELECT table_name, row_count::int AS n, md5 FROM "${schema}"._manifest`)).rows.map((r) => [r.table_name, { n: r.n, h: r.md5 }]));
  assert.deepEqual(manifest, state.before);
  assert.equal(await db.hasStructure(), false);
  assert.equal(await legacyHash([state.p1.id, state.p2.id]), state.legacy, 'agendamentos e despesas anteriores à 025 idênticos');
});

dbTest('restauração: reaplicar a 025 e restaurar devolve TODAS as colunas (hashes idênticos)', async () => {
  await db.up();
  assert.equal(await count('financial_payments'), 0);
  await db.restore(state.archive1);
  const after = await projectionHashes(pool);
  assert.deepEqual(after, state.before, 'contagem e hash de todas as colunas das cinco projeções');
  assert.equal(await legacyHash([state.p1.id, state.p2.id]), state.legacy, 'a restauração não toca updated_at nem as colunas antigas');
  assert.deepEqual(await db.archives(), [state.archive1], 'o schema de arquivo é mantido');
  // sem histórico duplicado: os triggers ficaram desligados durante a restauração
  assert.equal(await count('financial_audit_log'), state.before.financial_audit_log.n);
});

dbTest('depois de restaurar: triggers de volta, sequência do histórico continua e dia fechado continua fechado', async () => {
  const { p1, a1, e3 } = state;
  const rec = (await q(`SELECT id FROM financial_payments WHERE professional_id = $1 AND kind = 'recebimento' AND amount_cents = 8000`, [p1.id])).rows[0].id;
  await assert.rejects(q(`UPDATE financial_payments SET amount_cents = 1 WHERE id = $1`, [rec]), (e) => { assert.equal(e.code, '23514'); assert.match(e.message, /append-only/); return true; });
  await assert.rejects(pay(p1, a1, { kind: 'estorno', amount: 7001, reverses: rec, notes: 'acima do saldo', day: '2026-06-14' }), (e) => { assert.equal(e.code, '23514'); return true; });
  await assert.rejects(pay(p1, a1, { amount: 100, day: '2026-06-12' }), (e) => { assert.equal(e.code, '23514'); assert.match(e.message, /fechado/); return true; });
  await assert.rejects(q(`UPDATE financial_audit_log SET reason = 'abc' WHERE seq = 1`), (e) => { assert.equal(e.code, '23514'); return true; });
  // despesa paga em dia fechado restaurado continua protegida; o histórico segue a sequência restaurada
  await assert.rejects(tx((c) => c.query(`UPDATE expenses SET amount_cents = 4600 WHERE id = $1`, [e3]), { 'nailflow.audit_reason': 'Correção em dia fechado' }),
    (e) => { assert.equal(e.code, '23514'); assert.match(e.message, /fechado/); return true; });
  const aluguel = (await q(`SELECT id FROM expenses WHERE professional_id = $1 AND description = 'Aluguel'`, [p1.id])).rows[0].id;
  await q(`UPDATE expenses SET amount_cents = 91000 WHERE id = $1`, [aluguel]);
  const last = (await q(`SELECT seq, action FROM financial_audit_log ORDER BY seq DESC LIMIT 1`)).rows[0];
  assert.equal(last.action, 'expense_update');
  assert.equal(Number(last.seq), state.maxSeq + 1, 'a sequência continua exatamente depois do maior seq restaurado');
  assert.equal((await q(`SELECT count(*)::int AS n FROM (SELECT seq FROM financial_audit_log GROUP BY seq HAVING count(*) > 1) d`)).rows[0].n, 0);
  await q(`UPDATE expenses SET amount_cents = 90000 WHERE id = $1`, [aluguel]);
});

dbTest('restauração recusa destino que não está pristino e não altera nada', async () => {
  const before = await projectionHashes(pool);
  await assert.rejects(db.restore(state.archive1), /destino não está pristino/);
  assert.deepEqual(await projectionHashes(pool), before);
});

dbTest('restauração recusa arquivo adulterado (manifesto) e deixa o destino vazio', async () => {
  await db.down({ confirm: CONFIRM });
  const schemas = await db.archives();
  const archive2 = schemas.find((s) => s !== state.archive1);
  assert.ok(archive2);
  await db.up();
  const victim = (await q(`SELECT id FROM "${archive2}".financial_payments ORDER BY id LIMIT 1`)).rows[0].id;
  await q(`UPDATE "${archive2}".financial_payments SET amount_cents = amount_cents + 1 WHERE id = $1`, [victim]);
  await assert.rejects(db.restore(archive2), /não confere com o manifesto/);
  assert.equal(await count('financial_payments'), 0);
  assert.equal(await count('financial_audit_log'), 0);
  assert.equal(await count('cash_closings'), 0);
  // arquivo sem uma das tabelas do manifesto
  await q(`UPDATE "${archive2}".financial_payments SET amount_cents = amount_cents - 1 WHERE id = $1`, [victim]);
  await q(`ALTER TABLE "${archive2}".cash_closings RENAME TO cash_closings_perdida`);
  await assert.rejects(db.restore(archive2), /arquivo e o manifesto não coincidem/);
  await q(`ALTER TABLE "${archive2}".cash_closings_perdida RENAME TO cash_closings`);
  state.archive2 = archive2;
});

dbTest('restauração recusa registros órfãos (conta excluída depois do rollback) e não grava nada', async () => {
  await q(`DELETE FROM professionals WHERE id = $1`, [state.p2.id]);
  await assert.rejects(db.restore(state.archive2), /ficariam órfã|não existem mais/);
  assert.equal(await count('financial_payments'), 0);
  assert.equal(await count('financial_audit_log'), 0);
  assert.equal(await count('cash_closings'), 0);
  assert.equal(await count('expenses', `payment_status <> 'a_revisar'`), 0);
  assert.equal(await count('appointments', 'finance_review IS NOT NULL OR final_price_cents IS NOT NULL OR checked_in_at IS NOT NULL'), 0);
});

dbTest('skip_deleted_accounts=on restaura só as contas que existem, deixa o resto no arquivo e nunca altera o arquivo', async () => {
  const schema = state.archive2;
  const subsetHash = async (table, profId) => {
    const client = await pool.connect();
    try {
      await client.query(`SET TimeZone = 'UTC'`);
      const { rows } = await client.query(
        `SELECT count(*)::int AS n, md5(coalesce(string_agg(to_jsonb(t)::text, '|' ORDER BY t.id::text), '')) AS h FROM "${schema}"."${table}" t WHERE ($1::uuid IS NULL OR t.professional_id = $1)`, [profId]);
      return { n: rows[0].n, h: rows[0].h };
    } finally { client.release(); }
  };
  const tables = Object.keys(state.before);
  const archiveBefore = {};
  const expected = {};
  for (const t of tables) { archiveBefore[t] = await subsetHash(t, null); expected[t] = await subsetHash(t, state.p1.id); }
  const p2InArchive = (await Promise.all(tables.map((t) => q(`SELECT count(*)::int AS n FROM "${schema}"."${t}" WHERE professional_id = $1`, [state.p2.id])))).reduce((s, r) => s + r.rows[0].n, 0);
  assert.ok(p2InArchive > 0, 'a conta excluída ainda tem dados no arquivo (as cópias não têm FK)');
  const legacyP1 = await legacyRows([state.p1.id]);

  await db.restore(schema, { skipDeleted: true });

  assert.deepEqual(await projectionHashes(pool), expected, 'restaurado = exatamente o subconjunto da conta que existe, todas as colunas');
  for (const t of tables) assert.deepEqual(await subsetHash(t, null), archiveBefore[t], `o arquivo (${t}) não foi alterado`);
  assert.equal((await Promise.all(tables.map((t) => q(`SELECT count(*)::int AS n FROM "${schema}"."${t}" WHERE professional_id = $1`, [state.p2.id])))).reduce((s, r) => s + r.rows[0].n, 0), p2InArchive,
    'os dados da conta excluída permanecem só no arquivo');
  assert.equal(await count('financial_payments', `professional_id = '${state.p2.id}'`), 0);
  assert.deepEqual(await legacyRows([state.p1.id]), legacyP1, 'dados anteriores à 025 intactos');
  // o valor do parâmetro é validado
  const { psqlScript, readSql, FILES } = await import('./helpers/financeTestDb.js');
  await assert.rejects(db.runSql(psqlScript(await readSql(FILES.RESTORE), { archive_schema: schema, skip_deleted_accounts: 'talvez' })), /skip_deleted_accounts deve ser on ou off/);
});

dbTest('restauração recusa schema inexistente, nome inválido, arquivo sem manifesto e quem não é superusuário', async () => {
  await assert.rejects(db.restore('financeiro_arquivo_20000101_000000'), /não existe/);
  await assert.rejects(db.restore('public'), /nome de schema de arquivo inválido/);
  await assert.rejects(db.restore(`financeiro_arquivo_1; DROP TABLE x`), /nome de schema de arquivo inválido/);
  await q(`CREATE SCHEMA financeiro_arquivo_20000101_000001`);
  try {
    await assert.rejects(db.restore('financeiro_arquivo_20000101_000001'), /não tem o manifesto/);
  } finally {
    await q(`DROP SCHEMA financeiro_arquivo_20000101_000001 CASCADE`);
  }
  // quem não é superusuário
  await q(`CREATE ROLE ${ROLE} NOLOGIN`);
  const client = await pool.connect();
  try {
    await client.query(`GRANT USAGE ON SCHEMA public TO ${ROLE}`);
    await client.query(`SET ROLE ${ROLE}`);
    const { psqlScript, readSql, FILES } = await import('./helpers/financeTestDb.js');
    await assert.rejects(client.query(psqlScript(await readSql(FILES.RESTORE), { archive_schema: state.archive2, skip_deleted_accounts: 'off' })), /execute como superusuário/);
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    await client.query('RESET ROLE').catch(() => {});
    client.release();
  }
});
