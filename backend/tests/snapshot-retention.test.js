// Retenção dos snapshots de exclusão de conta: só arquivos com o nome exato gerado pela exclusão, por idade (mtime),
// com simulação por padrão no script, suspensão por .retention-hold e nenhuma remoção de links, subdiretórios ou
// outros nomes. Sem banco e sem tocar em /var/backups: usa diretórios temporários criados e removidos aqui.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pruneSnapshots, SNAPSHOT_RETENTION_DAYS, SNAPSHOT_HOLD_FILE } from '../src/utils/snapshotRetention.js';

const DAY = 24 * 60 * 60 * 1000;
const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../scripts/prune-deleted-snapshots.js');
const CONTROLLER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/controllers/adminController.js');
let root;
const NOW = Date.parse('2026-10-13T12:00:00Z');

const snapName = (when) => `professional_${randomUUID()}_${new Date(when).toISOString().replace(/[:.]/g, '-')}.json`;

async function mkdir() { return fs.mkdtemp(path.join(root, 'd-')); }
async function put(dir, name, ageDays, { now = NOW } = {}) {
  const f = path.join(dir, name);
  await fs.writeFile(f, '{}', { mode: 0o600 });
  const t = new Date(now - ageDays * DAY);
  await fs.utimes(f, t, t);
  return f;
}
const ls = async (dir) => (await fs.readdir(dir)).sort();

before(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), 'nf-snapret-')); });
after(async () => { await fs.rm(root, { recursive: true, force: true }); });

test('a retenção padrão é de 30 dias', () => {
  assert.equal(SNAPSHOT_RETENTION_DAYS, 30);
});

test('29 dias fica, 31 dias é candidato e remove só com apply (a simulação não remove nada)', async () => {
  const dir = await mkdir();
  const novo = snapName(NOW - 29 * DAY); const velho = snapName(NOW - 31 * DAY);
  await put(dir, novo, 29); await put(dir, velho, 31);

  const dry = await pruneSnapshots(dir, { now: NOW });
  assert.deepEqual(dry.candidates, [velho]); assert.deepEqual(dry.removed, []); assert.equal(dry.kept, 1);
  assert.deepEqual(await ls(dir), [novo, velho].sort(), 'a simulação não pode remover');

  const done = await pruneSnapshots(dir, { now: NOW, apply: true });
  assert.deepEqual(done.removed, [velho]);
  assert.deepEqual(await ls(dir), [novo]);
});

test('exatamente 30 dias ainda fica (o corte é estritamente anterior)', async () => {
  const dir = await mkdir();
  const n = snapName(NOW - 30 * DAY);
  await put(dir, n, 30);
  const r = await pruneSnapshots(dir, { now: NOW, apply: true });
  assert.deepEqual(r.removed, []); assert.equal(r.kept, 1);
});

test('só o padrão exato de nome é tocado: outros arquivos, links e subdiretórios antigos ficam', async () => {
  const dir = await mkdir();
  const alvo = path.join(dir, 'alvo-fora.json');
  await put(dir, 'alvo-fora.json', 400);
  await put(dir, 'professional_nao-e-uuid_2026-01-01T00-00-00-000Z.json', 400);
  await put(dir, `${snapName(NOW - 400 * DAY)}.bak`, 400);
  await put(dir, 'README.txt', 400);
  await fs.mkdir(path.join(dir, snapName(NOW - 400 * DAY)));                       // diretório com nome válido
  const link = snapName(NOW - 400 * DAY);
  await fs.symlink(alvo, path.join(dir, link));                                     // link com nome válido
  const antes = await ls(dir);
  const r = await pruneSnapshots(dir, { now: NOW, apply: true });
  assert.deepEqual(r.candidates, []); assert.deepEqual(r.removed, []);
  assert.deepEqual(await ls(dir), antes, 'nada além dos snapshots regulares pode ser removido');
  assert.ok((await fs.lstat(path.join(dir, link))).isSymbolicLink());
  await fs.access(alvo);
});

test('.retention-hold protege nomes listados; comentários e linhas vazias são ignorados', async () => {
  const dir = await mkdir();
  const a = snapName(NOW - 60 * DAY); const b = snapName(NOW - 61 * DAY); const c = snapName(NOW - 62 * DAY);
  await put(dir, a, 60); await put(dir, b, 61); await put(dir, c, 62);
  await fs.writeFile(path.join(dir, SNAPSHOT_HOLD_FILE), `# verificar a origem\n\n  ${a}  \n${b}\r\n`);
  const r = await pruneSnapshots(dir, { now: NOW, apply: true });
  assert.deepEqual(r.removed, [c]);
  assert.deepEqual(r.held.sort(), [a, b].sort());
  assert.deepEqual(await ls(dir), [a, b, SNAPSHOT_HOLD_FILE].sort());
});

