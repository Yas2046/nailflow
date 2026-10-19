// Base dos testes do Financeiro (migration 025) que criam e apagam estrutura e dados.
// Guarda do alvo: mesmas camadas lógicas de helpers/supportTestDb.js (opt-in explícito, host de loopback, nome nf_*_test,
// cluster só com bancos descartáveis e marcador no banco). É prova LÓGICA, não física: use um cluster criado só para isto
// (initdb próprio, porta própria).
//
// UM BANCO POR ARQUIVO DE TESTE: `npm test` executa os arquivos em paralelo, e estes testes aplicam, revertem e
// reaplicam a 025. Cada arquivo lê a sua própria variável (FINANCEIRO_MIGRATION_TEST_DB_URL, FINANCEIRO_HTTP_TEST_DB_URL,
// FINANCEIRO_DELETE_TEST_DB_URL, FINANCEIRO_RESTORE_TEST_DB_URL), e cada uma deve apontar para um banco diferente. O banco
// precisa ter o schema base (db/schema.sql + migrations 001..024, sem a 025). Sem a variável, o arquivo é ignorado.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { assessUrl, DISPOSABLE_MARKER } from './supportTestDb.js';

export const MIGRATIONS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../db/migrations');
export const FILES = {
  UP: '025_financeiro_base.sql',
  DOWN: '_rollback/025_financeiro_base.down.sql',
  GRANT: '_ops/025_grant_app_role.sql',
  RESTORE: '_ops/025_restore_from_archive.sql',
};
export const CONFIRM = 'ARQUIVAR-E-REMOVER-DADOS-FINANCEIROS';
export const readSql = (rel) => fs.readFile(path.join(MIGRATIONS, rel), 'utf8');

/** { url } quando confirmado descartável; { skip } sem a variável; lança se a guarda falhar. */
export async function resolveFinanceTestDb(env = process.env, varName = 'FINANCEIRO_MIGRATION_TEST_DB_URL') {
  const url = env[varName];
  if (!url) return { skip: `sem ${varName}: testes de banco ignorados` };

  const { why, dbName } = assessUrl(url, env);
  if (why.length) throw new Error(`banco de teste recusado: ${why.join('; ')}`);

  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 5000 });
  await client.connect();
  try {
    const current = (await client.query('SELECT current_database() AS db')).rows[0].db;
    if (current !== dbName) why.push(`banco conectado "${current}" difere do informado na URL "${dbName}"`);
    const dbs = (await client.query('SELECT datname::text AS d FROM pg_database WHERE NOT datistemplate')).rows.map((r) => r.d);
    const foreign = dbs.filter((d) => d !== 'postgres' && !/^nf_[a-z0-9_]*_test$/.test(d));
    if (foreign.length) why.push(`o cluster hospeda bancos que não são descartáveis: ${foreign.join(', ')}`);
    const marker = (await client.query(
      `SELECT shobj_description(oid, 'pg_database') AS m FROM pg_database WHERE datname = current_database()`
    )).rows[0]?.m;
    if (marker !== DISPOSABLE_MARKER) why.push(`banco sem o marcador COMMENT ON DATABASE ... IS '${DISPOSABLE_MARKER}'`);
    const ok = (await client.query(
      `SELECT to_regclass('public.appointments') IS NOT NULL AND to_regclass('public.expenses') IS NOT NULL
          AND to_regclass('public.support_tickets') IS NOT NULL AS ok`
    )).rows[0].ok;
    if (!ok) why.push('schema base ausente (db/schema.sql + migrations 001..024)');
    const su = (await client.query(`SELECT rolsuper FROM pg_roles WHERE rolname = current_user`)).rows[0].rolsuper;
    if (!su) why.push('o usuário da URL do dono precisa ser superusuário do cluster descartável');
  } finally {
    await client.end();
  }
  if (why.length) throw new Error(`banco de teste recusado: ${why.join('; ')}`);
  return { url };
}

/** Remove os meta-comandos do psql (\if/\else/\endif/\quit/\echo) e substitui :'var' e :"var" pelos valores. */
export function psqlScript(sql, vars = {}) {
  let out = sql.split('\n').filter((l) => !/^\s*\\(if|else|endif|quit|echo|set)\b/.test(l)).join('\n');
  for (const [k, v] of Object.entries(vars)) {
    out = out.replaceAll(`:'${k}'`, `'${String(v).replaceAll("'", "''")}'`).replaceAll(`:"${k}"`, `"${String(v).replaceAll('"', '""')}"`);
  }
  return out;
}

