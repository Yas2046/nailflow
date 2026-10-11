// Testes das migrations 023 (Central de Ajuda e Suporte) e 024 (auditoria).
//
// SEGURANÇA: estes testes criam e apagam dados, alteram constraints/triggers, fazem DROP de tabelas e
// executam os scripts de rollback. Por padrão NÃO rodam: sem SUPPORT_MIGRATION_TEST_DB_URL todos os testes
// que tocam o banco são pulados (a suíte normal, `npm test`, não é afetada). Com a variável definida, o alvo
// só é aceito se TODAS as condições abaixo valerem; se alguma falhar o arquivo ABORTA (erro no hook
// `before`), antes de qualquer DDL:
//   1. opt-in explícito NAILFLOW_ALLOW_TEST_DDL=1 (mesma convenção dos outros testes de DDL do projeto);
//   2. host de loopback, e URL sem host/hostaddr/service alternativos;
//   3. nome do banco ^nf_[a-z0-9_]*_test$;
//   4. o CLUSTER só contém bancos descartáveis: todo banco não-template precisa ser "postgres" ou casar com
//      o padrão acima. Um cluster que hospede "nailflow", "nailflow_test" ou qualquer outro banco é recusado;
//   5. o banco alvo carrega o marcador deixado por quem o preparou (como dono do banco/superusuário):
//        COMMENT ON DATABASE nf_xxx_test IS 'NAILFLOW_DISPOSABLE_TEST_DB';
// LIMITE: é prova LÓGICA de que o alvo é descartável, não física. Ela não distingue um cluster descartável
// de uma cópia/clone que, por acaso, só tenha bancos nf_*_test e o marcador. Use um cluster criado só para
// isto (initdb próprio, porta própria). O banco precisa ter o schema base (db/schema.sql + migrations
// 001..022); 023 e 024 são aplicadas aqui.
//
// USO EXCLUSIVO DO BANCO: a suíte altera schema, tabelas, constraints e dados de teste. Não execute duas
// execuções simultâneas sobre o mesmo banco descartável; cada execução com banco deve usar uma instância/banco
// isolado, com a identidade confirmada (cluster, porta, nome e marcador).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const URL_ENV = process.env.SUPPORT_MIGRATION_TEST_DB_URL;
const SAFE_DB_NAME = /^nf_[a-z0-9_]*_test$/;
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
const MIGRATIONS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../db/migrations');
const CONFIRM = 'DESTRUIR-DADOS-DE-SUPORTE';
const HASH = 'a'.repeat(64);
const HASH2 = 'b'.repeat(64);

export const DISPOSABLE_MARKER = 'NAILFLOW_DISPOSABLE_TEST_DB';

// Devolve a lista de motivos pelos quais o alvo é recusado (vazia = aceito). Sem `databases` só vale a
// parte anterior à conexão (opt-in, host, URL, nome); com `databases` entram também o cluster e o marcador.
export function assessTarget({ url, env = {}, currentDb, databases, marker } = {}) {
  const why = [];
  if (env.NAILFLOW_ALLOW_TEST_DDL !== '1') why.push('opt-in ausente: defina NAILFLOW_ALLOW_TEST_DDL=1');
  let parsed = null;
  try { parsed = new URL(url); } catch { why.push('URL inválida'); }
  let urlDb = null;
  if (parsed) {
    if (!LOOPBACK.has(parsed.hostname)) why.push(`host "${parsed.hostname}" não é de loopback`);
    for (const k of ['host', 'hostaddr', 'service']) {
      if (parsed.searchParams.has(k)) why.push(`parâmetro de URL "${k}" não é aceito (host ambíguo)`);
    }
    urlDb = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
    if (!SAFE_DB_NAME.test(urlDb)) why.push(`nome de banco "${urlDb}" fora do padrão nf_*_test`);
  }
  if (databases !== undefined) {
    if (currentDb !== urlDb) why.push(`banco conectado "${currentDb}" difere do informado na URL "${urlDb}"`);
    if (!Array.isArray(databases) || databases.length === 0) {
      why.push('lista de bancos do cluster indisponível');
    } else {
      const foreign = databases.filter((d) => d !== 'postgres' && !SAFE_DB_NAME.test(d));
      if (foreign.length) why.push(`o cluster hospeda bancos que não são descartáveis: ${foreign.join(', ')}`);
    }
    if (marker !== DISPOSABLE_MARKER) why.push(`banco sem o marcador COMMENT ON DATABASE ... IS '${DISPOSABLE_MARKER}'`);
  }
  return why;
}

let pool;
let baseline; // impressão digital do schema logo depois de aplicar 023/024

const q = (sql, params) => pool.query(sql, params);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readSql = (rel) => fs.readFile(path.join(MIGRATIONS, rel), 'utf8');
const DOWN_023 = '_rollback/023_support_center.down.sql';

// Limite explícito por teste: nenhum teste que toca o banco pode ficar pendurado esperando lock ou resultado.
// (O runner do Node não tem limite por padrão; rode o arquivo também sob `timeout` do shell.)
const TEST_TIMEOUT_MS = 60_000;

const withTimeout = (promise, ms, what) => Promise.race([
  promise,
  new Promise((_, reject) => {
    const t = setTimeout(() => reject(new Error(`Tempo esgotado (${ms} ms): ${what}`)), ms);
    t.unref?.();
  }),
]);

// Espera, com limite de tempo, até `probe()` devolver algo verdadeiro (evidência observada, não um `sleep`
// no escuro). No limite lança erro com o diagnóstico de `describe()`.
export async function waitUntil(probe, { timeoutMs = 5000, intervalMs = 50, what = 'a condição esperada', describe = async () => '' } = {}) {
  const t0 = Date.now();
  for (;;) {
    const value = await probe();
    if (value) return value;
    if (Date.now() - t0 >= timeoutMs) {
      let extra;
      try { extra = await describe(); } catch (err) { extra = `(diagnóstico indisponível: ${err.message})`; }
      throw new Error(`Tempo esgotado (${timeoutMs} ms) esperando ${what}. ${extra}`.trim());
    }
    await sleep(intervalMs);
  }
}

// Encerra a transação do cliente e o devolve ao pool. ROLLBACK é inofensivo se já houve COMMIT. Se o
// ROLLBACK falhar, a conexão é DESTRUÍDA (release(err)): nunca volta ao pool presa em transação com locks.
// Não lança.
export async function endTx(client) {
  let failure;
  try { await client.query('ROLLBACK'); } catch (err) { failure = err; }
  client.release(failure);
}

// Cliente dedicado: um erro dentro de um arquivo com BEGIN explícito deixa a conexão em transação
// abortada; sempre damos ROLLBACK antes de devolver o cliente ao pool. A autorização do rollback destrutivo
// vive na SESSÃO: se não for possível limpá-la (RESET), a conexão é destruída, nunca devolvida "armada".
// `statementTimeoutMs` (opcional) impõe um limite de relógio NO SERVIDOR (statement_timeout) enquanto o arquivo
// roda; mesmo cuidado com o RESET.
async function runSql(sql, { confirm, statementTimeoutMs } = {}) {
  const c = await pool.connect();
  let broken;
  try {
    if (statementTimeoutMs) await c.query(`SET statement_timeout = ${Number(statementTimeoutMs)}`);
    if (confirm) await c.query(`SET support.confirm_destructive_rollback = '${confirm}'`);
    return await c.query(sql);
  } catch (err) {
    try { await c.query('ROLLBACK'); } catch (rollbackErr) { broken = rollbackErr; }
    throw err;
  } finally {
    try { await c.query('RESET support.confirm_destructive_rollback'); } catch (resetErr) { broken ??= resetErr; }
    if (statementTimeoutMs) {
      try { await c.query('RESET statement_timeout'); } catch (resetErr) { broken ??= resetErr; }
    }
    c.release(broken);
  }
}
const applyFile = async (rel, opts) => runSql(await readSql(rel), opts);

async function inTx(fn) {
  const c = await pool.connect();
  let broken;
  try {
    await c.query('BEGIN');
    const out = await fn(c);
    await c.query('COMMIT');
    return out;
  } catch (err) {
    try { await c.query('ROLLBACK'); } catch (rollbackErr) { broken = rollbackErr; }
    throw err;
  } finally {
    c.release(broken);
  }
}

// LIMITES DA RESTAURAÇÃO, IMPOSTOS NO SERVIDOR. Desistir do lado do cliente NÃO interrompe o PostgreSQL: a
// mensagem (BEGIN; ...; COMMIT;) já chegou ao backend, que a executa até o fim mesmo sem cliente, e um
// ALTER TABLE que espera lock pode obter o lock depois e confirmar a alteração. Por isso a restauração nunca é
// abandonada por timeout do cliente: os comandos de DDL/DML e os arquivos aplicados pelos passos têm
// lock_timeout (3 s) e statement_timeout (10 s) no próprio servidor, e quem a iniciou espera ela terminar ou
// falhar. EXCEÇÃO: os dois fingerprint() (início e fim de restoreSchema) usam q() direto no pool, SEM
// lock_timeout nem statement_timeout; são leituras de catálogo e só têm o limite de conexão do Pool
// (connectionTimeoutMillis). A transação do passo que falha é revertida por inteiro, mas a restauração NÃO é
// atômica: os passos anteriores já foram confirmados e não são desfeitos, então o schema pode ficar num
// estado intermediário (o erro explícito é o sinal).
const RESTORE_LOCK_TIMEOUT = '3s';
const RESTORE_STATEMENT_TIMEOUT_MS = 10_000;
const RESTORE_DEADLINE_MS = 30_000;

// DDL/DML da restauração: transação curta e dedicada, com os dois limites do servidor.
const ddl = (sql) => runSql(
  `BEGIN; SET LOCAL lock_timeout = '${RESTORE_LOCK_TIMEOUT}'; SET LOCAL statement_timeout = '${RESTORE_STATEMENT_TIMEOUT_MS / 1000}s'; ${sql}; COMMIT;`);

// Executa os passos em ordem; depois do prazo NENHUM passo novo começa (o que já começou é limitado pelos
// timeouts do servidor). Não cancela nada em andamento.
export async function runSteps(steps, { deadlineMs, now = Date.now } = {}) {
  const limit = now() + deadlineMs;
  for (const [name, step] of steps) {
    if (now() > limit) {
      throw new Error(`prazo de ${deadlineMs} ms esgotado antes do passo "${name}" (nenhum passo novo foi iniciado depois do prazo)`);
    }
    await step();
  }
}

// Devolve o schema ao baseline (023/024 como aplicadas no `before`) se o teste o deixou adulterado. É uma
// rede de segurança: com o schema íntegro não faz nada. Como é banco descartável, usa o rollback 023 com a
// confirmação explícita (apaga os dados de suporte) e reaplica.
async function restoreSchema() {
  if ((await fingerprint()).h === baseline.h) return;
  const files = { statementTimeoutMs: RESTORE_STATEMENT_TIMEOUT_MS };
  await runSteps([
    ...['zz_extra', 'audit_renamed', 'admin_audit_log_action_check'].map((name) => [
      `remover a constraint ${name}`, () => ddl(`ALTER TABLE admin_audit_log DROP CONSTRAINT IF EXISTS ${name}`)]),
    ['apagar a auditoria de teste', () => ddl("DELETE FROM admin_audit_log WHERE actor_email LIKE '%@example.invalid'")],
    ['recriar a constraint de 4 ações', () => ddl(
      "ALTER TABLE admin_audit_log ADD CONSTRAINT admin_audit_log_action_check CHECK (action IN ('block', 'unblock', 'update', 'delete'))")],
    ['aplicar a 024', () => applyFile('024_audit_actions_support.sql', files)],
    ['rollback da 023', () => applyFile(DOWN_023, { confirm: CONFIRM, ...files })],
    ['aplicar a 023', () => applyFile('023_support_center.sql', files)],
  ], { deadlineMs: RESTORE_DEADLINE_MS });
  if ((await fingerprint()).h !== baseline.h) throw new Error('restoreSchema: o schema não voltou ao baseline');
}

