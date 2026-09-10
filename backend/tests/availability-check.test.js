import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'segredo-de-teste';

// Estes testes cobrem a nova função reutilizável `checkSlotAvailability`
// (verificação de um horário EXATO, sem grade de 30 em 30 minutos) e o
// endpoint GET /availability/check que a expõe.
//
// Todos os horários de expediente/almoço são cadastrados de forma idêntica
// para os 7 dias da semana, para que o teste não dependa de "qual dia da
// semana cai em qual data" — só a data usada nos agendamentos/bloqueios
// pontuais importa.
//
// O servidor deste sandbox roda em UTC (não em America/Sao_Paulo de
// propósito): isso expõe qualquer bug de timezone, já que "14:15" pedido
// pela cliente só está correto se for interpretado como 14:15 no Brasil
// (17:15 UTC), nunca como 14:15 UTC.

let dbAvailable = true;
let pool;
let app;
let server;
let baseUrl;
let checkSlotAvailability;

const TEST_PROFESSIONAL_ID = '99999999-9999-9999-9999-999999999901';
const SERVICE_30MIN_ID = '99999999-9999-9999-9999-999999999911';
const SERVICE_120MIN_ID = '99999999-9999-9999-9999-999999999912';
const SERVICE_INACTIVE_ID = '99999999-9999-9999-9999-999999999913';
const TEST_CLIENT_ID = '99999999-9999-9999-9999-999999999921';

async function setupFixtures() {
  await pool.query('DELETE FROM professionals WHERE id = $1', [TEST_PROFESSIONAL_ID]);

  await pool.query(
    `INSERT INTO professionals (id, name, email, password_hash, phone_whatsapp, business_name)
     VALUES ($1, 'Teste Disponibilidade', 'teste-disponibilidade@nailflow.dev', 'hash-fake', '5531900000000', 'Studio Teste')`,
    [TEST_PROFESSIONAL_ID]
  );

  // Mesmo expediente todos os dias: 08:00–18:00, almoço 12:00–13:00.
  // Assim os testes não dependem de qual dia da semana cai a data usada.
  for (let weekday = 0; weekday <= 6; weekday++) {
    await pool.query(
      `INSERT INTO weekly_availability (professional_id, weekday, is_working, start_time, end_time, break_start, break_end)
       VALUES ($1, $2, true, '08:00', '18:00', '12:00', '13:00')`,
      [TEST_PROFESSIONAL_ID, weekday]
    );
  }

  await pool.query(
    `INSERT INTO services (id, professional_id, name, price_cents, duration_minutes, active) VALUES
       ($1, $4, 'Serviço 30min', 3000, 30, true),
       ($2, $4, 'Serviço 120min', 12000, 120, true),
       ($3, $4, 'Serviço inativo', 3000, 30, false)`,
    [SERVICE_30MIN_ID, SERVICE_120MIN_ID, SERVICE_INACTIVE_ID, TEST_PROFESSIONAL_ID]
  );

  await pool.query(
    `INSERT INTO clients (id, professional_id, name, phone) VALUES ($1, $2, 'Cliente Teste', '5531911111111')`,
    [TEST_CLIENT_ID, TEST_PROFESSIONAL_ID]
  );

  // Agendamento já existente em 2026-03-10, 15:00–15:30 (America/Sao_Paulo),
  // usado no teste de conflito de horário.
  await pool.query(
    `INSERT INTO appointments (professional_id, client_id, service_id, starts_at, ends_at, status, price_cents_snapshot)
     VALUES ($1, $2, $3, '2026-03-10T18:00:00Z', '2026-03-10T18:30:00Z', 'confirmado', 3000)`,
    [TEST_PROFESSIONAL_ID, TEST_CLIENT_ID, SERVICE_30MIN_ID]
  );

  // Bloqueio pontual em 2026-03-11, 10:00–11:00 (America/Sao_Paulo).
  await pool.query(
    `INSERT INTO blocked_times (professional_id, starts_at, ends_at, reason)
     VALUES ($1, '2026-03-11T13:00:00Z', '2026-03-11T14:00:00Z', 'Compromisso pessoal')`,
    [TEST_PROFESSIONAL_ID]
  );
}

async function teardownFixtures() {
  await pool.query('DELETE FROM professionals WHERE id = $1', [TEST_PROFESSIONAL_ID]);
}

before(async () => {
  ({ pool } = await import('../src/config/db.js'));
  try {
    await pool.query('SELECT 1');
  } catch {
    dbAvailable = false;
    return;
  }

  ({ checkSlotAvailability } = await import('../src/utils/availability.js'));
  ({ default: app } = await import('../src/server.js'));

  await setupFixtures();

  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  if (!dbAvailable) return;
  await teardownFixtures();
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
});

