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

const PROF_ID = '88888888-8888-8888-8888-888888888801';
const OTHER_PROF_ID = '88888888-8888-8888-8888-888888888802';
const INSTANCE = 'instancia-teste-contexto';
const OTHER_INSTANCE = 'instancia-teste-contexto-outra';

const SERVICE_MANICURE_ID = '88888888-8888-8888-8888-888888888811';
const SERVICE_ESCOVA_ID = '88888888-8888-8888-8888-888888888812';

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
  assert.match(json.reply, /Fechado!/);
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
  assert.match(json.reply, /Fechado!/);

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
  assert.match(json.reply, /Fechado!/);
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
  assert.match(json.reply, /Fechado!/);

  conv = await getConv(phone);
  assert.equal(conv.context.serviceName, 'Manicure');
  assert.equal(conv.context.selectedDate, dataAntes);
  assert.deepEqual(conv.context.slots?.period, periodoAntes);
});

// ---------- Reserva direta: serviço + data + horário numa mensagem só ----------

test('"Quero manicure sexta às 14:30" pula direto para a confirmação, sem listar data nem horário', async (t) => {
  if (!dbAvailable) return t.skip('DATABASE_URL não está acessível.');

  const phone = '5531977000015';
  const { json } = await processMessage(phone, 'Quero manicure sexta às 14:30');
  assert.match(json.reply, /Fechado!/);
  assert.match(json.reply, /14:30/);
  assert.doesNotMatch(json.reply, /Escolha a data/);
  assert.doesNotMatch(json.reply, /Horários disponíveis/);

  const conv = await getConv(phone);
  assert.equal(conv.bot_state, 'AGUARDANDO_CONFIRMACAO_AGENDAMENTO');
  assert.equal(conv.context.serviceName, 'Manicure');
  const selected = new Date(conv.context.selectedSlot).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
  assert.equal(selected, '14:30');
});

test('"sexta às 14:30" dito em AGUARDANDO_DATA também pula direto para a confirmação', async (t) => {
  if (!dbAvailable) return t.skip('DATABASE_URL não está acessível.');

  const phone = '5531977000016';
  const first = await processMessage(phone, 'Quero fazer manicure');
  assert.match(first.json.reply, /Escolha a data/);

  const { json } = await processMessage(phone, 'sexta às 14:30');
  assert.match(json.reply, /Fechado!/);

  const conv = await getConv(phone);
  assert.equal(conv.bot_state, 'AGUARDANDO_CONFIRMACAO_AGENDAMENTO');
});

test('horário pedido junto com a data, mas indisponível, não inventa nada (cai na lista real do dia)', async (t) => {
  if (!dbAvailable) return t.skip('DATABASE_URL não está acessível.');

  const phone = '5531977000017';
  // 3h da madrugada: fora do expediente (08:00-20:00) em qualquer dia.
  const { json } = await processMessage(phone, 'Quero manicure sexta às 3h');
  assert.doesNotMatch(json.reply, /Fechado!/);
  assert.match(json.reply, /Horários disponíveis/);

  const conv = await getConv(phone);
  assert.equal(conv.bot_state, 'AGUARDANDO_HORARIO');
});

// ---------- Correção dentro da confirmação ("Na verdade pode ser 15h") ----------

test('correção de horário dentro de AGUARDANDO_CONFIRMACAO_AGENDAMENTO troca o horário sem perder o serviço/data', async (t) => {
  if (!dbAvailable) return t.skip('DATABASE_URL não está acessível.');

  const phone = '5531977000018';
  await processMessage(phone, 'Quero manicure sexta às 14:30');
  let conv = await getConv(phone);
  assert.equal(conv.bot_state, 'AGUARDANDO_CONFIRMACAO_AGENDAMENTO');
  const servicoAntes = conv.context.serviceName;
  const dataAntes = conv.context.selectedDate;

  const { json } = await processMessage(phone, 'Na verdade pode ser 15h');
  assert.match(json.reply, /Fechado!/);
  assert.match(json.reply, /15:00/);

  conv = await getConv(phone);
  assert.equal(conv.bot_state, 'AGUARDANDO_CONFIRMACAO_AGENDAMENTO');
  assert.equal(conv.context.serviceName, servicoAntes);
  assert.equal(conv.context.selectedDate, dataAntes);
  const selected = new Date(conv.context.selectedSlot).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
  assert.equal(selected, '15:00');
});

