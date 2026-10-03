/**
 * Testes para F9: ao criar um agendamento pela página pública, a profissional
 * dona daquele agendamento deve ser notificada via n8n (evento
 * 'appointment.public_created'), reaproveitando a infraestrutura de
 * notifyN8n já usada por appointment.confirmed/appointment.cancelled.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';

let server;
let baseUrl;
let dbAvailable = true;
let authCookie;
let professionalId;
let serviceId;
let originalFetch;
let originalInstance;
let capturedCalls = [];
const realFetch = global.fetch;

before(async () => {
  const { pool } = await import('../src/config/db.js');
  try {
    await pool.query('SELECT 1');
  } catch {
    dbAvailable = false;
  }

  originalFetch = global.fetch;

  const { default: app } = await import('../src/server.js');
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  global.fetch = originalFetch;
  delete process.env.N8N_WEBHOOK_PUBLIC_CREATED_URL;
  if (dbAvailable) {
    const { pool } = await import('../src/config/db.js');
    if (professionalId) {
      await pool.query('UPDATE professionals SET wa_instance_name = $1 WHERE id = $2', [originalInstance ?? null, professionalId]);
    }
    if (serviceId) {
      await pool.query('DELETE FROM appointments WHERE service_id = $1', [serviceId]);
      await pool.query('DELETE FROM services WHERE id = $1', [serviceId]);
    }
    await pool.end();
  }
  await new Promise((resolve) => server.close(resolve));
});

async function req(method, path, body, cookie) {
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
    },
  };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await realFetch(`${baseUrl}${path}`, opts);
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

function mockFetch() {
  capturedCalls = [];
  global.fetch = async (url, opts) => {
    capturedCalls.push({ url, body: JSON.parse(opts.body) });
    return { ok: true };
  };
}

test('setup: login e criação de serviço visível no WhatsApp', async (t) => {
  if (!dbAvailable) { t.skip('banco não disponível'); return; }

  const loginRes = await req('POST', '/auth/login', { email: 'camila@nailflow.com', password: 'senha123' });
  assert.equal(loginRes.status, 200);
  authCookie = loginRes.body ? undefined : undefined; // cookie vem do header, não do body

  const loginRaw = await realFetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'camila@nailflow.com', password: 'senha123' }),
  });
  authCookie = loginRaw.headers.get('set-cookie');

  const me = await req('GET', '/auth/me', undefined, authCookie);
  professionalId = me.body.id;

  const s = await req('POST', '/services', { name: 'Serviço Notificação F9', priceCents: 3000, durationMinutes: 30 }, authCookie);
  assert.equal(s.status, 201);
  serviceId = s.body.id;
});

test('criar agendamento pela página pública dispara appointment.public_created para a profissional correta', async (t) => {
  if (!dbAvailable) { t.skip('banco não disponível'); return; }

  process.env.N8N_WEBHOOK_PUBLIC_CREATED_URL = 'http://n8n-test/public-created';
  mockFetch();

  // O aviso só sai para quem tem instância própria: a conta da seed não tem
  // (restaurada no `after`).
  const { pool } = await import('../src/config/db.js');
  originalInstance = (await pool.query('SELECT wa_instance_name FROM professionals WHERE id = $1', [professionalId])).rows[0].wa_instance_name;
  await pool.query('UPDATE professionals SET wa_instance_name = $1 WHERE id = $2', ['inst-f9-teste', professionalId]);

  const avail = await req('GET', `/public/camila-nails-studio/availability?days=30&serviceId=${serviceId}`);
  assert.equal(avail.status, 200);
  const firstDay = avail.body.days.find((d) => d.slots.length > 0);
  assert.ok(firstDay, 'esperava ao menos um dia com horário livre');
  const startsAt = firstDay.slots[0];

  const create = await req('POST', '/public/camila-nails-studio/appointments', {
    serviceId,
    startsAt,
    clientName: 'Cliente Teste F9',
    clientPhone: '5531999990099',
  });
  assert.equal(create.status, 201, `esperava 201, veio ${create.status}: ${JSON.stringify(create.body)}`);

  await new Promise((r) => setTimeout(r, 30));

  assert.equal(capturedCalls.length, 1, 'esperava exatamente 1 chamada ao webhook do n8n');
  assert.equal(capturedCalls[0].url, 'http://n8n-test/public-created');
  assert.equal(capturedCalls[0].body.event, 'appointment.public_created');

  const { payload } = capturedCalls[0].body;
  assert.equal(payload.professionalId, professionalId, 'deve notificar somente a profissional dona do agendamento');
  assert.equal(payload.waInstance, 'inst-f9-teste', 'deve usar a instância da própria profissional');
  assert.equal(payload.clientName, 'Cliente Teste F9');
  assert.equal(payload.serviceName, 'Serviço Notificação F9');
  assert.equal(payload.startsAt, startsAt);
  assert.ok('clientPhone' in payload);
  assert.ok('professionalPhone' in payload);
});

test('falha no envio ao n8n não desfaz nem atrasa o agendamento (continua 201)', async (t) => {
  if (!dbAvailable) { t.skip('banco não disponível'); return; }

  process.env.N8N_WEBHOOK_PUBLIC_CREATED_URL = 'http://n8n-test/public-created';
  global.fetch = async () => { throw new Error('n8n indisponível (simulado)'); };

  const avail = await req('GET', `/public/camila-nails-studio/availability?days=30&serviceId=${serviceId}`);
  const firstDay = avail.body.days.find((d) => d.slots.length > 0);
  assert.ok(firstDay);
  const startsAt = firstDay.slots[0];

  const create = await req('POST', '/public/camila-nails-studio/appointments', {
    serviceId,
    startsAt,
    clientName: 'Cliente Teste F9 Falha Webhook',
    clientPhone: '5531999990098',
  });
  assert.equal(create.status, 201, `agendamento deve ser criado mesmo com falha no webhook, veio ${create.status}: ${JSON.stringify(create.body)}`);
});

test('sem N8N_WEBHOOK_PUBLIC_CREATED_URL configurado, não tenta notificar (no-op) e o agendamento continua funcionando', async (t) => {
  if (!dbAvailable) { t.skip('banco não disponível'); return; }

  delete process.env.N8N_WEBHOOK_PUBLIC_CREATED_URL;
  mockFetch();

  const avail = await req('GET', `/public/camila-nails-studio/availability?days=30&serviceId=${serviceId}`);
  const firstDay = avail.body.days.find((d) => d.slots.length > 0);
  assert.ok(firstDay);
  const startsAt = firstDay.slots[0];

  const create = await req('POST', '/public/camila-nails-studio/appointments', {
    serviceId,
    startsAt,
    clientName: 'Cliente Teste F9 Sem Webhook',
    clientPhone: '5531999990097',
  });
  assert.equal(create.status, 201);

  await new Promise((r) => setTimeout(r, 30));
  assert.equal(capturedCalls.length, 0, 'sem URL configurada não deve haver chamada ao n8n');
});