test('1. horário 14:15 (não múltiplo de 30) disponível para serviço de 30 minutos', async (t) => {
  if (!dbAvailable) return t.skip('DATABASE_URL não está acessível.');

  // 2026-03-10T14:15:00 é "naive" (sem timezone) -> deve ser interpretado
  // como 14:15 em America/Sao_Paulo, ou seja, 17:15Z (UTC-3, sem DST no Brasil).
  const result = await checkSlotAvailability(TEST_PROFESSIONAL_ID, SERVICE_30MIN_ID, '2026-03-10T14:15:00');

  assert.equal(result.available, true);
  assert.equal(result.startsAt, '2026-03-10T17:15:00.000Z');
  assert.equal(result.endsAt, '2026-03-10T17:45:00.000Z');
});

test('2. horário 15:00 indisponível: já existe outro agendamento (appointment_overlap)', async (t) => {
  if (!dbAvailable) return t.skip('DATABASE_URL não está acessível.');

  // Fixture tem um agendamento confirmado em 2026-03-10 18:00–18:30 UTC,
  // que corresponde a 15:00–15:30 em America/Sao_Paulo.
  const result = await checkSlotAvailability(TEST_PROFESSIONAL_ID, SERVICE_30MIN_ID, '2026-03-10T15:00:00');

  assert.equal(result.available, false);
  assert.equal(result.reason, 'appointment_overlap');
});

test('3. serviço de 120 minutos calcula endsAt corretamente (14:15 -> 16:15)', async (t) => {
  if (!dbAvailable) return t.skip('DATABASE_URL não está acessível.');

  const result = await checkSlotAvailability(TEST_PROFESSIONAL_ID, SERVICE_120MIN_ID, '2026-03-12T14:15:00');

  assert.equal(result.available, true);
  // 14:15 BRT = 17:15Z ; +120min = 19:15Z = 16:15 BRT
  assert.equal(result.startsAt, '2026-03-12T17:15:00.000Z');
  assert.equal(result.endsAt, '2026-03-12T19:15:00.000Z');
});

test('4. horário que invade o almoço (12:00–13:00) é recusado', async (t) => {
  if (!dbAvailable) return t.skip('DATABASE_URL não está acessível.');

  // 12:15–12:45 cai inteiramente dentro do almoço.
  const result = await checkSlotAvailability(TEST_PROFESSIONAL_ID, SERVICE_30MIN_ID, '2026-03-13T12:15:00');

  assert.equal(result.available, false);
  assert.equal(result.reason, 'lunch_break');
});

test('5. horário que invade um bloqueio pontual é recusado', async (t) => {
  if (!dbAvailable) return t.skip('DATABASE_URL não está acessível.');

  // Fixture bloqueia 2026-03-11 13:00–14:00Z = 10:00–11:00 BRT.
  const result = await checkSlotAvailability(TEST_PROFESSIONAL_ID, SERVICE_30MIN_ID, '2026-03-11T10:30:00');

  assert.equal(result.available, false);
  assert.equal(result.reason, 'blocked_time');
});

test('6. horário que ultrapassa o fim do expediente (18:00) é recusado', async (t) => {
  if (!dbAvailable) return t.skip('DATABASE_URL não está acessível.');

  // Expediente termina às 18:00; serviço de 30min às 17:45 terminaria 18:15.
  const result = await checkSlotAvailability(TEST_PROFESSIONAL_ID, SERVICE_30MIN_ID, '2026-03-14T17:45:00');

  assert.equal(result.available, false);
  assert.equal(result.reason, 'outside_working_hours');
});

test('7. serviço inativo é recusado (inactive_service)', async (t) => {
  if (!dbAvailable) return t.skip('DATABASE_URL não está acessível.');

  const result = await checkSlotAvailability(TEST_PROFESSIONAL_ID, SERVICE_INACTIVE_ID, '2026-03-16T14:15:00');

  assert.equal(result.available, false);
  assert.equal(result.reason, 'inactive_service');
});

test('endpoint GET /availability/check retorna o mesmo resultado da função', async (t) => {
  if (!dbAvailable) return t.skip('DATABASE_URL não está acessível.');

  const token = jwt.sign({ sub: TEST_PROFESSIONAL_ID }, process.env.JWT_SECRET, { expiresIn: '1h' });

  const res = await fetch(
    `${baseUrl}/availability/check?serviceId=${SERVICE_30MIN_ID}&startsAt=2026-03-10T14:15:00`,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.available, true);
  assert.equal(body.startsAt, '2026-03-10T17:15:00.000Z');
});

test('endpoint GET /availability/check sem token retorna 401', async (t) => {
  if (!dbAvailable) return t.skip('DATABASE_URL não está acessível.');

  const res = await fetch(`${baseUrl}/availability/check?serviceId=${SERVICE_30MIN_ID}&startsAt=2026-03-10T14:15:00`);
  assert.equal(res.status, 401);
});
