// Ensaio de pg_dump / pg_restore com a migration 025 aplicada e dados no schema de arquivo, em banco DESCARTÁVEL
// (guia em helpers/financeTestDb.js; FINANCEIRO_DUMP_TEST_DB_URL, um banco só para este arquivo; o teste cria e apaga o banco
// de destino nf_fin_dumptarget_test no mesmo cluster descartável). Sem a variável, os testes de banco são ignorados.
//
// Dois ensaios, os mesmos comandos do backup de produção (pg_dump -Fc) e pg_restore em um banco novo (template0):
//   1. RECUPERAÇÃO A PARTIR DE BACKUP: dump do estado "025 reaplicada + schema de arquivo do rollback", restauração em outro banco
//      e recuperação dos dados arquivados pelo script de restauração; contagem e hash de TODAS as colunas contra o estado
//      anterior ao rollback.
//   2. FIDELIDADE TOTAL: dump com dados vivos E schema de arquivo; todas as tabelas (public e financeiro_arquivo_*) com a mesma
//      contagem e o mesmo hash; mesma estrutura, mesmos donos e ACLs, mesmas funções (SECURITY DEFINER, search_path), mesmas
//      sequências; e os guardas, os privilégios e a sequência do histórico continuam valendo no banco restaurado.
// Requer os binários pg_dump/pg_restore (FINANCEIRO_PG_BIN ou /usr/lib/postgresql/16/bin ou o PATH).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { resolveFinanceTestDb, financeDb, projectionHashes, CONFIRM } from './helpers/financeTestDb.js';
import { seedTools } from './helpers/financeSeed.js';

const run = promisify(execFile);
const VAR = 'FINANCEIRO_DUMP_TEST_DB_URL';
const TARGET_DB = 'nf_fin_dumptarget_test';
const EMAIL_LIKE = 'fin-dmp-%@nf.test';
const ROLE = 'nf_fin_dmp_app';
const T = { timeout: 240_000 };

let skip = false;
let owner;
let db;
let seed;
let conn;          // { host, port, user, db }
let ownerUrl;
let workDir;
let target;        // Pool do banco de destino
const state = {};

const bin = (name) => {
  const dir = process.env.FINANCEIRO_PG_BIN || (existsSync('/usr/lib/postgresql/16/bin/pg_dump') ? '/usr/lib/postgresql/16/bin' : '');
  return dir ? path.join(dir, name) : name;
};
const pgArgs = () => ['-h', conn.host, '-p', conn.port, '-U', conn.user];
const urlFor = (dbName) => { const u = new URL(ownerUrl); u.pathname = `/${dbName}`; return u.toString(); };

async function createTarget() {
  assert.notEqual(TARGET_DB, conn.db);
  assert.match(TARGET_DB, /^nf_[a-z0-9_]*_test$/);
  await dropTarget();
  await owner.query(`CREATE DATABASE ${TARGET_DB} TEMPLATE template0`);
  await owner.query(`COMMENT ON DATABASE ${TARGET_DB} IS 'NAILFLOW_DISPOSABLE_TEST_DB'`);
  target = new pg.Pool({ connectionString: urlFor(TARGET_DB), options: '-c TimeZone=UTC', max: 4 });
  target.on('error', () => {}); // conexão ociosa encerrada pelo DROP DATABASE ... FORCE não pode derrubar o teste
}
async function dropTarget() {
  if (target) { await target.end().catch(() => {}); target = null; }
  await owner.query(`DROP DATABASE IF EXISTS ${TARGET_DB} WITH (FORCE)`);
}

