/**
 * Testes para available_on_whatsapp: um serviço pode continuar ativo/
 * disponível na Agenda sem ser oferecido pelo bot nem pela página pública.
 *
 * Cobre:
 *   1. Serviço criado sem o campo → default true
 *   2. false persiste corretamente (criação e edição)
 *   3. active=true + available_on_whatsapp=false continua na consulta
 *      equivalente à da Agenda (GET /services, sem filtro), mas some da
 *      consulta equivalente à do bot/página pública (active=true AND
 *      available_on_whatsapp=true)
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';

let server;
let baseUrl;
let dbAvailable = true;
let authCookie;
let professionalId;

const PROFESSIONAL_EMAIL = 'wa_visibility_test@nailflow.com';
const PROFESSIONAL_PASSWORD = 'senha_teste_wa_visibility';

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
  const hash = await bcrypt.hash(PROFESSIONAL_PASSWORD, 10);
  const { rows } = await pool.query(
    `INSERT INTO professionals (name, email, password_hash, phone_whatsapp, business_name, slug)
     VALUES ('WA Visibility Tester', $1, $2, '5531000000002', 'WAVisibilityStudio', 'teste-wa-visibility')
     RETURNING id`,
    [PROFESSIONAL_EMAIL, hash]
  );
  professionalId = rows[0].id;

  const loginRes = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: PROFESSIONAL_EMAIL, password: PROFESSIONAL_PASSWORD }),
  });
  assert.equal(loginRes.status, 200, 'login deve retornar 200');
  authCookie = loginRes.headers.get('set-cookie');
});

after(async () => {
  const { pool } = await import('../src/config/db.js');
  if (dbAvailable && professionalId) {
    await pool.query('DELETE FROM professionals WHERE id = $1', [professionalId]);
  }
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
});

async function req(method, path, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json', Cookie: authCookie },
  };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(`${baseUrl}${path}`, opts);
  return { status: res.status, body: await res.json() };
}

// Reproduz exatamente a consulta usada pelo Agenda (GET /services, sem
// filtro de canal) e pelo bot/página pública (active + available_on_whatsapp).
async function apareceNaAgenda(serviceId) {
  const { pool } = await import('../src/config/db.js');
  const { rows } = await pool.query('SELECT active FROM services WHERE id = $1', [serviceId]);
  return rows[0]?.active === true;
}
async function apareceNoWhatsapp(serviceId, professionalIdArg) {
  const { pool } = await import('../src/config/db.js');
  const { rows } = await pool.query(
    'SELECT id FROM services WHERE id = $1 AND professional_id = $2 AND active = true AND available_on_whatsapp = true',
    [serviceId, professionalIdArg]
  );
  return rows.length === 1;
}

test('criar serviço sem informar availableOnWhatsapp → default true', async (t) => {
  if (!dbAvailable) { t.skip('banco não disponível'); return; }

  const res = await req('POST', '/services', {
    name: 'Manicure Padrão',
    priceCents: 3500,
    durationMinutes: 40,
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.availableOnWhatsapp, true, 'default deve ser true quando o campo não é enviado');
});

test('criar serviço com availableOnWhatsapp=false persiste corretamente', async (t) => {
  if (!dbAvailable) { t.skip('banco não disponível'); return; }

  const res = await req('POST', '/services', {
    name: 'Pacote Interno VIP',
    priceCents: 12000,
    durationMinutes: 90,
    active: true,
    availableOnWhatsapp: false,
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.availableOnWhatsapp, false);

  const getRes = await req('GET', '/services');
  const persisted = getRes.body.find((s) => s.id === res.body.id);
  assert.ok(persisted, 'serviço deve aparecer em GET /services');
  assert.equal(persisted.availableOnWhatsapp, false, 'valor deve persistir após releitura');
});

test('editar serviço para availableOnWhatsapp=false via PUT persiste', async (t) => {
  if (!dbAvailable) { t.skip('banco não disponível'); return; }

  const created = await req('POST', '/services', {
    name: 'Alongamento em Gel',
    priceCents: 9000,
    durationMinutes: 60,
  });
  assert.equal(created.body.availableOnWhatsapp, true);

  const updated = await req('PUT', `/services/${created.body.id}`, { availableOnWhatsapp: false });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.availableOnWhatsapp, false);
  assert.equal(updated.body.name, 'Alongamento em Gel', 'demais campos não devem mudar em update parcial');
});

test('active=true + availableOnWhatsapp=false: continua na Agenda, some do WhatsApp/página pública', async (t) => {
  if (!dbAvailable) { t.skip('banco não disponível'); return; }

  const created = await req('POST', '/services', {
    name: 'Pé + Mão Combo Fechado',
    priceCents: 15000,
    durationMinutes: 80,
    active: true,
    availableOnWhatsapp: false,
  });
  assert.equal(created.status, 201);
  const serviceId = created.body.id;

  assert.equal(await apareceNaAgenda(serviceId), true, 'deve continuar disponível na Agenda (active=true)');
  assert.equal(await apareceNoWhatsapp(serviceId, professionalId), false, 'não deve ser oferecido pelo WhatsApp/página pública');
});

test('active=true + availableOnWhatsapp=true: aparece nos dois', async (t) => {
  if (!dbAvailable) { t.skip('banco não disponível'); return; }

  const created = await req('POST', '/services', {
    name: 'Esmaltação Simples',
    priceCents: 2500,
    durationMinutes: 30,
    active: true,
    availableOnWhatsapp: true,
  });
  assert.equal(created.status, 201);
  const serviceId = created.body.id;

  assert.equal(await apareceNaAgenda(serviceId), true);
  assert.equal(await apareceNoWhatsapp(serviceId, professionalId), true);
});
