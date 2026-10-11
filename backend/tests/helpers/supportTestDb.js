// Guarda dos testes de API da Central de Suporte que gravam no banco (contas, solicitações, mensagens).
// Mesmas camadas lógicas da guarda de tests/support-migrations.test.js (não importada de lá porque aquele
// arquivo registra testes ao ser carregado): opt-in explícito, host de loopback, nome nf_*_test, cluster só com
// bancos descartáveis e marcador no banco. É prova LÓGICA, não física: use um cluster criado só para isto.
//
// Sem SUPPORT_API_TEST_DB_URL os testes de banco são ignorados. Com ela definida e a guarda falhando, o arquivo
// ABORTA (erro), nunca segue para um banco não confirmado. O banco precisa ter o schema base e as migrations
// 023 e 024 já aplicadas (a suíte não as aplica).
import pg from 'pg';

export const DISPOSABLE_MARKER = 'NAILFLOW_DISPOSABLE_TEST_DB';
const SAFE_DB_NAME = /^nf_[a-z0-9_]*_test$/;
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

export function assessUrl(url, env) {
  const why = [];
  if (env.NAILFLOW_ALLOW_TEST_DDL !== '1') why.push('opt-in ausente: defina NAILFLOW_ALLOW_TEST_DDL=1');
  let parsed = null;
  try { parsed = new URL(url); } catch { why.push('URL inválida'); }
  let dbName = null;
  if (parsed) {
    if (!LOOPBACK.has(parsed.hostname)) why.push(`host "${parsed.hostname}" não é de loopback`);
    for (const k of ['host', 'hostaddr', 'service']) {
      if (parsed.searchParams.has(k)) why.push(`parâmetro de URL "${k}" não é aceito (host ambíguo)`);
    }
    dbName = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
    if (!SAFE_DB_NAME.test(dbName)) why.push(`nome de banco "${dbName}" fora do padrão nf_*_test`);
  }
  return { why, dbName };
}

/** { url } quando o banco foi confirmado como descartável; { skip } sem a variável; lança se a guarda falhar. */
export async function resolveTestDb(env = process.env) {
  const url = env.SUPPORT_API_TEST_DB_URL;
  if (!url) return { skip: 'sem SUPPORT_API_TEST_DB_URL: testes de banco ignorados' };

  const { why, dbName } = assessUrl(url, env);
  if (why.length) throw new Error(`banco de teste recusado: ${why.join('; ')}`);

  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 5000 });
  await client.connect();
  try {
    const current = (await client.query('SELECT current_database() AS db')).rows[0].db;
    if (current !== dbName) why.push(`banco conectado "${current}" difere do informado na URL "${dbName}"`);
    const dbs = (await client.query('SELECT datname::text AS d FROM pg_database WHERE NOT datistemplate')).rows.map((r) => r.d);
    const foreign = dbs.filter((d) => d !== 'postgres' && !SAFE_DB_NAME.test(d));
    if (foreign.length) why.push(`o cluster hospeda bancos que não são descartáveis: ${foreign.join(', ')}`);
    const marker = (await client.query(
      `SELECT shobj_description(oid, 'pg_database') AS m FROM pg_database WHERE datname = current_database()`
    )).rows[0]?.m;
    if (marker !== DISPOSABLE_MARKER) why.push(`banco sem o marcador COMMENT ON DATABASE ... IS '${DISPOSABLE_MARKER}'`);
    const has = (await client.query(`SELECT to_regclass('public.support_tickets') IS NOT NULL AS ok`)).rows[0].ok;
    if (!has) why.push('migrations 023/024 não aplicadas neste banco');
  } finally {
    await client.end();
  }
  if (why.length) throw new Error(`banco de teste recusado: ${why.join('; ')}`);
  return { url };
}
