/**
 * Testes do motor de contexto do bot (Parte 1 da nova direção do WhatsApp —
 * "entender a conversa, não só menus"). Cobre POST /bot/process.
 *
 * Usa profissional/serviços/cliente temporários criados e removidos neste
 * próprio arquivo — nunca toca contas reais. `BOT_API_KEY` é definida aqui
 * mesmo, só para o processo de teste.
 *
 * Datas de teste calculadas dinamicamente a partir de "hoje" (mesmo padrão
 * de public-availability-serviceid.test.js), para não depender de quando a
 * suíte é rodada. Expediente cadastrado igual em todos os dias da semana
 * (08:00–20:00, sem almoço) para o teste não depender de qual dia da
 * semana cai em qual data.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.BOT_API_KEY = process.env.BOT_API_KEY || 'segredo-bot-teste';

let pool;
let app;
let server;
let baseUrl;

const PROF_ID = '99999999-9999-9999-9999-999999999901';
const OTHER_PROF_ID = '99999999-9999-9999-9999-999999999902';
const INSTANCE = 'instancia-teste-contexto';
const OTHER_INSTANCE = 'instancia-teste-contexto-outra';

const SERVICE_MANICURE_ID = '99999999-9999-9999-9999-999999999911';
const SERVICE_ESCOVA_ID = '99999999-9999-9999-9999-999999999912';

const PHONE = '5531977000001';
const PHONE_B = '5531977000002';
const PHONE_C = '5531977000003';
const PHONE_D = '5531977000004';
const PHONE_E = '5531977000005';

function futureWeekdayISO(daysAhead) {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  return d.toISOString().split('T')[0];
}

async function post(path, body, instance = INSTANCE) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.BOT_API_KEY}` },
    body: JSON.stringify({ ...body, instance }),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

async function processMessage(phone, text, instance = INSTANCE) {
  return post('/bot/process', { phone, text, waMessageId: `wa-${phone}-${Date.now()}-${Math.random()}`, fromMe: false, pushName: 'Cliente Teste' }, instance);
}

async function getConv(phone, profId = PROF_ID) {
  const { rows } = await pool.query(
    'SELECT * FROM conversation_states WHERE professional_id = $1 AND phone = $2',
    [profId, phone]
  );
  return rows[0] ?? null;
}

async function setupFixtures() {
  await pool.query('DELETE FROM professionals WHERE id IN ($1,$2)', [PROF_ID, OTHER_PROF_ID]);

  await pool.query(
    `INSERT INTO professionals (id, name, email, password_hash, phone_whatsapp, business_name, slug, wa_instance_name)
     VALUES
       ($1, 'Teste Contexto', 'teste-contexto@nailflow.dev', 'hash-fake', '5531900000001', 'Studio Contexto', 'teste-contexto', $3),
       ($2, 'Outra Profissional', 'outra-contexto@nailflow.dev', 'hash-fake', '5531900000002', 'Outro Studio', 'outro-contexto', $4)`,
    [PROF_ID, OTHER_PROF_ID, INSTANCE, OTHER_INSTANCE]
  );

  for (const profId of [PROF_ID, OTHER_PROF_ID]) {
    for (let weekday = 0; weekday <= 6; weekday++) {
      await pool.query(
        `INSERT INTO weekly_availability (professional_id, weekday, is_working, start_time, end_time)
         VALUES ($1, $2, true, '08:00', '20:00')`,
        [profId, weekday]
      );
    }
  }

  await pool.query(
    `INSERT INTO services (id, professional_id, name, price_cents, duration_minutes, active, available_on_whatsapp) VALUES
       ($1, $3, 'Manicure', 4000, 40, true, true),
       ($2, $3, 'Escova', 6000, 60, true, true)`,
    [SERVICE_MANICURE_ID, SERVICE_ESCOVA_ID, PROF_ID]
  );
}

async function teardownFixtures() {
  await pool.query('DELETE FROM professionals WHERE id IN ($1,$2)', [PROF_ID, OTHER_PROF_ID]);
}

let dbAvailable = true;

before(async () => {
  ({ pool } = await import('../src/config/db.js'));
  try {
    await pool.query('SELECT 1');
  } catch {
    dbAvailable = false;
    return;
  }

  ({ default: app } = await import('../src/server.js'));
  await setupFixtures();

  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  if (!dbAvailable) return;
  await teardownFixtures();
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
});

// ---------- 2. Conversa natural completa (intenção + serviço + data + período) ----------

test('conversa natural: "quero fazer manicure sexta depois das 14h" pula direto para horário', async (t) => {
  if (!dbAvailable) return t.skip('DATABASE_URL não está acessível.');

  const { status, json } = await processMessage(PHONE, 'Quero fazer manicure sexta depois das 14h');
  assert.equal(status, 200);
  assert.match(json.reply, /Horários disponíveis/);
  assert.doesNotMatch(json.reply, /Qual serviço você gostaria/);
  assert.doesNotMatch(json.reply, /1️⃣ Agendar horário/);

  const conv = await getConv(PHONE);
  assert.equal(conv.bot_state, 'AGUARDANDO_HORARIO');
  const ctx = conv.context;
  assert.equal(ctx.serviceId, SERVICE_MANICURE_ID);
  assert.ok(ctx.selectedDate);
  // Ajuste 1 (revisão): o atalho contextual (INICIO/MENU) também preserva
  // ctx.slots no context salvo, igual às correções em AGUARDANDO_DATA/HORARIO.
  assert.ok(ctx.slots, 'ctx.slots deveria ter sido preservado no fast-path contextual');
  assert.equal(ctx.slots.serviceId, SERVICE_MANICURE_ID);
  assert.ok(ctx.slots.date);
  // Todos os horários oferecidos devem ser >= 14:00 (período "depois das 14h")
  for (const iso of Object.values(ctx.slotsMap)) {
    const hour = new Date(iso).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hour12: false });
    assert.ok(Number(hour) >= 14, `horário ${iso} deveria ser >= 14h`);
  }
});

// ---------- 3. Alteração de data ("Não, sábado é melhor") ----------

test('alteração de data: serviço sem data ainda cai em AGUARDANDO_DATA, e uma correção de data muda o dia sem reiniciar', async (t) => {
  if (!dbAvailable) return t.skip('DATABASE_URL não está acessível.');

  const first = await processMessage(PHONE_B, 'Quero fazer manicure');
  assert.equal(first.status, 200);
  assert.match(first.json.reply, /Escolha a data/);

  let conv = await getConv(PHONE_B);
  assert.equal(conv.bot_state, 'AGUARDANDO_DATA');

  const second = await processMessage(PHONE_B, 'Não, sábado é melhor');
  assert.equal(second.status, 200);
  assert.match(second.json.reply, /Horários disponíveis|Não há horários disponíveis/);

  conv = await getConv(PHONE_B);
  if (conv.bot_state === 'AGUARDANDO_HORARIO') {
    const d = new Date(conv.context.selectedDate + 'T12:00:00-03:00');
    assert.equal(d.getDay(), 6, 'data selecionada deveria ser um sábado');
  }
});

// ---------- 4. Alteração de período ("qualquer horário à tarde") ----------

test('alteração de período: em AGUARDANDO_HORARIO, pedir "à tarde" refiltra sem sair do dia escolhido', async (t) => {
  if (!dbAvailable) return t.skip('DATABASE_URL não está acessível.');

  const first = await processMessage(PHONE_C, 'Quero fazer manicure');
  await processMessage(PHONE_C, 'sexta');
  let conv = await getConv(PHONE_C);
  assert.equal(conv.bot_state, 'AGUARDANDO_HORARIO');
  const selectedDateBefore = conv.context.selectedDate;

  const third = await processMessage(PHONE_C, 'Pode ser qualquer horário à tarde');
  assert.equal(third.status, 200);
  assert.match(third.json.reply, /Horários disponíveis|Não há horários nesse período/);

  conv = await getConv(PHONE_C);
  if (conv.bot_state === 'AGUARDANDO_HORARIO' && conv.context.selectedDate === selectedDateBefore) {
    for (const iso of Object.values(conv.context.slotsMap)) {
      const hour = Number(new Date(iso).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hour12: false }));
      assert.ok(hour >= 12 && hour < 18, `horário ${iso} deveria estar entre 12h e 18h`);
    }
  }
  void first;
});

// ---------- 5. Mensagem incompleta ----------

test('mensagem incompleta ("quero agendar", sem serviço) cai no fluxo normal de boas-vindas, sem travar', async (t) => {
  if (!dbAvailable) return t.skip('DATABASE_URL não está acessível.');

  const { status, json } = await processMessage(PHONE_D, 'quero agendar um horário');
  assert.equal(status, 200);
  // Sem serviço reconhecido, o atalho contextual não deve disparar —
  // comportamento inalterado do estado INICIO (saudação + menu).
  assert.match(json.reply, /Como posso ajudar/);

  const conv = await getConv(PHONE_D);
  assert.equal(conv.bot_state, 'MENU');
});

// ---------- 6. Mensagem que o bot não entende ----------

test('mensagem não reconhecida no MENU mantém o comportamento antigo (pede para escolher uma opção)', async (t) => {
  if (!dbAvailable) return t.skip('DATABASE_URL não está acessível.');

  await processMessage(PHONE_E, 'oi'); // INICIO -> MENU
  const { status, json } = await processMessage(PHONE_E, 'blablabla isso nao quer dizer nada');
  assert.equal(status, 200);
  assert.match(json.reply, /Não entendi/);

  const conv = await getConv(PHONE_E);
  assert.equal(conv.bot_state, 'MENU');
});

// ---------- Ajuste 2 (revisão): slot parcial não sobrevive a uma mensagem não reconhecida no MENU ----------

const PHONE_F = '5531977000008';

test('slot parcial (ex.: período sem serviço) não influencia a tentativa seguinte no MENU', async (t) => {
  if (!dbAvailable) return t.skip('DATABASE_URL não está acessível.');

  await processMessage(PHONE_F, 'oi'); // INICIO -> MENU

  // Mensagem sem intenção/serviço reconhecidos, mas com um período solto —
  // não deve ser tratada como início de agendamento, e o período não deve
  // "grudar" para a tentativa seguinte.
  const first = await processMessage(PHONE_F, 'sei la, qualquer hora a tarde');
  assert.match(first.json.reply, /Não entendi/);

  let conv = await getConv(PHONE_F);
  assert.equal(conv.bot_state, 'MENU');
  assert.equal(conv.context.slots, undefined, 'context não deveria conter slots parciais após mensagem não reconhecida');
  assert.equal(conv.context.menuRetries, 1);

  // Confirma que o menuRetries de fato incrementa nas tentativas seguintes
  // (comportamento antigo preservado) mesmo sem nenhum slot sobrando.
  const second = await processMessage(PHONE_F, 'outra coisa sem sentido');
  assert.match(second.json.reply, /Não entendi/);
  conv = await getConv(PHONE_F);
  assert.equal(conv.context.menuRetries, 2);
  assert.equal(conv.context.slots, undefined);
});

// ---------- Reconhecimento de horário em linguagem natural ----------

async function reachAguardandoHorario(phone) {
  await processMessage(phone, 'Quero fazer manicure');
  const dateReply = await processMessage(phone, 'sexta');
  return dateReply;
}

test('horário em linguagem natural: "10:30" seleciona o slot sem exigir o número', async (t) => {
  if (!dbAvailable) return t.skip('DATABASE_URL não está acessível.');

  const phone = '5531977000009';
  const dateReply = await reachAguardandoHorario(phone);
  assert.match(dateReply.json.reply, /Horários disponíveis/);

  const { json } = await processMessage(phone, '10:30');
  assert.match(json.reply, /Vou confirmar/);
  assert.match(json.reply, /10:30/);

  const conv = await getConv(phone);
  assert.equal(conv.bot_state, 'AGUARDANDO_CONFIRMACAO_AGENDAMENTO');
  const selected = new Date(conv.context.selectedSlot).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
  assert.equal(selected, '10:30');
});

test('horário em linguagem natural: "dez e meia" seleciona o mesmo horário que "10:30"', async (t) => {
  if (!dbAvailable) return t.skip('DATABASE_URL não está acessível.');

  const phone = '5531977000010';
  await reachAguardandoHorario(phone);
  const { json } = await processMessage(phone, 'dez e meia');
  assert.match(json.reply, /Vou confirmar/);

  const conv = await getConv(phone);
  const selected = new Date(conv.context.selectedSlot).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
  assert.equal(selected, '10:30');
});

test('horário em linguagem natural: horário fora da grade não é selecionado nem inventado', async (t) => {
  if (!dbAvailable) return t.skip('DATABASE_URL não está acessível.');

  const phone = '5531977000011';
  await reachAguardandoHorario(phone);
  // 3h da madrugada: fora do expediente (08:00-20:00), nunca apareceria na grade.
  const { json } = await processMessage(phone, '3h');
  assert.match(json.reply, /não está entre os disponíveis/);

  const conv = await getConv(phone);
  assert.equal(conv.bot_state, 'AGUARDANDO_HORARIO');
  assert.ok(conv.context.slotsMap, 'a grade original de horários deve continuar disponível');
});

test('horário em linguagem natural: mensagem ambígua ("10:30 ou 11:00") não seleciona nada por engano', async (t) => {
  if (!dbAvailable) return t.skip('DATABASE_URL não está acessível.');

  const phone = '5531977000012';
  await reachAguardandoHorario(phone);
  const { json } = await processMessage(phone, '10:30 ou 11:00, qualquer um serve');
  assert.match(json.reply, /Por favor escolha um dos horários/);

  const conv = await getConv(phone);
  assert.equal(conv.bot_state, 'AGUARDANDO_HORARIO');
});

test('seleção numérica continua funcionando em AGUARDANDO_HORARIO (sem regressão)', async (t) => {
  if (!dbAvailable) return t.skip('DATABASE_URL não está acessível.');

  const phone = '5531977000013';
  await reachAguardandoHorario(phone);
  const { json } = await processMessage(phone, '1');
  assert.match(json.reply, /Vou confirmar/);
});

test('horário em linguagem natural preserva serviço, data e período já conhecidos no contexto', async (t) => {
  if (!dbAvailable) return t.skip('DATABASE_URL não está acessível.');

  const phone = '5531977000014';
  // Mensagem única já traz serviço + data + período (Parte 1) — pula direto
  // para AGUARDANDO_HORARIO já com ctx.slots.period preenchido.
  await processMessage(phone, 'Quero fazer manicure sexta depois das 10h');
  let conv = await getConv(phone);
  assert.equal(conv.bot_state, 'AGUARDANDO_HORARIO');
  assert.equal(conv.context.serviceName, 'Manicure');
  const dataAntes = conv.context.selectedDate;
  const periodoAntes = conv.context.slots?.period;
  assert.ok(periodoAntes, 'período deveria ter sido reconhecido antes da seleção de horário');

  const { json } = await processMessage(phone, '10h30');
  assert.match(json.reply, /Vou confirmar/);

  conv = await getConv(phone);
  assert.equal(conv.context.serviceName, 'Manicure');
  assert.equal(conv.context.selectedDate, dataAntes);
  assert.deepEqual(conv.context.slots?.period, periodoAntes);
});

// ---------- 7. Fluxo antigo (100% numérico) continua funcionando ponta a ponta ----------

test('fluxo antigo por números (menu → serviço → data → horário → confirmação) cria o agendamento normalmente', async (t) => {
  if (!dbAvailable) return t.skip('DATABASE_URL não está acessível.');

  const phone = '5531977000006';
  await processMessage(phone, 'oi');
  const menuReply = await processMessage(phone, '1');
  assert.match(menuReply.json.reply, /Qual serviço você gostaria/);

  const serviceReply = await processMessage(phone, '1');
  assert.match(serviceReply.json.reply, /Escolha a data/);

  const dateReply = await processMessage(phone, '1');
  assert.match(dateReply.json.reply, /Horários disponíveis/);

  const timeReply = await processMessage(phone, '1');
  assert.match(timeReply.json.reply, /Vou confirmar/);

  const confirmReply = await processMessage(phone, 'sim');
  assert.match(confirmReply.json.reply, /Prontinho/);

  // phone tem 13 dígitos (DDI+DDD+9+8); a ficha de cliente é gravada com o
  // telefone normalizado (12 dígitos, sem o 9) — ver utils/phone.js.
  const normalizedPhone = phone.replace(/^(\d{4})9(\d{8})$/, '$1$2');
  const { rows } = await pool.query(
    `SELECT a.id FROM appointments a JOIN clients c ON c.id = a.client_id
     WHERE c.professional_id = $1 AND c.phone = $2`,
    [PROF_ID, normalizedPhone]
  );
  assert.equal(rows.length, 1);
});

// ---------- 8. Isolamento entre profissionais/instâncias ----------

test('isolamento: mensagem contextual em uma instância nunca cria contexto/estado na outra profissional', async (t) => {
  if (!dbAvailable) return t.skip('DATABASE_URL não está acessível.');

  const phone = '5531977000007';
  await processMessage(phone, 'Quero fazer manicure sexta depois das 14h', INSTANCE);

  const convOther = await getConv(phone, OTHER_PROF_ID);
  assert.equal(convOther, null, 'não deveria existir conversation_states para a outra profissional');

  const { rows } = await pool.query(
    `SELECT professional_id FROM message_history WHERE phone = $1`,
    [phone]
  );
  for (const row of rows) {
    assert.equal(row.professional_id, PROF_ID);
  }
});