test('"sim" continua confirmando normalmente depois da correção de horário', async (t) => {
  if (!dbAvailable) return t.skip('DATABASE_URL não está acessível.');

  const phone = '5531977000019';
  await processMessage(phone, 'Quero manicure sexta às 14:30');
  await processMessage(phone, 'Na verdade pode ser 15h');
  const { json } = await processMessage(phone, 'sim');
  assert.match(json.reply, /Recebi sua solicitação/);
});

test('"pode ser 15h" (frase curta, sem "na verdade") também é tratada como correção, não como confirmação', async (t) => {
  if (!dbAvailable) return t.skip('DATABASE_URL não está acessível.');

  // Usa sábado (em vez de sexta) para não disputar o mesmo horário de
  // outros testes deste arquivo que já confirmam um agendamento real na
  // sexta, já que todos compartilham o mesmo profissional/agenda.
  const phone = '5531977000022';
  await processMessage(phone, 'Quero manicure sábado às 11:00');
  const { json } = await processMessage(phone, 'pode ser 12h');
  // Não pode ter confirmado o agendamento original (11:00) por engano.
  assert.doesNotMatch(json.reply, /Recebi sua solicitação/);
  assert.match(json.reply, /Fechado!/);
  assert.match(json.reply, /12:00/);

  const conv = await getConv(phone);
  assert.equal(conv.bot_state, 'AGUARDANDO_CONFIRMACAO_AGENDAMENTO');
  const selected = new Date(conv.context.selectedSlot).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
  assert.equal(selected, '12:00');
});

test('correção de horário com "pode ser 14:30" seguida de "confirmo" cria o agendamento no novo horário', async (t) => {
  if (!dbAvailable) return t.skip('DATABASE_URL não está acessível.');

  const phone = '5531977000023';
  await processMessage(phone, 'Quero manicure sábado às 13h');
  await processMessage(phone, 'pode ser 14:30');
  const { json } = await processMessage(phone, 'confirmo');
  assert.match(json.reply, /Recebi sua solicitação/);

  const normalizedPhone = phone.replace(/^(\d{4})9(\d{8})$/, '$1$2');
  const { rows } = await pool.query(
    `SELECT starts_at FROM appointments a JOIN clients c ON c.id = a.client_id
     WHERE c.professional_id = $1 AND c.phone = $2`,
    [PROF_ID, normalizedPhone]
  );
  assert.equal(rows.length, 1);
  const horario = new Date(rows[0].starts_at).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
  assert.equal(horario, '14:30');
});

// ---------- Ambiguidade explícita não escolhe sozinha ----------

