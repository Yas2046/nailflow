// Testes da API da ADM da Central de Suporte (/admin/support/*), contra o servidor real (server.js).
//
// Só rodam com SUPPORT_API_TEST_DB_URL apontando para um banco DESCARTÁVEL já com schema base e migrations 023/024
// (guarda em tests/helpers/supportTestDb.js; sem a variável os testes de banco são ignorados). Veja
// tests/helpers/supportHarness.js: as suítes de banco da Central contam linhas globais e instalam triggers de
// falha injetada, então devem rodar uma por vez no mesmo banco (node --test --test-concurrency=1).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { inspect } from 'node:util';
import { dbWanted, skip, startHarness, FAIL_MESSAGE, FAIL_AUDIT } from './helpers/supportHarness.js';

const opts = { skip, timeout: 120_000 };
let h;
let admin;
let admin2;

before(async () => {
  if (!dbWanted) return;
  h = await startHarness();
  admin = await h.newProf({ admin: true });
  admin2 = await h.newProf({ admin: true });
});
after(async () => { if (h) await h.stop(); });

const ADMIN_ROUTES = (id, art) => [
  ['GET', '/admin/support/summary'], ['GET', '/admin/support/tickets'], ['GET', `/admin/support/tickets/${id}`],
  ['POST', `/admin/support/tickets/${id}/messages`], ['POST', `/admin/support/tickets/${id}/status`],
  ['PUT', `/admin/support/tickets/${id}/priority`], ['POST', `/admin/support/tickets/${id}/read`],
  ['GET', '/admin/support/faq'], ['POST', '/admin/support/faq/articles'], ['PUT', `/admin/support/faq/articles/${art}`],
  ['POST', `/admin/support/faq/articles/${art}/publish`], ['POST', `/admin/support/faq/articles/${art}/unpublish`],
  ['PUT', '/admin/support/faq/reorder'],
];

const ADMIN_TICKET_KEYS = [
  'activitySeq', 'adminReadSeq', 'category', 'createdAt', 'id', 'lastActivityAt', 'priority', 'prioritySource',
  'professional', 'reopenCount', 'resolvedAt', 'status', 'subject', 'ticketNumber', 'unread',
];
const msgBody = (over = {}) => ({ body: 'Resposta da equipe NailFlow.', clientMessageId: randomUUID(), ...over });
const ticketBody = (over = {}) => ({
  subject: 'Preciso de ajuda com a agenda', category: 'agenda', body: 'Não consigo bloquear um horário.', clientRequestId: randomUUID(), ...over,
});

async function apiCreate(prof, over) {
  const r = await h.call('POST', '/support/tickets', { as: prof, body: ticketBody(over) });
  assert.equal(r.status, 201, r.text);
  return r.json.ticket;
}
const admView = async (id, as = admin) => (await h.call('GET', `/admin/support/tickets/${id}`, { as })).json;
const profView = async (id, prof) => (await h.call('GET', `/support/tickets/${id}`, { as: prof })).json;

// ── Autenticação e autorização ──────────────────────────────────────────────

test('sem sessão: toda rota administrativa de suporte responde 401', opts, async () => {
  for (const [method, p] of ADMIN_ROUTES(randomUUID(), randomUUID())) {
    const r = await h.call(method, p, method === 'GET' ? {} : { body: {} });
    assert.equal(r.status, 401, `${method} ${p}`);
    assert.deepEqual(r.json, { error: 'Não autenticado.' });
  }
});

test('profissional comum nunca acessa a API administrativa, nem manipulando a requisição', opts, async () => {
  const prof = await h.newProf();
  const t = await apiCreate(prof);
  const art = await h.one(`INSERT INTO support_faq_articles (category_slug, title, body) VALUES ('agenda', 'Artigo ${h.runId}', 'texto') RETURNING id`);
  const tickets0 = Number((await h.one('SELECT count(*) AS n FROM support_tickets')).n);
  const audit0 = Number((await h.one('SELECT count(*) AS n FROM admin_audit_log')).n);
  const before = await h.ticketRow(t.id);

  const forged = [
    { as: prof },                                                                            // sessão comum
    { as: { token: prof.sign({ is_admin: true, isAdmin: true, role: 'admin', admin: true }) } }, // claims forjadas em token VÁLIDO
    { as: prof, headers: { 'x-is-admin': 'true', 'x-admin': '1', 'x-forwarded-for': '127.0.0.1' } },
    { as: prof, query: '?isAdmin=true&is_admin=true&professionalId=' + admin.id },
    { as: prof, extraBody: { isAdmin: true, is_admin: true, actorId: admin.id, professionalId: admin.id } },
  ];
  for (const variant of forged) {
    for (const [method, p] of ADMIN_ROUTES(t.id, art.id)) {
      const path = `${p}${variant.query ?? ''}`;
      const body = method === 'GET' ? undefined : { ...msgBody(), status: 'resolvida', priority: 'alta', ...(variant.extraBody ?? {}) };
      const r = await h.call(method, path, { as: variant.as, headers: variant.headers, body });
      assert.equal(r.status, 403, `${method} ${path}`);
      assert.deepEqual(r.json, { error: 'Acesso não autorizado.' });
    }
  }
  // Token assinado com outro segredo, ou de versão antiga, é 401.
  assert.equal((await h.call('GET', '/admin/support/summary', { as: { token: prof.sign({}, 'outro-segredo') } })).status, 401);
  assert.equal((await h.call('GET', '/admin/support/summary', { as: { token: prof.sign({ ver: 999 }) } })).status, 401);
  assert.equal((await h.call('GET', '/admin/support/summary', { headers: { authorization: `Bearer ${prof.token}` } })).status, 403);

  // Nada mudou.
  assert.equal(Number((await h.one('SELECT count(*) AS n FROM support_tickets')).n), tickets0);
  assert.equal(Number((await h.one('SELECT count(*) AS n FROM admin_audit_log')).n), audit0);
  const after = await h.ticketRow(t.id);
  for (const k of ['status', 'priority', 'priority_source', 'activity_seq', 'admin_read_seq']) assert.equal(String(after[k]), String(before[k]), k);
  assert.equal((await h.one('SELECT status FROM support_faq_articles WHERE id = $1', [art.id])).status, 'rascunho');
  await h.pool.query('DELETE FROM support_faq_articles WHERE id = $1', [art.id]);
});

