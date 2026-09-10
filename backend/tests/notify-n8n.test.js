/**
 * Testes unitários para notifyN8n — roteamento por evento.
 * Não requerem banco de dados.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { notifyN8n } from '../src/utils/notifyN8n.js';

let originalFetch;
let capturedCalls = [];

before(() => {
  originalFetch = global.fetch;
  global.fetch = async (url, opts) => {
    capturedCalls.push({ url, body: JSON.parse(opts.body) });
    return { ok: true };
  };
});

after(() => {
  global.fetch = originalFetch;
  delete process.env.N8N_WEBHOOK_CONFIRMED_URL;
  delete process.env.N8N_WEBHOOK_CANCELLED_URL;
});

function clearCalls() { capturedCalls = []; }

test('appointment.confirmed envia para N8N_WEBHOOK_CONFIRMED_URL', async () => {
  process.env.N8N_WEBHOOK_CONFIRMED_URL = 'http://n8n-test/confirmed';
  delete process.env.N8N_WEBHOOK_CANCELLED_URL;
  clearCalls();

  notifyN8n('appointment.confirmed', { id: '1' });
  await new Promise((r) => setTimeout(r, 20));

  assert.equal(capturedCalls.length, 1);
  assert.equal(capturedCalls[0].url, 'http://n8n-test/confirmed');
  assert.equal(capturedCalls[0].body.event, 'appointment.confirmed');
});

test('appointment.cancelled envia para N8N_WEBHOOK_CANCELLED_URL', async () => {
  delete process.env.N8N_WEBHOOK_CONFIRMED_URL;
  process.env.N8N_WEBHOOK_CANCELLED_URL = 'http://n8n-test/cancelled';
  clearCalls();

  notifyN8n('appointment.cancelled', { id: '2' });
  await new Promise((r) => setTimeout(r, 20));

  assert.equal(capturedCalls.length, 1);
  assert.equal(capturedCalls[0].url, 'http://n8n-test/cancelled');
  assert.equal(capturedCalls[0].body.event, 'appointment.cancelled');
});

test('confirmed não chama URL de cancelamento quando confirmed está ausente', async () => {
  delete process.env.N8N_WEBHOOK_CONFIRMED_URL;
  process.env.N8N_WEBHOOK_CANCELLED_URL = 'http://n8n-test/cancelled';
  clearCalls();

  notifyN8n('appointment.confirmed', { id: '3' });
  await new Promise((r) => setTimeout(r, 20));

  assert.equal(capturedCalls.length, 0);
});

test('cancelled não chama URL de confirmação quando cancelled está ausente', async () => {
  process.env.N8N_WEBHOOK_CONFIRMED_URL = 'http://n8n-test/confirmed';
  delete process.env.N8N_WEBHOOK_CANCELLED_URL;
  clearCalls();

  notifyN8n('appointment.cancelled', { id: '4' });
  await new Promise((r) => setTimeout(r, 20));

  assert.equal(capturedCalls.length, 0);
});

test('payload contém { event, payload, sentAt }', async () => {
  process.env.N8N_WEBHOOK_CONFIRMED_URL = 'http://n8n-test/confirmed';
  clearCalls();

  notifyN8n('appointment.confirmed', { id: 'abc', clientName: 'Teste' });
  await new Promise((r) => setTimeout(r, 20));

  assert.equal(capturedCalls.length, 1);
  const { body } = capturedCalls[0];
  assert.ok('event' in body, 'deve ter campo event');
  assert.ok('payload' in body, 'deve ter campo payload');
  assert.ok('sentAt' in body, 'deve ter campo sentAt');
  assert.equal(body.payload.id, 'abc');
  assert.equal(body.payload.clientName, 'Teste');
});
