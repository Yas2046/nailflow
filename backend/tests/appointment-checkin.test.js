// Check-in ("em atendimento"): POST /appointments/:id/check-in grava appointments.checked_in_at (migration 025) sem mudar o status.
// Regras cobertas: só agendamento confirmado; idempotente (segunda chamada não regrava); outra profissional não enxerga (404);
// auditoria 'appointment_checkin' gravada pelo gatilho; desfazer direto no banco exige justificativa (fin_appointments_guard).
// API HTTP real, role NÃO-DONA, banco DESCARTÁVEL (APPT_CHECKIN_TEST_DB_URL, um banco só para este arquivo; ver helpers/financeTestDb.js).
// Sem a variável o arquivo é ignorado.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import pg from 'pg';
import { resolveFinanceTestDb, financeDb } from './helpers/financeTestDb.js';

const VAR = 'APPT_CHECKIN_TEST_DB_URL';
const EMAIL_LIKE = 'chk-%@nf.test';
const ROLE = 'nf_chk_app';
const T = { timeout: 120_000 };

let skip = false;
let owner;
let db;
let server;
let baseUrl;
let appPool;
let secret;
let dayN = 0;

const one = async (sql, params) => (await owner.query(sql, params)).rows[0];

async function mkProf(tag) {
  const id = randomUUID();
  await owner.query(`INSERT INTO professionals (id, name, email, password_hash, slug, business_name) VALUES ($1, $2, $3, 'x', $4, $5)`,
    [id, `Chk ${tag}`, `chk-${tag}-${id.slice(0, 8)}@nf.test`, `chk-${tag}-${id.slice(0, 8)}`, `Studio ${tag}`]);
  const svc = (await one(`INSERT INTO services (professional_id, name, price_cents, duration_minutes) VALUES ($1, 'Manicure', 10000, 60) RETURNING id`, [id])).id;
  const cli = (await one(`INSERT INTO clients (professional_id, name, phone) VALUES ($1, 'Cliente', $2) RETURNING id`, [id, `5531${String(300000000 + Math.floor(Math.random() * 1e8))}`])).id;
  return { id, svc, cli, token: jwt.sign({ sub: id, ver: 1 }, secret, { expiresIn: '1h' }) };
}
async function mkAppt(p, status) {
  const start = new Date(Date.UTC(2026, 0, 1 + (++dayN), 12, 0, 0));
  return (await one(`INSERT INTO appointments (professional_id, client_id, service_id, starts_at, ends_at, status, price_cents_snapshot)
      VALUES ($1, $2, $3, $4, $5, $6, 10000) RETURNING id`, [p.id, p.cli, p.svc, start, new Date(start.getTime() + 3600_000), status])).id;
}
async function checkIn(p, appt) {
  const res = await fetch(`${baseUrl}/appointments/${appt}/check-in`, { method: 'POST', headers: { cookie: `nailflow_token=${p.token}` } });
  return { status: res.status, json: await res.json().catch(() => null) };
}

before(async () => {
  const r = await resolveFinanceTestDb(process.env, VAR);
  if (r.skip) { skip = r.skip; return; }
  owner = new pg.Pool({ connectionString: r.url, options: '-c TimeZone=UTC', max: 5 });
  owner.on('error', () => {});
  db = financeDb(owner);
  await db.reset({ emailLike: EMAIL_LIKE, roles: [ROLE] });
  await db.createAppRole(ROLE);
  await db.up();
  await db.grant(ROLE);
  secret = 'chk-test-secret';
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = secret;
  process.env.DATABASE_URL = db.appUrl(r.url, ROLE);
  process.env.FRONTEND_URL = 'http://localhost:5173';
  for (const v of ['N8N_WEBHOOK_CONFIRMED_URL', 'N8N_WEBHOOK_CANCELLED_URL', 'N8N_WEBHOOK_REJECTED_URL', 'N8N_WEBHOOK_MESSAGE_URL', 'N8N_BOT_WEBHOOK_URL']) process.env[v] = '';
  ({ pool: appPool } = await import('../src/config/db.js'));
  const { default: app } = await import('../src/server.js');
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (!owner) return;
  try {
    if (server) await new Promise((resolve) => server.close(resolve));
    await appPool?.end().catch(() => {});
    await db.reset({ emailLike: EMAIL_LIKE, roles: [ROLE] });
  } finally {
    await owner.end();
  }
});

const dbTest = (name, fn) => test(name, T, async (t) => { if (skip) return t.skip(skip); await fn(t); });

