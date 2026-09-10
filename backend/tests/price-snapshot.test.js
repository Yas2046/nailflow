import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';

let server;
let baseUrl;
let dbAvailable = true;
let authToken;
let professionalId;

const PROFESSIONAL_EMAIL = 'snapshot_test@nailflow.com';
const PROFESSIONAL_PASSWORD = 'senha_teste_snapshot';

before(async () => {
  const { pool } = await import('../src/config/db.js');
  try {
    await pool.query('SELECT 1');
  } catch {
    dbAvailable = false;
  }

  const { default: app } = await import('../src/server.js');
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;

  if (!dbAvailable) return;

  // Cria profissional exclusivo para estes testes.
  const { default: bcrypt } = await import('bcryptjs');
  const hash = await bcrypt.hash(PROFESSIONAL_PASSWORD, 10);
  const { rows } = await pool.query(
    `INSERT INTO professionals (name, email, password_hash, phone_whatsapp, business_name)
     VALUES ('Snap Tester', $1, $2, '5531000000001', 'SnapStudio')
     RETURNING id`,
    [PROFESSIONAL_EMAIL, hash]
  );
  professionalId = rows[0].id;

  // Configura disponibilidade para todos os dias da semana.
  for (let weekday = 0; weekday <= 6; weekday++) {
    await pool.query(
      `INSERT INTO weekly_availability (professional_id, weekday, is_working, start_time, end_time)
       VALUES ($1, $2, true, '08:00', '22:00')
       ON CONFLICT (professional_id, weekday) DO NOTHING`,
      [professionalId, weekday]
    );
  }

  // Autentica.
  const loginRes = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: PROFESSIONAL_EMAIL, password: PROFESSIONAL_PASSWORD }),
  });
  const loginBody = await loginRes.json();
  authToken = loginBody.token;
});

after(async () => {
  const { pool } = await import('../src/config/db.js');

  if (dbAvailable && professionalId) {
    // Limpa todos os dados criados pelo teste (cascade garante clientes/serviços/agendamentos).
    await pool.query('DELETE FROM professionals WHERE id = $1', [professionalId]);
  }

  await new Promise((resolve) => server.close(resolve));
  await pool.end();
});

