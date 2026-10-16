// Carga inicial da FAQ da Central de Suporte e sua reversão (backend/db/migrations/_ops/support_faq_initial*.sql).
//
// 1) Testes SEM banco (rodam sempre): o SQL é fiel ao documento aprovado (docs/SUPORTE_FAQ_INICIAL.md): 12 artigos, mesmos
//    títulos, textos e categorias, na mesma ordem; a carga só insere; a reversão só apaga os 12 ids fixos.
// 2) Testes COM banco (psql real, banco DESCARTÁVEL confirmado por tests/helpers/supportTestDb.js; nunca rodam sem
//    SUPPORT_API_TEST_DB_URL; uma suíte de banco por vez, --test-concurrency=1): idempotência, preservação de conteúdo
//    preexistente (artigos de outras origens, chamados e mensagens), pulo por título repetido, status rascunho, parâmetro
//    inválido, proteção contra edição e reversão.
// Os scripts são entregues ao psql por entrada padrão, como em produção (o usuário postgres não lê /root).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dbWanted, skip, startHarness } from './helpers/supportHarness.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LOAD_FILE = path.resolve(HERE, '../db/migrations/_ops/support_faq_initial.sql');
const REVERT_FILE = path.resolve(HERE, '../db/migrations/_ops/support_faq_initial_revert.sql');
const DOC_FILE = path.resolve(HERE, '../../docs/SUPORTE_FAQ_INICIAL.md');
const LOAD_SQL = fs.readFileSync(LOAD_FILE, 'utf8');
const REVERT_SQL = fs.readFileSync(REVERT_FILE, 'utf8');
const CATEGORY_SLUGS = ['agenda', 'clientes', 'servicos_config', 'perfil_acesso', 'financeiro', 'tecnico'];
const opts = { skip, timeout: 180_000 };

