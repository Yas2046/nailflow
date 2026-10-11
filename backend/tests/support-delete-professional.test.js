// Exclusão de profissional (DELETE /admin/professionals/:id) com a Central de Suporte: as conversas entram no
// snapshot e na prévia, são apagadas em cascade sem sobrar órfãos, e nada de suporte é apagado fora do snapshot.
// Também prova que, sem a migration 023 aplicada, a exclusão continua exatamente como antes.
//
// Só roda com SUPPORT_API_TEST_DB_URL (banco DESCARTÁVEL com migrations 023/024; guarda em
// tests/helpers/supportTestDb.js). O snapshot vai para um diretório temporário criado e removido aqui
// (DELETED_PROFESSIONAL_BACKUP_DIR), nunca para /var/backups. Rode uma suíte de banco por vez no mesmo banco.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { dbWanted, skip, startHarness } from './helpers/supportHarness.js';

const opts = { skip, timeout: 120_000 };
let h;
let admin;
let snapshotDir;

before(async () => {
  if (!dbWanted) return;
  snapshotDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nf-del-snap-'));
  h = await startHarness({ DELETED_PROFESSIONAL_BACKUP_DIR: snapshotDir });
  admin = await h.newProf({ admin: true });
});
after(async () => {
  if (h) await h.stop();
  if (snapshotDir) await fs.rm(snapshotDir, { recursive: true, force: true });
});

const ticketBody = (over = {}) => ({
  subject: 'Preciso de ajuda', category: 'agenda', body: 'Não consigo bloquear um horário.', clientRequestId: randomUUID(), ...over,
});
const del = (prof, businessName, as = admin) =>
  h.call('DELETE', `/admin/professionals/${prof.id}`, { as, body: { businessNameConfirmation: businessName } });
const snapshotOf = async (profId) => {
  const files = (await fs.readdir(snapshotDir)).filter((f) => f.startsWith(`professional_${profId}_`));
  assert.equal(files.length, 1, `snapshots de ${profId}: ${files.join(', ')}`);
  const file = path.join(snapshotDir, files[0]);
  return { file, data: JSON.parse(await fs.readFile(file, 'utf8')), mode: (await fs.stat(file)).mode & 0o777 };
};
const supportCounts = async (profId) => Object.fromEntries(await Promise.all(
  ['support_tickets', 'support_messages', 'support_ticket_events'].map(async (t) =>
    [t, Number((await h.one(`SELECT count(*) AS n FROM ${t} WHERE professional_id = $1`, [profId])).n)])
));

async function profWithConversations(label) {
  const businessName = `${label} ${h.runId}`;
  const prof = await h.newProf({ businessName });
  const created = await h.call('POST', '/support/tickets', { as: prof, body: ticketBody() });
  assert.equal(created.status, 201, created.text);
  await h.adminMessage(created.json.ticket.id, prof.id, admin.id, 'Resposta da equipe');
  const seeded = await h.seedTicket(prof, { subject: 'Segunda solicitação' });
  await h.profMessage(seeded.id, prof.id, 'Mensagem da segunda');
  return { prof, businessName, ticketIds: [created.json.ticket.id, seeded.id] };
}

test('prévia e snapshot incluem as conversas; a exclusão as apaga sem órfãos e sem tocar nas de outra conta', opts, async () => {
  const { prof, businessName } = await profWithConversations('Excluir');
  const other = await profWithConversations('Outra');
  const mine = await supportCounts(prof.id);
  assert.deepEqual([mine.support_tickets, mine.support_messages > 0, mine.support_ticket_events > 0], [2, true, true]);
  const theirsBefore = await supportCounts(other.prof.id);

  const preview = await h.call('GET', `/admin/professionals/${prof.id}/delete-preview`, { as: admin });
  assert.equal(preview.status, 200);
  assert.equal(preview.json.supportTickets, 2);
  for (const key of ['clients', 'appointments', 'services', 'recurringGroups', 'messages', 'expenses']) assert.equal(typeof preview.json[key], 'number', key);

  // Confirmação errada e autoexclusão continuam recusadas, sem apagar nada.
  assert.equal((await del(prof, 'nome errado')).status, 400);
  assert.equal((await del(admin, 'qualquer')).status, 400);
  assert.deepEqual(await supportCounts(prof.id), mine);

  const r = await del(prof, businessName);
  assert.equal(r.status, 204, r.text);

  const { data, mode } = await snapshotOf(prof.id);
  assert.equal(mode, 0o600);
  assert.equal(data.professional.id, prof.id);
  assert.equal(data.professional.password_hash, undefined);
  assert.equal(data.professional.support_fab_hidden, false);
  assert.equal(data.support_tickets.length, mine.support_tickets);
  assert.equal(data.support_messages.length, mine.support_messages);
  assert.equal(data.support_ticket_events.length, mine.support_ticket_events);
  assert.ok(data.support_messages.some((m) => m.body === 'Resposta da equipe' && m.author_role === 'admin'));
  assert.ok(data.support_tickets.every((t) => t.professional_id === prof.id));
  // O snapshot é da conta excluída: nada da outra aparece nele.
  assert.ok(!JSON.stringify(data).includes(other.ticketIds[0]));

  assert.deepEqual(await supportCounts(prof.id), { support_tickets: 0, support_messages: 0, support_ticket_events: 0 });
  assert.equal(await h.one('SELECT 1 FROM professionals WHERE id = $1', [prof.id]), undefined);
  assert.deepEqual(await supportCounts(other.prof.id), theirsBefore);                       // outra conta intacta
  assert.equal(Number((await h.one(
    `SELECT count(*) AS n FROM support_messages m LEFT JOIN support_tickets t ON t.id = m.ticket_id WHERE t.id IS NULL`
  )).n), 0);                                                                                 // sem mensagens órfãs
  assert.deepEqual((await h.auditRows('target_id = $1', [prof.id])).map((a) => [a.action, a.actor_id, a.target_business_name]), [['delete', admin.id, businessName]]);
});