/** Contagem e hash do conteúdo de TODAS as tabelas de public e dos schemas de arquivo (ordem pelo próprio JSON, em UTC). */
async function contentMap(pool) {
  const c = await pool.connect();
  try {
    await c.query(`SET TimeZone = 'UTC'`);
    const { rows: tabs } = await c.query(`SELECT schemaname, tablename FROM pg_tables WHERE schemaname = 'public' OR schemaname LIKE 'financeiro\\_arquivo\\_%' ORDER BY 1, 2`);
    const out = {};
    for (const t of tabs) {
      const { rows } = await c.query(`SELECT count(*)::int AS n, md5(coalesce(string_agg(x, '|' ORDER BY x), '')) AS h FROM (SELECT to_jsonb(t)::text AS x FROM "${t.schemaname}"."${t.tablename}" t) s`);
      out[`${t.schemaname}.${t.tablename}`] = rows[0];
    }
    return out;
  } finally {
    await c.query('RESET TimeZone').catch(() => {});
    c.release();
  }
}

/** Donos, ACLs, funções (SECURITY DEFINER, search_path, ACL) e sequências. */
async function catalogMap(pool) {
  const rel = (await pool.query(`SELECT n.nspname || '.' || c.relname AS k, c.relkind::text AS kind, c.relowner::regrole::text AS owner, coalesce(c.relacl::text, '') AS acl
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE (n.nspname = 'public' OR n.nspname LIKE 'financeiro\\_arquivo\\_%') AND c.relkind IN ('r', 'S') ORDER BY 1`)).rows;
  const fn = (await pool.query(`SELECT p.oid::regprocedure::text AS k, p.proowner::regrole::text AS owner, p.prosecdef, coalesce(p.proconfig::text, '') AS config, coalesce(p.proacl::text, '') AS acl
      FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace ORDER BY 1`)).rows;
  const sq = (await pool.query(`SELECT schemaname || '.' || sequencename AS k, coalesce(last_value::text, '') AS last_value
      FROM pg_sequences WHERE schemaname = 'public' OR schemaname LIKE 'financeiro\\_arquivo\\_%' ORDER BY 1`)).rows;
  const ns = (await pool.query(`SELECT nspname AS k, nspowner::regrole::text AS owner, coalesce(nspacl::text, '') AS acl FROM pg_namespace WHERE nspname = 'public' OR nspname LIKE 'financeiro\\_arquivo\\_%' ORDER BY 1`)).rows;
  return { rel, fn, sq, ns };
}


// pg_dump grava cada constraint a partir do texto de pg_get_constraintdef e, ao restaurar, o PostgreSQL a reescreve com outra FORMA de
// escrever a mesma expressão: listas IN (...) de colunas varchar (ANY (ARRAY[('a'::varchar)::text, ...]) vira ANY ((ARRAY['a'::varchar, ...])::text[]),
// <> ALL (...) idem) e a parentização de cadeias AND ((a AND b) AND c) x (a AND b AND c). É só texto, e vale também para constraints
// ANTIGAS (admin_audit_log_action_check, recurring_exceptions_week_of_month_check, support_messages_body_check, idx_appointments_expires_at). Para as
// expressões (CHECK, predicado de índice parcial, WHEN de trigger) compara-se a SEQUÊNCIA de identificadores, operadores e literais (sem parênteses, colchetes, espaços e casts); o comportamento das
// restrições é provado à parte, exercitando-as no banco restaurado. Todo o resto do fingerprint é comparado linha a linha, sem tolerância.
const CAST = /::(character varying|text|integer|bigint|smallint|date|timestamp with time zone|uuid|name|boolean|numeric)(\[\])?/g;
const normalizeFp = (line) => {
  if (!/^(con|idx|trg):/.test(line)) return line;
  const m = /:CHECK|\sWHERE\s|\sWHEN\s/.exec(line);   // só a parte de expressão: CHECK, predicado de índice parcial, WHEN de trigger
  if (!m) return line;
  return line.slice(0, m.index) + line.slice(m.index).replace(CAST, '').replace(/[()[\]\s]/g, '');
};

