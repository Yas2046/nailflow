/**
 * Sinal por Pix manual: configuração, criação como aguardando_pagamento,
 * cálculo no backend, "pagamento recebido" (idempotente), expiração e isolamento.
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
let rules;
const realFetch = global.fetch;
let calls = [];

const PASS = 'senha_teste_sinal';
const SLUG_A = 'teste-sinal-a';
const PIX = 'pix-sinal@teste.com';

before(async () => {
  ({ pool } = await import('../src/config/db.js'));
  try { await pool.query('SELECT 1'); } catch { dbAvailable = false; }
  rules = await import('../src/utils/bookingRules.js');
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
  profA = await mk('sinal_a@nailflow.com', SLUG_A, '5531000003001', 'Sinal A');
  profB = await mk('sinal_b@nailflow.com', 'teste-sinal-b', '5531000003002', 'Sinal B');
  serviceA = (await pool.query(
    `INSERT INTO services (professional_id, name, price_cents, duration_minutes) VALUES ($1,'Gel Sinal',5000,30) RETURNING id`, [profA])).rows[0].id;
  clientA = (await pool.query(
    `INSERT INTO clients (professional_id, name, phone) VALUES ($1,'Cliente Sinal','5531988890001') RETURNING id`, [profA])).rows[0].id;
  for (const p of [profA, profB]) {
    for (let wd = 0; wd <= 6; wd++) {
      await pool.query(
        `INSERT INTO weekly_availability (professional_id, weekday, is_working, start_time, end_time)
         VALUES ($1,$2,true,'08:00','22:00') ON CONFLICT (professional_id, weekday) DO NOTHING`, [p, wd]);
    }
  }
  cookieA = await login('sinal_a@nailflow.com');
  cookieB = await login('sinal_b@nailflow.com');
});

after(async () => {
  global.fetch = realFetch;
  for (const k of ['MESSAGE', 'CONFIRMED', 'PUBLIC_CREATED']) delete process.env[`N8N_WEBHOOK_${k}_URL`];
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
      'X-Forwarded-For': `10.8.${Math.floor(ipSeq / 250)}.${(ipSeq % 250) + 1}`,
      ...(cookie ? { Cookie: cookie } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, raw: text };
}

function captureN8n() {
  calls = [];
  process.env.N8N_WEBHOOK_MESSAGE_URL = 'http://n8n-test/message';
  process.env.N8N_WEBHOOK_CONFIRMED_URL = 'http://n8n-test/confirmed';
  process.env.N8N_WEBHOOK_PUBLIC_CREATED_URL = 'http://n8n-test/public-created';
  global.fetch = async (url, opts) => {
    calls.push(JSON.parse(opts.body));
    return { ok: true };
  };
}
const events = () => calls.map((c) => c.event);
const settle = () => new Promise((r) => setTimeout(r, 40));

const putSettings = (body, cookie = cookieA) => req('PUT', '/auth/booking-settings', body, cookie);
const enableDeposit = (type, value) => putSettings({
  confirmation_mode: 'automatic', deposit_required: true, deposit_type: type, deposit_value: value, pix_key: PIX,
});

let phoneSeq = 0;
async function publicBook(extra = {}) {
  phoneSeq += 1;
  const phone = `55319${String(80000000 + phoneSeq)}`;
  const avail = await req('GET', `/public/${SLUG_A}/availability?days=30&serviceId=${serviceA}`);
  const day = avail.body.days.find((d) => d.slots.length > 0);
  assert.ok(day, 'sem horário livre');
  const res = await req('POST', `/public/${SLUG_A}/appointments`, {
    serviceId: serviceA, startsAt: day.slots[0], clientName: 'Joana Sinal Souza', clientPhone: phone, ...extra,
  });
  return { res, phone, startsAt: day.slots[0] };
}
const rowOf = async (id) => (await pool.query(
  'SELECT status, cancel_reason, expires_at, deposit_cents, paid_at, price_cents_snapshot, source FROM appointments WHERE id = $1', [id])).rows[0];

let slotSeq = 0;
async function insertDirect({ status = 'aguardando_pagamento', expiresAtSql = "now() + interval '1 hour'", prof = profA, client = clientA, service = serviceA } = {}) {
  slotSeq += 1;
  const start = new Date(Date.UTC(2031, 0, 1) + slotSeq * 3600000 * 3 + 15 * 3600000);
  const { rows } = await pool.query(
    `INSERT INTO appointments (professional_id, client_id, service_id, starts_at, ends_at, status, source, expires_at, deposit_cents, price_cents_snapshot)
     VALUES ($1,$2,$3,$4,$5,$6,'public', ${expiresAtSql}, 2500, 5000) RETURNING id`,
    [prof, client, service, start, new Date(start.getTime() + 30 * 60000), status]
  );
  return rows[0].id;
}

test('cálculo do sinal: porcentagem, valor fixo, arredondamento e teto no preço', () => {
  const d = (type, value) => ({ deposit_required: true, deposit_type: type, deposit_value: value });
  assert.equal(rules.calculateDepositCents(d('percentage', 30), 5000), 1500);
  assert.equal(rules.calculateDepositCents(d('percentage', 50), 5000), 2500);
  assert.equal(rules.calculateDepositCents(d('percentage', 100), 5000), 5000);
  assert.equal(rules.calculateDepositCents(d('percentage', 30), 3333), 1000, 'arredonda ao centavo');
  assert.equal(rules.calculateDepositCents(d('fixed', 2000), 5000), 2000);
  assert.equal(rules.calculateDepositCents(d('fixed', 9000), 5000), 5000, 'fixo nunca passa do preço');
  assert.equal(rules.calculateDepositCents({ deposit_required: false, deposit_type: 'fixed', deposit_value: 2000 }, 5000), 0);
  assert.equal(rules.calculateDepositCents(d('percentage', 50), 0), 0);
  assert.equal(rules.formatBRL(2500).replace(/\s/g, ' '), 'R$ 25,00');
});

test('configuração do sinal: validações e persistência', async (t) => {
  if (!dbAvailable) return t.skip('sem banco');
  assert.equal((await req('PUT', '/auth/booking-settings', { deposit_required: true })).status, 401);

  // sem chave Pix / sem tipo / confirmação manual / percentual inválido / fixo fora da faixa / chave inválida
  assert.equal((await putSettings({ confirmation_mode: 'automatic', deposit_required: true, deposit_type: 'percentage', deposit_value: 50 })).status, 400);
  assert.equal((await putSettings({ confirmation_mode: 'automatic', deposit_required: true, pix_key: PIX })).status, 400);
  assert.equal((await putSettings({ confirmation_mode: 'manual', deposit_required: true, deposit_type: 'percentage', deposit_value: 50, pix_key: PIX })).status, 400);
  assert.equal((await putSettings({ confirmation_mode: 'automatic', deposit_required: true, deposit_type: 'percentage', deposit_value: 40, pix_key: PIX })).status, 400);
  assert.equal((await putSettings({ confirmation_mode: 'automatic', deposit_required: true, deposit_type: 'fixed', deposit_value: 50, pix_key: PIX })).status, 400);
  assert.equal((await putSettings({ confirmation_mode: 'automatic', deposit_required: true, deposit_type: 'fixed', deposit_value: 99999999, pix_key: PIX })).status, 400);
  assert.equal((await putSettings({ confirmation_mode: 'automatic', deposit_required: true, deposit_type: 'percentage', deposit_value: 50, pix_key: 'tem espaço' })).status, 400);
  assert.equal((await putSettings({ confirmation_mode: 'automatic', deposit_required: true, deposit_type: 'percentage', deposit_value: 50, pix_key: PIX, prazo_horas: 5 })).status, 400, 'prazo não é configurável');
  assert.equal((await getSettings(cookieA)).body.deposit_required, false, 'nada foi salvo pelas tentativas inválidas');

  const ok = await enableDeposit('percentage', 30);
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body, { confirmation_mode: 'automatic', deposit_required: true, deposit_type: 'percentage', deposit_value: 30, pix_key: PIX });

  // trocar para manual com o sinal ligado é recusado
  assert.equal((await putSettings({ confirmation_mode: 'manual' })).status, 400);

  const fixed = await enableDeposit('fixed', 2000);
  assert.equal(fixed.status, 200);
  assert.equal(fixed.body.deposit_value, 2000);

  // desligar o sinal mantém os dados e libera o modo manual
  const off = await putSettings({ deposit_required: false, confirmation_mode: 'manual' });
  assert.equal(off.status, 200);
  assert.equal(off.body.deposit_required, false);
  assert.equal(off.body.deposit_value, 2000);
});

const getSettings = (cookie) => req('GET', '/auth/booking-settings', undefined, cookie);

test('isolamento: outra profissional não vê nem altera a configuração e a chave Pix', async (t) => {
  if (!dbAvailable) return t.skip('sem banco');
  await enableDeposit('percentage', 50);
  const b = await getSettings(cookieB);
  assert.equal(b.body.pix_key, null);
  assert.equal(b.body.deposit_required, false);
  assert.ok(!b.raw.includes(PIX));
  await putSettings({ confirmation_mode: 'automatic' }, cookieB);
  const a = await getSettings(cookieA);
  assert.equal(a.body.pix_key, PIX);
  assert.equal(a.body.deposit_required, true);
  assert.equal((await getSettings(cookieB)).body.confirmation_mode, 'automatic');
});

test('reserva com sinal (50%): aguardando_pagamento, valor no backend, Pix só na resposta e na mensagem, 1 mensagem', async (t) => {
  if (!dbAvailable) return t.skip('sem banco');
  await enableDeposit('percentage', 50);
  captureN8n();
  // valores enviados pelo frontend não valem
  const { res, phone } = await publicBook({ depositCents: 1, status: 'confirmado', pixKey: 'falsa@x.com', amountCents: 1 });
  assert.equal(res.status, 201, res.raw);
  assert.equal(res.body.status, 'aguardando_pagamento');
  assert.equal(res.body.deposit.amountCents, 2500);
  assert.equal(res.body.deposit.pixKey, PIX);
  assert.ok(Math.abs(new Date(res.body.deposit.expiresAt) - Date.now() - 2 * 3600000) < 120000);

  const row = await rowOf(res.body.id);
  assert.equal(row.status, 'aguardando_pagamento');
  assert.equal(row.deposit_cents, 2500);
  assert.equal(row.price_cents_snapshot, 5000);
  assert.equal(row.source, 'public');
  assert.equal(row.paid_at, null);
  const h = (new Date(row.expires_at) - Date.now()) / 3600000;
  assert.ok(h > 1.9 && h <= 2.01, `validade 2h, veio ${h}`);

  await settle();
  assert.deepEqual(events().sort(), ['appointment.public_created', 'message.send']);
  const msg = calls.find((c) => c.event === 'message.send').payload;
  assert.equal(msg.kind, 'payment_instructions');
  assert.equal(msg.waInstance, `inst-${SLUG_A}`);
  assert.equal(msg.clientPhone, phone.replace(/^(\d{4})9(\d{8})$/, '$1$2'));
  assert.match(msg.text, /Gel Sinal/);
  assert.match(msg.text, /R\$\s?25,00/);
  assert.ok(msg.text.includes(PIX));
  assert.match(msg.text, /2 horas/);

  // mudar o preço do serviço depois não altera o histórico da reserva
  await pool.query('UPDATE services SET price_cents = 9000 WHERE id = $1', [serviceA]);
  const after = await rowOf(res.body.id);
  assert.equal(after.deposit_cents, 2500);
  assert.equal(after.price_cents_snapshot, 5000);
  await pool.query('UPDATE services SET price_cents = 5000 WHERE id = $1', [serviceA]);
});

test('reserva com sinal 30%, 100% e fixo: valores calculados e fixo limitado ao preço', async (t) => {
  if (!dbAvailable) return t.skip('sem banco');
  for (const [type, value, expected] of [['percentage', 30, 1500], ['percentage', 100, 5000], ['fixed', 2000, 2000], ['fixed', 8000, 5000]]) {
    // 8000 está acima de R$ 50: o fixo é limitado ao preço do serviço
    await enableDeposit(type, value);
    captureN8n();
    const { res } = await publicBook();
    assert.equal(res.status, 201, res.raw);
    assert.equal(res.body.deposit.amountCents, expected, `${type} ${value}`);
    assert.equal((await rowOf(res.body.id)).deposit_cents, expected);
  }
});

test('chave Pix não aparece em nenhuma rota pública antes da reserva', async (t) => {
  if (!dbAvailable) return t.skip('sem banco');
  await enableDeposit('percentage', 50);
  for (const path of [`/public/${SLUG_A}/info`, `/public/${SLUG_A}/services`, `/public/${SLUG_A}/availability?days=7`]) {
    const r = await req('GET', path);
    assert.equal(r.status, 200, path);
    assert.ok(!r.raw.includes(PIX), `${path} vazou a chave Pix`);
    assert.ok(!/pix_key|pixKey|deposit/i.test(r.raw), `${path} expõe dados de sinal`);
  }
});

test('pagamento recebido: confirma, zera validade, grava paid_at, idempotente e com uma única mensagem', async (t) => {
  if (!dbAvailable) return t.skip('sem banco');
  const id = await insertDirect();
  captureN8n();
  const r1 = await req('POST', `/appointments/${id}/mark-paid`, undefined, cookieA);
  assert.equal(r1.status, 200);
  assert.equal(r1.body.status, 'confirmado');
  assert.equal(r1.body.changed, true);
  const row = await rowOf(id);
  assert.equal(row.status, 'confirmado');
  assert.equal(row.expires_at, null);
  assert.ok(row.paid_at);
  await settle();
  assert.deepEqual(events(), ['appointment.confirmed']);

  const r2 = await req('POST', `/appointments/${id}/mark-paid`, undefined, cookieA);
  assert.equal(r2.status, 200);
  assert.equal(r2.body.changed, false);
  await settle();
  assert.equal(calls.length, 1, 'repetir não reenvia mensagem');

  // cliques paralelos: uma só mudança e uma só mensagem
  const id2 = await insertDirect();
  calls = [];
  const rs = await Promise.all(Array.from({ length: 5 }, () => req('POST', `/appointments/${id2}/mark-paid`, undefined, cookieA)));
  assert.ok(rs.every((r) => r.status === 200));
  assert.equal(rs.filter((r) => r.body.changed).length, 1);
  await settle();
  assert.equal(calls.length, 1);
});

test('pagamento recebido só vale para aguardando_pagamento; confirmar manualmente não contorna', async (t) => {
  if (!dbAvailable) return t.skip('sem banco');
  captureN8n();
  for (const status of ['pendente', 'confirmado', 'cancelado', 'concluido', 'nao_compareceu']) {
    const id = await insertDirect({ status, expiresAtSql: 'NULL' });
    const r = await req('POST', `/appointments/${id}/mark-paid`, undefined, cookieA);
    assert.equal(r.status, 409, status);
    assert.equal(r.body.reason, 'invalid_transition', status);
    assert.equal((await rowOf(id)).status, status);
  }
  const waiting = await insertDirect();
  assert.equal((await req('POST', `/appointments/${waiting}/confirm`, undefined, cookieA)).status, 409);
  assert.equal((await req('PUT', `/appointments/${waiting}`, { status: 'confirmado' }, cookieA)).status, 409);
  assert.equal((await req('POST', `/appointments/${waiting}/reject`, undefined, cookieA)).status, 409);
  assert.equal((await rowOf(waiting)).status, 'aguardando_pagamento');
  await settle();
  assert.equal(calls.length, 0);
});

test('pagamento depois da expiração: 409 hold_expired, vira cancelado/expired e o horário volta a ficar livre', async (t) => {
  if (!dbAvailable) return t.skip('sem banco');
  const id = await insertDirect({ expiresAtSql: "now() - interval '1 minute'" });
  captureN8n();
  const r = await req('POST', `/appointments/${id}/mark-paid`, undefined, cookieA);
  assert.equal(r.status, 409);
  assert.equal(r.body.reason, 'hold_expired');
  const row = await rowOf(id);
  assert.equal(row.status, 'cancelado');
  assert.equal(row.cancel_reason, 'expired');
  assert.equal(row.paid_at, null);
  // repetir continua erro de expiração
  assert.equal((await req('POST', `/appointments/${id}/mark-paid`, undefined, cookieA)).body.reason, 'hold_expired');
  await settle();
  assert.equal(calls.length, 0);
});

test('expiração (varredura) cancela só aguardando_pagamento vencido e libera o horário para nova reserva', async (t) => {
  if (!dbAvailable) return t.skip('sem banco');
  await enableDeposit('percentage', 50);
  captureN8n();
  const { res, startsAt } = await publicBook();
  assert.equal(res.status, 201);
  // vence a reserva (simula 2h depois) e roda a varredura
  await pool.query("UPDATE appointments SET expires_at = now() - interval '1 second' WHERE id = $1", [res.body.id]);
  assert.ok((await rules.expireDueHolds({ professionalId: profA })) >= 1);
  const row = await rowOf(res.body.id);
  assert.equal(row.status, 'cancelado');
  assert.equal(row.cancel_reason, 'expired');
  // o mesmo horário volta a ser reservável
  const again = await req('POST', `/public/${SLUG_A}/appointments`, {
    serviceId: serviceA, startsAt, clientName: 'Outra Cliente', clientPhone: '5531977771234',
  });
  assert.equal(again.status, 201, again.raw);
});

test('isolamento: outra profissional não marca pagamento (404) e a cliente sem login não consegue (401)', async (t) => {
  if (!dbAvailable) return t.skip('sem banco');
  const id = await insertDirect();
  captureN8n();
  assert.equal((await req('POST', `/appointments/${id}/mark-paid`, undefined, cookieB)).status, 404);
  assert.equal((await req('POST', `/appointments/${id}/mark-paid`)).status, 401);
  assert.equal((await rowOf(id)).status, 'aguardando_pagamento');
  await settle();
  assert.equal(calls.length, 0);
});