// Executa `fn` e restaura o schema SEMPRE (mesmo se uma asserção falhar). O erro original é preservado;
// se a restauração também falhar, isso é acrescentado à mensagem. A restauração é AGUARDADA até terminar (não
// há timeout do lado do cliente), então withSchemaRestore não retorna enquanto ela corre. LIMITE (R3): o
// timeout do `node:test` (TEST_TIMEOUT_MS) NÃO cancela a função assíncrona; se ele abandonar um teste, a
// restauração pode continuar em segundo plano. Isso é limitado pelos timeouts do servidor e pelo prazo de
// runSteps (nenhum passo novo depois de RESTORE_DEADLINE_MS), mas não é eliminado.
export async function withSchemaRestore(fn, restore = restoreSchema) {
  let primary;
  try { await fn(); } catch (err) { primary = err; }
  try {
    await restore();
  } catch (restoreErr) {
    if (!primary) primary = restoreErr;
    else primary.message += ` [além disso, a restauração do schema falhou: ${restoreErr.message}]`;
  }
  if (primary) throw primary;
}

// Teste que adultera o schema: registrado já embrulhado em withSchemaRestore.
const schemaTest = (name, opts, fn) => test(name, opts, () => withSchemaRestore(fn));

async function rejectsWith(promise, code, constraint) {
  await assert.rejects(promise, (err) => {
    assert.equal(err.code, code, `esperava SQLSTATE ${code}, veio ${err.code}: ${err.message}`);
    if (constraint) assert.equal(err.constraint, constraint, `constraint: ${err.constraint}`);
    return true;
  });
}

let seqCounter = 0;
async function newProfessional({ admin = false } = {}) {
  const n = `${Date.now()}-${++seqCounter}-${Math.random().toString(36).slice(2, 8)}`;
  const { rows } = await q(
    `INSERT INTO professionals (name, email, password_hash, slug, is_admin)
     VALUES ($1, $2, 'hash', $3, $4) RETURNING id`,
    [`Teste ${n}`, `support-test-${n}@example.invalid`, `support-test-${n}`, admin]
  );
  return rows[0].id;
}
const newAdmin = () => newProfessional({ admin: true });

async function newTicket(professionalId, extra = {}) {
  const { rows } = await q(
    `INSERT INTO support_tickets (professional_id, category, subject) VALUES ($1, $2, $3) RETURNING id`,
    [professionalId, extra.category ?? 'agenda', extra.subject ?? 'Assunto de teste']
  );
  return rows[0].id;
}

// Autor coerente com o papel: professional => a titular; admin => a conta admin informada.
const addMessage = (client, ticketId, profId, role = 'professional', adminId = null, body = 'olá', extra = {}) =>
  client.query(
    `INSERT INTO support_messages (ticket_id, professional_id, author_role, author_id, body, client_message_id, request_hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7) ${extra.onConflict ?? ''} RETURNING id, seq`,
    [ticketId, profId, role, role === 'professional' ? profId : adminId, body, extra.cid ?? null, extra.cid ? HASH : null]
  );

const addEvent = (client, ticketId, profId, type, to, role, adminId = null, from = null, onConflict = '') =>
  client.query(
    `INSERT INTO support_ticket_events (ticket_id, professional_id, type, from_value, to_value, actor_role, actor_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7) ${onConflict} RETURNING id, seq`,
    [ticketId, profId, type, from, to, role, role === 'professional' ? profId : role === 'admin' ? adminId : null]
  );

const getTicket = async (id) => (await q('SELECT * FROM support_tickets WHERE id = $1', [id])).rows[0];
const count = async (table, where, params) =>
  (await q(`SELECT count(*)::int AS n FROM ${table} WHERE ${where}`, params)).rows[0].n;
const profUnread = (t) => t.last_actor === 'admin' && BigInt(t.last_seq) > BigInt(t.prof_read_seq);
const adminUnread = (t) => t.last_actor === 'professional' && BigInt(t.last_seq) > BigInt(t.admin_read_seq);
const summary = (t) => ({
  a: t.activity_seq, l: t.last_seq, who: t.last_actor, at: new Date(t.last_activity_at).getTime(),
});

async function fingerprint() {
  const { rows } = await q(`
    SELECT md5(string_agg(x, E'\\n' ORDER BY x)) AS h, count(*)::int AS n FROM (
      SELECT 'c:' || conrelid::regclass::text || ':' || conname || ':' || pg_get_constraintdef(oid) AS x FROM pg_constraint
       WHERE conrelid::regclass::text LIKE 'support\\_%' OR conrelid = 'admin_audit_log'::regclass
      UNION ALL SELECT 'i:' || indexdef FROM pg_indexes WHERE tablename LIKE 'support\\_%'
      UNION ALL SELECT 't:' || pg_get_triggerdef(t.oid) || ':' || t.tgenabled::text FROM pg_trigger t
        JOIN pg_class c ON c.oid = t.tgrelid WHERE NOT t.tgisinternal AND c.relname LIKE 'support\\_%'
      UNION ALL SELECT 'f:' || p.proname || ':' || md5(p.prosrc) || ':' || COALESCE(p.proconfig::text, '')
        FROM pg_proc p WHERE p.proname LIKE 'support\\_%'
      UNION ALL SELECT 'a:' || table_name || '.' || column_name || ':' || data_type || ':' || is_nullable || ':' || COALESCE(column_default, '')
        FROM information_schema.columns WHERE table_name LIKE 'support\\_%' OR (table_name = 'professionals' AND column_name = 'support_fab_hidden')
    ) q`);
  return rows[0];
}

const skip = URL_ENV ? false : 'SUPPORT_MIGRATION_TEST_DB_URL não definida (testes de migration só rodam em banco descartável).';

before(async () => {
  if (!URL_ENV) return;
  // Camada 1 (antes de conectar): opt-in, host, URL e nome.
  const pre = assessTarget({ url: URL_ENV, env: process.env });
  if (pre.length) throw new Error(`Alvo recusado antes de conectar: ${pre.join('; ')}. Nenhum SQL foi executado.`);
  // connectionTimeoutMillis: com o pool esgotado por conexões não devolvidas, pool.connect() falha em 10 s em
  // vez de esperar para sempre (os testes usam no máximo ~30 conexões simultâneas, abaixo de max).
  pool = new pg.Pool({ connectionString: URL_ENV, max: 40, connectionTimeoutMillis: 10_000 });
  // Camada 2 (somente SELECTs): banco conectado, bancos do cluster e marcador.
  const { rows } = await pool.query(`
    SELECT current_database() AS db,
           (SELECT array_agg(datname::text ORDER BY datname) FROM pg_database WHERE NOT datistemplate) AS dbs,
           (SELECT pg_catalog.shobj_description(oid, 'pg_database') FROM pg_database WHERE datname = current_database()) AS marker`);
  const post = assessTarget({ url: URL_ENV, env: process.env, currentDb: rows[0].db, databases: rows[0].dbs, marker: rows[0].marker });
  if (post.length) {
    await pool.end();
    pool = null;
    throw new Error(`Alvo recusado: ${post.join('; ')}. Nenhum DDL foi executado.`);
  }
  await applyFile('023_support_center.sql');
  await applyFile('024_audit_actions_support.sql');
  baseline = await fingerprint();
}, { timeout: 120_000 });

after(async () => {
  if (pool) {
    await q("DELETE FROM professionals WHERE email LIKE 'support-test-%@example.invalid'").catch(() => {});
    await q("DELETE FROM admin_audit_log WHERE actor_email LIKE '%@example.invalid'").catch(() => {});
    // Limitado: um cliente que não tenha sido devolvido faria o pool.end() esperar para sempre. O timer é
    // unref'd: um timer comum mantinha o processo vivo por 15 s depois do fim do `after` (medido na Etapa 6.1:
    // pool.end() leva ~1 ms, e o duration_ms do `node --test` inclui a vida do processo do arquivo). Se um
    // cliente vazar, o timer ainda dispara enquanto o socket dele mantiver o laço de eventos vivo.
    await Promise.race([pool.end(), new Promise((resolve) => setTimeout(resolve, 15_000).unref())]);
  }
}, { timeout: 60_000 });

// ═══════════════════════════ segurança do próprio teste ═══════════════════════════

const GOOD_URL = 'postgresql://u@127.0.0.1:55432/nf_support_x_test';
const OK_ENV = { NAILFLOW_ALLOW_TEST_DDL: '1' };
const GOOD_CLUSTER = { currentDb: 'nf_support_x_test', databases: ['nf_other_test', 'nf_support_x_test', 'postgres'], marker: DISPOSABLE_MARKER };
const reasons = (over) => assessTarget({ url: GOOD_URL, env: OK_ENV, ...GOOD_CLUSTER, ...over });

test('trava: aceita somente o alvo que passa em todas as camadas', () => {
  assert.deepEqual(assessTarget({ url: GOOD_URL, env: OK_ENV }), []);   // só a camada anterior à conexão
  assert.deepEqual(reasons({}), []);
  assert.deepEqual(reasons({ url: 'postgresql://u@localhost/nf_support_x_test' }), []);
});

test('trava: opt-in explícito é obrigatório e só vale "1"', () => {
  for (const v of [undefined, '', '0', 'true', 'yes', ' 1']) {
    assert.match(reasons({ env: { NAILFLOW_ALLOW_TEST_DDL: v } }).join(';'), /opt-in ausente/, String(v));
  }
  assert.match(assessTarget({ url: GOOD_URL }).join(';'), /opt-in ausente/);
});

test('trava: host que não é de loopback e parâmetros de host alternativos são recusados', () => {
  for (const host of ['db.exemplo.com', '77.237.242.192', '10.0.0.5', '0.0.0.0', '192.168.1.10']) {
    assert.match(reasons({ url: `postgresql://u@${host}/nf_support_x_test` }).join(';'), /não é de loopback/, host);
  }
  for (const q of ['host=/var/run/postgresql', 'hostaddr=10.0.0.5', 'service=prod']) {
    assert.match(reasons({ url: `${GOOD_URL}?${q}` }).join(';'), /não é aceito/, q);
  }
  for (const u of ['nao-e-url', '', undefined]) assert.match(assessTarget({ url: u, env: OK_ENV }).join(';'), /URL inválida/);
});

test('trava: nomes de banco fora do padrão nf_*_test são recusados', () => {
  for (const db of ['nailflow', 'nailflow_test', 'postgres', 'nf_prod', 'NF_X_TEST', 'nf_x_test; DROP', 'nf_x_test_', 'xnf_x_test']) {
    assert.match(reasons({ url: `postgresql://u@127.0.0.1/${encodeURIComponent(db)}`, currentDb: db }).join(';'), /fora do padrão/, db);
  }
});

test('trava: cluster que hospeda banco não descartável é recusado mesmo com host, nome e marcador corretos', () => {
  for (const extra of [['nailflow'], ['nailflow_test'], ['nailflow_staging'], ['meu_projeto'], ['nf_prod'], ['nailflow', 'nailflow_test']]) {
    const dbs = [...GOOD_CLUSTER.databases, ...extra];
    assert.match(reasons({ databases: dbs }).join(';'), new RegExp(`não são descartáveis: ${extra.join(', ')}`), extra.join(','));
  }
});

test('trava: o marcador de banco descartável é obrigatório e exato', () => {
  for (const m of [undefined, null, '', 'nailflow', 'nailflow_disposable_test_db', `${DISPOSABLE_MARKER} `]) {
    assert.match(reasons({ marker: m }).join(';'), /sem o marcador/, String(m));
  }
});

test('trava: o banco realmente conectado tem de ser o informado na URL', () => {
  assert.match(reasons({ currentDb: 'nf_outro_test' }).join(';'), /difere do informado/);
});