test('"10:30 ou 11, qualquer um" em AGUARDANDO_HORARIO pede esclarecimento em vez de escolher', async (t) => {
  if (!dbAvailable) return t.skip('DATABASE_URL não está acessível.');

  const phone = '5531977000020';
  await reachAguardandoHorario(phone);
  const { json } = await processMessage(phone, '10:30 ou 11, qualquer um serve');
  assert.doesNotMatch(json.reply, /Fechado!/);
  assert.match(json.reply, /Por favor escolha um dos horários/);

  const conv = await getConv(phone);
  assert.equal(conv.bot_state, 'AGUARDANDO_HORARIO');
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
  assert.match(timeReply.json.reply, /Fechado!/);

  const confirmReply = await processMessage(phone, 'sim');
  assert.match(confirmReply.json.reply, /Recebi sua solicitação/);

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

// ---------- 9. Fluxos existentes de cancelamento continuam intactos ----------

test('fluxo de cancelamento (menu → listar → confirmar) continua funcionando, sem interferência do motor de contexto', async (t) => {
  if (!dbAvailable) return t.skip('DATABASE_URL não está acessível.');

  const phone = '5531977000021';
  // Cria um agendamento real primeiro, pelo fluxo normal.
  await processMessage(phone, 'oi');
  await processMessage(phone, '1');
  await processMessage(phone, '1');
  await processMessage(phone, '1');
  await processMessage(phone, '1');
  const bookReply = await processMessage(phone, 'sim');
  assert.match(bookReply.json.reply, /Recebi sua solicitação/);

  // Agora cancela.
  const menuReply = await processMessage(phone, '2');
  assert.match(menuReply.json.reply, /Qual deseja cancelar/);

  const listReply = await processMessage(phone, '1');
  assert.match(listReply.json.reply, /Posso cancelar/);

  const cancelReply = await processMessage(phone, 'sim');
  assert.match(cancelReply.json.reply, /Prontinho, cancelado/);

  const normalizedPhone = phone.replace(/^(\d{4})9(\d{8})$/, '$1$2');
  const { rows } = await pool.query(
    `SELECT a.status FROM appointments a JOIN clients c ON c.id = a.client_id
     WHERE c.professional_id = $1 AND c.phone = $2`,
    [PROF_ID, normalizedPhone]
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, 'cancelado');
});

// ---------- Entrada mais natural: atalhos de "ver" e "cancelar" ----------

async function createClientAndAppointment(phone, serviceId, startsAtIso, durationMinutes) {
  const { rows: clientRows } = await pool.query(
    `INSERT INTO clients (professional_id, name, phone) VALUES ($1,'Cliente Teste',$2)
     ON CONFLICT (professional_id, phone) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [PROF_ID, phone]
  );
  const endsAtIso = new Date(new Date(startsAtIso).getTime() + durationMinutes * 60000).toISOString();
  await pool.query(
    `INSERT INTO appointments (professional_id, client_id, service_id, starts_at, ends_at, status, price_cents_snapshot)
     VALUES ($1,$2,$3,$4,$5,'pendente',4000)`,
    [PROF_ID, clientRows[0].id, serviceId, startsAtIso, endsAtIso]
  );
}

test('"Quero ver meus agendamentos" como primeira mensagem responde direto, sem menu antes', async (t) => {
  if (!dbAvailable) return t.skip('DATABASE_URL não está acessível.');

  const phone = '5531977000024';
  await createClientAndAppointment(phone, SERVICE_MANICURE_ID, `${futureWeekdayISO(3)}T11:00:00-03:00`, 40);

  const { json } = await processMessage(phone, 'Quero ver meus agendamentos');
  assert.match(json.reply, /próximos horários/);
  assert.doesNotMatch(json.reply, /1️⃣ Agendar horário/);

  const conv = await getConv(phone);
  assert.equal(conv.bot_state, 'MENU');
});

test('"Quero ver meus agendamentos" sem nenhum agendamento responde direto, sem dump de menu', async (t) => {
  if (!dbAvailable) return t.skip('DATABASE_URL não está acessível.');

  const phone = '5531977000025';
  const { json } = await processMessage(phone, 'Quero ver meus agendamentos');
  assert.match(json.reply, /não tem nenhum agendamento/);
  assert.doesNotMatch(json.reply, /1️⃣/);
});

test('"Quero cancelar o de sábado" como primeira mensagem, com um único agendamento nesse dia, vai direto para a confirmação', async (t) => {
  if (!dbAvailable) return t.skip('DATABASE_URL não está acessível.');

  const phone = '5531977000026';
  // Próximo sábado a partir de hoje.
  const now = new Date();
  const diff = (6 - now.getDay() + 7) % 7 || 7;
  const saturday = new Date(now);
  saturday.setDate(now.getDate() + diff);
  const saturdayIso = `${saturday.toISOString().split('T')[0]}T11:00:00-03:00`;
  await createClientAndAppointment(phone, SERVICE_MANICURE_ID, saturdayIso, 40);

  const { json } = await processMessage(phone, 'Quero cancelar o de sábado');
  assert.match(json.reply, /Posso cancelar/);
  assert.match(json.reply, /Manicure/);

  const conv = await getConv(phone);
  assert.equal(conv.bot_state, 'AGUARDANDO_CONFIRMACAO_CANCELAMENTO');
  assert.ok(conv.context.apptIdToCancel);
});

test('"Quero cancelar" com dois agendamentos (ambiguidade real) cai no menu numerado, não escolhe sozinho', async (t) => {
  if (!dbAvailable) return t.skip('DATABASE_URL não está acessível.');

  const phone = '5531977000027';
  await createClientAndAppointment(phone, SERVICE_MANICURE_ID, `${futureWeekdayISO(20)}T09:15:00-03:00`, 40);
  await createClientAndAppointment(phone, SERVICE_ESCOVA_ID, `${futureWeekdayISO(22)}T16:45:00-03:00`, 60);

  const { json } = await processMessage(phone, 'Quero cancelar');
  assert.match(json.reply, /Encontrei estes agendamentos/);

  const conv = await getConv(phone);
  assert.equal(conv.bot_state, 'AGUARDANDO_CANCELAMENTO');
  assert.equal(Object.keys(conv.context.apptMap).length, 2);
});

test('"Quero marcar um horário" (sem detalhes) ainda mostra a lista de serviços — comportamento preservado', async (t) => {
  if (!dbAvailable) return t.skip('DATABASE_URL não está acessível.');

  const phone = '5531977000028';
  await processMessage(phone, 'oi'); // INICIO -> MENU
  const { json } = await processMessage(phone, 'Quero marcar um horário');
  assert.match(json.reply, /Qual serviço você gostaria/);

  const conv = await getConv(phone);
  assert.equal(conv.bot_state, 'AGUARDANDO_SERVICO');
});

// ---------- Mudança de assunto no meio do fluxo ----------

test('mudar de assunto durante um agendamento em andamento ("na verdade quero cancelar meu outro agendamento") conduz para cancelamento', async (t) => {
  if (!dbAvailable) return t.skip('DATABASE_URL não está acessível.');

  const phone = '5531977000029';
  await createClientAndAppointment(phone, SERVICE_ESCOVA_ID, `${futureWeekdayISO(18)}T16:15:00-03:00`, 60);

  // Começa um agendamento novo (fica em AGUARDANDO_DATA).
  const first = await processMessage(phone, 'Quero fazer manicure');
  assert.match(first.json.reply, /Escolha a data/);
  let conv = await getConv(phone);
  assert.equal(conv.bot_state, 'AGUARDANDO_DATA');

  // Muda de assunto no meio do fluxo.
  const { json } = await processMessage(phone, 'na verdade quero cancelar meu outro agendamento');
  assert.doesNotMatch(json.reply, /Por favor escolha uma das datas/);
  assert.match(json.reply, /cancelar/);

  conv = await getConv(phone);
  assert.ok(conv.bot_state === 'AGUARDANDO_CANCELAMENTO' || conv.bot_state === 'AGUARDANDO_CONFIRMACAO_CANCELAMENTO');
});

test('mudar de assunto durante o cancelamento ("na verdade quero agendar escova sábado às 11h") conduz para agendamento', async (t) => {
  if (!dbAvailable) return t.skip('DATABASE_URL não está acessível.');

  const phone = '5531977000030';
  await createClientAndAppointment(phone, SERVICE_MANICURE_ID, `${futureWeekdayISO(25)}T09:30:00-03:00`, 40);

  // Começa um cancelamento (fica em AGUARDANDO_CANCELAMENTO, já que só há 1
  // agendamento mas a mensagem inicial não dá pista nenhuma).
  const first = await processMessage(phone, 'cancelar');
  let conv = await getConv(phone);
  assert.equal(conv.bot_state, 'AGUARDANDO_CANCELAMENTO');
  void first;

  const { json } = await processMessage(phone, 'na verdade quero agendar escova sábado às 11h');
  assert.match(json.reply, /vamos agendar/);

  conv = await getConv(phone);
  assert.ok(['AGUARDANDO_HORARIO', 'AGUARDANDO_CONFIRMACAO_AGENDAMENTO', 'AGUARDANDO_DATA'].includes(conv.bot_state));
});

// ---------- Desistência clara em qualquer etapa AGUARDANDO_* ----------

test('"desisto" em AGUARDANDO_SERVICO abandona o fluxo e volta pra um MENU limpo', async (t) => {
  if (!dbAvailable) return t.skip('DATABASE_URL não está acessível.');

  const phone = '5531977000031';
  await processMessage(phone, 'oi'); // INICIO -> MENU
  const first = await processMessage(phone, '1'); // MENU -> AGUARDANDO_SERVICO
  assert.match(first.json.reply, /Qual serviço você gostaria/);

  const { json } = await processMessage(phone, 'desisto');
  assert.doesNotMatch(json.reply, /Qual serviço você gostaria/);
  assert.doesNotMatch(json.reply, /Não reconheci o serviço/);

  const conv = await getConv(phone);
  assert.equal(conv.bot_state, 'MENU');
  assert.deepEqual(conv.context, {});
});

test('"deixa pra lá" em AGUARDANDO_DATA abandona o fluxo e volta pra um MENU limpo', async (t) => {
  if (!dbAvailable) return t.skip('DATABASE_URL não está acessível.');

  const phone = '5531977000032';
  const first = await processMessage(phone, 'Quero fazer manicure');
  assert.match(first.json.reply, /Escolha a data/);
  let conv = await getConv(phone);
  assert.equal(conv.bot_state, 'AGUARDANDO_DATA');

  const { json } = await processMessage(phone, 'deixa pra lá');
  assert.doesNotMatch(json.reply, /Por favor escolha uma das datas/);

  conv = await getConv(phone);
  assert.equal(conv.bot_state, 'MENU');
  assert.deepEqual(conv.context, {});
});

test('"esquece" e "não tá dando" também saem do fluxo (equivalentes)', async (t) => {
  if (!dbAvailable) return t.skip('DATABASE_URL não está acessível.');

  const phoneEsquece = '5531977000033';
  await processMessage(phoneEsquece, 'Quero fazer manicure');
  const r1 = await processMessage(phoneEsquece, 'esquece');
  assert.doesNotMatch(r1.json.reply, /Por favor escolha uma das datas/);
  const conv1 = await getConv(phoneEsquece);
  assert.equal(conv1.bot_state, 'MENU');

  const phoneNaoTaDando = '5531977000034';
  await processMessage(phoneNaoTaDando, 'Quero fazer manicure');
  const r2 = await processMessage(phoneNaoTaDando, 'não tá dando não viu');
  assert.doesNotMatch(r2.json.reply, /Por favor escolha uma das datas/);
  const conv2 = await getConv(phoneNaoTaDando);
  assert.equal(conv2.bot_state, 'MENU');
});

// ---------- Reprodução da sequência real do WhatsApp (bug investigado) ----------

test('reprodução real: "Oi quero desmarcar meu agendamentos é sexta feira" identifica cancelamento, não agendamento', async (t) => {
  if (!dbAvailable) return t.skip('DATABASE_URL não está acessível.');

  const phone = '5531977000035';
  await createClientAndAppointment(phone, SERVICE_ESCOVA_ID, `${futureWeekdayISO(27)}T14:00:00-03:00`, 60);

  await processMessage(phone, 'oi'); // INICIO -> MENU
  const { json } = await processMessage(phone, 'Oi quero desmarcar meu agendamentos é sexta feira');

  assert.doesNotMatch(json.reply, /Qual serviço você gostaria/);

  const conv = await getConv(phone);
  assert.notEqual(conv.bot_state, 'AGUARDANDO_SERVICO');
  assert.ok(
    ['AGUARDANDO_CANCELAMENTO', 'AGUARDANDO_CONFIRMACAO_CANCELAMENTO'].includes(conv.bot_state),
    `esperava um estado de cancelamento, veio ${conv.bot_state}`
  );
});
