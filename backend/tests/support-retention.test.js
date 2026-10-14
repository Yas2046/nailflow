// Rotina de retenção da Central de Suporte (backend/db/migrations/_ops/support_retention.sql), executada com o psql
// real contra o banco DESCARTÁVEL confirmado por tests/helpers/supportTestDb.js. Nunca roda sem
// SUPPORT_API_TEST_DB_URL. Rode uma suíte de banco por vez no mesmo banco (--test-concurrency=1).
//
// Prova: chamados resolvidos vencidos somem por inteiro (mensagens e eventos junto) e os demais ficam; o relógio
// é o da ÚLTIMA resolução; parâmetros inválidos abortam sem apagar nada; a auditoria só é tocada com
// audit_enabled=on (desligada por padrão) e então anonimiza, apaga e é idempotente.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dbWanted, skip, startHarness } from './helpers/supportHarness.js';

const SQL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../db/migrations/_ops/support_retention.sql');
const opts = { skip, timeout: 120_000 };
let h;
let admin;
let owner;

before(async () => {
  if (!dbWanted) return;
  h = await startHarness();
  admin = await h.newProf({ admin: true });
  owner = await h.newProf();
});
after(async () => { if (h) await h.stop(); });

function runRetention(vars = {}) {
  const args = [process.env.SUPPORT_API_TEST_DB_URL, '-X', '-v', 'ON_ERROR_STOP=1'];
  for (const [k, v] of Object.entries(vars)) args.push('-v', `${k}=${v}`);
  args.push('-f', SQL);
  const r = spawnSync('psql', args, { encoding: 'utf8' });
  return { status: r.status, out: `${r.stdout}\n${r.stderr}` };
}

// Chamado com 1 mensagem da profissional, 1 da ADM, resolvido há `ago`.
async function resolvedTicket(ago, subject) {
  const t = await h.seedTicket(owner, { subject });
  await h.profMessage(t.id, owner.id, 'pergunta');
  await h.adminMessage(t.id, owner.id, admin.id, 'resposta');
  await h.pool.query(
    `INSERT INTO support_ticket_events (ticket_id, professional_id, type, from_value, to_value, actor_role, actor_id)
     VALUES ($1, $2, 'status_changed', 'aberta', 'resolvida', 'admin', $3)`,
    [t.id, owner.id, admin.id]
  );
  await h.resolveTicket(t.id, admin.id, ago);
  return t.id;
}
const exists = async (id) => (await h.pool.query('SELECT 1 FROM support_tickets WHERE id = $1', [id])).rowCount === 1;
const children = async (id) => ({
  messages: (await h.pool.query('SELECT count(*)::int AS n FROM support_messages WHERE ticket_id = $1', [id])).rows[0].n,
  events: (await h.pool.query('SELECT count(*)::int AS n FROM support_ticket_events WHERE ticket_id = $1', [id])).rows[0].n,
});

test('padrão de 6 meses: o resolvido vencido é apagado por inteiro; o recente, o aberto e o de 5 meses ficam', opts, async () => {
  const velho = await resolvedTicket('6 months 1 day', 'velho');
  const quase = await resolvedTicket('5 months 29 days', 'quase');
  const recente = await resolvedTicket('7 days', 'recente');
  const aberto = (await h.seedTicket(owner, { subject: 'aberto' })).id;
  await h.profMessage(aberto, owner.id, 'ainda aberto');
  const filhos = await children(velho);
  assert.ok(filhos.messages === 2 && filhos.events >= 1, `pré-condição: o chamado tem mensagens e eventos (${JSON.stringify(filhos)})`);

  const r = runRetention();
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /chamados_apagados[\s\S]*?\b1\b/);
  assert.match(r.out, /DESLIGADA/, 'a auditoria deve estar desligada por padrão');

  assert.equal(await exists(velho), false, 'o chamado vencido deveria ter sido apagado');
  assert.deepEqual(await children(velho), { messages: 0, events: 0 }, 'mensagens e eventos deveriam cair em cascata');
  for (const id of [quase, recente, aberto]) assert.equal(await exists(id), true, 'um chamado dentro do prazo ou aberto foi apagado');
  assert.ok((await children(quase)).messages === 2, 'as mensagens dos chamados mantidos ficam intactas');
});