test('conta sem conversas: snapshot traz as listas de suporte vazias e a exclusão segue igual', opts, async () => {
  const businessName = `Sem conversas ${h.runId}`;
  const prof = await h.newProf({ businessName });
  const preview = await h.call('GET', `/admin/professionals/${prof.id}/delete-preview`, { as: admin });
  assert.equal(preview.json.supportTickets, 0);
  assert.equal((await del(prof, businessName)).status, 204);
  const { data } = await snapshotOf(prof.id);
  assert.deepEqual([data.support_tickets, data.support_messages, data.support_ticket_events], [[], [], []]);
});

test('excluir uma ADM que atendeu: mensagens ficam sem autor, resolvidas ficam sem resolved_by, artigos sem autor', opts, async () => {
  const adminX = await h.newProf({ admin: true, businessName: `AdminX ${h.runId}` });
  const { prof, ticketIds } = await profWithConversations('Atendida');
  await h.adminMessage(ticketIds[1], prof.id, adminX.id, 'Resposta da administradora que será excluída');
  await h.resolveTicket(ticketIds[0], adminX.id);
  const art = await h.one(
    `INSERT INTO support_faq_articles (category_slug, title, body, created_by, updated_by) VALUES ('agenda', $1, 'x', $2, $2) RETURNING id`,
    [`Artigo do adminX ${h.runId}`, adminX.id]
  );

  const r = await del(adminX, `AdminX ${h.runId}`);
  assert.equal(r.status, 204, r.text);

  const orphanMsg = await h.one(`SELECT author_role, author_id, body FROM support_messages WHERE ticket_id = $1 AND body LIKE 'Resposta da administradora%'`, [ticketIds[1]]);
  assert.deepEqual([orphanMsg.author_role, orphanMsg.author_id], ['admin', null]);          // a mensagem fica; só o autor some
  const resolved = await h.ticketRow(ticketIds[0]);
  assert.equal(resolved.status, 'resolvida');
  assert.ok(resolved.resolved_at);
  assert.equal(resolved.resolved_by, null);
  const faq = await h.one('SELECT created_by, updated_by FROM support_faq_articles WHERE id = $1', [art.id]);
  assert.deepEqual([faq.created_by, faq.updated_by], [null, null]);
  // As conversas da profissional atendida não são afetadas pela exclusão da ADM.
  assert.equal((await supportCounts(prof.id)).support_tickets, 2);
  await h.pool.query('DELETE FROM support_faq_articles WHERE id = $1', [art.id]);
});

test('sem a migration 023 aplicada (tabelas ausentes): prévia e exclusão funcionam como antes', opts, async () => {
  const businessName = `Sem migration ${h.runId}`;
  const prof = await h.newProf({ businessName });
  const tables = ['support_ticket_events', 'support_messages', 'support_tickets'];
  await h.pool.query(`BEGIN; ${tables.map((t) => `ALTER TABLE ${t} RENAME TO zz_off_${t}`).join('; ')}; COMMIT`);
  try {
    const preview = await h.call('GET', `/admin/professionals/${prof.id}/delete-preview`, { as: admin });
    assert.equal(preview.status, 200, preview.text);
    assert.equal(preview.json.supportTickets, 0);
    const r = await del(prof, businessName);
    assert.equal(r.status, 204, r.text);
    const { data } = await snapshotOf(prof.id);
    assert.ok(!('support_tickets' in data) && !('support_messages' in data) && !('support_ticket_events' in data));
    assert.ok('clients' in data && 'appointments' in data);                                  // o restante do snapshot é o de sempre
    assert.equal(await h.one('SELECT 1 FROM professionals WHERE id = $1', [prof.id]), undefined);
  } finally {
    await h.pool.query(`BEGIN; ${tables.slice().reverse().map((t) => `ALTER TABLE zz_off_${t} RENAME TO ${t}`).join('; ')}; COMMIT`);
  }
  assert.ok(await h.one(`SELECT to_regclass('public.support_tickets') AS t`).then((r) => r.t));
});

