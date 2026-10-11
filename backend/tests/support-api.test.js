// Testes da API da profissional da Central de Suporte (/support/*), contra o servidor real (app do server.js).
//
// Os testes de banco só rodam com SUPPORT_API_TEST_DB_URL apontando para um banco DESCARTÁVEL que já tenha o
// schema base e as migrations 023/024 (ver tests/helpers/supportTestDb.js: opt-in NAILFLOW_ALLOW_TEST_DDL=1,
// loopback, nome nf_*_test, cluster só com bancos descartáveis, marcador no banco). Se a variável estiver
// definida e a guarda falhar, o arquivo ABORTA. Sem a variável, só os testes que não tocam o banco rodam.
//
// USO EXCLUSIVO DO BANCO: a suíte cria contas e solicitações de teste (e as remove ao final) e instala, durante
// a execução, um trigger de falha injetada em support_messages. Não rode duas execuções simultâneas no mesmo banco.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { inspect } from 'node:util';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import jwt from 'jsonwebtoken';
import { resolveTestDb } from './helpers/supportTestDb.js';

// Antes de qualquer import dinâmico do servidor: o interruptor é lido na carga do módulo de configuração.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET ||= 'support-api-test-secret';
process.env.SUPPORT_CENTER_ENABLED = 'true';

const SERVER_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/server.js');
const dbWanted = Boolean(process.env.SUPPORT_API_TEST_DB_URL);
const skip = dbWanted ? false : 'sem SUPPORT_API_TEST_DB_URL (testes de banco ignorados)';
const opts = { skip, timeout: 90_000 };

let pool;
let server;
let baseUrl;
let admin;
const createdIds = [];
const runId = randomUUID().slice(0, 8);
let counter = 0;

const FAIL_PREFIX = 'FALHAR-TESTE';

before(async () => {
  if (!dbWanted) return;
  const target = await resolveTestDb();
  process.env.DATABASE_URL = target.url;
  ({ pool } = await import('../src/config/db.js'));
  // Falha injetada: qualquer mensagem iniciada por FALHAR-TESTE aborta o INSERT, com o texto no DETAIL do erro.
  await pool.query(`DROP TRIGGER IF EXISTS zz_support_test_fail ON support_messages`);
  await pool.query(`
    CREATE OR REPLACE FUNCTION zz_support_test_fail() RETURNS trigger LANGUAGE plpgsql AS $f$
    BEGIN
      IF NEW.body LIKE '${FAIL_PREFIX}%' THEN
        RAISE EXCEPTION 'falha injetada pelo teste' USING ERRCODE = 'check_violation', DETAIL = format('linha: %s', NEW.body);
      END IF;
      RETURN NEW;
    END $f$`);
  await pool.query(`CREATE TRIGGER zz_support_test_fail BEFORE INSERT ON support_messages
                    FOR EACH ROW EXECUTE FUNCTION zz_support_test_fail()`);
  const { default: app } = await import('../src/server.js');
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  admin = await newProf({ admin: true });
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (pool) {
    await pool.query('DROP TRIGGER IF EXISTS zz_support_test_fail ON support_messages').catch(() => {});
    await pool.query('DROP FUNCTION IF EXISTS zz_support_test_fail()').catch(() => {});
    if (createdIds.length) await pool.query('DELETE FROM professionals WHERE id = ANY($1::uuid[])', [createdIds]).catch(() => {});
    await pool.end();
  }
});

// ── Utilitários ─────────────────────────────────────────────────────────────

async function newProf({ admin: isAdmin = false } = {}) {
  const n = ++counter;
  const digits = String(Math.floor(Math.random() * 1e9)).padStart(9, '0');
  const { rows } = await pool.query(
    `INSERT INTO professionals (name, email, password_hash, phone_whatsapp, business_name, slug, is_admin)
     VALUES ($1, $2, 'x', $3, $4, $5, $6) RETURNING id, token_version`,
    [`Sup ${n}`, `sup-${runId}-${n}@teste.local`, `5531${digits}`, `Studio ${runId}-${n}`, `sup-${runId}-${n}`, isAdmin]
  );
  createdIds.push(rows[0].id);
  return {
    id: rows[0].id,
    token: jwt.sign({ sub: rows[0].id, ver: rows[0].token_version }, process.env.JWT_SECRET, { expiresIn: '1h' }),
  };
}

async function call(method, urlPath, { as, body, rawBody, base = baseUrl } = {}) {
  const headers = {};
  if (as) headers.cookie = `nailflow_token=${as.token}`;
  let payload;
  if (rawBody !== undefined) { headers['content-type'] = 'application/json'; payload = rawBody; }
  else if (body !== undefined) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(`${base}${urlPath}`, { method, headers, body: payload });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* corpo vazio (204) */ }
  return { status: res.status, json, text };
}

const ticketBody = (over = {}) => ({
  subject: 'Preciso de ajuda com a agenda',
  category: 'agenda',
  body: 'Não consigo bloquear um horário.',
  clientRequestId: randomUUID(),
  ...over,
});
const msgBody = (over = {}) => ({ body: 'Mais um detalhe do problema.', clientMessageId: randomUUID(), ...over });

async function apiCreate(as, over) {
  const r = await call('POST', '/support/tickets', { as, body: ticketBody(over) });
  assert.equal(r.status, 201, r.text);
  return r.json.ticket;
}

const one = async (sql, params) => (await pool.query(sql, params)).rows[0];
const ticketRow = (id) => one('SELECT * FROM support_tickets WHERE id = $1', [id]);
const activity = async (id) => ({
  events: (await pool.query('SELECT seq, type, from_value, to_value, actor_role FROM support_ticket_events WHERE ticket_id = $1 ORDER BY seq', [id])).rows,
  messages: (await pool.query('SELECT seq, author_role, body FROM support_messages WHERE ticket_id = $1 ORDER BY seq', [id])).rows,
});
const countTickets = async (profId) => Number((await one('SELECT count(*) AS n FROM support_tickets WHERE professional_id = $1', [profId])).n);

// Solicitação criada direto no banco (sem atividade): só para montar cenários.
async function seedTicket(prof, { subject, category = 'agenda' } = {}) {
  return one(
    `INSERT INTO support_tickets (professional_id, category, subject) VALUES ($1, $2, $3) RETURNING id, ticket_number`,
    [prof.id, category, subject ?? `Chamado ${randomUUID().slice(0, 8)}`]
  );
}
async function resolveTicket(id, ago = '1 hour') {
  await pool.query(
    `UPDATE support_tickets SET status = 'resolvida', resolved_at = now() - $2::interval, resolved_by = $3 WHERE id = $1`,
    [id, ago, admin.id]
  );
}
// Atividades da ADM seguindo o contrato de inserção: um INSERT por atividade.
async function adminMessage(ticketId, profId, body = 'Resposta da equipe') {
  await pool.query(
    `INSERT INTO support_messages (ticket_id, professional_id, author_role, author_id, body) VALUES ($1, $2, 'admin', $3, $4)`,
    [ticketId, profId, admin.id, body]
  );
}
async function adminEvent(ticketId, profId, type, from, to) {
  await pool.query(
    `INSERT INTO support_ticket_events (ticket_id, professional_id, type, from_value, to_value, actor_role, actor_id)
     VALUES ($1, $2, $3, $4, $5, 'admin', $6)`,
    [ticketId, profId, type, from, to, admin.id]
  );
}
// A ADM responde: mensagem + status "Aguardando você" + evento (o que a API da ADM fará).
async function adminReplies(ticketId, profId, body) {
  await adminMessage(ticketId, profId, body);
  await pool.query(`UPDATE support_tickets SET status = 'aguardando_profissional' WHERE id = $1 AND status <> 'resolvida'`, [ticketId]);
  await adminEvent(ticketId, profId, 'status_changed', 'aberta', 'aguardando_profissional');
}

