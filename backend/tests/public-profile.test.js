/**
 * Personalização da página pública (migration 020).
 *
 * Cobre:
 *   1. Migration 020 idempotente (colunas bio/public_theme e CHECK de tema)
 *   2. GET /public/:slug/info expõe somente campos públicos
 *   3. Isolamento: bio/tema/foto de uma profissional não aparecem na outra
 *   4. PUT /auth/me: valida bio (trim + 280), tema e prefixo da foto
 *   5. PUT /auth/me sem bio/tema/foto não altera os valores existentes
 *   6. Foto inválida já gravada no banco nunca é devolvida pelo /info
 *
 * Usa profissionais temporárias criadas e removidas aqui; nunca toca dados reais.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

process.env.NODE_ENV = 'test';

let server;
let baseUrl;
let dbAvailable = true;
let idA, idB, cookieA;

const PASSWORD = 'senha_teste_public_profile';
const EMAIL_A = 'public_profile_a@nailflow.com';
const EMAIL_B = 'public_profile_b@nailflow.com';
const SLUG_A = 'teste-public-profile-a';
const SLUG_B = 'teste-public-profile-b';
const AVATAR_OK = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAA=';

const ALLOWED_INFO_KEYS = ['bio', 'businessName', 'photo', 'theme', 'whatsappLink'];

before(async () => {
  const { pool } = await import('../src/config/db.js');
  try { await pool.query('SELECT 1'); } catch { dbAvailable = false; }

  const { default: app } = await import('../src/server.js');
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  if (!dbAvailable) return;

  const { default: bcrypt } = await import('bcryptjs');
  const hash = await bcrypt.hash(PASSWORD, 10);
  const a = await pool.query(
    `INSERT INTO professionals (name, email, password_hash, phone_whatsapp, business_name, slug)
     VALUES ('Perfil Publico A', $1, $2, '5531000000030', 'Studio Publico A', $3) RETURNING id`,
    [EMAIL_A, hash, SLUG_A]
  );
  idA = a.rows[0].id;
  const b = await pool.query(
    `INSERT INTO professionals (name, email, password_hash, phone_whatsapp, business_name, slug)
     VALUES ('Perfil Publico B', $1, $2, '5531000000031', 'Studio Publico B', $3) RETURNING id`,
    [EMAIL_B, hash, SLUG_B]
  );
  idB = b.rows[0].id;

  const login = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL_A, password: PASSWORD }),
  });
  assert.equal(login.status, 200);
  cookieA = login.headers.get('set-cookie');
});

after(async () => {
  const { pool } = await import('../src/config/db.js');
  if (dbAvailable) {
    if (idA) await pool.query('DELETE FROM professionals WHERE id = $1', [idA]);
    if (idB) await pool.query('DELETE FROM professionals WHERE id = $1', [idB]);
  }
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
});

async function putMe(body) {
  const res = await fetch(`${baseUrl}/auth/me`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Cookie: cookieA },
    body: JSON.stringify({
      name: 'Perfil Publico A',
      business_name: 'Studio Publico A',
      phone_whatsapp: '5531000000030',
      email: EMAIL_A,
      ...body,
    }),
  });
  return { status: res.status, body: await res.json() };
}

async function getInfo(slug) {
  const res = await fetch(`${baseUrl}/public/${slug}/info`);
  return { status: res.status, body: await res.json() };
}

test('migration 020 pode ser aplicada duas vezes e o CHECK rejeita tema inválido', async (t) => {
  if (!dbAvailable) { t.skip('banco não disponível'); return; }
  const { pool } = await import('../src/config/db.js');
  const sql = await readFile(new URL('../db/migrations/020_public_profile.sql', import.meta.url), 'utf8');
  await pool.query(sql);
  await pool.query(sql);
  await assert.rejects(
    pool.query("UPDATE professionals SET public_theme = 'rosa' WHERE id = $1", [idA]),
    /professionals_public_theme_check/
  );
});

test('padrões: tema vinho, sem bio e sem foto', async (t) => {
  if (!dbAvailable) { t.skip('banco não disponível'); return; }
  const { status, body } = await getInfo(SLUG_A);
  assert.equal(status, 200);
  assert.equal(body.theme, 'vinho');
  assert.equal(body.bio, null);
  assert.equal(body.photo, null);
});

test('PUT /auth/me salva bio (com trim), tema e foto; /info expõe só campos públicos', async (t) => {
  if (!dbAvailable) { t.skip('banco não disponível'); return; }
  const put = await putMe({ bio: '  Nail designer em BH  ', public_theme: 'verde', avatar_b64: AVATAR_OK });
  assert.equal(put.status, 200, JSON.stringify(put.body));
  assert.equal(put.body.bio, 'Nail designer em BH');
  assert.equal(put.body.public_theme, 'verde');

  const me = await fetch(`${baseUrl}/auth/me`, { headers: { Cookie: cookieA } });
  const meBody = await me.json();
  assert.equal(meBody.bio, 'Nail designer em BH');
  assert.equal(meBody.public_theme, 'verde');

  const { status, body } = await getInfo(SLUG_A);
  assert.equal(status, 200);
  assert.deepEqual(Object.keys(body).sort(), ALLOWED_INFO_KEYS);
  assert.equal(body.bio, 'Nail designer em BH');
  assert.equal(body.theme, 'verde');
  assert.equal(body.photo, AVATAR_OK);
  assert.equal(body.businessName, 'Studio Publico A');
});

test('isolamento: dados da profissional A não aparecem na página da B', async (t) => {
  if (!dbAvailable) { t.skip('banco não disponível'); return; }
  const { body } = await getInfo(SLUG_B);
  assert.equal(body.businessName, 'Studio Publico B');
  assert.equal(body.bio, null);
  assert.equal(body.theme, 'vinho');
  assert.equal(body.photo, null);
  assert.ok(!JSON.stringify(body).includes('Studio Publico A'));
});

test('slug inexistente retorna 404', async (t) => {
  if (!dbAvailable) { t.skip('banco não disponível'); return; }
  const { status } = await getInfo('slug-que-nao-existe-xyz');
  assert.equal(status, 404);
});

test('PUT /auth/me rejeita bio com mais de 280 caracteres, e aceita exatamente 280', async (t) => {
  if (!dbAvailable) { t.skip('banco não disponível'); return; }
  assert.equal((await putMe({ bio: 'x'.repeat(281) })).status, 400);
  assert.equal((await putMe({ bio: 'x'.repeat(280) })).status, 200);
});

test('PUT /auth/me rejeita tema fora dos presets', async (t) => {
  if (!dbAvailable) { t.skip('banco não disponível'); return; }
  assert.equal((await putMe({ public_theme: 'rosa' })).status, 400);
  assert.equal((await putMe({ public_theme: '#ff0000' })).status, 400);
});

test('PUT /auth/me rejeita foto que não seja data URL jpeg/png/webp', async (t) => {
  if (!dbAvailable) { t.skip('banco não disponível'); return; }
  for (const bad of [
    'https://exemplo.com/foto.jpg',
    'javascript:alert(1)',
    'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
    'data:text/html;base64,PGgxPg==',
    'data:image/png;base64,<script>',
  ]) {
    assert.equal((await putMe({ avatar_b64: bad })).status, 400, `deveria rejeitar: ${bad}`);
  }
  assert.equal((await putMe({ avatar_b64: 'data:image/png;base64,iVBORw0KGgo=' })).status, 200);
  assert.equal((await putMe({ avatar_b64: 'data:image/webp;base64,UklGRg==' })).status, 200);
});

test('limite da foto: até 90.000 caracteres passa; acima disso 400 com mensagem; corpo > 100KB é 413', async (t) => {
  if (!dbAvailable) { t.skip('banco não disponível'); return; }
  const prefix = 'data:image/jpeg;base64,';
  const ok = prefix + 'A'.repeat(90_000 - prefix.length);
  assert.equal((await putMe({ avatar_b64: ok })).status, 200);

  const tooBig = await putMe({ avatar_b64: prefix + 'A'.repeat(90_001 - prefix.length + 1000) });
  assert.equal(tooBig.status, 400);
  assert.match(tooBig.body.error, /Imagem muito grande/);

  // acima do limite do express.json() (100KB) o corpo é recusado antes da validação
  assert.equal((await putMe({ avatar_b64: prefix + 'A'.repeat(110_000) })).status, 413);
});

test('PUT /auth/me sem bio/tema/foto preserva os valores existentes; bio vazia limpa', async (t) => {
  if (!dbAvailable) { t.skip('banco não disponível'); return; }
  await putMe({ bio: 'Minha bio', public_theme: 'azul', avatar_b64: AVATAR_OK });
  const keep = await putMe({});
  assert.equal(keep.status, 200);
  assert.equal(keep.body.bio, 'Minha bio');
  assert.equal(keep.body.public_theme, 'azul');
  assert.equal(keep.body.avatar_b64, AVATAR_OK);

  const cleared = await putMe({ bio: '   ' });
  assert.equal(cleared.body.bio, null);
});

test('foto inválida já gravada no banco nunca é devolvida pelo /info', async (t) => {
  if (!dbAvailable) { t.skip('banco não disponível'); return; }
  const { pool } = await import('../src/config/db.js');
  await pool.query("UPDATE professionals SET avatar_b64 = 'https://evil.example/x.png' WHERE id = $1", [idB]);
  const { body } = await getInfo(SLUG_B);
  assert.equal(body.photo, null);
});

test('slug com texto malicioso não retorna dados de ninguém', async (t) => {
  if (!dbAvailable) { t.skip('banco não disponível'); return; }
  const { status } = await getInfo(encodeURIComponent(`${SLUG_A}' OR '1'='1`));
  assert.equal(status, 404);
});

async function putRaw(body) {
  const res = await fetch(`${baseUrl}/auth/me`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Cookie: cookieA },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

test('salvar só bio/tema funciona sem WhatsApp cadastrado e não altera a identidade', async (t) => {
  if (!dbAvailable) { t.skip('banco não disponível'); return; }
  const { pool } = await import('../src/config/db.js');
  await pool.query('UPDATE professionals SET phone_whatsapp = NULL WHERE id = $1', [idA]);

  const res = await putRaw({ bio: 'Sem telefone ainda', public_theme: 'verde' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.bio, 'Sem telefone ainda');
  assert.equal(res.body.public_theme, 'verde');
  assert.equal(res.body.phone_whatsapp, null);
  assert.equal(res.body.email, EMAIL_A);
  assert.equal(res.body.business_name, 'Studio Publico A');
});

test('identidade continua tudo-ou-nada: telefone ausente/curto/nulo ainda é rejeitado', async (t) => {
  if (!dbAvailable) { t.skip('banco não disponível'); return; }
  const base = { name: 'Perfil Publico A', business_name: 'Studio Publico A', email: EMAIL_A };
  assert.equal((await putRaw({ ...base })).status, 400);
  assert.equal((await putRaw({ ...base, phone_whatsapp: '123' })).status, 400);
  assert.equal((await putRaw({ ...base, phone_whatsapp: null })).status, 400);
  assert.equal((await putRaw({ name: 'Só o nome' })).status, 400);
  assert.equal((await putRaw({ ...base, phone_whatsapp: '5531000000030', bio: 'ok' })).status, 200);
});

test('corpo sem nenhum campo atualizável é rejeitado; valores inválidos continuam rejeitados sem identidade', async (t) => {
  if (!dbAvailable) { t.skip('banco não disponível'); return; }
  assert.equal((await putRaw({})).status, 400);
  assert.equal((await putRaw({ slug: 'tentando-mudar' })).status, 400);
  assert.equal((await putRaw({ public_theme: 'rosa' })).status, 400);
  assert.equal((await putRaw({ bio: 'x'.repeat(281) })).status, 400);
  assert.equal((await putRaw({ avatar_b64: 'javascript:alert(1)' })).status, 400);
});

test('salvar só bio/tema não afeta outra profissional', async (t) => {
  if (!dbAvailable) { t.skip('banco não disponível'); return; }
  const { pool } = await import('../src/config/db.js');
  await putRaw({ bio: 'Bio exclusiva da A', public_theme: 'azul' });
  const { rows } = await pool.query('SELECT bio, public_theme FROM professionals WHERE id = $1', [idB]);
  assert.equal(rows[0].bio, null);
  assert.equal(rows[0].public_theme, 'vinho');
});