dbTest('confirmado: registra a chegada, mantém o status e grava a auditoria; repetir é idempotente', async () => {
  const A = await mkProf('ok');
  const appt = await mkAppt(A, 'confirmado');
  const r1 = await checkIn(A, appt);
  assert.equal(r1.status, 200);
  assert.equal(r1.json.changed, true);
  assert.equal(r1.json.status, 'confirmado');
  assert.ok(r1.json.checkedInAt);
  const first = (await one(`SELECT checked_in_at FROM appointments WHERE id = $1`, [appt])).checked_in_at.toISOString();

  const r2 = await checkIn(A, appt);
  assert.equal(r2.status, 200);
  assert.equal(r2.json.changed, false);
  assert.equal((await one(`SELECT checked_in_at FROM appointments WHERE id = $1`, [appt])).checked_in_at.toISOString(), first);
  assert.equal((await one(`SELECT count(*)::int AS n FROM financial_audit_log WHERE entity_id = $1 AND action = 'appointment_checkin'`, [appt])).n, 1);
});

dbTest('só vale para confirmado: pendente, concluído e cancelado recebem 409 e nada é gravado', async () => {
  const A = await mkProf('status');
  for (const st of ['pendente', 'concluido', 'cancelado']) {
    const appt = await mkAppt(A, st);
    const r = await checkIn(A, appt);
    assert.equal(r.status, 409, st);
    assert.equal((await one(`SELECT checked_in_at FROM appointments WHERE id = $1`, [appt])).checked_in_at, null);
  }
});

dbTest('outra profissional não enxerga o agendamento (404) e nada é gravado', async () => {
  const A = await mkProf('dona');
  const B = await mkProf('outra');
  const appt = await mkAppt(A, 'confirmado');
  assert.equal((await checkIn(B, appt)).status, 404);
  assert.equal((await one(`SELECT checked_in_at FROM appointments WHERE id = $1`, [appt])).checked_in_at, null);
});

dbTest('desfazer o check-in direto no banco sem justificativa é recusado pelo gatilho', async () => {
  const A = await mkProf('guarda');
  const appt = await mkAppt(A, 'confirmado');
  assert.equal((await checkIn(A, appt)).status, 200);
  await assert.rejects(() => owner.query(`UPDATE appointments SET checked_in_at = NULL WHERE id = $1`, [appt]));
  assert.ok((await one(`SELECT checked_in_at FROM appointments WHERE id = $1`, [appt])).checked_in_at);
});

test('sem login: 401 (não precisa de banco)', async (t) => {
  if (skip) return t.skip(skip);
  const res = await fetch(`${baseUrl}/appointments/${randomUUID()}/check-in`, { method: 'POST' });
  assert.equal(res.status, 401);
});

// ── chegada deixa de valer quando o agendamento volta para pendente / é cancelado / vira falta ─────────────────────────
const put = async (p, appt, body) => {
  const res = await fetch(`${baseUrl}/appointments/${appt}`, {
    method: 'PUT', headers: { cookie: `nailflow_token=${p.token}`, 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
};
const chegada = async (appt) => (await one(`SELECT checked_in_at FROM appointments WHERE id = $1`, [appt])).checked_in_at;

dbTest('voltar para pendente desfaz a chegada (com histórico e motivo); confirmar de novo não reaparece "em atendimento"', async () => {
  const A = await mkProf('reset');
  const appt = await mkAppt(A, 'confirmado');
  assert.equal((await checkIn(A, appt)).status, 200);
  const r = await put(A, appt, { status: 'pendente' });
  assert.equal(r.status, 200);
  assert.equal(await chegada(appt), null);
  assert.equal(r.json.checkedInAt, null);
  const logs = (await owner.query(`SELECT before_data, after_data, reason FROM financial_audit_log WHERE entity_id = $1 AND action = 'appointment_checkin' ORDER BY seq`, [appt])).rows;
  assert.equal(logs.length, 2);                                   // chegada + desfeita: o histórico não é apagado
  assert.ok(logs[0].before_data.checked_in_at === null && logs[0].after_data.checked_in_at);
  assert.ok(logs[1].before_data.checked_in_at && logs[1].after_data.checked_in_at === null);
  assert.match(logs[1].reason, /Chegada desfeita/);
  assert.equal((await put(A, appt, { status: 'confirmado' })).json.checkedInAt, null);
});

dbTest('concluir mantém a chegada; marcar falta ou cancelar depois a desfaz', async () => {
  const A = await mkProf('keep');
  const a1 = await mkAppt(A, 'confirmado');
  await checkIn(A, a1);
  assert.equal((await put(A, a1, { status: 'concluido' })).status, 200);
  assert.ok(await chegada(a1));
  assert.equal((await put(A, a1, { status: 'nao_compareceu' })).status, 200);
  assert.equal(await chegada(a1), null);

  const a2 = await mkAppt(A, 'confirmado');
  await checkIn(A, a2);
  assert.equal((await put(A, a2, { status: 'cancelado' })).status, 200);
  assert.equal(await chegada(a2), null);
});

dbTest('editar só observação ou horário não mexe na chegada', async () => {
  const A = await mkProf('notes');
  const appt = await mkAppt(A, 'confirmado');
  await checkIn(A, appt);
  const before = (await chegada(appt)).toISOString();
  assert.equal((await put(A, appt, { notes: 'só uma anotação' })).status, 200);
  assert.equal((await chegada(appt)).toISOString(), before);
});