function authHeaders() {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${authToken}`,
  };
}

// Cria um serviço e retorna o objeto completo.
async function criarServico(name, priceCents, durationMinutes = 40) {
  const res = await fetch(`${baseUrl}/services`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ name, priceCents, durationMinutes }),
  });
  assert.equal(res.status, 201, `falha ao criar serviço "${name}": ${res.status}`);
  return res.json();
}

// Cria um cliente e retorna o objeto completo.
async function criarCliente(name) {
  const res = await fetch(`${baseUrl}/clients`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ name, phone: `5531${Date.now().toString().slice(-9)}` }),
  });
  assert.equal(res.status, 201, `falha ao criar cliente "${name}": ${res.status}`);
  return res.json();
}

// Cria um agendamento em data/hora futura e retorna o objeto completo.
async function criarAgendamento(clientId, serviceId, startsAt) {
  const res = await fetch(`${baseUrl}/appointments`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ clientId, serviceId, startsAt }),
  });
  assert.equal(res.status, 201, `falha ao criar agendamento: ${res.status} — ${JSON.stringify(await res.clone().json().catch(() => ({})))}`);
  return res.json();
}

// ─── Cenário principal ────────────────────────────────────────────────────────

test('snapshot captura preço do serviço no momento da criação', async (t) => {
  if (!dbAvailable) { t.skip('banco não disponível'); return; }

  const servico = await criarServico('Manicure Snap', 5000); // R$ 50,00
  const cliente  = await criarCliente('Ana Snapshot');

  // Agendamento 7 dias no futuro, 10:00, para evitar conflito.
  const startsAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  startsAt.setUTCHours(13, 0, 0, 0); // 10:00 BRT = 13:00 UTC

  const agendamento = await criarAgendamento(cliente.id, servico.id, startsAt.toISOString());

  assert.equal(agendamento.priceCentsSnapshot, 5000, 'snapshot deve ser 5000 (R$ 50,00)');
});

test('alterar preço do serviço não muda snapshot de agendamentos antigos', async (t) => {
  if (!dbAvailable) { t.skip('banco não disponível'); return; }

  const servico = await criarServico('Pedicure Snap', 5000); // R$ 50,00
  const cliente  = await criarCliente('Bia Snapshot');

  const startsAt = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000);
  startsAt.setUTCHours(14, 0, 0, 0);

  const agendamento = await criarAgendamento(cliente.id, servico.id, startsAt.toISOString());
  assert.equal(agendamento.priceCentsSnapshot, 5000);

  // Muda preço do serviço para R$ 60,00.
  const patchRes = await fetch(`${baseUrl}/services/${servico.id}`, {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify({ priceCents: 6000 }),
  });
  assert.equal(patchRes.status, 200, 'falha ao atualizar preço do serviço');

  // Busca o agendamento existente — snapshot deve permanecer 5000.
  const listRes = await fetch(`${baseUrl}/appointments`, { headers: authHeaders() });
  const lista = await listRes.json();
  const existente = lista.find((a) => a.id === agendamento.id);
  assert.ok(existente, 'agendamento não encontrado na listagem');
  assert.equal(existente.priceCentsSnapshot, 5000, 'snapshot do agendamento antigo não deve mudar ao alterar preço do serviço');
});

test('novo agendamento após mudança de preço captura preço novo', async (t) => {
  if (!dbAvailable) { t.skip('banco não disponível'); return; }

  const servico = await criarServico('Gel Snap', 5000); // R$ 50,00
  const cliente  = await criarCliente('Carla Snapshot');

  // Primeiro agendamento com R$ 50,00.
  const startsAt1 = new Date(Date.now() + 9 * 24 * 60 * 60 * 1000);
  startsAt1.setUTCHours(15, 0, 0, 0);
  const ag1 = await criarAgendamento(cliente.id, servico.id, startsAt1.toISOString());
  assert.equal(ag1.priceCentsSnapshot, 5000);

  // Muda preço para R$ 60,00.
  await fetch(`${baseUrl}/services/${servico.id}`, {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify({ priceCents: 6000 }),
  });

  // Segundo agendamento com o mesmo serviço — deve capturar R$ 60,00.
  const startsAt2 = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
  startsAt2.setUTCHours(16, 0, 0, 0);
  const ag2 = await criarAgendamento(cliente.id, servico.id, startsAt2.toISOString());
  assert.equal(ag2.priceCentsSnapshot, 6000, 'novo agendamento deve capturar preço atual do serviço (6000)');
});

test('cancelamento preserva o snapshot do agendamento', async (t) => {
  if (!dbAvailable) { t.skip('banco não disponível'); return; }

  const servico = await criarServico('Alongamento Snap', 12000);
  const cliente  = await criarCliente('Diana Snapshot');

  const startsAt = new Date(Date.now() + 11 * 24 * 60 * 60 * 1000);
  startsAt.setUTCHours(17, 0, 0, 0);

  const ag = await criarAgendamento(cliente.id, servico.id, startsAt.toISOString());
  assert.equal(ag.priceCentsSnapshot, 12000);

  // Cancela o agendamento.
  const cancelRes = await fetch(`${baseUrl}/appointments/${ag.id}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  assert.equal(cancelRes.status, 204, 'cancelamento deveria retornar 204');

  // Verifica que snapshot ainda está lá consultando diretamente pelo banco.
  const { pool } = await import('../src/config/db.js');
  const { rows } = await pool.query(
    'SELECT price_cents_snapshot, status FROM appointments WHERE id = $1',
    [ag.id]
  );
  assert.equal(rows[0].status, 'cancelado');
  assert.equal(rows[0].price_cents_snapshot, 12000, 'snapshot deve ser preservado após cancelamento');
});

test('atualizar somente o status não altera o snapshot', async (t) => {
  if (!dbAvailable) { t.skip('banco não disponível'); return; }

  const servico = await criarServico('Manicure Status Snap', 3500);
  const cliente  = await criarCliente('Eva Snapshot');

  const startsAt = new Date(Date.now() + 12 * 24 * 60 * 60 * 1000);
  startsAt.setUTCHours(18, 0, 0, 0);

  const ag = await criarAgendamento(cliente.id, servico.id, startsAt.toISOString());
  assert.equal(ag.priceCentsSnapshot, 3500);

  // Muda só o status para "confirmado".
  const patchRes = await fetch(`${baseUrl}/appointments/${ag.id}`, {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify({ status: 'confirmado' }),
  });
  assert.equal(patchRes.status, 200);
  const atualizado = await patchRes.json();
  assert.equal(atualizado.priceCentsSnapshot, 3500, 'snapshot não deve mudar ao alterar apenas o status');
});

test('trocar o serviço do agendamento atualiza o snapshot', async (t) => {
  if (!dbAvailable) { t.skip('banco não disponível'); return; }

  const servicoA = await criarServico('Serviço A Snap', 5000, 40);
  const servicoB = await criarServico('Serviço B Snap', 8000, 40);
  const cliente   = await criarCliente('Fabi Snapshot');

  const startsAt = new Date(Date.now() + 13 * 24 * 60 * 60 * 1000);
  startsAt.setUTCHours(19, 0, 0, 0);

  const ag = await criarAgendamento(cliente.id, servicoA.id, startsAt.toISOString());
  assert.equal(ag.priceCentsSnapshot, 5000);

  // Troca para serviço B (preço R$ 80,00).
  const patchRes = await fetch(`${baseUrl}/appointments/${ag.id}`, {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify({ serviceId: servicoB.id }),
  });
  assert.equal(patchRes.status, 200);
  const atualizado = await patchRes.json();
  assert.equal(atualizado.priceCentsSnapshot, 8000, 'snapshot deve ser recalculado ao trocar o serviço');
});
