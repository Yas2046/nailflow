/**
 * Aviso interno `appointment.public_created`: só sai para quem tem a própria
 * instância de WhatsApp (sem fallback para outra) e o telefone da profissional
 * vai normalizado (55 + número) no payload, sem alterar o valor salvo.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';

let pool;
let server;
let baseUrl;
let dbAvailable = true;
let profs = {};
let services = {};
let calls = [];
const realFetch = global.fetch;

const SPECS = {
  withInstance: { slug: 'teste-pc-com-instancia', instance: 'inst-pc-com', phone: '31985108190' },
  noInstance: { slug: 'teste-pc-sem-instancia', instance: null, phone: '31985108190' },
  blankInstance: { slug: 'teste-pc-instancia-vazia', instance: '   ', phone: '31985108190' },
  maskedPhone: { slug: 'teste-pc-telefone-mascara', instance: 'inst-pc-mask', phone: '(31) 98510-8190' },
  noPhone: { slug: 'teste-pc-sem-telefone', instance: 'inst-pc-nophone', phone: '' },
};

before(async () => {
  ({ pool } = await import('../src/config/db.js'));
  try { await pool.query('SELECT 1'); } catch { dbAvailable = false; }
  const { default: app } = await import('../src/server.js');
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  if (!dbAvailable) return;

  let n = 0;
  for (const [key, s] of Object.entries(SPECS)) {
    n += 1;
    const id = (await pool.query(
      `INSERT INTO professionals (name, email, password_hash, phone_whatsapp, business_name, slug, wa_instance_name)
       VALUES ($1,$2,'x',$3,$4,$5,$6) RETURNING id`,
      [`PC ${key}`, `pc_${n}@nailflow.com`, s.phone, `PC ${key} Studio`, s.slug, s.instance]
    )).rows[0].id;
    profs[key] = id;
    services[key] = (await pool.query(
      `INSERT INTO services (professional_id, name, price_cents, duration_minutes) VALUES ($1,'Gel PC',5000,30) RETURNING id`, [id])).rows[0].id;
    for (let wd = 0; wd <= 6; wd++) {
      await pool.query(
        `INSERT INTO weekly_availability (professional_id, weekday, is_working, start_time, end_time)
         VALUES ($1,$2,true,'08:00','22:00') ON CONFLICT (professional_id, weekday) DO NOTHING`, [id, wd]);
    }
  }
});

after(async () => {
  global.fetch = realFetch;
  for (const k of ['PUBLIC_CREATED', 'MESSAGE']) delete process.env[`N8N_WEBHOOK_${k}_URL`];
  if (dbAvailable) {
    const ids = Object.values(profs);
    await pool.query('DELETE FROM appointments WHERE professional_id = ANY($1)', [ids]);
    await pool.query('DELETE FROM clients WHERE professional_id = ANY($1)', [ids]);
    await pool.query('DELETE FROM services WHERE professional_id = ANY($1)', [ids]);
    await pool.query('DELETE FROM weekly_availability WHERE professional_id = ANY($1)', [ids]);
    await pool.query('DELETE FROM professionals WHERE id = ANY($1)', [ids]);
    await pool.end();
  }
  await new Promise((resolve) => server.close(resolve));
});

let ipSeq = 0;
async function book(key) {
  ipSeq += 1;
  const slug = SPECS[key].slug;
  const avail = await realFetch(`${baseUrl}/public/${slug}/availability?days=14&serviceId=${services[key]}`, {
    headers: { 'X-Forwarded-For': `10.77.0.${ipSeq}` },
  });
  const day = (await avail.json()).days.find((d) => d.slots.length > 0);
  assert.ok(day, 'esperava ao menos um horário livre');

  calls = [];
  process.env.N8N_WEBHOOK_PUBLIC_CREATED_URL = 'http://n8n-test/public-created';
  process.env.N8N_WEBHOOK_MESSAGE_URL = 'http://n8n-test/message';
  global.fetch = async (url, opts) => { calls.push(JSON.parse(opts.body)); return { ok: true }; };

  const res = await realFetch(`${baseUrl}/public/${slug}/appointments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `10.77.1.${ipSeq}` },
    body: JSON.stringify({
      serviceId: services[key], startsAt: day.slots[0], clientName: 'Cliente PC', clientPhone: `553198877${String(1000 + ipSeq)}`,
    }),
  });
  await new Promise((r) => setTimeout(r, 40));
  global.fetch = realFetch;
  return { status: res.status, publicCreated: calls.filter((c) => c.event === 'appointment.public_created') };
}

test('com instância: avisa a própria instância e envia o telefone normalizado (55 + número)', async (t) => {
  if (!dbAvailable) return t.skip('banco indisponível');
  const r = await book('withInstance');
  assert.equal(r.status, 201);
  assert.equal(r.publicCreated.length, 1);
  assert.equal(r.publicCreated[0].payload.waInstance, 'inst-pc-com');
  assert.equal(r.publicCreated[0].payload.professionalId, profs.withInstance);
  assert.equal(r.publicCreated[0].payload.professionalPhone, '5531985108190');
});

test('telefone com máscara também é normalizado, sem alterar o valor salvo', async (t) => {
  if (!dbAvailable) return t.skip('banco indisponível');
  const r = await book('maskedPhone');
  assert.equal(r.status, 201);
  assert.equal(r.publicCreated[0].payload.professionalPhone, '5531985108190');
  const { rows } = await pool.query('SELECT phone_whatsapp FROM professionals WHERE id = $1', [profs.maskedPhone]);
  assert.equal(rows[0].phone_whatsapp, '(31) 98510-8190', 'o telefone salvo não pode ser alterado');
});

test('sem wa_instance_name (NULL): não chama o n8n/Evolution e o agendamento segue normal', async (t) => {
  if (!dbAvailable) return t.skip('banco indisponível');
  const r = await book('noInstance');
  assert.equal(r.status, 201);
  assert.equal(r.publicCreated.length, 0, 'nenhum public_created sem instância');
  const { rows } = await pool.query(`SELECT status FROM appointments WHERE professional_id = $1`, [profs.noInstance]);
  assert.equal(rows.length, 1, 'agendamento criado normalmente');
  assert.equal(rows[0].status, 'pendente');
});

test('wa_instance_name só com espaços é tratado como ausente (sem fallback)', async (t) => {
  if (!dbAvailable) return t.skip('banco indisponível');
  const r = await book('blankInstance');
  assert.equal(r.status, 201);
  assert.equal(r.publicCreated.length, 0);
  // nenhuma chamada do aviso interno aponta para outra profissional
  assert.ok(!calls.some((c) => c.event === 'appointment.public_created' && c.payload.waInstance === 'inst-pc-com'));
});

test('telefone da profissional vazio: o aviso segue com professionalPhone nulo (o n8n descarta)', async (t) => {
  if (!dbAvailable) return t.skip('banco indisponível');
  const r = await book('noPhone');
  assert.equal(r.status, 201);
  assert.equal(r.publicCreated.length, 1);
  assert.equal(r.publicCreated[0].payload.professionalPhone, null);
  assert.equal(r.publicCreated[0].payload.waInstance, 'inst-pc-nophone');
});