async function waitUntil(fn, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await fn()) return;
    if (Date.now() > deadline) throw new Error('condição não atendida a tempo');
    await new Promise((r) => setTimeout(r, 25));
  }
}

const TICKET_KEYS = [
  'activitySeq', 'canReopenUntil', 'category', 'createdAt', 'id', 'lastActivityAt', 'profReadSeq',
  'resolvedAt', 'status', 'subject', 'ticketNumber', 'unread',
];

// ── Interruptor (sem banco) ─────────────────────────────────────────────────

test('interruptor: só "true" (aparado, sem diferenciar caixa) liga; todo o resto desliga', async () => {
  const { parseSupportFlag } = await import('../src/config/support.js');
  for (const on of ['true', 'TRUE', ' true ', 'True\n', '\ttrue']) assert.equal(parseSupportFlag(on), true, JSON.stringify(on));
  for (const off of [undefined, null, '', ' ', '1', 'yes', 'on', 'false', 'FALSE', 'tru', 'true1', 'true false', 1, true, {}]) {
    assert.equal(parseSupportFlag(off), false, String(off));
  }
});

// ── Autenticação e papéis ───────────────────────────────────────────────────

test('sem sessão: toda rota de suporte responde 401', opts, async () => {
  const id = randomUUID();
  const routes = [
    ['GET', '/support/bootstrap'], ['GET', '/support/faq'], ['GET', '/support/tickets'], ['POST', '/support/tickets'],
    ['GET', `/support/tickets/${id}`], ['POST', `/support/tickets/${id}/messages`], ['POST', `/support/tickets/${id}/reopen`],
    ['POST', `/support/tickets/${id}/read`], ['PUT', '/support/preferences'],
  ];
  for (const [method, p] of routes) {
    const r = await call(method, p, method === 'GET' ? {} : { body: {} });
    assert.equal(r.status, 401, `${method} ${p}`);
    assert.deepEqual(r.json, { error: 'Não autenticado.' });
  }
  // Token inválido também é 401.
  const bad = await call('GET', '/support/tickets', { as: { token: 'lixo' } });
  assert.equal(bad.status, 401);
});

test('conta administradora é recusada (403) em todas as rotas de profissional, inclusive o bootstrap', opts, async () => {
  const id = randomUUID();
  const routes = [
    ['GET', '/support/bootstrap'], ['GET', '/support/faq'], ['GET', '/support/tickets'], ['POST', '/support/tickets'],
    ['GET', `/support/tickets/${id}`], ['POST', `/support/tickets/${id}/messages`], ['POST', `/support/tickets/${id}/reopen`],
    ['POST', `/support/tickets/${id}/read`], ['PUT', '/support/preferences'],
  ];
  for (const [method, p] of routes) {
    const r = await call(method, p, { as: admin, ...(method === 'GET' ? {} : { body: ticketBody() }) });
    assert.equal(r.status, 403, `${method} ${p}`);
    assert.deepEqual(r.json, { error: 'Acesso não autorizado.' });
  }
  assert.equal(await countTickets(admin.id), 0);
});

test('profissional bloqueada ou com sessão revogada recebe 401', opts, async () => {
  const blocked = await newProf();
  await pool.query('UPDATE professionals SET blocked_at = now() WHERE id = $1', [blocked.id]);
  assert.equal((await call('GET', '/support/tickets', { as: blocked })).status, 401);
  const revoked = await newProf();
  await pool.query('UPDATE professionals SET token_version = token_version + 1 WHERE id = $1', [revoked.id]);
  assert.equal((await call('GET', '/support/tickets', { as: revoked })).status, 401);
});

test('identificador malformado é 400; inexistente é 404; rota desconhecida cai no 404 geral', opts, async () => {
  const a = await newProf();
  assert.equal((await call('GET', '/support/tickets/nao-e-uuid', { as: a })).status, 400);
  assert.equal((await call('POST', '/support/tickets/123/messages', { as: a, body: msgBody() })).status, 400);
  assert.equal((await call('GET', `/support/tickets/${randomUUID()}`, { as: a })).status, 404);
  assert.equal((await call('POST', `/support/tickets/${randomUUID()}/messages`, { as: a, body: msgBody() })).status, 404);
  assert.equal((await call('POST', `/support/tickets/${randomUUID()}/reopen`, { as: a, body: { body: 'oi' } })).status, 404);
  assert.equal((await call('POST', `/support/tickets/${randomUUID()}/read`, { as: a, body: { upToSeq: 1 } })).status, 404);
  const unknown = await call('GET', '/support/qualquer-coisa', { as: a });
  assert.equal(unknown.status, 404);
  assert.deepEqual(unknown.json, { error: 'Rota não encontrada.' });
});

// ── Criação ─────────────────────────────────────────────────────────────────

test('criar solicitação: 201, evento created e primeira mensagem na ordem do contrato, sem dados internos', opts, async () => {
  const a = await newProf();
  const payload = ticketBody({ subject: '  Dúvida\n sobre a agenda ', body: '  Como bloqueio um horário?\r\nObrigada  ' });
  const r = await call('POST', '/support/tickets', { as: a, body: payload });
  assert.equal(r.status, 201, r.text);
  const ticket = r.json.ticket;
  assert.deepEqual(Object.keys(ticket).sort(), TICKET_KEYS);
  assert.equal(ticket.status, 'aberta');
  assert.equal(ticket.subject, 'Dúvida sobre a agenda');
  assert.equal(ticket.unread, false);                 // a própria atividade não é novidade para ela
  assert.equal(ticket.activitySeq, 2);
  assert.equal(ticket.canReopenUntil, null);
  assert.ok(Number.isInteger(ticket.ticketNumber) && ticket.ticketNumber > 0);
  assert.ok(!('priority' in ticket) && !('priorityDeadline' in ticket));

  const { events, messages } = await activity(ticket.id);
  assert.deepEqual(events.map((e) => [Number(e.seq), e.type, e.actor_role]), [[1, 'created', 'professional']]);
  assert.deepEqual(messages.map((m) => [Number(m.seq), m.author_role, m.body]), [[2, 'professional', 'Como bloqueio um horário?\nObrigada']]);
  const row = await ticketRow(ticket.id);
  assert.equal(row.priority, 'baixa');
  assert.equal(row.priority_source, 'auto');
  assert.equal(row.last_actor, 'professional');
  assert.equal(Number(row.last_seq), 2);
  assert.match(row.request_hash, /^[0-9a-f]{64}$/);
  assert.equal(row.professional_id, a.id);            // a titular vem da sessão
});

test('prioridade automática é gravada, mas nunca exposta à profissional', opts, async () => {
  const a = await newProf();
  const t1 = await apiCreate(a, { category: 'tecnico', subject: 'Não consigo entrar', body: 'Senha inválida' });
  assert.equal((await ticketRow(t1.id)).priority, 'alta');
  const detail = await call('GET', `/support/tickets/${t1.id}`, { as: a });
  assert.ok(!detail.text.includes('priority'));
  assert.ok(!detail.text.includes('priorityChanged') && !detail.text.includes('priority_changed'));
});

