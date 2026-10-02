/**
 * Fases 1B/2 (backend): modo de confirmação, reserva com validade (expires_at),
 * expiração atômica e mensagem imediata de "solicitação recebida".
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
let serviceA;
let clientA;
let clientB;
let bookingRules;
const realFetch = global.fetch;
let calls = [];

const EMAIL_A = 'booking_rules_a@nailflow.com';
const EMAIL_B = 'booking_rules_b@nailflow.com';
const PASS = 'senha_teste_rules';
const SLUG_A = 'teste-booking-rules-a';

before(async () => {
  ({ pool } = await import('../src/config/db.js'));
  try { await pool.query('SELECT 1'); } catch { dbAvailable = false; }
  bookingRules = await import('../src/utils/bookingRules.js');
  const { default: app } = await import('../src/server.js');
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  if (!dbAvailable) return;

  const { default: bcrypt } = await import('bcryptjs');
  const hash = await bcrypt.hash(PASS, 10);
  const mk = async (email, slug, phone, name) => (await pool.query(
    `INSERT INTO professionals (name, email, password_hash, phone_whatsapp, business_name, slug, wa_instance_name)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [name, email, hash, phone, `${name} Studio`, slug, `inst-${slug}`]
  )).rows[0].id;
  profA = await mk(EMAIL_A, SLUG_A, '5531000002001', 'Rules A');
  profB = await mk(EMAIL_B, 'teste-booking-rules-b', '5531000002002', 'Rules B');
  serviceA = (await pool.query(
    `INSERT INTO services (professional_id, name, price_cents, duration_minutes) VALUES ($1,'Manicure Rules',5000,30) RETURNING id`, [profA])).rows[0].id;
  clientA = (await pool.query(
    `INSERT INTO clients (professional_id, name, phone) VALUES ($1,'Cliente A','5531988880001') RETURNING id`, [profA])).rows[0].id;
  const svcB = (await pool.query(
    `INSERT INTO services (professional_id, name, price_cents, duration_minutes) VALUES ($1,'Serviço B',5000,30) RETURNING id`, [profB])).rows[0].id;
  clientB = (await pool.query(
    `INSERT INTO clients (professional_id, name, phone) VALUES ($1,'Cliente B','5531988880002') RETURNING id`, [profB])).rows[0].id;
  void svcB;
  for (const p of [profA, profB]) {
    for (let wd = 0; wd <= 6; wd++) {
      await pool.query(
        `INSERT INTO weekly_availability (professional_id, weekday, is_working, start_time, end_time)
         VALUES ($1,$2,true,'08:00','22:00') ON CONFLICT (professional_id, weekday) DO NOTHING`, [p, wd]);
    }
  }
  cookieA = await login(EMAIL_A);
  cookieB = await login(EMAIL_B);
});

after(async () => {
  global.fetch = realFetch;
  for (const k of ['MESSAGE', 'CONFIRMED', 'REJECTED', 'PUBLIC_CREATED']) delete process.env[`N8N_WEBHOOK_${k}_URL`];
  if (dbAvailable) {
    const ids = [profA, profB];
    await pool.query('DELETE FROM appointments WHERE professional_id = ANY($1)', [ids]);
    await pool.query('DELETE FROM clients WHERE professional_id = ANY($1)', [ids]);
    await pool.query('DELETE FROM services WHERE professional_id = ANY($1)', [ids]);
    await pool.query('DELETE FROM weekly_availability WHERE professional_id = ANY($1)', [ids]);
    await pool.query('DELETE FROM professionals WHERE id = ANY($1)', [ids]);
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

let ipSeq = 0;
async function req(method, path, body, cookie) {
  ipSeq += 1;
  const res = await realFetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-For': `10.7.${Math.floor(ipSeq / 250)}.${(ipSeq % 250) + 1}`,
      ...(cookie ? { Cookie: cookie } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

function captureN8n() {
  calls = [];
  process.env.N8N_WEBHOOK_MESSAGE_URL = 'http://n8n-test/message';
  process.env.N8N_WEBHOOK_CONFIRMED_URL = 'http://n8n-test/confirmed';
  process.env.N8N_WEBHOOK_REJECTED_URL = 'http://n8n-test/rejected';
  process.env.N8N_WEBHOOK_PUBLIC_CREATED_URL = 'http://n8n-test/public-created';
  global.fetch = async (url, opts) => {
    calls.push(JSON.parse(opts.body));
    return { ok: true };
  };
}
const events = () => calls.map((c) => c.event);
const settle = () => new Promise((r) => setTimeout(r, 40));

async function setConfig(mode, deposit = false) {
  await pool.query(
    `UPDATE professionals SET confirmation_mode = $2, deposit_required = $3,
       deposit_type = CASE WHEN $3 THEN 'percentage' END, deposit_value = CASE WHEN $3 THEN 50 END,
       pix_key = CASE WHEN $3 THEN 'pix@teste.com' END WHERE id = $1`,
    [profA, mode, deposit]
  );
}

// a rota pública normaliza o telefone (remove o 9 após o DDD)
const normalizePhone = (p) => p.replace(/^(\d{4})9(\d{8})$/, "$1$2");
let phoneSeq = 0;
async function publicBook() {
  phoneSeq += 1;
  const phone = `55319${String(70000000 + phoneSeq)}`;
  const avail = await req('GET', `/public/${SLUG_A}/availability?days=30&serviceId=${serviceA}`);
  const day = avail.body.days.find((d) => d.slots.length > 0);
  assert.ok(day, 'sem horário livre');
  const res = await req('POST', `/public/${SLUG_A}/appointments`, {
    serviceId: serviceA, startsAt: day.slots[0], clientName: 'Maria Teste Silva', clientPhone: phone,
  });
  return { res, phone, startsAt: day.slots[0] };
}
const rowOf = async (id) => (await pool.query(
  'SELECT status, cancel_reason, source, expires_at FROM appointments WHERE id = $1', [id])).rows[0];

// data futura fixa por teste, em horários distintos, para inserção direta
let slotSeq = 0;
async function insertDirect({ status = 'pendente', expiresAtSql = "now() - interval '1 minute'", source = 'public', prof = profA, client = clientA, service = serviceA } = {}) {
  slotSeq += 1;
  const start = new Date(Date.UTC(2029, 0, 1) + slotSeq * 3600000 * 3 + 15 * 3600000);
  const { rows } = await pool.query(
    `INSERT INTO appointments (professional_id, client_id, service_id, starts_at, ends_at, status, source, expires_at, price_cents_snapshot)
     VALUES ($1,$2,$3,$4,$5,$6,$7, ${expiresAtSql}, 5000) RETURNING id, starts_at`,
    [prof, client, service, start, new Date(start.getTime() + 30 * 60000), status, source]
  );
  return rows[0];
}

test('initialBookingState: regras de modo de confirmação e sinal', () => {
  const now = new Date('2030-01-01T12:00:00Z');
  const { initialBookingState } = bookingRules;
  assert.deepEqual(initialBookingState({ confirmation_mode: 'manual', deposit_required: false }, now),
    { status: 'pendente', expiresAt: new Date('2030-01-02T12:00:00Z') });
  assert.deepEqual(initialBookingState({ confirmation_mode: 'automatic', deposit_required: false }, now),
    { status: 'confirmado', expiresAt: null });
  assert.deepEqual(initialBookingState({ confirmation_mode: 'automatic', deposit_required: true }, now, 1500),
    { status: 'aguardando_pagamento', expiresAt: new Date('2030-01-01T14:00:00Z') });
  assert.deepEqual(initialBookingState({ confirmation_mode: 'manual', deposit_required: true }, now, 1500),
    { status: 'pendente', expiresAt: new Date('2030-01-02T12:00:00Z') });
  // sinal zerado (serviço sem valor): não há o que cobrar, confirma direto
  assert.deepEqual(initialBookingState({ confirmation_mode: 'automatic', deposit_required: true }, now, 0),
    { status: 'confirmado', expiresAt: null });
});

test('padrões do banco: manual, sem sinal; agendamentos antigos sem validade', async (t) => {
  if (!dbAvailable) return t.skip('sem banco');
  const { rows } = await pool.query(
    'SELECT confirmation_mode, deposit_required, deposit_type, deposit_value FROM professionals WHERE id = $1', [profB]);
  assert.deepEqual(rows[0], { confirmation_mode: 'manual', deposit_required: false, deposit_type: null, deposit_value: null });
  await assert.rejects(pool.query("UPDATE professionals SET confirmation_mode = 'x' WHERE id = $1", [profB]));
  await assert.rejects(pool.query("UPDATE professionals SET deposit_type = 'percentage', deposit_value = 150 WHERE id = $1", [profB]));
  await assert.rejects(pool.query("UPDATE professionals SET deposit_type = 'percent', deposit_value = 50 WHERE id = $1", [profB]));
});

test('manual + sem sinal: cria pendente (validade 24h) e envia "solicitação recebida" imediatamente', async (t) => {
  if (!dbAvailable) return t.skip('sem banco');
  await setConfig('manual', false);
  captureN8n();
  const { res, phone } = await publicBook();
  assert.equal(res.status, 201);
  assert.equal(res.body.status, 'pendente');
  const row = await rowOf(res.body.id);
  assert.equal(row.status, 'pendente');
  assert.equal(row.source, 'public');
  const diffH = (new Date(row.expires_at) - Date.now()) / 3600000;
  assert.ok(diffH > 23.9 && diffH <= 24.01, `validade ~24h, veio ${diffH}`);
  await settle();
  assert.deepEqual(events().sort(), ['appointment.public_created', 'message.send']);
  const msg = calls.find((c) => c.event === 'message.send').payload;
  assert.equal(msg.clientPhone, normalizePhone(phone));
  assert.equal(msg.waInstance, `inst-${SLUG_A}`);
  assert.equal(msg.kind, 'appointment_requested');
  assert.match(msg.text, /Recebemos sua solicitação/);
  assert.match(msg.text, /aguardando a confirmação/);
  assert.match(msg.text, /Manicure Rules/);
});

test('automático + sem sinal: cria confirmado, sem validade, e envia a confirmação (não "solicitação")', async (t) => {
  if (!dbAvailable) return t.skip('sem banco');
  await setConfig('automatic', false);
  captureN8n();
  const { res, phone } = await publicBook();
  assert.equal(res.status, 201);
  assert.equal(res.body.status, 'confirmado');
  const row = await rowOf(res.body.id);
  assert.equal(row.status, 'confirmado');
  assert.equal(row.expires_at, null);
  assert.equal(row.source, 'public');
  await settle();
  assert.deepEqual(events().sort(), ['appointment.confirmed', 'appointment.public_created']);
  assert.equal(calls.find((c) => c.event === 'appointment.confirmed').payload.clientPhone, normalizePhone(phone));
});

test('automático + sinal: cria aguardando_pagamento (validade 2h), sem mensagem de confirmação', async (t) => {
  if (!dbAvailable) return t.skip('sem banco');
  await setConfig('automatic', true);
  captureN8n();
  const { res } = await publicBook();
  assert.equal(res.status, 201);
  assert.equal(res.body.status, 'aguardando_pagamento');
  const row = await rowOf(res.body.id);
  assert.equal(row.status, 'aguardando_pagamento');
  const diffH = (new Date(row.expires_at) - Date.now()) / 3600000;
  assert.ok(diffH > 1.9 && diffH <= 2.01, `validade ~2h, veio ${diffH}`);
  await settle();
  // com sinal a cliente recebe as instruções de pagamento (não a confirmação)
  assert.deepEqual(events().sort(), ['appointment.public_created', 'message.send']);
  assert.equal(calls.find((x) => x.event === 'message.send').payload.kind, 'payment_instructions');
  await setConfig('manual', false);
});

test('manual + sinal: fica pendente (fluxo de pagamento ainda não implementado)', async (t) => {
  if (!dbAvailable) return t.skip('sem banco');
  await setConfig('manual', true);
  captureN8n();
  const { res } = await publicBook();
  assert.equal(res.status, 201);
  assert.equal(res.body.status, 'pendente');
  await setConfig('manual', false);
});

test('Agenda interna: continua pendente, sem validade, sem origem e sem mensagem automática', async (t) => {
  if (!dbAvailable) return t.skip('sem banco');
  await setConfig('automatic', false); // mesmo em modo automático a Agenda não muda
  captureN8n();
  const res = await req('POST', '/appointments', {
    clientId: clientA, serviceId: serviceA, startsAt: '2029-06-10T14:00:00.000Z',
  }, cookieA);
  assert.equal(res.status, 201);
  assert.equal(res.body.status, 'pendente');
  const row = await rowOf(res.body.id);
  assert.equal(row.expires_at, null);
  assert.equal(row.source, null);
  await settle();
  assert.equal(calls.length, 0);
  await setConfig('manual', false);
});

test('reserva vencida deixa o horário livre; reserva ainda válida continua ocupando', async (t) => {
  if (!dbAvailable) return t.skip('sem banco');
  // 18:00Z e 19:00Z em um dia dentro do horizonte (3 dias à frente)
  const d = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  const expired = new Date(`${d}T18:00:00.000Z`);
  const live = new Date(`${d}T19:00:00.000Z`);
  const ins = (start, exp, status = 'pendente') => pool.query(
    `INSERT INTO appointments (professional_id, client_id, service_id, starts_at, ends_at, status, source, expires_at, price_cents_snapshot)
     VALUES ($1,$2,$3,$4,$5,$6,'public',${exp},5000) RETURNING id`,
    [profA, clientA, serviceA, start, new Date(start.getTime() + 30 * 60000), status]);
  const idExpired = (await ins(expired, "now() - interval '1 minute'")).rows[0].id;
  await ins(live, "now() + interval '1 hour'");
  const avail = await req('GET', `/public/${SLUG_A}/availability?days=30&serviceId=${serviceA}`);
  const day = avail.body.days.find((x) => x.date === d);
  assert.ok(day, 'dia esperado na disponibilidade');
  assert.ok(day.slots.includes(expired.toISOString()), 'horário da reserva vencida deve estar livre');
  assert.ok(!day.slots.includes(live.toISOString()), 'horário da reserva válida deve continuar ocupado');

  // reservar o horário vencido funciona e cancela a reserva vencida (sem falso conflito da EXCLUDE)
  captureN8n();
  const book = await req('POST', `/public/${SLUG_A}/appointments`, {
    serviceId: serviceA, startsAt: expired.toISOString(), clientName: 'Outra Cliente', clientPhone: '5531966660001',
  });
  assert.equal(book.status, 201, JSON.stringify(book.body));
  assert.deepEqual(await rowOf(idExpired), { ...(await rowOf(idExpired)), status: 'cancelado', cancel_reason: 'expired' });
  // e a reserva válida bloqueia
  const clash = await req('POST', `/public/${SLUG_A}/appointments`, {
    serviceId: serviceA, startsAt: live.toISOString(), clientName: 'Outra Cliente', clientPhone: '5531966660002',
  });
  assert.equal(clash.status, 409);
});

test('confirmar reserva vencida: 409 hold_expired, vira cancelado/expired, sem mensagem', async (t) => {
  if (!dbAvailable) return t.skip('sem banco');
  const { id } = await insertDirect({ status: 'pendente' });
  captureN8n();
  const r = await req('POST', `/appointments/${id}/confirm`, undefined, cookieA);
  assert.equal(r.status, 409);
  assert.equal(r.body.reason, 'hold_expired');
  const row = await rowOf(id);
  assert.equal(row.status, 'cancelado');
  assert.equal(row.cancel_reason, 'expired');
  // repetir continua 409 hold_expired (não vira idempotente falso)
  assert.equal((await req('POST', `/appointments/${id}/confirm`, undefined, cookieA)).body.reason, 'hold_expired');
  // PUT com status confirmado também respeita o vencimento
  const viaPut = await insertDirect({ status: 'pendente' });
  const p = await req('PUT', `/appointments/${viaPut.id}`, { status: 'confirmado' }, cookieA);
  assert.equal(p.status, 409);
  assert.equal(p.body.reason, 'hold_expired');
  await settle();
  assert.equal(calls.length, 0);
});

test('confirmar reserva válida zera a validade; confirmações paralelas geram uma única mensagem', async (t) => {
  if (!dbAvailable) return t.skip('sem banco');
  const { id } = await insertDirect({ status: 'pendente', expiresAtSql: "now() + interval '5 hours'" });
  captureN8n();
  const results = await Promise.all(Array.from({ length: 5 }, () => req('POST', `/appointments/${id}/confirm`, undefined, cookieA)));
  assert.ok(results.every((r) => r.status === 200));
  assert.equal(results.filter((r) => r.body.changed === true).length, 1);
  const row = await rowOf(id);
  assert.equal(row.status, 'confirmado');
  assert.equal(row.expires_at, null);
  await settle();
  assert.equal(events().filter((e) => e === 'appointment.confirmed').length, 1);
});

test('corrida confirmar × expirar numa reserva vencida: a expiração vence e nada é confirmado', async (t) => {
  if (!dbAvailable) return t.skip('sem banco');
  const { id } = await insertDirect({ status: 'pendente' });
  captureN8n();
  const [conf] = await Promise.all([
    req('POST', `/appointments/${id}/confirm`, undefined, cookieA),
    bookingRules.expireDueHolds({ professionalId: profA }),
  ]);
  assert.equal(conf.status, 409);
  const row = await rowOf(id);
  assert.equal(row.status, 'cancelado');
  assert.equal(row.cancel_reason, 'expired');
  await settle();
  assert.equal(calls.length, 0);
});

test('expireDueHolds: só vencidos de pendente/aguardando_pagamento; idempotente; respeita a profissional', async (t) => {
  if (!dbAvailable) return t.skip('sem banco');
  // zera resíduos vencidos de testes anteriores deste arquivo
  await bookingRules.expireDueHolds({ professionalId: profA });
  await bookingRules.expireDueHolds({ professionalId: profB });
  const svcB = (await pool.query('SELECT id FROM services WHERE professional_id = $1', [profB])).rows[0].id;
  const dueP = await insertDirect({ status: 'pendente' });
  const dueA = await insertDirect({ status: 'aguardando_pagamento' });
  const future = await insertDirect({ status: 'pendente', expiresAtSql: "now() + interval '1 hour'" });
  const legacy = await insertDirect({ status: 'pendente', expiresAtSql: 'NULL', source: null });
  const confirmedStale = await insertDirect({ status: 'confirmado' }); // confirmado nunca expira
  const otherProf = await insertDirect({ status: 'pendente', prof: profB, client: clientB, service: svcB });

  assert.equal(await bookingRules.expireDueHolds({ professionalId: profA }), 2);
  assert.equal((await rowOf(dueP.id)).cancel_reason, 'expired');
  assert.equal((await rowOf(dueA.id)).status, 'cancelado');
  assert.equal((await rowOf(future.id)).status, 'pendente');
  assert.equal((await rowOf(legacy.id)).status, 'pendente');
  assert.equal((await rowOf(confirmedStale.id)).status, 'confirmado');
  assert.equal((await rowOf(otherProf.id)).status, 'pendente', 'não pode tocar em outra profissional');

  assert.equal(await bookingRules.expireDueHolds({ professionalId: profA }), 0, 'idempotente');
  assert.equal(await bookingRules.expireDueHolds(), 1, 'varredura global pega a outra profissional');
  assert.equal((await rowOf(otherProf.id)).cancel_reason, 'expired');
});

test('cancelar um pendente continua funcionando (sem cancel_reason)', async (t) => {
  if (!dbAvailable) return t.skip('sem banco');
  const { id } = await insertDirect({ status: 'pendente', expiresAtSql: "now() + interval '2 hours'" });
  const r = await req('DELETE', `/appointments/${id}`, undefined, cookieA);
  assert.equal(r.status, 204);
  const row = await rowOf(id);
  assert.equal(row.status, 'cancelado');
  assert.equal(row.cancel_reason, null);
});

test('configuração de agendamento: leitura, alteração, validações e isolamento', async (t) => {
  if (!dbAvailable) return t.skip('sem banco');
  assert.equal((await req('GET', '/auth/booking-settings')).status, 401);
  assert.equal((await req('PUT', '/auth/booking-settings', { confirmation_mode: 'automatic' })).status, 401);

  const get = await req('GET', '/auth/booking-settings', undefined, cookieA);
  assert.equal(get.status, 200);
  assert.equal(get.body.confirmation_mode, 'manual');
  assert.equal(get.body.deposit_required, false);

  const put = await req('PUT', '/auth/booking-settings', { confirmation_mode: 'automatic' }, cookieA);
  assert.equal(put.status, 200);
  assert.equal(put.body.confirmation_mode, 'automatic');

  assert.equal((await req('PUT', '/auth/booking-settings', { confirmation_mode: 'xyz' }, cookieA)).status, 400);
  assert.equal((await req('PUT', '/auth/booking-settings', { deposit_required: true }, cookieA)).status, 400, 'sinal sem tipo/valor/chave Pix');
  assert.equal((await req('PUT', '/auth/booking-settings', { deposit_required: 'sim' }, cookieA)).status, 400);
  assert.equal((await req('PUT', '/auth/booking-settings', {}, cookieA)).status, 400);
  assert.equal((await req('PUT', '/auth/booking-settings', { profissional: 'x' }, cookieA)).status, 400);

  const other = await req('GET', '/auth/booking-settings', undefined, cookieB);
  assert.equal(other.body.confirmation_mode, 'manual', 'não vaza para outra profissional');
  await setConfig('manual', false);
});
