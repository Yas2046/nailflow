/**
 * Teste para correção: excluir um serviço com agendamentos vinculados
 * deve retornar 409 com mensagem clara, em vez do erro genérico de FK (23503).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';

let server;
let baseUrl;
let dbAvailable = true;
let authCookie;
let clientId;
let serviceId;
let appointmentId;

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
});

after(async () => {
  if (dbAvailable) {
    const { pool } = await import('../src/config/db.js');
    if (appointmentId) await pool.query('DELETE FROM appointments WHERE id = $1', [appointmentId]);
    if (serviceId) await pool.query('DELETE FROM services WHERE id = $1', [serviceId]);
    if (clientId) await pool.query('DELETE FROM clients WHERE id = $1', [clientId]);
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
  const res = await fetch(`${baseUrl}${path}`, opts);
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  return { status: res.status, body: json, headers: res.headers };
}

test('setup: login e criação de serviço, cliente e agendamento vinculado', async (t) => {
  if (!dbAvailable) { t.skip('banco não disponível'); return; }

  const loginRes = await req('POST', '/auth/login', { email: 'camila@nailflow.com', password: 'senha123' });
  assert.equal(loginRes.status, 200, 'login deve retornar 200');
  authCookie = loginRes.headers.get('set-cookie');

  const c = await req('POST', '/clients', { name: 'Teste Delete Service', phone: '5511999990011' }, authCookie);
  assert.equal(c.status, 201);
  clientId = c.body.id;

  const s = await req('POST', '/services', { name: 'Serviço Com Agendamento', priceCents: 2000, durationMinutes: 30 }, authCookie);
  assert.equal(s.status, 201);
  serviceId = s.body.id;

  const starts = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
  while (starts.getDay() === 0 || starts.getDay() === 6) {
    starts.setDate(starts.getDate() + 1);
  }
  const dateOnly = starts.toISOString().split('T')[0];
  let a = await req('POST', '/appointments', {
    clientId,
    serviceId,
    startsAt: `${dateOnly}T11:00:00.000Z`,
  }, authCookie);
  if (a.status === 409 && a.body?.alternatives?.length) {
    a = await req('POST', '/appointments', {
      clientId,
      serviceId,
      startsAt: a.body.alternatives[0],
    }, authCookie);
  }
  assert.equal(a.status, 201, `esperava 201 ao criar agendamento, veio ${a.status}: ${JSON.stringify(a.body)}`);
  appointmentId = a.body.id;
});

test('excluir serviço com agendamento vinculado retorna 409 com mensagem clara', async (t) => {
  if (!dbAvailable) { t.skip('banco não disponível'); return; }

  const res = await req('DELETE', `/services/${serviceId}`, undefined, authCookie);
  assert.equal(res.status, 409, `esperava 409, veio ${res.status}: ${JSON.stringify(res.body)}`);
  assert.match(res.body.error ?? res.body.message ?? '', /agendamentos vinculados/i);
});

test('serviço sem agendamentos ainda pode ser excluído normalmente', async (t) => {
  if (!dbAvailable) { t.skip('banco não disponível'); return; }

  const s = await req('POST', '/services', { name: 'Serviço Sem Agendamento', priceCents: 1500, durationMinutes: 20 }, authCookie);
  assert.equal(s.status, 201);

  const res = await req('DELETE', `/services/${s.body.id}`, undefined, authCookie);
  assert.equal(res.status, 204);
});