test('trava: lista de bancos do cluster ausente ou malformada é recusada (falha fechada)', () => {
  for (const dbs of [null, '', '{a,b}', [], 'nf_support_x_test']) {
    assert.match(reasons({ databases: dbs }).join(';'), /lista de bancos do cluster indisponível/, JSON.stringify(dbs));
  }
});

// Utilitários dos próprios testes (puros, sem banco: rodam também no modo padrão).
const fakeClient = (failRollback) => {
  const calls = [];
  return {
    calls,
    query: async (sql) => { calls.push(sql); if (failRollback) throw new Error('rollback falhou'); },
    release: (err) => { calls.push(['release', err ? err.message : null]); },
  };
};

test('utilitário: waitUntil devolve o valor assim que a evidência aparece', async () => {
  let n = 0;
  assert.equal(await waitUntil(async () => (++n >= 3 ? 'ok' : null), { timeoutMs: 1000, intervalMs: 5 }), 'ok');
  assert.equal(n, 3);
});

test('utilitário: waitUntil estoura o prazo com diagnóstico claro (e não esconde falha do próprio diagnóstico)', async () => {
  await assert.rejects(
    waitUntil(async () => null, { timeoutMs: 60, intervalMs: 10, what: 'o escritor bloquear', describe: async () => 'estado: pendente' }),
    (err) => { assert.match(err.message, /^Tempo esgotado \(60 ms\) esperando o escritor bloquear\. estado: pendente$/); return true; });
  await assert.rejects(
    waitUntil(async () => null, { timeoutMs: 30, intervalMs: 10, describe: async () => { throw new Error('sem acesso'); } }),
    (err) => { assert.match(err.message, /diagnóstico indisponível: sem acesso/); return true; });
});

test('utilitário: endTx faz ROLLBACK e devolve a conexão; se o ROLLBACK falhar, a conexão é DESTRUÍDA', async () => {
  const ok = fakeClient(false);
  await endTx(ok);
  assert.deepEqual(ok.calls, ['ROLLBACK', ['release', null]]);
  const bad = fakeClient(true);
  await endTx(bad);                       // não lança
  assert.deepEqual(bad.calls, ['ROLLBACK', ['release', 'rollback falhou']]);   // release(err) => o pool descarta a conexão
});

test('utilitário: withSchemaRestore restaura SEMPRE e preserva o erro original', async () => {
  let restored = 0;
  const restore = async () => { restored++; };
  await withSchemaRestore(async () => {}, restore);
  assert.equal(restored, 1);

  await assert.rejects(withSchemaRestore(async () => { throw new Error('asserção falhou'); }, restore),
    (err) => { assert.equal(err.message, 'asserção falhou'); return true; });
  assert.equal(restored, 2);                // restaurou mesmo com o teste falhando

  await assert.rejects(
    withSchemaRestore(async () => { throw new Error('asserção falhou'); }, async () => { throw new Error('restore quebrou'); }),
    (err) => { assert.match(err.message, /^asserção falhou \[além disso, a restauração do schema falhou: restore quebrou\]$/); return true; });

  await assert.rejects(withSchemaRestore(async () => {}, async () => { throw new Error('restore quebrou'); }),
    (err) => { assert.equal(err.message, 'restore quebrou'); return true; });   // teste passou, restauração falhou: não pode passar em silêncio
});

test('utilitário: withSchemaRestore AGUARDA a restauração terminar (não a abandona em segundo plano)', async () => {
  let finished = false;
  await withSchemaRestore(async () => {}, async () => { await sleep(80); finished = true; });
  assert.equal(finished, true, 'a restauração ainda estava rodando quando withSchemaRestore retornou');

  let finishedBeforeRejection = false;
  await assert.rejects(
    withSchemaRestore(async () => { throw new Error('original'); },
      async () => { await sleep(60); finishedBeforeRejection = true; throw new Error('restore lento quebrou'); }),
    (err) => {
      assert.equal(finishedBeforeRejection, true, 'o erro foi lançado enquanto a restauração ainda corria');
      assert.match(err.message, /^original \[além disso, a restauração do schema falhou: restore lento quebrou\]$/);
      return true;
    });
});

test('utilitário: runSteps não inicia nenhum passo depois do prazo e diz qual não começou', async () => {
  let t = 0;
  const now = () => t;
  const ran = [];
  const step = (name, cost) => [name, async () => { ran.push(name); t += cost; }];

  await runSteps([step('a', 10), step('b', 10)], { deadlineMs: 100, now });   // dentro do prazo: todos rodam, em ordem
  assert.deepEqual(ran, ['a', 'b']);

  t = 0; ran.length = 0;
  await assert.rejects(
    runSteps([step('a', 50), step('b', 50), step('c', 1), step('d', 1)], { deadlineMs: 80, now }),
    (err) => { assert.match(err.message, /^prazo de 80 ms esgotado antes do passo "c" \(nenhum passo novo foi iniciado depois do prazo\)$/); return true; });
  assert.deepEqual(ran, ['a', 'b']);                                            // c e d nunca começaram
});

// ═══════════════════════════ idempotência da migration e estrutura ═══════════════════════════

test('reaplicar 023 e 024 não muda nada (definições idênticas) e preserva os dados', { skip, timeout: TEST_TIMEOUT_MS }, async () => {
  const p = await newProfessional();
  const t = await newTicket(p);
  await addMessage(pool, t, p);
  const before1 = await fingerprint();
  assert.equal(before1.h, baseline.h);
  assert.ok(before1.n > 60, `impressão digital com poucos itens: ${before1.n}`);
  await applyFile('023_support_center.sql');
  await applyFile('024_audit_actions_support.sql');
  assert.deepEqual(await fingerprint(), before1);
  assert.equal((await getTicket(t)).activity_seq, '1');
  assert.equal(await count('support_messages', 'ticket_id = $1', [t]), 1);
});

test('seis categorias fixas e coluna de preferência', { skip, timeout: TEST_TIMEOUT_MS }, async () => {
  const { rows } = await q('SELECT slug, title, position FROM support_faq_categories ORDER BY position');
  assert.deepEqual(rows.map((r) => r.slug), ['agenda', 'clientes', 'servicos_config', 'perfil_acesso', 'financeiro', 'tecnico']);
  await rejectsWith(q("INSERT INTO support_faq_categories (slug, title, position) VALUES ('outra', 'Outra', 7)"),
    '23514', 'support_faq_categories_slug_check');
  const col = (await q(`SELECT data_type, is_nullable, column_default FROM information_schema.columns
                         WHERE table_name = 'professionals' AND column_name = 'support_fab_hidden'`)).rows[0];
  assert.equal(col.data_type, 'boolean');
  assert.equal(col.is_nullable, 'NO');
  assert.match(col.column_default, /false/);
  const p = await newProfessional();
  assert.equal((await q('SELECT support_fab_hidden FROM professionals WHERE id = $1', [p])).rows[0].support_fab_hidden, false);
});

// ═══════════════════════════ restrições de domínio ═══════════════════════════

test('restrições: ticket novo (status, prioridade, origem, categoria, assunto)', { skip, timeout: TEST_TIMEOUT_MS }, async () => {
  const p = await newProfessional();
  const ins = (cols, vals) => q(`INSERT INTO support_tickets (professional_id, ${cols}) VALUES ($1, ${vals.map((_, i) => '$' + (i + 2)).join(',')})`, [p, ...vals]);
  await rejectsWith(ins('category, subject, priority', ['agenda', 'Assunto ok', 'urgente']), '23514', 'support_tickets_priority_check');
  await rejectsWith(ins('category, subject, priority_source', ['agenda', 'Assunto ok', 'robo']), '23514', 'support_tickets_priority_source_check');
  await rejectsWith(ins('category, subject', ['inexistente', 'Assunto ok']), '23503', 'support_tickets_category_fkey');
  await rejectsWith(ins('category, subject', ['agenda', 'ab']), '23514', 'support_tickets_subject_check');
  await rejectsWith(ins('category, subject', ['agenda', '    ']), '23514', 'support_tickets_subject_check');
  await rejectsWith(ins('category, subject', ['agenda', '\t\n\r\t\n']), '23514', 'support_tickets_subject_check');
  await rejectsWith(ins('category, subject', ['agenda', ' a\t ']), '23514', 'support_tickets_subject_check');
  await rejectsWith(ins('category, subject', ['agenda', 'x'.repeat(121)]), '23514', 'support_tickets_subject_check');
  await ins('category, subject', ['agenda', 'abc']);
  await ins('category, subject', ['agenda', 'x'.repeat(120)]);
  for (const pr of ['alta', 'media', 'baixa']) await ins('category, subject, priority', ['tecnico', 'Assunto ok', pr]);
});

test('restrições: status (só por UPDATE; ticket novo nasce aberta)', { skip, timeout: TEST_TIMEOUT_MS }, async () => {
  const p = await newProfessional();
  const t = await newTicket(p);
  await rejectsWith(q("UPDATE support_tickets SET status = 'fechada' WHERE id = $1", [t]), '23514', 'support_tickets_status_check');
  for (const st of ['em_atendimento', 'aguardando_profissional', 'aberta']) {
    await q('UPDATE support_tickets SET status = $2 WHERE id = $1', [t, st]);
  }
  await rejectsWith(q("INSERT INTO support_tickets (professional_id, category, subject, status) VALUES ($1, 'agenda', 'Assunto ok', 'em_atendimento')", [p]), '23514');
});

test('restrições: mensagem (1..5000, não vazia, papel)', { skip, timeout: TEST_TIMEOUT_MS }, async () => {
  const p = await newProfessional();
  const t = await newTicket(p);
  await rejectsWith(addMessage(pool, t, p, 'professional', null, ''), '23514', 'support_messages_body_check');
  await rejectsWith(addMessage(pool, t, p, 'professional', null, '  \n\t '), '23514', 'support_messages_body_check');
  await rejectsWith(addMessage(pool, t, p, 'professional', null, 'x'.repeat(5001)), '23514', 'support_messages_body_check');
  await rejectsWith(addMessage(pool, t, p, 'robo', null, 'oi'), '23514', 'support_messages_author_role_check');
  await addMessage(pool, t, p, 'professional', null, 'x');
  await addMessage(pool, t, p, 'professional', null, 'x'.repeat(5000));
  await addMessage(pool, t, p, 'professional', null, 'ç'.repeat(5000)); // conta caracteres, não bytes
  assert.equal((await getTicket(t)).activity_seq, '3'); // as recusadas não gastaram seq
});

test('mensagens, eventos e solicitação relacionada exigem a mesma profissional do ticket', { skip, timeout: TEST_TIMEOUT_MS }, async () => {
  const a = await newProfessional();
  const b = await newProfessional();
  const tA = await newTicket(a);
  const tB = await newTicket(b);
  await rejectsWith(addMessage(pool, tA, b), '23503');           // ticket de A, profissional B (autor B é coerente)
  await rejectsWith(addEvent(pool, tA, b, 'created', null, 'professional'), '23503');
  await rejectsWith(q('UPDATE support_tickets SET related_ticket_id = $1 WHERE id = $2', [tB, tA]), '23503', 'support_tickets_related_fkey');
  await rejectsWith(q('UPDATE support_tickets SET related_ticket_id = id WHERE id = $1', [tA]), '23514', 'support_tickets_related_not_self_check');
  assert.equal((await getTicket(tA)).activity_seq, '0');
  assert.equal(await count('support_messages', 'ticket_id = $1', [tA]), 0);
  const t2 = await newTicket(a);
  await q('UPDATE support_tickets SET related_ticket_id = $1 WHERE id = $2', [tA, t2]);
  await addMessage(pool, tA, a);
});