test('atividade de suporte gravada entre o snapshot e a exclusão: 409, nada é apagado, e o retry inclui a mensagem nova', opts, async () => {
  const { prof, businessName, ticketIds } = await profWithConversations('Corrida');
  const before = await supportCounts(prof.id);

  // Uma escrita de suporte ainda não confirmada segura o lock da solicitação; a exclusão tira o snapshot (sem
  // enxergá-la), espera esse lock e, quando a escrita confirma, vê mais linhas do que o snapshot tem.
  const writer = await h.pool.connect();
  let pending;
  try {
    await writer.query('BEGIN');
    await writer.query(
      `INSERT INTO support_messages (ticket_id, professional_id, author_role, author_id, body) VALUES ($1, $2, 'professional', $2, 'Mensagem de última hora')`,
      [ticketIds[0], prof.id]
    );
    pending = del(prof, businessName);
    await h.waitUntil(async () => Number((await h.one(
      `SELECT count(*) AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%FROM support_tickets WHERE professional_id = $1 FOR UPDATE%'`
    )).n) >= 1);
    await writer.query('COMMIT');
  } finally {
    await writer.query('ROLLBACK').catch(() => {});
    writer.release();
  }
  const r = await pending;
  assert.equal(r.status, 409, r.text);
  assert.match(r.json.error, /atividade de suporte/);
  assert.ok(await h.one('SELECT 1 FROM professionals WHERE id = $1', [prof.id]));          // nada foi excluído
  const mid = await supportCounts(prof.id);
  assert.equal(mid.support_messages, before.support_messages + 1);
  assert.equal(mid.support_tickets, before.support_tickets);
  assert.deepEqual(await h.auditRows('target_id = $1', [prof.id]), []);                     // sem registro de exclusão

  const retry = await del(prof, businessName);
  assert.equal(retry.status, 204, retry.text);
  const files = (await fs.readdir(snapshotDir)).filter((f) => f.startsWith(`professional_${prof.id}_`)).sort();
  assert.equal(files.length, 2);                                                            // o 1º snapshot (abortado) e o do retry
  const last = JSON.parse(await fs.readFile(path.join(snapshotDir, files[files.length - 1]), 'utf8'));
  assert.ok(last.support_messages.some((m) => m.body === 'Mensagem de última hora'));
  assert.deepEqual(await supportCounts(prof.id), { support_tickets: 0, support_messages: 0, support_ticket_events: 0 });
});

test('falha no meio da exclusão não deixa conversas parciais (a transação desfaz tudo)', opts, async () => {
  const { prof, businessName } = await profWithConversations('Rollback');
  const before = await supportCounts(prof.id);
  // Impede o DELETE da profissional com um trigger temporário: a transação inteira deve ser desfeita.
  await h.pool.query(`
    CREATE OR REPLACE FUNCTION zz_block_prof_delete() RETURNS trigger LANGUAGE plpgsql AS $f$
    BEGIN
      IF OLD.business_name LIKE 'Rollback%' THEN RAISE EXCEPTION 'delete bloqueado pelo teste' USING ERRCODE = 'check_violation'; END IF;
      RETURN OLD;
    END $f$`);
  await h.pool.query('CREATE TRIGGER zz_block_prof_delete BEFORE DELETE ON professionals FOR EACH ROW EXECUTE FUNCTION zz_block_prof_delete()');
  try {
    const r = await del(prof, businessName);
    assert.equal(r.status, 500);
  } finally {
    await h.pool.query('DROP TRIGGER IF EXISTS zz_block_prof_delete ON professionals');
    await h.pool.query('DROP FUNCTION IF EXISTS zz_block_prof_delete()');
  }
  assert.ok(await h.one('SELECT 1 FROM professionals WHERE id = $1', [prof.id]));
  assert.deepEqual(await supportCounts(prof.id), before);
  assert.deepEqual(await h.auditRows('target_id = $1', [prof.id]), []);
});
