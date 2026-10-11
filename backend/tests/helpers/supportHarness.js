// Base dos testes de banco da API da ADM e da exclusão de conta: sobe o servidor real (server.js) contra o banco
// descartável confirmado por tests/helpers/supportTestDb.js, cria contas de teste e oferece as chamadas HTTP e os
// atalhos de banco usados pelos cenários. Tudo o que cria é removido em stop().
//
// USO EXCLUSIVO DO BANCO: as suítes que usam este helper contam linhas globais (ex.: /admin/support/summary) e
// instalam triggers de falha injetada. Rode-as UMA POR VEZ no mesmo banco (node --test --test-concurrency=1 ...).
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import jwt from 'jsonwebtoken';
import { resolveTestDb } from './supportTestDb.js';

const SERVER_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/server.js');

export const dbWanted = Boolean(process.env.SUPPORT_API_TEST_DB_URL);
export const skip = dbWanted ? false : 'sem SUPPORT_API_TEST_DB_URL (testes de banco ignorados)';
export const FAIL_MESSAGE = 'FALHAR-TESTE';      // mensagens iniciadas assim abortam o INSERT
export const FAIL_AUDIT = 'FALHAR-AUDITORIA';    // auditoria de alvo com este nome de negócio aborta o INSERT

export async function startHarness(extraEnv = {}) {
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET ||= 'support-api-test-secret';
  process.env.SUPPORT_CENTER_ENABLED = 'true';
  Object.assign(process.env, extraEnv);

  const target = await resolveTestDb();
  process.env.DATABASE_URL = target.url;
  const { pool } = await import('../../src/config/db.js');

  // Falhas injetadas (removidas em stop): texto da mensagem no DETAIL; auditoria de um alvo marcado.
  await pool.query('DROP TRIGGER IF EXISTS zz_support_test_fail ON support_messages');
  await pool.query('DROP TRIGGER IF EXISTS zz_audit_test_fail ON admin_audit_log');
  await pool.query(`
    CREATE OR REPLACE FUNCTION zz_support_test_fail() RETURNS trigger LANGUAGE plpgsql AS $f$
    BEGIN
      IF NEW.body LIKE '${FAIL_MESSAGE}%' THEN
        RAISE EXCEPTION 'falha injetada pelo teste' USING ERRCODE = 'check_violation', DETAIL = format('linha: %s', NEW.body);
      END IF;
      RETURN NEW;
    END $f$`);
  await pool.query(`CREATE TRIGGER zz_support_test_fail BEFORE INSERT ON support_messages
                    FOR EACH ROW EXECUTE FUNCTION zz_support_test_fail()`);
  await pool.query(`
    CREATE OR REPLACE FUNCTION zz_audit_test_fail() RETURNS trigger LANGUAGE plpgsql AS $f$
    BEGIN
      IF NEW.target_business_name LIKE '${FAIL_AUDIT}%' THEN
        RAISE EXCEPTION 'falha de auditoria injetada pelo teste' USING ERRCODE = 'check_violation';
      END IF;
      RETURN NEW;
    END $f$`);
  await pool.query(`CREATE TRIGGER zz_audit_test_fail BEFORE INSERT ON admin_audit_log
                    FOR EACH ROW EXECUTE FUNCTION zz_audit_test_fail()`);

  const { default: app } = await import('../../src/server.js');
  let server;
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const runId = randomUUID().slice(0, 8);
  const createdIds = [];
  let counter = 0;

  const one = async (sql, params) => (await pool.query(sql, params)).rows[0];

  async function newProf({ admin = false, businessName } = {}) {
    const n = ++counter;
    const digits = String(Math.floor(Math.random() * 1e9)).padStart(9, '0');
    const { rows } = await pool.query(
      `INSERT INTO professionals (name, email, password_hash, phone_whatsapp, business_name, slug, is_admin)
       VALUES ($1, $2, 'x', $3, $4, $5, $6) RETURNING id, token_version`,
      [`Sup ${n}`, `sup-${runId}-${n}@teste.local`, `5531${digits}`, businessName ?? `Studio ${runId}-${n}`, `sup-${runId}-${n}`, admin]
    );
    createdIds.push(rows[0].id);
    const sign = (claims = {}, secret = process.env.JWT_SECRET) => jwt.sign({ sub: rows[0].id, ver: rows[0].token_version, ...claims }, secret, { expiresIn: '1h' });
    return { id: rows[0].id, token: sign(), sign };
  }

  async function call(method, urlPath, { as, body, rawBody, headers: extra = {}, base = baseUrl } = {}) {
    const headers = { ...extra };
    if (as) headers.cookie = `nailflow_token=${as.token}`;
    let payload;
    if (rawBody !== undefined) { headers['content-type'] = 'application/json'; payload = rawBody; }
    else if (body !== undefined) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await fetch(`${base}${urlPath}`, { method, headers, body: payload });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* corpo vazio (204) */ }
    return { status: res.status, json, text };
  }

  // Cenários montados direto no banco (sem passar pela API), seguindo o contrato de inserção: um INSERT por atividade.
  async function seedTicket(prof, { subject, category = 'agenda', priority } = {}) {
    return one(
      `INSERT INTO support_tickets (professional_id, category, subject, priority) VALUES ($1, $2, $3, COALESCE($4, 'media'))
       RETURNING id, ticket_number`,
      [prof.id, category, subject ?? `Chamado ${randomUUID().slice(0, 8)}`, priority ?? null]
    );
  }
  async function profMessage(ticketId, profId, body = 'Mensagem da profissional') {
    await pool.query(
      `INSERT INTO support_messages (ticket_id, professional_id, author_role, author_id, body) VALUES ($1, $2, 'professional', $2, $3)`,
      [ticketId, profId, body]
    );
  }
  async function adminMessage(ticketId, profId, adminId, body = 'Resposta da equipe') {
    await pool.query(
      `INSERT INTO support_messages (ticket_id, professional_id, author_role, author_id, body) VALUES ($1, $2, 'admin', $3, $4)`,
      [ticketId, profId, adminId, body]
    );
  }
  async function resolveTicket(ticketId, adminId, ago = '1 hour') {
    await pool.query(
      `UPDATE support_tickets SET status = 'resolvida', resolved_at = now() - $2::interval, resolved_by = $3 WHERE id = $1`,
      [ticketId, ago, adminId]
    );
  }
  const ticketRow = (id) => one('SELECT * FROM support_tickets WHERE id = $1', [id]);
  const activity = async (id) => ({
    events: (await pool.query('SELECT seq, type, from_value, to_value, actor_role, actor_id FROM support_ticket_events WHERE ticket_id = $1 ORDER BY seq', [id])).rows,
    messages: (await pool.query('SELECT seq, author_role, author_id, body FROM support_messages WHERE ticket_id = $1 ORDER BY seq', [id])).rows,
  });
  const auditRows = async (where, params) =>
    (await pool.query(`SELECT actor_id, actor_email, action, target_id, target_business_name FROM admin_audit_log WHERE ${where} ORDER BY created_at, id`, params)).rows;

  async function waitUntil(fn, timeoutMs = 8000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (await fn()) return;
      if (Date.now() > deadline) throw new Error('condição não atendida a tempo');
      await new Promise((r) => setTimeout(r, 25));
    }
  }

  // Servidor real em processo separado com um valor específico do interruptor (undefined = variável ausente).
  async function withServer(flag, fn) {
    const env = { ...process.env, NODE_ENV: 'test', SERVER_URL: pathToFileURL(SERVER_FILE).href };
    if (flag === undefined) delete env.SUPPORT_CENTER_ENABLED; else env.SUPPORT_CENTER_ENABLED = flag;
    const code = `import(process.env.SERVER_URL).then(({ default: app }) => {
      const s = app.listen(0, '127.0.0.1', () => console.log('PORT=' + s.address().port));
    });`;
    const child = spawn(process.execPath, ['--input-type=module', '-e', code], { env, cwd: path.dirname(SERVER_FILE), stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d; });
    try {
      const port = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`servidor filho não subiu: ${stderr}`)), 15_000);
        child.stdout.on('data', (d) => {
          const m = /PORT=(\d+)/.exec(String(d));
          if (m) { clearTimeout(timer); resolve(Number(m[1])); }
        });
        child.on('exit', (c) => { clearTimeout(timer); reject(new Error(`servidor filho saiu (${c}): ${stderr}`)); });
      });
      await fn(`http://127.0.0.1:${port}`);
    } finally {
      child.removeAllListeners('exit');
      child.kill();
    }
  }

  async function stop() {
    await new Promise((resolve) => server.close(resolve));
    await pool.query('DROP TRIGGER IF EXISTS zz_support_test_fail ON support_messages').catch(() => {});
    await pool.query('DROP TRIGGER IF EXISTS zz_audit_test_fail ON admin_audit_log').catch(() => {});
    await pool.query('DROP FUNCTION IF EXISTS zz_support_test_fail()').catch(() => {});
    await pool.query('DROP FUNCTION IF EXISTS zz_audit_test_fail()').catch(() => {});
    if (createdIds.length) {
      // A auditoria não tem FK: remove os registros criados pelos testes (ator ou alvo = contas de teste).
      await pool.query('DELETE FROM admin_audit_log WHERE actor_id = ANY($1::uuid[]) OR target_id = ANY($1::uuid[])', [createdIds]).catch(() => {});
      await pool.query('DELETE FROM support_faq_articles WHERE created_by = ANY($1::uuid[]) OR updated_by = ANY($1::uuid[])', [createdIds]).catch(() => {});
      await pool.query('DELETE FROM professionals WHERE id = ANY($1::uuid[])', [createdIds]).catch(() => {});
    }
    await pool.end();
  }

  return {
    pool, baseUrl, runId, createdIds, newProf, call, one, seedTicket, profMessage, adminMessage, resolveTicket,
    ticketRow, activity, auditRows, waitUntil, withServer, stop,
  };
}