/** Utilitários sobre um Pool do DONO (superusuário do cluster descartável). */
export function financeDb(pool) {
  const q = (sql, params) => pool.query(sql, params);

  async function runSql(sql, { confirm } = {}) {
    const client = await pool.connect();
    let destroy;
    try {
      if (confirm) await client.query(`SET financeiro.confirm_destructive_rollback = '${confirm}'`);
      await client.query(sql);
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      try { await client.query('RESET financeiro.confirm_destructive_rollback'); } catch (e) { destroy = e; }
      client.release(destroy);
    }
  }
  const runFile = async (rel, opts) => runSql(await readSql(rel), opts);

  return {
    q,
    runSql,
    runFile,
    up: () => runFile(FILES.UP),
    down: (opts) => runFile(FILES.DOWN, opts),
    grant: async (role) => runSql(psqlScript(await readSql(FILES.GRANT), { app_role: role })),
    restore: async (schema, { skipDeleted = false } = {}) => runSql(psqlScript(await readSql(FILES.RESTORE), { archive_schema: schema, skip_deleted_accounts: skipDeleted ? 'on' : 'off' })),
    hasStructure: async () => (await q(`SELECT to_regclass('public.financial_payments') IS NOT NULL AS x`)).rows[0].x,
    archives: async () => (await q(`SELECT nspname FROM pg_namespace WHERE nspname LIKE 'financeiro\\_arquivo\\_%' ORDER BY nspname`)).rows.map((r) => r.nspname),
    dropArchives: async () => {
      const { rows } = await q(`SELECT nspname FROM pg_namespace WHERE nspname LIKE 'financeiro\\_arquivo\\_%'`);
      for (const r of rows) await q(`DROP SCHEMA "${r.nspname}" CASCADE`);
    },
    /** Estado limpo: remove uma 025 deixada por execução anterior (arquivando, se houver dados) e os dados de teste. */
    async reset({ emailLike, roles = [] }) {
      if (await this.hasStructure()) {
        await q(`DELETE FROM professionals WHERE email LIKE $1`, [emailLike]);
        await this.down({ confirm: CONFIRM });
      }
      await q(`DELETE FROM professionals WHERE email LIKE $1`, [emailLike]);
      await this.dropArchives();
      for (const r of roles) { await q(`DROP OWNED BY ${r}`).catch(() => {}); await q(`DROP ROLE IF EXISTS ${r}`).catch(() => {}); }
    },
    /** Role da aplicação como em produção (nailflow): não-dona, sem superusuário, com os privilégios das tabelas JÁ EXISTENTES
     *  (incluindo TRUNCATE e TRIGGER) e CREATE em public. Chame ANTES de aplicar a 025: tabelas novas nascem sem acesso. */
    async createAppRole(name) {
      await q(`CREATE ROLE ${name} LOGIN PASSWORD 'teste' NOSUPERUSER NOCREATEDB NOCREATEROLE`);
      await q(`GRANT CONNECT ON DATABASE ${(await q('SELECT current_database() AS d')).rows[0].d} TO ${name}`);
      await q(`GRANT USAGE, CREATE ON SCHEMA public TO ${name}`);
      await q(`GRANT ALL ON ALL TABLES IN SCHEMA public TO ${name}`);
      await q(`GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO ${name}`);
    },
    /** URL para a role da aplicação (mesmo host/porta/banco da URL do dono; a senha é irrelevante no cluster de teste). */
    appUrl: (ownerUrl, role) => {
      const u = new URL(ownerUrl);
      u.username = role;
      u.password = 'teste';
      return u.toString();
    },
    async fingerprint() {
      const { rows } = await q(`SELECT md5(string_agg(x, E'\\n' ORDER BY x)) AS h FROM (${FINGERPRINT_UNION}) s`);
      return rows[0].h;
    },
    /** As linhas que compõem o fingerprint (para mostrar EXATAMENTE o que difere entre dois bancos). */
    async fingerprintLines() {
      return (await q(`SELECT x FROM (${FINGERPRINT_UNION}) s ORDER BY x`)).rows.map((r) => r.x);
    },
  };
}

/** Projeções que o rollback arquiva e a restauração devolve (mesmas consultas dos scripts), para comparar hashes. */
export const PROJECTIONS = {
  financial_payments: 'SELECT * FROM public.financial_payments',
  financial_audit_log: 'SELECT * FROM public.financial_audit_log',
  cash_closings: 'SELECT * FROM public.cash_closings',
  appointments_financeiro: `SELECT id, professional_id, checked_in_at, final_price_cents, final_price_set_at, finance_review, finance_reviewed_at
    FROM public.appointments WHERE checked_in_at IS NOT NULL OR final_price_cents IS NOT NULL OR final_price_set_at IS NOT NULL OR finance_review IS NOT NULL OR finance_reviewed_at IS NOT NULL`,
  expenses_financeiro: `SELECT id, professional_id, payment_status, due_on, paid_on, paid_method FROM public.expenses
    WHERE payment_status <> 'a_revisar' OR due_on IS NOT NULL OR paid_on IS NOT NULL OR paid_method IS NOT NULL`,
};

/** Contagem e hash (md5 do JSON de cada linha, ordenado por id, em UTC) de cada projeção, na sessão do dono. */
export async function projectionHashes(pool, tables = Object.keys(PROJECTIONS)) {
  const client = await pool.connect();
  try {
    await client.query(`SET TimeZone = 'UTC'`);
    const out = {};
    for (const t of tables) {
      const { rows } = await client.query(
        `SELECT count(*)::int AS n, md5(coalesce(string_agg(to_jsonb(x)::text, '|' ORDER BY x.id::text), '')) AS h FROM (${PROJECTIONS[t]}) x`);
      out[t] = { n: rows[0].n, h: rows[0].h };
    }
    return out;
  } finally {
    await client.query('RESET TimeZone').catch(() => {});
    client.release();
  }
}

const FINGERPRINT_UNION = `
  SELECT 'col:' || table_name || '.' || column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, '') AS x
    FROM information_schema.columns WHERE table_schema = 'public'
  UNION ALL SELECT 'con:' || conrelid::regclass::text || ':' || conname || ':' || pg_get_constraintdef(oid)
    FROM pg_constraint WHERE connamespace = 'public'::regnamespace
  UNION ALL SELECT 'idx:' || indexdef FROM pg_indexes WHERE schemaname = 'public'
  UNION ALL SELECT 'trg:' || tgrelid::regclass::text || ':' || pg_get_triggerdef(oid)
    FROM pg_trigger WHERE NOT tgisinternal AND tgrelid::regclass::text !~ '^financeiro_arquivo_'
  UNION ALL SELECT 'fn:' || p.oid::regprocedure::text FROM pg_proc p WHERE pronamespace = 'public'::regnamespace`;
