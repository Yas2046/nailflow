// errorHandler: o corpo bruto de um JSON malformado (que o body-parser anexa ao erro) não pode ir para o log.
// Em rotas de suporte esse corpo é texto de mensagem da profissional. Sem banco: usa o body-parser real.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { errorHandler } from '../src/middleware/errorHandler.js';

async function post(path, body) {
  const app = express();
  app.use(express.json());
  app.post('/x', (_req, res) => res.json({ ok: true }));
  app.post('/boom', () => { throw new Error('falha qualquer'); });
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

test('outros erros continuam sendo registrados por inteiro (500 genérico)', async () => {
  const r = await post('/boom', '{}');
  assert.equal(r.status, 500);
  assert.ok(r.logged.includes('falha qualquer'));
});