test('repetir o mesmo clientRequestId: 200 com a mesma solicitação e nenhum registro novo', opts, async () => {
  const a = await newProf();
  const payload = ticketBody();
  const first = await call('POST', '/support/tickets', { as: a, body: payload });
  const again = await call('POST', '/support/tickets', { as: a, body: payload });
  assert.equal(first.status, 201);
  assert.equal(again.status, 200);
  assert.equal(again.json.ticket.id, first.json.ticket.id);
  assert.equal(again.json.ticket.activitySeq, 2);
  assert.equal(await countTickets(a.id), 1);
  const { events, messages } = await activity(first.json.ticket.id);
  assert.equal(events.length, 1);
  assert.equal(messages.length, 1);
  // Mesmo id com conteúdo diferente: 409, sem sobrescrever.
  const conflict = await call('POST', '/support/tickets', { as: a, body: { ...payload, body: 'Outro texto' } });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.json.reason, 'idempotency_conflict');
  assert.equal(await countTickets(a.id), 1);
  assert.equal((await activity(first.json.ticket.id)).messages[0].body, payload.body);
});

test('5 criações simultâneas com o mesmo clientRequestId geram uma única solicitação', opts, async () => {
  const a = await newProf();
  const payload = ticketBody();
  const rs = await Promise.all(Array.from({ length: 5 }, () => call('POST', '/support/tickets', { as: a, body: payload })));
  assert.deepEqual(rs.map((r) => r.status).sort(), [200, 200, 200, 200, 201]);
  assert.equal(new Set(rs.map((r) => r.json.ticket.id)).size, 1);
  assert.equal(await countTickets(a.id), 1);
  const { events, messages } = await activity(rs[0].json.ticket.id);
  assert.equal(events.length, 1);
  assert.equal(messages.length, 1);
  assert.equal(Number((await ticketRow(rs[0].json.ticket.id)).activity_seq), 2);
});

test('payloads inválidos: 400 com mensagem por campo, nada é gravado e o texto digitado não volta', opts, async () => {
  const marker = 'MARCADOR-SECRETO';
  const bad = [
    { subject: 'ab' }, { subject: 'x'.repeat(121) }, { category: 'outra' }, { body: '   ' }, { body: 'y'.repeat(5001) },
    { clientRequestId: undefined }, { clientRequestId: 'nao-e-uuid' }, { professionalId: randomUUID() }, { status: 'resolvida' },
    { relatedTicketNumber: 'abc' }, { relatedTicketNumber: 0 }, { subject: 123 },
  ];
  let acc = await newProf();
  let used = 0;
  for (const over of bad) {
    if (used === 4) { acc = await newProf(); used = 0; }   // o limitador é de 5 criações/hora por conta
    used += 1;
    const r = await call('POST', '/support/tickets', { as: acc, body: ticketBody({ body: `${marker} ok`, ...over }) });
    assert.equal(r.status, 400, JSON.stringify(over).slice(0, 60));
    assert.ok(typeof r.json.error === 'string' && r.json.error.length > 0);
    assert.ok(Array.isArray(r.json.fields) && r.json.fields.length > 0);
    assert.ok(!r.text.includes(marker), 'o texto digitado não pode voltar na resposta');
    assert.equal(await countTickets(acc.id), 0);
  }
  for (const rawBody of ['{"subject": ', '[]', 'null', '"texto"']) {
    const r = await call('POST', '/support/tickets', { as: await newProf(), rawBody });
    assert.equal(r.status, 400, rawBody);
  }
});

test('corpo acima do limite do servidor: 413 e nada gravado', opts, async () => {
  const a = await newProf();
  const r = await call('POST', '/support/tickets', { as: a, rawBody: JSON.stringify({ ...ticketBody(), body: 'z'.repeat(200_000) }) });
  assert.equal(r.status, 413);
  assert.equal(await countTickets(a.id), 0);
});

test('solicitação relacionada: só a da própria conta; de outra conta ou inexistente é recusada sem revelar', opts, async () => {
  const a = await newProf();
  const b = await newProf();
  const mine = await apiCreate(a);
  const theirs = await apiCreate(b);
  const ok = await call('POST', '/support/tickets', { as: a, body: ticketBody({ relatedTicketNumber: mine.ticketNumber }) });
  assert.equal(ok.status, 201);
  assert.equal((await ticketRow(ok.json.ticket.id)).related_ticket_id, mine.id);
  const cross = await call('POST', '/support/tickets', { as: a, body: ticketBody({ relatedTicketNumber: theirs.ticketNumber }) });
  const missing = await call('POST', '/support/tickets', { as: a, body: ticketBody({ relatedTicketNumber: 999_999_999 }) });
  assert.equal(cross.status, 400);
  assert.equal(missing.status, 400);
  assert.deepEqual(cross.json, missing.json);        // mesma resposta: não distingue "de outra conta" de "inexistente"
  assert.equal(await countTickets(a.id), 2);
});

// ── Limite de abertas ───────────────────────────────────────────────────────

test('limite de 10 abertas: a 11ª é 409; repetição não conta; resolver libera vaga', opts, async () => {
  const c = await newProf();
  for (let i = 0; i < 9; i += 1) await seedTicket(c);
  const tenth = ticketBody();
  assert.equal((await call('POST', '/support/tickets', { as: c, body: tenth })).status, 201);
  const eleventh = await call('POST', '/support/tickets', { as: c, body: ticketBody() });
  assert.equal(eleventh.status, 409);
  assert.equal(eleventh.json.reason, 'too_many_open');
  assert.equal(await countTickets(c.id), 10);
  // Retry da 10ª no limite: devolve a existente (200) em vez de 409.
  const retry = await call('POST', '/support/tickets', { as: c, body: tenth });
  assert.equal(retry.status, 200);
  assert.equal(await countTickets(c.id), 10);
  // Resolvida não conta como aberta.
  const { id } = await one('SELECT id FROM support_tickets WHERE professional_id = $1 LIMIT 1', [c.id]);
  await resolveTicket(id);
  assert.equal((await call('POST', '/support/tickets', { as: c, body: ticketBody() })).status, 201);
  assert.equal(await countTickets(c.id), 11);
});

test('limite de abertas sob concorrência: com 8 abertas, 4 criações simultâneas dão 2 criadas e 2 recusadas', opts, async () => {
  const d = await newProf();
  for (let i = 0; i < 8; i += 1) await seedTicket(d);
  const rs = await Promise.all(Array.from({ length: 4 }, () => call('POST', '/support/tickets', { as: d, body: ticketBody() })));
  assert.deepEqual(rs.map((r) => r.status).sort(), [201, 201, 409, 409]);
  assert.equal(await countTickets(d.id), 10);
});

// ── Isolamento entre profissionais ──────────────────────────────────────────

