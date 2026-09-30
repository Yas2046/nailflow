/**
 * Testes para GET /public/:slug/availability?serviceId=uuid (opcional).
 *
 * Cobre:
 *   1. Sem serviceId, comportamento inalterado (menor duração entre os
 *      serviços públicos).
 *   2. Com serviceId de duração menor, slots compatíveis com essa duração.
 *   3. Com serviceId de duração maior, slots compatíveis com essa duração
 *      (exclui um horário que só cabe o serviço curto, não o longo, por
 *      ultrapassar o fim do expediente).
 *   4. serviceId de outra profissional é rejeitado.
 *   5. serviceId de serviço inativo é rejeitado.
 *   6. serviceId de serviço com available_on_whatsapp=false é rejeitado.
 *   7. serviceId inexistente/malformado retorna erro apropriado (400), sem
 *      detalhe interno.
 *
 * Expediente de teste: 08:00–18:00 (SP), sem almoço, todos os dias — para
 * isolar o efeito da duração do serviço sobre os slots sem depender de
 * bloqueios/agendamentos.
 *
 * Usa profissionais/serviços temporários criados e removidos neste próprio
 * arquivo — nunca toca contas reais de produção.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';

let pool;
let app;
let server;
let baseUrl;

const PROF_ID       = '99999999-9999-9999-9999-999999999901';
const OTHER_PROF_ID = '99999999-9999-9999-9999-999999999902';

const SERVICE_SHORT_ID     = '99999999-9999-9999-9999-999999999911'; // 30min
const SERVICE_LONG_ID      = '99999999-9999-9999-9999-999999999912'; // 180min
const SERVICE_INACTIVE_ID  = '99999999-9999-9999-9999-999999999913';
const SERVICE_HIDDEN_ID    = '99999999-9999-9999-9999-999999999914';
const SERVICE_OTHER_ID     = '99999999-9999-9999-9999-999999999915';

const SLUG = 'teste-public-availability-serviceid';

// Data de teste calculada em relação a "agora" (5 dias à frente, bem dentro
// do horizonte padrão de 60 dias) em vez de uma data fixa — evita que o
// teste passe a falhar só porque o tempo passou. SP = UTC-3 sem horário de
// verão (mesma simplificação já usada em availability-check.test.js).
const SP_OFFSET_MS = 3 * 60 * 60 * 1000;
const targetInstant = new Date(Date.now() + 5 * 86400000);
const TEST_DATE = new Date(targetInstant.getTime() - SP_OFFSET_MS).toISOString().slice(0, 10);
const REQUEST_DAYS = 10; // margem de segurança contra arredondamento de fuso

async function seedFixtures() {
  await pool.query('DELETE FROM professionals WHERE id IN ($1,$2)', [PROF_ID, OTHER_PROF_ID]);

  await pool.query(
    `INSERT INTO professionals (id, name, email, password_hash, phone_whatsapp, business_name, slug)
     VALUES ($1, 'Teste Availability ServiceId', 'teste-public-availability-serviceid@nailflow.dev', 'hash-fake', '5531900000000', 'Studio Teste Availability', $2)`,
    [PROF_ID, SLUG]
  );
  await pool.query(
    `INSERT INTO professionals (id, name, email, password_hash, phone_whatsapp, business_name, slug)
     VALUES ($1, 'Outra Profissional Availability', 'outra-public-availability-serviceid@nailflow.dev', 'hash-fake', '5531900000003', 'Studio Outra Availability', 'teste-public-availability-serviceid-outra')`,
    [OTHER_PROF_ID]
  );

  for (let weekday = 0; weekday <= 6; weekday++) {
    await pool.query(
      `INSERT INTO weekly_availability (professional_id, weekday, is_working, start_time, end_time)
       VALUES ($1, $2, true, '08:00', '18:00')`,
      [PROF_ID, weekday]
    );
  }

  await pool.query(
    `INSERT INTO services (id, professional_id, name, price_cents, duration_minutes, active, available_on_whatsapp) VALUES
       ($1, $6, 'Servico Curto', 3000, 30, true, true),
       ($2, $6, 'Servico Longo', 15000, 180, true, true),
       ($3, $6, 'Servico Inativo', 3000, 30, false, true),
       ($4, $6, 'Servico So Agenda', 3000, 30, true, false),
       ($5, $7, 'Servico Outra Profissional', 3000, 30, true, true)`,
    [SERVICE_SHORT_ID, SERVICE_LONG_ID, SERVICE_INACTIVE_ID, SERVICE_HIDDEN_ID, SERVICE_OTHER_ID, PROF_ID, OTHER_PROF_ID]
  );
}

async function teardownFixtures() {
  await pool.query('DELETE FROM professionals WHERE id IN ($1,$2)', [PROF_ID, OTHER_PROF_ID]);
}

before(async () => {
  ({ pool } = await import('../src/config/db.js'));
  let dbOk = true;
  try {
    await pool.query('SELECT 1');
  } catch {
    dbOk = false;
  }
  globalThis.__publicAvailServiceIdDbAvailable = dbOk;

  ({ default: app } = await import('../src/server.js'));
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  if (dbOk) await seedFixtures();
});

after(async () => {
  if (globalThis.__publicAvailServiceIdDbAvailable) await teardownFixtures();
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
});

function dbAvailable(t) {
  if (!globalThis.__publicAvailServiceIdDbAvailable) {
    t.skip('DATABASE_URL não está acessível.');
    return false;
  }
  return true;
}

async function getAvailability(qs) {
  const res = await fetch(`${baseUrl}/public/${SLUG}/availability?days=${REQUEST_DAYS}${qs}`);
  return res;
}

// Extrai o conjunto de horários (HH:mm em UTC) do dia de teste na resposta.
function slotsOfTestDate(body) {
  const day = body.days.find((d) => d.date === TEST_DATE);
  return day ? day.slots.map((s) => s.slice(11, 16)) : [];
}

// 08:00 SP = 11:00 UTC; 17:30 SP = 20:30 UTC (SP = UTC-3, sem horário de verão).
const SLOT_START_OF_DAY_UTC   = '11:00'; // 08:00 SP — cabe qualquer duração razoável
const SLOT_NEAR_CLOSING_UTC   = '20:30'; // 17:30 SP — só cabe até 30min antes de fechar (18:00 SP)

// ─── 1. sem serviceId — comportamento inalterado ─────────────────────────

test('sem serviceId, usa a menor duracao entre os servicos publicos (comportamento anterior)', async (t) => {
  if (!dbAvailable(t)) return;

  const res = await getAvailability('');
  assert.equal(res.status, 200);
  const body = await res.json();

  const slots = slotsOfTestDate(body);
  assert.ok(slots.includes(SLOT_NEAR_CLOSING_UTC), '17:30 SP deveria estar livre usando a menor duracao (30min)');
});

// ─── 2. serviceId de duração menor ────────────────────────────────────────

test('com serviceId de duracao menor (30min), gera slots compativeis com essa duracao', async (t) => {
  if (!dbAvailable(t)) return;

  const res = await getAvailability(`&serviceId=${SERVICE_SHORT_ID}`);
  assert.equal(res.status, 200);
  const body = await res.json();

  const slots = slotsOfTestDate(body);
  assert.ok(slots.includes(SLOT_NEAR_CLOSING_UTC), 'servico de 30min deveria caber as 17:30 SP (termina exatamente as 18:00)');
});

// ─── 3. serviceId de duração maior ────────────────────────────────────────

test('com serviceId de duracao maior (180min), exclui horario que so cabe o servico curto', async (t) => {
  if (!dbAvailable(t)) return;

  const res = await getAvailability(`&serviceId=${SERVICE_LONG_ID}`);
  assert.equal(res.status, 200);
  const body = await res.json();

  const slots = slotsOfTestDate(body);
  assert.ok(!slots.includes(SLOT_NEAR_CLOSING_UTC), 'servico de 180min nao deveria caber as 17:30 SP (ultrapassaria o fim do expediente)');
  assert.ok(slots.includes(SLOT_START_OF_DAY_UTC), '08:00 SP deveria caber o servico de 180min (termina as 11:00 SP)');
});

// ─── 4. serviceId de outra profissional ──────────────────────────────────

test('serviceId de outra profissional e rejeitado', async (t) => {
  if (!dbAvailable(t)) return;

  const res = await getAvailability(`&serviceId=${SERVICE_OTHER_ID}`);
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.ok(body.error);
  assert.ok(!('stack' in body) && !('detail' in body), 'nao deve expor detalhe interno');
});

// ─── 5. serviceId de serviço inativo ──────────────────────────────────────

test('serviceId de servico inativo e rejeitado', async (t) => {
  if (!dbAvailable(t)) return;

  const res = await getAvailability(`&serviceId=${SERVICE_INACTIVE_ID}`);
  assert.equal(res.status, 400);
});

// ─── 6. serviceId com available_on_whatsapp=false ────────────────────────

test('serviceId com available_on_whatsapp=false e rejeitado', async (t) => {
  if (!dbAvailable(t)) return;

  const res = await getAvailability(`&serviceId=${SERVICE_HIDDEN_ID}`);
  assert.equal(res.status, 400);
});

// ─── 7. serviceId inexistente/malformado ─────────────────────────────────

test('serviceId inexistente retorna 400 sem detalhe interno', async (t) => {
  if (!dbAvailable(t)) return;

  const res = await getAvailability('&serviceId=00000000-0000-0000-0000-000000000000');
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.ok(body.error);
});

test('serviceId malformado (nao-UUID) retorna 400 sem quebrar a aplicacao', async (t) => {
  if (!dbAvailable(t)) return;

  const res = await getAvailability('&serviceId=nao-e-um-uuid');
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.ok(body.error);
});
