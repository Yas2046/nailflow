/**
 * Testes para GET /public/:slug/services.
 *
 * Cobre:
 *   1. Slug válido retorna apenas os serviços ativos e visíveis no WhatsApp
 *      daquela profissional (id, nome, preço, duração).
 *   2. Serviço inativo não aparece.
 *   3. Serviço com available_on_whatsapp=false não aparece.
 *   4. Serviço de outra profissional nunca aparece (isolamento por slug).
 *   5. Slug inexistente retorna 404 genérico.
 *
 * Usa profissionais e serviços temporários criados e removidos neste próprio
 * arquivo — nunca toca contas reais de produção.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';

let server;
let baseUrl;
let dbAvailable = true;

let profAId, profBId;
const SLUG_A = 'teste-public-services-a';
const SLUG_B = 'teste-public-services-b';

let svcAtivoWhatsapp, svcInativo, svcSomenteAgenda, svcOutraProfissional;

before(async () => {
  const { pool } = await import('../src/config/db.js');
  try {
    await pool.query('SELECT 1');
  } catch {
    dbAvailable = false;
  }

  const { default: app } = await import('../src/server.js');
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  if (!dbAvailable) return;

  const { default: bcrypt } = await import('bcryptjs');
  const hash = await bcrypt.hash('senha_teste_public_services', 10);

  const { rows: profA } = await pool.query(
    `INSERT INTO professionals (name, email, password_hash, phone_whatsapp, business_name, slug)
     VALUES ('Profissional A Teste', 'prof-a-public-services@nailflow.com', $1, '5531000000020', 'StudioA', $2)
     RETURNING id`,
    [hash, SLUG_A]
  );
  profAId = profA[0].id;

  const { rows: profB } = await pool.query(
    `INSERT INTO professionals (name, email, password_hash, phone_whatsapp, business_name, slug)
     VALUES ('Profissional B Teste', 'prof-b-public-services@nailflow.com', $1, '5531000000021', 'StudioB', $2)
     RETURNING id`,
    [hash, SLUG_B]
  );
  profBId = profB[0].id;

  const insertService = async (professionalId, { name, active, availableOnWhatsapp }) => {
    const { rows } = await pool.query(
      `INSERT INTO services (professional_id, name, price_cents, duration_minutes, active, available_on_whatsapp)
       VALUES ($1, $2, 5000, 40, $3, $4) RETURNING id`,
      [professionalId, name, active, availableOnWhatsapp]
    );
    return rows[0].id;
  };

  svcAtivoWhatsapp = await insertService(profAId, { name: 'Manicure (pública)', active: true, availableOnWhatsapp: true });
  svcInativo = await insertService(profAId, { name: 'Serviço Inativo', active: false, availableOnWhatsapp: true });
  svcSomenteAgenda = await insertService(profAId, { name: 'Somente Agenda', active: true, availableOnWhatsapp: false });
  svcOutraProfissional = await insertService(profBId, { name: 'Serviço da Profissional B', active: true, availableOnWhatsapp: true });
});

after(async () => {
  const { pool } = await import('../src/config/db.js');
  if (dbAvailable) {
    if (profAId) await pool.query('DELETE FROM professionals WHERE id = $1', [profAId]);
    if (profBId) await pool.query('DELETE FROM professionals WHERE id = $1', [profBId]);
  }
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
});

test('slug válido retorna apenas os serviços públicos daquela profissional', async (t) => {
  if (!dbAvailable) { t.skip('DATABASE_URL não está acessível.'); return; }

  const res = await fetch(`${baseUrl}/public/${SLUG_A}/services`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(Array.isArray(body));

  const ids = body.map((s) => s.id);
  assert.ok(ids.includes(svcAtivoWhatsapp), 'serviço ativo e visível no WhatsApp deveria aparecer');
  assert.ok(!ids.includes(svcInativo), 'serviço inativo não deveria aparecer');
  assert.ok(!ids.includes(svcSomenteAgenda), 'serviço com available_on_whatsapp=false não deveria aparecer');
  assert.ok(!ids.includes(svcOutraProfissional), 'serviço de outra profissional não deveria aparecer');

  const found = body.find((s) => s.id === svcAtivoWhatsapp);
  assert.equal(found.name, 'Manicure (pública)');
  assert.equal(found.priceCents, 5000);
  assert.equal(found.durationMinutes, 40);
  assert.ok(!('professional_id' in found) && !('professionalId' in found), 'não deve vazar professional_id na resposta');
});

test('serviço de outra profissional não aparece nem sob o slug errado', async (t) => {
  if (!dbAvailable) { t.skip('DATABASE_URL não está acessível.'); return; }

  const res = await fetch(`${baseUrl}/public/${SLUG_B}/services`);
  assert.equal(res.status, 200);
  const body = await res.json();
  const ids = body.map((s) => s.id);
  assert.ok(ids.includes(svcOutraProfissional));
  assert.ok(!ids.includes(svcAtivoWhatsapp), 'serviço da profissional A não deveria aparecer sob o slug da B');
});

test('slug inexistente retorna 404 genérico', async (t) => {
  if (!dbAvailable) { t.skip('DATABASE_URL não está acessível.'); return; }

  const res = await fetch(`${baseUrl}/public/slug-que-nao-existe-services/services`);
  assert.equal(res.status, 404);
});
