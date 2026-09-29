/**
 * Testes para POST /admin/professionals/:id/block e /unblock.
 *
 * Cobre:
 *   1. Admin bloqueia outra profissional
 *   2. Profissional bloqueada não consegue login
 *   3. Sessão/token anterior da profissional bloqueada deixa de funcionar
 *   4. Admin desbloqueia
 *   5. token_version é incrementado no desbloqueio (e invalida o token antigo)
 *   6. Após desbloquear, novo login funciona
 *   7. Admin não consegue bloquear a própria conta
 *
 * Usa profissionais temporárias criadas e removidas neste próprio arquivo —
 * nunca toca contas reais de produção.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';

let server;
let baseUrl;
let dbAvailable = true;

let adminId, adminCookie;
let targetId;

const ADMIN_EMAIL = 'admin_block_test@nailflow.com';
const ADMIN_PASSWORD = 'senha_teste_admin_block';
const TARGET_EMAIL = 'target_block_test@nailflow.com';
const TARGET_PASSWORD = 'senha_teste_target_block';

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
     VALUES ('Admin Block Tester', $1, $2, '5531000000010', 'AdminBlockStudio', 'teste-admin-block', true)
     RETURNING id`,
    [ADMIN_EMAIL, adminHash]
  );
  adminId = adminRows[0].id;

  const targetHash = await bcrypt.hash(TARGET_PASSWORD, 10);
  const { rows: targetRows } = await pool.query(
    `INSERT INTO professionals (name, email, password_hash, phone_whatsapp, business_name, slug)
     VALUES ('Target Block Tester', $1, $2, '5531000000011', 'TargetBlockStudio', 'teste-target-block')
     RETURNING id`,
    [TARGET_EMAIL, targetHash]
  );
  targetId = targetRows[0].id;

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
  if (dbAvailable) {
    if (targetId) await pool.query('DELETE FROM professionals WHERE id = $1', [targetId]);
    if (adminId) await pool.query('DELETE FROM professionals WHERE id = $1', [adminId]);
  }
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
});

async function login(email, password) {
  return fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
}

async function me(cookie) {
  return fetch(`${baseUrl}/auth/me`, { headers: { Cookie: cookie } });
}

async function getTokenVersion(id) {
  const { pool } = await import('../src/config/db.js');
  const { rows } = await pool.query('SELECT token_version FROM professionals WHERE id = $1', [id]);
  return rows[0].token_version;
}

async function getBlockedAt(id) {
  const { pool } = await import('../src/config/db.js');
  const { rows } = await pool.query('SELECT blocked_at FROM professionals WHERE id = $1', [id]);
  return rows[0].blocked_at;
}

test('admin não consegue bloquear a própria conta', async (t) => {
  if (!dbAvailable) { t.skip('banco não disponível'); return; }

  const res = await fetch(`${baseUrl}/admin/professionals/${adminId}/block`, {
    method: 'POST',
    headers: { Cookie: adminCookie },
  });
  assert.equal(res.status, 400, 'deve rejeitar autobloqueio com 400');

  const blockedAt = await getBlockedAt(adminId);
  assert.equal(blockedAt, null, 'conta do admin não deve ficar bloqueada');
});

test('fluxo completo: bloquear → login falha → sessão antiga cai → desbloquear → token_version sobe → novo login funciona', async (t) => {
  if (!dbAvailable) { t.skip('banco não disponível'); return; }

  // 1) Login da profissional-alvo ANTES de qualquer bloqueio, para guardar
  //    uma sessão/cookie válida que será usada depois para provar a queda.
  const firstLogin = await login(TARGET_EMAIL, TARGET_PASSWORD);
  assert.equal(firstLogin.status, 200, 'login inicial da profissional-alvo deve funcionar');
  const targetCookieBeforeBlock = firstLogin.headers.get('set-cookie');

  const meBeforeBlock = await me(targetCookieBeforeBlock);
  assert.equal(meBeforeBlock.status, 200, 'sessão deve estar válida antes do bloqueio');

  const tokenVersionBeforeBlock = await getTokenVersion(targetId);

  // 2) Admin bloqueia a profissional-alvo.
  const blockRes = await fetch(`${baseUrl}/admin/professionals/${targetId}/block`, {
    method: 'POST',
    headers: { Cookie: adminCookie },
  });
  assert.equal(blockRes.status, 200, 'bloqueio deve retornar 200');
  const blockBody = await blockRes.json();
  assert.ok(blockBody.blocked_at, 'resposta deve trazer blocked_at preenchido');

  const blockedAtAfterBlock = await getBlockedAt(targetId);
  assert.ok(blockedAtAfterBlock, 'blocked_at deve estar preenchido no banco');

  // 3) Profissional bloqueada não consegue mais logar.
  const loginAfterBlock = await login(TARGET_EMAIL, TARGET_PASSWORD);
  assert.equal(loginAfterBlock.status, 401, 'login deve falhar com a conta bloqueada');

  // 4) A sessão/cookie obtida ANTES do bloqueio deixa de funcionar.
  const meAfterBlock = await me(targetCookieBeforeBlock);
  assert.equal(meAfterBlock.status, 401, 'sessão anterior ao bloqueio deve ser derrubada');

  // 5) Admin desbloqueia.
  const unblockRes = await fetch(`${baseUrl}/admin/professionals/${targetId}/unblock`, {
    method: 'POST',
    headers: { Cookie: adminCookie },
  });
  assert.equal(unblockRes.status, 200, 'desbloqueio deve retornar 200');
  const unblockBody = await unblockRes.json();
  assert.equal(unblockBody.blocked_at, null, 'resposta deve trazer blocked_at nulo');

  const blockedAtAfterUnblock = await getBlockedAt(targetId);
  assert.equal(blockedAtAfterUnblock, null, 'blocked_at deve voltar a null no banco');

  // 6) token_version foi incrementado no desbloqueio.
  const tokenVersionAfterUnblock = await getTokenVersion(targetId);
  assert.equal(
    tokenVersionAfterUnblock,
    tokenVersionBeforeBlock + 1,
    'token_version deve subir exatamente 1 no desbloqueio'
  );

  // 6b) Por causa do token_version incrementado, o cookie antigo (de antes do
  //     bloqueio) continua inválido mesmo depois do desbloqueio.
  const meAfterUnblockWithOldCookie = await me(targetCookieBeforeBlock);
  assert.equal(
    meAfterUnblockWithOldCookie.status,
    401,
    'cookie emitido antes do bloqueio deve continuar inválido após o desbloqueio (token_version mudou)'
  );

  // 7) Após desbloquear, um novo login funciona normalmente.
  const loginAfterUnblock = await login(TARGET_EMAIL, TARGET_PASSWORD);
  assert.equal(loginAfterUnblock.status, 200, 'novo login deve funcionar após o desbloqueio');
  const newCookie = loginAfterUnblock.headers.get('set-cookie');

  const meWithNewCookie = await me(newCookie);
  assert.equal(meWithNewCookie.status, 200, 'sessão nova (pós-desbloqueio) deve ser válida');
});

test('bloquear/desbloquear id inexistente retorna 404', async (t) => {
  if (!dbAvailable) { t.skip('banco não disponível'); return; }

  const fakeId = '00000000-0000-0000-0000-000000000000';

  const blockRes = await fetch(`${baseUrl}/admin/professionals/${fakeId}/block`, {
    method: 'POST',
    headers: { Cookie: adminCookie },
  });
  assert.equal(blockRes.status, 404);

  const unblockRes = await fetch(`${baseUrl}/admin/professionals/${fakeId}/unblock`, {
    method: 'POST',
    headers: { Cookie: adminCookie },
  });
  assert.equal(unblockRes.status, 404);
});

test('endpoints de bloqueio exigem admin', async (t) => {
  if (!dbAvailable) { t.skip('banco não disponível'); return; }

  const targetLogin = await login(TARGET_EMAIL, TARGET_PASSWORD);
  assert.equal(targetLogin.status, 200, 'target deve conseguir logar neste ponto (sem bloqueio ativo)');
  const targetCookie = targetLogin.headers.get('set-cookie');

  const res = await fetch(`${baseUrl}/admin/professionals/${adminId}/block`, {
    method: 'POST',
    headers: { Cookie: targetCookie },
  });
  assert.equal(res.status, 403, 'profissional não-admin não pode chamar endpoint de bloqueio');
});