async function dumpAndRestore(label) {
  const file = path.join(workDir, `${label}.dump`);
  const d = await run(bin('pg_dump'), ['-Fc', ...pgArgs(), '-f', file, conn.db]);
  assert.equal(d.stderr.trim(), '', 'pg_dump sem avisos nem erros');
  const size = (await fs.stat(file)).size;
  assert.ok(size > 10_000, `dump com tamanho plausível (${size} bytes)`);
  const list = (await run(bin('pg_restore'), ['--list', file])).stdout;
  await createTarget();
  const r = await run(bin('pg_restore'), ['--exit-on-error', ...pgArgs(), '-d', TARGET_DB, file]);
  assert.equal(r.stderr.trim(), '', 'pg_restore sem erros');
  return { file, list };
}

before(async () => {
  const r = await resolveFinanceTestDb(process.env, VAR);
  if (r.skip) { skip = r.skip; return; }
  ownerUrl = r.url;
  const u = new URL(r.url);
  conn = { host: u.hostname, port: u.port || '5432', user: decodeURIComponent(u.username), db: decodeURIComponent(u.pathname.slice(1)) };
  owner = new pg.Pool({ connectionString: r.url, options: '-c TimeZone=UTC', max: 4 });
  owner.on('error', () => {});
  db = financeDb(owner);
  seed = seedTools(owner, 'fin-dmp');
  workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fin-dump-'));
  await dropTarget();
  await db.reset({ emailLike: EMAIL_LIKE, roles: [ROLE] });
});

after(async () => {
  if (!owner) return;
  try {
    await dropTarget().catch(() => {});
    await db.reset({ emailLike: EMAIL_LIKE, roles: [ROLE] });
    if (workDir) await fs.rm(workDir, { recursive: true, force: true });
  } finally {
    await owner.end();
  }
});

const dbTest = (name, fn) => test(name, T, async (t) => { if (skip) return t.skip(skip); await fn(t); });

dbTest('preparação: 025 + role da aplicação + dados completos, rollback autorizado (arquivo) e 025 reaplicada', async () => {
  await db.createAppRole(ROLE);                 // como em produção: a role existe antes da 025
  await db.up();
  await db.grant(ROLE);
  state.seed1 = await seed.seedFinancialData('-a');
  state.hashes = await projectionHashes(owner);
  for (const [t, v] of Object.entries(state.hashes)) assert.ok(v.n > 0, `${t} precisa ter dados`);
  await db.down({ confirm: CONFIRM });
  [state.archive] = await db.archives();
  assert.ok(state.archive);
  await db.up();                                // estrutura pristina outra vez
  await db.grant(ROLE);
  assert.equal((await owner.query('SELECT count(*)::int AS n FROM financial_payments')).rows[0].n, 0);
  const manifest = Object.fromEntries((await owner.query(`SELECT table_name, row_count::int AS n, md5 FROM "${state.archive}"._manifest`)).rows.map((r) => [r.table_name, { n: r.n, h: r.md5 }]));
  assert.deepEqual(manifest, state.hashes);
});

