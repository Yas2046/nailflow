/**
 * Testes para F-03: campos opcionais (notes em clients, description em services)
 * devem poder ser explicitamente limpos via PUT.
 *
 * Cobre os 3 casos para cada campo:
 *   1. Campo enviado com valor   → atualiza para o novo valor
 *   2. Campo enviado como null   → limpa (salva NULL no banco)
 *   3. Campo ausente no body     → mantém valor existente
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
    if (clientId) await pool.query('DELETE FROM clients WHERE id = $1', [clientId]);
    if (serviceId) await pool.query('DELETE FROM services WHERE id = $1', [serviceId]);
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

// ── Setup: login + criar cliente e serviço base ────────────────────────────

test('setup: login e criação dos registros de teste', async (t) => {
  if (!dbAvailable) { t.skip('banco não disponível'); return; }

  const loginRes = await req('POST', '/auth/login', { email: 'camila@nailflow.com', password: 'senha123' });
  assert.equal(loginRes.status, 200, 'login deve retornar 200');
  authCookie = loginRes.headers.get('set-cookie');

  const c = await req('POST', '/clients', { name: 'Teste F03', phone: '5511999990000', notes: 'Observação inicial' }, authCookie);
  assert.equal(c.status, 201);
  clientId = c.body.id;

  const s = await req('POST', '/services', { name: 'Serviço F03', description: 'Descrição inicial', priceCents: 1000, durationMinutes: 30 }, authCookie);
  assert.equal(s.status, 201);
  serviceId = s.body.id;
});

// ── CLIENTS / notes ────────────────────────────────────────────────────────

test('cliente: atualizar notes com valor atualiza para o novo valor', async (t) => {
  if (!dbAvailable) { t.skip('banco não disponível'); return; }
  const res = await req('PUT', `/clients/${clientId}`, { name: 'Teste F03', phone: '5511999990000', notes: 'Novo conteúdo' }, authCookie);
  assert.equal(res.status, 200);
  assert.equal(res.body.notes, 'Novo conteúdo');
});

test('cliente: enviar notes: null limpa o campo (retorna null)', async (t) => {
  if (!dbAvailable) { t.skip('banco não disponível'); return; }
  // Garante que há uma nota
  await req('PUT', `/clients/${clientId}`, { name: 'Teste F03', phone: '5511999990000', notes: 'Vai ser limpo' }, authCookie);
  // Envia null explicitamente
  const res = await req('PUT', `/clients/${clientId}`, { name: 'Teste F03', phone: '5511999990000', notes: null }, authCookie);
  assert.equal(res.status, 200);
  assert.equal(res.body.notes, null, 'notes deve ser null após enviar null explícito');
});

test('cliente: omitir notes no body mantém o valor existente', async (t) => {
  if (!dbAvailable) { t.skip('banco não disponível'); return; }
  // Garante que há uma nota
  await req('PUT', `/clients/${clientId}`, { name: 'Teste F03', phone: '5511999990000', notes: 'Deve permanecer' }, authCookie);
  // Atualiza só o nome, sem enviar notes
  const res = await req('PUT', `/clients/${clientId}`, { name: 'Teste F03 Editado', phone: '5511999990000' }, authCookie);
  assert.equal(res.status, 200);
  assert.equal(res.body.notes, 'Deve permanecer', 'notes deve ser preservado quando não enviado');
});

// ── SERVICES / description ─────────────────────────────────────────────────

test('serviço: atualizar description com valor atualiza para o novo valor', async (t) => {
  if (!dbAvailable) { t.skip('banco não disponível'); return; }
  const res = await req('PUT', `/services/${serviceId}`, { name: 'Serviço F03', description: 'Nova descrição', priceCents: 1000, durationMinutes: 30, active: true }, authCookie);
  assert.equal(res.status, 200);
  assert.equal(res.body.description, 'Nova descrição');
});

test('serviço: enviar description: null limpa o campo (retorna null)', async (t) => {
  if (!dbAvailable) { t.skip('banco não disponível'); return; }
  // Garante que há descrição
  await req('PUT', `/services/${serviceId}`, { name: 'Serviço F03', description: 'Vai ser limpa', priceCents: 1000, durationMinutes: 30, active: true }, authCookie);
  // Envia null explicitamente
  const res = await req('PUT', `/services/${serviceId}`, { name: 'Serviço F03', description: null, priceCents: 1000, durationMinutes: 30, active: true }, authCookie);
  assert.equal(res.status, 200);
  assert.equal(res.body.description, null, 'description deve ser null após enviar null explícito');
});

test('serviço: omitir description no body mantém o valor existente', async (t) => {
  if (!dbAvailable) { t.skip('banco não disponível'); return; }
  // Garante que há descrição
  await req('PUT', `/services/${serviceId}`, { name: 'Serviço F03', description: 'Deve permanecer', priceCents: 1000, durationMinutes: 30, active: true }, authCookie);
  // Atualiza sem enviar description
  const res = await req('PUT', `/services/${serviceId}`, { name: 'Serviço F03 Editado', priceCents: 1500, durationMinutes: 30, active: true }, authCookie);
  assert.equal(res.status, 200);
  assert.equal(res.body.description, 'Deve permanecer', 'description deve ser preservada quando não enviada');
});
