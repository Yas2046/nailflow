/**
 * Testes para DELETE /admin/professionals/:id (exclusão definitiva).
 *
 * Cobre:
 *   1. excluir profissional temporária sem WhatsApp
 *   2. dados relacionados (clientes, serviços, despesas, mensagens) são
 *      removidos -- e capturados no snapshot antes de serem removidos
 *   3. impedir exclusão da própria conta
 *   4. não bloquear quando NÃO é o último admin (ver nota abaixo sobre o
 *      cenário "é o último admin")
 *   5. rejeitar confirmação com nome do negócio incorreto
 *   6. profissional com wa_instance_name: Evolution é chamada (mock) e a
 *      exclusão prossegue quando a Evolution responde com sucesso
 *   7. se a Evolution falhar (mock), a operação aborta e a profissional
 *      NÃO é excluída (nem no banco, nem a instância fica "perdida")
 *   8. o snapshot gravado em disco não é exposto por nenhuma rota da
 *      aplicação, e tem permissões restritas (0600 arquivo, 0700 diretório)
 *
 * Nota sobre "impedir exclusão do último admin": tecnicamente, para chamar
 * este endpoint é preciso ser admin (requireAdmin). Se um alvo é realmente o
 * ÚNICO admin do sistema e o alvo é diferente de quem está chamando, então
 * quem chama seria um SEGUNDO admin -- contradição. Ou seja, o único jeito
 * real de tentar excluir "o último admin" é excluir a si mesmo, cenário já
 * coberto (e bloqueado antes, por um motivo diferente) pelo teste de
 * autoexclusão. Testar o branch "count <= 1" ponta-a-ponta exigiria reduzir
 * os admins reais do sistema a zero, o que este arquivo NUNCA faz (proibido
 * pela tarefa). A guarda em si foi mantida como defesa em profundidade e é
 * validada aqui só pelo caminho "não bloqueia quando há outros admins".
 *
 * Usa apenas profissionais temporárias criadas e removidas neste arquivo --
 * nunca lê, altera ou exclui nenhuma conta real. Todas as chamadas à
 * Evolution API são interceptadas por um mock de fetch; nenhuma chamada de
 * rede real para a Evolution acontece neste arquivo.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

process.env.NODE_ENV = 'test';

let server;
let baseUrl;
let dbAvailable = true;
let pool;

let adminId, adminCookie;
const createdIds = [];

const ADMIN_EMAIL = 'admin_delete_test@nailflow.com';
const ADMIN_PASSWORD = 'senha_teste_admin_delete';

const SNAPSHOT_DIR = process.env.DELETED_PROFESSIONAL_BACKUP_DIR || '/var/backups/nailflow/deleted-professionals';

// ── Mock da Evolution API: intercepta só chamadas a /instance/delete/<nome
//    marcado>; tudo o mais (login, chamadas ao próprio servidor de teste)
//    passa direto para o fetch original. ──
const originalFetch = global.fetch;
const evolutionBehavior = new Map(); // instanceName -> 'success' | 'fail' | '404'
const evolutionCalls = [];

before(async () => {
  ({ pool } = await import('../src/config/db.js'));
  try {
    await pool.query('SELECT 1');
  } catch {
    dbAvailable = false;
  }

  global.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : (input?.url ?? String(input));
    const match = url.match(/\/instance\/delete\/([^/?]+)/);
    if (match) {
      const instanceName = decodeURIComponent(match[1]);
      if (evolutionBehavior.has(instanceName)) {
        evolutionCalls.push(instanceName);
        const behavior = evolutionBehavior.get(instanceName);
        if (behavior === 'fail') {
          return Promise.resolve(new Response(JSON.stringify({ error: 'mock evolution failure' }), { status: 500 }));
        }
        if (behavior === '404') {
          return Promise.resolve(new Response(JSON.stringify({}), { status: 404 }));
        }
        return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }));
      }
    }
    return originalFetch(input, init);
  };

  const { default: app } = await import('../src/server.js');
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  if (!dbAvailable) return;

  const { default: bcrypt } = await import('bcryptjs');
  const adminHash = await bcrypt.hash(ADMIN_PASSWORD, 10);
  const { rows: adminRows } = await pool.query(
    `INSERT INTO professionals (name, email, password_hash, phone_whatsapp, business_name, slug, is_admin)
     VALUES ('Admin Delete Tester', $1, $2, '5531000000030', 'AdminDeleteStudio', 'teste-admin-delete', true)
     RETURNING id`,
    [ADMIN_EMAIL, adminHash]
  );
  adminId = adminRows[0].id;
  createdIds.push(adminId);

  const adminLogin = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });
  assert.equal(adminLogin.status, 200, 'login do admin deve retornar 200');
  adminCookie = adminLogin.headers.get('set-cookie');
});

after(async () => {
  global.fetch = originalFetch;
  if (dbAvailable) {
    // Limpeza best-effort de qualquer coisa que não tenha sido removida por
    // um teste (ex.: um assert que falhou no meio). Só atinge os IDs desta
    // execução, nunca contas reais.
    for (const id of createdIds) {
      await pool.query('DELETE FROM professionals WHERE id = $1', [id]).catch(() => {});
    }
  }
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
});

// ── Helpers ──────────────────────────────────────────────────────────────────

async function createTempProfessional({ businessName, waInstanceName = null, isAdmin = false } = {}) {
  const { default: bcrypt } = await import('bcryptjs');
  const suffix = Math.random().toString(36).slice(2, 10);
  const hash = await bcrypt.hash('senha_temp_' + suffix, 10);
  const { rows } = await pool.query(
    `INSERT INTO professionals (name, email, password_hash, phone_whatsapp, business_name, slug, wa_instance_name, is_admin)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, business_name`,
    [
      'Temp Delete Tester',
      `temp_delete_${suffix}@nailflow.com`,
      hash,
      `55319${suffix.slice(0, 8).padEnd(8, '0')}`,
      businessName ?? `Temp Delete Studio ${suffix}`,
      `temp-delete-${suffix}`,
      waInstanceName,
      isAdmin,
    ]
  );
  createdIds.push(rows[0].id);
  return rows[0];
}

async function seedRelatedData(professionalId) {
  const { rows: clientRows } = await pool.query(
    `INSERT INTO clients (professional_id, name, phone) VALUES ($1, 'Cliente Teste Delete', '5531000099001') RETURNING id`,
    [professionalId]
  );
  const clientId = clientRows[0].id;

  await pool.query(
    `INSERT INTO services (professional_id, name, price_cents, duration_minutes) VALUES ($1, 'Serviço Teste Delete', 5000, 40)`,
    [professionalId]
  );

  await pool.query(
    `INSERT INTO expenses (professional_id, description, amount_cents, expense_date) VALUES ($1, 'Despesa Teste Delete', 1000, now())`,
    [professionalId]
  );

  await pool.query(
    `INSERT INTO message_history (professional_id, client_id, phone, direction, content, sender)
     VALUES ($1, $2, '5531000099001', 'inbound', 'Mensagem de teste', 'client')`,
    [professionalId, clientId]
  );
}

async function del(id, body, cookie = adminCookie) {
  const res = await fetch(`${baseUrl}/admin/professionals/${id}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function professionalExists(id) {
  const { rows } = await pool.query('SELECT 1 FROM professionals WHERE id = $1', [id]);
  return rows.length > 0;
}

async function countRelated(table, professionalId) {
  const { rows } = await pool.query(`SELECT count(*)::int AS c FROM ${table} WHERE professional_id = $1`, [professionalId]);
  return rows[0].c;
}

async function findLatestSnapshot(professionalId) {
  const entries = await fs.readdir(SNAPSHOT_DIR).catch(() => []);
  const match = entries.filter((f) => f.startsWith(`professional_${professionalId}_`) && f.endsWith('.json'));
  if (match.length === 0) return null;
  match.sort();
  return path.join(SNAPSHOT_DIR, match[match.length - 1]);
}

// ── Testes ───────────────────────────────────────────────────────────────────

test('exclui profissional temporária sem WhatsApp e remove dados relacionados (com snapshot prévio)', async (t) => {
  if (!dbAvailable) { t.skip('banco não disponível'); return; }

  const target = await createTempProfessional({ businessName: 'Studio Delete Sem WhatsApp' });
  await seedRelatedData(target.id);

  assert.equal(await countRelated('clients', target.id), 1);
  assert.equal(await countRelated('services', target.id), 1);
  assert.equal(await countRelated('expenses', target.id), 1);
  assert.equal(await countRelated('message_history', target.id), 1);

  const res = await del(target.id, { businessNameConfirmation: target.business_name });
  assert.equal(res.status, 204, 'exclusão válida deve retornar 204');

  assert.equal(await professionalExists(target.id), false, 'profissional deve ter sido removida');
  assert.equal(await countRelated('clients', target.id), 0, 'clientes devem ter sido removidos em cascata');
  assert.equal(await countRelated('services', target.id), 0, 'serviços devem ter sido removidos em cascata');
  assert.equal(await countRelated('expenses', target.id), 0, 'despesas devem ter sido removidas em cascata');
  assert.equal(await countRelated('message_history', target.id), 0, 'mensagens devem ter sido removidas em cascata');

  // O snapshot foi gravado ANTES da exclusão e deve conter os dados que já foram apagados.
  const snapshotPath = await findLatestSnapshot(target.id);
  assert.ok(snapshotPath, 'snapshot deve ter sido gravado em disco');
  const snapshot = JSON.parse(await fs.readFile(snapshotPath, 'utf-8'));
  assert.equal(snapshot.professional.id, target.id);
  assert.equal(snapshot.professional.password_hash, undefined, 'snapshot não deve conter password_hash');
  assert.equal(snapshot.clients.length, 1);
  assert.equal(snapshot.services.length, 1);
  assert.equal(snapshot.expenses.length, 1);
  assert.equal(snapshot.message_history.length, 1);
});

test('impede excluir a própria conta', async (t) => {
  if (!dbAvailable) { t.skip('banco não disponível'); return; }

  const res = await del(adminId, { businessNameConfirmation: 'AdminDeleteStudio' });
  assert.equal(res.status, 400, 'autoexclusão deve ser rejeitada com 400');
  assert.equal(await professionalExists(adminId), true, 'conta do admin não deve ter sido removida');
});

test('não bloqueia a exclusão quando existem outros admins (não é o último)', async (t) => {
  if (!dbAvailable) { t.skip('banco não disponível'); return; }

  const targetAdmin = await createTempProfessional({ businessName: 'Studio Admin Alvo', isAdmin: true });

  const res = await del(targetAdmin.id, { businessNameConfirmation: targetAdmin.business_name });
  assert.equal(res.status, 204, 'excluir um admin que não é o último deve funcionar normalmente');
  assert.equal(await professionalExists(targetAdmin.id), false);
});

test('rejeita confirmação com nome do negócio incorreto', async (t) => {
  if (!dbAvailable) { t.skip('banco não disponível'); return; }

  const target = await createTempProfessional({ businessName: 'Studio Nome Certo' });

  const res = await del(target.id, { businessNameConfirmation: 'Nome Errado Digitado' });
  assert.equal(res.status, 400, 'confirmação incorreta deve ser rejeitada com 400');
  assert.equal(await professionalExists(target.id), true, 'profissional não deve ter sido removida');
});

test('profissional com wa_instance_name: Evolution é chamada e, com sucesso (mock), a exclusão prossegue', async (t) => {
  if (!dbAvailable) { t.skip('banco não disponível'); return; }

  const instanceName = `teste-delete-instance-${Math.random().toString(36).slice(2, 8)}`;
  evolutionBehavior.set(instanceName, 'success');

  const target = await createTempProfessional({ businessName: 'Studio Com WhatsApp OK', waInstanceName: instanceName });

  const res = await del(target.id, { businessNameConfirmation: target.business_name });
  assert.equal(res.status, 204);
  assert.equal(await professionalExists(target.id), false);
  assert.ok(evolutionCalls.includes(instanceName), 'a exclusão na Evolution (mock) deve ter sido chamada para essa instância');
});

test('se a exclusão na Evolution falhar (mock), a operação aborta e a profissional NÃO é excluída', async (t) => {
  if (!dbAvailable) { t.skip('banco não disponível'); return; }

  const instanceName = `teste-delete-instance-fail-${Math.random().toString(36).slice(2, 8)}`;
  evolutionBehavior.set(instanceName, 'fail');

  const target = await createTempProfessional({ businessName: 'Studio Com WhatsApp Falha', waInstanceName: instanceName });
  await seedRelatedData(target.id);

  const res = await del(target.id, { businessNameConfirmation: target.business_name });
  assert.equal(res.status, 502, 'falha na Evolution deve abortar com 502');

  assert.equal(await professionalExists(target.id), true, 'profissional NÃO deve ter sido excluída');
  assert.equal(await countRelated('clients', target.id), 1, 'dados relacionados devem continuar intactos');
  assert.ok(evolutionCalls.includes(instanceName), 'a tentativa de exclusão na Evolution deve ter sido chamada');
});

test('snapshot não é exposto pela aplicação e tem permissões restritas', async (t) => {
  if (!dbAvailable) { t.skip('banco não disponível'); return; }

  const target = await createTempProfessional({ businessName: 'Studio Permissoes Snapshot' });
  const res = await del(target.id, { businessNameConfirmation: target.business_name });
  assert.equal(res.status, 204);

  const snapshotPath = await findLatestSnapshot(target.id);
  assert.ok(snapshotPath, 'snapshot deve existir em disco');

  const fileStat = await fs.stat(snapshotPath);
  assert.equal(fileStat.mode & 0o777, 0o600, 'arquivo de snapshot deve ter permissão 600');

  const dirStat = await fs.stat(SNAPSHOT_DIR);
  assert.equal(dirStat.mode & 0o777, 0o700, 'diretório de snapshots deve ter permissão 700');

  // Nenhuma rota do backend expõe esse diretório: nem /var/backups nem o
  // caminho do arquivo são acessíveis via HTTP (nenhuma rota foi criada
  // referenciando SNAPSHOT_DIR -- confirmado também por grep no código-fonte).
  const relativeName = path.basename(snapshotPath);
  const httpAttempt = await fetch(`${baseUrl}/${relativeName}`);
  assert.notEqual(httpAttempt.status, 200, 'o arquivo de snapshot não deve ser servido pela aplicação');
});