dbTest('ensaio 1 — recuperação a partir de backup: dump -> pg_restore em outro banco -> restauração do arquivo; contagem e hash de todas as colunas', async () => {
  const before = await contentMap(owner);
  const { list } = await dumpAndRestore('estado-pristino');
  assert.deepEqual(await contentMap(owner), before, 'o pg_dump não altera o banco de origem');
  assert.match(list, new RegExp(`SCHEMA - ${state.archive}`), 'o schema de arquivo está no dump');
  assert.match(list, new RegExp(`TABLE ${state.archive} _manifest`), 'o manifesto está no dump');
  assert.match(list, /FUNCTION public fin_audit\(/);

  // o arquivo chegou íntegro ao banco restaurado (contagem e hash de cada tabela, incluindo o manifesto)
  const restored = await contentMap(target);
  assert.deepEqual(restored, before, 'todas as tabelas (public e arquivo) idênticas ao original');
  // e a recuperação funciona NO BANCO RESTAURADO: o script valida o arquivo contra o manifesto e devolve todas as colunas
  const tdb = financeDb(target);
  await tdb.restore(state.archive);
  assert.deepEqual(await projectionHashes(target), state.hashes, 'dados recuperados do backup = dados anteriores ao rollback (todas as colunas)');
  await dropTarget();
});

dbTest('ensaio 2 — fidelidade total: dump com dados vivos E schema de arquivo; tabelas, estrutura, donos, ACLs, funções e sequências idênticos', async () => {
  state.seed2 = await seed.seedFinancialData('-b'); // dados vivos novos, ao lado do arquivo
  const srcContent = await contentMap(owner);
  const srcCatalog = await catalogMap(owner);
  const srcFingerprintLines = await db.fingerprintLines();
  const srcMaxSeq = Number((await owner.query('SELECT max(seq) AS m FROM financial_audit_log')).rows[0].m);
  const live = await projectionHashes(owner);
  for (const [t, v] of Object.entries(live)) assert.ok(v.n > 0, `${t}: dados vivos`);

  const { list } = await dumpAndRestore('dados-vivos-e-arquivo');
  assert.deepEqual(await contentMap(owner), srcContent, 'o pg_dump não altera o banco de origem');

  // entradas esperadas no dump
  for (const re of [new RegExp(`SCHEMA - ${state.archive}`), new RegExp(`TABLE ${state.archive} financial_payments`), new RegExp(`TABLE ${state.archive} _manifest`),
    /TABLE public financial_payments/, /TABLE public financial_audit_log/, /TABLE public cash_closings/, /FUNCTION public fin_payments_guard\(/,
    /TRIGGER public financial_payments trg_financial_payments_guard/, /TRIGGER public expenses trg_expenses_fin_audit/, /ACL .*financial_payments/]) {
    assert.match(list, re);
  }

  // conteúdo: contagem e hash de TODAS as tabelas
  const dstContent = await contentMap(target);
  assert.deepEqual(Object.keys(dstContent), Object.keys(srcContent), 'mesmas tabelas');
  assert.deepEqual(dstContent, srcContent, 'contagem e hash idênticos em todas as tabelas');
  // estrutura, donos, ACLs, funções, sequências
  assert.deepEqual((await financeDb(target).fingerprintLines()).map(normalizeFp), srcFingerprintLines.map(normalizeFp), 'colunas, constraints, índices, triggers e funções idênticos');
  const dstCatalog = await catalogMap(target);
  assert.deepEqual(dstCatalog, srcCatalog, 'donos, ACLs, SECURITY DEFINER/search_path e sequências idênticos');
  const audit = srcCatalog.fn.find((f) => f.k.startsWith('fin_audit('));
  assert.equal(audit.prosecdef, true);
  assert.equal(audit.config, '{"search_path=pg_catalog, pg_temp"}');
  assert.ok(!/=X\//.test(audit.acl) || !/(^|,)=X/.test(audit.acl), 'fin_audit sem EXECUTE para o público (preservado)');

  state.srcMaxSeq = srcMaxSeq;
  state.live = live;
});

dbTest('no banco restaurado: guardas, privilégios da aplicação, sequência do histórico e manifesto do arquivo continuam valendo', async () => {
  const c = async (sql, params) => target.query(sql, params);
  // append-only
  const rec = (await c(`SELECT id, professional_id, appointment_id FROM financial_payments WHERE kind = 'recebimento' AND amount_cents = 8000 ORDER BY created_at LIMIT 1`)).rows[0];
  await assert.rejects(c(`UPDATE financial_payments SET amount_cents = 1 WHERE id = $1`, [rec.id]), (e) => { assert.equal(e.code, '23514'); assert.match(e.message, /append-only/); return true; });
  await assert.rejects(c(`DELETE FROM financial_audit_log WHERE seq = (SELECT min(seq) FROM financial_audit_log)`), (e) => { assert.equal(e.code, '23514'); return true; });
  // estorno acima do saldo
  await assert.rejects(c(`INSERT INTO financial_payments (professional_id, appointment_id, kind, amount_cents, method, occurred_on, notes, reverses_payment_id)
      VALUES ($1, $2, 'estorno', 7001, 'pix', '2026-06-20', 'acima do saldo', $3)`, [rec.professional_id, rec.appointment_id, rec.id]), (e) => { assert.equal(e.code, '23514'); assert.match(e.message, /excederiam/); return true; });
  // dia fechado
  const closed = (await c(`SELECT professional_id, closing_date::text AS d FROM cash_closings WHERE status = 'fechado' ORDER BY created_at LIMIT 1`)).rows[0];
  const apptOfClosed = (await c(`SELECT id FROM appointments WHERE professional_id = $1 LIMIT 1`, [closed.professional_id])).rows[0].id;
  await assert.rejects(c(`INSERT INTO financial_payments (professional_id, appointment_id, kind, amount_cents, method, occurred_on) VALUES ($1, $2, 'recebimento', 100, 'pix', $3)`,
    [closed.professional_id, apptOfClosed, closed.d]), (e) => { assert.equal(e.code, '23514'); assert.match(e.message, /fechado/); return true; });
  // idempotência
  const idem = (await c(`SELECT professional_id, appointment_id, idempotency_key, request_hash FROM financial_payments WHERE idempotency_key IS NOT NULL LIMIT 1`)).rows[0];
  await assert.rejects(c(`INSERT INTO financial_payments (professional_id, appointment_id, kind, amount_cents, method, occurred_on, idempotency_key, request_hash) VALUES ($1, $2, 'recebimento', 100, 'pix', '2026-06-21', $3, $4)`,
    [idem.professional_id, idem.appointment_id, idem.idempotency_key, idem.request_hash]), (e) => { assert.equal(e.code, '23505'); return true; });

  // privilégios da aplicação (ACLs restauradas): lê e insere, mas não altera nem apaga as tabelas append-only
  const app = await target.connect();
  try {
    await app.query(`SET ROLE ${ROLE}`);
    await app.query('SELECT count(*) FROM financial_payments');
    for (const sql of ['UPDATE financial_payments SET amount_cents = 1', 'DELETE FROM financial_payments', 'TRUNCATE financial_payments', 'TRUNCATE financial_audit_log']) {
      await assert.rejects(app.query(sql), (e) => { assert.equal(e.code, '42501', sql); return true; });
    }
    await assert.rejects(app.query(`SELECT fin_audit(gen_random_uuid(), 'payment', gen_random_uuid(), 'correction', NULL, NULL, 'forjado')`), (e) => { assert.equal(e.code, '42501'); return true; });
  } finally {
    await app.query('RESET ROLE').catch(() => {});
    app.release();
  }

  // sequência do histórico restaurada: o próximo seq é exatamente max + 1
  const maxBefore = Number((await c('SELECT max(seq) AS m FROM financial_audit_log')).rows[0].m);
  assert.equal(maxBefore, state.srcMaxSeq);
  const next = (await c(`INSERT INTO financial_audit_log (professional_id, entity_type, entity_id, action, reason) VALUES ($1, 'payment', gen_random_uuid(), 'correction', 'Correção manual de teste') RETURNING seq`, [rec.professional_id])).rows[0].seq;
  assert.equal(Number(next), maxBefore + 1);

  // o arquivo no banco restaurado confere com o próprio manifesto, tabela por tabela
  const manifest = (await c(`SELECT table_name, row_count::int AS n, md5 FROM "${state.archive}"._manifest ORDER BY 1`)).rows;
  assert.equal(manifest.length, 5);
  const client = await target.connect();
  try {
    await client.query(`SET TimeZone = 'UTC'`);
    for (const m of manifest) {
      const { rows } = await client.query(`SELECT count(*)::int AS n, md5(coalesce(string_agg(to_jsonb(t)::text, '|' ORDER BY t.id::text), '')) AS h FROM "${state.archive}"."${m.table_name}" t`);
      assert.deepEqual({ n: rows[0].n, h: rows[0].h }, { n: m.n, h: m.md5 }, `manifesto de ${m.table_name}`);
    }
  } finally {
    client.release();
  }
  await dropTarget();
});
