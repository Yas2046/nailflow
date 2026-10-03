/**
 * Início: bloco "aguardando" do GET /dashboard — reservas da cliente que
 * ainda precisam de ação da profissional (confirmação ou pagamento).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';

let pool;
let server;
let baseUrl;
let dbAvailable = true;
let cookieA;
let cookieB;
let profA;
let profB;
let ids = {};

const PASS = 'senha_teste_aguardando';
const HOUR = 3600000;

before(async () => {
  ({ pool } = await import('../src/config/db.js'));
  try { await pool.query('SELECT 1'); } catch { dbAvailable = false; }
  const { default: app } = await import('../src/server.js');
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  if (!dbAvailable) return;

  const { default: bcrypt } = await import('bcryptjs');
  const hash = await bcrypt.hash(PASS, 10);
  const mk = async (email, slug, phone, name) => (await pool.query(
    `INSERT INTO professionals (name, email, password_hash, phone_whatsapp, business_name, slug)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [name, email, hash, phone, `${name} Studio`, slug]
  )).rows[0].id;
  profA = await mk('aguard_a@nailflow.com', 'teste-aguardando-a', '5531000004001', 'Aguardando A');
  profB = await mk('aguard_b@nailflow.com', 'teste-aguardando-b', '5531000004002', 'Aguardando B');

  const mkService = async (prof) => (await pool.query(
    `INSERT INTO services (professional_id, name, price_cents, duration_minutes) VALUES ($1,'Gel',5000,60) RETURNING id`, [prof])).rows[0].id;
  const mkClient = async (prof, name, phone) => (await pool.query(
    `INSERT INTO clients (professional_id, name, phone) VALUES ($1,$2,$3) RETURNING id`, [prof, name, phone])).rows[0].id;
  const svcA = await mkService(profA);
  const svcB = await mkService(profB);
  const cliA = await mkClient(profA, 'Cliente Aguardando A', '5531988880001');
  const cliB = await mkClient(profB, 'Cliente Aguardando B', '5531988880002');

  const now = Date.now();
  const add = async (prof, svc, cli, label, startsInH, status, expiresInH) => {
    const start = new Date(now + startsInH * HOUR);
    const end = new Date(start.getTime() + HOUR);
    ids[label] = (await pool.query(
      `INSERT INTO appointments (professional_id, client_id, service_id, starts_at, ends_at, status, price_cents_snapshot, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,5000,$7) RETURNING id`,
      [prof, cli, svc, start, end, status, expiresInH === null ? null : new Date(now + expiresInH * HOUR)]
    )).rows[0].id;
  };
  // Profissional A
  await add(profA, svcA, cliA, 'pendenteLonge', 72, 'pendente', 20);        // vence em 20h
  await add(profA, svcA, cliA, 'pagamento',     96, 'aguardando_pagamento', 1.5); // vence em 1h30 (mais urgente)
  await add(profA, svcA, cliA, 'vencida',       120, 'pendente', -1);        // já vencida (ainda não varrida)
  await add(profA, svcA, cliA, 'semValidade',   144, 'pendente', null);      // criada na Agenda: não expira
  await add(profA, svcA, cliA, 'confirmada',    168, 'confirmado', null);
  await add(profA, svcA, cliA, 'passada',       -48, 'pendente', 5);         // horário já passou
  // Profissional B
  await add(profB, svcB, cliB, 'doB',           72, 'pendente', 10);

  cookieA = await login('aguard_a@nailflow.com');
  cookieB = await login('aguard_b@nailflow.com');
});

after(async () => {
  if (dbAvailable) {
    const profs = [profA, profB];
    await pool.query('DELETE FROM appointments WHERE professional_id = ANY($1)', [profs]);
    await pool.query('DELETE FROM clients WHERE professional_id = ANY($1)', [profs]);
    await pool.query('DELETE FROM services WHERE professional_id = ANY($1)', [profs]);
    await pool.query('DELETE FROM professionals WHERE id = ANY($1)', [profs]);
    await pool.end();
  }
  await new Promise((resolve) => server.close(resolve));
});

async function login(email) {
  const res = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASS }),
  });
  assert.equal(res.status, 200);
  return res.headers.get('set-cookie');
}

async function dashboard(cookie) {
  const res = await fetch(`${baseUrl}/dashboard`, { headers: { Cookie: cookie } });
  assert.equal(res.status, 200);
  return res.json();
}

test('aguardando: conta só reservas com validade em curso, ordenadas pelo vencimento', async (t) => {
  if (!dbAvailable) return t.skip('banco indisponível');
  const { aguardando } = await dashboard(cookieA);
  assert.equal(aguardando.confirmacao, 1, 'só a pendente com validade futura');
  assert.equal(aguardando.pagamento, 1);
  assert.deepEqual(aguardando.itens.map((i) => i.id), [ids.pagamento, ids.pendenteLonge]);
  assert.equal(aguardando.proximoVencimento, aguardando.itens[0].expiresAt);
  const item = aguardando.itens[0];
  assert.equal(item.status, 'aguardando_pagamento');
  assert.equal(item.clientName, 'Cliente Aguardando A');
  assert.equal(item.serviceName, 'Gel');
  assert.ok(item.startsAt);
});

test('aguardando: ignora vencida, sem validade, confirmada e horário já passado', async (t) => {
  if (!dbAvailable) return t.skip('banco indisponível');
  const { aguardando } = await dashboard(cookieA);
  const listed = aguardando.itens.map((i) => i.id);
  for (const k of ['vencida', 'semValidade', 'confirmada', 'passada']) {
    assert.ok(!listed.includes(ids[k]), `${k} não deve aparecer`);
  }
});

test('aguardando: isolado por profissional', async (t) => {
  if (!dbAvailable) return t.skip('banco indisponível');
  const b = (await dashboard(cookieB)).aguardando;
  assert.equal(b.confirmacao, 1);
  assert.equal(b.pagamento, 0);
  assert.deepEqual(b.itens.map((i) => i.id), [ids.doB]);
  const a = (await dashboard(cookieA)).aguardando;
  assert.ok(!a.itens.some((i) => i.id === ids.doB));
});

test('aguardando: sem pendências devolve zeros e vencimento nulo', async (t) => {
  if (!dbAvailable) return t.skip('banco indisponível');
  await pool.query(`UPDATE appointments SET status = 'cancelado' WHERE professional_id = $1`, [profB]);
  const b = (await dashboard(cookieB)).aguardando;
  assert.deepEqual(b, { confirmacao: 0, pagamento: 0, proximoVencimento: null, itens: [] });
});