test('idempotência: índices únicos, hash obrigatório junto do identificador', { skip, timeout: TEST_TIMEOUT_MS }, async () => {
  const a = await newProfessional();
  const b = await newProfessional();
  const rid = randomUUID();
  const mk = (prof, id, hash) => q(
    `INSERT INTO support_tickets (professional_id, category, subject, client_request_id, request_hash)
     VALUES ($1, 'agenda', 'Assunto ok', $2, $3)`, [prof, id, hash]);
  await mk(a, rid, HASH);
  await rejectsWith(mk(a, rid, HASH), '23505', 'uq_support_tickets_request');
  await rejectsWith(mk(a, rid, HASH2), '23505', 'uq_support_tickets_request');
  await mk(b, rid, HASH);                                  // mesmo id em outra conta é outro escopo
  await mk(a, null, null);
  await mk(a, null, null);
  await rejectsWith(mk(a, randomUUID(), null), '23514', 'support_tickets_idempotency_check');
  await rejectsWith(mk(a, null, HASH), '23514', 'support_tickets_idempotency_check');
  await rejectsWith(mk(a, randomUUID(), 'XYZ'), '23514', 'support_tickets_idempotency_check');

  const t = await newTicket(a);
  const t2 = await newTicket(a);
  const mid = randomUUID();
  await addMessage(pool, t, a, 'professional', null, 'oi', { cid: mid });
  await rejectsWith(addMessage(pool, t, a, 'professional', null, 'oi', { cid: mid }), '23505', 'uq_support_messages_client_id');
  await addMessage(pool, t2, a, 'professional', null, 'oi', { cid: mid });       // outro ticket: outro escopo
  await rejectsWith(q(
    `INSERT INTO support_messages (ticket_id, professional_id, author_role, author_id, body, client_message_id)
     VALUES ($1, $2, 'professional', $2, 'oi', $3)`, [t, a, randomUUID()]), '23514', 'support_messages_idempotency_check');
  assert.equal((await getTicket(t)).activity_seq, '1');   // a repetição recusada (INSERT simples) não gastou seq
});

test('estado resolvida <=> resolved_at; reaberturas limpam os campos; resolved_by é admin', { skip, timeout: TEST_TIMEOUT_MS }, async () => {
  const p = await newProfessional();
  const adm = await newAdmin();
  const t = await newTicket(p);
  await rejectsWith(q("UPDATE support_tickets SET status = 'resolvida' WHERE id = $1", [t]), '23514', 'support_tickets_resolved_at_check');
  await rejectsWith(q('UPDATE support_tickets SET resolved_at = now() WHERE id = $1', [t]), '23514', 'support_tickets_resolved_at_check');
  await rejectsWith(q('UPDATE support_tickets SET resolved_by = $2 WHERE id = $1', [t, adm]), '23514', 'support_tickets_resolved_by_check');
  // resolved_by precisa ser conta administradora
  await rejectsWith(q("UPDATE support_tickets SET status = 'resolvida', resolved_at = now(), resolved_by = $2 WHERE id = $1", [t, p]), '23514');

  await q("UPDATE support_tickets SET status = 'resolvida', resolved_at = now(), resolved_by = $2 WHERE id = $1", [t, adm]);
  await rejectsWith(q("UPDATE support_tickets SET status = 'aberta' WHERE id = $1", [t]), '23514', 'support_tickets_resolved_at_check');
  await q("UPDATE support_tickets SET status = 'aberta', resolved_at = NULL, resolved_by = NULL, reopen_count = reopen_count + 1 WHERE id = $1", [t]);
  await q("UPDATE support_tickets SET status = 'resolvida', resolved_at = now() - interval '400 days', resolved_by = $2 WHERE id = $1", [t, adm]);
  await q("UPDATE support_tickets SET status = 'em_atendimento', resolved_at = NULL, resolved_by = NULL WHERE id = $1", [t]);
  const row = await getTicket(t);
  assert.deepEqual([row.status, row.resolved_at, row.reopen_count], ['em_atendimento', null, 1]);

  const adm2 = await newAdmin();
  await q("UPDATE support_tickets SET status = 'resolvida', resolved_at = now(), resolved_by = $2 WHERE id = $1", [t, adm2]);
  await q('DELETE FROM professionals WHERE id = $1', [adm2]);
  const after = await getTicket(t);
  assert.equal(after.status, 'resolvida');
  assert.equal(after.resolved_by, null);
  assert.notEqual(after.resolved_at, null);
});

test('eventos: tipos, valores válidos por tipo e papel do ator', { skip, timeout: TEST_TIMEOUT_MS }, async () => {
  const p = await newProfessional();
  const adm = await newAdmin();
  const t = await newTicket(p);
  await addEvent(pool, t, p, 'created', null, 'professional');
  await addEvent(pool, t, p, 'status_changed', 'em_atendimento', 'admin', adm, 'aberta');
  await addEvent(pool, t, p, 'reopened', 'aberta', 'professional');
  await addEvent(pool, t, p, 'reopened', 'em_atendimento', 'admin', adm);
  await addEvent(pool, t, p, 'priority_changed', 'alta', 'admin', adm, 'media');
  await addEvent(pool, t, p, 'status_changed', 'em_atendimento', 'system');
  await rejectsWith(addEvent(pool, t, p, 'deleted', null, 'admin', adm), '23514', 'support_ticket_events_type_check');
  await rejectsWith(addEvent(pool, t, p, 'status_changed', 'fechada', 'admin', adm), '23514', 'support_ticket_events_values_check');
  await rejectsWith(addEvent(pool, t, p, 'status_changed', null, 'admin', adm), '23514', 'support_ticket_events_values_check');
  await rejectsWith(addEvent(pool, t, p, 'reopened', 'resolvida', 'admin', adm), '23514', 'support_ticket_events_values_check');
  await rejectsWith(addEvent(pool, t, p, 'priority_changed', 'urgente', 'admin', adm), '23514', 'support_ticket_events_values_check');
  await rejectsWith(addEvent(pool, t, p, 'created', null, 'visitante'), '23514', 'support_ticket_events_actor_role_check');
});

// ═══════════════════════════ sequência, não lidas ═══════════════════════════

test('sequência: seq contínuo, last_seq/last_actor derivados e regra de não lida', { skip, timeout: TEST_TIMEOUT_MS }, async () => {
  const p = await newProfessional();
  const adm = await newAdmin();
  const t = await newTicket(p);
  let row = await getTicket(t);
  assert.deepEqual([row.activity_seq, row.last_seq, row.prof_read_seq, row.admin_read_seq], ['0', '0', '0', '0']);
  assert.equal(adminUnread(row) || profUnread(row), false);

  const ev = await addEvent(pool, t, p, 'created', null, 'professional');            // seq 1
  const m1 = await addMessage(pool, t, p, 'professional', null, 'Preciso de ajuda'); // seq 2
  assert.deepEqual([ev.rows[0].seq, m1.rows[0].seq], ['1', '2']);
  row = await getTicket(t);
  assert.equal(adminUnread(row), true);
  assert.equal(profUnread(row), false);

  await q('UPDATE support_tickets SET admin_read_seq = GREATEST(admin_read_seq, $2) WHERE id = $1', [t, row.last_seq]);
  assert.equal(adminUnread(await getTicket(t)), false);

  await addMessage(pool, t, p, 'admin', adm, 'Vamos ver');                                              // seq 3
  await addEvent(pool, t, p, 'status_changed', 'aguardando_profissional', 'admin', adm, 'aberta');       // seq 4
  row = await getTicket(t);
  assert.deepEqual([row.activity_seq, row.last_seq, row.last_actor], ['4', '4', 'admin']);
  assert.equal(profUnread(row), true);
  assert.equal(adminUnread(row), false);

  await q('UPDATE support_tickets SET prof_read_seq = 4 WHERE id = $1', [t]);
  const beforePrio = summary(await getTicket(t));
  await addEvent(pool, t, p, 'priority_changed', 'alta', 'admin', adm, 'media');                         // seq 5, não notifica
  row = await getTicket(t);
  assert.deepEqual([row.activity_seq, row.last_seq, row.last_actor], ['5', '4', 'admin']);
  assert.equal(new Date(row.last_activity_at).getTime(), beforePrio.at);   // ordenação da lista não muda
  assert.equal(profUnread(row), false);
  await addEvent(pool, t, p, 'status_changed', 'em_atendimento', 'system');                              // seq 6, não notifica
  row = await getTicket(t);
  assert.deepEqual([row.activity_seq, row.last_seq], ['6', '4']);

  await addMessage(pool, t, p, 'professional', null, 'Obrigada');                                        // seq 7
  row = await getTicket(t);
  assert.equal(adminUnread(row), true);
  assert.equal(profUnread(row), false);

  const forced = await q(
    `INSERT INTO support_messages (ticket_id, professional_id, author_role, author_id, body, seq)
     VALUES ($1, $2, 'professional', $2, 'forçando', 999) RETURNING seq`, [t, p]);
  assert.equal(forced.rows[0].seq, '8');   // o seq enviado pelo chamador é ignorado
});

test('cursores só crescem e não passam do activity_seq', { skip, timeout: TEST_TIMEOUT_MS }, async () => {
  const p = await newProfessional();
  const t = await newTicket(p);
  await addMessage(pool, t, p);
  await addMessage(pool, t, p);
  await q('UPDATE support_tickets SET prof_read_seq = 2, admin_read_seq = 2 WHERE id = $1', [t]);
  await rejectsWith(q('UPDATE support_tickets SET prof_read_seq = 1 WHERE id = $1', [t]), '23514');
  await rejectsWith(q('UPDATE support_tickets SET admin_read_seq = 0 WHERE id = $1', [t]), '23514');
  await rejectsWith(q('UPDATE support_tickets SET prof_read_seq = 3 WHERE id = $1', [t]), '23514', 'support_tickets_seq_check');
  await q('UPDATE support_tickets SET prof_read_seq = GREATEST(prof_read_seq, 1) WHERE id = $1', [t]);
  assert.equal((await getTicket(t)).prof_read_seq, '2');
  await rejectsWith(q('UPDATE support_tickets SET ticket_number = ticket_number + 100000 WHERE id = $1', [t]), '428C9'); // identity GENERATED ALWAYS
});

// ═══════════════════════════ A1: conflitos, rollback e concorrência ═══════════════════════════

test('A1: mensagem duplicada com ON CONFLICT DO NOTHING não atualiza contadores, atividade nem autor', { skip, timeout: TEST_TIMEOUT_MS }, async () => {
  const p = await newProfessional();
  const adm = await newAdmin();
  const t = await newTicket(p);
  const cid = randomUUID();
  const oc = 'ON CONFLICT DO NOTHING';
  const first = await addMessage(pool, t, p, 'professional', null, 'oi', { cid, onConflict: oc });   // seq 1
  assert.equal(first.rowCount, 1);
  await addMessage(pool, t, p, 'admin', adm, 'resposta');                                              // seq 2: última atividade é do ADM
  const before1 = await getTicket(t);
  assert.deepEqual([before1.activity_seq, before1.last_seq, before1.last_actor], ['2', '2', 'admin']);
  assert.equal(profUnread(before1), true);

  const dup = await addMessage(pool, t, p, 'professional', null, 'oi', { cid, onConflict: oc });     // reenvio do mesmo id
  assert.equal(dup.rowCount, 0, 'duplicata deveria ser descartada');
  const after1 = await getTicket(t);
  assert.deepEqual(summary(after1), summary(before1));                  // activity_seq, last_seq, last_actor, last_activity_at
  assert.equal(after1.updated_at.getTime(), before1.updated_at.getTime()); // nem sequer houve UPDATE no ticket
  assert.equal(profUnread(after1), true, 'a resposta do ADM continua não lida: sem notificação fantasma');
  assert.equal(adminUnread(after1), false);
  assert.equal(await count('support_messages', 'ticket_id = $1', [t]), 2);

  // com especificação do alvo do conflito
  const dup2 = await addMessage(pool, t, p, 'professional', null, 'oi', {
    cid, onConflict: 'ON CONFLICT (ticket_id, client_message_id) WHERE client_message_id IS NOT NULL DO NOTHING' });
  assert.equal(dup2.rowCount, 0);
  assert.deepEqual(summary(await getTicket(t)), summary(before1));
  // e o próximo envio real continua contíguo (nenhum seq foi queimado)
  assert.equal((await addMessage(pool, t, p, 'professional', null, 'nova')).rows[0].seq, '3');
});