test('o papel é lido do banco a cada requisição: rebaixada perde o acesso na hora; bloqueada recebe 401', opts, async () => {
  const a = await h.newProf({ admin: true });
  assert.equal((await h.call('GET', '/admin/support/summary', { as: a })).status, 200);
  await h.pool.query('UPDATE professionals SET is_admin = false WHERE id = $1', [a.id]);
  assert.equal((await h.call('GET', '/admin/support/summary', { as: a })).status, 403);      // mesmo token
  await h.pool.query('UPDATE professionals SET is_admin = true, blocked_at = now() WHERE id = $1', [a.id]);
  assert.equal((await h.call('GET', '/admin/support/summary', { as: a })).status, 401);
});

test('administradora também não usa as rotas da profissional (separação dos dois lados)', opts, async () => {
  assert.equal((await h.call('GET', '/support/tickets', { as: admin })).status, 403);
  assert.equal((await h.call('POST', '/support/tickets', { as: admin, body: ticketBody() })).status, 403);
});

// ── Sumário, listagem e filtros ─────────────────────────────────────────────

test('sumário: contagens por estado, resolvidas nos últimos 7 dias e não lidas', opts, async () => {
  const p = await h.newProf();
  const get = async () => (await h.call('GET', '/admin/support/summary', { as: admin })).json;
  const base = await get();
  assert.deepEqual(Object.keys(base).sort(), ['abertas', 'aguardando', 'emAtendimento', 'naoLidas', 'resolvidas7d']);

  const a1 = await h.seedTicket(p); const a2 = await h.seedTicket(p);
  const em = await h.seedTicket(p); const ag = await h.seedTicket(p);
  const r1 = await h.seedTicket(p); const r2 = await h.seedTicket(p);
  await h.pool.query(`UPDATE support_tickets SET status = 'em_atendimento' WHERE id = $1`, [em.id]);
  await h.pool.query(`UPDATE support_tickets SET status = 'aguardando_profissional' WHERE id = $1`, [ag.id]);
  await h.resolveTicket(r1.id, admin.id, '1 hour');
  await h.resolveTicket(r2.id, admin.id, '8 days');                 // fora da janela de 7 dias
  await h.profMessage(a1.id, p.id); await h.profMessage(a2.id, p.id);  // 2 não lidas para a ADM

  const now = await get();
  assert.deepEqual(
    [now.abertas - base.abertas, now.emAtendimento - base.emAtendimento, now.aguardando - base.aguardando, now.resolvidas7d - base.resolvidas7d, now.naoLidas - base.naoLidas],
    [2, 1, 1, 1, 2]
  );
});

test('listagem: filtros combináveis, busca, período, paginação, ordem e formato sem dados sensíveis', opts, async () => {
  const tag = randomUUID().slice(0, 8);                                                  // única: não casa com dados de outros testes
  const pa = await h.newProf({ businessName: `Alfa ${tag}` });
  const pb = await h.newProf({ businessName: `Beta ${tag}` });
  const t1 = await h.seedTicket(pa, { subject: 'Agenda travada', category: 'agenda', priority: 'alta' });
  const t2 = await h.seedTicket(pa, { subject: 'Desconto 100% ok', category: 'financeiro', priority: 'baixa' });
  const t3 = await h.seedTicket(pb, { subject: 'Erro ao entrar', category: 'tecnico', priority: 'media' });
  const t4 = await h.seedTicket(pb, { subject: 'Cadastro de cliente', category: 'clientes', priority: 'baixa' });
  await h.pool.query(`UPDATE support_tickets SET status = 'em_atendimento' WHERE id = $1`, [t2.id]);
  await h.pool.query(`UPDATE support_tickets SET status = 'aguardando_profissional' WHERE id = $1`, [t3.id]);
  await h.resolveTicket(t4.id, admin.id);
  await h.profMessage(t1.id, pa.id, 'Texto privado que não deve aparecer na lista');   // t1 não lida

  const list = (qs) => h.call('GET', `/admin/support/tickets${qs}`, { as: admin });
  const idsOf = (r) => r.json.items.map((i) => i.id);

  const all = await list(`?q=${tag}&pageSize=50`);                                       // busca pelo nome do negócio
  assert.equal(all.status, 200);
  assert.equal(all.json.total, 4);
  for (const item of all.json.items) {
    assert.deepEqual(Object.keys(item).sort(), ADMIN_TICKET_KEYS);
    assert.deepEqual(Object.keys(item.professional).sort(), ['businessName', 'id', 'name']);
  }
  assert.ok(!all.text.includes('Texto privado'), 'a lista não traz corpo de mensagem');
  assert.ok(!/@teste\.local|phone|password/i.test(all.text), 'sem e-mail, telefone nem hash');

  const expected = (await h.pool.query(
    `SELECT id FROM support_tickets WHERE id = ANY($1::uuid[]) ORDER BY last_activity_at DESC, id DESC`, [[t1.id, t2.id, t3.id, t4.id]]
  )).rows.map((r) => r.id);
  assert.deepEqual(idsOf(all), expected);                                                // atividade mais recente primeiro

  assert.deepEqual(idsOf(await list(`?professionalId=${pa.id}&pageSize=50`)).sort(), [t1.id, t2.id].sort());
  assert.deepEqual(idsOf(await list(`?professionalId=${pb.id}&status=resolvida`)), [t4.id]);
  assert.deepEqual(idsOf(await list(`?professionalId=${pa.id}&priority=alta`)), [t1.id]);
  assert.deepEqual(idsOf(await list(`?professionalId=${pa.id}&category=financeiro`)), [t2.id]);
  assert.deepEqual(idsOf(await list(`?professionalId=${pa.id}&unread=true`)), [t1.id]);
  assert.equal((await list(`?professionalId=${pa.id}&unread=false`)).json.total, 2);
  assert.equal((await list(`?professionalId=${pa.id}&status=em_atendimento&priority=alta`)).json.total, 0);   // AND
  assert.deepEqual(idsOf(await list(`?q=${encodeURIComponent('Agenda travada')}`)), [t1.id]);
  assert.deepEqual(idsOf(await list(`?q=${encodeURIComponent('#' + t3.ticket_number)}`)), [t3.id]);
  assert.equal((await list(`?q=${t3.ticket_number}`)).json.items.some((i) => i.id === t3.id), true);
  assert.deepEqual(idsOf(await list(`?professionalId=${pa.id}&q=${encodeURIComponent('%')}`)), [t2.id]);          // % literal
  assert.equal((await list(`?professionalId=${pa.id}&q=${encodeURIComponent('_')}`)).json.total, 0);             // _ literal

  assert.equal((await list(`?professionalId=${pa.id}&to=2000-01-01`)).json.total, 0);
  assert.equal((await list(`?professionalId=${pa.id}&from=2000-01-01&to=2999-12-31`)).json.total, 2);

  const p1 = await list(`?q=${tag}&pageSize=3&page=1`);
  const p2 = await list(`?q=${tag}&pageSize=3&page=2`);
  assert.deepEqual([p1.json.items.length, p2.json.items.length, p1.json.total, p1.json.totalPages], [3, 1, 4, 2]);
  assert.deepEqual([...idsOf(p1), ...idsOf(p2)], expected);
  assert.equal((await list(`?q=${tag}&page=9`)).json.items.length, 0);
  assert.equal((await list('')).json.pageSize, 20);

  for (const qs of ['?pageSize=51', '?pageSize=0', '?page=0', '?page=x', '?status=xx', '?priority=xx', '?category=xx', '?professionalId=abc',
    '?from=2026-13-40', '?from=ontem', '?from=2026-02-01&to=2026-01-01', '?unread=sim', `?q=${'q'.repeat(101)}`, '?status=aberta&status=resolvida']) {
    assert.equal((await list(qs)).status, 400, qs);
  }
  assert.equal((await list('?foo=bar')).status, 200);
});