test('o módulo nunca cria nem altera o .retention-hold e valida days', async () => {
  const dir = await mkdir();
  await pruneSnapshots(dir, { now: NOW, apply: true });
  assert.deepEqual(await ls(dir), []);
  for (const days of [0, -1, NaN, 'x']) await assert.rejects(pruneSnapshots(dir, { days }), /days/);
  assert.deepEqual(await pruneSnapshots('/caminho/que/nao/existe', { now: NOW, apply: true }), { candidates: [], removed: [], held: [], kept: 0 });
});

test('script: simulação por padrão (nada removido), --apply remove, nomes só com --list, --days inválido sai com 2', async () => {
  const dir = await mkdir();
  const velho = snapName(Date.now() - 45 * DAY); const novo = snapName(Date.now() - 2 * DAY);
  await put(dir, velho, 45, { now: Date.now() }); await put(dir, novo, 2, { now: Date.now() });
  const run = (...args) => spawnSync(process.execPath, [SCRIPT, '--dir', dir, ...args], { encoding: 'utf8' });

  let r = run();
  assert.equal(r.status, 0); assert.match(r.stdout, /SIMULAÇÃO/); assert.match(r.stdout, /vencidos: 1/);
  assert.ok(!r.stdout.includes('professional_'), 'sem --list o script não imprime nomes (têm o id da conta)');
  assert.deepEqual(await ls(dir), [novo, velho].sort());

  r = run('--list');
  assert.ok(r.stdout.includes(velho)); assert.ok(!r.stdout.includes(novo));

  r = run('--days', '0'); assert.equal(r.status, 2);
  r = run('--days', '1.5'); assert.equal(r.status, 2);
  assert.deepEqual(await ls(dir), [novo, velho].sort());

  r = run('--apply');
  assert.equal(r.status, 0); assert.match(r.stdout, /APLICADO/); assert.match(r.stdout, /removidos: 1/);
  assert.deepEqual(await ls(dir), [novo]);
});

test('a exclusão de conta usa o módulo de retenção (sem a poda manual de 90 dias)', async () => {
  const src = await fs.readFile(CONTROLLER, 'utf8');
  assert.match(src, /import \{ pruneSnapshots \} from '..\/utils\/snapshotRetention\.js'/);
  assert.match(src, /pruneSnapshots\(SNAPSHOT_DIR, \{ apply: true \}\)/);
  assert.ok(!/SNAPSHOT_RETENTION_DAYS\s*=\s*90/.test(src), 'a constante antiga de 90 dias voltou');
});

test('o comando de proteção documentado em ops/README.md gera um .retention-hold que protege tudo o que existia', async () => {
  const readme = await fs.readFile(path.resolve(path.dirname(SCRIPT), '../../ops/README.md'), 'utf8');
  const block = /```bash\n(\( umask 077;[\s\S]*?\.retention-hold \))\n```/.exec(readme);
  assert.ok(block, 'o comando de geração do .retention-hold não está documentado em ops/README.md');
  const dir = await mkdir();
  const existentes = [snapName(NOW - 40 * DAY), snapName(NOW - 80 * DAY), snapName(NOW - 5 * DAY)];
  for (const [i, n] of existentes.entries()) await put(dir, n, [40, 80, 5][i]);
  await put(dir, 'README.txt', 400);                                   // fora do padrão: não deve entrar na lista
  const cmd = block[1].replace('/var/backups/nailflow/deleted-professionals', dir);
  const r = spawnSync('sh', ['-c', cmd], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);

  const hold = (await fs.readFile(path.join(dir, SNAPSHOT_HOLD_FILE), 'utf8')).split('\n').filter(Boolean).sort();
  assert.deepEqual(hold, [...existentes].sort(), 'o hold deve listar exatamente os snapshots existentes');
  assert.equal((await fs.stat(path.join(dir, SNAPSHOT_HOLD_FILE))).mode & 0o777, 0o600, 'o hold deve nascer 600');

  // com o hold, nada que existia é removido, por mais velho que seja; um snapshot novo e antigo depois segue a retenção
  const antes = await ls(dir);
  let res = await pruneSnapshots(dir, { now: NOW + 365 * DAY, apply: true });
  assert.deepEqual(res.removed, []); assert.equal(res.held.length, 3);
  assert.deepEqual(await ls(dir), antes);
  const novo = snapName(NOW); await put(dir, novo, 0);
  res = await pruneSnapshots(dir, { now: NOW + 31 * DAY, apply: true });
  assert.deepEqual(res.removed, [novo], 'um snapshot que não está no hold deve seguir a retenção de 30 dias');
});