test('idempotente: uma segunda execução não apaga nada', opts, async () => {
  const antes = (await h.pool.query('SELECT count(*)::int AS n FROM support_tickets')).rows[0].n;
  const r = runRetention();
  assert.equal(r.status, 0, r.out);
  assert.equal((await h.pool.query('SELECT count(*)::int AS n FROM support_tickets')).rows[0].n, antes);
});

test('chamado reaberto e resolvido de novo conta a partir da ÚLTIMA resolução', opts, async () => {
  const id = await resolvedTicket('8 months', 'reaberto');
  await h.pool.query(`UPDATE support_tickets SET status = 'aberta', resolved_at = NULL, resolved_by = NULL WHERE id = $1`, [id]);
  assert.equal((await h.ticketRow(id)).status, 'aberta');
  // enquanto estiver aberto nunca é apagado, por mais antigo que tenha sido resolvido um dia
  assert.equal(runRetention().status, 0);
  assert.equal(await exists(id), true, 'um chamado aberto foi apagado');
  await h.resolveTicket(id, admin.id, '1 hour');
  assert.equal(runRetention().status, 0);
  assert.equal(await exists(id), true, 'o relógio deveria partir da última resolução (há 1 hora)');
  await h.pool.query(`UPDATE support_tickets SET resolved_at = now() - interval '6 months 1 day' WHERE id = $1`, [id]);
  assert.equal(runRetention().status, 0);
  assert.equal(await exists(id), false, 'depois de 6 meses da última resolução o chamado deve sair');
});

test('tickets_months é respeitado e parâmetros inválidos abortam SEM apagar nada', opts, async () => {
  const id = await resolvedTicket('7 months', 'sete meses');
  for (const bad of ['0', '-3', 'abc', '2.5']) {
    const r = runRetention({ tickets_months: bad });
    assert.notEqual(r.status, 0, `tickets_months=${bad} deveria falhar`);
    assert.equal(await exists(id), true, `tickets_months=${bad} apagou algo`);
  }
  const keep = runRetention({ tickets_months: 8 });
  assert.equal(keep.status, 0, keep.out);
  assert.equal(await exists(id), true, 'com 8 meses o chamado de 7 meses deve ficar');
  const del = runRetention({ tickets_months: 7 });
  assert.equal(del.status, 0, del.out);
  assert.equal(await exists(id), false, 'com 7 meses o chamado de 7 meses e 0 dias... já venceu');
});

async function auditRow(ago, email, name, action = 'delete') {
  const target = await h.newProf({ businessName: name });
  await h.pool.query(
    `INSERT INTO admin_audit_log (actor_id, actor_email, action, target_id, target_business_name, created_at)
     VALUES ($1, $2, $3, $4, $5, now() - $6::interval)`,
    [admin.id, email, action, target.id, name, ago]
  );
  return target.id;
}
const audit = async (targetId) => (await h.pool.query(
  'SELECT actor_id, actor_email, action, target_id, target_business_name, created_at FROM admin_audit_log WHERE target_id = $1', [targetId])).rows;

test('auditoria desligada por padrão: nenhuma linha é alterada nem apagada', opts, async () => {
  const velho = await auditRow('40 months', 'a@x.test', 'Negócio velho');
  const treze = await auditRow('13 months', 'b@x.test', 'Negócio treze');
  const r = runRetention();
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /DESLIGADA/);
  assert.equal((await audit(velho)).length, 1, 'a auditoria foi apagada com a rotina desligada');
  assert.equal((await audit(treze))[0].actor_email, 'b@x.test', 'a auditoria foi anonimizada com a rotina desligada');
});