// ── Detalhe ─────────────────────────────────────────────────────────────────

test('detalhe: profissional, mensagens e todos os eventos (inclusive prioridade), com janela por seq', opts, async () => {
  const admin = await h.newProf({ admin: true });   // conta própria: o limite de escrita é por administradora
  const p = await h.newProf({ businessName: `Detalhe ${h.runId}` });
  const t = await apiCreate(p);                                                                       // seq 1 created, 2 mensagem
  assert.equal((await h.call('POST', `/support/tickets/${t.id}/messages`, { as: p, body: msgBody({ body: 'segunda' }) })).status, 201);   // 3
  assert.equal((await h.call('POST', `/admin/support/tickets/${t.id}/messages`, { as: admin, body: msgBody({ body: 'resposta' }) })).status, 201); // 4 + evento 5
  assert.equal((await h.call('PUT', `/admin/support/tickets/${t.id}/priority`, { as: admin, body: { priority: 'alta' } })).status, 200);           // 6
  assert.equal((await h.call('POST', `/admin/support/tickets/${t.id}/messages`, { as: admin, body: msgBody({ body: 'de novo' }) })).status, 201); // 7
  assert.equal((await h.call('POST', `/admin/support/tickets/${t.id}/status`, { as: admin, body: { status: 'resolvida' } })).status, 200);         // 8

  const full = await h.call('GET', `/admin/support/tickets/${t.id}`, { as: admin });
  assert.equal(full.status, 200);
  assert.deepEqual(Object.keys(full.json.ticket).sort(), ADMIN_TICKET_KEYS);
  assert.deepEqual(full.json.ticket.professional, { id: p.id, name: full.json.ticket.professional.name, businessName: `Detalhe ${h.runId}` });
  assert.deepEqual(full.json.messages.map((m) => [m.seq, m.authorRole, m.authorId === null ? null : m.authorId === admin.id ? 'adm' : 'prof']),
    [[2, 'professional', 'prof'], [3, 'professional', 'prof'], [4, 'admin', 'adm'], [7, 'admin', 'adm']]);
  assert.deepEqual(full.json.events.map((e) => [e.seq, e.type, e.to]),
    [[1, 'created', null], [5, 'status_changed', 'aguardando_profissional'], [6, 'priority_changed', 'alta'], [8, 'status_changed', 'resolvida']]);
  assert.equal(full.json.ticket.status, 'resolvida');
  assert.equal(full.json.ticket.priority, 'alta');
  assert.equal(full.json.ticket.prioritySource, 'manual');
  assert.equal(full.json.hasMore, false);

  const seen = [];
  let before;
  for (let i = 0; i < 10; i += 1) {
    const r = await h.call('GET', `/admin/support/tickets/${t.id}?limit=3${before ? `&before=${before}` : ''}`, { as: admin });
    assert.equal(r.status, 200);
    seen.unshift(...[...r.json.messages.map((m) => m.seq), ...r.json.events.map((e) => e.seq)].sort((a, b) => a - b));
    if (!r.json.hasMore) break;
    before = r.json.nextBefore;
  }
  assert.deepEqual(seen, [1, 2, 3, 4, 5, 6, 7, 8]);

  assert.equal((await h.call('GET', `/admin/support/tickets/${randomUUID()}`, { as: admin })).status, 404);
  assert.equal((await h.call('GET', '/admin/support/tickets/nao-e-uuid', { as: admin })).status, 400);
  for (const qs of ['?limit=0', '?limit=51', '?before=0', '?before=x']) {
    assert.equal((await h.call('GET', `/admin/support/tickets/${t.id}${qs}`, { as: admin })).status, 400, qs);
  }
  // A profissional não vê a prioridade nem o evento correspondente (visão dela, mesma solicitação).
  const pv = await h.call('GET', `/support/tickets/${t.id}`, { as: p });
  assert.ok(!pv.text.includes('priority'));
});

// ── Responder ───────────────────────────────────────────────────────────────