test('isolamento: a profissional B não lê, responde, reabre nem marca como lida a solicitação da A', opts, async () => {
  const a = await newProf();
  const b = await newProf();
  const t = await apiCreate(a);
  await adminReplies(t.id, a.id, 'Resposta privada para A');
  const before = await ticketRow(t.id);

  const reads = await Promise.all([
    call('GET', `/support/tickets/${t.id}`, { as: b }),
    call('POST', `/support/tickets/${t.id}/messages`, { as: b, body: msgBody({ body: 'intruso' }) }),
    call('POST', `/support/tickets/${t.id}/reopen`, { as: b, body: { body: 'intruso' } }),
    call('POST', `/support/tickets/${t.id}/read`, { as: b, body: { upToSeq: 99 } }),
  ]);
  for (const r of reads) {
    assert.equal(r.status, 404);
    assert.deepEqual(r.json, { error: 'Solicitação não encontrada.' });
    assert.ok(!r.text.includes('Resposta privada'));
  }
  // O 404 é idêntico ao de uma solicitação que não existe.
  const ghost = await call('GET', `/support/tickets/${randomUUID()}`, { as: b });
  assert.deepEqual(ghost.json, reads[0].json);

  const list = await call('GET', '/support/tickets', { as: b });
  assert.equal(list.json.total, 0);
  assert.deepEqual(list.json.items, []);
  const bootstrapB = await call('GET', '/support/bootstrap', { as: b });
  assert.equal(bootstrapB.json.unreadTickets, 0);

  const after = await ticketRow(t.id);
  assert.equal(after.prof_read_seq, before.prof_read_seq);
  assert.equal(after.activity_seq, before.activity_seq);
  assert.equal(after.status, before.status);
  assert.equal((await activity(t.id)).messages.length, 2);   // a inicial e a da ADM; nenhuma do intruso
  assert.equal((await call('GET', `/support/tickets/${t.id}`, { as: a })).status, 200);
});

// ── Mensagens e status ──────────────────────────────────────────────────────

test('responder: mensagem, status e evento na mesma operação; idempotente; sem novo evento quando o status não muda', opts, async () => {
  const a = await newProf();
  const t = await apiCreate(a);
  await adminReplies(t.id, a.id);                         // seq 3 (mensagem), 4 (evento) -> aguardando_profissional
  const unreadView = await call('GET', `/support/tickets/${t.id}`, { as: a });
  assert.equal(unreadView.json.ticket.status, 'aguardando_profissional');
  assert.equal(unreadView.json.ticket.unread, true);

  const m1 = msgBody({ body: 'Respondendo à equipe.' });
  const r1 = await call('POST', `/support/tickets/${t.id}/messages`, { as: a, body: m1 });
  assert.equal(r1.status, 201, r1.text);
  assert.equal(r1.json.message.seq, 5);
  assert.equal(r1.json.message.authorRole, 'professional');
  assert.ok(!('authorId' in r1.json.message) && !('author_id' in r1.json.message));
  assert.equal(r1.json.ticket.status, 'em_atendimento');
  assert.equal(r1.json.ticket.unread, false);
  let act = await activity(t.id);
  assert.deepEqual(act.events.map((e) => [Number(e.seq), e.type, e.from_value, e.to_value, e.actor_role]).slice(-1), [[6, 'status_changed', 'aguardando_profissional', 'em_atendimento', 'professional']]);

  // Repetição do mesmo identificador: 200, mesma mensagem, nenhuma atividade nova.
  const again = await call('POST', `/support/tickets/${t.id}/messages`, { as: a, body: m1 });
  assert.equal(again.status, 200);
  assert.equal(again.json.message.id, r1.json.message.id);
  assert.equal(again.json.message.seq, 5);
  // Mesmo identificador com outro texto: 409.
  const conflict = await call('POST', `/support/tickets/${t.id}/messages`, { as: a, body: { ...m1, body: 'Texto diferente' } });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.json.reason, 'idempotency_conflict');

  // Em em_atendimento, responder de novo não muda o status nem gera evento.
  const eventsBefore = (await activity(t.id)).events.length;
  const r2 = await call('POST', `/support/tickets/${t.id}/messages`, { as: a, body: msgBody() });
  assert.equal(r2.status, 201);
  assert.equal(r2.json.ticket.status, 'em_atendimento');
  act = await activity(t.id);
  assert.equal(act.events.length, eventsBefore);
  assert.equal(Number((await ticketRow(t.id)).activity_seq), 7);
});

test('responder em solicitação "aberta" mantém o status (só aguardando_profissional vira em_atendimento)', opts, async () => {
  const a = await newProf();
  const t = await apiCreate(a);
  const r = await call('POST', `/support/tickets/${t.id}/messages`, { as: a, body: msgBody() });
  assert.equal(r.status, 201);
  assert.equal(r.json.ticket.status, 'aberta');
  assert.equal((await activity(t.id)).events.length, 1);   // só o 'created'
});

test('10 envios simultâneos do mesmo clientMessageId gravam uma única mensagem', opts, async () => {
  const a = await newProf();
  const t = await apiCreate(a);
  const payload = msgBody();
  const rs = await Promise.all(Array.from({ length: 10 }, () => call('POST', `/support/tickets/${t.id}/messages`, { as: a, body: payload })));
  assert.deepEqual(rs.map((r) => r.status).sort(), [200, 200, 200, 200, 200, 200, 200, 200, 200, 201]);
  assert.equal(new Set(rs.map((r) => r.json.message.id)).size, 1);
  assert.equal((await activity(t.id)).messages.length, 2);
  assert.equal(Number((await ticketRow(t.id)).activity_seq), 3);
});

test('solicitação resolvida: responder é 409 ticket_resolved (e repetir algo já gravado continua 200)', opts, async () => {
  const a = await newProf();
  const t = await apiCreate(a);
  const sent = msgBody();
  assert.equal((await call('POST', `/support/tickets/${t.id}/messages`, { as: a, body: sent })).status, 201);
  await resolveTicket(t.id);
  const refused = await call('POST', `/support/tickets/${t.id}/messages`, { as: a, body: msgBody() });
  assert.equal(refused.status, 409);
  assert.equal(refused.json.reason, 'ticket_resolved');
  assert.equal((await activity(t.id)).messages.length, 2);
  assert.equal((await call('POST', `/support/tickets/${t.id}/messages`, { as: a, body: sent })).status, 200);
});

test('corrida entre a resolução da ADM e a resposta: a ordem do lock decide', opts, async () => {
  const a = await newProf();
  const t = await apiCreate(a);
  // A ADM segura o lock do ticket e resolve; a resposta da profissional espera e então recebe 409.
  const adminTx = await pool.connect();
  try {
    await adminTx.query('BEGIN');
    await adminTx.query('SELECT 1 FROM support_tickets WHERE id = $1 FOR UPDATE', [t.id]);
    const pending = call('POST', `/support/tickets/${t.id}/messages`, { as: a, body: msgBody() });
    await waitUntil(async () => Number((await one(
      `SELECT count(*) AS n FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%FROM support_tickets WHERE id = $1 AND professional_id = $2 FOR UPDATE%'`
    )).n) >= 1);
    await adminTx.query(`UPDATE support_tickets SET status = 'resolvida', resolved_at = now(), resolved_by = $2 WHERE id = $1`, [t.id, admin.id]);
    await adminTx.query('COMMIT');
    const r = await pending;
    assert.equal(r.status, 409);
    assert.equal(r.json.reason, 'ticket_resolved');
  } finally {
    await adminTx.query('ROLLBACK').catch(() => {});
    adminTx.release();
  }
  assert.equal((await activity(t.id)).messages.length, 1);
  // Se a resposta entra antes, ela é gravada e a resolução vem depois, válida.
  const t2 = await apiCreate(a);
  assert.equal((await call('POST', `/support/tickets/${t2.id}/messages`, { as: a, body: msgBody() })).status, 201);
  await resolveTicket(t2.id);
  assert.equal((await ticketRow(t2.id)).status, 'resolvida');
});