test('A1: criação de ticket e evento "created" duplicados não deixam rastro', { skip, timeout: TEST_TIMEOUT_MS }, async () => {
  const p = await newProfessional();
  const rid = randomUUID();
  const mk = () => q(
    `INSERT INTO support_tickets (professional_id, category, subject, client_request_id, request_hash)
     VALUES ($1, 'agenda', 'Assunto ok', $2, $3)
     ON CONFLICT (professional_id, client_request_id) WHERE client_request_id IS NOT NULL DO NOTHING RETURNING id`, [p, rid, HASH]);
  const a = await mk();
  assert.equal(a.rowCount, 1);
  const b = await mk();
  assert.equal(b.rowCount, 0);
  assert.equal(await count('support_tickets', 'professional_id = $1 AND client_request_id = $2', [p, rid]), 1);
  const t = a.rows[0].id;

  const oc = 'ON CONFLICT DO NOTHING';
  assert.equal((await addEvent(pool, t, p, 'created', null, 'professional', null, null, oc)).rowCount, 1);
  const snap = summary(await getTicket(t));
  assert.equal((await addEvent(pool, t, p, 'created', null, 'professional', null, null, oc)).rowCount, 0);
  assert.deepEqual(summary(await getTicket(t)), snap);
  assert.equal(await count('support_ticket_events', 'ticket_id = $1', [t]), 1);
  // INSERT simples duplicado também é recusado, sem efeito colateral
  await rejectsWith(addEvent(pool, t, p, 'created', null, 'professional'), '23505', 'uq_support_ticket_events_created');
  assert.deepEqual(summary(await getTicket(t)), snap);
  assert.equal((await getTicket(t)).activity_seq, '1');
});

test('A1: fluxo completo de criação em uma transação (ticket + created + 1ª mensagem)', { skip, timeout: TEST_TIMEOUT_MS }, async () => {
  const p = await newProfessional();
  const t = await inTx(async (c) => {
    const { rows } = await c.query(
      `INSERT INTO support_tickets (professional_id, category, subject) VALUES ($1, 'agenda', 'Assunto ok') RETURNING id`, [p]);
    await addEvent(c, rows[0].id, p, 'created', null, 'professional');
    await addMessage(c, rows[0].id, p, 'professional', null, 'Descrição do problema');
    return rows[0].id;
  });
  const row = await getTicket(t);
  assert.deepEqual([row.activity_seq, row.last_seq, row.last_actor], ['2', '2', 'professional']);
  assert.equal(adminUnread(row), true);
});

test('A1: ROLLBACK, SAVEPOINT e comando com erro não deixam contadores nem lacunas', { skip, timeout: TEST_TIMEOUT_MS }, async () => {
  const p = await newProfessional();
  const t = await newTicket(p);

  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await addMessage(c, t, p);
    assert.equal((await c.query('SELECT activity_seq FROM support_tickets WHERE id = $1', [t])).rows[0].activity_seq, '1');
    await c.query('ROLLBACK');
  } finally { await endTx(c); }
  assert.deepEqual(summary(await getTicket(t)).a, '0');
  assert.equal(await count('support_messages', 'ticket_id = $1', [t]), 0);
  assert.equal((await addMessage(pool, t, p)).rows[0].seq, '1');   // o seq 1 foi "devolvido"

  const c2 = await pool.connect();
  try {
    await c2.query('BEGIN');
    await addMessage(c2, t, p);                                      // seq 2
    await c2.query('SAVEPOINT s');
    await addMessage(c2, t, p);                                      // seq 3
    await c2.query('ROLLBACK TO s');
    await assert.rejects(addMessage(c2, t, p, 'professional', null, ''));  // erro de CHECK (a transação continua após o savepoint?)
    await c2.query('ROLLBACK TO s');
    assert.equal((await addMessage(c2, t, p)).rows[0].seq, '3');   // 3 de novo: sem lacuna
    await c2.query('COMMIT');
  } finally { await endTx(c2); }
  const row = await getTicket(t);
  assert.equal(row.activity_seq, '3');
  const seqs = (await q('SELECT seq FROM support_messages WHERE ticket_id = $1 ORDER BY seq', [t])).rows.map((r) => r.seq);
  assert.deepEqual(seqs, ['1', '2', '3']);
});

test('A1: INSERT com várias linhas para o mesmo ticket falha por completo (limitação documentada)', { skip, timeout: TEST_TIMEOUT_MS }, async () => {
  const p = await newProfessional();
  const t = await newTicket(p);
  await rejectsWith(q(
    `INSERT INTO support_messages (ticket_id, professional_id, author_role, author_id, body)
     VALUES ($1, $2, 'professional', $2, 'a'), ($1, $2, 'professional', $2, 'b')`, [t, p]), '23505', 'support_messages_ticket_seq_key');
  assert.equal((await getTicket(t)).activity_seq, '0');
  assert.equal(await count('support_messages', 'ticket_id = $1', [t]), 0);
});

test('contrato da API: INSERT com várias linhas + ON CONFLICT DO NOTHING *sem alvo* perde linhas em silêncio', { skip, timeout: TEST_TIMEOUT_MS }, async () => {
  const p = await newProfessional();
  const t = await newTicket(p);
  const multi = (onConflict) => q(
    `INSERT INTO support_messages (ticket_id, professional_id, author_role, author_id, body)
     VALUES ($1, $2, 'professional', $2, 'm1'), ($1, $2, 'professional', $2, 'm2') ${onConflict} RETURNING body`, [t, p]);

  // (a) SEM alvo: as duas linhas recebem o mesmo seq; a 2ª colide em (ticket_id, seq) e é DESCARTADA SEM ERRO.
  //     Este é o perigo documentado no cabeçalho da 023: perda silenciosa de mensagem.
  const silent = await multi('ON CONFLICT DO NOTHING');
  assert.deepEqual(silent.rows.map((r) => r.body), ['m1'], 'esperava gravar só m1, sem erro, perdendo m2 em silêncio');
  assert.equal(await count('support_messages', 'ticket_id = $1', [t]), 1);
  assert.equal((await getTicket(t)).activity_seq, '1');   // os contadores seguem coerentes com o que foi gravado: o dano é a linha perdida

  // (b) COM alvo explícito (e o predicado do índice parcial): a mesma colisão de seq vira ERRO.
  await rejectsWith(
    multi('ON CONFLICT (ticket_id, client_message_id) WHERE client_message_id IS NOT NULL DO NOTHING'),
    '23505', 'support_messages_ticket_seq_key');
  // (c) SEM ON CONFLICT: erro também.
  await rejectsWith(multi(''), '23505', 'support_messages_ticket_seq_key');
  assert.equal(await count('support_messages', 'ticket_id = $1', [t]), 1);
  assert.equal((await getTicket(t)).activity_seq, '1');

  // (d) a forma de alvo documentada no cabeçalho para o evento 'created' funciona e não deixa rastro no retry
  const created = (onConflict) => addEvent(pool, t, p, 'created', null, 'professional', null, null, onConflict);
  const target = "ON CONFLICT (ticket_id) WHERE type = 'created' DO NOTHING";
  assert.equal((await created(target)).rowCount, 1);
  const snap = summary(await getTicket(t));
  assert.equal((await created(target)).rowCount, 0);
  assert.deepEqual(summary(await getTicket(t)), snap);
});

test('A1 concorrência: 10 reenvios do mesmo id + 10 mensagens distintas simultâneos', { skip, timeout: TEST_TIMEOUT_MS }, async () => {
  const p = await newProfessional();
  const t = await newTicket(p);
  const dupCid = randomUUID();
  const oc = 'ON CONFLICT DO NOTHING';
  const tasks = [
    ...Array.from({ length: 10 }, () => async () => inTx(async (c) => {
      const r = await addMessage(c, t, p, 'professional', null, 'mesmo', { cid: dupCid, onConflict: oc });
      await sleep(Math.floor(Math.random() * 30));
      return r.rowCount;
    })),
    ...Array.from({ length: 10 }, (_, i) => async () => inTx(async (c) => {
      const r = await addMessage(c, t, p, 'professional', null, `d${i}`, { cid: randomUUID(), onConflict: oc });
      await sleep(Math.floor(Math.random() * 30));
      return r.rowCount;
    })),
  ];
  const inserted = await Promise.all(tasks.map((f) => f()));
  assert.equal(inserted.reduce((a, b) => a + b, 0), 11, 'exatamente 1 do grupo duplicado + 10 distintas');
  const row = await getTicket(t);
  assert.equal(row.activity_seq, '11');
  assert.equal(row.last_seq, '11');
  const seqs = (await q('SELECT seq FROM support_messages WHERE ticket_id = $1 ORDER BY seq', [t])).rows.map((r) => Number(r.seq));
  assert.deepEqual(seqs, Array.from({ length: 11 }, (_, i) => i + 1));
  assert.equal(await count('support_messages', 'ticket_id = $1 AND client_message_id = $2', [t, dupCid]), 1);
});

test('A1 concorrência: transações que fazem ROLLBACK no meio não deixam lacunas', { skip, timeout: TEST_TIMEOUT_MS }, async () => {
  const p = await newProfessional();
  const t = await newTicket(p);
  const results = await Promise.all(Array.from({ length: 24 }, async (_, i) => {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await addMessage(c, t, p, 'professional', null, `m${i}`);
      await sleep(Math.floor(Math.random() * 30));
      if (i % 2) { await c.query('ROLLBACK'); return false; }
      await c.query('COMMIT');
      return true;
    } finally { await endTx(c); }
  }));
  const committed = results.filter(Boolean).length;
  assert.equal(committed, 12);
  const row = await getTicket(t);
  assert.equal(Number(row.activity_seq), committed);
  const seqs = (await q('SELECT seq FROM support_messages WHERE ticket_id = $1 ORDER BY seq', [t])).rows.map((r) => Number(r.seq));
  assert.deepEqual(seqs, Array.from({ length: committed }, (_, i) => i + 1));
});

test('concorrência: atividades do mesmo ticket são serializadas pelo lock da linha', { skip, timeout: TEST_TIMEOUT_MS }, async () => {
  const p = await newProfessional();
  const adm = await newAdmin();
  const t = await newTicket(p);
  const a = await pool.connect();
  const b = await pool.connect();
  try {
    await a.query('BEGIN');
    const ra = await addMessage(a, t, p, 'professional', null, 'A');
    assert.equal(ra.rows[0].seq, '1');
    let bDone = false;
    await b.query('BEGIN');
    const pb = addMessage(b, t, p, 'admin', adm, 'B').then((r) => { bDone = true; return r; });
    await sleep(400);
    assert.equal(bDone, false, 'B deveria esperar o lock do ticket enquanto A não confirma');
    await a.query('COMMIT');
    const rb = await pb;
    assert.equal(rb.rows[0].seq, '2');
    await b.query('COMMIT');
    const row = await getTicket(t);
    assert.deepEqual([row.activity_seq, row.last_seq, row.last_actor], ['2', '2', 'admin']);
  } finally { await endTx(a); await endTx(b); }
});