test('responder: mensagem + "Aguardando você" + evento na mesma operação, idempotente, sem auditoria', opts, async () => {
  const admin = await h.newProf({ admin: true });   // conta própria: o limite de escrita é por administradora
  const p = await h.newProf({ businessName: `Resp ${h.runId}` });
  const t = await apiCreate(p);
  assert.equal((await admView(t.id)).ticket.unread, true);                        // a profissional escreveu por último

  const body = msgBody({ body: 'Olá! Vamos resolver isso.' });
  const r = await h.call('POST', `/admin/support/tickets/${t.id}/messages`, { as: admin, body });
  assert.equal(r.status, 201, r.text);
  assert.equal(r.json.message.seq, 3);
  assert.equal(r.json.message.authorRole, 'admin');
  assert.equal(r.json.message.authorId, admin.id);                                // autor vem da sessão
  assert.equal(r.json.ticket.status, 'aguardando_profissional');
  assert.equal(r.json.ticket.unread, false);                                      // a ADM escreveu por último
  const act = await h.activity(t.id);
  assert.deepEqual(act.events.slice(-1).map((e) => [Number(e.seq), e.type, e.from_value, e.to_value, e.actor_role, e.actor_id]),
    [[4, 'status_changed', 'aberta', 'aguardando_profissional', 'admin', admin.id]]);

  // Para a profissional: nova resposta (não lida) e a mensagem sem identificar a administradora.
  const pv = await profView(t.id, p);
  assert.equal(pv.ticket.status, 'aguardando_profissional');
  assert.equal(pv.ticket.unread, true);
  const adminMsg = pv.messages.find((m) => m.authorRole === 'admin');
  assert.equal(adminMsg.body, 'Olá! Vamos resolver isso.');
  assert.ok(!('authorId' in adminMsg));

  // Repetição: 200, mesma mensagem; outro texto com o mesmo id: 409; outra administradora responde normalmente.
  const again = await h.call('POST', `/admin/support/tickets/${t.id}/messages`, { as: admin, body });
  assert.equal(again.status, 200);
  assert.equal(again.json.message.id, r.json.message.id);
  const conflict = await h.call('POST', `/admin/support/tickets/${t.id}/messages`, { as: admin, body: { ...body, body: 'outro' } });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.json.reason, 'idempotency_conflict');
  const eventsBefore = (await h.activity(t.id)).events.length;
  const second = await h.call('POST', `/admin/support/tickets/${t.id}/messages`, { as: admin2, body: msgBody() });
  assert.equal(second.status, 201);
  assert.equal(second.json.message.authorId, admin2.id);
  assert.equal((await h.activity(t.id)).events.length, eventsBefore);            // já estava em aguardando: sem novo evento

  assert.deepEqual(await h.auditRows('target_id = $1', [p.id]), []);              // responder não é auditado
});

test('responder: validação, inexistente, resolvida (409) e 10 envios simultâneos do mesmo id', opts, async () => {
  const admin = await h.newProf({ admin: true });   // conta própria: o limite de escrita é por administradora
  const p = await h.newProf();
  const t = await apiCreate(p);
  for (const bad of [{}, { body: '   ', clientMessageId: randomUUID() }, { body: 'x'.repeat(5001), clientMessageId: randomUUID() },
    { body: 'ok', clientMessageId: 'nao-uuid' }, { ...msgBody(), professionalId: p.id }, { ...msgBody(), authorId: admin.id }]) {
    assert.equal((await h.call('POST', `/admin/support/tickets/${t.id}/messages`, { as: admin, body: bad })).status, 400, JSON.stringify(bad).slice(0, 50));
  }
  assert.equal((await h.call('POST', `/admin/support/tickets/${randomUUID()}/messages`, { as: admin, body: msgBody() })).status, 404);
  assert.equal((await h.activity(t.id)).messages.length, 1);

  const payload = msgBody();
  const rs = await Promise.all(Array.from({ length: 10 }, () => h.call('POST', `/admin/support/tickets/${t.id}/messages`, { as: admin, body: payload })));
  assert.deepEqual(rs.map((r) => r.status).sort(), [200, 200, 200, 200, 200, 200, 200, 200, 200, 201]);
  assert.equal((await h.activity(t.id)).messages.length, 2);
  assert.equal((await h.activity(t.id)).events.filter((e) => e.type === 'status_changed').length, 1);

  await h.resolveTicket(t.id, admin.id);
  const refused = await h.call('POST', `/admin/support/tickets/${t.id}/messages`, { as: admin, body: msgBody() });
  assert.equal(refused.status, 409);
  assert.equal(refused.json.reason, 'ticket_resolved');
  assert.equal((await h.call('POST', `/admin/support/tickets/${t.id}/messages`, { as: admin, body: payload })).status, 200);   // repetir o já gravado
});

// ── Status ──────────────────────────────────────────────────────────────────

test('status manual: transições, idempotência, expectedStatus, reabertura pela ADM e auditoria exata', opts, async () => {
  const admin = await h.newProf({ admin: true });   // conta própria: o limite de escrita é por administradora
  const p = await h.newProf({ businessName: `Status ${h.runId}` });
  const t = await apiCreate(p, { subject: 'Assunto que não pode ir para a auditoria' });
  const setStatus = (status, extra = {}) => h.call('POST', `/admin/support/tickets/${t.id}/status`, { as: admin, body: { status, ...extra } });
  const audits = () => h.auditRows('target_id = $1', [p.id]);
  const events = async () => (await h.activity(t.id)).events;

  let r = await setStatus('em_atendimento');
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.ticket.status, 'em_atendimento');
  assert.equal((await audits()).length, 1);

  r = await setStatus('em_atendimento');                                                    // idempotente
  assert.equal(r.status, 200);
  assert.equal((await audits()).length, 1);
  assert.equal((await events()).length, 2);                                                 // created + 1 mudança

  r = await setStatus('aguardando_profissional', { expectedStatus: 'aberta' });              // outro ator mudou antes
  assert.equal(r.status, 409);
  assert.equal(r.json.reason, 'stale_status');
  assert.equal((await h.ticketRow(t.id)).status, 'em_atendimento');

  r = await setStatus('aguardando_profissional', { expectedStatus: 'em_atendimento' });
  assert.equal(r.status, 200);

  r = await setStatus('resolvida');
  assert.equal(r.status, 200);
  assert.ok(r.json.ticket.resolvedAt);
  let row = await h.ticketRow(t.id);
  assert.equal(row.resolved_by, admin.id);
  assert.ok(row.resolved_at);

  r = await setStatus('aguardando_profissional');                                           // resolvida -> aguardando não existe
  assert.equal(r.status, 409);
  assert.equal(r.json.reason, 'invalid_transition');

  // A profissional é avisada (evento de status notifica) e ainda pode reabrir dentro de 7 dias.
  const pv = await profView(t.id, p);
  assert.equal(pv.ticket.status, 'resolvida');
  assert.equal(pv.ticket.unread, true);
  assert.ok(pv.ticket.canReopenUntil);

  r = await setStatus('em_atendimento');                                                    // reabertura pela ADM
  assert.equal(r.status, 200);
  row = await h.ticketRow(t.id);
  assert.equal(row.status, 'em_atendimento');
  assert.equal(row.resolved_at, null);
  assert.equal(row.resolved_by, null);
  assert.equal(row.reopen_count, 0);                                                        // só a profissional conta reaberturas
  assert.deepEqual((await events()).slice(-1).map((e) => [e.type, e.from_value, e.to_value, e.actor_role, e.actor_id]), [['reopened', 'resolvida', 'em_atendimento', 'admin', admin.id]]);

  const log = await audits();
  assert.equal(log.length, 4);                                                              // 4 mudanças reais; as repetições e recusas não
  for (const a of log) {
    assert.deepEqual([a.actor_id, a.actor_email, a.action, a.target_id, a.target_business_name],
      [admin.id, (await h.one('SELECT email FROM professionals WHERE id = $1', [admin.id])).email, 'support_status', p.id, `Status ${h.runId}`]);
  }
  assert.ok(!JSON.stringify(log).includes('Assunto que não pode'), 'a auditoria não grava o assunto');

  for (const bad of [{}, { status: 'fechada' }, { status: 'aberta', expectedStatus: 'fechada' }, { status: 'aberta', professionalId: p.id }]) {
    assert.equal((await h.call('POST', `/admin/support/tickets/${t.id}/status`, { as: admin, body: bad })).status, 400, JSON.stringify(bad));
  }
  assert.equal((await h.call('POST', `/admin/support/tickets/${randomUUID()}/status`, { as: admin, body: { status: 'aberta' } })).status, 404);
  assert.equal((await audits()).length, 4);
});