test('auditoria ligada: >12 meses anonimiza e-mail e nome (ação, data e ids ficam); >36 meses é apagada; 11 meses intacta', opts, async () => {
  const onze = await auditRow('11 months', 'c@x.test', 'Negócio onze');
  const treze = await auditRow('13 months', 'd@x.test', 'Negócio treze B', 'block');
  const quarenta = await auditRow('37 months', 'e@x.test', 'Negócio trinta e sete');
  const before13 = (await audit(treze))[0];

  const scalar = async (sql) => Number((await h.pool.query(sql)).rows[0].n);
  const esperadaAnon = await scalar(`SELECT count(*) AS n FROM admin_audit_log WHERE created_at < now() - interval '12 months'
     AND created_at >= now() - interval '36 months' AND (actor_email <> '[anonimizado]' OR target_business_name <> '[anonimizado]')`);
  const esperadaApagada = await scalar(`SELECT count(*) AS n FROM admin_audit_log WHERE created_at < now() - interval '36 months'`);
  assert.ok(esperadaAnon >= 1 && esperadaApagada >= 1, 'pré-condição do cenário');

  const r = runRetention({ audit_enabled: 'on' });
  assert.equal(r.status, 0, r.out);
  assert.doesNotMatch(r.out, /DESLIGADA/);
  // a contagem de anonimizadas não inclui as linhas que são apagadas na mesma execução (>36 meses)
  const count = (col) => Number(new RegExp(`${col}\\s*\\n[-+]+\\n\\s*(\\d+)`).exec(r.out)?.[1]);
  assert.equal(count('auditoria_anonimizada'), esperadaAnon, r.out);
  assert.equal(count('auditoria_apagada'), esperadaApagada, r.out);

  assert.equal((await audit(onze))[0].actor_email, 'c@x.test');
  assert.equal((await audit(onze))[0].target_business_name, 'Negócio onze');
  const a13 = (await audit(treze))[0];
  assert.equal(a13.actor_email, '[anonimizado]'); assert.equal(a13.target_business_name, '[anonimizado]');
  assert.equal(a13.action, 'block'); assert.equal(a13.actor_id, before13.actor_id);
  assert.equal(a13.target_id, before13.target_id); assert.equal(+a13.created_at, +before13.created_at);
  assert.equal((await audit(quarenta)).length, 0, 'a linha com mais de 36 meses deveria ter sido apagada');

  // idempotente
  const again = runRetention({ audit_enabled: 'on' });
  assert.equal(again.status, 0, again.out);
  assert.match(again.out, /auditoria_anonimizada[\s\S]*?\b0\b/);
  assert.equal((await audit(treze))[0].actor_email, '[anonimizado]');
});

test('audit_enabled inválido aborta ANTES de apagar qualquer chamado', opts, async () => {
  const id = await resolvedTicket('9 months', 'nove meses');
  const r = runRetention({ audit_enabled: 'talvez' });
  assert.notEqual(r.status, 0);
  assert.equal(await exists(id), true, 'um valor inválido de audit_enabled não pode deixar a rotina apagar chamados');
  const ok = runRetention({ audit_enabled: 'off' });
  assert.equal(ok.status, 0, ok.out);
  assert.equal(await exists(id), false);
});

test('prazos de auditoria incoerentes abortam sem alterar a auditoria', opts, async () => {
  const treze = await auditRow('14 months', 'f@x.test', 'Negócio incoerente');
  for (const vars of [{ audit_identifiable_months: 24, audit_total_months: 12 }, { audit_identifiable_months: 0, audit_total_months: 36 }]) {
    const r = runRetention({ audit_enabled: 'on', ...vars });
    assert.notEqual(r.status, 0);
    assert.equal((await audit(treze))[0].actor_email, 'f@x.test');
  }
});
