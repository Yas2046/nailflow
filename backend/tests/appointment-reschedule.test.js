/**
 * Ajustes da agenda: remarcar (PUT /appointments/:id com novo startsAt), cadastrar cliente e agendar em seguida,
 * e garantia de que a remarcação manual NÃO dispara aviso de WhatsApp (nenhuma chamada ao n8n).
 *
 * Banco: usa só contas/dados criados por este arquivo e apaga tudo no final (rodar em banco descartável).
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
let serviceA;   // 60 min, 8000 centavos
let clientA;
const realFetch = global.fetch;
let calls = [];

const EMAIL_A = 'reschedule_a@nailflow.com';
const EMAIL_B = 'reschedule_b@nailflow.com';
const PASS = 'senha_teste_reschedule';

before(async () => {
  ({ pool } = await import('../src/config/db.js'));
  try { await pool.query('SELECT 1'); } catch { dbAvailable = false; }
  const { default: app } = await import('../src/server.js');
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  if (!dbAvailable) return;
  await purge();
  const { default: bcrypt } = await import('bcryptjs');
  const hash = await bcrypt.hash(PASS, 10);
  profA = (await pool.query(
    `INSERT INTO professionals (name, email, password_hash, phone_whatsapp, business_name, slug, wa_instance_name)
     VALUES ('Reschedule A', $1, $2, '5531000003001', 'Reschedule A Studio', 'teste-reschedule-a', 'inst-reschedule-a') RETURNING id`,
    [EMAIL_A, hash])).rows[0].id;
  profB = (await pool.query(
    `INSERT INTO professionals (name, email, password_hash, phone_whatsapp, business_name, slug)
     VALUES ('Reschedule B', $1, $2, '5531000003002', 'Reschedule B Studio', 'teste-reschedule-b') RETURNING id`,
    [EMAIL_B, hash])).rows[0].id;
  serviceA = (await pool.query(
    `INSERT INTO services (professional_id, name, price_cents, duration_minutes) VALUES ($1,'Serviço 80',8000,60) RETURNING id`, [profA])).rows[0].id;
  clientA = (await pool.query(
    `INSERT INTO clients (professional_id, name, phone) VALUES ($1,'Cliente Remarca','5531988870001') RETURNING id`, [profA])).rows[0].id;
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
  for (const v of ['CONFIRMED', 'CANCELLED', 'REJECTED', 'MESSAGE', 'PUBLIC_CREATED']) delete process.env[`N8N_WEBHOOK_${v}_URL`];
  if (dbAvailable) {
    await purge();
    await pool.end();
  }
  await new Promise((resolve) => server.close(resolve));
});

async function purge() {
  const { rows } = await pool.query('SELECT id FROM professionals WHERE email = ANY($1)', [[EMAIL_A, EMAIL_B]]);
  const ids = rows.map((r) => r.id);
  if (ids.length === 0) return;
  for (const sql of [
    'DELETE FROM appointments WHERE professional_id = ANY($1)',
    'DELETE FROM conversation_states WHERE professional_id = ANY($1)',
    'DELETE FROM message_history WHERE professional_id = ANY($1)',
    'DELETE FROM blocked_times WHERE professional_id = ANY($1)',
    'DELETE FROM clients WHERE professional_id = ANY($1)',
    'DELETE FROM services WHERE professional_id = ANY($1)',
    'DELETE FROM weekly_availability WHERE professional_id = ANY($1)',
    'DELETE FROM professionals WHERE id = ANY($1)',
  ]) {
    try { await pool.query(sql, [ids]); } catch (err) { console.error('limpeza:', err.message); }
  }
}

async function login(email) {
  const res = await realFetch(`${baseUrl}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASS }),
  });
  assert.equal(res.status, 200);
  return res.headers.get('set-cookie');
}

async function req(method, path, body, cookie = cookieA) {
  const res = await realFetch(`${baseUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  return { status: res.status, body: parsed };
}

// Captura TODO aviso ao n8n (qualquer evento): as URLs de todos os eventos apontam para o mesmo coletor.
function captureN8n() {
  calls = [];
  for (const v of ['CONFIRMED', 'CANCELLED', 'REJECTED', 'MESSAGE', 'PUBLIC_CREATED']) process.env[`N8N_WEBHOOK_${v}_URL`] = `http://n8n-test/${v.toLowerCase()}`;
  global.fetch = async (url, opts) => {
    calls.push({ url, event: JSON.parse(opts.body).event });
    return { ok: true };
  };
}
const settle = () => new Promise((r) => setTimeout(r, 40));

// 2029: futuro distante. 13:00Z = 10:00 em São Paulo (dentro do expediente 08-22).
let dayN = 0;
function startsAtFor(hourUtc = 13) {
  dayN += 1;
  return new Date(Date.UTC(2029, 0, 1) + dayN * 86400000 + hourUtc * 3600000);
}

async function insertAppt({ status = 'pendente', startsAt = startsAtFor(), notes = 'obs original' } = {}) {
  const end = new Date(startsAt.getTime() + 60 * 60000);
  const { rows } = await pool.query(
    `INSERT INTO appointments (professional_id, client_id, service_id, starts_at, ends_at, status, price_cents_snapshot, notes)
     VALUES ($1,$2,$3,$4,$5,$6,8000,$7) RETURNING id`,
    [profA, clientA, serviceA, startsAt, end, status, notes]);
  return rows[0].id;
}
const rowOf = async (id) => (await pool.query(
  `SELECT id, client_id, service_id, status, notes, price_cents_snapshot, starts_at, ends_at, professional_id
   FROM appointments WHERE id = $1`, [id])).rows[0];

for (const status of ['pendente', 'confirmado']) {
  test(`remarcar (${status}): muda só dia e horário; mesmo registro, cliente, serviço, valor, status e observação preservados`, async (t) => {
    if (!dbAvailable) return t.skip('sem banco');
    const id = await insertAppt({ status });
    const before = await rowOf(id);
    const novo = startsAtFor(14); // outro dia, 11:00 em São Paulo
    const r = await req('PUT', `/appointments/${id}`, { startsAt: novo.toISOString() });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const after = await rowOf(id);
    assert.equal(after.id, before.id);
    assert.equal(new Date(after.starts_at).getTime(), novo.getTime());
    assert.equal(new Date(after.ends_at).getTime(), novo.getTime() + 60 * 60000);
    for (const k of ['client_id', 'service_id', 'status', 'notes', 'price_cents_snapshot', 'professional_id']) {
      assert.equal(after[k], before[k], `campo ${k} mudou`);
    }
    const total = (await pool.query('SELECT count(*)::int AS n FROM appointments WHERE client_id = $1 AND professional_id = $2', [clientA, profA])).rows[0].n;
    assert.ok(total >= 1);
  });
}

test('remarcar com a edição completa do modal (cliente, serviço, status e observação reenviados) preserva tudo e não conta como confirmação', async (t) => {
  if (!dbAvailable) return t.skip('sem banco');
  captureN8n();
  const id = await insertAppt({ status: 'confirmado', notes: 'cuidado' });
  const before = await rowOf(id);
  const novo = startsAtFor(15);
  const r = await req('PUT', `/appointments/${id}`, {
    clientId: clientA, serviceId: serviceA, startsAt: novo.toISOString(), status: 'confirmado', notes: 'cuidado',
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  await settle();
  const after = await rowOf(id);
  assert.equal(new Date(after.starts_at).getTime(), novo.getTime());
  assert.equal(after.price_cents_snapshot, before.price_cents_snapshot);
  assert.equal(after.status, 'confirmado');
  assert.deepEqual(calls, [], 'remarcar não pode avisar ninguém');
});

test('remarcar NÃO dispara aviso de WhatsApp (nenhuma chamada ao n8n), para pendente e confirmado', async (t) => {
  if (!dbAvailable) return t.skip('sem banco');
  captureN8n();
  for (const status of ['pendente', 'confirmado']) {
    const id = await insertAppt({ status });
    const r = await req('PUT', `/appointments/${id}`, { startsAt: startsAtFor(16).toISOString() });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.notificationSkipped, undefined);
  }
  await settle();
  assert.deepEqual(calls, [], 'nenhum evento ao n8n na remarcação');
});

test('controle: o aviso continua funcionando nos outros eventos (confirmar por PUT e cancelar) e a captura enxerga as chamadas', async (t) => {
  if (!dbAvailable) return t.skip('sem banco');
  captureN8n();
  const a = await insertAppt({ status: 'pendente' });
  assert.equal((await req('PUT', `/appointments/${a}`, { status: 'confirmado' })).status, 200);
  const b = await insertAppt({ status: 'confirmado' });
  assert.equal((await req('DELETE', `/appointments/${b}`)).status, 204);
  await settle();
  assert.deepEqual(calls.map((c) => c.event).sort(), ['appointment.cancelled', 'appointment.confirmed']);
});

test('conflito: horário ocupado por outro agendamento ou bloqueio pontual: 409, nada muda e nenhum aviso', async (t) => {
  if (!dbAvailable) return t.skip('sem banco');
  captureN8n();
  const ocupado = startsAtFor(13);
  await insertAppt({ status: 'confirmado', startsAt: ocupado });
  const id = await insertAppt({ status: 'pendente' });
  const before = await rowOf(id);

  const c1 = await req('PUT', `/appointments/${id}`, { startsAt: ocupado.toISOString() });
  assert.equal(c1.status, 409);
  assert.equal(c1.body.error, 'Horário não disponível.');
  assert.equal(c1.body.reason, 'appointment_overlap');

  const bloqueado = startsAtFor(14);
  await pool.query('INSERT INTO blocked_times (professional_id, starts_at, ends_at) VALUES ($1,$2,$3)',
    [profA, new Date(bloqueado.getTime() - 30 * 60000), new Date(bloqueado.getTime() + 90 * 60000)]);
  const c2 = await req('PUT', `/appointments/${id}`, { startsAt: bloqueado.toISOString() });
  assert.equal(c2.status, 409);
  assert.equal(c2.body.reason, 'blocked_time');

  const after = await rowOf(id);
  assert.equal(new Date(after.starts_at).getTime(), new Date(before.starts_at).getTime());
  await settle();
  assert.deepEqual(calls, []);
});

test('pode deslocar o agendamento para um horário que se sobrepõe ao próprio horário atual (ele não conflita consigo mesmo)', async (t) => {
  if (!dbAvailable) return t.skip('sem banco');
  const inicio = startsAtFor(13);
  const id = await insertAppt({ status: 'pendente', startsAt: inicio });
  const r = await req('PUT', `/appointments/${id}`, { startsAt: new Date(inicio.getTime() + 30 * 60000).toISOString() });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(new Date((await rowOf(id)).starts_at).getTime(), inicio.getTime() + 30 * 60000);
});

test('outra profissional não consegue remarcar (404) e o agendamento não muda', async (t) => {
  if (!dbAvailable) return t.skip('sem banco');
  const id = await insertAppt({ status: 'pendente' });
  const before = await rowOf(id);
  const r = await req('PUT', `/appointments/${id}`, { startsAt: startsAtFor(14).toISOString() }, cookieB);
  assert.equal(r.status, 404);
  assert.equal(new Date((await rowOf(id)).starts_at).getTime(), new Date(before.starts_at).getTime());
});

test('atendimento concluído continua sem poder ser remarcado (trava existente preservada)', async (t) => {
  if (!dbAvailable) return t.skip('sem banco');
  const id = await insertAppt({ status: 'concluido', startsAt: new Date(Date.UTC(2026, 0, 5, 13)) });
  const r = await req('PUT', `/appointments/${id}`, { startsAt: startsAtFor(14).toISOString() });
  assert.equal(r.status, 409);
  assert.equal(r.body.reason, 'locked_field');
});

test('cadastrar cliente e agendar em seguida: a cliente criada por POST /clients já é aceita no agendamento; telefone repetido ou inválido é recusado', async (t) => {
  if (!dbAvailable) return t.skip('sem banco');
  const novo = await req('POST', '/clients', { name: 'Cliente Nova Agenda', phone: '5531988870055', notes: null });
  assert.equal(novo.status, 201, JSON.stringify(novo.body));
  assert.ok(novo.body.id && novo.body.name === 'Cliente Nova Agenda' && novo.body.phone);
  const ag = await req('POST', '/appointments', { clientId: novo.body.id, serviceId: serviceA, startsAt: startsAtFor(13).toISOString(), status: 'pendente', notes: null });
  assert.equal(ag.status, 201, JSON.stringify(ag.body));
  assert.equal(ag.body.clientId, novo.body.id);
  assert.equal((await req('POST', '/clients', { name: 'Repetida', phone: '5531988870055' })).status, 409);
  assert.equal((await req('POST', '/clients', { name: 'Invalida', phone: '123' })).status, 400);
  assert.equal((await req('POST', '/clients', { name: 'Sem telefone' })).status, 400);
});

// ── disponibilidade: limita os canais de cliente; a agenda interna aceita exceções, sem aceitar conflito ────────────
const SLUG_A = 'teste-reschedule-a';
const weekdayOf = (d) => new Date(d.getTime() - 3 * 3600000).getUTCDay(); // dia da semana em São Paulo (UTC-3)

async function publicPost(startsAt, phone, xff) {
  return realFetch(`${baseUrl}/public/${SLUG_A}/appointments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': xff },
    body: JSON.stringify({ serviceId: serviceA, startsAt: startsAt.toISOString(), clientName: 'Cliente Pública', clientPhone: phone }),
  });
}

test('agenda interna cria e remarca FORA da disponibilidade (madrugada, dia de folga, almoço) e segue recusando conflito e bloqueio', async (t) => {
  if (!dbAvailable) return t.skip('sem banco');
  captureN8n();
  // madrugada: 05:00Z = 02:00 em São Paulo (expediente 08–22)
  const madrugada = startsAtFor(5);
  const c1 = await req('POST', '/appointments', { clientId: clientA, serviceId: serviceA, startsAt: madrugada.toISOString(), status: 'pendente', notes: null });
  assert.equal(c1.status, 201, JSON.stringify(c1.body));
  // conflito com ele mesmo (mesmo horário) continua recusado
  const dup = await req('POST', '/appointments', { clientId: clientA, serviceId: serviceA, startsAt: madrugada.toISOString(), status: 'pendente', notes: null });
  assert.equal(dup.status, 409);
  assert.equal(dup.body.reason, 'appointment_overlap');
  // dia de folga
  const folga = startsAtFor(13);
  await pool.query('UPDATE weekly_availability SET is_working = false WHERE professional_id = $1 AND weekday = $2', [profA, weekdayOf(folga)]);
  try {
    const c2 = await req('POST', '/appointments', { clientId: clientA, serviceId: serviceA, startsAt: folga.toISOString(), status: 'pendente', notes: null });
    assert.equal(c2.status, 201, JSON.stringify(c2.body));
    // remarcar para outro horário do mesmo dia de folga também é aceito
    const mv = await req('PUT', `/appointments/${c2.body.id}`, { startsAt: new Date(folga.getTime() + 3 * 3600000).toISOString() });
    assert.equal(mv.status, 200, JSON.stringify(mv.body));
  } finally {
    await pool.query('UPDATE weekly_availability SET is_working = true WHERE professional_id = $1 AND weekday = $2', [profA, weekdayOf(folga)]);
  }
  // almoço
  const almoco = startsAtFor(13);
  await pool.query(`UPDATE weekly_availability SET break_start = '09:30', break_end = '10:30' WHERE professional_id = $1 AND weekday = $2`, [profA, weekdayOf(almoco)]);
  try {
    const c3 = await req('POST', '/appointments', { clientId: clientA, serviceId: serviceA, startsAt: almoco.toISOString(), status: 'pendente', notes: null });
    assert.equal(c3.status, 201, JSON.stringify(c3.body));
  } finally {
    await pool.query('UPDATE weekly_availability SET break_start = NULL, break_end = NULL WHERE professional_id = $1 AND weekday = $2', [profA, weekdayOf(almoco)]);
  }
  // bloqueio pontual continua valendo
  const bl = startsAtFor(14);
  await pool.query('INSERT INTO blocked_times (professional_id, starts_at, ends_at) VALUES ($1,$2,$3)', [profA, bl, new Date(bl.getTime() + 3600000)]);
  const c4 = await req('POST', '/appointments', { clientId: clientA, serviceId: serviceA, startsAt: bl.toISOString(), status: 'pendente', notes: null });
  assert.equal(c4.status, 409);
  assert.equal(c4.body.reason, 'blocked_time');
  await settle();
  assert.deepEqual(calls, [], 'criar e remarcar pelo painel não avisam ninguém');
});

test('canais de cliente continuam limitados pela disponibilidade: o mesmo horário que a agenda interna aceita é recusado na página pública e na checagem usada pelo bot', async (t) => {
  if (!dbAvailable) return t.skip('sem banco');
  const { checkSlotAvailability } = await import('../src/utils/availability.js');
  const madrugada = startsAtFor(5); // 02:00 em São Paulo
  // função usada por WhatsApp/bot e página pública (sem a opção): recusa
  const cliente = await checkSlotAvailability(profA, serviceA, madrugada, null, { notBefore: new Date() });
  assert.equal(cliente.available, false);
  assert.equal(cliente.reason, 'outside_working_hours');
  // a opção é só da agenda interna
  const interna = await checkSlotAvailability(profA, serviceA, madrugada, null, { ignoreSchedule: true });
  assert.equal(interna.available, true);
  // página pública (HTTP): recusa pelo mesmo motivo
  const pub = await publicPost(madrugada, '5531988870088', '10.7.7.1');
  assert.equal(pub.status, 409);
  assert.equal((await pub.json()).reason, 'outside_working_hours');
  // dia de folga e almoço também seguem recusados para a cliente
  const folga = startsAtFor(13);
  await pool.query('UPDATE weekly_availability SET is_working = false WHERE professional_id = $1 AND weekday = $2', [profA, weekdayOf(folga)]);
  try {
    assert.equal((await checkSlotAvailability(profA, serviceA, folga, null, { notBefore: new Date() })).reason, 'outside_working_hours');
    assert.equal((await publicPost(folga, '5531988870089', '10.7.7.2')).status, 409);
  } finally {
    await pool.query('UPDATE weekly_availability SET is_working = true WHERE professional_id = $1 AND weekday = $2', [profA, weekdayOf(folga)]);
  }
  const almoco = startsAtFor(13);
  await pool.query(`UPDATE weekly_availability SET break_start = '09:30', break_end = '10:30' WHERE professional_id = $1 AND weekday = $2`, [profA, weekdayOf(almoco)]);
  try {
    assert.equal((await checkSlotAvailability(profA, serviceA, almoco, null, { notBefore: new Date() })).reason, 'lunch_break');
  } finally {
    await pool.query('UPDATE weekly_availability SET break_start = NULL, break_end = NULL WHERE professional_id = $1 AND weekday = $2', [profA, weekdayOf(almoco)]);
  }
  // dentro da disponibilidade a página pública segue aceitando (controle: o teste enxerga um 201)
  const ok = await publicPost(startsAtFor(13), '5531988870090', '10.7.7.3');
  assert.equal(ok.status, 201, await ok.text());
});
