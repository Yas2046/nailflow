import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'segredo-de-teste';
// Em memória / sem necessidade de Postgres para estes testes específicos —
// eles cobrem apenas rotas que não tocam o banco (healthcheck e autenticação).

let server;
let baseUrl;

before(async () => {
  const { default: app } = await import('../src/server.js');
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

test('GET /health responde 200 e status ok', async () => {
  const res = await fetch(`${baseUrl}/health`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, 'ok');
});

test('GET /appointments sem token retorna 401', async () => {
  const res = await fetch(`${baseUrl}/appointments`);
  assert.equal(res.status, 401);
});

test('GET /clients sem token retorna 401', async () => {
  const res = await fetch(`${baseUrl}/clients`);
  assert.equal(res.status, 401);
});

test('GET /dashboard sem token retorna 401', async () => {
  const res = await fetch(`${baseUrl}/dashboard`);
  assert.equal(res.status, 401);
});

test('rota inexistente retorna 404', async () => {
  const res = await fetch(`${baseUrl}/rota-que-nao-existe`);
  assert.equal(res.status, 404);
});