test('concorrência: 30 inserções simultâneas (mensagens e eventos) geram seq únicos e contíguos', { skip, timeout: TEST_TIMEOUT_MS }, async () => {
  const p = await newProfessional();
  const adm = await newAdmin();
  const t = await newTicket(p);
  const N = 30;
  const results = await Promise.all(Array.from({ length: N }, (_, i) => inTx(async (c) => {
    const r = i % 3 === 0
      ? await addEvent(c, t, p, 'status_changed', 'em_atendimento', 'admin', adm)
      : await addMessage(c, t, p, i % 2 ? 'admin' : 'professional', adm, `m${i}`);
    await sleep(Math.floor(Math.random() * 30));
    return Number(r.rows[0].seq);
  })));
  assert.deepEqual([...results].sort((x, y) => x - y), Array.from({ length: N }, (_, i) => i + 1));
  assert.equal((await getTicket(t)).activity_seq, String(N));
});

test('concorrência: leitura "até N" não engole atividade que ainda não existia', { skip, timeout: TEST_TIMEOUT_MS }, async () => {
  const p = await newProfessional();
  const adm = await newAdmin();
  const t = await newTicket(p);
  await addMessage(pool, t, p, 'admin', adm, 'primeira');                   // seq 1, confirmada
  const seen = Number((await getTicket(t)).activity_seq);
  assert.equal(seen, 1);
  const w = await pool.connect();
  try {
    await w.query('BEGIN');
    const rw = await addMessage(w, t, p, 'admin', adm, 'segunda');           // seq 2, ainda em aberto
    assert.equal(rw.rows[0].seq, '2');
    let readDone = false;
    const reading = q('UPDATE support_tickets SET prof_read_seq = GREATEST(prof_read_seq, $2) WHERE id = $1', [t, seen])
      .then(() => { readDone = true; });
    await sleep(400);
    assert.equal(readDone, false, 'o read deveria esperar a transação do escritor');
    await w.query('COMMIT');
    await reading;
  } finally { await endTx(w); }
  const row = await getTicket(t);
  assert.equal(row.prof_read_seq, '1');
  assert.equal(profUnread(row), true, 'a segunda mensagem tem que continuar não lida');
});

test('ilustração (não testa a migration): uma sequence global perderia notificação', { skip, timeout: TEST_TIMEOUT_MS }, async () => {
  await q('DROP SEQUENCE IF EXISTS support_test_global_seq');
  await q('CREATE SEQUENCE support_test_global_seq');
  const t1 = await pool.connect();
  const t2 = await pool.connect();
  try {
    await t1.query('BEGIN');
    const n1 = Number((await t1.query("SELECT nextval('support_test_global_seq') AS n")).rows[0].n);
    await t2.query('BEGIN');
    const n2 = Number((await t2.query("SELECT nextval('support_test_global_seq') AS n")).rows[0].n);
    await t2.query('COMMIT');
    await t1.query('COMMIT');
    assert.ok(n1 < n2);
  } finally { await endTx(t1); await endTx(t2); await q('DROP SEQUENCE IF EXISTS support_test_global_seq'); }
});

// ═══════════════════════════ A2: integridade e garantias ═══════════════════════════

test('A2: ticket novo não pode nascer com contadores, cursores, estado ou autor forjados', { skip, timeout: TEST_TIMEOUT_MS }, async () => {
  const p = await newProfessional();
  const adm = await newAdmin();
  for (const [col, val] of [
    ['activity_seq', 5], ['last_seq', 1], ['prof_read_seq', 3], ['admin_read_seq', 3], ['reopen_count', 1],
    ['last_actor', 'admin'], ['status', 'em_atendimento'],
  ]) {
    await assert.rejects(
      q(`INSERT INTO support_tickets (professional_id, category, subject, ${col}) VALUES ($1, 'agenda', 'Assunto ok', $2)`, [p, val]),
      (err) => ['23514'].includes(err.code), `${col}=${val}`);
  }
  await rejectsWith(q(
    `INSERT INTO support_tickets (professional_id, category, subject, status, resolved_at, resolved_by)
     VALUES ($1, 'agenda', 'Assunto ok', 'resolvida', now(), $2)`, [p, adm]), '23514');
  assert.equal(await count('support_tickets', 'professional_id = $1', [p]), 0);
});

test('A2: identidade e titularidade do ticket são imutáveis (inclusive sem filhos)', { skip, timeout: TEST_TIMEOUT_MS }, async () => {
  const a = await newProfessional();
  const b = await newProfessional();
  const rid = randomUUID();
  const { rows } = await q(
    `INSERT INTO support_tickets (professional_id, category, subject, client_request_id, request_hash)
     VALUES ($1, 'agenda', 'Assunto ok', $2, $3) RETURNING id`, [a, rid, HASH]);
  const t = rows[0].id;   // sem mensagens nem eventos: a FK composta não protegeria sozinha
  await rejectsWith(q('UPDATE support_tickets SET professional_id = $2 WHERE id = $1', [t, b]), '23514');
  await rejectsWith(q('UPDATE support_tickets SET id = gen_random_uuid() WHERE id = $1', [t]), '23514');
  await rejectsWith(q('UPDATE support_tickets SET client_request_id = $2 WHERE id = $1', [t, randomUUID()]), '23514');
  await rejectsWith(q('UPDATE support_tickets SET request_hash = $2 WHERE id = $1', [t, HASH2]), '23514');
  await rejectsWith(q("UPDATE support_tickets SET created_at = now() - interval '1 year' WHERE id = $1", [t]), '23514');
  assert.equal((await getTicket(t)).professional_id, a);
  await q("UPDATE support_tickets SET subject = 'Assunto novo', category = 'tecnico', priority = 'alta', priority_source = 'manual' WHERE id = $1", [t]); // campos de trabalho continuam editáveis
});

test('A2: contadores e last_* não aceitam valores arbitrários', { skip, timeout: TEST_TIMEOUT_MS }, async () => {
  const p = await newProfessional();
  const t = await newTicket(p);
  await addMessage(pool, t, p);   // activity_seq = 1
  const snap = summary(await getTicket(t));
  for (const set of [
    'activity_seq = 7', 'activity_seq = activity_seq + 1', 'activity_seq = activity_seq + 2',
    'last_seq = 1, last_actor = $$admin$$', "last_actor = 'admin'", 'last_seq = 0', "last_activity_at = now() + interval '1 day'",
    'activity_seq = 0',
  ]) {
    await assert.rejects(q(`UPDATE support_tickets SET ${set} WHERE id = $1`, [t]), (e) => e.code === '23514', set);
  }
  assert.deepEqual(summary(await getTicket(t)), snap);
  await addMessage(pool, t, p);   // o caminho legítimo continua funcionando e fica contíguo
  assert.equal((await getTicket(t)).activity_seq, '2');
});

test('A2: autoria coerente com o papel declarado', { skip, timeout: TEST_TIMEOUT_MS }, async () => {
  const a = await newProfessional();
  const b = await newProfessional();
  const adm = await newAdmin();
  const t = await newTicket(a);
  const raw = (role, authorId) => q(
    `INSERT INTO support_messages (ticket_id, professional_id, author_role, author_id, body) VALUES ($1, $2, $3, $4, 'oi')`, [t, a, role, authorId]);
  await rejectsWith(raw('professional', b), '23514');      // outra profissional
  await rejectsWith(raw('professional', null), '23514');   // sem autor
  await rejectsWith(raw('professional', adm), '23514');    // admin se passando por titular
  await rejectsWith(raw('admin', a), '23514');             // conta não-admin como admin
  await rejectsWith(raw('admin', null), '23514');
  await raw('professional', a);
  await raw('admin', adm);
  const ev = (role, actorId) => q(
    `INSERT INTO support_ticket_events (ticket_id, professional_id, type, to_value, actor_role, actor_id)
     VALUES ($1, $2, 'status_changed', 'em_atendimento', $3, $4)`, [t, a, role, actorId]);
  await rejectsWith(ev('professional', b), '23514');
  await rejectsWith(ev('admin', a), '23514');
  await rejectsWith(ev('system', adm), '23514');
  await ev('admin', adm);
  await ev('system', null);
  assert.equal((await getTicket(t)).activity_seq, '4');   // nenhuma tentativa recusada gastou seq
});

test('A2: mensagens e eventos são imutáveis; autor só some quando a conta é excluída', { skip, timeout: TEST_TIMEOUT_MS }, async () => {
  const p = await newProfessional();
  const adm = await newAdmin();
  const t = await newTicket(p);
  const m = (await addMessage(pool, t, p, 'admin', adm, 'resposta')).rows[0];
  const e = (await addEvent(pool, t, p, 'status_changed', 'aguardando_profissional', 'admin', adm)).rows[0];
  await rejectsWith(q("UPDATE support_messages SET body = 'editada' WHERE id = $1", [m.id]), '23514');
  await rejectsWith(q("UPDATE support_messages SET author_role = 'professional' WHERE id = $1", [m.id]), '23514');
  await rejectsWith(q('UPDATE support_messages SET seq = 99 WHERE id = $1', [m.id]), '23514');
  await rejectsWith(q("UPDATE support_ticket_events SET to_value = 'resolvida' WHERE id = $1", [e.id]), '23514');
  await rejectsWith(q('UPDATE support_messages SET author_id = $2 WHERE id = $1', [m.id, p]), '23514');
  // anonimizar o autor de uma conta que AINDA existe é recusado
  await rejectsWith(q('UPDATE support_messages SET author_id = NULL WHERE id = $1', [m.id]), '23514');
  await rejectsWith(q('UPDATE support_ticket_events SET actor_id = NULL WHERE id = $1', [e.id]), '23514');

  await q('DELETE FROM professionals WHERE id = $1', [adm]);   // ON DELETE SET NULL: a conta já não existe
  assert.equal((await q('SELECT author_id, body FROM support_messages WHERE id = $1', [m.id])).rows[0].author_id, null);
  assert.equal((await q('SELECT actor_id FROM support_ticket_events WHERE id = $1', [e.id])).rows[0].actor_id, null);
  assert.equal((await q('SELECT body FROM support_messages WHERE id = $1', [m.id])).rows[0].body, 'resposta');
});

schemaTest('limitações documentadas: o papel dono pode desabilitar triggers e o cursor aceita qualquer valor até activity_seq', { skip, timeout: TEST_TIMEOUT_MS }, async () => {
  const p = await newProfessional();
  const t = await newTicket(p);
  await addMessage(pool, t, p);
  await addMessage(pool, t, p);
  // (1) cursor além do que foi exibido: o banco não sabe o que a tela mostrou -- a API precisa limitar upToSeq.
  await q('UPDATE support_tickets SET prof_read_seq = activity_seq WHERE id = $1', [t]);
  assert.equal((await getTicket(t)).prof_read_seq, '2');
  // (2) contra uma aplicação comprometida (dona das tabelas) os triggers NÃO protegem.
  await q('ALTER TABLE support_tickets DISABLE TRIGGER trg_support_tickets_guard');
  try {
    await q("UPDATE support_tickets SET last_actor = 'admin', last_seq = 2, activity_seq = 9 WHERE id = $1", [t]);
    assert.equal((await getTicket(t)).activity_seq, '9');   // forjado com sucesso: é a limitação
  } finally {
    await q('ALTER TABLE support_tickets ENABLE TRIGGER trg_support_tickets_guard');
  }
  await rejectsWith(q('UPDATE support_tickets SET activity_seq = 1 WHERE id = $1', [t]), '23514');
});

// ═══════════════════════════ exclusão, FAQ, auditoria ═══════════════════════════

test('exclusão da profissional apaga solicitações, mensagens e eventos (cascade)', { skip, timeout: TEST_TIMEOUT_MS }, async () => {
  const a = await newProfessional();
  const b = await newProfessional();
  const tA = await newTicket(a);
  const tA2 = await newTicket(a);
  await q('UPDATE support_tickets SET related_ticket_id = $1 WHERE id = $2', [tA, tA2]);
  const tB = await newTicket(b);
  await addMessage(pool, tA, a);
  await addEvent(pool, tA, a, 'created', null, 'professional');
  await addMessage(pool, tB, b);
  await q('DELETE FROM professionals WHERE id = $1', [a]);
  assert.equal(await count('support_tickets', 'professional_id = $1', [a]), 0);
  assert.equal(await count('support_messages', 'professional_id = $1', [a]), 0);
  assert.equal(await count('support_ticket_events', 'professional_id = $1', [a]), 0);
  assert.equal(await count('support_tickets', 'professional_id = $1', [b]), 1);
  assert.equal(await count('support_messages', 'professional_id = $1', [b]), 1);
});

