/**
 * Teste para correção: criar um bloqueio de horário com endsAt <= startsAt
 * deve ser rejeitado (400), em vez de gravar um intervalo invertido/vazio.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';

let server;
let baseUrl;
let dbAvailable = true;
let authCookie;
let blockedTimeId;

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
    if (blockedTimeId) await pool.query('DELETE FROM blocked_times WHERE id = $1', [blockedTimeId]);
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
  return { status: res.status, body: await res.json(), headers: res.headers };
}

test('setup: login', async (t) => {
  if (!dbAvailable) { t.skip('banco não disponível'); return; }
  const loginRes = await req('POST', '/auth/login', { email: 'camila@nailflow.com', password: 'senha123' });
  assert.equal(loginRes.status, 200, 'login deve retornar 200');
  authCookie = loginRes.headers.get('set-cookie');
});

test('bloqueio com endsAt antes de startsAt é rejeitado (400)', async (t) => {
  if (!dbAvailable) { t.skip('banco não disponível'); return; }

  const res = await req('POST', '/availability/blocked', {
    startsAt: '2027-01-10T14:00:00-03:00',
    endsAt: '2027-01-10T10:00:00-03:00',
  }, authCookie);
  assert.equal(res.status, 400, `esperava 400, veio ${res.status}: ${JSON.stringify(res.body)}`);
});

test('bloqueio com endsAt igual a startsAt é rejeitado (400)', async (t) => {
  if (!dbAvailable) { t.skip('banco não disponível'); return; }

  const res = await req('POST', '/availability/blocked', {
    startsAt: '2027-01-10T14:00:00-03:00',
    endsAt: '2027-01-10T14:00:00-03:00',
  }, authCookie);
  assert.equal(res.status, 400, `esperava 400, veio ${res.status}: ${JSON.stringify(res.body)}`);
});

test('bloqueio válido (endsAt após startsAt) continua sendo aceito (201)', async (t) => {
  if (!dbAvailable) { t.skip('banco não disponível'); return; }

  const res = await req('POST', '/availability/blocked', {
    startsAt: '2027-01-10T14:00:00-03:00',
    endsAt: '2027-01-10T16:00:00-03:00',
    reason: 'Teste',
  }, authCookie);
  assert.equal(res.status, 201, `esperava 201, veio ${res.status}: ${JSON.stringify(res.body)}`);
  blockedTimeId = res.body.id;
});
