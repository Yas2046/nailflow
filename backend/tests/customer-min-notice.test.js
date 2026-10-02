/**
 * Antecedência mínima (30 min) em fluxos de CLIENTE: página pública, bot e
 * KPI "disponíveis hoje" do Dashboard. A Agenda interna continua aceitando
 * horários passados (atendimentos retroativos).
 *
 * "Agora" é fixado via `clock.now` (utils/availability.js), então os testes
 * não dependem do horário real da execução. Usa profissionais temporárias,
 * criadas e removidas aqui; nunca toca contas reais.
 */
import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.BOT_API_KEY = process.env.BOT_API_KEY || 'segredo-bot-teste';

const PROF_ID = '99999999-9999-9999-9999-999999999901';
const SERVICE_ID = '99999999-9999-9999-9999-999999999911';
const CLIENT_ID = '99999999-9999-9999-9999-999999999921';
const SLUG = 'teste-antecedencia-minima';
const INSTANCE = 'instancia-teste-antecedencia';
const EMAIL = 'antecedencia@nailflow.dev';
const PASSWORD = 'senha_teste_antecedencia';

let pool, app, server, baseUrl, avail, tz, dbAvailable = true, cookie;

const realClockNow = () => new Date();

// Dia civil (SP) de "hoje" e instante de um horário civil de SP nesse dia.
function spToday() {
  return tz.getZonedParts(new Date());
}
function spInstant(parts, hour, minute) {
  return tz.zonedTimeToUtc(parts.year, parts.month, parts.day, hour, minute);
}
function setNow(parts, hour, minute) {
  avail.clock.now = () => spInstant(parts, hour, minute);
}
function spHHMM(iso) {
  return new Date(iso).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
}
// Data local do processo (é a que o bot usa para "hoje").
function localTodayParts() {
  const d = new Date();
  return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() };
}