// ── Reabertura ──────────────────────────────────────────────────────────────

test('reabrir dentro de 7 dias: volta a "aberta", zera a resolução, conta a reabertura e registra evento e mensagem', opts, async () => {
  const a = await newProf();
  const t = await apiCreate(a);
  await resolveTicket(t.id, '1 hour');
  const view = await call('GET', `/support/tickets/${t.id}`, { as: a });
  assert.equal(view.json.ticket.status, 'resolvida');
  assert.ok(view.json.ticket.resolvedAt);
  const left = new Date(view.json.ticket.canReopenUntil).getTime() - Date.now();
  assert.ok(left > 6.9 * 86400e3 && left < 7 * 86400e3, `prazo restante ${left}`);

  const r = await call('POST', `/support/tickets/${t.id}/reopen`, { as: a, body: { body: 'O problema voltou.' } });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.ticket.status, 'aberta');
  assert.equal(r.json.ticket.resolvedAt, null);
  assert.equal(r.json.ticket.canReopenUntil, null);
  const row = await ticketRow(t.id);
  assert.equal(row.resolved_by, null);
  assert.equal(row.reopen_count, 1);
  const act = await activity(t.id);
  assert.deepEqual(act.events.slice(-1).map((e) => [e.type, e.from_value, e.to_value, e.actor_role]), [['reopened', 'resolvida', 'aberta', 'professional']]);
  assert.equal(act.messages.slice(-1)[0].body, 'O problema voltou.');
  // Reabrir de novo (já aberta): 409 not_resolved, sem efeito.
  const second = await call('POST', `/support/tickets/${t.id}/reopen`, { as: a, body: { body: 'de novo' } });
  assert.equal(second.status, 409);
  assert.equal(second.json.reason, 'not_resolved');
  assert.equal((await ticketRow(t.id)).reopen_count, 1);
  // Re-resolução reinicia a janela de 7 dias.
  await resolveTicket(t.id, '0 seconds');
  const view2 = await call('GET', `/support/tickets/${t.id}`, { as: a });
  const left2 = new Date(view2.json.ticket.canReopenUntil).getTime() - Date.now();
  assert.ok(left2 > 6.99 * 86400e3, `janela reiniciada: ${left2}`);
});

test('reabrir: limites da janela de 7 x 24 h (6 d 23 h 59 min passa; 7 d expira) e payload inválido', opts, async () => {
  const a = await newProf();
  const within = await apiCreate(a);
  await resolveTicket(within.id, '6 days 23 hours 59 minutes');
  assert.equal((await call('POST', `/support/tickets/${within.id}/reopen`, { as: a, body: { body: 'ainda no prazo' } })).status, 200);

  const expired = await apiCreate(a);
  await resolveTicket(expired.id, '7 days');
  const r = await call('POST', `/support/tickets/${expired.id}/reopen`, { as: a, body: { body: 'tarde demais' } });
  assert.equal(r.status, 409);
  assert.equal(r.json.reason, 'reopen_window_expired');
  const view = await call('GET', `/support/tickets/${expired.id}`, { as: a });
  assert.equal(view.json.ticket.canReopenUntil, null);
  const row = await ticketRow(expired.id);
  assert.equal(row.status, 'resolvida');
  assert.equal(row.reopen_count, 0);
  assert.ok(row.resolved_at);
  assert.equal((await activity(expired.id)).events.length, 1);

  const ok2 = await apiCreate(a);
  await resolveTicket(ok2.id);
  for (const body of [{}, { body: '   ' }, { body: 'x', extra: 1 }, { body: 'y'.repeat(5001) }]) {
    assert.equal((await call('POST', `/support/tickets/${ok2.id}/reopen`, { as: a, body })).status, 400, JSON.stringify(body).slice(0, 40));
  }
  assert.equal((await ticketRow(ok2.id)).status, 'resolvida');
});

// ── Limite de abertas também na reabertura (D5) ────────────────────────────

test('reabrir com 10 abertas: 409 too_many_open e nenhuma alteração parcial; com 9 abertas passa', opts, async () => {
  const a = await newProf();
  for (let i = 0; i < 10; i += 1) await seedTicket(a);
  const resolved = await seedTicket(a, { subject: 'Resolvida para reabrir' });
  await resolveTicket(resolved.id, '1 hour');
  const before = await ticketRow(resolved.id);
  const actBefore = await activity(resolved.id);

  const r = await call('POST', `/support/tickets/${resolved.id}/reopen`, { as: a, body: { body: 'voltou a falhar' } });
  assert.equal(r.status, 409);
  assert.equal(r.json.reason, 'too_many_open');
  const after = await ticketRow(resolved.id);
  for (const k of ['status', 'resolved_at', 'resolved_by', 'reopen_count', 'activity_seq', 'last_seq', 'last_actor']) {
    assert.equal(String(after[k]), String(before[k]), k);                       // recusa antes de qualquer escrita
  }
  assert.deepEqual(await activity(resolved.id), actBefore);                      // sem evento nem mensagem
  assert.equal(Number((await one(`SELECT count(*) AS n FROM support_tickets WHERE professional_id = $1 AND status <> 'resolvida'`, [a.id])).n), 10);

  // Uma vaga aberta (resolve uma das 10): a reabertura passa e o total volta a 10.
  const { id } = await one(`SELECT id FROM support_tickets WHERE professional_id = $1 AND status = 'aberta' LIMIT 1`, [a.id]);
  await resolveTicket(id, '1 hour');
  const ok = await call('POST', `/support/tickets/${resolved.id}/reopen`, { as: a, body: { body: 'agora sim' } });
  assert.equal(ok.status, 200, ok.text);
  assert.equal((await ticketRow(resolved.id)).status, 'aberta');
  assert.equal(Number((await one(`SELECT count(*) AS n FROM support_tickets WHERE professional_id = $1 AND status <> 'resolvida'`, [a.id])).n), 10);
});

test('reabertura: prazo expirado e "não resolvida" têm precedência sobre o limite', opts, async () => {
  const a = await newProf();
  for (let i = 0; i < 10; i += 1) await seedTicket(a);
  const old = await seedTicket(a);
  await resolveTicket(old.id, '7 days');
  assert.equal((await call('POST', `/support/tickets/${old.id}/reopen`, { as: a, body: { body: 'x' } })).json.reason, 'reopen_window_expired');
  const { id } = await one(`SELECT id FROM support_tickets WHERE professional_id = $1 AND status = 'aberta' LIMIT 1`, [a.id]);
  assert.equal((await call('POST', `/support/tickets/${id}/reopen`, { as: a, body: { body: 'x' } })).json.reason, 'not_resolved');
});

