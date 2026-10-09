/**
 * Integridade do status de agendamentos (Fase 0 caracterizou; Fase 1 protege).
 *
 * Os testes INTEG-01…19 vieram dos 19 testes de caracterização da Fase 0 e agora verificam o
 * comportamento protegido; cada um cita o que mudou em relação ao comportamento antigo. Os demais
 * (INTEG-20…) cobrem regras novas: horário, travas de campo, lotes, concorrência e o bot.
 *
 * Banco: usa só contas/dados criados pelo próprio arquivo e apaga tudo no final.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.BOT_API_KEY = 'chave-bot-teste-caract';

let pool;
let server;
let baseUrl;
let dbAvailable = true;
// DDL de teste (gatilho temporário do INTEG-25b) só com opt-in explícito E nome de banco no padrão de teste:
// começa com nf_ ou nailflow_ e termina com _test (ex.: nf_f1_test, nailflow_test). Sem correspondência parcial.
const DISPOSABLE_DB_NAME = /^(nf|nailflow)_([a-z0-9]+_)*test$/;
let ddlAllowed = false;
let dbName = '';
let cookieA;
let cookieB;
let profA;
let profB;
let serviceA;   // 5000 centavos, 10 min
let serviceA2;  // 9000 centavos, 20 min
let clientA;
let clientA2;
let clientCalc; // cliente exclusivo dos testes de receita e histórico
const realFetch = global.fetch;
let calls = [];

const EMAIL_A = 'caract_status_a@nailflow.com';
const EMAIL_B = 'caract_status_b@nailflow.com';
const PASS = 'senha_teste_caract';
const INST_A = 'inst-caract-status-a';
let botPhoneSeq = 0;

before(async () => {
  ({ pool } = await import('../src/config/db.js'));
  try { await pool.query('SELECT 1'); } catch { dbAvailable = false; }
  const { default: app } = await import('../src/server.js');
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  if (!dbAvailable) return;
  dbName = (await pool.query('SELECT current_database() AS d')).rows[0].d;
  ddlAllowed = process.env.NAILFLOW_ALLOW_TEST_DDL === '1' && DISPOSABLE_DB_NAME.test(dbName);
  await purge();

  const { default: bcrypt } = await import('bcryptjs');
  const hash = await bcrypt.hash(PASS, 10);
  const a = await pool.query(
    `INSERT INTO professionals (name, email, password_hash, phone_whatsapp, business_name, slug, wa_instance_name)
     VALUES ('Caract A', $1, $2, '5531000002001', 'Caract A Studio', 'teste-caract-status-a', $3) RETURNING id`,
    [EMAIL_A, hash, INST_A]
  );
  profA = a.rows[0].id;
  const b = await pool.query(
    `INSERT INTO professionals (name, email, password_hash, phone_whatsapp, business_name, slug)
     VALUES ('Caract B', $1, $2, '5531000002002', 'Caract B Studio', 'teste-caract-status-b') RETURNING id`,
    [EMAIL_B, hash]
  );
  profB = b.rows[0].id;
  serviceA = (await pool.query(
    `INSERT INTO services (professional_id, name, price_cents, duration_minutes) VALUES ($1,'Serviço 50',5000,10) RETURNING id`, [profA])).rows[0].id;
  serviceA2 = (await pool.query(
    `INSERT INTO services (professional_id, name, price_cents, duration_minutes) VALUES ($1,'Serviço 90',9000,20) RETURNING id`, [profA])).rows[0].id;
  clientA = (await pool.query(
    `INSERT INTO clients (professional_id, name, phone) VALUES ($1,'Cliente Um','5531988880001') RETURNING id`, [profA])).rows[0].id;
  clientA2 = (await pool.query(
    `INSERT INTO clients (professional_id, name, phone) VALUES ($1,'Cliente Dois','5531988880002') RETURNING id`, [profA])).rows[0].id;
  clientCalc = (await pool.query(
    `INSERT INTO clients (professional_id, name, phone) VALUES ($1,'Cliente Calculo','5531988880078') RETURNING id`, [profA])).rows[0].id;
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
  delete process.env.N8N_WEBHOOK_CANCELLED_URL;
  delete process.env.N8N_WEBHOOK_REJECTED_URL;
  if (dbAvailable) {
    await purge();
    await pool.end();
  }
  await new Promise((resolve) => server.close(resolve));
});

// Apaga as contas deste arquivo (e tudo que depende delas). Roda antes e depois: uma execução anterior
// interrompida (travamento, Ctrl+C) não pode deixar lixo que quebre a próxima.
async function purge() {
  if (ddlAllowed) {
    // resíduo de uma execução interrompida do INTEG-25b
    for (const sql of ['DROP TRIGGER IF EXISTS zz_test_boom ON appointments', 'DROP FUNCTION IF EXISTS zz_test_boom()']) {
      try { await pool.query(sql); } catch (err) { console.error('limpeza DDL:', err.message); }
    }
  }
  const { rows } = await pool.query('SELECT id FROM professionals WHERE email = ANY($1)', [[EMAIL_A, EMAIL_B]]);
  const ids = rows.map((r) => r.id);
  if (ids.length === 0) return;
  for (const sql of [
    'DELETE FROM appointments WHERE professional_id = ANY($1)',
    'DELETE FROM recurring_groups WHERE professional_id = ANY($1)',
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

async function req(method, path, body, cookie) {
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

async function botPost(path, body) {
  const res = await realFetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.BOT_API_KEY}` },
    body: JSON.stringify({ ...body, instance: INST_A }),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

// Cria uma cliente com telefone próprio, põe a conversa do bot em "confirmar cancelamento" e responde "sim".
async function botCancel({ status, when = 'future', ownerIsOther = false, forgedId = null }) {
  botPhoneSeq += 1;
  const phone = `55319888810${String(botPhoneSeq).padStart(2, '0')}`;
  const otherPhone = `55319888820${String(botPhoneSeq).padStart(2, '0')}`;
  const botClient = (await pool.query(
    `INSERT INTO clients (professional_id, name, phone) VALUES ($1,'Cliente Bot',$2) RETURNING id`, [profA, phone])).rows[0].id;
  const owner = ownerIsOther
    ? (await pool.query(`INSERT INTO clients (professional_id, name, phone) VALUES ($1,'Outra Cliente',$2) RETURNING id`, [profA, otherPhone])).rows[0].id
    : botClient;
  const id = await insertAppt({ status, when, clientId: owner });
  const set = await botPost(`/bot/conversation/${phone}`, {
    botState: 'AGUARDANDO_CONFIRMACAO_CANCELAMENTO', context: { apptIdToCancel: forgedId ?? id },
  });
  assert.equal(set.status, 200, JSON.stringify(set.json));
  const proc = await botPost('/bot/process', { phone, text: 'sim', waMessageId: `wa-integ-${Date.now()}-${botPhoneSeq}`, fromMe: false, pushName: 'Cliente Bot' });
  assert.equal(proc.status, 200, JSON.stringify(proc.json));
  return { id, reply: proc.json?.reply ?? '' };
}

function captureN8n() {
  calls = [];
  process.env.N8N_WEBHOOK_CONFIRMED_URL = 'http://n8n-test/confirmed';
  process.env.N8N_WEBHOOK_CANCELLED_URL = 'http://n8n-test/cancelled';
  process.env.N8N_WEBHOOK_REJECTED_URL = 'http://n8n-test/rejected';
  global.fetch = async (url, opts) => {
    calls.push({ url, event: JSON.parse(opts.body).event });
    return { ok: true };
  };
}
const settle = () => new Promise((r) => setTimeout(r, 40));
const events = () => calls.map((c) => c.event);

// Datas: passado = 2026 (já decorrido), futuro = 2029; 13:00Z = 10:00 em São Paulo (dentro do expediente 08–22).
let dayN = 0;
function startsAtFor(when, hourUtc = 13) {
  dayN += 1;
  const base = when === 'past' ? Date.UTC(2026, 0, 5) : Date.UTC(2029, 0, 1);
  return new Date(base + dayN * 86400000 + hourUtc * 3600000);
}

async function insertAppt({
  status = 'pendente', when = 'past', startsAt = null, minutes = 10, clientId = clientA, serviceId = serviceA,
  expiresAt = null, cancelReason = null, groupId = null, source = null, price = 5000, prof = profA,
} = {}) {
  const start = startsAt ?? startsAtFor(when);
  const end = new Date(start.getTime() + minutes * 60000);
  const { rows } = await pool.query(
    `INSERT INTO appointments (professional_id, client_id, service_id, starts_at, ends_at, status, price_cents_snapshot,
                               expires_at, cancel_reason, recurring_group_id, source)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
    [prof, clientId, serviceId, start, end, status, price, expiresAt, cancelReason, groupId, source]
  );
  return rows[0].id;
}
const rowOf = async (id) => (await pool.query(
  `SELECT status, cancel_reason, expires_at, service_id, client_id, price_cents_snapshot, starts_at, notes
   FROM appointments WHERE id = $1`, [id])).rows[0];
async function makeGroup(prof = profA) {
  return (await pool.query(
    `INSERT INTO recurring_groups (professional_id, frequency, ends_on) VALUES ($1,'weekly','2030-01-01') RETURNING id`, [prof])).rows[0].id;
}
const put = (id, body) => req('PUT', `/appointments/${id}`, body, cookieA);

// ───────────────────────── transições pelo PUT ─────────────────────────

test('INTEG-01 PUT a partir de pendente/aguardando_pagamento NÃO conclui nem marca falta (antes: aceito)', async (t) => {
  if (!dbAvailable) return t.skip('sem banco');
  for (const status of ['pendente', 'aguardando_pagamento']) {
    for (const target of ['concluido', 'nao_compareceu']) {
      const id = await insertAppt({ status, expiresAt: status === 'pendente' ? null : new Date(Date.now() + 3600000) });
      const r = await put(id, { status: target });
      assert.equal(r.status, 409, `${status} → ${target}`);
      assert.equal(r.body.reason, 'invalid_transition');
      assert.equal((await rowOf(id)).status, status);
    }
  }
});

test('INTEG-02 PUT para aguardando_pagamento é bloqueado (antes: aceito e sem validade); mesmo status continua aceito', async (t) => {
  if (!dbAvailable) return t.skip('sem banco');
  const id = await insertAppt({ status: 'pendente' });
  const r = await put(id, { status: 'aguardando_pagamento' });
  assert.equal(r.status, 409);
  assert.equal(r.body.reason, 'invalid_transition');
  assert.equal((await rowOf(id)).status, 'pendente');
  assert.equal((await put(id, { status: 'pendente', notes: 'mesmo status' })).status, 200);
});

test('INTEG-03 transições mantidas: confirmado → pendente; confirmado (já iniciado) → concluido/nao_compareceu; concluido ↔ nao_compareceu', async (t) => {
  if (!dbAvailable) return t.skip('sem banco');
  const c = await insertAppt({ status: 'confirmado' });
  assert.equal((await put(c, { status: 'pendente' })).status, 200);
  const d = await insertAppt({ status: 'confirmado' });
  assert.equal((await put(d, { status: 'concluido' })).status, 200);
  assert.equal((await put(d, { status: 'nao_compareceu' })).status, 200);
  assert.equal((await put(d, { status: 'concluido' })).status, 200);
  const e = await insertAppt({ status: 'confirmado' });
  assert.equal((await put(e, { status: 'nao_compareceu' })).status, 200);
});

test('INTEG-04 concluido/nao_compareceu → confirmado segue bloqueado; a correção via pendente continua e NÃO reenvia confirmação', async (t) => {
  if (!dbAvailable) return t.skip('sem banco');
  const id = await insertAppt({ status: 'concluido' });
  captureN8n();
  const direct = await put(id, { status: 'confirmado' });
  assert.equal(direct.status, 409);
  assert.equal(direct.body.reason, 'invalid_transition');
  assert.equal((await put(id, { status: 'pendente' })).status, 200);
  const second = await put(id, { status: 'confirmado' });
  assert.equal(second.status, 200);
  assert.equal(second.body.notificationSkipped, 'past');
  await settle();
  assert.deepEqual(events(), [], 'antes: a 2ª etapa reenviava a confirmação à cliente');
});

test('INTEG-05 cancelado: → confirmado bloqueado; → pendente só sem motivo; rejected/expired não reabrem; motivo incoerente é limpo', async (t) => {
  if (!dbAvailable) return t.skip('sem banco');
  const plain = await insertAppt({ status: 'cancelado' });
  assert.equal((await put(plain, { status: 'confirmado' })).status, 409);
  assert.equal((await put(plain, { status: 'pendente' })).status, 200);
  assert.deepEqual({ ...(await rowOf(plain)) }.status, 'pendente');

  for (const reason of ['rejected', 'expired']) {
    const id = await insertAppt({ status: 'cancelado', cancelReason: reason });
    const r = await put(id, { status: 'pendente' });
    assert.equal(r.status, 409, reason);
    assert.equal(r.body.reason, 'invalid_transition');
    assert.deepEqual({ s: (await rowOf(id)).status, r: (await rowOf(id)).cancel_reason }, { s: 'cancelado', r: reason });
  }
  // dado antigo incoerente (pendente com motivo de cancelamento): qualquer edição limpa o motivo
  const stale = await insertAppt({ status: 'pendente', cancelReason: 'expired' });
  assert.equal((await put(stale, { notes: 'limpa' })).status, 200);
  assert.equal((await rowOf(stale)).cancel_reason, null);
});

test('INTEG-06 PUT concluido/nao_compareceu → cancelado é bloqueado (antes: aceito)', async (t) => {
  if (!dbAvailable) return t.skip('sem banco');
  for (const status of ['concluido', 'nao_compareceu']) {
    const id = await insertAppt({ status });
    captureN8n();
    const r = await put(id, { status: 'cancelado' });
    assert.equal(r.status, 409);
    assert.equal((await rowOf(id)).status, status);
    await settle();
    assert.deepEqual(events(), []);
  }
});

// ───────────────────────── notificações ─────────────────────────

test('INTEG-07 confirmar agendamento PASSADO não notifica (PUT e /confirm); futuro notifica uma vez', async (t) => {
  if (!dbAvailable) return t.skip('sem banco');
  const viaPut = await insertAppt({ status: 'pendente', when: 'past' });
  const viaPost = await insertAppt({ status: 'pendente', when: 'past' });
  captureN8n();
  const a = await put(viaPut, { status: 'confirmado' });
  const b = await req('POST', `/appointments/${viaPost}/confirm`, undefined, cookieA);
  assert.equal(a.status, 200); assert.equal(b.status, 200);
  assert.equal(a.body.notificationSkipped, 'past');
  assert.equal(b.body.notificationSkipped, 'past');
  assert.equal(b.body.changed, true);
  await settle();
  assert.deepEqual(events(), []);

  const f1 = await insertAppt({ status: 'pendente', when: 'future' });
  const f2 = await insertAppt({ status: 'pendente', when: 'future' });
  captureN8n();
  const c = await put(f1, { status: 'confirmado' });
  const d = await req('POST', `/appointments/${f2}/confirm`, undefined, cookieA);
  assert.equal(c.body.notificationSkipped, undefined);
  assert.equal(d.body.notificationSkipped, undefined);
  await settle();
  assert.deepEqual(events(), ['appointment.confirmed', 'appointment.confirmed']);
  // repetir não notifica de novo
  captureN8n();
  assert.equal((await req('POST', `/appointments/${f2}/confirm`, undefined, cookieA)).body.changed, false);
  await settle();
  assert.deepEqual(events(), []);
});

test('INTEG-08 mark-paid: passado não notifica; futuro notifica', async (t) => {
  if (!dbAvailable) return t.skip('sem banco');
  const past = await insertAppt({ status: 'aguardando_pagamento', when: 'past', expiresAt: new Date(Date.now() + 3600000) });
  const fut = await insertAppt({ status: 'aguardando_pagamento', when: 'future', expiresAt: new Date(Date.now() + 3600000) });
  captureN8n();
  const a = await req('POST', `/appointments/${past}/mark-paid`, undefined, cookieA);
  assert.equal(a.status, 200);
  assert.equal(a.body.notificationSkipped, 'past');
  await settle();
  assert.deepEqual(events(), []);
  captureN8n();
  assert.equal((await req('POST', `/appointments/${fut}/mark-paid`, undefined, cookieA)).status, 200);
  await settle();
  assert.deepEqual(events(), ['appointment.confirmed']);
});

test('INTEG-09 DELETE: concluído/falta → 409 sem alterar; futuro cancela e notifica uma vez; repetir é 204 sem novo aviso (M18)', async (t) => {
  if (!dbAvailable) return t.skip('sem banco');
  captureN8n();
  for (const status of ['concluido', 'nao_compareceu']) {
    const id = await insertAppt({ status });
    const r = await req('DELETE', `/appointments/${id}`, undefined, cookieA);
    assert.equal(r.status, 409);
    assert.equal(r.body.reason, 'invalid_transition');
    assert.equal((await rowOf(id)).status, status);
  }
  await settle();
  assert.deepEqual(events(), []);

  const id = await insertAppt({ status: 'confirmado', when: 'future' });
  captureN8n();
  assert.equal((await req('DELETE', `/appointments/${id}`, undefined, cookieA)).status, 204);
  assert.equal((await req('DELETE', `/appointments/${id}`, undefined, cookieA)).status, 204);
  await settle();
  assert.equal((await rowOf(id)).status, 'cancelado');
  assert.deepEqual(events(), ['appointment.cancelled']);
  assert.equal((await req('DELETE', `/appointments/00000000-0000-4000-8000-000000000000`, undefined, cookieA)).status, 404);
});

test('INTEG-10 DELETE de agendamento já iniciado cancela mas NÃO notifica a cliente', async (t) => {
  if (!dbAvailable) return t.skip('sem banco');
  const id = await insertAppt({ status: 'confirmado', when: 'past' });
  captureN8n();
  assert.equal((await req('DELETE', `/appointments/${id}`, undefined, cookieA)).status, 204);
  await settle();
  assert.equal((await rowOf(id)).status, 'cancelado');
  assert.deepEqual(events(), []);
});

// ───────────────────────── edição de campos ─────────────────────────

test('INTEG-11 PUT em CONCLUÍDO/FALTA trava cliente, serviço e horário (antes: aceito e reescrevia a receita); observação continua livre', async (t) => {
  if (!dbAvailable) return t.skip('sem banco');
  for (const status of ['concluido', 'nao_compareceu']) {
    const id = await insertAppt({ status, price: 5000 });
    const start = (await rowOf(id)).starts_at;
    const moved = new Date(start.getTime() + 2 * 3600000);

    const svc = await put(id, { serviceId: serviceA2, startsAt: start.toISOString() });
    assert.equal(svc.status, 409);
    assert.equal(svc.body.reason, 'locked_field');
    assert.deepEqual(svc.body.fields, ['serviceId']);
    assert.equal((await put(id, { clientId: clientA2 })).status, 409);
    const mv = await put(id, { startsAt: moved.toISOString() });
    assert.equal(mv.status, 409);
    assert.deepEqual(mv.body.fields, ['startsAt']);
    const row = await rowOf(id);
    assert.equal(row.price_cents_snapshot, 5000);
    assert.equal(row.client_id, clientA);
    assert.equal(row.starts_at.getTime(), start.getTime());

    // o modal reenvia tudo a cada edição: valores iguais + observação nova passa
    const same = await put(id, { clientId: clientA, serviceId: serviceA, startsAt: start.toISOString(), status, notes: 'só a observação' });
    assert.equal(same.status, 200);
    assert.equal((await rowOf(id)).notes, 'só a observação');
    assert.equal((await rowOf(id)).price_cents_snapshot, 5000);
  }
  // mudar status e campo no mesmo pedido também é bloqueado (vale o status atual)
  const id = await insertAppt({ status: 'concluido' });
  assert.equal((await put(id, { status: 'pendente', clientId: clientA2 })).status, 409);
  assert.equal((await rowOf(id)).status, 'concluido');
});

test('INTEG-12 editar a observação reenviando o MESMO horário funciona mesmo fora do expediente (antes: 409); mudar para outro horário inválido continua 409', async (t) => {
  if (!dbAvailable) return t.skip('sem banco');
  const early = startsAtFor('past', 5); // 05:00Z = 02:00 em São Paulo, fora do expediente
  const id = await insertAppt({ status: 'confirmado', startsAt: early });
  assert.equal((await put(id, { notes: 'só observação' })).status, 200);
  assert.equal((await put(id, { notes: 'de novo', startsAt: early.toISOString() })).status, 200);
  const other = new Date(early.getTime() + 3600000); // 03:00 SP, ainda fora do expediente
  const moved = await put(id, { notes: 'x', startsAt: other.toISOString() });
  assert.equal(moved.status, 409);
  assert.ok(moved.body.reason);
});

test('INTEG-13 PUT …/and-following avalia linha a linha: não ressuscita cancelado, respeita validade e transições, devolve resumo', async (t) => {
  if (!dbAvailable) return t.skip('sem banco');
  const g = await makeGroup();
  const exp = new Date(Date.now() + 86400000 * 3);
  const r1 = await insertAppt({ status: 'pendente', when: 'future', groupId: g });
  const r2 = await insertAppt({ status: 'cancelado', when: 'future', groupId: g, cancelReason: 'rejected' });
  const r3 = await insertAppt({ status: 'concluido', when: 'future', groupId: g });
  const r4 = await insertAppt({ status: 'pendente', when: 'future', groupId: g, expiresAt: exp });
  const r5 = await insertAppt({ status: 'pendente', when: 'future', groupId: g, expiresAt: new Date(Date.now() - 60000) });
  captureN8n();
  const r = await put(`${r1}/and-following`, { status: 'confirmado' });
  assert.equal(r.status, 200);
  assert.equal(r.body.id, r1, 'continua devolvendo o agendamento alvo');
  assert.deepEqual(
    { updated: r.body.updated, unchanged: r.body.unchanged, skipped: r.body.skipped, total: r.body.total },
    { updated: 2, unchanged: 0, skipped: 3, total: 5 });
  assert.deepEqual(r.body.reasons, { cancelled: 1, attended_protected: 1, hold_expired: 1 });
  assert.equal(r.body.skippedItems.length, 3);
  assert.deepEqual(r.body.skippedItems.map((s) => s.id).sort(), [r2, r3, r5].sort());
  assert.equal((await rowOf(r1)).status, 'confirmado');
  assert.deepEqual({ s: (await rowOf(r2)).status, r: (await rowOf(r2)).cancel_reason }, { s: 'cancelado', r: 'rejected' });
  assert.equal((await rowOf(r3)).status, 'concluido');
  const row4 = await rowOf(r4);
  assert.equal(row4.status, 'confirmado');
  assert.equal(row4.expires_at, null, 'confirmar limpa a validade');
  assert.equal((await rowOf(r5)).status, 'pendente');
  await settle();
  assert.deepEqual(events(), [], 'lotes não notificam');
});

test('INTEG-13b PUT …/and-following: concluir só vale para confirmados que já começaram; observação não atinge cancelados', async (t) => {
  if (!dbAvailable) return t.skip('sem banco');
  const g = await makeGroup();
  const p1 = await insertAppt({ status: 'confirmado', when: 'past', groupId: g });
  const p2 = await insertAppt({ status: 'confirmado', when: 'past', groupId: g });
  const p3 = await insertAppt({ status: 'cancelado', when: 'past', groupId: g });
  const fu = await insertAppt({ status: 'confirmado', when: 'future', groupId: g });
  const r = await put(`${p1}/and-following`, { status: 'concluido' });
  assert.equal(r.status, 200);
  assert.deepEqual({ u: r.body.updated, s: r.body.skipped, t: r.body.total }, { u: 2, s: 2, t: 4 });
  assert.deepEqual(r.body.reasons, { cancelled: 1, too_early: 1 });
  assert.deepEqual([(await rowOf(p1)).status, (await rowOf(p2)).status, (await rowOf(p3)).status, (await rowOf(fu)).status],
    ['concluido', 'concluido', 'cancelado', 'confirmado']);

  const notes = await put(`${p1}/and-following`, { notes: 'observação da série' });
  assert.equal(notes.status, 200);
  assert.equal(notes.body.updated, 3, 'concluídos e o confirmado futuro recebem a observação');
  assert.equal((await rowOf(p3)).notes, null, 'cancelado não é tocado');
  assert.equal((await rowOf(p2)).notes, 'observação da série');
  const again = await put(`${p1}/and-following`, { notes: 'observação da série' });
  assert.equal(again.body.updated, 0);
  assert.equal(again.body.unchanged, 3);
});

test('INTEG-14 DELETE …/and-following: 200 com resumo; concluídos e faltas são preservados; cancelados contam como já cancelados; repetir não altera', async (t) => {
  if (!dbAvailable) return t.skip('sem banco');
  const g = await makeGroup();
  const target = await insertAppt({ status: 'confirmado', when: 'future', groupId: g });
  const concluido = await insertAppt({ status: 'concluido', when: 'future', groupId: g });
  const falta = await insertAppt({ status: 'nao_compareceu', when: 'future', groupId: g });
  const jaCancelado = await insertAppt({ status: 'cancelado', when: 'future', groupId: g, cancelReason: 'expired' });
  const pend = await insertAppt({ status: 'pendente', when: 'future', groupId: g });
  captureN8n();
  const r = await req('DELETE', `/appointments/${target}/and-following`, undefined, cookieA);
  assert.equal(r.status, 200);
  assert.deepEqual(
    { updated: r.body.updated, unchanged: r.body.unchanged, skipped: r.body.skipped, total: r.body.total },
    { updated: 2, unchanged: 1, skipped: 2, total: 5 });
  assert.deepEqual(r.body.reasons, { attended_protected: 2 });
  assert.equal((await rowOf(target)).status, 'cancelado');
  assert.equal((await rowOf(pend)).status, 'cancelado');
  assert.equal((await rowOf(concluido)).status, 'concluido');
  assert.equal((await rowOf(falta)).status, 'nao_compareceu');
  assert.equal((await rowOf(jaCancelado)).cancel_reason, 'expired');
  await settle();
  assert.deepEqual(events(), []);

  const again = await req('DELETE', `/appointments/${target}/and-following`, undefined, cookieA);
  assert.equal(again.status, 200);
  assert.deepEqual({ u: again.body.updated, n: again.body.unchanged, s: again.body.skipped }, { u: 0, n: 3, s: 2 });
});

// ───────────────────────── criação ─────────────────────────

test('INTEG-15 POST /appointments: status inicial restrito; concluído/falta só como registro retroativo (ends_at <= agora)', async (t) => {
  if (!dbAvailable) return t.skip('sem banco');
  const post = (when, status) => req('POST', '/appointments',
    { clientId: clientA, serviceId: serviceA, startsAt: startsAtFor(when).toISOString(), ...(status ? { status } : {}) }, cookieA);

  for (const [when, status] of [['future', undefined], ['future', 'pendente'], ['future', 'confirmado'], ['past', 'pendente']]) {
    const r = await post(when, status);
    assert.equal(r.status, 201, `${status}/${when}: ${JSON.stringify(r.body)}`);
    assert.equal(r.body.status, status ?? 'pendente');
  }
  for (const status of ['concluido', 'nao_compareceu']) {
    const ok = await post('past', status);
    assert.equal(ok.status, 201, `retroativo ${status}: ${JSON.stringify(ok.body)}`);
    assert.equal(ok.body.status, status);
    const fut = await post('future', status);
    assert.equal(fut.status, 400, `futuro ${status}`);
    assert.equal(fut.body.reason, 'invalid_initial_status');
  }
  for (const status of ['aguardando_pagamento', 'cancelado']) {
    for (const when of ['past', 'future']) {
      const r = await post(when, status);
      assert.equal(r.status, 400, `${status}/${when}`);
      assert.equal(r.body.reason, 'invalid_initial_status');
    }
  }
});

// ───────────────────────── ids malformados e isolamento ─────────────────────────

test('INTEG-16 id malformado devolve 400 (antes: 500) em todas as rotas com :id; sem sessão continua 401', async (t) => {
  if (!dbAvailable) return t.skip('sem banco');
  const bad = 'nao-e-uuid';
  for (const [m, p, b] of [
    ['PUT', `/appointments/${bad}`, { status: 'confirmado' }],
    ['DELETE', `/appointments/${bad}`, undefined],
    ['POST', `/appointments/${bad}/confirm`, undefined],
    ['POST', `/appointments/${bad}/reject`, undefined],
    ['POST', `/appointments/${bad}/mark-paid`, undefined],
    ['PUT', `/appointments/${bad}/and-following`, { status: 'confirmado' }],
    ['DELETE', `/appointments/${bad}/and-following`, undefined],
  ]) {
    const r = await req(m, p, b, cookieA);
    assert.equal(r.status, 400, `${m} ${p}`);
    assert.ok(r.body.error);
    assert.equal((await req(m, p, b, undefined)).status, 401, `sem sessão: ${m} ${p}`);
  }
});

test('INTEG-17 outra profissional recebe 404 em PUT, DELETE, confirm e lotes e nada muda', async (t) => {
  if (!dbAvailable) return t.skip('sem banco');
  const g = await makeGroup();
  const id = await insertAppt({ status: 'pendente', when: 'future', groupId: g });
  for (const [m, p, b] of [
    ['PUT', `/appointments/${id}`, { status: 'confirmado' }],
    ['DELETE', `/appointments/${id}`, undefined],
    ['POST', `/appointments/${id}/confirm`, undefined],
    ['PUT', `/appointments/${id}/and-following`, { status: 'confirmado' }],
    ['DELETE', `/appointments/${id}/and-following`, undefined],
  ]) {
    const r = await req(m, p, b, cookieB);
    assert.equal(r.status, 404, `${m} ${p}`);
  }
  assert.equal((await rowOf(id)).status, 'pendente');
});

// ───────────────────────── bot ─────────────────────────

test('INTEG-18 bot: concluído e falta NÃO são cancelados (antes: cancelava); cancelável cancela; já cancelado, de outra cliente e id forjado são tratados sem 500', async (t) => {
  if (!dbAvailable) return t.skip('sem banco');
  for (const status of ['concluido', 'nao_compareceu']) {
    const { id, reply } = await botCancel({ status });
    assert.equal((await rowOf(id)).status, status);
    assert.match(reply, /não pode ser cancelado/);
  }
  const ok = await botCancel({ status: 'confirmado' });
  assert.equal((await rowOf(ok.id)).status, 'cancelado');
  assert.match(ok.reply, /Prontinho, cancelado/);

  const already = await botCancel({ status: 'cancelado' });
  assert.equal((await rowOf(already.id)).status, 'cancelado');
  assert.match(already.reply, /já estava cancelado/);

  const other = await botCancel({ status: 'confirmado', ownerIsOther: true });
  assert.equal((await rowOf(other.id)).status, 'confirmado', 'agendamento de outra cliente não é cancelado');
  assert.match(other.reply, /não encontrado/);

  const forged = await botCancel({ status: 'confirmado', forgedId: 'nao-e-uuid' });
  assert.equal((await rowOf(forged.id)).status, 'confirmado');
  assert.match(forged.reply, /não encontrado/);
});

// ───────────────────────── receita e histórico (regra "só concluído") ─────────────────────────

test('INTEG-19 receita realizada conta só concluído; confirmado passado não entra; previsto exclui o passado; clientes contam só concluído (regra inalterada)', async (t) => {
  if (!dbAvailable) return t.skip('sem banco');
  const now = Date.now();
  const sp = (ms) => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }).slice(0, 7);
  if (sp(now - 5 * 3600000) !== sp(now)) return t.skip('início do mês em São Paulo: evita virada de mês no teste');
  await insertAppt({ status: 'concluido', startsAt: new Date(now - 2 * 3600000), clientId: clientCalc, price: 5000 });
  await insertAppt({ status: 'confirmado', startsAt: new Date(now - 4 * 3600000), clientId: clientCalc, price: 7000 });
  const dash = await req('GET', '/dashboard', undefined, cookieA);
  assert.equal(dash.status, 200);
  const m = dash.body.mes;
  assert.equal(m.faturamentoRealizadoCents, 5000);
  assert.equal(m.agendamentosConcluidos, 1);
  const futuro = await pool.query(
    "SELECT COALESCE(SUM(price_cents_snapshot),0)::int AS total FROM appointments WHERE professional_id = $1 AND starts_at > now() AND status IN ('pendente','confirmado')", [profA]);
  assert.equal(m.faturamentoPrevistoCents, futuro.rows[0].total, 'previsto = todo o futuro pendente/confirmado; o confirmado passado de 7000 fica fora');

  const today = new Date(now).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  const sum = await req('GET', `/expenses/summary?from=${today.slice(0, 7)}-01&to=${today}`, undefined, cookieA);
  assert.equal(sum.status, 200);
  assert.equal(sum.body.faturadoCents, 5000);

  const clients = await req('GET', '/clients', undefined, cookieA);
  const calc = clients.body.find((c) => c.id === clientCalc);
  assert.equal(calc.totalAtendimentos, 1);
  assert.ok(calc.ultimoAtendimento);
});

// ───────────────────────── regras novas ─────────────────────────

test('INTEG-20 PUT confirmado → concluido/nao_compareceu só depois que o atendimento começa (too_early)', async (t) => {
  if (!dbAvailable) return t.skip('sem banco');
  for (const target of ['concluido', 'nao_compareceu']) {
    const id = await insertAppt({ status: 'confirmado', when: 'future' });
    const r = await put(id, { status: target });
    assert.equal(r.status, 409);
    assert.equal(r.body.reason, 'too_early');
    assert.equal((await rowOf(id)).status, 'confirmado');
  }
  // em andamento: já começou, ainda não terminou → pode concluir
  const live = await insertAppt({ status: 'confirmado', startsAt: new Date(Date.now() - 5 * 60000), minutes: 60 });
  assert.equal((await put(live, { status: 'concluido' })).status, 200);
});

test('INTEG-21 o preço do registro só é refeito quando o serviço realmente muda (reenviar o mesmo serviço preserva)', async (t) => {
  if (!dbAvailable) return t.skip('sem banco');
  const id = await insertAppt({ status: 'pendente', when: 'future', price: 5000 });
  await pool.query('UPDATE services SET price_cents = 6000 WHERE id = $1', [serviceA]);
  try {
    const same = await put(id, { serviceId: serviceA, status: 'pendente', notes: 'sem trocar serviço' });
    assert.equal(same.status, 200);
    assert.equal((await rowOf(id)).price_cents_snapshot, 5000, 'antes: virava 6000 a cada edição');
    const changed = await put(id, { serviceId: serviceA2, startsAt: (await rowOf(id)).starts_at.toISOString() });
    assert.equal(changed.status, 200);
    assert.equal((await rowOf(id)).price_cents_snapshot, 9000);
  } finally {
    await pool.query('UPDATE services SET price_cents = 5000 WHERE id = $1', [serviceA]);
  }
});

test('INTEG-22 corrida: cancelar e concluir o mesmo agendamento ao mesmo tempo nunca deixa os dois valerem', async (t) => {
  if (!dbAvailable) return t.skip('sem banco');
  const outcomes = new Set();
  for (let i = 0; i < 6; i++) {
    const id = await insertAppt({ status: 'confirmado', when: 'past' });
    const [del, upd] = await Promise.all([
      req('DELETE', `/appointments/${id}`, undefined, cookieA),
      put(id, { status: 'concluido' }),
    ]);
    const final = (await rowOf(id)).status;
    if (final === 'concluido') {
      assert.equal(upd.status, 200); assert.equal(del.status, 409);
    } else {
      assert.equal(final, 'cancelado');
      assert.equal(del.status, 204); assert.equal(upd.status, 409);
    }
    outcomes.add(final);
  }
  console.log('   desfechos da corrida →', [...outcomes].join(', '));
});

test('INTEG-23 corrida: lote e edição simultâneos mantêm a série coerente (nenhum concluído vira cancelado)', async (t) => {
  if (!dbAvailable) return t.skip('sem banco');
  const g = await makeGroup();
  const ids = [];
  for (let i = 0; i < 4; i++) ids.push(await insertAppt({ status: 'confirmado', when: 'past', groupId: g }));
  const [batch, single] = await Promise.all([
    req('DELETE', `/appointments/${ids[0]}/and-following`, undefined, cookieA),
    put(ids[2], { status: 'concluido' }),
  ]);
  assert.equal(batch.status, 200);
  assert.ok([200, 409].includes(single.status));
  const final = await Promise.all(ids.map(async (id) => (await rowOf(id)).status));
  if (single.status === 200) {
    assert.equal(final[2], 'concluido', 'o lote passou depois e preservou o concluído');
    assert.equal(batch.body.skipped, 1);
  } else {
    assert.equal(final[2], 'cancelado');
  }
});

// ───────────────────────── correções da auditoria da Fase 1 ─────────────────────────

test('INTEG-24 reabrir cancelado → pendente revalida bloqueio, expediente, almoço, serviço ativo e conflito', async (t) => {
  if (!dbAvailable) return t.skip('sem banco');
  const weekdayOf = (d) => new Date(d).getUTCDay(); // 13:00Z = 10:00 SP: mesmo dia da semana nos dois fusos
  const reopen = (id, extra = {}) => put(id, { status: 'pendente', ...extra });

  // 1) horário bloqueado depois do cancelamento
  const s1 = startsAtFor('future');
  const a1 = await insertAppt({ status: 'cancelado', startsAt: s1 });
  const block = (await pool.query(
    `INSERT INTO blocked_times (professional_id, starts_at, ends_at) VALUES ($1,$2,$3) RETURNING id`,
    [profA, new Date(s1.getTime() - 30 * 60000), new Date(s1.getTime() + 60 * 60000)])).rows[0].id;
  const r1 = await reopen(a1);
  assert.equal(r1.status, 409);
  assert.equal(r1.body.reason, 'blocked_time');
  assert.equal((await rowOf(a1)).status, 'cancelado');
  // o modal reenvia o horário: mesmo resultado
  assert.equal((await reopen(a1, { startsAt: s1.toISOString() })).body.reason, 'blocked_time');
  // editar só a observação do cancelado não depende do bloqueio
  assert.equal((await put(a1, { notes: 'só observação' })).status, 200);
  await pool.query('DELETE FROM blocked_times WHERE id = $1', [block]);
  assert.equal((await reopen(a1)).status, 200);
  assert.equal((await rowOf(a1)).status, 'pendente');

  // 2) fora do expediente (profissional passou a começar às 11:00 nesse dia da semana)
  const s2 = startsAtFor('future');
  const a2 = await insertAppt({ status: 'cancelado', startsAt: s2 });
  await pool.query(`UPDATE weekly_availability SET start_time = '11:00' WHERE professional_id = $1 AND weekday = $2`, [profA, weekdayOf(s2)]);
  try {
    const r2 = await reopen(a2);
    assert.equal(r2.status, 409);
    assert.equal(r2.body.reason, 'outside_working_hours');
    assert.equal((await rowOf(a2)).status, 'cancelado');
  } finally {
    await pool.query(`UPDATE weekly_availability SET start_time = '08:00' WHERE professional_id = $1 AND weekday = $2`, [profA, weekdayOf(s2)]);
  }

  // 3) intervalo de almoço
  const s3 = startsAtFor('future');
  const a3 = await insertAppt({ status: 'cancelado', startsAt: s3 });
  await pool.query(`UPDATE weekly_availability SET break_start = '09:30', break_end = '10:30' WHERE professional_id = $1 AND weekday = $2`, [profA, weekdayOf(s3)]);
  try {
    const r3 = await reopen(a3);
    assert.equal(r3.status, 409);
    assert.equal(r3.body.reason, 'lunch_break');
  } finally {
    await pool.query(`UPDATE weekly_availability SET break_start = NULL, break_end = NULL WHERE professional_id = $1 AND weekday = $2`, [profA, weekdayOf(s3)]);
  }

  // 4) serviço desativado
  const svc = (await pool.query(
    `INSERT INTO services (professional_id, name, price_cents, duration_minutes) VALUES ($1,'Serviço Inativo',4000,30) RETURNING id`, [profA])).rows[0].id;
  const a4 = await insertAppt({ status: 'cancelado', when: 'future', serviceId: svc, price: 4000, minutes: 30 });
  await pool.query('UPDATE services SET active = false WHERE id = $1', [svc]);
  const r4 = await reopen(a4);
  assert.equal(r4.status, 409);
  assert.equal(r4.body.reason, 'inactive_service');
  assert.equal((await rowOf(a4)).status, 'cancelado');

  // 5) conflito com outro agendamento que passou a ocupar o horário
  const s5 = startsAtFor('future');
  const a5 = await insertAppt({ status: 'cancelado', startsAt: s5 });
  await insertAppt({ status: 'confirmado', startsAt: s5, clientId: clientA2 });
  const r5 = await reopen(a5);
  assert.equal(r5.status, 409);
  assert.equal(r5.body.reason, 'appointment_overlap');

  // 6) horário válido: reabre; a duração acompanha o serviço atual
  const a6 = await insertAppt({ status: 'cancelado', when: 'future' });
  const r6 = await reopen(a6, { startsAt: (await rowOf(a6)).starts_at.toISOString() });
  assert.equal(r6.status, 200);
  const row6 = await pool.query('SELECT status, cancel_reason, ends_at - starts_at AS dur FROM appointments WHERE id = $1', [a6]);
  assert.equal(row6.rows[0].status, 'pendente');
  assert.equal(row6.rows[0].cancel_reason, null);
  assert.equal(row6.rows[0].dur.minutes, 10);

  // rejected/expired seguem sem reabrir, sem nem consultar disponibilidade
  const rej = await insertAppt({ status: 'cancelado', when: 'future', cancelReason: 'rejected' });
  assert.equal((await reopen(rej)).body.reason, 'invalid_transition');
});

test('INTEG-25 lotes: concluídos e faltas são protegidos (attended_protected) em PUT e DELETE; válidos seguem; observação continua livre', async (t) => {
  if (!dbAvailable) return t.skip('sem banco');
  const g = await makeGroup();
  const target = await insertAppt({ status: 'confirmado', when: 'past', groupId: g });
  const concl = await insertAppt({ status: 'concluido', when: 'past', groupId: g });
  const falta = await insertAppt({ status: 'nao_compareceu', when: 'past', groupId: g });
  const canc = await insertAppt({ status: 'cancelado', when: 'past', groupId: g });
  const conf2 = await insertAppt({ status: 'confirmado', when: 'future', groupId: g });
  const pend2 = await insertAppt({ status: 'pendente', when: 'future', groupId: g });
  const st = async () => [target, concl, falta, canc, conf2, pend2].map(async (id) => (await rowOf(id)).status);
  const statuses = async () => Promise.all(await st());

  // → pendente: atendidos NÃO voltam para pendente, cancelado não reabre
  const toPend = await put(`${target}/and-following`, { status: 'pendente' });
  assert.equal(toPend.status, 200);
  assert.deepEqual({ u: toPend.body.updated, n: toPend.body.unchanged, s: toPend.body.skipped, t: toPend.body.total }, { u: 2, n: 1, s: 3, t: 6 });
  assert.deepEqual(toPend.body.reasons, { attended_protected: 2, cancelled: 1 });
  assert.deepEqual(await statuses(), ['pendente', 'concluido', 'nao_compareceu', 'cancelado', 'pendente', 'pendente']);

  // → concluido: a falta também é protegida; quem já está concluído fica como está
  assert.equal((await rowOf(target)).status, 'pendente');
  const toDone = await put(`${concl}/and-following`, { status: 'concluido' });
  assert.deepEqual({ u: toDone.body.updated, n: toDone.body.unchanged, s: toDone.body.skipped }, { u: 0, n: 1, s: 4 });
  assert.deepEqual(toDone.body.reasons, { attended_protected: 1, cancelled: 1, invalid_transition: 2 });
  assert.equal((await rowOf(falta)).status, 'nao_compareceu');

  // → cancelado: atendidos protegidos; os demais cancelam; cancelado já cancelado é "unchanged"
  const toCanc = await put(`${target}/and-following`, { status: 'cancelado' });
  assert.deepEqual({ u: toCanc.body.updated, n: toCanc.body.unchanged, s: toCanc.body.skipped }, { u: 3, n: 1, s: 2 });
  assert.deepEqual(toCanc.body.reasons, { attended_protected: 2 });
  assert.deepEqual(await statuses(), ['cancelado', 'concluido', 'nao_compareceu', 'cancelado', 'cancelado', 'cancelado']);

  // observação continua livre para concluídos e faltas
  const notes = await put(`${concl}/and-following`, { notes: 'obs em lote' });
  assert.equal((await rowOf(concl)).notes, 'obs em lote');
  assert.equal((await rowOf(falta)).notes, 'obs em lote');
  assert.equal(notes.body.reasons.cancelled, 3);

  // DELETE em lote usa o mesmo motivo
  const g2 = await makeGroup();
  const d1 = await insertAppt({ status: 'confirmado', when: 'future', groupId: g2 });
  const d2 = await insertAppt({ status: 'concluido', when: 'future', groupId: g2 });
  const del = await req('DELETE', `/appointments/${d1}/and-following`, undefined, cookieA);
  assert.deepEqual(del.body.reasons, { attended_protected: 1 });
  assert.equal((await rowOf(d2)).status, 'concluido');
});

test('INTEG-25b lote é tudo-ou-nada: erro no meio da série desfaz tudo e não vaza conexão', async (t) => {
  if (!dbAvailable) return t.skip('sem banco');
  if (!ddlAllowed) {
    return t.skip(`DDL de teste desabilitado: defina NAILFLOW_ALLOW_TEST_DDL=1 e use um banco descartável com nome no padrão nf_*_test ou nailflow_*_test (banco atual: ${dbName})`);
  }
  const g = await makeGroup();
  const ids = [];
  for (let i = 0; i < 3; i++) ids.push(await insertAppt({ status: 'pendente', when: 'future', groupId: g }));
  // Gatilho de teste: a 3ª linha falha ao receber a observação "BOOM". Criação e remoção ficam sob try/finally:
  // a limpeza roda mesmo se a criação do gatilho, o pedido ou as asserções falharem.
  try {
    await pool.query(`CREATE OR REPLACE FUNCTION zz_test_boom() RETURNS trigger AS $$
      BEGIN IF NEW.notes = 'BOOM' AND NEW.id = '${ids[2]}'::uuid THEN RAISE EXCEPTION 'falha simulada'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`);
    await pool.query('CREATE TRIGGER zz_test_boom BEFORE UPDATE ON appointments FOR EACH ROW EXECUTE FUNCTION zz_test_boom()');
    const waitingBefore = pool.waitingCount;
    const r = await put(`${ids[0]}/and-following`, { notes: 'BOOM' });
    assert.equal(r.status, 500);
    for (const id of ids) assert.equal((await rowOf(id)).notes, null, 'nenhuma linha ficou alterada');
    assert.equal(pool.waitingCount, waitingBefore);
  } finally {
    for (const sql of ['DROP TRIGGER IF EXISTS zz_test_boom ON appointments', 'DROP FUNCTION IF EXISTS zz_test_boom()']) {
      try { await pool.query(sql); } catch (err) { console.error('limpeza DDL:', err.message); }
    }
  }
  // a conexão voltou ao pool: o mesmo pedido, sem o gatilho, funciona
  const ok = await put(`${ids[0]}/and-following`, { notes: 'depois' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.updated, 3);
});

test('INTEG-26 recusar (reject): futuro avisa a cliente; já iniciado recusa sem avisar (notificationSkipped); sem origem de cliente nunca avisa', async (t) => {
  if (!dbAvailable) return t.skip('sem banco');
  const exp = new Date(Date.now() + 3600000);
  const fut = await insertAppt({ status: 'pendente', when: 'future', source: 'public', expiresAt: exp });
  captureN8n();
  const a = await req('POST', `/appointments/${fut}/reject`, undefined, cookieA);
  assert.equal(a.status, 200);
  assert.equal(a.body.changed, true);
  assert.equal(a.body.notificationSkipped, undefined);
  await settle();
  assert.deepEqual(events(), ['appointment.rejected']);
  assert.deepEqual({ s: (await rowOf(fut)).status, r: (await rowOf(fut)).cancel_reason }, { s: 'cancelado', r: 'rejected' });

  const past = await insertAppt({ status: 'pendente', when: 'past', source: 'bot' });
  captureN8n();
  const b = await req('POST', `/appointments/${past}/reject`, undefined, cookieA);
  assert.equal(b.status, 200);
  assert.equal(b.body.changed, true);
  assert.equal(b.body.notificationSkipped, 'past');
  await settle();
  assert.deepEqual(events(), []);
  assert.deepEqual({ s: (await rowOf(past)).status, r: (await rowOf(past)).cancel_reason }, { s: 'cancelado', r: 'rejected' });

  const panelPast = await insertAppt({ status: 'pendente', when: 'past', source: null });
  captureN8n();
  const c = await req('POST', `/appointments/${panelPast}/reject`, undefined, cookieA);
  assert.equal(c.body.notificationSkipped, undefined, 'não havia aviso a suprimir');
  await settle();
  assert.deepEqual(events(), []);

  // repetir é idempotente e sem aviso
  captureN8n();
  assert.equal((await req('POST', `/appointments/${fut}/reject`, undefined, cookieA)).body.changed, false);
  await settle();
  assert.deepEqual(events(), []);
});

test('INTEG-27 pool limitado: 12 PUTs e 12 lotes simultâneos terminam sem travar (nenhuma consulta pelo pool dentro da transação)', { timeout: 90000 }, async (t) => {
  if (!dbAvailable) return t.skip('sem banco');
  // O pool do app não é reconfigurado: este teste reserva conexões do próprio pool de teste até sobrarem 4.
  // Com o código anterior (2 conexões por PUT) 4 pedidos já esgotavam o resto e todos ficavam esperando.
  const max = pool.options.max ?? 10;
  const held = [];
  const withTimeout = (p, ms, label) => Promise.race([
    p, new Promise((_, rej) => setTimeout(() => rej(new Error(`travou: ${label} não terminou em ${ms} ms`)), ms)),
  ]);
  try {
    for (let i = 0; i < max - 4; i++) held.push(await pool.connect());

    // 12 PUTs que mudam o horário (caminho com disponibilidade)
    const singles = [];
    for (let i = 0; i < 12; i++) singles.push(await insertAppt({ status: 'pendente', when: 'future' }));
    const starts = await Promise.all(singles.map(async (id) => (await rowOf(id)).starts_at));
    const puts = await withTimeout(Promise.all(singles.map((id, i) =>
      put(id, { startsAt: new Date(starts[i].getTime() + 3600000).toISOString(), notes: `m${i}` }))), 30000, '12 PUTs');
    assert.deepEqual(puts.map((r) => r.status), Array(12).fill(200));

    // 12 lotes simultâneos (séries de 2)
    const firsts = [];
    for (let i = 0; i < 12; i++) {
      const g = await makeGroup();
      firsts.push(await insertAppt({ status: 'pendente', when: 'future', groupId: g }));
      await insertAppt({ status: 'pendente', when: 'future', groupId: g });
    }
    const batches = await withTimeout(Promise.all(firsts.map((id) => put(`${id}/and-following`, { notes: 'lote' }))), 30000, '12 lotes');
    assert.deepEqual(batches.map((r) => r.status), Array(12).fill(200));
    assert.deepEqual(batches.map((r) => r.body.updated), Array(12).fill(2));
  } finally {
    for (const c of held) c.release();
  }
  assert.equal((await put(await insertAppt({ status: 'pendente', when: 'future' }), { notes: 'depois' })).status, 200);
});

test('INTEG-28 PUT concorrente a DELETE termina coerente, qualquer que seja a ordem (invariante; a ordem controlada está em INTEG-29 a 32b)', async (t) => {
  if (!dbAvailable) return t.skip('sem banco');
  // Dispara PUT (que passa pela disponibilidade) enquanto outra operação cancela o mesmo agendamento.
  // Qualquer desfecho precisa ser coerente: ou o PUT vence (200 e o cancelamento vem depois) ou perde com 409 coerente.
  const seen = new Set();
  for (let i = 0; i < 8; i++) {
    const id = await insertAppt({ status: 'pendente', when: 'future' });
    const start = (await rowOf(id)).starts_at;
    const [upd, del] = await Promise.all([
      put(id, { startsAt: new Date(start.getTime() + 3600000).toISOString() }),
      req('DELETE', `/appointments/${id}`, undefined, cookieA),
    ]);
    assert.equal(del.status, 204);
    assert.ok([200, 409].includes(upd.status), `PUT: ${upd.status}`);
    if (upd.status === 409) seen.add(upd.body.reason);
    const row = await rowOf(id);
    assert.equal(row.status, 'cancelado', 'o cancelamento sempre prevalece sobre o status final');
  }
  console.log('   motivos de 409 observados →', [...seen].join(', ') || '(nenhum)');
});

// ───────────────────────── concorrência com ordem controlada ─────────────────────────
// Nada aqui depende da sorte do escalonamento: a ordem é imposta por um lock real mantido numa
// conexão auxiliar (e por consulta ao pg_stat_activity para saber que o PUT já está bloqueado) ou por
// um gancho que roda exatamente entre a leitura inicial do PUT e a releitura sob lock.

// Conexão auxiliar que segura o lock da linha até `finish()` (opcionalmente alterando-a antes do COMMIT).
async function holdRowLock(id) {
  const c = await pool.connect();
  await c.query('BEGIN');
  await c.query('SELECT id FROM appointments WHERE id = $1 FOR UPDATE', [id]);
  return {
    async finish(sql, params) {
      try { if (sql) await c.query(sql, params); await c.query('COMMIT'); } finally { c.release(); }
    },
  };
}

// Espera (com limite) até haver `n` PUTs bloqueados aguardando o lock da linha, isto é, já depois da leitura inicial.
async function waitForLockWaiters(n, ms = 10000) {
  const t0 = Date.now();
  for (;;) {
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock' AND state = 'active'
          AND query LIKE '%FROM appointments WHERE id = $1 AND professional_id = $2 FOR UPDATE%'`);
    if (rows[0].n >= n) return;
    if (Date.now() - t0 > ms) throw new Error(`esperava ${n} PUT(s) bloqueado(s) no lock; encontrei ${rows[0].n}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

// Gancho executado antes de cada releitura sob lock (FOR UPDATE do PUT), numerada a partir de 1.
function interceptLockRead(hook) {
  const state = { active: true, n: 0 };
  const original = pool.connect;
  pool.connect = function patched(...args) {
    if (typeof args[0] === 'function') return original.apply(this, args); // uso interno com callback (pool.query)
    return original.apply(this, args).then((client) => {
      const q = client.__origQuery ?? (client.__origQuery = client.query.bind(client));
      client.query = async (...a) => {
        if (state.active && typeof a[0] === 'string' && a[0].includes(' FOR UPDATE') && !a[0].includes('SKIP LOCKED')) {
          state.n += 1;
          await hook(state.n);
        }
        return q(...a);
      };
      return client;
    });
  };
  return {
    count: () => state.n,
    restore() { state.active = false; delete pool.connect; },
  };
}

const busyConnections = () => pool.totalCount - pool.idleCount;

test('INTEG-29 dois PUT {status:confirmado} simultâneos: ambos terminam com sucesso e só uma confirmação é notificada', async (t) => {
  if (!dbAvailable) return t.skip('sem banco');
  const id = await insertAppt({ status: 'pendente', when: 'future' });
  captureN8n();
  const lock = await holdRowLock(id);
  const first = put(id, { status: 'confirmado' });
  const second = put(id, { status: 'confirmado' });
  await waitForLockWaiters(2); // os dois já leram "pendente" e esperam o lock
  await lock.finish();
  const [a, b] = await Promise.all([first, second]);
  assert.deepEqual([a.status, b.status], [200, 200]);
  assert.equal(a.body.status, 'confirmado');
  assert.equal(b.body.status, 'confirmado');
  await settle();
  assert.deepEqual(events(), ['appointment.confirmed'], 'uma única confirmação notificada');
  const row = await rowOf(id);
  assert.equal(row.status, 'confirmado');
  assert.equal(row.expires_at, null);
});

test('INTEG-30 outra operação altera o agendamento enquanto o PUT espera o lock: refaz, é idempotente ou devolve o erro de negócio', async (t) => {
  if (!dbAvailable) return t.skip('sem banco');
  const waiting = async (id, body, change) => {
    captureN8n();
    const lock = await holdRowLock(id);
    const pending = put(id, body);
    await waitForLockWaiters(1);
    await lock.finish(...change);
    const res = await pending;
    await settle();
    return res;
  };

  // (a) a outra operação CANCELOU: nova tentativa devolve o erro de negócio, não "concurrent_change"
  const a = await insertAppt({ status: 'pendente', when: 'future' });
  const ra = await waiting(a, { status: 'confirmado' }, ["UPDATE appointments SET status = 'cancelado' WHERE id = $1", [a]]);
  assert.equal(ra.status, 409);
  assert.equal(ra.body.reason, 'invalid_transition');
  assert.deepEqual(events(), []);
  assert.equal((await rowOf(a)).status, 'cancelado');

  // (b) a outra operação JÁ CONFIRMOU: pedido idempotente, sem nova notificação
  const b = await insertAppt({ status: 'pendente', when: 'future' });
  const rb = await waiting(b, { status: 'confirmado' }, ["UPDATE appointments SET status = 'confirmado', expires_at = NULL WHERE id = $1", [b]]);
  assert.equal(rb.status, 200);
  assert.equal(rb.body.status, 'confirmado');
  assert.deepEqual(events(), [], 'a confirmação já tinha sido aplicada por outra operação');

  // (c) a outra operação só mexeu na observação: o PUT segue, confirma e notifica uma vez, preservando a observação
  const c = await insertAppt({ status: 'pendente', when: 'future' });
  const rc = await waiting(c, { status: 'confirmado' }, ["UPDATE appointments SET notes = 'da outra operação' WHERE id = $1", [c]]);
  assert.equal(rc.status, 200);
  assert.deepEqual(events(), ['appointment.confirmed']);
  assert.equal((await rowOf(c)).notes, 'da outra operação');

  // (d) a outra operação trocou o serviço: o PUT refaz com o estado novo e não desfaz a troca
  const d = await insertAppt({ status: 'pendente', when: 'future' });
  const rd = await waiting(d, { notes: 'minha observação' }, ['UPDATE appointments SET service_id = $2 WHERE id = $1', [d, serviceA2]]);
  assert.equal(rd.status, 200);
  const rowD = await rowOf(d);
  assert.equal(rowD.service_id, serviceA2);
  assert.equal(rowD.notes, 'minha observação');
  assert.equal(rowD.price_cents_snapshot, 5000, 'o preço registrado não é refeito por uma troca que não foi deste PUT');
});

test('INTEG-31 a reserva expira entre a leitura inicial e o lock: erro de negócio hold_expired (não conflito genérico)', async (t) => {
  if (!dbAvailable) return t.skip('sem banco');
  const { expireDueHolds } = await import('../src/utils/bookingRules.js');
  const id = await insertAppt({ status: 'pendente', when: 'future', source: 'public', expiresAt: new Date(Date.now() + 3600000) });
  captureN8n();
  const hook = interceptLockRead(async (n) => {
    if (n === 1) { // depois da leitura inicial (ainda válida) e antes do lock: vence e é varrida
      await pool.query(`UPDATE appointments SET expires_at = now() - interval '1 minute' WHERE id = $1`, [id]);
      await expireDueHolds({ professionalId: profA });
    }
  });
  let res;
  try {
    res = await put(id, { status: 'confirmado' });
  } finally {
    hook.restore();
  }
  assert.equal(res.status, 409);
  assert.equal(res.body.reason, 'hold_expired');
  assert.equal(hook.count(), 1, 'a segunda tentativa já parou na avaliação, sem nova releitura sob lock');
  await settle();
  assert.deepEqual(events(), []);
  assert.deepEqual({ s: (await rowOf(id)).status, r: (await rowOf(id)).cancel_reason }, { s: 'cancelado', r: 'expired' });
});

test('INTEG-32 conflito real persistente: após a tentativa inicial e 2 repetições devolve 409 concurrent_change, sem gravar e sem vazar conexão', async (t) => {
  if (!dbAvailable) return t.skip('sem banco');
  const id = await insertAppt({ status: 'pendente', when: 'future' });
  captureN8n();
  const busyBefore = busyConnections();
  // a cada releitura sob lock, outra operação já trocou o serviço: a leitura inicial nunca bate
  const hook = interceptLockRead(async () => {
    await pool.query('UPDATE appointments SET service_id = CASE WHEN service_id = $2 THEN $3 ELSE $2 END WHERE id = $1', [id, serviceA, serviceA2]);
  });
  let res;
  try {
    res = await put(id, { notes: 'não deve gravar', status: 'confirmado' });
  } finally {
    hook.restore();
  }
  assert.equal(res.status, 409);
  assert.equal(res.body.reason, 'concurrent_change');
  assert.equal(hook.count(), 3, 'tentativa inicial + 2 repetições, nada além disso');
  await settle();
  assert.deepEqual(events(), []);
  const row = await rowOf(id);
  assert.equal(row.notes, null);
  assert.equal(row.status, 'pendente');
  assert.equal(pool.waitingCount, 0);
  assert.equal(busyConnections(), busyBefore, 'todas as conexões voltaram ao pool');
  // sem o gancho, o mesmo pedido funciona
  assert.equal((await put(id, { notes: 'agora grava', status: 'confirmado' })).status, 200);
  assert.equal((await rowOf(id)).notes, 'agora grava');
});

test('INTEG-32b conflito que cede na 3ª tentativa: sucesso, uma única notificação e conexões devolvidas', async (t) => {
  if (!dbAvailable) return t.skip('sem banco');
  const id = await insertAppt({ status: 'pendente', when: 'future' });
  captureN8n();
  const busyBefore = busyConnections();
  const hook = interceptLockRead(async (n) => {
    if (n <= 2) await pool.query('UPDATE appointments SET service_id = CASE WHEN service_id = $2 THEN $3 ELSE $2 END WHERE id = $1', [id, serviceA, serviceA2]);
  });
  let res;
  try {
    res = await put(id, { status: 'confirmado' });
  } finally {
    hook.restore();
  }
  assert.equal(res.status, 200);
  assert.equal(hook.count(), 3);
  await settle();
  assert.deepEqual(events(), ['appointment.confirmed']);
  assert.equal((await rowOf(id)).status, 'confirmado');
  assert.equal(busyConnections(), busyBefore);
});
