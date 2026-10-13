// errorHandler: o corpo bruto de um JSON malformado (que o body-parser anexa ao erro) não pode ir para o log.
// Em rotas de suporte esse corpo é texto de mensagem da profissional. Sem banco: usa o body-parser real.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { errorHandler, HttpError } from '../src/middleware/errorHandler.js';

async function post(path, body) {
  const app = express();
  app.use(express.json());
  app.post('/x', (_req, res) => res.json({ ok: true }));
  app.post('/boom', () => { throw new Error('falha qualquer SEGREDO-NA-MENSAGEM'); });
  // Erro no formato do driver pg: a mensagem e o DETAIL podem trazer valores enviados pelo usuário.
  app.post('/pgerr', () => {
    throw Object.assign(new Error('duplicate key value SEGREDO-PG-MENSAGEM'), {
      code: '23505', constraint: 'x_key', table: 'professionals', routine: '_bt_check_unique',
      detail: 'Key (email)=(SEGREDO-PG-DETAIL) already exists.', where: 'SEGREDO-PG-WHERE', hint: 'SEGREDO-PG-HINT',
    });
  });
  app.post('/http', () => { throw new HttpError(418, 'mensagem escrita pelo código'); });
  app.use(errorHandler);
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const logged = [];
  const orig = console.error;
  console.error = (...args) => { logged.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(Object.assign({ message: a?.message, stack: a?.stack }, a)))).join(' ')); };
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body,
    });
    return { status: res.status, logged: logged.join('\n') };
  } finally {
    console.error = orig;
    server.close();
  }
}

test('JSON malformado: 400 e o texto enviado não aparece no log', async () => {
  const r = await post('/x', '{"body": "SEGREDO-DA-MENSAGEM-12345" oops');
  assert.equal(r.status, 400);
  assert.ok(r.logged.length > 0, 'o evento ainda é registrado');
  assert.ok(!r.logged.includes('SEGREDO-DA-MENSAGEM-12345'), 'corpo bruto vazou para o log');
});

test('outros erros são registrados sem a mensagem (500 genérico): tipo e pilha continuam para diagnóstico', async () => {
  const r = await post('/boom', '{}');
  assert.equal(r.status, 500);
  assert.ok(r.logged.includes('Erro na requisição'), 'o evento é registrado');
  assert.ok(r.logged.includes('Error'), 'o tipo do erro é registrado');
  assert.ok(r.logged.includes('at '), 'os quadros da pilha são registrados');
  assert.ok(!r.logged.includes('SEGREDO-NA-MENSAGEM'), 'a mensagem do erro vazou para o log');
});

test('erro no formato do driver pg: só código, constraint, tabela e rotina; nada de mensagem, DETAIL, WHERE ou HINT', async () => {
  const r = await post('/pgerr', '{}');
  assert.equal(r.status, 409);
  for (const k of ['23505', 'x_key', 'professionals', '_bt_check_unique']) assert.ok(r.logged.includes(k), `falta ${k}`);
  for (const secret of ['SEGREDO-PG-MENSAGEM', 'SEGREDO-PG-DETAIL', 'SEGREDO-PG-WHERE', 'SEGREDO-PG-HINT']) {
    assert.ok(!r.logged.includes(secret), `${secret} vazou para o log`);
  }
});

test('HttpError: a mensagem escrita pelo próprio código é registrada e devolvida', async () => {
  const r = await post('/http', '{}');
  assert.equal(r.status, 418);
  assert.ok(r.logged.includes('mensagem escrita pelo código'));
});
