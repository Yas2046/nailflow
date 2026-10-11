// GET /admin/audit-log com as ações da Central de Suporte (migration 024): filtro por ação exata, grupo "suporte"
// e a compatibilidade dos filtros antigos. Só roda com SUPPORT_API_TEST_DB_URL (banco descartável com 023/024;
// guarda em tests/helpers/supportTestDb.js). Rode uma suíte de banco por vez no mesmo banco.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { dbWanted, skip, startHarness } from './helpers/supportHarness.js';

const opts = { skip, timeout: 60_000 };
let h;
let admin;
const NEW_ACTIONS = ['faq_create', 'faq_update', 'faq_publish', 'faq_unpublish', 'support_status', 'support_priority'];
const OLD_ACTIONS = ['block', 'unblock', 'update', 'delete'];
const tag = randomUUID().slice(0, 8);

before(async () => {
  if (!dbWanted) return;
  h = await startHarness();
  admin = await h.newProf({ admin: true });
  const target = await h.newProf();
  // Uma linha de cada ação, em um dia isolado (2001-07-01 SP), para contar sem interferência de outros testes.
  for (const [i, action] of [...OLD_ACTIONS, ...NEW_ACTIONS].entries()) {
    await h.pool.query(
      `INSERT INTO admin_audit_log (actor_id, actor_email, action, target_id, target_business_name, created_at)
       VALUES ($1, 'audit-filter@teste.local', $2, $3, $4, $5)`,
      [admin.id, action, target.id, `Alvo ${tag} ${action}`, `2001-07-01T${String(12 + Math.floor(i / 6)).padStart(2, '0')}:${String((i % 6) * 5).padStart(2, '0')}:00Z`]
    );
  }
});
after(async () => { if (h) await h.stop(); });

const list = (qs) => h.call('GET', `/admin/audit-log?from=2001-07-01&to=2001-07-01&pageSize=50${qs}`, { as: admin });

test('sem filtro, as ações antigas e as novas aparecem; o formato do item não muda', opts, async () => {
  const r = await list('');
  assert.equal(r.status, 200, r.text);
  const mine = r.json.items.filter((i) => i.targetBusinessName.startsWith(`Alvo ${tag}`));
  assert.deepEqual(mine.map((i) => i.action).sort(), [...OLD_ACTIONS, ...NEW_ACTIONS].sort());
  assert.deepEqual(Object.keys(mine[0]).sort(), ['action', 'actorEmail', 'actorId', 'createdAt', 'id', 'targetBusinessName', 'targetId']);
});

test('filtro por cada ação exata devolve só ela (antigas e novas)', opts, async () => {
  for (const action of [...OLD_ACTIONS, ...NEW_ACTIONS]) {
    const r = await list(`&action=${action}`);
    assert.equal(r.status, 200, action);
    const mine = r.json.items.filter((i) => i.targetBusinessName.startsWith(`Alvo ${tag}`));
    assert.deepEqual(mine.map((i) => i.action), [action], action);
    assert.ok(r.json.items.every((i) => i.action === action), `${action}: nenhum item de outra ação`);
  }
});

test('grupo "suporte": só as seis ações da Central, nenhuma das antigas', opts, async () => {
  const r = await list('&action=suporte');
  assert.equal(r.status, 200, r.text);
  assert.ok(r.json.items.every((i) => NEW_ACTIONS.includes(i.action)));
  const mine = r.json.items.filter((i) => i.targetBusinessName.startsWith(`Alvo ${tag}`));
  assert.deepEqual(mine.map((i) => i.action).sort(), [...NEW_ACTIONS].sort());
  assert.equal(r.json.total, mine.length);                              // o dia isolado só tem as linhas deste teste
  // Combina com período e paginação.
  const paged = await h.call('GET', '/admin/audit-log?from=2001-07-01&to=2001-07-01&action=suporte&pageSize=4&page=2', { as: admin });
  assert.equal(paged.json.items.length, 2);
  assert.equal(paged.json.totalPages, 2);
});

test('ações inexistentes continuam sendo 400 e o filtro vazio ou "all" segue sem filtro', opts, async () => {
  for (const bad of ['explodir', 'support', 'faq', 'suporte2', 'SUPORTE', 'support_status,faq_create']) {
    const r = await list(`&action=${encodeURIComponent(bad)}`);
    assert.equal(r.status, 400, bad);
  }
  const all = await list('&action=all');
  const empty = await list('&action=');
  assert.equal(all.json.total, empty.json.total);
  assert.equal(all.json.total, OLD_ACTIONS.length + NEW_ACTIONS.length);
});

test('o log continua somente leitura e restrito à ADM', opts, async () => {
  const prof = await h.newProf();
  assert.equal((await h.call('GET', '/admin/audit-log', { as: prof })).status, 403);
  assert.equal((await h.call('GET', '/admin/audit-log')).status, 401);
  for (const method of ['POST', 'PUT', 'DELETE']) {
    assert.equal((await h.call(method, '/admin/audit-log', { as: admin, body: {} })).status, 404, method);
  }
});