before(async () => {
  ({ pool } = await import('../src/config/db.js'));
  try { await pool.query('SELECT 1'); } catch { dbAvailable = false; return; }

  avail = await import('../src/utils/availability.js');
  tz = await import('../src/utils/timezone.js');
  ({ default: app } = await import('../src/server.js'));

  await pool.query('DELETE FROM professionals WHERE id = $1', [PROF_ID]);
  const { default: bcrypt } = await import('bcryptjs');
  await pool.query(
    `INSERT INTO professionals (id, name, email, password_hash, phone_whatsapp, business_name, slug, wa_instance_name)
     VALUES ($1, 'Teste Antecedencia', $2, $3, '5531900000077', 'Studio Antecedencia', $4, $5)`,
    [PROF_ID, EMAIL, await bcrypt.hash(PASSWORD, 10), SLUG, INSTANCE]
  );
  for (let weekday = 0; weekday <= 6; weekday++) {
    await pool.query(
      `INSERT INTO weekly_availability (professional_id, weekday, is_working, start_time, end_time)
       VALUES ($1, $2, true, '08:00', '18:00')`,
      [PROF_ID, weekday]
    );
  }
  await pool.query(
    `INSERT INTO services (id, professional_id, name, price_cents, duration_minutes, active, available_on_whatsapp)
     VALUES ($1, $2, 'Manicure', 4000, 30, true, true)`,
    [SERVICE_ID, PROF_ID]
  );
  await pool.query(
    `INSERT INTO clients (id, professional_id, name, phone) VALUES ($1, $2, 'Cliente Retroativa', '5531977700099')`,
    [CLIENT_ID, PROF_ID]
  );

  await new Promise((resolve) => { server = app.listen(0, resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  const login = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  assert.equal(login.status, 200);
  cookie = login.headers.get('set-cookie');
});

afterEach(() => {
  if (avail) avail.clock.now = realClockNow;
});

after(async () => {
  if (!dbAvailable) return;
  await pool.query('DELETE FROM professionals WHERE id = $1', [PROF_ID]);
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
});

// ── getAvailableSlots ────────────────────────────────────────────────────────

test('getAvailableSlots sem notBefore devolve a grade completa (comportamento antigo)', async (t) => {
  if (!dbAvailable) return t.skip('banco não disponível');
  const day = { year: 2030, month: 3, day: 12 };
  const slots = await avail.getAvailableSlots(PROF_ID, spInstant(day, 12, 0), 30);
  assert.equal(slots.length, 20); // 08:00..17:30
  assert.equal(spHHMM(slots[0].start), '08:00');
});

test('getAvailableSlots com notBefore descarta horários anteriores (14:40 + 30min => 15:30)', async (t) => {
  if (!dbAvailable) return t.skip('banco não disponível');
  const day = { year: 2030, month: 3, day: 12 };
  const notBefore = spInstant(day, 15, 10);
  const slots = await avail.getAvailableSlots(PROF_ID, spInstant(day, 12, 0), 30, { notBefore });
  assert.equal(spHHMM(slots[0].start), '15:30');
  assert.equal(slots.length, 5); // 15:30 16:00 16:30 17:00 17:30
  assert.ok(slots.every((s) => s.start >= notBefore));
});

test('getAvailableSlots: slot exatamente em notBefore é mantido; 14:45 exclui 14:30 e mantém 15:00', async (t) => {
  if (!dbAvailable) return t.skip('banco não disponível');
  const day = { year: 2030, month: 3, day: 12 };
  const exact = await avail.getAvailableSlots(PROF_ID, spInstant(day, 12, 0), 30, { notBefore: spInstant(day, 15, 0) });
  assert.equal(spHHMM(exact[0].start), '15:00');
  const near = await avail.getAvailableSlots(PROF_ID, spInstant(day, 12, 0), 30, { notBefore: spInstant(day, 14, 45) });
  assert.equal(spHHMM(near[0].start), '15:00');
});

test('getAvailableSlots: notBefore de ontem não afeta o dia seguinte', async (t) => {
  if (!dbAvailable) return t.skip('banco não disponível');
  const slots = await avail.getAvailableSlots(
    PROF_ID,
    spInstant({ year: 2030, month: 3, day: 13 }, 12, 0),
    30,
    { notBefore: spInstant({ year: 2030, month: 3, day: 12 }, 23, 0) }
  );
  assert.equal(slots.length, 20);
});

// ── checkSlotAvailability ────────────────────────────────────────────────────

test('checkSlotAvailability com notBefore: início antes => past_time; no limite ou depois => disponível', async (t) => {
  if (!dbAvailable) return t.skip('banco não disponível');
  const day = { year: 2030, month: 3, day: 12 };
  const notBefore = spInstant(day, 15, 10);
  const before15 = await avail.checkSlotAvailability(PROF_ID, SERVICE_ID, spInstant(day, 15, 0).toISOString(), null, { notBefore });
  assert.deepEqual(before15, { available: false, reason: 'past_time' });
  const atLimit = await avail.checkSlotAvailability(PROF_ID, SERVICE_ID, spInstant(day, 15, 10).toISOString(), null, { notBefore });
  assert.equal(atLimit.available, true);
  const later = await avail.checkSlotAvailability(PROF_ID, SERVICE_ID, spInstant(day, 15, 30).toISOString(), null, { notBefore });
  assert.equal(later.available, true);
});

test('checkSlotAvailability sem notBefore continua aceitando datas passadas (Agenda interna)', async (t) => {
  if (!dbAvailable) return t.skip('banco não disponível');
  const r = await avail.checkSlotAvailability(PROF_ID, SERVICE_ID, '2020-01-07T13:00:00.000Z');
  assert.equal(r.available, true);
});

test('customerNotBefore = agora + 30 minutos (comparação por instante)', async (t) => {
  if (!dbAvailable) return t.skip('banco não disponível');
  const fixed = new Date('2030-03-12T17:40:00.000Z');
  avail.clock.now = () => fixed;
  assert.equal(avail.customerNotBefore().toISOString(), '2030-03-12T18:10:00.000Z');
  assert.equal(avail.CUSTOMER_MIN_NOTICE_MINUTES, 30);
});

// ── Página pública ───────────────────────────────────────────────────────────

test('página pública: disponibilidade de hoje às 14:40 só oferece 15:30 em diante; amanhã não muda', async (t) => {
  if (!dbAvailable) return t.skip('banco não disponível');
  const today = spToday();
  setNow(today, 14, 40);
  const res = await fetch(`${baseUrl}/public/${SLUG}/availability?days=2`);
  assert.equal(res.status, 200);
  const body = await res.json();
  const [d0, d1] = body.days;
  assert.equal(spHHMM(d0.slots[0]), '15:30');
  assert.equal(d0.slots.length, 5);
  assert.equal(spHHMM(d1.slots[0]), '08:00');
  assert.equal(d1.slots.length, 20);
});

test('página pública: de manhã cedo (07:00) hoje oferece a grade inteira', async (t) => {
  if (!dbAvailable) return t.skip('banco não disponível');
  setNow(spToday(), 7, 0);
  const body = await (await fetch(`${baseUrl}/public/${SLUG}/availability?days=1`)).json();
  assert.equal(body.days[0].slots.length, 20);
});

test('página pública: POST de horário passado ou dentro dos 30 min => 409 past_time; horário válido => 201', async (t) => {
  if (!dbAvailable) return t.skip('banco não disponível');
  const today = spToday();
  setNow(today, 14, 40);
  const post = (startsAt, phone) => fetch(`${baseUrl}/public/${SLUG}/appointments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ serviceId: SERVICE_ID, startsAt: startsAt.toISOString(), clientName: 'Cliente Teste', clientPhone: phone }),
  });

  const past = await post(spInstant(today, 10, 0), '31988880001');
  assert.equal(past.status, 409);
  assert.equal((await past.json()).reason, 'past_time');

  const tooSoon = await post(spInstant(today, 15, 0), '31988880002');
  assert.equal(tooSoon.status, 409);
  assert.equal((await tooSoon.json()).reason, 'past_time');

  const ok = await post(spInstant(today, 15, 30), '31988880003');
  assert.equal(ok.status, 201, await ok.clone().text());
});

// ── Dashboard ────────────────────────────────────────────────────────────────

test('dashboard: "disponíveis hoje" não conta horários passados nem os dos próximos 30 min', async (t) => {
  if (!dbAvailable) return t.skip('banco não disponível');
  const today = spToday();
  const get = async () => (await fetch(`${baseUrl}/dashboard`, { headers: { Cookie: cookie } })).json();

  setNow(today, 7, 0);
  const early = await get();
  setNow(today, 14, 40);
  const afternoon = await get();

  // 15:30..17:30 = 5; o 15:30 do POST de teste acima já ocupa um deles.
  const { rows } = await pool.query(
    "SELECT count(*)::int AS n FROM appointments WHERE professional_id = $1 AND status <> 'cancelado'",
    [PROF_ID]
  );
  const taken = rows[0].n; // agendamentos de hoje criados pelos testes acima
  assert.equal(afternoon.horariosDisponiveisHoje, 5 - taken);
  assert.ok(early.horariosDisponiveisHoje > afternoon.horariosDisponiveisHoje);
});

// ── Bot ──────────────────────────────────────────────────────────────────────

async function botSay(phone, text) {
  const res = await fetch(`${baseUrl}/bot/process`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.BOT_API_KEY}` },
    body: JSON.stringify({ instance: INSTANCE, phone, text, waMessageId: `wa-${phone}-${Math.random()}`, fromMe: false, pushName: 'Cliente Teste' }),
  });
  return res.json();
}
async function botConv(phone) {
  const { rows } = await pool.query('SELECT * FROM conversation_states WHERE professional_id = $1 AND phone = $2', [PROF_ID, phone]);
  return rows[0];
}

test('bot: pedir "hoje depois das 14h" no passo de data, às 14:40, lista só horários a partir de 15:30', async (t) => {
  if (!dbAvailable) return t.skip('banco não disponível');
  setNow(localTodayParts(), 14, 40);
  await botSay('5531977700011', 'Quero manicure');
  await botSay('5531977700011', 'hoje depois das 14h');
  const conv = await botConv('5531977700011');
  assert.equal(conv.bot_state, 'AGUARDANDO_HORARIO');
  const times = Object.values(conv.context.slotsMap).map(spHHMM);
  assert.ok(times.length > 0);
  assert.ok(times.every((h) => h >= '15:30'), `horários oferecidos: ${times.join(', ')}`);
});

test('bot: "manicure hoje às 10h" (passado) e "às 15h" (dentro dos 30 min) não vão direto para a confirmação', async (t) => {
  if (!dbAvailable) return t.skip('banco não disponível');
  setNow(localTodayParts(), 14, 40);
  for (const [phone, text] of [['5531977700012', 'Quero manicure hoje às 10h'], ['5531977700013', 'Quero manicure hoje às 15h']]) {
    await botSay(phone, text);
    const conv = await botConv(phone);
    assert.notEqual(conv.bot_state, 'AGUARDANDO_CONFIRMACAO_AGENDAMENTO', `"${text}" não deveria confirmar`);
  }
});

test('bot: "manicure hoje às 16h" (horário futuro válido) continua indo para a confirmação', async (t) => {
  if (!dbAvailable) return t.skip('banco não disponível');
  setNow(localTodayParts(), 14, 40);
  await botSay('5531977700014', 'Quero manicure hoje às 16h');
  const conv = await botConv('5531977700014');
  assert.equal(conv.bot_state, 'AGUARDANDO_CONFIRMACAO_AGENDAMENTO');
});

// ── Regressão: Agenda interna continua aceitando passado ─────────────────────

test('Agenda interna: POST /appointments com data passada continua sendo aceito (retroativo)', async (t) => {
  if (!dbAvailable) return t.skip('banco não disponível');
  const res = await fetch(`${baseUrl}/appointments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ clientId: CLIENT_ID, serviceId: SERVICE_ID, startsAt: '2020-01-07T13:00:00.000Z', status: 'concluido' }),
  });
  assert.equal(res.status, 201, await res.clone().text());
});

test('Agenda interna: /availability/check e /availability/slots aceitam passado', async (t) => {
  if (!dbAvailable) return t.skip('banco não disponível');
  setNow(spToday(), 14, 40); // mesmo com "agora" fixado, rotas internas não aplicam antecedência
  const check = await (await fetch(
    `${baseUrl}/availability/check?serviceId=${SERVICE_ID}&startsAt=${encodeURIComponent('2020-01-08T13:00:00.000Z')}`,
    { headers: { Cookie: cookie } }
  )).json();
  assert.equal(check.available, true);

  const today = spToday();
  const dateStr = `${today.year}-${String(today.month).padStart(2, '0')}-${String(today.day).padStart(2, '0')}`;
  const slots = await (await fetch(`${baseUrl}/availability/slots?date=${dateStr}&serviceId=${SERVICE_ID}`, { headers: { Cookie: cookie } })).json();
  const firstHour = spHHMM(slots[0].start);
  assert.equal(firstHour, '08:00', 'slots internos de hoje continuam incluindo horários já passados');
});
