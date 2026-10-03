/**
 * GET /admin/audit-log (somente leitura): autorização, paginação, ordenação,
 * filtros por ação e período (dia em America/Sao_Paulo), validação, campos
 * devolvidos e ausência de qualquer rota de escrita.
 *
 * As linhas de teste usam uma janela de datas no passado distante (2001, inverno: sem horário de verão em SP) para
 * que os totais sejam determinísticos mesmo com outros arquivos de teste
 * gravando no mesmo banco ao mesmo tempo.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';

let server;
let baseUrl;
let dbAvailable = true;
let pool;
let adminId; let adminCookie;
let proId; let proCookie;
const createdProfessionals = [];

const ADMIN_EMAIL = 'admin_auditlist_test@nailflow.com';
const PRO_EMAIL = 'pro_auditlist_test@nailflow.com';
const PASSWORD = 'senha_teste_auditlist';
const TARGET_PREFIX = 'AUDLIST';

// 2001-06-02 SP = 2001-06-02T03:00Z .. 2001-06-03T02:59:59Z
const ROWS = [
  // dia 02/02 (SP): fica fora de from=to=2001-06-03
  { action: 'block',   at: '2001-06-03T02:30:00Z', name: `${TARGET_PREFIX}-A` },
  // dia 03/02 (SP)
  { action: 'unblock', at: '2001-06-03T03:00:00Z', name: `${TARGET_PREFIX}-B` },   // 00:00 SP (início)
  { action: 'update',  at: '2001-06-03T12:00:00Z', name: `${TARGET_PREFIX}-C` },
  { action: 'update',  at: '2001-06-03T15:00:00Z', name: `${TARGET_PREFIX}-D` },
  { action: 'delete',  at: '2001-06-04T02:59:59Z', name: `${TARGET_PREFIX}-E` },   // 23:59:59 SP (fim)
  // dia 04/02 (SP): fora de from=to=2001-06-03
  { action: 'block',   at: '2001-06-04T03:00:00Z', name: `${TARGET_PREFIX}-F` },
];

before(async () => {
  ({ pool } = await import('../src/config/db.js'));
  try { await pool.query('SELECT 1'); } catch { dbAvailable = false; }

  const { default: app } = await import('../src/server.js');
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  if (!dbAvailable) return;

  const { default: bcrypt } = await import('bcryptjs');
  const hash = await bcrypt.hash(PASSWORD, 10);
  const mk = async (email, slug, isAdmin) => (await pool.query(
    `INSERT INTO professionals (name, email, password_hash, phone_whatsapp, business_name, slug, is_admin)
     VALUES ($1,$2,$3,'5531000000051',$4,$5,$6) RETURNING id`,
    [isAdmin ? 'Admin AuditList' : 'Pro AuditList', email, hash, `${TARGET_PREFIX} Studio`, slug, isAdmin]
  )).rows[0].id;
  adminId = await mk(ADMIN_EMAIL, 'teste-auditlist-admin', true);
  proId = await mk(PRO_EMAIL, 'teste-auditlist-pro', false);
  createdProfessionals.push(adminId, proId);

  const login = async (email) => {
    const res = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: PASSWORD }),
    });
    assert.equal(res.status, 200);
    return res.headers.get('set-cookie');
  };
  adminCookie = await login(ADMIN_EMAIL);
  proCookie = await login(PRO_EMAIL);

  for (const r of ROWS) {
    await pool.query(
      `INSERT INTO admin_audit_log (actor_id, actor_email, action, target_id, target_business_name, created_at)
       VALUES ($1,$2,$3,gen_random_uuid(),$4,$5)`,
      [adminId, ADMIN_EMAIL, r.action, r.name, r.at]
    );
  }
});

after(async () => {
  if (dbAvailable) {
    await pool.query('DELETE FROM admin_audit_log WHERE actor_id = $1', [adminId]).catch(() => {});
    for (const id of createdProfessionals) {
      await pool.query('DELETE FROM professionals WHERE id = $1', [id]).catch(() => {});
    }
  }
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
});

async function get(path, cookie = adminCookie) {
  const res = await fetch(`${baseUrl}${path}`, { headers: cookie ? { Cookie: cookie } : {} });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, raw: text };
}

// Janela que contém só as linhas deste arquivo.
const WINDOW = 'from=2001-06-02&to=2001-06-04';

test('autorização: sem sessão 401, profissional comum 403, admin 200', async (t) => {
  if (!dbAvailable) return t.skip('banco indisponível');
  assert.equal((await get('/admin/audit-log', null)).status, 401);
  assert.equal((await get('/admin/audit-log', proCookie)).status, 403);
  const ok = await get(`/admin/audit-log?${WINDOW}`);
  assert.equal(ok.status, 200);
});

test('ordem: mais recente primeiro, com todos os campos esperados e nenhum dado sensível', async (t) => {
  if (!dbAvailable) return t.skip('banco indisponível');
  const { body, raw } = await get(`/admin/audit-log?${WINDOW}`);
  assert.equal(body.total, ROWS.length);
  const dates = body.items.map((i) => new Date(i.createdAt).getTime());
  assert.deepEqual(dates, [...dates].sort((a, b) => b - a), 'deve vir do mais novo para o mais antigo');
  assert.deepEqual(body.items.map((i) => i.targetBusinessName), ['F', 'E', 'D', 'C', 'B', 'A'].map((x) => `${TARGET_PREFIX}-${x}`));
  assert.deepEqual(Object.keys(body.items[0]).sort(),
    ['action', 'actorEmail', 'actorId', 'createdAt', 'id', 'targetBusinessName', 'targetId']);
  assert.equal(body.items[0].actorEmail, ADMIN_EMAIL);
  assert.ok(!/password|hash|token|secret|pix/i.test(raw), 'resposta não pode conter dados sensíveis');
});

test('paginação: páginas sem sobreposição, totais e totalPages', async (t) => {
  if (!dbAvailable) return t.skip('banco indisponível');
  const p1 = (await get(`/admin/audit-log?${WINDOW}&pageSize=4&page=1`)).body;
  const p2 = (await get(`/admin/audit-log?${WINDOW}&pageSize=4&page=2`)).body;
  const p3 = (await get(`/admin/audit-log?${WINDOW}&pageSize=4&page=3`)).body;
  assert.equal(p1.total, 6);
  assert.equal(p1.totalPages, 2);
  assert.equal(p1.items.length, 4);
  assert.equal(p2.items.length, 2);
  assert.equal(p2.page, 2);
  assert.equal(p3.items.length, 0, 'página além do fim volta vazia');
  const ids = [...p1.items, ...p2.items].map((i) => i.id);
  assert.equal(new Set(ids).size, 6, 'sem repetição entre páginas');
});

test('filtro por ação (e "all"/vazio = sem filtro)', async (t) => {
  if (!dbAvailable) return t.skip('banco indisponível');
  const count = async (a) => (await get(`/admin/audit-log?${WINDOW}&action=${a}`)).body.total;
  assert.equal(await count('update'), 2);
  assert.equal(await count('block'), 2);
  assert.equal(await count('unblock'), 1);
  assert.equal(await count('delete'), 1);
  assert.equal(await count('all'), 6);
  assert.equal(await count(''), 6);
});

test('filtro por período: dia inteiro em America/Sao_Paulo, inclusivo nas duas pontas', async (t) => {
  if (!dbAvailable) return t.skip('banco indisponível');
  const day3 = (await get('/admin/audit-log?from=2001-06-03&to=2001-06-03')).body;
  assert.deepEqual(day3.items.map((i) => i.targetBusinessName).sort(),
    ['B', 'C', 'D', 'E'].map((x) => `${TARGET_PREFIX}-${x}`), '00:00 e 23:59:59 de SP entram; 23:30 do dia anterior e 00:00 do seguinte não');
  const day2 = (await get('/admin/audit-log?from=2001-06-02&to=2001-06-02')).body;
  assert.deepEqual(day2.items.map((i) => i.targetBusinessName), [`${TARGET_PREFIX}-A`]);
  const onlyFrom = (await get('/admin/audit-log?from=2001-06-04&to=2001-06-04')).body;
  assert.deepEqual(onlyFrom.items.map((i) => i.targetBusinessName), [`${TARGET_PREFIX}-F`]);
  const combined = (await get('/admin/audit-log?from=2001-06-03&to=2001-06-03&action=update')).body;
  assert.equal(combined.total, 2);
});

test('resumo: ações de hoje e dos últimos 7 dias (independe dos filtros)', async (t) => {
  if (!dbAvailable) return t.skip('banco indisponível');
  const before = (await get('/admin/audit-log?pageSize=1')).body.summary;
  await pool.query(
    `INSERT INTO admin_audit_log (actor_id, actor_email, action, target_id, target_business_name)
     VALUES ($1,$2,'update',gen_random_uuid(),$3)`, [adminId, ADMIN_EMAIL, `${TARGET_PREFIX}-HOJE`]);
  const filtered = (await get(`/admin/audit-log?${WINDOW}`)).body.summary;
  const after = (await get('/admin/audit-log?pageSize=1')).body.summary;
  assert.ok(after.today >= before.today + 1 && after.today >= 1);
  assert.ok(after.last7Days >= before.last7Days + 1 && after.last7Days >= after.today);
  assert.ok(filtered.today >= 1, 'o resumo ignora o filtro de período');
});

test('validação dos parâmetros devolve 400', async (t) => {
  if (!dbAvailable) return t.skip('banco indisponível');
  for (const q of [
    'action=explodir', 'page=0', 'page=abc', 'pageSize=0', 'pageSize=51', 'pageSize=1000',
    'from=2001-13-40', 'to=ontem', 'from=2001-06-04&to=2001-06-03',
  ]) {
    const r = await get(`/admin/audit-log?${q}`);
    assert.equal(r.status, 400, q);
    assert.ok(typeof r.body.error === 'string' && r.body.error.length > 0, q);
  }
});

test('somente leitura: nenhuma rota de escrita e o log não muda', async (t) => {
  if (!dbAvailable) return t.skip('banco indisponível');
  const countSql = `SELECT count(*)::int AS n FROM admin_audit_log WHERE actor_id = $1`;
  const before = (await pool.query(countSql, [adminId])).rows[0].n;
  const { rows: [any] } = await pool.query('SELECT id FROM admin_audit_log WHERE actor_id = $1 LIMIT 1', [adminId]);
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    for (const path of ['/admin/audit-log', `/admin/audit-log/${any.id}`]) {
      const res = await fetch(`${baseUrl}${path}`, {
        method, headers: { 'Content-Type': 'application/json', Cookie: adminCookie }, body: method === 'DELETE' ? undefined : '{}',
      });
      assert.equal(res.status, 404, `${method} ${path} não deve existir`);
    }
  }
  assert.equal((await pool.query(countSql, [adminId])).rows[0].n, before, 'nenhum registro foi criado, alterado ou removido');
});