// Leitura independente do documento (não reaproveita o gerador).
function parseDoc() {
  const lines = fs.readFileSync(DOC_FILE, 'utf8').split('\n');
  const out = [];
  let slug = null;
  for (let i = 0; i < lines.length; i++) {
    const c = lines[i].match(/^## .+ \(`([a-z_]+)`\)\s*$/);
    if (c) { slug = c[1]; continue; }
    const a = lines[i].match(/^### (\d+)\. (.+?)\s*$/);
    if (!a) continue;
    const open = lines.findIndex((l, k) => k > i && l.startsWith('```text'));
    const close = lines.findIndex((l, k) => k > open && l === '```');
    out.push({ n: Number(a[1]), slug, title: a[2], body: lines.slice(open + 1, close).join('\n') });
    i = close;
  }
  return out;
}
const DOC = parseDoc();

// Linhas "(n, 'uuid'::uuid, 'slug', $faq$título$faq$, $faq$texto$faq$)" da carga, e ids/md5 da reversão.
function loadRowsFromSql() {
  const re = /\((\d+), '([0-9a-f-]{36})'::uuid, '([a-z_]+)', \$faq\$([\s\S]*?)\$faq\$, \$faq\$([\s\S]*?)\$faq\$\)/g;
  return [...LOAD_SQL.matchAll(re)].map((m) => ({ n: Number(m[1]), id: m[2], slug: m[3], title: m[4], body: m[5] }));
}
const SQL_ROWS = loadRowsFromSql();
const BATCH_IDS = SQL_ROWS.map((r) => r.id);
const executable = (sql) => sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

// ── 1) fidelidade e segurança do SQL (sem banco) ─────────────────────────────

test('o documento aprovado tem 12 artigos, nas 6 categorias existentes, dentro dos limites do esquema', () => {
  assert.equal(DOC.length, 12);
  assert.deepEqual(DOC.map((a) => a.n), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.deepEqual([...new Set(DOC.map((a) => a.slug))].sort(), [...CATEGORY_SLUGS].sort());
  for (const a of DOC) {
    assert.ok(a.title.length >= 3 && a.title.length <= 120, `título do artigo ${a.n}`);
    assert.ok(a.body.length >= 1 && a.body.length <= 8000 && /\S/.test(a.body), `texto do artigo ${a.n}`);
  }
  assert.equal(new Set(DOC.map((a) => `${a.slug}|${a.title}`)).size, 12, 'títulos repetidos na mesma categoria');
});

test('a carga contém exatamente os 12 artigos do documento: mesmo título, texto, categoria e ordem', () => {
  assert.equal(SQL_ROWS.length, 12);
  for (const [i, a] of DOC.entries()) {
    const r = SQL_ROWS[i];
    assert.equal(r.n, a.n, `ordem do artigo ${a.n}`);
    assert.equal(r.slug, a.slug, `categoria do artigo ${a.n}`);
    assert.equal(r.title, a.title, `título do artigo ${a.n}`);
    assert.equal(r.body, a.body, `texto do artigo ${a.n}`);
  }
  assert.equal(new Set(BATCH_IDS).size, 12, 'ids do lote repetidos');
  assert.ok(BATCH_IDS.every((id) => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)), 'id que não é UUID v4');
});

test('a reversão cita os mesmos 12 ids e o hash de cada título+texto original', () => {
  const rows = [...REVERT_SQL.matchAll(/\('([0-9a-f-]{36})'::uuid, '([a-z_]+)', '([0-9a-f]{32})'\)/g)].map((m) => ({ id: m[1], slug: m[2], md5: m[3] }));
  assert.equal(rows.length, 12);
  for (const [i, a] of DOC.entries()) {
    assert.equal(rows[i].id, SQL_ROWS[i].id, `id do artigo ${a.n}`);
    assert.equal(rows[i].slug, a.slug);
    assert.equal(rows[i].md5, crypto.createHash('md5').update(`${a.title}\n${a.body}`, 'utf8').digest('hex'), `hash do artigo ${a.n}`);
  }
});

test('a carga só insere (nenhum DELETE, UPDATE, TRUNCATE, ALTER ou DROP de dados) e usa uma única transação com lock_timeout', () => {
  const sql = executable(LOAD_SQL).replace(/ON COMMIT DROP/g, '');
  assert.ok(!/\b(DELETE|UPDATE|TRUNCATE|ALTER|DROP|GRANT|REVOKE)\b/i.test(sql.replace(/\$faq\$[\s\S]*?\$faq\$/g, '')), 'comando que altera o que já existe');
  assert.equal((sql.match(/\bINSERT INTO support_faq_articles\b/g) ?? []).length, 1, 'um único INSERT em artigos');
  assert.equal((sql.match(/^BEGIN;$/gm) ?? []).length, 1);
  assert.equal((sql.match(/^COMMIT;$/gm) ?? []).length, 1);
  assert.match(sql, /SET LOCAL lock_timeout/);
  assert.match(sql, /ON CONFLICT \(id\) DO NOTHING/);
  assert.ok(!/admin_audit_log|support_tickets|support_messages|support_ticket_events|professionals/.test(sql.replace(/\$faq\$[\s\S]*?\$faq\$/g, '')), 'a carga não pode tocar em outras tabelas');
});

test('a reversão tem um único DELETE, restrito aos ids do lote, e nenhum outro comando destrutivo', () => {
  const sql = executable(REVERT_SQL).replace(/ON COMMIT DROP/g, '');
  const deletes = sql.match(/\bDELETE\b[\s\S]*?(?:RETURNING 1|;)/gi) ?? [];
  assert.equal(deletes.length, 1);
  assert.match(deletes[0].replace(/\s+/g, ' '), /^DELETE FROM support_faq_articles WHERE id IN \(SELECT id FROM nf_faq_lote\)/);
  assert.ok(!/\b(TRUNCATE|UPDATE|ALTER|DROP|GRANT|REVOKE|INSERT INTO support_faq_articles)\b/i.test(sql), 'comando destrutivo fora do DELETE do lote');
  assert.ok(!/support_tickets|support_messages|support_ticket_events|admin_audit_log|professionals/.test(sql), 'a reversão não pode tocar em outras tabelas');
  assert.match(sql, /forcar_editados/);
});

// ── 2) execução real (banco descartável) ─────────────────────────────────────

let h;
let owner;
let tracked = []; // ids de artigos criados pelo próprio teste (limpeza)

before(async () => {
  if (!dbWanted) return;
  h = await startHarness();
  owner = await h.newProf();
  await h.pool.query('DELETE FROM support_faq_articles WHERE id = ANY($1::uuid[])', [BATCH_IDS]); // só os ids do lote
});
after(async () => {
  if (!h) return;
  await h.pool.query('DELETE FROM support_faq_articles WHERE id = ANY($1::uuid[]) OR id = ANY($2::uuid[])', [BATCH_IDS, tracked]);
  await h.stop();
});

function psql(file, vars = {}) {
  const args = [process.env.SUPPORT_API_TEST_DB_URL, '-X', '-v', 'ON_ERROR_STOP=1'];
  for (const [k, v] of Object.entries(vars)) args.push('-v', `${k}=${v}`);
  const r = spawnSync('psql', args, { input: fs.readFileSync(file, 'utf8'), encoding: 'utf8' });
  return { status: r.status, out: `${r.stdout}\n${r.stderr}` };
}
const num = (out, col) => Number(out.match(new RegExp(`${col}\\s*\\n-+\\n\\s*(\\d+)`))?.[1]);
const batchRows = async () => (await h.pool.query('SELECT * FROM support_faq_articles WHERE id = ANY($1::uuid[]) ORDER BY category_slug, position', [BATCH_IDS])).rows;
const countAll = async () => (await h.pool.query('SELECT count(*)::int AS n FROM support_faq_articles')).rows[0].n;
const auditCount = async () => (await h.pool.query('SELECT count(*)::int AS n FROM admin_audit_log')).rows[0].n;
async function addArticle(slug, title, body, position) {
  const { rows } = await h.pool.query(
    `INSERT INTO support_faq_articles (category_slug, title, body, position, status, published_at)
     VALUES ($1, $2, $3, $4, 'publicado', now()) RETURNING id`, [slug, title, body, position]);
  tracked.push(rows[0].id);
  return rows[0].id;
}

test('carga: insere os 12 do documento com o esquema real, preserva o que já existe e pula título repetido', opts, async () => {
  const outro = await addArticle('agenda', 'Artigo criado pela tela do ADM', 'Texto de outra origem.', 1);
  const dup = DOC.find((a) => a.slug === 'clientes');            // mesmo título e categoria de um artigo do lote
  const dupId = await addArticle(dup.slug, dup.title, 'Texto diferente, de outra origem.', 7);
  const ticket = await h.seedTicket(owner, { subject: 'Chamado preexistente' });
  await h.profMessage(ticket.id, owner.id, 'Mensagem preexistente');
  const antes = { artigos: await countAll(), audit: await auditCount() };
  const maxAgenda = (await h.pool.query(`SELECT COALESCE(max(position), 0)::int AS mx FROM support_faq_articles WHERE category_slug = 'agenda'`)).rows[0].mx;

  const r = psql(LOAD_FILE);
  assert.equal(r.status, 0, r.out);
  assert.equal(num(r.out, 'artigos_inseridos'), 11, `esperava 11 inseridos (12 menos 1 título repetido)\n${r.out}`);

  const rows = await batchRows();
  assert.equal(rows.length, 11);
  const byId = new Map(rows.map((x) => [x.id, x]));
  for (const [i, a] of DOC.entries()) {
    const row = byId.get(SQL_ROWS[i].id);
    if (a.slug === dup.slug && a.title === dup.title) { assert.equal(row, undefined, 'o item de título repetido deveria ter sido pulado'); continue; }
    assert.ok(row, `artigo ${a.n} ausente`);
    assert.equal(row.title, a.title); assert.equal(row.body, a.body); assert.equal(row.category_slug, a.slug);
    assert.equal(row.status, 'publicado'); assert.ok(row.published_at);
    assert.equal(row.created_by, null); assert.equal(row.updated_by, null);
  }
  // posições: depois do maior position já existente fora do lote, sem repetir dentro da categoria
  const agenda = rows.filter((x) => x.category_slug === 'agenda').map((x) => x.position).sort((a, b) => a - b);
  assert.deepEqual(agenda, agenda.map((_, i) => maxAgenda + 1 + i), 'a categoria agenda deveria continuar depois do maior position que já existia');
  assert.equal(agenda.length, 4);
  // nada fora do lote foi tocado
  const ficou = (await h.pool.query('SELECT id, title, body, position FROM support_faq_articles WHERE id = ANY($1::uuid[])', [[outro, dupId]])).rows;
  assert.equal(ficou.length, 2);
  assert.equal(ficou.find((x) => x.id === outro).body, 'Texto de outra origem.');
  assert.equal(ficou.find((x) => x.id === dupId).body, 'Texto diferente, de outra origem.');
  assert.equal((await h.pool.query('SELECT 1 FROM support_tickets WHERE id = $1', [ticket.id])).rowCount, 1);
  assert.equal((await h.pool.query('SELECT count(*)::int AS n FROM support_messages WHERE ticket_id = $1', [ticket.id])).rows[0].n, 1);
  assert.equal(await auditCount(), antes.audit, 'a carga não pode gravar na auditoria');
  assert.equal(await countAll(), antes.artigos + 11);
});

test('carga idempotente: rodar de novo não duplica nem altera nada', opts, async () => {
  const antes = (await h.pool.query('SELECT id, updated_at FROM support_faq_articles ORDER BY id')).rows;
  const r = psql(LOAD_FILE);
  assert.equal(r.status, 0, r.out);
  assert.equal(num(r.out, 'artigos_inseridos'), 0);
  const depois = (await h.pool.query('SELECT id, updated_at FROM support_faq_articles ORDER BY id')).rows;
  assert.deepEqual(depois, antes, 'nenhuma linha foi inserida nem alterada na segunda execução');
});

test('reversão: apaga só os do lote e preserva artigos de outras origens, chamados e mensagens; segunda execução não apaga nada', opts, async () => {
  const outros = (await h.pool.query('SELECT id, title, body FROM support_faq_articles WHERE id <> ALL($1::uuid[]) ORDER BY id', [BATCH_IDS])).rows;
  const tickets = (await h.pool.query('SELECT count(*)::int AS n FROM support_tickets')).rows[0].n;
  const msgs = (await h.pool.query('SELECT count(*)::int AS n FROM support_messages')).rows[0].n;
  assert.ok(outros.length >= 2, 'pré-condição: há artigos de outras origens');

  const r = psql(REVERT_FILE);
  assert.equal(r.status, 0, r.out);
  assert.equal(num(r.out, 'artigos_apagados'), 11);
  assert.equal((await batchRows()).length, 0);
  assert.deepEqual((await h.pool.query('SELECT id, title, body FROM support_faq_articles WHERE id <> ALL($1::uuid[]) ORDER BY id', [BATCH_IDS])).rows, outros, 'artigos de outras origens foram alterados');
  assert.equal((await h.pool.query('SELECT count(*)::int AS n FROM support_tickets')).rows[0].n, tickets);
  assert.equal((await h.pool.query('SELECT count(*)::int AS n FROM support_messages')).rows[0].n, msgs);

  const again = psql(REVERT_FILE);
  assert.equal(again.status, 0, again.out);
  assert.equal(num(again.out, 'artigos_apagados'), 0);
});

test('depois de remover o artigo repetido, a carga de novo traz os 12 completos (ids fixos)', opts, async () => {
  await h.pool.query('DELETE FROM support_faq_articles WHERE id = ANY($1::uuid[])', [tracked]); // só os criados por este teste
  tracked = [];
  const r = psql(LOAD_FILE);
  assert.equal(r.status, 0, r.out);
  assert.equal(num(r.out, 'artigos_inseridos'), 12);
  assert.deepEqual((await batchRows()).map((x) => x.id).sort(), [...BATCH_IDS].sort());
  assert.equal(psql(REVERT_FILE).status, 0);
  assert.equal((await batchRows()).length, 0);
});

test('status rascunho: entra sem published_at; valor inválido aborta sem inserir nada', opts, async () => {
  const bad = psql(LOAD_FILE, { artigo_status: 'qualquer' });
  assert.notEqual(bad.status, 0);
  assert.match(bad.out, /artigo_status deve ser publicado ou rascunho/);
  assert.equal((await batchRows()).length, 0, 'valor inválido não pode inserir');

  const ok = psql(LOAD_FILE, { artigo_status: 'rascunho' });
  assert.equal(ok.status, 0, ok.out);
  const rows = await batchRows();
  assert.equal(rows.length, 12);
  assert.ok(rows.every((x) => x.status === 'rascunho' && x.published_at === null));
  assert.equal(psql(REVERT_FILE).status, 0);
});

test('proteção da reversão: artigo editado depois da carga bloqueia a remoção; posição e publicação não contam como edição', opts, async () => {
  assert.equal(psql(LOAD_FILE).status, 0);
  // mudanças que NÃO são edição de conteúdo: reordenar e despublicar/publicar
  await h.pool.query(`UPDATE support_faq_articles SET position = position + 10 WHERE id = $1`, [BATCH_IDS[0]]);
  await h.pool.query(`UPDATE support_faq_articles SET status = 'rascunho', published_at = NULL WHERE id = $1`, [BATCH_IDS[1]]);
  // edição de conteúdo pela tela
  await h.pool.query(`UPDATE support_faq_articles SET body = body || ' (editado)' WHERE id = $1`, [BATCH_IDS[2]]);

  const blocked = psql(REVERT_FILE);
  assert.notEqual(blocked.status, 0, 'a reversão deveria abortar');
  assert.match(blocked.out, /1 artigo\(s\) do lote foram editados depois da carga; NADA foi apagado/);
  assert.equal((await batchRows()).length, 12, 'nada pode ter sido apagado');

  const invalid = psql(REVERT_FILE, { forcar_editados: 'talvez' });
  assert.notEqual(invalid.status, 0);
  assert.equal((await batchRows()).length, 12);

  const forced = psql(REVERT_FILE, { forcar_editados: 'on' });
  assert.equal(forced.status, 0, forced.out);
  assert.equal(num(forced.out, 'artigos_apagados'), 12);
  assert.equal((await batchRows()).length, 0);
});

test('reordenar e publicar/despublicar sozinhos não impedem a reversão', opts, async () => {
  assert.equal(psql(LOAD_FILE).status, 0);
  await h.pool.query(`UPDATE support_faq_articles SET position = position + 10 WHERE id = $1`, [BATCH_IDS[0]]);
  await h.pool.query(`UPDATE support_faq_articles SET status = 'rascunho', published_at = NULL WHERE id = $1`, [BATCH_IDS[1]]);
  const r = psql(REVERT_FILE);
  assert.equal(r.status, 0, r.out);
  assert.equal(num(r.out, 'artigos_apagados'), 12);
});
