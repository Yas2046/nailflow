/**
 * Fase 1A — pré-agendamento: pendente ("Aguardando confirmação") →
 * confirmado / cancelado (rejeitado), com mensagens só na mudança real.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.BOT_API_KEY = 'chave-bot-teste-1a';

let pool;
let server;
let baseUrl;
let dbAvailable = true;
let cookieA;
let cookieB;
let profA;
let profB;
let serviceA;
let clientA;
const realFetch = global.fetch;
let calls = [];

const EMAIL_A = 'confirm_1a_a@nailflow.com';
const EMAIL_B = 'confirm_1a_b@nailflow.com';
const PASS = 'senha_teste_1a';
const SLUG_A = 'teste-confirm-1a-a';
const INST_A = 'inst-confirm-1a-a';

before(async () => {
  ({ pool } = await import('../src/config/db.js'));
  try { await pool.query('SELECT 1'); } catch { dbAvailable = false; }
  const { default: app } = await import('../src/server.js');
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  if (!dbAvailable) return;

  const { default: bcrypt } = await import('bcryptjs');
  const hash = await bcrypt.hash(PASS, 10);
  const a = await pool.query(
    `INSERT INTO professionals (name, email, password_hash, phone_whatsapp, business_name, slug, wa_instance_name)
     VALUES ('Confirm A', $1, $2, '5531000001001', 'Confirm A Studio', $3, $4) RETURNING id`,
    [EMAIL_A, hash, SLUG_A, INST_A]
  );
  profA = a.rows[0].id;
  const b = await pool.query(
    `INSERT INTO professionals (name, email, password_hash, phone_whatsapp, business_name, slug)
     VALUES ('Confirm B', $1, $2, '5531000001002', 'Confirm B Studio', 'teste-confirm-1a-b') RETURNING id`,
    [EMAIL_B, hash]
  );
  profB = b.rows[0].id;
  const s = await pool.query(
    `INSERT INTO services (professional_id, name, price_cents, duration_minutes) VALUES ($1,'Manicure 1A',5000,10) RETURNING id`, [profA]);
  serviceA = s.rows[0].id;
  const c = await pool.query(
    `INSERT INTO clients (professional_id, name, phone) VALUES ($1,'Maria Cliente','5531988887777') RETURNING id`, [profA]);
  clientA = c.rows[0].id;
  for (let wd = 0; wd <= 6; wd++) {
    await pool.query(
      `INSERT INTO weekly_availability (professional_id, weekday, is_working, start_time, end_time)
       VALUES ($1,$2,true,'08:00','22:00') ON CONFLICT (professional_id, weekday) DO NOTHING`, [profA, wd]);
  }

  cookieA = await login(EMAIL_A);
  cookieB = await login(EMAIL_B);
});

after(async () => {
  global.fetch = realFetch;
  delete process.env.N8N_WEBHOOK_CONFIRMED_URL;
  delete process.env.N8N_WEBHOOK_REJECTED_URL;
  if (dbAvailable) {
    await pool.query('DELETE FROM appointments WHERE professional_id = ANY($1)', [[profA, profB]]);
    await pool.query('DELETE FROM clients WHERE professional_id = ANY($1)', [[profA, profB]]);
    await pool.query('DELETE FROM services WHERE professional_id = ANY($1)', [[profA, profB]]);
    await pool.query('DELETE FROM weekly_availability WHERE professional_id = ANY($1)', [[profA, profB]]);
    await pool.query('DELETE FROM professionals WHERE id = ANY($1)', [[profA, profB]]);
    await pool.end();
  }
  await new Promise((resolve) => server.close(resolve));
});

async function login(email) {
  const res = await realFetch(`${baseUrl}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASS }),
  });
  assert.equal(res.status, 200);
  return res.headers.get('set-cookie');
}

async function req(method, path, body, cookie, headers = {}) {
  const res = await realFetch(`${baseUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

function captureN8n() {
  calls = [];
  process.env.N8N_WEBHOOK_CONFIRMED_URL = 'http://n8n-test/confirmed';
  process.env.N8N_WEBHOOK_REJECTED_URL = 'http://n8n-test/rejected';
  global.fetch = async (url, opts) => {
    calls.push({ url, body: JSON.parse(opts.body) });
    return { ok: true };
  };
}
const settle = () => new Promise((r) => setTimeout(r, 30));

let dayOffset = 400;
async function insertAppt({ status = 'pendente', source = 'public', prof = profA } = {}) {
  dayOffset += 1;
  const start = new Date(Date.UTC(2028, 0, 1) + dayOffset * 86400000 + 15 * 3600000);
  const end = new Date(start.getTime() + 10 * 60000);
  const { rows } = await pool.query(
    `INSERT INTO appointments (professional_id, client_id, service_id, starts_at, ends_at, status, source, price_cents_snapshot)
     VALUES ($1,$2,$3,$4,$5,$6,$7,5000) RETURNING id`,
    [prof, clientA, serviceA, start, end, status, source]
  );
  return rows[0].id;
}
const statusOf = async (id) =>
  (await pool.query('SELECT status, cancel_reason FROM appointments WHERE id = $1', [id])).rows[0];

test('criação pública fica pendente e a resposta continua pendente', async (t) => {
  if (!dbAvailable) return t.skip('sem banco');
  const avail = await req('GET', `/public/${SLUG_A}/availability?days=30&serviceId=${serviceA}`);
  const day = avail.body.days.find((d) => d.slots.length > 0);
  assert.ok(day);
  const res = await req('POST', `/public/${SLUG_A}/appointments`, {
    serviceId: serviceA, startsAt: day.slots[0], clientName: 'Nova Cliente', clientPhone: '5531977776666',
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.status, 'pendente');
  const row = (await pool.query('SELECT status, source FROM appointments WHERE id = $1', [res.body.id])).rows[0];
  assert.deepEqual(row, { status: 'pendente', source: 'public' });
});

test('confirmar pendente → confirmado notifica uma vez; repetir é idempotente e sem mensagem', async (t) => {
  if (!dbAvailable) return t.skip('sem banco');
  const id = await insertAppt();
  captureN8n();
  const r1 = await req('POST', `/appointments/${id}/confirm`, undefined, cookieA);
  assert.equal(r1.status, 200);
  assert.equal(r1.body.status, 'confirmado');
  assert.equal(r1.body.changed, true);
  await settle();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.event, 'appointment.confirmed');
  assert.equal(calls[0].body.payload.waInstance, INST_A);

  const r2 = await req('POST', `/appointments/${id}/confirm`, undefined, cookieA);
  assert.equal(r2.status, 200);
  assert.equal(r2.body.changed, false);
  const r3 = await req('PUT', `/appointments/${id}`, { status: 'confirmado' }, cookieA);
  assert.equal(r3.status, 200);
  await settle();
  assert.equal(calls.length, 1, 'confirmação repetida não pode reenviar mensagem');
});

test('PUT status=confirmado a partir de pendente notifica; a partir de cancelado é 409', async (t) => {
  if (!dbAvailable) return t.skip('sem banco');
  const id = await insertAppt();
  captureN8n();
  const ok = await req('PUT', `/appointments/${id}`, { status: 'confirmado' }, cookieA);
  assert.equal(ok.status, 200);
  await settle();
  assert.equal(calls.length, 1);

  const cancelled = await insertAppt({ status: 'cancelado' });
  calls = [];
  const bad = await req('PUT', `/appointments/${cancelled}`, { status: 'confirmado' }, cookieA);
  assert.equal(bad.status, 409);
  await settle();
  assert.equal(calls.length, 0);
  assert.equal((await statusOf(cancelled)).status, 'cancelado');
});

test('rejeitar pendente → cancelado (rejected) e avisa a cliente quando veio da página pública', async (t) => {
  if (!dbAvailable) return t.skip('sem banco');
  const id = await insertAppt({ source: 'public' });
  captureN8n();
  const r = await req('POST', `/appointments/${id}/reject`, undefined, cookieA);
  assert.equal(r.status, 200);
  assert.equal(r.body.status, 'cancelado');
  assert.deepEqual(await statusOf(id), { status: 'cancelado', cancel_reason: 'rejected' });
  await settle();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.event, 'appointment.rejected');
  assert.equal(calls[0].body.payload.clientPhone, '5531988887777');
  assert.equal(calls[0].body.payload.waInstance, INST_A);
  assert.match(calls[0].body.payload.message, /Manicure 1A/);

  const again = await req('POST', `/appointments/${id}/reject`, undefined, cookieA);
  assert.equal(again.status, 200);
  assert.equal(again.body.changed, false);
  await settle();
  assert.equal(calls.length, 1, 'rejeição repetida não reenvia mensagem');
});

test('rejeitar agendamento originado pelo painel não envia mensagem à cliente', async (t) => {
  if (!dbAvailable) return t.skip('sem banco');
  const id = await insertAppt({ source: null });
  captureN8n();
  const r = await req('POST', `/appointments/${id}/reject`, undefined, cookieA);
  assert.equal(r.status, 200);
  await settle();
  assert.equal(calls.length, 0);
});

test('rejeitar agendamento já confirmado (ou concluído) é 409 e não muda nada', async (t) => {
  if (!dbAvailable) return t.skip('sem banco');
  captureN8n();
  for (const st of ['confirmado', 'concluido']) {
    const id = await insertAppt({ status: st });
    const r = await req('POST', `/appointments/${id}/reject`, undefined, cookieA);
    assert.equal(r.status, 409, st);
    assert.equal((await statusOf(id)).status, st);
  }
  await settle();
  assert.equal(calls.length, 0);
});

test('confirmar cancelado/concluído é 409', async (t) => {
  if (!dbAvailable) return t.skip('sem banco');
  captureN8n();
  for (const st of ['cancelado', 'concluido', 'nao_compareceu']) {
    const id = await insertAppt({ status: st });
    const r = await req('POST', `/appointments/${id}/confirm`, undefined, cookieA);
    assert.equal(r.status, 409, st);
  }
  await settle();
  assert.equal(calls.length, 0);
});

test('isolamento: outra profissional não confirma nem rejeita (404) e nada muda', async (t) => {
  if (!dbAvailable) return t.skip('sem banco');
  const id = await insertAppt();
  captureN8n();
  assert.equal((await req('POST', `/appointments/${id}/confirm`, undefined, cookieB)).status, 404);
  assert.equal((await req('POST', `/appointments/${id}/reject`, undefined, cookieB)).status, 404);
  assert.equal((await req('PUT', `/appointments/${id}`, { status: 'confirmado' }, cookieB)).status, 404);
  assert.equal((await statusOf(id)).status, 'pendente');
  await settle();
  assert.equal(calls.length, 0);
});

test('cliente (sem login) não consegue confirmar nem rejeitar', async (t) => {
  if (!dbAvailable) return t.skip('sem banco');
  const id = await insertAppt();
  assert.equal((await req('POST', `/appointments/${id}/confirm`)).status, 401);
  assert.equal((await req('POST', `/appointments/${id}/reject`)).status, 401);
  assert.equal((await req('PUT', `/appointments/${id}`, { status: 'confirmado' })).status, 401);
  // a página pública ignora qualquer status vindo no corpo
  const avail = await req('GET', `/public/${SLUG_A}/availability?days=30&serviceId=${serviceA}`);
  const day = avail.body.days.filter((d) => d.slots.length > 0).pop();
  const res = await req('POST', `/public/${SLUG_A}/appointments`, {
    serviceId: serviceA, startsAt: day.slots[0], clientName: 'Esperta', clientPhone: '5531966665555', status: 'confirmado',
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.status, 'pendente');
  assert.equal((await statusOf(id)).status, 'pendente');
});

test('lembrete de amanhã só inclui confirmado', async (t) => {
  if (!dbAvailable) return t.skip('sem banco');
  const mk = async (status, offsetMin) => {
    const start = new Date(Date.now() + offsetMin * 60000);
    const { rows } = await pool.query(
      `INSERT INTO appointments (professional_id, client_id, service_id, starts_at, ends_at, status, price_cents_snapshot)
       VALUES ($1,$2,$3,$4,$5,$6,5000) RETURNING id`,
      [profA, clientA, serviceA, start, new Date(start.getTime() + 10 * 60000), status]
    );
    return rows[0].id;
  };
  const confirmedId = await mk('confirmado', 24 * 60 - 20);
  const pendingId = await mk('pendente', 24 * 60 + 20);
  const res = await req('GET', `/bot/appointments-tomorrow?instance=${INST_A}`, undefined, undefined,
    { Authorization: `Bearer ${process.env.BOT_API_KEY}` });
  assert.equal(res.status, 200);
  const ids = res.body.map((r) => r.id);
  assert.ok(ids.includes(confirmedId));
  assert.ok(!ids.includes(pendingId));
});