test('status: 6 mudanças idênticas simultâneas geram um evento e uma linha de auditoria', opts, async () => {
  const admin = await h.newProf({ admin: true });   // conta própria: o limite de escrita é por administradora
  const p = await h.newProf();
  const t = await apiCreate(p);
  const rs = await Promise.all(Array.from({ length: 6 }, () => h.call('POST', `/admin/support/tickets/${t.id}/status`, { as: admin, body: { status: 'em_atendimento' } })));
  assert.ok(rs.every((r) => r.status === 200));
  assert.equal((await h.activity(t.id)).events.filter((e) => e.type === 'status_changed').length, 1);
  assert.equal((await h.auditRows('target_id = $1', [p.id])).length, 1);
});

test('corrida entre a resposta da profissional e a resolução da ADM: o lock decide e nada fica pela metade', opts, async () => {
  const admin = await h.newProf({ admin: true });   // conta própria: o limite de escrita é por administradora
  const p = await h.newProf();
  const t = await apiCreate(p);
  // A profissional segura o lock do ticket; a resolução da ADM espera e depois é aplicada sobre o estado novo.
  const tx = await h.pool.connect();
  try {
    await tx.query('BEGIN');
    await tx.query('SELECT 1 FROM support_tickets WHERE id = $1 FOR UPDATE', [t.id]);
    const pending = h.call('POST', `/admin/support/tickets/${t.id}/status`, { as: admin, body: { status: 'resolvida', expectedStatus: 'aberta' } });
    await h.waitUntil(async () => Number((await h.one(
      `SELECT count(*) AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%FOR UPDATE OF t%'`
    )).n) >= 1);
    await tx.query(`UPDATE support_tickets SET status = 'em_atendimento' WHERE id = $1`, [t.id]);   // outro ator muda antes
    await tx.query('COMMIT');
    const r = await pending;
    assert.equal(r.status, 409);
    assert.equal(r.json.reason, 'stale_status');
  } finally {
    await tx.query('ROLLBACK').catch(() => {});
    tx.release();
  }
  assert.equal((await h.ticketRow(t.id)).status, 'em_atendimento');
  assert.equal((await h.auditRows('target_id = $1', [p.id])).length, 0);
});

// ── Prioridade ──────────────────────────────────────────────────────────────

test('prioridade: ajuste manual, evento sem notificar, auditoria só quando muda, idempotência e validação', opts, async () => {
  const admin = await h.newProf({ admin: true });   // conta própria: o limite de escrita é por administradora
  const p = await h.newProf({ businessName: `Prio ${h.runId}` });
  const t = await apiCreate(p);                                                            // agenda sem termos: baixa/auto
  assert.equal((await h.ticketRow(t.id)).priority, 'baixa');
  const put = (priority, as = admin) => h.call('PUT', `/admin/support/tickets/${t.id}/priority`, { as, body: { priority } });
  const audits = () => h.auditRows('target_id = $1', [p.id]);

  assert.equal((await profView(t.id, p)).ticket.unread, false);
  const r = await put('alta');
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.ticket.priority, 'alta');
  assert.equal(r.json.ticket.prioritySource, 'manual');
  const row = await h.ticketRow(t.id);
  assert.equal(row.priority_source, 'manual');
  assert.equal(row.last_actor, 'professional');                                            // não notifica: last_actor não mudou
  assert.deepEqual((await h.activity(t.id)).events.slice(-1).map((e) => [e.type, e.from_value, e.to_value, e.actor_role]), [['priority_changed', 'baixa', 'alta', 'admin']]);
  assert.equal((await profView(t.id, p)).ticket.unread, false);
  assert.equal((await h.call('GET', '/support/bootstrap', { as: p })).json.unreadTickets, 0);
  let log = await audits();
  assert.deepEqual(log.map((a) => [a.action, a.target_id, a.target_business_name, a.actor_id]), [['support_priority', p.id, `Prio ${h.runId}`, admin.id]]);

  assert.equal((await put('alta')).status, 200);                                           // igual e já manual: noop
  assert.equal((await audits()).length, 1);
  assert.equal((await put('media')).status, 200);
  assert.equal((await audits()).length, 2);

  // Mesma prioridade ainda automática: passa a manual sem evento nem auditoria.
  const t2 = await apiCreate(p, { subject: 'Segunda solicitação' });
  const same = await h.call('PUT', `/admin/support/tickets/${t2.id}/priority`, { as: admin, body: { priority: 'baixa' } });
  assert.equal(same.status, 200);
  assert.equal(same.json.ticket.prioritySource, 'manual');
  assert.equal((await h.activity(t2.id)).events.length, 1);
  assert.equal((await audits()).length, 2);

  for (const bad of [{}, { priority: 'critica' }, { priority: 'alta', extra: 1 }, { priority: 5 }]) {
    assert.equal((await h.call('PUT', `/admin/support/tickets/${t.id}/priority`, { as: admin, body: bad })).status, 400, JSON.stringify(bad));
  }
  assert.equal((await h.call('PUT', `/admin/support/tickets/${randomUUID()}/priority`, { as: admin, body: { priority: 'alta' } })).status, 404);
  log = await audits();
  assert.equal(log.length, 2);
});

// ── Leitura (cursor da ADM) ─────────────────────────────────────────────────

