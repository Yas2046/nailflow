import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'segredo-de-teste';

// Testa getAvailableSlots(), com foco no comportamento correto de timezone.
// O servidor (inclusive containers de produção) roda em UTC, mas os horários
// civis (expediente, almoço, slots de agenda) devem ser interpretados em
// America/Sao_Paulo — exatamente como checkSlotAvailability() já faz.
//
// Cenário-âncora: profissional trabalha APENAS no sábado (weekday 6),
// com folga no domingo (weekday 0). A janela "domingo UTC mas sábado SP"
// (00:00–02:59 UTC = 21:00–23:59 SP do sábado anterior) é o caso que
// date.getDay() resolvia errado em servidores UTC.

let dbAvailable = true;
let pool;
let getAvailableSlots;

// UUIDs dedicados a este arquivo de teste — distintos dos usados em availability-check.test.js.
const PROF_ID = '99999999-9999-9999-9999-999999999902';
const SVC_ID = '99999999-9999-9999-9999-999999999931';

async function setupFixtures() {
  // Garante que não há sobra de execuções anteriores.
  await pool.query('DELETE FROM professionals WHERE id = $1', [PROF_ID]);

  await pool.query(
    `INSERT INTO professionals (id, name, email, password_hash, phone_whatsapp, business_name)
     VALUES ($1,'Teste Slots TZ','slots-tz@nailflow.dev','hash-fake','5531900000002','Studio TZ')`,
    [PROF_ID],
  );

  // Sábado (weekday 6): 08:00–18:00, sem almoço.
  // Domingo (weekday 0): is_working = false (folga).
  // A ausência de row para domingo também significa folga — não inserimos.
  await pool.query(
    `INSERT INTO weekly_availability (professional_id, weekday, is_working, start_time, end_time)
     VALUES ($1, 6, true, '08:00', '18:00')`,
    [PROF_ID],
  );

  await pool.query(
    `INSERT INTO services (id, professional_id, name, price_cents, duration_minutes, active)
     VALUES ($1, $2, 'Serviço 30min TZ', 3000, 30, true)`,
    [SVC_ID, PROF_ID],
  );
}

async function teardownFixtures() {
  await pool.query('DELETE FROM professionals WHERE id = $1', [PROF_ID]);
}

before(async () => {
  ({ pool } = await import('../src/config/db.js'));
  try {
    await pool.query('SELECT 1');
  } catch {
    dbAvailable = false;
    return;
  }
  ({ getAvailableSlots } = await import('../src/utils/availability.js'));
  await setupFixtures();
});

after(async () => {
  if (!dbAvailable) return;
  await teardownFixtures();
  await pool.end();
});

// ── Testes básicos ─────────────────────────────────────────────────────────────

test('sábado dentro do expediente retorna slots', async (t) => {
  if (!dbAvailable) return t.skip('DATABASE_URL não está acessível.');

  // 2026-01-10T12:00:00Z = 09:00 SP (sábado).
  const slots = await getAvailableSlots(PROF_ID, new Date('2026-01-10T12:00:00Z'), 30);

  assert.ok(slots.length > 0, 'sábado deve ter slots disponíveis');
});

test('domingo (folga) não retorna slots', async (t) => {
  if (!dbAvailable) return t.skip('DATABASE_URL não está acessível.');

  // 2026-01-11T12:00:00Z = 09:00 SP (domingo).
  const slots = await getAvailableSlots(PROF_ID, new Date('2026-01-11T12:00:00Z'), 30);

  assert.equal(slots.length, 0, 'domingo deve retornar lista vazia');
});

// ── Testes de fronteira de timezone ────────────────────────────────────────────

test('timezone: 02:00 UTC do domingo ainda é sábado em SP — retorna slots', async (t) => {
  if (!dbAvailable) return t.skip('DATABASE_URL não está acessível.');

  // 2026-01-11T02:00:00Z = 23:00 SP do sábado 10/jan.
  // Bug antigo (date.getDay() UTC): weekday = 0 (domingo) → lista vazia.
  // Correto (getZonedParts): weekday = 6 (sábado) → slots do sábado.
  const slots = await getAvailableSlots(PROF_ID, new Date('2026-01-11T02:00:00Z'), 30);

  assert.ok(slots.length > 0, '02:00 UTC = 23:00 SP (ainda sábado): deve retornar slots');
});

test('timezone: 00:00 UTC do domingo ainda é sábado em SP — retorna slots', async (t) => {
  if (!dbAvailable) return t.skip('DATABASE_URL não está acessível.');

  // 2026-01-11T00:00:00Z = 21:00 SP do sábado 10/jan.
  // Bug antigo: date.getDay() UTC devolve 0 (domingo) → lista vazia.
  const slots = await getAvailableSlots(PROF_ID, new Date('2026-01-11T00:00:00Z'), 30);

  assert.ok(slots.length > 0, '00:00 UTC = 21:00 SP (ainda sábado): deve retornar slots');
});

test('timezone: 03:00 UTC do domingo já é domingo em SP — não retorna slots', async (t) => {
  if (!dbAvailable) return t.skip('DATABASE_URL não está acessível.');

  // 2026-01-11T03:00:00Z = 00:00 SP de domingo 11/jan (meia-noite SP = início do domingo).
  const slots = await getAvailableSlots(PROF_ID, new Date('2026-01-11T03:00:00Z'), 30);

  assert.equal(slots.length, 0, '03:00 UTC = 00:00 SP (domingo): deve retornar lista vazia');
});

// ── Testes de ancoragem dos horários em UTC ────────────────────────────────────

test('slots de sábado têm horários UTC correspondentes ao expediente SP (UTC-3)', async (t) => {
  if (!dbAvailable) return t.skip('DATABASE_URL não está acessível.');

  // Expediente: 08:00–18:00 SP = 11:00–21:00 UTC (UTC-3, sem DST em 2026).
  const slots = await getAvailableSlots(PROF_ID, new Date('2026-01-10T12:00:00Z'), 30);

  const starts = slots.map((s) => s.start.toISOString());

  // Primeiro slot: 08:00 SP = 11:00 UTC no dia 10/jan.
  assert.ok(starts.includes('2026-01-10T11:00:00.000Z'), 'deve incluir 08:00 SP (11:00 UTC)');

  // Último slot que cabe integralmente: 17:30 SP (17:30 + 30min = 18:00) = 20:30 UTC.
  assert.ok(starts.includes('2026-01-10T20:30:00.000Z'), 'deve incluir 17:30 SP (20:30 UTC)');

  // 18:00 SP não deve aparecer como início de slot (o serviço não caberia dentro do expediente).
  assert.ok(!starts.includes('2026-01-10T21:00:00.000Z'), '18:00 SP não deve ser início de slot');
});

test('timezone: slots retornados para data consultada às 02:30 UTC (23:30 SP sábado) pertencem ao sábado', async (t) => {
  if (!dbAvailable) return t.skip('DATABASE_URL não está acessível.');

  // Mesmo que a consulta chegue às 23:30 SP (passado o expediente), os slots
  // gerados devem se referir ao sábado 10/jan — não ao domingo 11/jan.
  const slots = await getAvailableSlots(PROF_ID, new Date('2026-01-11T02:30:00Z'), 30);

  assert.ok(slots.length > 0, 'deve retornar slots do sábado');
  // Todos os slots devem ser do dia 10/jan (sábado), não do 11/jan (domingo).
  for (const s of slots) {
    assert.ok(
      s.start.toISOString().startsWith('2026-01-10'),
      `slot ${s.start.toISOString()} deve pertencer ao dia 10/jan (sábado SP)`,
    );
  }
});