test('concorrência: 2 reaberturas com 9 abertas dão 1 sucesso e 1 recusa; criar x reabrir também', opts, async () => {
  const a = await newProf();
  for (let i = 0; i < 9; i += 1) await seedTicket(a);
  const r1 = await seedTicket(a); const r2 = await seedTicket(a);
  await resolveTicket(r1.id, '1 hour'); await resolveTicket(r2.id, '1 hour');
  const rs = await Promise.all([r1, r2].map((t) => call('POST', `/support/tickets/${t.id}/reopen`, { as: a, body: { body: 'voltou' } })));
  assert.deepEqual(rs.map((r) => r.status).sort(), [200, 409]);
  assert.equal(rs.find((r) => r.status === 409).json.reason, 'too_many_open');
  assert.equal(Number((await one(`SELECT count(*) AS n FROM support_tickets WHERE professional_id = $1 AND status <> 'resolvida'`, [a.id])).n), 10);
  const refused = [r1, r2].find((t, i) => rs[i].status === 409);
  const row = await ticketRow(refused.id);
  assert.equal(row.status, 'resolvida');
  assert.equal(row.reopen_count, 0);
  assert.equal((await activity(refused.id)).events.length, 0);

  // Criar e reabrir competem pela mesma vaga: no máximo 10 abertas, sempre.
  const b = await newProf();
  for (let i = 0; i < 9; i += 1) await seedTicket(b);
  const rb = await seedTicket(b);
  await resolveTicket(rb.id, '1 hour');
  const mixed = await Promise.all([
    call('POST', '/support/tickets', { as: b, body: ticketBody() }),
    call('POST', `/support/tickets/${rb.id}/reopen`, { as: b, body: { body: 'voltou' } }),
  ]);
  assert.equal(mixed.filter((r) => r.status === 409).length, 1);
  assert.equal(mixed.filter((r) => r.status === 201 || r.status === 200).length, 1);
  assert.equal(Number((await one(`SELECT count(*) AS n FROM support_tickets WHERE professional_id = $1 AND status <> 'resolvida'`, [b.id])).n), 10);
});

// ── Leitura e cursores ──────────────────────────────────────────────────────

test('não lida por cursor: read com upToSeq menor não limpa, é monotônico, idempotente e limitado ao que existe', opts, async () => {
  const a = await newProf();
  const t = await apiCreate(a);
  await adminReplies(t.id, a.id);                                    // seq 3 (mensagem) e 4 (evento): last_seq = 4
  const view = async () => (await call('GET', `/support/tickets/${t.id}`, { as: a })).json.ticket;
  assert.equal((await view()).unread, true);
  const boot = await call('GET', '/support/bootstrap', { as: a });
  assert.equal(boot.json.unreadTickets, 1);
  assert.deepEqual(boot.json.unreadIds, [t.id]);

  assert.equal((await call('POST', `/support/tickets/${t.id}/read`, { as: a, body: { upToSeq: 3 } })).status, 204);
  assert.equal((await view()).unread, true);                         // só exibiu até a mensagem; o evento seq 4 segue novo
  assert.equal(Number((await ticketRow(t.id)).prof_read_seq), 3);
  assert.equal((await call('POST', `/support/tickets/${t.id}/read`, { as: a, body: { upToSeq: 1 } })).status, 204);
  assert.equal(Number((await ticketRow(t.id)).prof_read_seq), 3);    // não retrocede
  assert.equal((await call('POST', `/support/tickets/${t.id}/read`, { as: a, body: { upToSeq: 4 } })).status, 204);
  assert.equal((await view()).unread, false);
  assert.equal((await call('POST', `/support/tickets/${t.id}/read`, { as: a, body: { upToSeq: 4 } })).status, 204);   // idempotente
  assert.equal(Number((await ticketRow(t.id)).prof_read_seq), 4);
  assert.equal((await call('GET', '/support/bootstrap', { as: a })).json.unreadTickets, 0);

  // Algo posterior ao que foi lido volta a ser não lido; um upToSeq enorme é limitado ao activity_seq.
  await adminMessage(t.id, a.id, 'Nova resposta');                   // seq 5
  assert.equal((await view()).unread, true);
  assert.equal((await call('POST', `/support/tickets/${t.id}/read`, { as: a, body: { upToSeq: 1_000_000_000 } })).status, 204);
  assert.equal(Number((await ticketRow(t.id)).prof_read_seq), 5);
  assert.equal((await view()).unread, false);

  for (const body of [{}, { upToSeq: -1 }, { upToSeq: 1.5 }, { upToSeq: '3' }, { upToSeq: 1, extra: true }]) {
    assert.equal((await call('POST', `/support/tickets/${t.id}/read`, { as: a, body })).status, 400, JSON.stringify(body));
  }
});

test('ajuste de prioridade e eventos do sistema não geram "não lida" nem aparecem para a profissional', opts, async () => {
  const a = await newProf();
  const t = await apiCreate(a);
  await adminEvent(t.id, a.id, 'priority_changed', 'baixa', 'alta');
  assert.equal((await call('GET', `/support/tickets/${t.id}`, { as: a })).json.ticket.unread, false);
  assert.equal((await call('GET', '/support/bootstrap', { as: a })).json.unreadTickets, 0);
  const detail = await call('GET', `/support/tickets/${t.id}`, { as: a });
  assert.ok(detail.json.events.every((e) => e.type !== 'priority_changed'));
});

test('bootstrap: contagem real e no máximo 20 ids; preferência do botão por conta', opts, async () => {
  const u = await newProf();
  const other = await newProf();
  for (let i = 0; i < 22; i += 1) {
    const t = await seedTicket(u);
    await adminEvent(t.id, u.id, 'status_changed', 'aberta', 'em_atendimento');
  }
  const boot = await call('GET', '/support/bootstrap', { as: u });
  assert.equal(boot.status, 200);
  assert.equal(boot.json.enabled, true);
  assert.equal(boot.json.fabHidden, false);
  assert.equal(boot.json.unreadTickets, 22);
  assert.equal(boot.json.unreadIds.length, 20);
  assert.equal(new Set(boot.json.unreadIds).size, 20);

  assert.deepEqual((await call('PUT', '/support/preferences', { as: u, body: { fabHidden: true } })).json, { fabHidden: true });
  assert.equal((await call('GET', '/support/bootstrap', { as: u })).json.fabHidden, true);
  assert.equal((await call('GET', '/support/bootstrap', { as: other })).json.fabHidden, false);   // por conta
  for (const body of [{}, { fabHidden: 'yes' }, { fabHidden: 1 }, { fabHidden: true, professionalId: other.id }]) {
    assert.equal((await call('PUT', '/support/preferences', { as: u, body })).status, 400, JSON.stringify(body));
  }
  assert.equal((await one('SELECT support_fab_hidden AS h FROM professionals WHERE id = $1', [other.id])).h, false);
  assert.deepEqual((await call('PUT', '/support/preferences', { as: u, body: { fabHidden: false } })).json, { fabHidden: false });
});

// ── Listagem e paginação ────────────────────────────────────────────────────