test('leitura da ADM: cursor monotônico limitado ao existente, compartilhado entre administradoras', opts, async () => {
  const p = await h.newProf();
  const t = await apiCreate(p);                                                              // seq 1 created, 2 mensagem (last_seq 2)
  const view = async (as = admin) => (await admView(t.id, as)).ticket;
  assert.equal((await view()).unread, true);
  assert.equal((await h.call('POST', `/admin/support/tickets/${t.id}/read`, { as: admin, body: { upToSeq: 1 } })).status, 204);
  assert.equal((await view()).unread, true);                                                 // só exibiu até o seq 1
  assert.equal((await h.call('POST', `/admin/support/tickets/${t.id}/read`, { as: admin, body: { upToSeq: 2 } })).status, 204);
  assert.equal((await view()).unread, false);
  assert.equal((await view(admin2)).unread, false);                                          // compartilhado (decisão P9)
  assert.equal((await h.call('POST', `/admin/support/tickets/${t.id}/read`, { as: admin, body: { upToSeq: 1 } })).status, 204);
  assert.equal(Number((await h.ticketRow(t.id)).admin_read_seq), 2);                          // não retrocede
  assert.equal((await h.call('POST', `/admin/support/tickets/${t.id}/read`, { as: admin, body: { upToSeq: 10 ** 9 } })).status, 204);
  assert.equal(Number((await h.ticketRow(t.id)).admin_read_seq), 2);                          // limitado ao activity_seq
  assert.equal(Number((await h.ticketRow(t.id)).prof_read_seq), 0);                           // cursor da profissional intacto

  await h.profMessage(t.id, p.id, 'mais uma');                                               // seq 3
  assert.equal((await view()).unread, true);
  for (const body of [{}, { upToSeq: -1 }, { upToSeq: 1.5 }, { upToSeq: '3' }, { upToSeq: 1, x: 1 }]) {
    assert.equal((await h.call('POST', `/admin/support/tickets/${t.id}/read`, { as: admin, body })).status, 400, JSON.stringify(body));
  }
  assert.equal((await h.call('POST', `/admin/support/tickets/${randomUUID()}/read`, { as: admin, body: { upToSeq: 1 } })).status, 404);
});

// ── FAQ ─────────────────────────────────────────────────────────────────────

test('FAQ da ADM: rascunho, validação, publicar/despublicar idempotentes, edição, auditoria e visibilidade para a profissional', opts, async () => {
  const admin = await h.newProf({ admin: true });   // conta própria: o limite de escrita é por administradora
  const prof = await h.newProf();
  const tag = h.runId;
  const faqTitles = async () => (await h.call('GET', '/support/faq', { as: prof })).json.articles.map((a) => a.title);

  const created = await h.call('POST', '/admin/support/faq/articles', { as: admin, body: { categorySlug: 'tecnico', title: `  Como  entrar ${tag} `, body: 'Passo 1\nPasso 2' } });
  assert.equal(created.status, 201, created.text);
  const art = created.json.article;
  assert.equal(art.status, 'rascunho');
  assert.equal(art.publishedAt, null);
  assert.equal(art.title, `Como entrar ${tag}`);
  assert.equal(art.createdBy, admin.id);
  assert.ok(Number.isInteger(art.position) && art.position >= 1);
  const auditFor = (action) => h.auditRows('target_id = $1 AND action = $2', [art.id, action]);
  assert.deepEqual((await auditFor('faq_create')).map((a) => [a.actor_id, a.target_business_name]), [[admin.id, `Como entrar ${tag}`]]);

  for (const bad of [{ title: 'ab' }, { title: 'x'.repeat(121) }, { body: '   ' }, { body: 'y'.repeat(8001) }, { categorySlug: 'outra' }, { position: -1 }, { position: 1.5 }, { status: 'publicado' }, { createdBy: admin.id }]) {
    const r = await h.call('POST', '/admin/support/faq/articles', { as: admin, body: { categorySlug: 'tecnico', title: `Valido ${tag}`, body: 'ok', ...bad } });
    assert.equal(r.status, 400, JSON.stringify(bad).slice(0, 50));
  }

  // Rascunho: aparece na lista da ADM, nunca para a profissional.
  const adminList = await h.call('GET', '/admin/support/faq', { as: admin });
  assert.equal(adminList.json.categories.length, 6);
  assert.equal(adminList.json.articles.find((a) => a.id === art.id).status, 'rascunho');
  assert.ok(!(await faqTitles()).includes(art.title));

  let r = await h.call('POST', `/admin/support/faq/articles/${art.id}/publish`, { as: admin });
  assert.equal(r.status, 200);
  assert.equal(r.json.article.status, 'publicado');
  assert.ok(r.json.article.publishedAt);
  assert.ok((await faqTitles()).includes(art.title));
  assert.equal((await h.call('POST', `/admin/support/faq/articles/${art.id}/publish`, { as: admin })).status, 200);   // idempotente
  assert.equal((await auditFor('faq_publish')).length, 1);

  r = await h.call('PUT', `/admin/support/faq/articles/${art.id}`, { as: admin, body: { categorySlug: 'tecnico', title: `Como entrar (novo) ${tag}`, body: 'Texto novo' } });
  assert.equal(r.status, 200);
  assert.equal(r.json.article.status, 'publicado');                                         // editar não despublica
  assert.equal(r.json.article.updatedBy, admin.id);
  assert.deepEqual((await auditFor('faq_update')).map((a) => a.target_business_name), [`Como entrar (novo) ${tag}`]);
  assert.equal((await h.call('PUT', `/admin/support/faq/articles/${art.id}`, { as: admin2, body: { categorySlug: 'tecnico', title: `Como entrar (novo) ${tag}`, body: 'Texto novo' } })).status, 200);
  assert.equal((await auditFor('faq_update')).length, 1);                                    // sem mudança: sem auditoria

  r = await h.call('POST', `/admin/support/faq/articles/${art.id}/unpublish`, { as: admin });
  assert.equal(r.status, 200);
  assert.equal(r.json.article.status, 'rascunho');
  assert.equal(r.json.article.publishedAt, null);
  assert.ok(!(await faqTitles()).includes(`Como entrar (novo) ${tag}`));
  assert.equal((await h.call('POST', `/admin/support/faq/articles/${art.id}/unpublish`, { as: admin })).status, 200);
  assert.equal((await auditFor('faq_unpublish')).length, 1);

  assert.equal((await h.call('PUT', `/admin/support/faq/articles/${randomUUID()}`, { as: admin, body: { categorySlug: 'tecnico', title: 'Qualquer', body: 'x' } })).status, 404);
  assert.equal((await h.call('POST', `/admin/support/faq/articles/${randomUUID()}/publish`, { as: admin })).status, 404);
  assert.equal((await h.call('PUT', '/admin/support/faq/articles/nao-uuid', { as: admin, body: {} })).status, 400);
  // Não existe DELETE de artigo: nada o apaga pela API.
  const del = await h.call('DELETE', `/admin/support/faq/articles/${art.id}`, { as: admin });
  assert.equal(del.status, 404);
  assert.ok((await h.one('SELECT id FROM support_faq_articles WHERE id = $1', [art.id])));
});

