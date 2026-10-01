/**
 * Teste para o rate limiting adicionado em /admin/professionals/* —
 * endpoints administrativos passam a responder 429 após muitas requisições
 * do mesmo IP na janela de tempo configurada.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';

let server;
let baseUrl;
let dbAvailable = true;
let adminId, adminCookie;

const ADMIN_EMAIL = 'admin_ratelimit_test@nailflow.com';
const ADMIN_PASSWORD = 'senha_teste_admin_ratelimit';

before(async () => {
  const { pool } = await import('../src/config/db.js');
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
     VALUES ('Admin RateLimit Tester', $1, $2, '5531000000099', 'AdminRateLimitStudio', 'teste-admin-ratelimit', true)
     RETURNING id`,
    [ADMIN_EMAIL, adminHash]
  );
  adminId = adminRows[0].id;

  const adminLogin = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });
  assert.equal(adminLogin.status, 200, 'login do admin deve retornar 200');
  adminCookie = adminLogin.headers.get('set-cookie');
});

after(async () => {
  const { pool } = await import('../src/config/db.js');
  if (dbAvailable && adminId) await pool.query('DELETE FROM professionals WHERE id = $1', [adminId]);
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
});

test('após exceder o limite, /admin/professionals responde 429', async (t) => {
  if (!dbAvailable) { t.skip('banco não disponível'); return; }

  let lastStatus;
  for (let i = 0; i < 101; i++) {
    const res = await fetch(`${baseUrl}/admin/professionals`, {
      headers: { Cookie: adminCookie },
    });
    lastStatus = res.status;
    if (lastStatus === 429) break;
  }
  assert.equal(lastStatus, 429, 'esperava 429 após exceder o limite de requisições administrativas');
});