test('solicitação relacionada removida vira NULL sem apagar nem quebrar a titular', { skip, timeout: TEST_TIMEOUT_MS }, async () => {
  const p = await newProfessional();
  const t1 = await newTicket(p);
  const t2 = await newTicket(p);
  await q('UPDATE support_tickets SET related_ticket_id = $1 WHERE id = $2', [t1, t2]);
  await q('DELETE FROM support_tickets WHERE id = $1', [t1]);
  const row = await getTicket(t2);
  assert.equal(row.related_ticket_id, null);
  assert.equal(row.professional_id, p);
});

test('M5: FAQ com título de até 120 caracteres e restrições de publicação', { skip, timeout: TEST_TIMEOUT_MS }, async () => {
  const adm = await newAdmin();
  const ins = (cat, title, body, status, pub) => q(
    `INSERT INTO support_faq_articles (category_slug, title, body, status, published_at, created_by) VALUES ($1,$2,$3,$4,$5,$6)`,
    [cat, title, body, status, pub, adm]);
  await ins('agenda', 'Como remarcar', 'Passo 1...', 'rascunho', null);
  await ins('agenda', 'Como cancelar', 'Passo 1...', 'publicado', new Date());
  await ins('agenda', 'x'.repeat(120), 'ok', 'rascunho', null);
  await rejectsWith(ins('agenda', 'x'.repeat(121), 'ok', 'rascunho', null), '23514', 'support_faq_articles_title_check');
  await rejectsWith(ins('agenda', 'Como remarcar', 'x', 'publicado', null), '23514', 'support_faq_articles_published_at_check');
  await rejectsWith(ins('agenda', 'Como remarcar', 'x', 'rascunho', new Date()), '23514', 'support_faq_articles_published_at_check');
  await rejectsWith(ins('agenda', 'Como remarcar', 'x', 'arquivado', null), '23514', 'support_faq_articles_status_check');
  await rejectsWith(ins('nada', 'Como remarcar', 'x', 'rascunho', null), '23503', 'support_faq_articles_category_fkey');
  await rejectsWith(ins('agenda', 'ab', 'x', 'rascunho', null), '23514', 'support_faq_articles_title_check');
  await rejectsWith(ins('agenda', 'Título ok', ' ', 'rascunho', null), '23514', 'support_faq_articles_body_check');
  await rejectsWith(ins('agenda', 'Título ok', 'x'.repeat(8001), 'rascunho', null), '23514', 'support_faq_articles_body_check');
  await q('DELETE FROM professionals WHERE id = $1', [adm]);
  assert.ok(await count('support_faq_articles', "created_by IS NULL AND title = 'Como cancelar'") >= 1);
  await q('DELETE FROM support_faq_articles WHERE created_by IS NULL');
});

test('M5: auditoria aceita as 4 ações antigas e as 6 novas; faq_reorder não existe; título de 120 cabe', { skip, timeout: TEST_TIMEOUT_MS }, async () => {
  const ins = (action, name = 'Negócio teste') => q(
    `INSERT INTO admin_audit_log (actor_id, actor_email, action, target_id, target_business_name)
     VALUES (gen_random_uuid(), 'adm@example.invalid', $1, gen_random_uuid(), $2)`, [action, name]);
  const OLD = ['block', 'unblock', 'update', 'delete'];
  const NEW = ['faq_create', 'faq_update', 'faq_publish', 'faq_unpublish', 'support_status', 'support_priority'];
  for (const a of [...OLD, ...NEW]) await ins(a);
  for (const bad of ['faq_reorder', 'faq_delete', 'support_message', 'BLOCK', '', 'drop']) {
    await rejectsWith(ins(bad), '23514', 'admin_audit_log_action_check');
  }
  await ins('faq_update', 'x'.repeat(120));             // o título do artigo (<=120) cabe em target_business_name
  await rejectsWith(ins('faq_update', 'x'.repeat(121)), '22001');
  const cols = (await q("SELECT column_name FROM information_schema.columns WHERE table_name = 'admin_audit_log' ORDER BY 1")).rows.map((r) => r.column_name);
  assert.deepEqual(cols, ['action', 'actor_email', 'actor_id', 'created_at', 'id', 'target_business_name', 'target_id']);
  await q("DELETE FROM admin_audit_log WHERE actor_email = 'adm@example.invalid'");
});

// ═══════════════════ M1/M2/M4: aplicação segura (testes que alteram o schema; ficam por último) ═══════════════════

async function expectApplyFails(rel, pattern) {
  await assert.rejects(applyFile(rel), (err) => {
    assert.match(err.message, pattern);
    return true;
  });
}

schemaTest('M2: 023 falha com mensagem clara em schema divergente e é atômica', { skip, timeout: TEST_TIMEOUT_MS }, async () => {
  const f = '023_support_center.sql';
  // (1) constraint essencial removida
  await q('ALTER TABLE support_tickets DROP CONSTRAINT support_tickets_resolved_at_check');
  await expectApplyFails(f, /schema de suporte divergente.*support_tickets_resolved_at_check/s);
  await q("ALTER TABLE support_tickets ADD CONSTRAINT support_tickets_resolved_at_check CHECK ((status = 'resolvida') = (resolved_at IS NOT NULL))");
  await applyFile(f);

  // (2) constraint enfraquecida com o mesmo nome
  await q('ALTER TABLE support_tickets DROP CONSTRAINT support_tickets_seq_check');
  await q('ALTER TABLE support_tickets ADD CONSTRAINT support_tickets_seq_check CHECK (true)');
  await expectApplyFails(f, /support_tickets_seq_check/);
  await q('ALTER TABLE support_tickets DROP CONSTRAINT support_tickets_seq_check');
  await q(`ALTER TABLE support_tickets ADD CONSTRAINT support_tickets_seq_check
    CHECK (activity_seq >= 0 AND last_seq >= 0 AND prof_read_seq >= 0 AND admin_read_seq >= 0
           AND last_seq <= activity_seq AND prof_read_seq <= activity_seq AND admin_read_seq <= activity_seq)`);
  await applyFile(f);

  // (3) tipo de coluna diferente
  await q('ALTER TABLE support_faq_categories ALTER COLUMN title TYPE varchar(80)');
  await expectApplyFails(f, /coluna support_faq_categories\.title/);
  await q('ALTER TABLE support_faq_categories ALTER COLUMN title TYPE text');
  await applyFile(f);

  // (4) seed adulterado
  await q("UPDATE support_faq_categories SET position = 9 WHERE slug = 'agenda'");
  await expectApplyFails(f, /6 categorias fixas/);
  await q("UPDATE support_faq_categories SET position = 1 WHERE slug = 'agenda'");
  await applyFile(f);

  assert.equal((await fingerprint()).h, baseline.h);
});

schemaTest('M2: 023 recompõe o que o IF NOT EXISTS pode refazer (índice, trigger desabilitado, categoria apagada)', { skip, timeout: TEST_TIMEOUT_MS }, async () => {
  await q('DROP INDEX uq_support_messages_client_id');
  await q('ALTER TABLE support_messages DISABLE TRIGGER trg_support_messages_seq');
  await q("DELETE FROM support_faq_categories WHERE slug = 'financeiro'");
  await applyFile('023_support_center.sql');
  assert.equal((await fingerprint()).h, baseline.h);
  const en = (await q("SELECT tgenabled FROM pg_trigger WHERE tgname = 'trg_support_messages_seq'")).rows[0].tgenabled;
  assert.equal(en, 'O');
});

schemaTest('M2: tabela support_tickets parcial/antiga de uma tentativa anterior: falha e nada é criado pela metade', { skip, timeout: TEST_TIMEOUT_MS }, async () => {
  await applyFile('_rollback/023_support_center.down.sql', { confirm: CONFIRM });
  try {
    await q('CREATE TABLE support_tickets (id uuid PRIMARY KEY, subject text)');
    // Erro ESPECÍFICO esperado: o primeiro objeto que depende de colunas inexistentes (índice parcial de
    // idempotência) falha com 42703 (undefined_column). Qualquer outro erro (conexão, permissão, sintaxe)
    // reprova o teste. A mensagem NÃO é comparada por texto (varia com versão e lc_messages): só se exige
    // que cite, entre aspas, uma das colunas que a tabela antiga não tem e que o índice usa. Qual das duas
    // o PostgreSQL cita primeiro (predicado ou chave) é detalhe interno, por isso as duas são aceitas.
    await assert.rejects(applyFile('023_support_center.sql'), (err) => {
      assert.equal(err.code, '42703', `SQLSTATE inesperado ${err.code}: ${err.message}`);
      assert.match(err.message, /"(client_request_id|professional_id)"/, `coluna inesperada na mensagem: ${err.message}`);
      return true;
    });
    assert.equal((await q("SELECT to_regclass('support_messages') AS r")).rows[0].r, null, 'transação deveria ter revertido');
    assert.equal((await q("SELECT to_regclass('support_faq_categories') AS r")).rows[0].r, null);
    assert.equal(await count('information_schema.columns', "table_name = 'professionals' AND column_name = 'support_fab_hidden'"), 0);
  } finally {
    await q('DROP TABLE IF EXISTS support_tickets');
    await applyFile('023_support_center.sql');
  }
  assert.equal((await fingerprint()).h, baseline.h);
});

schemaTest('M1: lock_timeout de 3 s aborta a 023 e a 024 em vez de formar fila', { skip, timeout: TEST_TIMEOUT_MS }, async () => {
  for (const [rel, table] of [
    ['023_support_center.sql', 'professionals'],
    ['024_audit_actions_support.sql', 'admin_audit_log'],
  ]) {
    const holder = await pool.connect();
    try {
      await holder.query('BEGIN');
      await holder.query(`SELECT 1 FROM ${table} LIMIT 1`);       // ACCESS SHARE mantido: conflita com o ACCESS EXCLUSIVE da migration
      const t0 = Date.now();
      await assert.rejects(applyFile(rel), (err) => { assert.equal(err.code, '55P03'); return true; });
      const dt = Date.now() - t0;
      assert.ok(dt >= 2500 && dt < 9000, `esperava ~3 s de espera, levou ${dt} ms (${rel})`);
    } finally {
      await endTx(holder);   // ROLLBACK + release; se o ROLLBACK falhar a conexão é destruída (locks liberados)
    }
    await applyFile(rel);   // liberado o lock, aplica normalmente
  }
  assert.equal((await fingerprint()).h, baseline.h);
});

