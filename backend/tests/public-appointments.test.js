/**
 * Testes para POST /public/:slug/appointments (criação de agendamento pela
 * página pública, sem autenticação).
 *
 * Cada teste usa um IP simulado diferente (via X-Forwarded-For + trust proxy
 * já configurado no server.js) para não disparar o rate limit por IP entre
 * testes que não estão testando rate limit — só os testes 13/14, dedicados a
 * rate limit, reutilizam de propósito o mesmo IP/telefone repetidamente.
 *
 * Data de teste fixa no futuro (2027-06-15) para não depender de "hoje" e
 * para o filtro `starts_at > now()` do limite de agendamentos futuros
 * funcionar de forma previsível.
 *
 * Usa profissionais/serviços/clientes temporários criados e removidos neste
 * próprio arquivo — nunca toca contas reais de produção.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';

let pool;
let app;
let server;
let baseUrl;

const PROF_ID       = '99999999-9999-9999-9999-999999999801';
const OTHER_PROF_ID = '99999999-9999-9999-9999-999999999802';

const SERVICE_PUBLIC_ID    = '99999999-9999-9999-9999-999999999811';
const SERVICE_INACTIVE_ID  = '99999999-9999-9999-9999-999999999812';
const SERVICE_HIDDEN_ID    = '99999999-9999-9999-9999-999999999813';
const SERVICE_OTHER_ID     = '99999999-9999-9999-9999-999999999814';

const CLIENT_EXISTING_ID = '99999999-9999-9999-9999-999999999821';
const CLIENT_FILLER_ID   = '99999999-9999-9999-9999-999999999822';
const CLIENT_LIMIT_ID    = '99999999-9999-9999-9999-999999999823';

const SLUG = 'teste-public-appointments';

// Todos os telefones abaixo já estão no formato normalizado final
// (55 + DDD + 8 dígitos = 12 dígitos), para que o valor gravado no banco
// pelos fixtures bata exatamente com o que normalizeClientPhone() produz
// a partir do mesmo valor enviado no corpo da requisição.
const PHONE_NEW             = '553100000001';
const PHONE_EXISTING        = '553100000002';
const PHONE_OTHER_PROF      = '553100000004';
const PHONE_LIMIT           = '553100000009';
const PHONE_TAKEN_SLOT      = '553100000010';
const PHONE_CLIENT_ID_TEST  = '553100000012';
const PHONE_RACE_A          = '553100000111';
const PHONE_RACE_B          = '553100000112';
const PHONE_ROLLBACK_A      = '553100000151';
const PHONE_ROLLBACK_B      = '553100000152';
const PHONE_RATE_PHONE      = '553100000140';

// SP = UTC-3, sem horário de verão.
const SLOT_TEST1    = '2027-06-15T11:00:00.000Z'; // 08:00 SP
const SLOT_TEST2    = '2027-06-15T11:40:00.000Z'; // 08:40 SP
const SLOT_TEST4    = '2027-06-15T12:20:00.000Z'; // 09:20 SP
const SLOT_TAKEN    = '2027-06-15T13:00:00.000Z'; // 10:00 SP (pré-ocupado)
const SLOT_TEST12   = '2027-06-15T13:40:00.000Z'; // 10:40 SP
const SLOT_TEST9    = '2027-06-15T17:00:00.000Z'; // 14:00 SP
const SLOT_RACE     = '2027-06-15T14:20:00.000Z'; // 11:20 SP
const SLOT_ROLLBACK = '2027-06-15T16:00:00.000Z'; // 13:00 SP

async function seedFixtures() {
  await pool.query('DELETE FROM professionals WHERE id IN ($1,$2)', [PROF_ID, OTHER_PROF_ID]);

  await pool.query(
    `INSERT INTO professionals (id, name, email, password_hash, phone_whatsapp, business_name, slug)
     VALUES ($1, 'Teste Agendamento Publico', 'teste-public-appointments@nailflow.dev', 'hash-fake', '5531900000000', 'Studio Teste Publico', $2)`,
    [PROF_ID, SLUG]
  );
  await pool.query(
    `INSERT INTO professionals (id, name, email, password_hash, phone_whatsapp, business_name, slug)
     VALUES ($1, 'Outra Profissional', 'outra-public-appointments@nailflow.dev', 'hash-fake', '5531900000003', 'Studio Outra', 'teste-public-appointments-outra')`,
    [OTHER_PROF_ID]
  );

  for (let weekday = 0; weekday <= 6; weekday++) {
    await pool.query(
      `INSERT INTO weekly_availability (professional_id, weekday, is_working, start_time, end_time, break_start, break_end)
       VALUES ($1, $2, true, '08:00', '18:00', '12:00', '13:00')`,
      [PROF_ID, weekday]
    );
  }

  await pool.query(
    `INSERT INTO services (id, professional_id, name, price_cents, duration_minutes, active, available_on_whatsapp) VALUES
       ($1, $5, 'Manicure Publica', 5000, 40, true, true),
       ($2, $5, 'Servico Inativo', 5000, 40, false, true),
       ($3, $5, 'Servico So Agenda', 5000, 40, true, false),
       ($4, $6, 'Servico da Outra Profissional', 5000, 40, true, true)`,
    [SERVICE_PUBLIC_ID, SERVICE_INACTIVE_ID, SERVICE_HIDDEN_ID, SERVICE_OTHER_ID, PROF_ID, OTHER_PROF_ID]
  );

  await pool.query(
    `INSERT INTO clients (id, professional_id, name, phone) VALUES ($1, $2, 'Nome Original', $3)`,
    [CLIENT_EXISTING_ID, PROF_ID, PHONE_EXISTING]
  );
  await pool.query(
    `INSERT INTO clients (id, professional_id, name, phone) VALUES ($1, $2, 'Cliente Preenchimento', $3)`,
    [CLIENT_FILLER_ID, PROF_ID, PHONE_TAKEN_SLOT]
  );
  await pool.query(
    `INSERT INTO clients (id, professional_id, name, phone) VALUES ($1, $2, 'Cliente Limite', $3)`,
    [CLIENT_LIMIT_ID, PROF_ID, PHONE_LIMIT]
  );

  // Horário já ocupado — usado pelo teste de "horário indisponível" e
  // reaproveitado pelos testes de rate limit (não importa que conflite).
  await pool.query(
    `INSERT INTO appointments (professional_id, client_id, service_id, starts_at, ends_at, status, price_cents_snapshot)
     VALUES ($1, $2, $3, $4, $5, 'confirmado', 5000)`,
    [PROF_ID, CLIENT_FILLER_ID, SERVICE_PUBLIC_ID, SLOT_TAKEN, '2027-06-15T13:40:00.000Z']
  );

  // 3 agendamentos futuros (pendente/confirmado) para o telefone do teste de
  // limite — datas/horários arbitrários, só precisam estar no futuro e
  // vinculados ao cliente certo.
  const limitDates = ['2027-07-01T12:00:00.000Z', '2027-07-02T12:00:00.000Z', '2027-07-03T12:00:00.000Z'];
  for (const d of limitDates) {
    await pool.query(
      `INSERT INTO appointments (professional_id, client_id, service_id, starts_at, ends_at, status, price_cents_snapshot)
       VALUES ($1, $2, $3, $4, $5, 'pendente', 5000)`,
      [PROF_ID, CLIENT_LIMIT_ID, SERVICE_PUBLIC_ID, d, new Date(new Date(d).getTime() + 40 * 60000).toISOString()]
    );
  }
}

async function teardownFixtures() {
  // Clientes públicos criados pelos próprios testes não têm id fixo, mas
  // são removidos via cascade ao apagar as profissionais abaixo.
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
  globalThis.__publicApptDbAvailable = dbOk;

  ({ default: app } = await import('../src/server.js'));
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  if (dbOk) await seedFixtures();
});

after(async () => {
  if (globalThis.__publicApptDbAvailable) await teardownFixtures();
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
});

function post(slug, body, xff) {
  return fetch(`${baseUrl}/public/${slug}/appointments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(xff ? { 'X-Forwarded-For': xff } : {}),
    },
    body: JSON.stringify(body),
  });
}

function dbAvailable(t) {
  if (!globalThis.__publicApptDbAvailable) {
    t.skip('DATABASE_URL não está acessível.');
    return false;
  }
  return true;
}

// ─── 1. criação com cliente novo ──────────────────────────────────────────

test('cria agendamento com cliente novo', async (t) => {
  if (!dbAvailable(t)) return;

  const res = await post(SLUG, {
    serviceId: SERVICE_PUBLIC_ID,
    startsAt: SLOT_TEST1,
    clientName: 'Cliente Nova',
    clientPhone: PHONE_NEW,
  }, '10.0.0.1');

  assert.equal(res.status, 201);
  const body = await res.json();
  assert.ok(body.id);
  assert.equal(body.status, 'pendente');
  assert.equal(body.serviceName, 'Manicure Publica');
  assert.ok(!('professionalId' in body) && !('professional_id' in body));
  assert.ok(!('clientId' in body) && !('client_id' in body));

  const { rows } = await pool.query('SELECT id, name FROM clients WHERE professional_id = $1 AND phone = $2', [PROF_ID, PHONE_NEW]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'Cliente Nova');
});

// ─── 2 e 3. cliente existente é reaproveitado e não tem nome alterado ────

test('reaproveita cliente existente pelo telefone e nao altera o nome', async (t) => {
  if (!dbAvailable(t)) return;

  const res = await post(SLUG, {
    serviceId: SERVICE_PUBLIC_ID,
    startsAt: SLOT_TEST2,
    clientName: 'Nome Diferente Enviado No Formulario',
    clientPhone: PHONE_EXISTING,
  }, '10.0.0.2');

  assert.equal(res.status, 201);

  const { rows: clientRows } = await pool.query('SELECT id, name FROM clients WHERE professional_id = $1 AND phone = $2', [PROF_ID, PHONE_EXISTING]);
  assert.equal(clientRows.length, 1, 'nao deveria criar um segundo cliente para o mesmo telefone');
  assert.equal(clientRows[0].id, CLIENT_EXISTING_ID);
  assert.equal(clientRows[0].name, 'Nome Original', 'nome do cliente existente nao deveria ser alterado');

  const { rows: apptRows } = await pool.query('SELECT client_id FROM appointments WHERE professional_id = $1 AND starts_at = $2', [PROF_ID, SLOT_TEST2]);
  assert.equal(apptRows[0].client_id, CLIENT_EXISTING_ID, 'agendamento deveria usar o cliente existente');
});

// ─── 4. serviço de outra profissional é rejeitado ────────────────────────

test('servico de outra profissional e rejeitado', async (t) => {
  if (!dbAvailable(t)) return;

  const res = await post(SLUG, {
    serviceId: SERVICE_OTHER_ID,
    startsAt: SLOT_TEST4,
    clientName: 'Cliente Teste',
    clientPhone: PHONE_OTHER_PROF,
  }, '10.0.0.4');

  assert.equal(res.status, 400);

  const { rows } = await pool.query('SELECT id FROM appointments WHERE professional_id = $1 AND starts_at = $2', [PROF_ID, SLOT_TEST4]);
  assert.equal(rows.length, 0, 'nenhum agendamento deveria ter sido criado');
});

// ─── 5. serviço inativo / oculto do WhatsApp são rejeitados ──────────────

test('servico inativo e rejeitado', async (t) => {
  if (!dbAvailable(t)) return;
  const res = await post(SLUG, {
    serviceId: SERVICE_INACTIVE_ID,
    startsAt: SLOT_TEST4,
    clientName: 'Cliente Teste',
    clientPhone: '553100000005',
  }, '10.0.0.5');
  assert.equal(res.status, 400);
});

test('servico oculto do WhatsApp (available_on_whatsapp=false) e rejeitado', async (t) => {
  if (!dbAvailable(t)) return;
  const res = await post(SLUG, {
    serviceId: SERVICE_HIDDEN_ID,
    startsAt: SLOT_TEST4,
    clientName: 'Cliente Teste',
    clientPhone: '553100000006',
  }, '10.0.0.6');
  assert.equal(res.status, 400);
});

// ─── 6. slug inexistente ──────────────────────────────────────────────────

test('slug inexistente retorna 404', async (t) => {
  if (!dbAvailable(t)) return;
  const res = await post('slug-que-nao-existe-appointments', {
    serviceId: SERVICE_PUBLIC_ID,
    startsAt: SLOT_TEST4,
    clientName: 'Cliente Teste',
    clientPhone: '553100000007',
  }, '10.0.0.7');
  assert.equal(res.status, 404);
});

// ─── 7. telefone inválido ─────────────────────────────────────────────────

test('telefone invalido retorna 400', async (t) => {
  if (!dbAvailable(t)) return;
  const res = await post(SLUG, {
    serviceId: SERVICE_PUBLIC_ID,
    startsAt: SLOT_TEST4,
    clientName: 'Cliente Teste',
    clientPhone: '123',
  }, '10.0.0.8');
  assert.equal(res.status, 400);
});

// ─── 8. nome inválido ─────────────────────────────────────────────────────

test('nome vazio retorna 400', async (t) => {
  if (!dbAvailable(t)) return;
  const res = await post(SLUG, {
    serviceId: SERVICE_PUBLIC_ID,
    startsAt: SLOT_TEST4,
    clientName: '   ',
    clientPhone: '553100000011',
  }, '10.0.0.85');
  assert.equal(res.status, 400);
});

// ─── 9. limite de 3 agendamentos futuros ─────────────────────────────────

test('rejeita o 4o agendamento futuro pendente/confirmado para o mesmo telefone', async (t) => {
  if (!dbAvailable(t)) return;
  const res = await post(SLUG, {
    serviceId: SERVICE_PUBLIC_ID,
    startsAt: SLOT_TEST9,
    clientName: 'Cliente Limite',
    clientPhone: PHONE_LIMIT,
  }, '10.0.0.9');
  assert.equal(res.status, 409);
  const body = await res.json();
  assert.equal(body.reason, 'max_future_appointments');
});

// ─── 10. horário indisponível ─────────────────────────────────────────────

test('horario ja ocupado retorna 409 com reason', async (t) => {
  if (!dbAvailable(t)) return;
  const res = await post(SLUG, {
    serviceId: SERVICE_PUBLIC_ID,
    startsAt: SLOT_TAKEN,
    clientName: 'Cliente Teste',
    clientPhone: PHONE_TAKEN_SLOT,
  }, '10.0.0.10');
  assert.equal(res.status, 409);
  const body = await res.json();
  assert.ok(body.reason);
  assert.ok(!('alternatives' in body), 'esta versao nao deve retornar alternatives');
});

// ─── 11. concorrência real — duas requisições simultâneas, mesmo horário ─

test('duas requisicoes simultaneas para o mesmo horario: so uma e aceita (EXCLUDE constraint)', async (t) => {
  if (!dbAvailable(t)) return;

  const [resA, resB] = await Promise.all([
    post(SLUG, { serviceId: SERVICE_PUBLIC_ID, startsAt: SLOT_RACE, clientName: 'Corrida A', clientPhone: PHONE_RACE_A }, '10.0.0.11'),
    post(SLUG, { serviceId: SERVICE_PUBLIC_ID, startsAt: SLOT_RACE, clientName: 'Corrida B', clientPhone: PHONE_RACE_B }, '10.0.0.11'),
  ]);

  const statuses = [resA.status, resB.status].sort();
  assert.deepEqual(statuses, [201, 409], 'exatamente uma requisicao deve ganhar a corrida');

  const { rows } = await pool.query(
    "SELECT id FROM appointments WHERE professional_id = $1 AND starts_at = $2 AND status <> 'cancelado'",
    [PROF_ID, SLOT_RACE]
  );
  assert.equal(rows.length, 1, 'so um agendamento deveria existir para esse horario');
});

// ─── 12. clientId/professionalId no body são ignorados ───────────────────

test('clientId e professionalId enviados no body sao ignorados', async (t) => {
  if (!dbAvailable(t)) return;

  const res = await post(SLUG, {
    serviceId: SERVICE_PUBLIC_ID,
    startsAt: SLOT_TEST12,
    clientName: 'Cliente Isolamento',
    clientPhone: PHONE_CLIENT_ID_TEST,
    clientId: CLIENT_EXISTING_ID,       // deve ser ignorado
    professionalId: OTHER_PROF_ID,      // deve ser ignorado
  }, '10.0.0.12');

  assert.equal(res.status, 201);

  const { rows } = await pool.query(
    `SELECT a.professional_id, a.client_id, c.phone
     FROM appointments a JOIN clients c ON c.id = a.client_id
     WHERE a.professional_id = $1 AND a.starts_at = $2`,
    [PROF_ID, SLOT_TEST12]
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].professional_id, PROF_ID, 'professional_id deve vir do slug, nao do body');
  assert.notEqual(rows[0].client_id, CLIENT_EXISTING_ID, 'client_id enviado no body nao deveria ser usado');
  assert.equal(rows[0].phone, PHONE_CLIENT_ID_TEST);
});

// ─── 13. rate limit por IP ─────────────────────────────────────────────────

test('rate limit por IP bloqueia apos 5 tentativas em 10 minutos', async (t) => {
  if (!dbAvailable(t)) return;

  const xff = '10.0.0.200';
  const results = [];
  for (let i = 0; i < 6; i++) {
    const res = await post(SLUG, {
      serviceId: SERVICE_PUBLIC_ID,
      startsAt: SLOT_TAKEN, // sempre ocupado — não importa, é só para contar tentativas
      clientName: 'Rate Limit IP',
      clientPhone: `553100000${200 + i}`,
    }, xff);
    results.push(res.status);
  }

  assert.equal(results.length, 6);
  assert.equal(results[5], 429, 'a 6a tentativa do mesmo IP deveria ser bloqueada');
  assert.ok(!results.slice(0, 5).includes(429), 'as 5 primeiras nao deveriam ser bloqueadas por rate limit de IP');
});

// ─── 14. rate limit por telefone+slug ──────────────────────────────────────

test('rate limit por telefone+slug bloqueia apos 3 tentativas em 10 minutos', async (t) => {
  if (!dbAvailable(t)) return;

  const xff = '10.0.0.201';
  const results = [];
  for (let i = 0; i < 4; i++) {
    const res = await post(SLUG, {
      serviceId: SERVICE_PUBLIC_ID,
      startsAt: SLOT_TAKEN,
      clientName: 'Rate Limit Telefone',
      clientPhone: PHONE_RATE_PHONE,
    }, xff);
    results.push(res.status);
  }

  assert.equal(results.length, 4);
  assert.equal(results[3], 429, 'a 4a tentativa do mesmo telefone+slug deveria ser bloqueada');
  assert.ok(!results.slice(0, 3).includes(429), 'as 3 primeiras nao deveriam ser bloqueadas por rate limit de telefone');
});

// ─── 15. rollback — cliente não fica órfão se o agendamento falhar ───────

test('rollback: se a criacao do agendamento falhar por corrida, o cliente novo nao fica no banco', async (t) => {
  if (!dbAvailable(t)) return;

  const [resA, resB] = await Promise.all([
    post(SLUG, { serviceId: SERVICE_PUBLIC_ID, startsAt: SLOT_ROLLBACK, clientName: 'Rollback A', clientPhone: PHONE_ROLLBACK_A }, '10.0.0.15'),
    post(SLUG, { serviceId: SERVICE_PUBLIC_ID, startsAt: SLOT_ROLLBACK, clientName: 'Rollback B', clientPhone: PHONE_ROLLBACK_B }, '10.0.0.15'),
  ]);

  const statuses = [resA.status, resB.status];
  const winnerIsA = resA.status === 201;
  assert.ok(
    (resA.status === 201 && resB.status === 409) || (resA.status === 409 && resB.status === 201),
    `esperado um 201 e um 409, recebido: ${statuses}`
  );

  const loserPhone = winnerIsA ? PHONE_ROLLBACK_B : PHONE_ROLLBACK_A;
  const winnerPhone = winnerIsA ? PHONE_ROLLBACK_A : PHONE_ROLLBACK_B;

  const { rows: loserRows } = await pool.query('SELECT id FROM clients WHERE professional_id = $1 AND phone = $2', [PROF_ID, loserPhone]);
  assert.equal(loserRows.length, 0, 'cliente da requisicao perdedora nao deveria ter sido persistido (rollback da transacao)');

  const { rows: winnerRows } = await pool.query('SELECT id FROM clients WHERE professional_id = $1 AND phone = $2', [PROF_ID, winnerPhone]);
  assert.equal(winnerRows.length, 1, 'cliente da requisicao vencedora deveria existir normalmente');
});
