import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';

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

const tentativaInvalida = () =>
  fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'brute@force.com', password: 'senha_errada' }),
  });

test('POST /auth/login não bloqueia as 10 primeiras tentativas', async () => {
  for (let i = 0; i < 10; i++) {
    const res = await tentativaInvalida();
    assert.notEqual(
      res.status,
      429,
      `Tentativa ${i + 1} foi bloqueada prematuramente (esperado != 429, obtido ${res.status})`
    );
  }
});

test('POST /auth/login retorna 429 ao exceder o limite de 10 tentativas', async () => {
  const res = await tentativaInvalida();
  assert.equal(res.status, 429, `11ª tentativa deveria retornar 429, obteve ${res.status}`);

  const body = await res.json();
  assert.ok(body.error, 'Resposta deve conter campo "error"');
  assert.match(body.error, /tentativas/i, 'Mensagem de erro deve mencionar tentativas');
});