schemaTest('M4: 024 falha explicitamente se a constraint esperada não for um CHECK válido sobre action', { skip, timeout: TEST_TIMEOUT_MS }, async () => {
  const f = '024_audit_actions_support.sql';
  const four = "CHECK (action IN ('block', 'unblock', 'update', 'delete'))";
  const drop = () => q('ALTER TABLE admin_audit_log DROP CONSTRAINT IF EXISTS admin_audit_log_action_check');
  try {
    await drop();                                                    // (a) ausente
    await expectApplyFails(f, /não encontrada como CHECK válido/);
    await q(`ALTER TABLE admin_audit_log ADD CONSTRAINT admin_audit_log_action_check ${four}`);

    await q('ALTER TABLE admin_audit_log RENAME CONSTRAINT admin_audit_log_action_check TO audit_renamed'); // (b) outro nome
    await expectApplyFails(f, /não encontrada como CHECK válido/);
    await q('ALTER TABLE admin_audit_log RENAME CONSTRAINT audit_renamed TO admin_audit_log_action_check');

    await q("ALTER TABLE admin_audit_log ADD CONSTRAINT zz_extra CHECK (action <> 'zzz')");                  // (c) outro CHECK sobre action
    await expectApplyFails(f, /outro CHECK sobre action/);
    await q('ALTER TABLE admin_audit_log DROP CONSTRAINT zz_extra');

    await drop();                                                    // (d) CHECK sobre outra coluna com o nome esperado
    await q('ALTER TABLE admin_audit_log ADD CONSTRAINT admin_audit_log_action_check CHECK (char_length(actor_email) > 0)');
    await expectApplyFails(f, /não é um CHECK sobre a coluna action/);

    await drop();                                                    // (e) NOT VALID
    await q(`ALTER TABLE admin_audit_log ADD CONSTRAINT admin_audit_log_action_check ${four} NOT VALID`);
    await expectApplyFails(f, /não encontrada como CHECK válido/);
  } finally {
    await drop();
    await q(`ALTER TABLE admin_audit_log ADD CONSTRAINT admin_audit_log_action_check ${four}`);
  }
  await applyFile(f);
  const def = (await q("SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conname = 'admin_audit_log_action_check'")).rows[0].d;
  for (const a of ['faq_create', 'faq_update', 'faq_publish', 'faq_unpublish', 'support_status', 'support_priority', 'block', 'unblock', 'update', 'delete']) {
    assert.ok(def.includes(`'${a}'`), a);
  }
  assert.equal((await fingerprint()).h, baseline.h);
});

// ═══════════════════════════ M3: rollbacks ═══════════════════════════

schemaTest('M3: rollback 024 aborta com ações novas ou constraint ausente, reverte limpo e reaplica', { skip, timeout: TEST_TIMEOUT_MS }, async () => {
  const down = '_rollback/024_audit_actions_support.down.sql';
  const ins = (action) => q(
    `INSERT INTO admin_audit_log (actor_id, actor_email, action, target_id, target_business_name)
     VALUES (gen_random_uuid(), 'rollback@example.invalid', $1, gen_random_uuid(), 'Negócio teste')`, [action]);
  await ins('faq_publish');
  await assert.rejects(applyFile(down), /rollback 024 abortado/);
  await ins('support_status');                                       // a constraint continua aceitando as ações novas
  await q("DELETE FROM admin_audit_log WHERE actor_email = 'rollback@example.invalid'");

  await applyFile(down);
  await ins('block');
  await rejectsWith(ins('faq_publish'), '23514', 'admin_audit_log_action_check');
  await q("DELETE FROM admin_audit_log WHERE actor_email = 'rollback@example.invalid'");

  await q('ALTER TABLE admin_audit_log DROP CONSTRAINT admin_audit_log_action_check');
  await assert.rejects(applyFile(down), /constraint admin_audit_log_action_check não encontrada/);
  await q("ALTER TABLE admin_audit_log ADD CONSTRAINT admin_audit_log_action_check CHECK (action IN ('block', 'unblock', 'update', 'delete'))");

  await applyFile('024_audit_actions_support.sql');
  await ins('faq_publish');
  await q("DELETE FROM admin_audit_log WHERE actor_email = 'rollback@example.invalid'");
  assert.equal((await fingerprint()).h, baseline.h);
});

// Divide o rollback 023 no fim do bloco de guarda: parte 1 = BEGIN + bloqueios + guarda; parte 2 = DROPs + COMMIT.
// Permite intercalar uma escrita concorrente exatamente entre a verificação de dados e o DROP.
function splitAtGuard(sql) {
  const marker = '$guard$;';
  const i = sql.indexOf(marker);
  assert.ok(i > 0 && sql.indexOf(marker, i + 1) === -1, 'marcador único do bloco de guarda não encontrado');
  return [sql.slice(0, i + marker.length), sql.slice(i + marker.length)];
}

const WRITER_APP = 'support_race_writer';

schemaTest('M3: rollback 023 -- insert concorrente entre a verificação e o DROP não pode ser destruído em silêncio', { skip, timeout: TEST_TIMEOUT_MS }, async () => {
  const [part1, part2] = splitAtGuard(await readSql(DOWN_023));
  await q('DELETE FROM support_tickets');
  await q('DELETE FROM support_faq_articles');
  await q('UPDATE professionals SET support_fab_hidden = false');
  const p = await newProfessional();   // criada antes: a corrida é só nas tabelas de suporte
  const R = await pool.connect();      // executa o rollback, dividido em duas partes
  const W = await pool.connect();      // o escritor concorrente, identificável em pg_stat_activity
  let outcome;
  try {
    await W.query(`SET application_name = '${WRITER_APP}'`);
    await R.query(part1);              // BEGIN, bloqueios (se existirem) e guarda: sem dados, a guarda passa
    let writerState = 'pendente';
    outcome = W.query(`INSERT INTO support_tickets (professional_id, category, subject) VALUES ($1, 'agenda', 'Assunto de teste')`, [p])
      .then(() => ({ ok: true }), (err) => ({ ok: false, code: err.code }))
      .then((r) => { writerState = 'terminou'; return r; });

    // Em vez de dormir "um pouco", espera EVIDÊNCIA: ou o escritor aparece bloqueado em lock no PostgreSQL
    // (comportamento correto) ou terminou o INSERT (defeito: confirmou durante a guarda). Se nenhuma das duas
    // ocorrer em 5 s, o teste falha com o estado observado, em vez de passar por engano.
    const seen = await waitUntil(async () => {
      if (writerState === 'terminou') return 'terminou';
      const { rows } = await q(
        `SELECT 1 FROM pg_stat_activity WHERE application_name = $1 AND state = 'active' AND wait_event_type = 'Lock'`, [WRITER_APP]);
      return rows.length ? 'bloqueado' : null;
    }, {
      timeoutMs: 5000,
      what: 'o escritor concorrente aparecer bloqueado em lock (pg_stat_activity) ou terminar',
      describe: async () => {
        const { rows } = await q(
          `SELECT state, wait_event_type, wait_event, left(query, 60) AS query FROM pg_stat_activity WHERE application_name = $1`, [WRITER_APP]);
        return `promessa do escritor: ${writerState}; pg_stat_activity: ${JSON.stringify(rows)}`;
      },
    });
    if (seen === 'terminou') {
      const early = await outcome;
      assert.fail(early.ok
        ? 'um insert concorrente confirmou entre a verificação de dados e o DROP: seria destruído sem a confirmação explícita'
        : `o escritor falhou antes de o rollback terminar (SQLSTATE ${early.code}), o que não era esperado`);
    }

    await R.query(part2);              // DROPs + COMMIT: libera o escritor
    const res = await withTimeout(outcome, 10_000, 'o escritor concorrente não terminou depois do COMMIT do rollback');
    assert.deepEqual(res, { ok: false, code: '42P01' }, 'o insert deveria esperar o bloqueio e falhar por a tabela já não existir');
  } finally {
    await endTx(R);                    // sempre: encerra a transação do rollback e libera os locks
    try {
      if (outcome) await withTimeout(outcome, 10_000, 'o escritor concorrente não terminou depois de liberar os locks');
      await W.query('RESET application_name');
      W.release();
    } catch (err) {
      W.release(err);                  // conexão em estado incerto: destruída, não devolvida ao pool
    }
  }
});

schemaTest('M3: rollback 023 -- sem conseguir o bloqueio em 3 s aborta com mensagem clara e não apaga nada', { skip, timeout: TEST_TIMEOUT_MS }, async () => {
  const p = await newProfessional();
  const t = await newTicket(p);
  await addMessage(pool, t, p);
  const holder = await pool.connect();
  try {
    await holder.query('BEGIN');
    await holder.query('SELECT 1 FROM support_messages LIMIT 1');   // ACCESS SHARE mantido: conflita com o ACCESS EXCLUSIVE do rollback
    const t0 = Date.now();
    await assert.rejects(applyFile(DOWN_023, { confirm: CONFIRM }), (err) => {   // mesmo COM a confirmação explícita
      assert.equal(err.code, '55P03', `SQLSTATE inesperado ${err.code}: ${err.message}`);
      assert.match(err.message, /rollback 023 abortado.*bloquear/s);
      return true;
    });
    const dt = Date.now() - t0;
    assert.ok(dt >= 2500 && dt < 9000, `esperava ~3 s de espera, levou ${dt} ms`);
  } finally {
    await endTx(holder);               // ROLLBACK + release; se o ROLLBACK falhar a conexão é destruída
  }
  assert.equal(await count('support_messages', 'ticket_id = $1', [t]), 1);   // nada foi apagado
  assert.equal((await fingerprint()).h, baseline.h);
});

schemaTest('M3: rollback 023 exige autorização explícita quando há dados; sem dados roda direto', { skip, timeout: TEST_TIMEOUT_MS }, async () => {
  const down = '_rollback/023_support_center.down.sql';
  const p = await newProfessional();
  const t = await newTicket(p);
  await addMessage(pool, t, p);
  const counts = async () => ({
    tickets: await count('support_tickets', 'professional_id = $1', [p]),
    messages: await count('support_messages', 'professional_id = $1', [p]),
  });
  const intact = { tickets: 1, messages: 1 };

  await assert.rejects(applyFile(down), (err) => {
    assert.match(err.message, /rollback 023 abortado.*solicitações=\d+, mensagens=\d+/s);
    return true;
  });
  assert.deepEqual(await counts(), intact);
  await assert.rejects(applyFile(down, { confirm: 'sim' }), /rollback 023 abortado/);     // frase errada
  assert.deepEqual(await counts(), intact);
  assert.equal((await fingerprint()).h, baseline.h);                                       // nada foi removido

  // só a preferência do botão já conta como dado
  await q('DELETE FROM support_tickets');
  await q('DELETE FROM support_faq_articles');
  await q('UPDATE professionals SET support_fab_hidden = false');
  await q('UPDATE professionals SET support_fab_hidden = true WHERE id = $1', [p]);
  await assert.rejects(applyFile(down), /preferências do botão=1/);
  await q('UPDATE professionals SET support_fab_hidden = false WHERE id = $1', [p]);

  // com a autorização, apaga mesmo havendo dados
  await q('UPDATE professionals SET support_fab_hidden = true WHERE id = $1', [p]);
  await applyFile(down, { confirm: CONFIRM });
  const left = (await q(`SELECT
      (SELECT count(*) FROM information_schema.tables WHERE table_name LIKE 'support\\_%')::int AS tables,
      (SELECT count(*) FROM information_schema.columns WHERE table_name = 'professionals' AND column_name = 'support_fab_hidden')::int AS col,
      (SELECT count(*) FROM pg_proc WHERE proname LIKE 'support\\_%')::int AS funcs`)).rows[0];
  assert.deepEqual(left, { tables: 0, col: 0, funcs: 0 });
  assert.equal((await q('SELECT count(*)::int AS n FROM professionals WHERE id = $1', [p])).rows[0].n, 1);

  await applyFile(down);                                       // sem dados (nada existe): roda sem autorização, idempotente
  await applyFile('023_support_center.sql');
  assert.equal((await q('SELECT count(*)::int AS n FROM support_faq_categories')).rows[0].n, 6);
  assert.equal((await q('SELECT support_fab_hidden FROM professionals WHERE id = $1', [p])).rows[0].support_fab_hidden, false);
  const t2 = await newTicket(p);
  assert.equal((await addMessage(pool, t2, p)).rows[0].seq, '1');   // o comportamento volta
  await assert.rejects(applyFile(down), /rollback 023 abortado/);   // com 1 ticket + mensagem: aborta de novo sem a autorização
  assert.equal(await count('support_messages', 'ticket_id = $1', [t2]), 1);
  assert.equal((await fingerprint()).h, baseline.h);
});