test('listagem: paginação, ordem, filtros por status e busca, e parâmetros inválidos', opts, async () => {
  const p = await newProf();
  const other = await newProf();
  const seeded = [];
  for (let i = 1; i <= 25; i += 1) {
    const subject = i === 3 ? '100% sério' : i === 4 ? 'a_b literal' : `Chamado ${String(i).padStart(2, '0')}`;
    seeded.push(await seedTicket(p, { subject }));
  }
  await seedTicket(other, { subject: 'Chamado de outra conta' });
  const list = (qs) => call('GET', `/support/tickets${qs}`, { as: p });

  const p1 = await list('?pageSize=10');
  const p2 = await list('?pageSize=10&page=2');
  const p3 = await list('?pageSize=10&page=3');
  const p4 = await list('?pageSize=10&page=4');
  assert.deepEqual([p1, p2, p3].map((r) => r.json.items.length), [10, 10, 5]);
  assert.equal(p4.json.items.length, 0);
  for (const r of [p1, p2, p3, p4]) { assert.equal(r.json.total, 25); assert.equal(r.json.totalPages, 3); assert.equal(r.json.pageSize, 10); }
  const ids = [p1, p2, p3].flatMap((r) => r.json.items.map((i) => i.id));
  assert.equal(new Set(ids).size, 25);
  assert.deepEqual(ids, seeded.map((s) => s.id).reverse());          // mais recentes primeiro
  for (const item of p1.json.items) assert.deepEqual(Object.keys(item).sort(), TICKET_KEYS);

  assert.equal((await list('')).json.pageSize, 20);                  // padrão
  assert.equal((await list('?foo=bar&_=123')).status, 200);          // parâmetro desconhecido é ignorado

  // Busca: texto, número (#n e n), e curingas de LIKE tratados como texto literal.
  assert.equal((await list('?q=chamado 07')).json.total, 1);
  assert.equal((await list(`?q=${encodeURIComponent('#' + seeded[10].ticket_number)}`)).json.items[0].id, seeded[10].id);
  assert.equal((await list(`?q=${seeded[10].ticket_number}`)).json.items.some((i) => i.id === seeded[10].id), true);
  assert.deepEqual((await list(`?q=${encodeURIComponent('%')}`)).json.items.map((i) => i.id), [seeded[2].id]);
  assert.deepEqual((await list(`?q=${encodeURIComponent('_')}`)).json.items.map((i) => i.id), [seeded[3].id]);
  assert.equal((await list('?q=inexistente')).json.total, 0);
  assert.equal((await list('?q=Chamado de outra conta')).json.total, 0);

  // Status.
  await resolveTicket(seeded[0].id);
  await resolveTicket(seeded[1].id);
  const resolved = await list('?status=resolvida');
  assert.equal(resolved.json.total, 2);
  assert.ok(resolved.json.items.every((i) => i.status === 'resolvida' && i.canReopenUntil));
  assert.equal((await list('?status=aberta')).json.total, 23);

  for (const qs of ['?pageSize=51', '?pageSize=0', '?page=0', '?page=x', '?status=xx', '?pageSize=1.5', `?q=${'q'.repeat(101)}`, '?status=aberta&status=resolvida']) {
    assert.equal((await list(qs)).status, 400, qs);
  }
});

test('conversa: janela por seq (before/limit), eventos de prioridade ocultos e cursor de continuação', opts, async () => {
  const a = await newProf();
  const t = await apiCreate(a);                                                   // seq 1 created, 2 mensagem
  assert.equal((await call('POST', `/support/tickets/${t.id}/messages`, { as: a, body: msgBody({ body: 'm3' }) })).status, 201);   // 3
  await adminMessage(t.id, a.id, 'm4');                                           // 4
  await adminEvent(t.id, a.id, 'priority_changed', 'baixa', 'alta');             // 5 (oculto)
  await adminMessage(t.id, a.id, 'm6');                                           // 6
  await adminEvent(t.id, a.id, 'status_changed', 'aberta', 'em_atendimento');    // 7
  await adminMessage(t.id, a.id, 'm8');                                           // 8

  const full = await call('GET', `/support/tickets/${t.id}`, { as: a });
  assert.equal(full.json.hasMore, false);
  assert.equal(full.json.nextBefore, null);
  assert.deepEqual(full.json.messages.map((m) => [m.seq, m.body]), [[2, 'Não consigo bloquear um horário.'], [3, 'm3'], [4, 'm4'], [6, 'm6'], [8, 'm8']]);
  assert.deepEqual(full.json.events.map((e) => [e.seq, e.type]), [[1, 'created'], [7, 'status_changed']]);
  assert.equal(full.json.ticket.activitySeq, 8);
  for (const m of full.json.messages) assert.deepEqual(Object.keys(m).sort(), ['authorRole', 'body', 'createdAt', 'id', 'seq']);
  for (const e of full.json.events) assert.deepEqual(Object.keys(e).sort(), ['actorRole', 'createdAt', 'from', 'id', 'seq', 'to', 'type']);

  // Páginas de 3 atividades (o evento de prioridade é filtrado no SQL: não ocupa lugar na janela nem aparece).
  const seen = [];
  let before;
  for (let guard = 0; guard < 10; guard += 1) {
    const r = await call('GET', `/support/tickets/${t.id}?limit=3${before ? `&before=${before}` : ''}`, { as: a });
    assert.equal(r.status, 200);
    const seqs = [...r.json.messages.map((m) => m.seq), ...r.json.events.map((e) => e.seq)].sort((x, y) => x - y);
    seen.unshift(...seqs);
    if (!r.json.hasMore) { assert.equal(r.json.nextBefore, null); break; }
    assert.ok(r.json.nextBefore > 0);
    before = r.json.nextBefore;
  }
  assert.deepEqual(seen, [1, 2, 3, 4, 6, 7, 8]);                                  // sem repetição nem perda

  for (const qs of ['?limit=0', '?limit=51', '?before=0', '?before=x', '?limit=1.5']) {
    assert.equal((await call('GET', `/support/tickets/${t.id}${qs}`, { as: a })).status, 400, qs);
  }
});

// ── FAQ ─────────────────────────────────────────────────────────────────────

test('FAQ: só artigos publicados, com as 6 categorias fixas', opts, async () => {
  const a = await newProf();
  const pub = await one(
    `INSERT INTO support_faq_articles (category_slug, title, body, status, published_at) VALUES ('agenda', 'Como bloquear um horário', 'Passo 1...', 'publicado', now()) RETURNING id`
  );
  const draft = await one(
    `INSERT INTO support_faq_articles (category_slug, title, body, status) VALUES ('agenda', 'Rascunho secreto', 'Ainda não publicar', 'rascunho') RETURNING id`
  );
  try {
    const r = await call('GET', '/support/faq', { as: a });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.categories.map((c) => c.slug), ['agenda', 'clientes', 'servicos_config', 'perfil_acesso', 'financeiro', 'tecnico']);
    assert.ok(r.json.articles.some((x) => x.id === pub.id));
    assert.ok(!r.json.articles.some((x) => x.id === draft.id));
    assert.ok(!r.text.includes('Rascunho secreto'));
    assert.deepEqual(Object.keys(r.json.articles.find((x) => x.id === pub.id)).sort(), ['body', 'categorySlug', 'id', 'position', 'publishedAt', 'title']);
  } finally {
    await pool.query('DELETE FROM support_faq_articles WHERE id = ANY($1::uuid[])', [[pub.id, draft.id]]);
  }
});

// ── Limitadores ─────────────────────────────────────────────────────────────

test('limitador de criação: 6ª em 1 hora é 429 por conta, sem afetar outra conta', opts, async () => {
  const a = await newProf();
  const b = await newProf();
  for (let i = 0; i < 5; i += 1) assert.equal((await call('POST', '/support/tickets', { as: a, body: ticketBody() })).status, 201);
  const sixth = await call('POST', '/support/tickets', { as: a, body: ticketBody() });
  assert.equal(sixth.status, 429);
  assert.equal(typeof sixth.json.error, 'string');
  assert.equal(await countTickets(a.id), 5);
  assert.equal((await call('POST', '/support/tickets', { as: b, body: ticketBody() })).status, 201);
  assert.equal((await call('GET', '/support/tickets', { as: a })).status, 200);    // leituras não entram no limite
});