test('FAQ da ADM: reordenar exige exatamente os artigos da categoria e audita só quem mudou de posição', opts, async () => {
  const admin = await h.newProf({ admin: true });   // conta própria: o limite de escrita é por administradora
  const tag = h.runId;
  const mk = async (title) => (await h.call('POST', '/admin/support/faq/articles', { as: admin, body: { categorySlug: 'financeiro', title: `${title} ${tag}`, body: 'texto', position: 0 } })).json.article;
  // Zera o cenário da categoria: só os artigos deste teste (os demais de outros testes já foram removidos).
  const existing = (await h.pool.query(`SELECT id FROM support_faq_articles WHERE category_slug = 'financeiro'`)).rows.map((r) => r.id);
  const a = await mk('Alfa'); const b = await mk('Beta'); const c = await mk('Gama');
  const ids = [...existing, a.id, b.id, c.id];
  const base = (await h.pool.query(`SELECT count(*) AS n FROM admin_audit_log WHERE action = 'faq_update' AND target_id = ANY($1::uuid[])`, [ids])).rows[0].n;
  const reorder = (orderedIds, categorySlug = 'financeiro') => h.call('PUT', '/admin/support/faq/reorder', { as: admin, body: { categorySlug, orderedIds } });
  const positions = async () => Object.fromEntries((await h.pool.query('SELECT id, position FROM support_faq_articles WHERE id = ANY($1::uuid[])', [ids])).rows.map((r) => [r.id, r.position]));
  const updates = async () => Number((await h.pool.query(`SELECT count(*) AS n FROM admin_audit_log WHERE action = 'faq_update' AND target_id = ANY($1::uuid[])`, [ids])).rows[0].n) - Number(base);

  const order1 = [...existing, c.id, b.id, a.id];
  assert.equal((await reorder(order1)).status, 204);
  const pos = await positions();
  assert.deepEqual(order1.map((id) => pos[id]), order1.map((_, i) => i + 1));
  const changed = await updates();
  assert.ok(changed >= 2 && changed <= order1.length);
  assert.equal((await reorder(order1)).status, 204);                                         // mesma ordem: nenhuma auditoria nova
  assert.equal(await updates(), changed);

  const other = (await h.call('POST', '/admin/support/faq/articles', { as: admin, body: { categorySlug: 'agenda', title: `Outra categoria ${tag}`, body: 'x' } })).json.article;
  for (const bad of [order1.slice(1), [...order1, randomUUID()], [...order1.slice(0, -1), order1[0]], [...order1.slice(0, -1), other.id], []]) {
    assert.equal((await reorder(bad)).status, 400, JSON.stringify(bad).slice(0, 40));
  }
  assert.equal((await reorder(order1, 'categoria-x')).status, 400);
  assert.deepEqual(await positions(), pos);                                                  // as recusadas não mexeram em nada
  assert.equal(await updates(), changed);
});

// ── Consistência transacional ───────────────────────────────────────────────

test('falha ao responder: nada é gravado e o texto não vai à resposta nem ao log', opts, async () => {
  const admin = await h.newProf({ admin: true });   // conta própria: o limite de escrita é por administradora
  const p = await h.newProf();
  const t = await apiCreate(p);
  const before = await h.ticketRow(t.id);
  const logs = [];
  const original = console.error;
  console.error = (...args) => { logs.push(args.map((x) => inspect(x, { depth: 6 })).join(' ')); };
  let r;
  try {
    r = await h.call('POST', `/admin/support/tickets/${t.id}/messages`, { as: admin, body: msgBody({ body: `${FAIL_MESSAGE} conversa privada` }) });
  } finally {
    console.error = original;
  }
  assert.equal(r.status, 500);
  assert.deepEqual(r.json, { error: 'Erro interno do servidor.' });
  const after = await h.ticketRow(t.id);
  assert.equal(after.status, before.status);                                                  // a mudança para "aguardando" não ficou
  assert.equal(after.activity_seq, before.activity_seq);
  assert.equal((await h.activity(t.id)).messages.length, 1);
  const logged = logs.join('\n');
  assert.ok(logged.includes('23514'));
  assert.ok(!logged.includes('conversa privada') && !logged.includes('linha:') && !logged.includes(FAIL_MESSAGE) && !r.text.includes('privada'));
});

test('falha na auditoria desfaz a mudança: status, prioridade e artigo da FAQ não ficam pela metade', opts, async () => {
  const admin = await h.newProf({ admin: true });   // conta própria: o limite de escrita é por administradora
  const p = await h.newProf({ businessName: `${FAIL_AUDIT} ${h.runId}` });              // a auditoria de qualquer ação sobre ela falha
  const t = await apiCreate(p);
  const before = await h.ticketRow(t.id);
  const eventsBefore = (await h.activity(t.id)).events.length;

  const st = await h.call('POST', `/admin/support/tickets/${t.id}/status`, { as: admin, body: { status: 'resolvida' } });
  assert.equal(st.status, 500);
  const pr = await h.call('PUT', `/admin/support/tickets/${t.id}/priority`, { as: admin, body: { priority: 'alta' } });
  assert.equal(pr.status, 500);
  const row = await h.ticketRow(t.id);
  assert.equal(row.status, before.status);
  assert.equal(row.resolved_at, null);
  assert.equal(row.resolved_by, null);
  assert.equal(row.priority, before.priority);
  assert.equal(row.priority_source, before.priority_source);
  assert.equal(row.activity_seq, before.activity_seq);
  assert.equal((await h.activity(t.id)).events.length, eventsBefore);                       // nem evento de status nem de prioridade

  const art = await h.call('POST', '/admin/support/faq/articles', { as: admin, body: { categorySlug: 'agenda', title: `${FAIL_AUDIT} artigo ${h.runId}`, body: 'x' } });
  assert.equal(art.status, 500);
  assert.equal((await h.pool.query(`SELECT 1 FROM support_faq_articles WHERE title LIKE $1`, [`${FAIL_AUDIT}%`])).rowCount, 0);

  // Sem a falha injetada a mesma operação funciona (a conta e a solicitação seguem íntegras).
  await h.pool.query('UPDATE professionals SET business_name = $2 WHERE id = $1', [p.id, `Ok ${h.runId}`]);
  assert.equal((await h.call('POST', `/admin/support/tickets/${t.id}/status`, { as: admin, body: { status: 'resolvida' } })).status, 200);
  assert.equal((await h.auditRows('target_id = $1', [p.id])).length, 1);
});

