import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';

let server;
let baseUrl;
let dbAvailable = true;

before(async () => {
  const { pool } = await import('../src/config/db.js');
  try {
    await pool.query('SELECT 1');
  } catch {
    dbAvailable = false;
  }

  const { default: app } = await import('../src/server.js');
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  const { pool } = await import('../src/config/db.js');
  await pool.end();
});

test('login com credenciais da seed retorna token e cookie de sessão', async (t) => {
  if (!dbAvailable) {
    t.skip('DATABASE_URL não está acessível — rode "npm run db:create && npm run db:seed" antes deste teste.');
    return;
  }

  const res = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'camila@nailflow.com', password: 'senha123' }),
  });

  // Se a seed ainda não foi rodada ou o hash de senha foi regenerado,
  // este teste falha com uma mensagem clara em vez de travar silenciosamente.
  assert.equal(res.status, 200, 'login falhou — confira se rodou "npm run db:seed" e se o hash em seed.sql corresponde a "senha123"');
  const body = await res.json();
  assert.ok(body.token, 'resposta deveria conter um token JWT');
  assert.equal(body.professional.email, 'camila@nailflow.com');
});

test('endpoint autenticado aceita o token retornado pelo login', async (t) => {
  if (!dbAvailable) {
    t.skip('DATABASE_URL não está acessível.');
    return;
  }

  const loginRes = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'camila@nailflow.com', password: 'senha123' }),
  });
  const { token } = await loginRes.json();

  const res = await fetch(`${baseUrl}/services`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(res.status, 200);
  const services = await res.json();
  assert.ok(Array.isArray(services));
});

test('página pública de disponibilidade não exige autenticação', async (t) => {
  if (!dbAvailable) {
    t.skip('DATABASE_URL não está acessível.');
    return;
  }

  const res = await fetch(`${baseUrl}/public/availability?days=3`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok('businessName' in body);
  assert.ok(Array.isArray(body.days));
});