test('limitador de mensagens: a 31ª em 10 minutos é 429 (reabertura divide o mesmo limite)', opts, async () => {
  const a = await newProf();
  const t = await apiCreate(a);
  for (let i = 0; i < 30; i += 1) {
    const r = await call('POST', `/support/tickets/${t.id}/messages`, { as: a, body: msgBody() });
    assert.equal(r.status, 201, `mensagem ${i + 1}`);
  }
  assert.equal((await call('POST', `/support/tickets/${t.id}/messages`, { as: a, body: msgBody() })).status, 429);
  assert.equal((await call('POST', `/support/tickets/${t.id}/reopen`, { as: a, body: { body: 'x' } })).status, 429);
  assert.equal((await activity(t.id)).messages.length, 31);                        // 1 inicial + 30
});

// ── Consistência transacional e erros ───────────────────────────────────────

test('falha no meio da criação: nada fica gravado; resposta e log sem o texto da mensagem', opts, async () => {
  const a = await newProf();
  const logs = [];
  const original = console.error;
  console.error = (...args) => { logs.push(args.map((x) => inspect(x, { depth: 6 })).join(' ')); };
  let r;
  try {
    r = await call('POST', '/support/tickets', { as: a, body: ticketBody({ body: `${FAIL_PREFIX} segredo da conversa` }) });
  } finally {
    console.error = original;
  }
  assert.equal(r.status, 500);
  assert.deepEqual(r.json, { error: 'Erro interno do servidor.' });
  assert.ok(!r.text.includes('segredo'));
  // O ticket e o evento 'created' já tinham sido inseridos quando a mensagem falhou: a transação desfez tudo.
  assert.equal(await countTickets(a.id), 0);
  assert.equal(Number((await one('SELECT count(*) AS n FROM support_ticket_events WHERE professional_id = $1', [a.id])).n), 0);
  const logged = logs.join('\n');
  assert.ok(logged.includes('support: erro de banco'), 'o erro de banco é registrado (reduzido)');
  assert.ok(logged.includes('23514'));
  assert.ok(!logged.includes('segredo') && !logged.includes('linha:') && !logged.includes(FAIL_PREFIX), 'o conteúdo da mensagem não pode ir ao log');
  // A conta continua funcional e o contador/limite não foram consumidos pela tentativa que falhou.
  assert.equal((await call('POST', '/support/tickets', { as: a, body: ticketBody() })).status, 201);
});

test('falha ao responder ou reabrir: status, resolução e eventos ficam como estavam', opts, async () => {
  const a = await newProf();
  const t = await apiCreate(a);
  await adminReplies(t.id, a.id);                                                  // aguardando_profissional
  const before = await ticketRow(t.id);
  const eventsBefore = (await activity(t.id)).events.length;
  const reply = await call('POST', `/support/tickets/${t.id}/messages`, { as: a, body: msgBody({ body: `${FAIL_PREFIX} resposta` }) });
  assert.equal(reply.status, 500);
  let row = await ticketRow(t.id);
  assert.equal(row.status, 'aguardando_profissional');                             // a mudança para em_atendimento não ficou
  assert.equal(row.activity_seq, before.activity_seq);
  assert.equal((await activity(t.id)).events.length, eventsBefore);

  const t2 = await apiCreate(a);
  await resolveTicket(t2.id);
  const reopen = await call('POST', `/support/tickets/${t2.id}/reopen`, { as: a, body: { body: `${FAIL_PREFIX} reabrir` } });
  assert.equal(reopen.status, 500);
  row = await ticketRow(t2.id);
  assert.equal(row.status, 'resolvida');
  assert.ok(row.resolved_at && row.resolved_by);
  assert.equal(row.reopen_count, 0);
  assert.equal((await activity(t2.id)).events.length, 1);                          // só o 'created'; o 'reopened' foi desfeito
  assert.equal((await call('GET', `/support/tickets/${t2.id}`, { as: a })).json.ticket.status, 'resolvida');
});

test('conexões do pool são devolvidas depois das operações e das falhas', opts, async () => {
  await waitUntil(() => pool.waitingCount === 0 && pool.totalCount === pool.idleCount, 5000);
  assert.equal(pool.waitingCount, 0);
  assert.equal(pool.totalCount, pool.idleCount);
});

// ── Interruptor desligado (servidor real em processo separado) ──────────────

async function withServer(flag, fn) {
  const env = { ...process.env, NODE_ENV: 'test', SERVER_URL: pathToFileURL(SERVER_FILE).href };
  if (flag === undefined) delete env.SUPPORT_CENTER_ENABLED; else env.SUPPORT_CENTER_ENABLED = flag;
  const code = `import(process.env.SERVER_URL).then(({ default: app }) => {
    const s = app.listen(0, '127.0.0.1', () => console.log('PORT=' + s.address().port));
  });`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', code], { env, cwd: path.dirname(SERVER_FILE), stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (d) => { stderr += d; });
  try {
    const port = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`servidor filho não subiu: ${stderr}`)), 15_000);
      child.stdout.on('data', (d) => {
        const m = /PORT=(\d+)/.exec(String(d));
        if (m) { clearTimeout(timer); resolve(Number(m[1])); }
      });
      child.on('exit', (c) => { clearTimeout(timer); reject(new Error(`servidor filho saiu (${c}): ${stderr}`)); });
    });
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    child.removeAllListeners('exit');
    child.kill();
  }
}

for (const flag of [undefined, '', '1', 'yes', 'false', 'tru']) {
  test(`interruptor desligado (${JSON.stringify(flag)}): tudo 404 sem sessão, de profissional ou de ADM; bootstrap enabled:false; resto da API intacto`, opts, async () => {
    const a = await newProf();
    await withServer(flag, async (base) => {
      const id = randomUUID();
      const routes = [
        ['GET', '/support/faq'], ['GET', '/support/tickets'], ['POST', '/support/tickets'], ['GET', `/support/tickets/${id}`],
        ['POST', `/support/tickets/${id}/messages`], ['POST', `/support/tickets/${id}/reopen`], ['POST', `/support/tickets/${id}/read`],
        ['PUT', '/support/preferences'], ['GET', '/support/qualquer-coisa'],
      ];
      for (const who of [undefined, a, admin]) {
        for (const [method, p] of routes) {
          const r = await call(method, p, { as: who, base, ...(method === 'GET' ? {} : { body: ticketBody() }) });
          assert.equal(r.status, 404, `${method} ${p} (${who ? 'com sessão' : 'sem sessão'})`);
          assert.deepEqual(r.json, { error: 'Recurso não encontrado.' });
        }
      }
      assert.equal((await call('GET', '/support/bootstrap', { base })).status, 401);                   // exige sessão
      for (const who of [a, admin]) {
        const boot = await call('GET', '/support/bootstrap', { as: who, base });
        assert.equal(boot.status, 200);
        assert.deepEqual(boot.json, { enabled: false, fabHidden: false, unreadTickets: 0, unreadIds: [] });
      }
      assert.equal((await call('GET', '/health', { base })).status, 200);
      assert.equal((await call('GET', '/appointments', { base })).status, 401);
      assert.equal((await call('GET', '/appointments', { as: a, base })).status, 200);
    });
    assert.equal(await countTickets(a.id), 0);
  });
}

test('interruptor ligado com " TRUE " (valor aparado): as rotas respondem normalmente', opts, async () => {
  const a = await newProf();
  await withServer(' TRUE ', async (base) => {
    assert.equal((await call('GET', '/support/faq', { as: a, base })).status, 200);
    const boot = await call('GET', '/support/bootstrap', { as: a, base });
    assert.equal(boot.json.enabled, true);
    assert.equal((await call('GET', '/support/tickets', { base })).status, 401);
  });
});