test('reordenar: falha na auditoria do último artigo desfaz tudo (nem posições nem auditoria parciais)', opts, async () => {
  const admin = await h.newProf({ admin: true });
  const tag = h.runId;
  await h.pool.query(`DELETE FROM support_faq_articles WHERE category_slug = 'clientes'`);   // cenário isolado: banco descartável
  const mk = async (title, position) => (await h.one(
    `INSERT INTO support_faq_articles (category_slug, title, body, position) VALUES ('clientes', $1, 'x', $2) RETURNING id`, [title, position]
  )).id;
  const a = await mk(`Artigo A ${tag}`, 1);
  const f = await mk(`${FAIL_AUDIT} artigo F ${tag}`, 2);       // a auditoria deste artigo falha
  const b = await mk(`Artigo B ${tag}`, 3);
  const positions = async () => Object.fromEntries((await h.pool.query('SELECT id, position FROM support_faq_articles WHERE id = ANY($1::uuid[])', [[a, f, b]])).rows.map((r) => [r.id, r.position]));
  const before = await positions();

  // Nova ordem B, A, F: B e A mudam (auditadas antes) e F, o último, falha ao auditar.
  const r = await h.call('PUT', '/admin/support/faq/reorder', { as: admin, body: { categorySlug: 'clientes', orderedIds: [b, a, f] } });
  assert.equal(r.status, 500);
  assert.deepEqual(await positions(), before);                                                 // posições intactas
  assert.equal(Number((await h.one(`SELECT count(*) AS n FROM admin_audit_log WHERE target_id = ANY($1::uuid[])`, [[a, f, b]])).n), 0);   // sem linhas parciais de auditoria
  await h.pool.query('DELETE FROM support_faq_articles WHERE id = ANY($1::uuid[])', [[a, f, b]]);
});

// ── Limitadores próprios ────────────────────────────────────────────────────

test('limitadores: leituras 300/5 min e escritas 60/5 min por administradora, independentes do limite por IP do /admin', opts, async () => {
  const admin = await h.newProf({ admin: true });   // conta própria: o limite de escrita é por administradora
  const w = await h.newProf({ admin: true });
  const p = await h.newProf();
  const t = await apiCreate(p);
  for (let i = 0; i < 60; i += 1) {
    const r = await h.call('PUT', `/admin/support/tickets/${t.id}/priority`, { as: w, body: { priority: 'baixa' } });
    assert.equal(r.status, 200, `escrita ${i + 1}`);
  }
  const limited = await h.call('PUT', `/admin/support/tickets/${t.id}/priority`, { as: w, body: { priority: 'baixa' } });
  assert.equal(limited.status, 429);
  assert.equal(typeof limited.json.error, 'string');
  assert.equal((await h.call('PUT', `/admin/support/tickets/${t.id}/priority`, { as: admin, body: { priority: 'baixa' } })).status, 200);   // outra conta não é afetada

  const rd = await h.newProf({ admin: true });
  for (let i = 0; i < 300; i += 1) {
    const r = await h.call('GET', '/admin/support/summary', { as: rd });
    if (r.status !== 200) assert.fail(`leitura ${i + 1} deu ${r.status}`);
  }
  assert.equal((await h.call('GET', '/admin/support/summary', { as: rd })).status, 429);
  // O limite por IP do /admin (100/5 min) não foi consumido por essas 300 leituras: as rotas /admin seguem normais.
  assert.equal((await h.call('GET', '/admin/professionals', { as: rd })).status, 200);
});

// ── Interruptor desligado (servidor real em processo separado) ──────────────

for (const flag of [undefined, '', '1', 'yes', 'false']) {
  test(`interruptor desligado (${JSON.stringify(flag)}): /admin/support responde 404 antes da autenticação; o resto do /admin segue normal`, opts, async () => {
    const prof = await h.newProf();
    const t = await h.seedTicket(prof);
    await h.withServer(flag, async (base) => {
      for (const who of [undefined, prof, admin]) {
        for (const [method, p] of ADMIN_ROUTES(t.id, randomUUID())) {
          const r = await h.call(method, p, { as: who, base, ...(method === 'GET' ? {} : { body: msgBody() }) });
          assert.equal(r.status, 404, `${method} ${p} (${who ? 'com sessão' : 'sem sessão'})`);
          assert.deepEqual(r.json, { error: 'Recurso não encontrado.' });
        }
      }
      assert.equal((await h.call('GET', '/admin/professionals', { as: admin, base })).status, 200);
      assert.equal((await h.call('GET', '/admin/professionals', { as: prof, base })).status, 403);
    });
    assert.equal((await h.ticketRow(t.id)).status, 'aberta');
    assert.equal((await h.auditRows('target_id = $1', [prof.id])).length, 0);
  });
}

test('interruptor ligado com " TRUE ": ADM entra, profissional leva 403 e sem sessão 401', opts, async () => {
  const prof = await h.newProf();
  await h.withServer(' TRUE ', async (base) => {
    assert.equal((await h.call('GET', '/admin/support/summary', { as: admin, base })).status, 200);
    assert.equal((await h.call('GET', '/admin/support/summary', { as: prof, base })).status, 403);
    assert.equal((await h.call('GET', '/admin/support/summary', { base })).status, 401);
  });
});

test('conexões do pool são devolvidas depois das operações e das falhas', opts, async () => {
  await h.waitUntil(() => h.pool.waitingCount === 0 && h.pool.totalCount === h.pool.idleCount, 5000);
  assert.equal(h.pool.waitingCount, 0);
  assert.equal(h.pool.totalCount, h.pool.idleCount);
});
