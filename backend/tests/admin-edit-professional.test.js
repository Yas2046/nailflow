/**
 * Testes para PUT /admin/professionals/:id (edição de profissional pelo Admin).
 *
 * Cobre:
 *   1. Admin edita outra profissional com sucesso (name, business_name,
 *      phone_whatsapp, email, avatar_b64)
 *   2. E-mail duplicado é rejeitado (409) e não altera o registro
 *   3. Admin não consegue editar a própria conta (400)
 *   4. Endpoint exige admin (403 para profissional comum)
 *   5. Id inexistente retorna 404
 *   6. Campos fora do permitido (is_admin, blocked_at, slug, wa_instance_name)
 *      são ignorados mesmo se enviados no corpo da requisição
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
let otherId;

const ADMIN_EMAIL = 'admin_edit_test@nailflow.com';
const ADMIN_PASSWORD = 'senha_teste_admin_edit';
const TARGET_EMAIL = 'target_edit_test@nailflow.com';
const TARGET_PASSWORD = 'senha_teste_target_edit';
const OTHER_EMAIL = 'other_edit_test@nailflow.com';
const OTHER_PASSWORD = 'senha_teste_other_edit';

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
     VALUES ('Admin Edit Tester', $1, $2, '5531000000020', 'AdminEditStudio', 'teste-admin-edit', true)
     RETURNING id`,
    [ADMIN_EMAIL, adminHash]
  );
  adminId = adminRows[0].id;

  const targetHash = await bcrypt.hash(TARGET_PASSWORD, 10);
  const { rows: targetRows } = await pool.query(
    `INSERT INTO professionals (name, email, password_hash, phone_whatsapp, business_name, slug)
     VALUES ('Target Edit Tester', $1, $2, '5531000000021', 'TargetEditStudio', 'teste-target-edit')
     RETURNING id`,
    [TARGET_EMAIL, targetHash]
  );
  targetId = targetRows[0].id;

  const otherHash = await bcrypt.hash(OTHER_PASSWORD, 10);
  const { rows: otherRows } = await pool.query(
    `INSERT INTO professionals (name, email, password_hash, phone_whatsapp, business_name, slug)
     VALUES ('Other Edit Tester', $1, $2, '5531000000022', 'OtherEditStudio', 'teste-other-edit')
     RETURNING id`,
    [OTHER_EMAIL, otherHash]
  );
  otherId = otherRows[0].id;

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
    if (otherId) await pool.query('DELETE FROM professionals WHERE id = $1', [otherId]);
    if (adminId) await pool.query('DELETE FROM professionals WHERE id = $1', [adminId]);
  }
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
});

async function putProfessional(id, body, cookie = adminCookie) {
  const res = await fetch(`${baseUrl}/admin/professionals/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

async function getRawProfessional(id) {
  const { pool } = await import('../src/config/db.js');
  const { rows } = await pool.query(
    'SELECT name, email, business_name, phone_whatsapp, avatar_b64, is_admin, blocked_at, slug, wa_instance_name FROM professionals WHERE id = $1',
    [id]
  );
  return rows[0];
}

test('admin edita outra profissional com sucesso', async (t) => {
  if (!dbAvailable) { t.skip('banco não disponível'); return; }

  const smallAvatar = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAA=';

  const res = await putProfessional(targetId, {
    name: 'Target Editada',
    business_name: 'Novo Studio Editado',
    phone_whatsapp: '5531999998888',
    email: TARGET_EMAIL, // mantém o mesmo e-mail
    avatar_b64: smallAvatar,
  });

  assert.equal(res.status, 200, 'edição válida deve retornar 200');
  assert.equal(res.body.name, 'Target Editada');
  assert.equal(res.body.business_name, 'Novo Studio Editado');
  assert.equal(res.body.phone_whatsapp, '5531999998888');

  const persisted = await getRawProfessional(targetId);
  assert.equal(persisted.name, 'Target Editada');
  assert.equal(persisted.business_name, 'Novo Studio Editado');
  assert.equal(persisted.phone_whatsapp, '5531999998888');
  assert.equal(persisted.avatar_b64, smallAvatar, 'avatar_b64 deve persistir quando enviado');
});

test('e-mail duplicado é rejeitado e não altera o registro', async (t) => {
  if (!dbAvailable) { t.skip('banco não disponível'); return; }

  const before_ = await getRawProfessional(targetId);

  const res = await putProfessional(targetId, {
    name: before_.name,
    business_name: before_.business_name,
    phone_whatsapp: before_.phone_whatsapp,
    email: OTHER_EMAIL, // já usado por "otherId"
  });

  assert.equal(res.status, 409, 'e-mail já usado por outra conta deve ser rejeitado com 409');

  const after_ = await getRawProfessional(targetId);
  assert.equal(after_.email, TARGET_EMAIL, 'e-mail não deve ter mudado após rejeição');
});

test('admin não consegue editar a própria conta por esta rota', async (t) => {
  if (!dbAvailable) { t.skip('banco não disponível'); return; }

  const before_ = await getRawProfessional(adminId);

  const res = await putProfessional(adminId, {
    name: 'Tentativa de autoedição',
    business_name: before_.business_name,
    phone_whatsapp: before_.phone_whatsapp,
    email: ADMIN_EMAIL,
  });

  assert.equal(res.status, 400, 'autoedição pelo admin deve ser rejeitada com 400');

  const after_ = await getRawProfessional(adminId);
  assert.equal(after_.name, before_.name, 'nome do admin não deve ter mudado');
});

test('profissional comum (não-admin) não pode chamar o endpoint', async (t) => {
  if (!dbAvailable) { t.skip('banco não disponível'); return; }

  const otherLogin = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: OTHER_EMAIL, password: OTHER_PASSWORD }),
  });
  assert.equal(otherLogin.status, 200);
  const otherCookie = otherLogin.headers.get('set-cookie');

  const res = await putProfessional(targetId, {
    name: 'Tentativa não autorizada',
    business_name: 'x',
    phone_whatsapp: '5531999990000',
    email: TARGET_EMAIL,
  }, otherCookie);

  assert.equal(res.status, 403, 'profissional não-admin deve receber 403');
});

test('id inexistente retorna 404', async (t) => {
  if (!dbAvailable) { t.skip('banco não disponível'); return; }

  const fakeId = '00000000-0000-0000-0000-000000000000';
  const res = await putProfessional(fakeId, {
    name: 'Ninguém',
    business_name: 'Ninguém Studio',
    phone_whatsapp: '5531999990001',
    email: 'ninguem_edit_test@nailflow.com',
  });
  assert.equal(res.status, 404);
});

test('campos fora do permitido (is_admin, blocked_at, slug, wa_instance_name) são ignorados', async (t) => {
  if (!dbAvailable) { t.skip('banco não disponível'); return; }

  const before_ = await getRawProfessional(otherId);

  const res = await putProfessional(otherId, {
    name: before_.name,
    business_name: before_.business_name,
    phone_whatsapp: before_.phone_whatsapp,
    email: OTHER_EMAIL,
    is_admin: true,
    blocked_at: new Date().toISOString(),
    slug: 'slug-hackeado',
    wa_instance_name: 'instancia-hackeada',
    token_version: 999,
  });

  assert.equal(res.status, 200, 'edição com campos extras deve ainda funcionar, ignorando os extras');

  const after_ = await getRawProfessional(otherId);
  assert.equal(after_.is_admin, false, 'is_admin não deve mudar via esta rota');
  assert.equal(after_.blocked_at, null, 'blocked_at não deve mudar via esta rota');
  assert.equal(after_.slug, before_.slug, 'slug não deve mudar via esta rota');
  assert.equal(after_.wa_instance_name, before_.wa_instance_name, 'wa_instance_name não deve mudar via esta rota');
});
