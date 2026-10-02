/**
 * Testes para admin_audit_log: confirma que block/unblock/update/delete
 * geram exatamente 1 registro de sucesso cada, com os campos mínimos
 * (ator, ação, alvo, data/hora), e que actor_email/target_business_name
 * ficam gravados (denormalizados) mesmo depois do alvo ser excluído.
 *
 * Usa apenas profissionais temporárias criadas e removidas neste arquivo --
 * nunca lê, altera ou audita nenhuma conta real.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';

let server;
let baseUrl;
let dbAvailable = true;
let pool;

let adminId, adminCookie;
const createdIds = [];

const ADMIN_EMAIL = 'admin_audit_test@nailflow.com';
const ADMIN_PASSWORD = 'senha_teste_admin_audit';

before(async () => {
  ({ pool } = await import('../src/config/db.js'));
  try {
    await pool.query('SELECT 1');
  } catch {
    dbAvailable = false;
  }

  const { default: app } = await import('../src/server.js');
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  if (!dbAvailable) return;

  const { default: bcrypt } = await import('bcryptjs');
  const adminHash = await bcrypt.hash(ADMIN_PASSWORD, 10);
  const { rows: adminRows } = await pool.query(
    `INSERT INTO professionals (name, email, password_hash, phone_whatsapp, business_name, slug, is_admin)
     VALUES ('Admin Audit Tester', $1, $2, '5531000000040', 'AdminAuditStudio', 'teste-admin-audit', true)
     RETURNING id`,
    [ADMIN_EMAIL, adminHash]
  );
  adminId = adminRows[0].id;
  createdIds.push(adminId);

  const adminLogin = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });
  assert.equal(adminLogin.status, 200, 'login do admin deve retornar 200');
  adminCookie = adminLogin.headers.get('set-cookie');
});

after(async () => {
  if (dbAvailable) {
    await pool.query('DELETE FROM admin_audit_log WHERE actor_id = $1', [adminId]).catch(() => {});
    for (const id of createdIds) {
      await pool.query('DELETE FROM professionals WHERE id = $1', [id]).catch(() => {});
    }
  }
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
});

// ── Helpers ──────────────────────────────────────────────────────────────────

async function createTempProfessional(businessName) {
  const { default: bcrypt } = await import('bcryptjs');
  const suffix = Math.random().toString(36).slice(2, 10);
  const hash = await bcrypt.hash('senha_temp_' + suffix, 10);
  const { rows } = await pool.query(
    `INSERT INTO professionals (name, email, password_hash, phone_whatsapp, business_name, slug)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, business_name, email`,
    [
      'Temp Audit Tester',
      `temp_audit_${suffix}@nailflow.com`,
      hash,
      `55319${suffix.slice(0, 8).padEnd(8, '0')}`,
      businessName,
      `temp-audit-${suffix}`,
    ]
  );
  createdIds.push(rows[0].id);
  return rows[0];
}

async function call(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json', Cookie: adminCookie } };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(`${baseUrl}${path}`, opts);
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function lastLogEntry(targetId, action) {
  const { rows } = await pool.query(
    `SELECT actor_id, actor_email, action, target_id, target_business_name, created_at
     FROM admin_audit_log WHERE target_id = $1 AND action = $2 ORDER BY created_at DESC LIMIT 1`,
    [targetId, action]
  );
  return rows[0] ?? null;
}

async function countLogEntries(targetId, action) {
  const { rows } = await pool.query(
    'SELECT count(*)::int AS c FROM admin_audit_log WHERE target_id = $1 AND action = $2',
    [targetId, action]
  );
  return rows[0].c;
}

// ── Testes ───────────────────────────────────────────────────────────────────

test('block gera exatamente 1 registro de auditoria com os campos mínimos', async (t) => {
  if (!dbAvailable) { t.skip('banco não disponível'); return; }

  const target = await createTempProfessional('Studio Audit Block');
  const res = await call('POST', `/admin/professionals/${target.id}/block`);
  assert.equal(res.status, 200);

  assert.equal(await countLogEntries(target.id, 'block'), 1);
  const entry = await lastLogEntry(target.id, 'block');
  assert.equal(entry.actor_id, adminId);
  assert.equal(entry.actor_email, ADMIN_EMAIL);
  assert.equal(entry.action, 'block');
  assert.equal(entry.target_id, target.id);
  assert.equal(entry.target_business_name, target.business_name);
  assert.ok(entry.created_at);
});

test('unblock gera exatamente 1 registro de auditoria', async (t) => {
  if (!dbAvailable) { t.skip('banco não disponível'); return; }

  const target = await createTempProfessional('Studio Audit Unblock');
  await call('POST', `/admin/professionals/${target.id}/block`);
  const res = await call('POST', `/admin/professionals/${target.id}/unblock`);
  assert.equal(res.status, 200);

  assert.equal(await countLogEntries(target.id, 'unblock'), 1);
  const entry = await lastLogEntry(target.id, 'unblock');
  assert.equal(entry.actor_email, ADMIN_EMAIL);
  assert.equal(entry.target_business_name, target.business_name);
});

test('update gera exatamente 1 registro de auditoria', async (t) => {
  if (!dbAvailable) { t.skip('banco não disponível'); return; }

  const target = await createTempProfessional('Studio Audit Update');
  const res = await call('PUT', `/admin/professionals/${target.id}`, {
    name: 'Nome Editado Audit',
    business_name: target.business_name,
    phone_whatsapp: '5531999998888',
    email: target.email,
  });
  assert.equal(res.status, 200);

  assert.equal(await countLogEntries(target.id, 'update'), 1);
  const entry = await lastLogEntry(target.id, 'update');
  assert.equal(entry.actor_email, ADMIN_EMAIL);
  assert.equal(entry.target_business_name, target.business_name);
});

test('delete gera exatamente 1 registro de auditoria, e ele sobrevive à exclusão do alvo', async (t) => {
  if (!dbAvailable) { t.skip('banco não disponível'); return; }

  const target = await createTempProfessional('Studio Audit Delete');
  const res = await call('DELETE', `/admin/professionals/${target.id}`, {
    businessNameConfirmation: target.business_name,
  });
  assert.equal(res.status, 204);

  // A profissional já não existe mais...
  const { rows: stillThere } = await pool.query('SELECT 1 FROM professionals WHERE id = $1', [target.id]);
  assert.equal(stillThere.length, 0);

  // ...mas o log de auditoria sobrevive, com o nome do negócio preservado.
  assert.equal(await countLogEntries(target.id, 'delete'), 1);
  const entry = await lastLogEntry(target.id, 'delete');
  assert.equal(entry.actor_email, ADMIN_EMAIL);
  assert.equal(entry.target_business_name, target.business_name);
});

test('ação com falha (confirmação errada) NÃO gera registro de auditoria', async (t) => {
  if (!dbAvailable) { t.skip('banco não disponível'); return; }

  const target = await createTempProfessional('Studio Audit Falha');
  const res = await call('DELETE', `/admin/professionals/${target.id}`, {
    businessNameConfirmation: 'Nome Errado',
  });
  assert.equal(res.status, 400);
  assert.equal(await countLogEntries(target.id, 'delete'), 0, 'falha não deve gerar log, nesta primeira versão');
});
