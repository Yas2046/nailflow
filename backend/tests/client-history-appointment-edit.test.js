/**
 * Testes para a edição de agendamento a partir da ficha da cliente:
 *   1. GET /clients/:id retorna service_id e recurring_group_id no histórico
 *   2. A edição continua usando PUT /appointments/:id (endpoint já existente,
 *      não alterado) e reflete no histórico ao reconsultar
 *   3. professional_id continua validado: uma cliente de outra profissional
 *      não é acessível via GET /clients/:id
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';

let server;
let baseUrl;
let dbAvailable = true;
let authCookie;
let otherAuthCookie;
let professionalId;
let otherProfessionalId;

const EMAIL = 'client_history_edit_test@nailflow.com';
const PASSWORD = 'senha_teste_history_edit';
const OTHER_EMAIL = 'client_history_edit_other@nailflow.com';
const OTHER_PASSWORD = 'senha_teste_history_edit_other';

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
  const hash = await bcrypt.hash(PASSWORD, 10);
  const { rows } = await pool.query(
    `INSERT INTO professionals (name, email, password_hash, phone_whatsapp, business_name, slug)
     VALUES ('History Edit Tester', $1, $2, '5531000000003', 'HistoryEditStudio', 'teste-history-edit')
     RETURNING id`,
    [EMAIL, hash]
  );
  professionalId = rows[0].id;

  const otherHash = await bcrypt.hash(OTHER_PASSWORD, 10);
  const { rows: otherRows } = await pool.query(
    `INSERT INTO professionals (name, email, password_hash, phone_whatsapp, business_name, slug)
     VALUES ('History Edit Other', $1, $2, '5531000000004', 'HistoryEditOtherStudio', 'teste-history-edit-other')
     RETURNING id`,
    [OTHER_EMAIL, otherHash]
  );
  otherProfessionalId = otherRows[0].id;

  for (let weekday = 0; weekday <= 6; weekday++) {
    await pool.query(
      `INSERT INTO weekly_availability (professional_id, weekday, is_working, start_time, end_time)
       VALUES ($1, $2, true, '08:00', '22:00')
       ON CONFLICT (professional_id, weekday) DO NOTHING`,
      [professionalId, weekday]
    );
  }

  const loginRes = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  assert.equal(loginRes.status, 200, 'login deve retornar 200');
  authCookie = loginRes.headers.get('set-cookie');

  const otherLoginRes = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: OTHER_EMAIL, password: OTHER_PASSWORD }),
  });
  assert.equal(otherLoginRes.status, 200);
  otherAuthCookie = otherLoginRes.headers.get('set-cookie');
});

after(async () => {
  const { pool } = await import('../src/config/db.js');
  if (dbAvailable) {
    if (professionalId) await pool.query('DELETE FROM professionals WHERE id = $1', [professionalId]);
    if (otherProfessionalId) await pool.query('DELETE FROM professionals WHERE id = $1', [otherProfessionalId]);
  }
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
});

async function req(method, path, body, cookie) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
  };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(`${baseUrl}${path}`, opts);
  return { status: res.status, body: await res.json() };
}

test('histórico de GET /clients/:id inclui service_id e recurring_group_id', async (t) => {
  if (!dbAvailable) { t.skip('banco não disponível'); return; }

  const servico = await req('POST', '/services', { name: 'Serviço Edição Histórico', priceCents: 4000, durationMinutes: 40 }, authCookie);
  assert.equal(servico.status, 201);

  const cliente = await req('POST', '/clients', { name: 'Cliente Edição Histórico', phone: `55319${Date.now().toString().slice(-8)}` }, authCookie);
  assert.equal(cliente.status, 201);

  const startsAt = new Date(Date.now() + 9 * 24 * 60 * 60 * 1000);
  startsAt.setUTCHours(15, 0, 0, 0);
  const agendamento = await req('POST', '/appointments', {
    clientId: cliente.body.id,
    serviceId: servico.body.id,
    startsAt: startsAt.toISOString(),
  }, authCookie);
  assert.equal(agendamento.status, 201, JSON.stringify(agendamento.body));

  const historico = await req('GET', `/clients/${cliente.body.id}`, undefined, authCookie);
  assert.equal(historico.status, 200);
  const item = historico.body.history.find((h) => h.id === agendamento.body.id);
  assert.ok(item, 'agendamento criado deve aparecer no histórico');
  assert.equal(item.service_id, servico.body.id, 'service_id deve vir no histórico');
  assert.equal(item.recurring_group_id, null, 'agendamento avulso deve ter recurring_group_id nulo');
});

test('editar agendamento via PUT /appointments/:id reflete no histórico da cliente', async (t) => {
  if (!dbAvailable) { t.skip('banco não disponível'); return; }

  const servico = await req('POST', '/services', { name: 'Serviço A Edição', priceCents: 3000, durationMinutes: 40 }, authCookie);
  const outroServico = await req('POST', '/services', { name: 'Serviço B Edição', priceCents: 7000, durationMinutes: 40 }, authCookie);
  const cliente = await req('POST', '/clients', { name: 'Cliente PUT Edição', phone: `55319${Date.now().toString().slice(-8)}` }, authCookie);

  const startsAt = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
  startsAt.setUTCHours(16, 0, 0, 0);
  const agendamento = await req('POST', '/appointments', {
    clientId: cliente.body.id,
    serviceId: servico.body.id,
    startsAt: startsAt.toISOString(),
  }, authCookie);
  assert.equal(agendamento.status, 201);

  const editado = await req('PUT', `/appointments/${agendamento.body.id}`, {
    serviceId: outroServico.body.id,
    notes: 'Editado pela ficha da cliente',
  }, authCookie);
  assert.equal(editado.status, 200);
  assert.equal(editado.body.serviceId, outroServico.body.id);

  const historico = await req('GET', `/clients/${cliente.body.id}`, undefined, authCookie);
  const item = historico.body.history.find((h) => h.id === agendamento.body.id);
  assert.ok(item);
  assert.equal(item.service_id, outroServico.body.id, 'histórico deve refletir o novo serviço após a edição');
  assert.equal(item.appointment_notes, 'Editado pela ficha da cliente');
});

test('professional_id continua validado: cliente de outra profissional não é acessível', async (t) => {
  if (!dbAvailable) { t.skip('banco não disponível'); return; }

  const clienteOutra = await req('POST', '/clients', { name: 'Cliente Da Outra', phone: `55319${Date.now().toString().slice(-8)}` }, otherAuthCookie);
  assert.equal(clienteOutra.status, 201);

  const tentativa = await req('GET', `/clients/${clienteOutra.body.id}`, undefined, authCookie);
  assert.equal(tentativa.status, 404, 'cliente de outra profissional não deve ser acessível');
});
