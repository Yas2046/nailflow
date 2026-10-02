import { pool } from '../config/db.js';
import { HttpError } from '../middleware/errorHandler.js';
import { checkSlotAvailability, getAvailableSlots, customerNotBefore } from '../utils/availability.js';
import { zonedTimeToUtc } from '../utils/timezone.js';
import { classifyReply } from '../utils/replyClassifier.js';
import { cleanPhone, normalizeBrPhone, findClientByPhone } from '../utils/phone.js';
import { extractSlots, extractDateMention, extractPeriodMention, extractTimeMention, extractActionIntent, extractServiceMention } from '../utils/conversationContext.js';

// ---------- helpers ----------

function formatDateBR(isoOrDate) {
  const d = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate);
  return d.toLocaleDateString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
  });
}

function formatTimeBR(isoOrDate) {
  const d = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate);
  return d.toLocaleTimeString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatPrice(cents) {
  return `R$ ${(cents / 100).toFixed(2).replace('.', ',')}`;
}

function normalizeText(t) {
  return String(t || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

const ESCAPE_PHRASES = [
  'quero falar com a profissional',
  'quero falar com uma pessoa',
  'quero falar com um humano',
  'falar com a profissional',
  'falar com uma pessoa',
  'falar com humano',
  'falar com alguem',
  'preciso falar com ela',
  'preciso falar com uma pessoa',
  'atendimento humano',
  'quero atendimento humano',
  'me passa para a profissional',
  'me passa para uma pessoa',
  'falar com voce',
  'falar com a manicure',
  'falar com a dona',
].map(normalizeText);

function isEscapePhrase(normalizedText) {
  return ESCAPE_PHRASES.some(p => normalizedText.includes(p));
}

function isBackCommand(normalizedText) {
  return /^(menu|voltar|inicio|recomecar|recomeço)$/.test(normalizedText);
}

// Frases claras de desistência durante uma etapa em andamento (ex.:
// escolhendo serviço/data/horário). Diferente de isBackCommand (que exige
// a palavra exata "menu"/"voltar"), aqui a cliente está abandonando a
// conversa, não pedindo o menu — por isso o tratamento é "tudo bem, como
// posso ajudar" em vez de reimprimir o menu numerado.
const GIVE_UP_PHRASES = [
  'desisto',
  'deixa pra la',
  'deixa para la',
  'deixa pra depois',
  'esquece',
  'esquece isso',
  'nao ta dando',
  'nao da nao',
  'nao quero mais',
  'vou deixar pra depois',
].map(normalizeText);

function isGiveUpPhrase(normalizedText) {
  return GIVE_UP_PHRASES.some((p) => normalizedText.includes(p));
}

// ---------- DB helpers ----------

async function getOrCreateConversation(professionalId, phone) {
  const { rows } = await pool.query(
    `INSERT INTO conversation_states (professional_id, phone, mode, bot_state, context, last_message_at)
     VALUES ($1, $2, 'BOT_ATIVO', 'INICIO', '{}', now())
     ON CONFLICT (professional_id, phone) DO UPDATE SET last_message_at = now()
     RETURNING *`,
    [professionalId, phone]
  );
  return rows[0];
}

async function updateConversation(professionalId, phone, { mode, botState, context }) {
  await pool.query(
    `UPDATE conversation_states
     SET mode        = COALESCE($3, mode),
         bot_state   = COALESCE($4, bot_state),
         context     = COALESCE($5, context),
         updated_at  = now(),
         last_message_at = now()
     WHERE professional_id = $1 AND phone = $2`,
    [
      professionalId,
      phone,
      mode ?? null,
      botState ?? null,
      context !== undefined ? JSON.stringify(context) : null,
    ]
  );
}

async function recordMessage(professionalId, phone, { waMessageId, direction, sender, content }) {
  try {
    await pool.query(
      `INSERT INTO message_history
         (professional_id, phone, wa_message_id, direction, sender, content)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (professional_id, wa_message_id) WHERE wa_message_id IS NOT NULL DO NOTHING`,
      [professionalId, phone, waMessageId ?? null, direction, sender, content]
    );
  } catch {
    // silently ignore on conflict
  }
}

async function findMessageBySender(professionalId, waMessageId) {
  if (!waMessageId) return null;
  const { rows } = await pool.query(
    `SELECT sender FROM message_history
     WHERE professional_id = $1 AND wa_message_id = $2 LIMIT 1`,
    [professionalId, waMessageId]
  );
  return rows[0] ?? null;
}

async function findOrCreateClient(professionalId, phone, name) {
  const existing = await findClientByPhone(professionalId, phone);
  if (existing) return existing;
  const normalized = normalizeBrPhone(phone);
  const { rows } = await pool.query(
    `INSERT INTO clients (professional_id, name, phone) VALUES ($1,$2,$3)
     ON CONFLICT (professional_id, phone) DO UPDATE SET name = EXCLUDED.name
     RETURNING *`,
    [professionalId, name || 'Cliente WhatsApp', normalized]
  );
  return rows[0];
}

async function listActiveServices(professionalId) {
  const { rows } = await pool.query(
    `SELECT id, name, description, price_cents, duration_minutes
     FROM services WHERE professional_id = $1 AND active = true AND available_on_whatsapp = true ORDER BY name ASC`,
    [professionalId]
  );
  return rows;
}

async function getUpcomingAppointments(professionalId, phone) {
  const client = await findClientByPhone(professionalId, phone);
  if (!client) return [];
  const { rows } = await pool.query(
    `SELECT a.id, a.starts_at, a.ends_at, a.status, s.id AS service_id, s.name AS service_name
     FROM appointments a JOIN services s ON s.id = a.service_id
     WHERE a.client_id = $1
       AND a.professional_id = $2
       AND a.status IN ('pendente','confirmado')
       AND a.starts_at > now()
     ORDER BY a.starts_at ASC`,
    [client.id, professionalId]
  );
  return rows;
}

async function getLastCompletedService(professionalId, phone) {
  const client = await findClientByPhone(professionalId, phone);
  if (!client) return null;
  const { rows } = await pool.query(
    `SELECT a.service_id, s.name AS service_name, s.duration_minutes, s.price_cents, a.starts_at
     FROM appointments a
     JOIN services s ON s.id = a.service_id
     WHERE a.client_id = $1
       AND a.professional_id = $2
       AND a.status = 'concluido'
       AND s.active = true
       AND s.available_on_whatsapp = true
     ORDER BY a.starts_at DESC
     LIMIT 1`,
    [client.id, professionalId]
  );
  return rows[0] ?? null;
}

function formatConfirmationMessage(serviceName, startsAtIso, priceCents) {
  return `Fechado! 💅 *${serviceName}* ${formatDateBR(new Date(startsAtIso))} às ${formatTimeBR(new Date(startsAtIso))}, por ${formatPrice(priceCents)}. Confirma? (sim / não)`;
}

// Tenta identificar, entre os agendamentos futuros já carregados, qual
// deles a cliente quis dizer a partir de pistas no texto (data/dia da
// semana e/ou nome do serviço, ex.: "o de sábado", "a manicure de sexta").
// Só retorna um agendamento quando a combinação de pistas aponta para
// EXATAMENTE um — ambiguidade real (nenhuma pista, ou mais de um
// candidato) retorna null de propósito, para cair no menu numerado em
// vez de adivinhar qual agendamento cancelar.
function matchAppointmentFromText(rawText, appointments, services) {
  const mentionedDate = extractDateMention(rawText);
  const mentionedService = extractServiceMention(rawText, services);
  if (!mentionedDate && !mentionedService) return null;

  let candidates = appointments;
  if (mentionedDate) {
    const dateStr = mentionedDate.toISOString().split('T')[0];
    candidates = candidates.filter((a) => {
      const apptDateStr = new Date(a.starts_at).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
      return apptDateStr === dateStr;
    });
  }
  if (mentionedService) {
    candidates = candidates.filter((a) => a.service_id === mentionedService.id);
  }

  return candidates.length === 1 ? candidates[0] : null;
}

// Monta a resposta de "ver agendamentos" — sem reimprimir o menu 1-4 em
// seguida (reduz o "despejo de menu"); os números continuam funcionando
// se a cliente decidir usá-los na próxima mensagem, porque o estado
// volta para MENU mesmo assim.
async function buildViewAppointmentsReply(professionalId, phone) {
  const appointments = await getUpcomingAppointments(professionalId, phone);
  if (appointments.length === 0) {
    return {
      message: `Você ainda não tem nenhum agendamento marcado. 😊 Quer marcar um horário?`,
      botState: 'MENU',
      context: {},
    };
  }
  const lines = appointments.map((a) => `• ${a.service_name}: ${formatDateBR(a.starts_at)} às ${formatTimeBR(a.starts_at)}`);
  return {
    message: `Esses são os seus próximos horários:\n\n${lines.join('\n')}`,
    botState: 'MENU',
    context: {},
  };
}

// Monta a resposta de cancelamento: se o texto já trouxer uma pista que
// identifica exatamente um agendamento (data/dia da semana e/ou serviço),
// pula direto para a confirmação daquele agendamento específico. Senão,
// cai no menu numerado de sempre — mesmos nomes de estado/contexto
// (`AGUARDANDO_CANCELAMENTO`/`apptMap`, `AGUARDANDO_CONFIRMACAO_CANCELAMENTO`/
// `apptIdToCancel`) usados pelos estados já existentes, então nada downstream
// precisa mudar.
async function buildCancelReply(professionalId, phone, rawText) {
  const appointments = await getUpcomingAppointments(professionalId, phone);
  if (appointments.length === 0) {
    return {
      message: `Não encontrei nenhum agendamento ativo pra cancelar. 😊`,
      botState: 'MENU',
      context: {},
    };
  }

  const services = await listActiveServices(professionalId);
  const match = matchAppointmentFromText(rawText, appointments, services);
  if (match) {
    return {
      message: `Posso cancelar *${match.service_name}* de ${formatDateBR(match.starts_at)} às ${formatTimeBR(match.starts_at)}? (sim / não)`,
      botState: 'AGUARDANDO_CONFIRMACAO_CANCELAMENTO',
      context: { apptIdToCancel: match.id, abandonment_notified: false },
    };
  }

  const apptMap = {};
  const lines = appointments.map((a, i) => {
    apptMap[String(i + 1)] = a.id;
    return `${i + 1}. ${a.service_name} - ${formatDateBR(a.starts_at)} às ${formatTimeBR(a.starts_at)}`;
  });
  return {
    message: `Encontrei estes agendamentos:\n\n${lines.join('\n')}\n\nQual deseja cancelar? (digite o número)`,
    botState: 'AGUARDANDO_CANCELAMENTO',
    context: { apptMap, abandonment_notified: false },
  };
}

// Returns up to maxDays days that have slots for given service duration.
// The search window is capped by the professional's booking_horizon_days setting.
async function getAvailableDaysWithSlots(professionalId, durationMinutes, maxDays = 5) {
  const { rows } = await pool.query(
    'SELECT booking_horizon_days FROM professionals WHERE id = $1',
    [professionalId]
  );
  const horizon = rows[0]?.booking_horizon_days ?? 60;

  const days = [];
  const today = new Date();
  for (let i = 1; i <= horizon && days.length < maxDays; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    d.setHours(12, 0, 0, 0); // use noon so timezone math is safe
    const slots = await getAvailableSlots(professionalId, d, durationMinutes, { notBefore: customerNotBefore() });
    if (slots.length > 0) {
      days.push({ date: d, slots });
    }
  }
  return days;
}

// ---------- Motor de contexto (Parte 1) ----------
//
// Camada leve por cima da máquina de estados existente: tenta reconhecer
// intenção/serviço/data/período em mensagens livres (ex.: "quero fazer
// unha sexta depois das 18h") e guarda o que já foi entendido em
// `ctx.slots`, para não perder essa informação a cada resposta — sem
// substituir os estados/menus existentes, que continuam sendo o fallback
// sempre que nada é reconhecido.

// Filtra uma lista de slots (Date) por um período { afterMinutes?, beforeMinutes? }
// em minutos desde 00:00 no fuso de São Paulo.
function filterSlotsByPeriod(slots, period) {
  if (!period) return slots;
  return slots.filter((s) => {
    const parts = s.start.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
    const [h, m] = parts.split(':').map(Number);
    const minutes = h * 60 + m;
    if (period.afterMinutes != null && minutes < period.afterMinutes) return false;
    if (period.beforeMinutes != null && minutes >= period.beforeMinutes) return false;
    return true;
  });
}

// Monta a mensagem de confirmação final (mesmo formato de sempre, usado em
// AGUARDANDO_HORARIO) direto a partir de um dia + hora exata já conhecidos,
// revalidando a disponibilidade de verdade (checkSlotAvailability) — nunca
// confirma nem "inventa" um horário sem essa checagem. Retorna null se o
// horário pedido não estiver disponível (quem chama decide o fallback).
async function tryDirectBooking(professionalId, service, dateStr, timeMention) {
  if (!dateStr || !timeMention) return null;
  const naive = `${dateStr}T${String(timeMention.hour).padStart(2, '0')}:${String(timeMention.minute).padStart(2, '0')}:00`;
  const check = await checkSlotAvailability(professionalId, service.id, naive, null, { notBefore: customerNotBefore() });
  if (!check.available) return null;

  return {
    message: formatConfirmationMessage(service.name, check.startsAt, service.price_cents),
    botState: 'AGUARDANDO_CONFIRMACAO_AGENDAMENTO',
    context: {
      serviceId: service.id,
      serviceName: service.name,
      serviceDuration: service.duration_minutes,
      servicePrice: service.price_cents,
      selectedDate: dateStr,
      selectedSlot: check.startsAt,
      abandonment_notified: false,
    },
  };
}

// Monta a lista de dias disponíveis para um serviço, já formatada como
// resposta + daysMap (mesmo formato usado em AGUARDANDO_SERVICO). Se
// serviço + data + horário exato já foram reconhecidos juntos (ex.:
// "sexta às 14:30"), tenta ir direto para a confirmação (tryDirectBooking),
// sem listar nada. Se só a data foi reconhecida, pula para a lista de
// horários daquele dia (buildTimeReply), já filtrada por período se dito.
async function buildDaysReply(professionalId, service, slots) {
  if (slots?.date && slots?.time) {
    const direct = await tryDirectBooking(professionalId, service, slots.date, slots.time);
    if (direct) return direct;
    // Horário pedido não está disponível nesse dia: cai no fluxo normal
    // abaixo (lista de horários reais daquele dia), sem inventar nada.
  }

  const days = await getAvailableDaysWithSlots(professionalId, service.duration_minutes);
  if (days.length === 0) {
    return {
      message: `No momento não há horários disponíveis para ${service.name}. Tente novamente mais tarde ou entre em contato diretamente. 😊`,
      botState: 'MENU',
      context: {},
    };
  }

  // Preserva ctx.slots no context salvo, do mesmo jeito que os caminhos de
  // correção em AGUARDANDO_DATA/AGUARDANDO_HORARIO já fazem — consistência
  // pedida na revisão, sem mudar nenhuma regra de negócio.
  const baseCtx = {
    serviceId: service.id,
    serviceName: service.name,
    serviceDuration: service.duration_minutes,
    servicePrice: service.price_cents,
    ...(slots ? { slots } : {}),
  };

  if (slots?.date) {
    const dayMatch = days.find((d) => d.date.toISOString().split('T')[0] === slots.date);
    if (dayMatch) {
      const timeReply = buildTimeReply(dayMatch.date, dayMatch.slots, baseCtx, slots.period);
      if (timeReply) return timeReply;
    }
  }

  const daysMap = {};
  const lines = days.map((d, i) => {
    daysMap[String(i + 1)] = d.date.toISOString().split('T')[0];
    return `${i + 1}. ${formatDateBR(d.date)}`;
  });

  return {
    message: `Ótimo! ${service.name} 💅\n\nEscolha a data:\n\n${lines.join('\n')}\n\nDigite o número da data.`,
    botState: 'AGUARDANDO_DATA',
    context: { ...baseCtx, daysMap, abandonment_notified: false },
  };
}

// Monta a lista de horários de um dia já carregado (slots = resultado de
// getAvailableSlots), aplicando um filtro de período opcional. Retorna null
// se o período filtrar todos os horários (quem chama decide o que fazer).
function buildTimeReply(date, slots, baseCtx, period) {
  const filtered = filterSlotsByPeriod(slots, period);
  if (filtered.length === 0) return null;

  const slotsMap = {};
  const lines = filtered.slice(0, 8).map((s, i) => {
    slotsMap[String(i + 1)] = s.start.toISOString();
    return `${i + 1}. ${formatTimeBR(s.start)}`;
  });

  return {
    message: `${formatDateBR(date)} 📅\n\nHorários disponíveis:\n\n${lines.join('\n')}\n\nDigite o número do horário.`,
    botState: 'AGUARDANDO_HORARIO',
    context: { ...baseCtx, selectedDate: date.toISOString().split('T')[0], slotsMap, abandonment_notified: false },
  };
}

// ---------- Bot state machine ----------

async function runStateMachine(conv, rawText, phone, professionalId, pushName) {
  const state = conv.bot_state || 'INICIO';
  const ctx = typeof conv.context === 'string' ? JSON.parse(conv.context) : (conv.context || {});
  const text = normalizeText(rawText);

  // Helper: persist state + context and return reply
  const reply = async (msg, newState, newCtx) => {
    await updateConversation(professionalId, phone, {
      botState: newState ?? state,
      context: newCtx !== undefined ? newCtx : ctx,
    });
    return msg;
  };

  // Escape phrases → transfer to human in any state
  if (state !== 'INICIO' && isEscapePhrase(text)) {
    await updateConversation(professionalId, phone, { mode: 'ATENDIMENTO_HUMANO' });
    return `Claro! 😊 Vou chamar a profissional para te atender. Um momentinho! 🌸`;
  }

  // Desistência clara ("desisto", "deixa pra lá", "esquece", "não tá
  // dando"...) em qualquer etapa em andamento — abandona o fluxo atual e
  // volta para um MENU limpo, sem ficar repetindo a mesma pergunta.
  if (state.startsWith('AGUARDANDO_') && isGiveUpPhrase(text)) {
    return reply(`Tudo bem! 😊 Como posso ajudar?`, 'MENU', {});
  }

  // Motor de contexto (Parte 1): tenta reconhecer intenção/serviço/data/
  // período em mensagens livres e acumula em ctx.slots, sem interferir em
  // respostas que já são um número de menu ou um comando de navegação.
  const CONTEXTUAL_STATES = new Set(['INICIO', 'MENU', 'AGUARDANDO_SERVICO', 'AGUARDANDO_DATA', 'AGUARDANDO_HORARIO']);
  if (CONTEXTUAL_STATES.has(state) && !/^\d+$/.test(text) && !isBackCommand(text) && !isEscapePhrase(text)) {
    const servicesForContext = await listActiveServices(professionalId);
    const newSlots = extractSlots(rawText, servicesForContext);
    if (Object.keys(newSlots).length > 0) {
      ctx.slots = { ...(ctx.slots || {}), ...newSlots };
    }
  }

  // Mudança clara de assunto durante uma etapa de agendamento/cancelamento
  // em andamento (ex.: cliente escolhendo horário manda "na verdade quero
  // cancelar meu outro agendamento") — em vez de travar em "não entendi",
  // reconhece e conduz para a nova intenção, sem perder nada já salvo no
  // banco (só descarta a escolha parcial que ainda não virou agendamento).
  const BOOKING_FLOW_STATES = new Set(['AGUARDANDO_SERVICO', 'AGUARDANDO_DATA', 'AGUARDANDO_HORARIO', 'AGUARDANDO_CONFIRMACAO_AGENDAMENTO']);
  const CANCEL_FLOW_STATES = new Set(['AGUARDANDO_CANCELAMENTO', 'AGUARDANDO_CONFIRMACAO_CANCELAMENTO']);
  if ((BOOKING_FLOW_STATES.has(state) || CANCEL_FLOW_STATES.has(state)) && !/^\d+$/.test(text) && !isBackCommand(text) && !isEscapePhrase(text)) {
    const switchAction = extractActionIntent(rawText);

    if (switchAction === 'cancelar' && BOOKING_FLOW_STATES.has(state)) {
      const built = await buildCancelReply(professionalId, phone, rawText);
      return reply(`Sem problema, vamos cancelar. 😊\n\n${built.message}`, built.botState, built.context);
    }

    if (switchAction === 'ver' && BOOKING_FLOW_STATES.has(state)) {
      const built = await buildViewAppointmentsReply(professionalId, phone);
      return reply(built.message, built.botState, built.context);
    }

    if (switchAction === 'agendar' && CANCEL_FLOW_STATES.has(state)) {
      const services = await listActiveServices(professionalId);
      const freshSlots = extractSlots(rawText, services);
      const chosen = freshSlots.serviceId ? services.find((s) => s.id === freshSlots.serviceId) : null;
      if (chosen) {
        const built = await buildDaysReply(professionalId, chosen, freshSlots);
        return reply(`Combinado, vamos agendar. 😊\n\n${built.message}`, built.botState, built.context);
      }
    }
  }

  // ---------- INICIO ----------
  if (state === 'INICIO') {
    const existingClient = await findClientByPhone(professionalId, phone);

    // Resolve first name: DB name > pushName > null
    const dbName = existingClient?.name || '';
    const isDefaultName = dbName === '' || dbName === 'Cliente WhatsApp';
    const rawFirstName = isDefaultName
      ? (pushName ? pushName.split(' ')[0] : null)
      : dbName.split(' ')[0];
    const firstName = rawFirstName || null;

    const greeting = firstName ? `Oi, ${firstName}! 😊` : `Oi! 😊 Seja bem-vinda!`;

    // Se a própria primeira mensagem já identifica um serviço com intenção
    // clara de agendar (ex.: "quero fazer unha sexta depois das 18h"),
    // pula a saudação genérica e o menu numerado e vai direto para a
    // seleção de data/horário daquele serviço.
    if (ctx.slots?.serviceId && ctx.slots?.intent === 'agendar') {
      const services = await listActiveServices(professionalId);
      const chosen = services.find((s) => s.id === ctx.slots.serviceId);
      if (chosen) {
        const built = await buildDaysReply(professionalId, chosen, ctx.slots);
        return reply(`${greeting}\n\n${built.message}`, built.botState, built.context);
      }
    }

    // Mesma ideia do atalho acima, mas para "ver agendamentos" e
    // "cancelar" — se a própria primeira mensagem já deixa isso claro
    // (ex.: "quero ver meus agendamentos", "quero cancelar o de sábado"),
    // atende direto, sem passar pela saudação genérica + menu.
    const initialAction = extractActionIntent(rawText);
    if (initialAction === 'ver') {
      const built = await buildViewAppointmentsReply(professionalId, phone);
      return reply(`${greeting}\n\n${built.message}`, built.botState, built.context);
    }
    if (initialAction === 'cancelar') {
      const built = await buildCancelReply(professionalId, phone, rawText);
      return reply(`${greeting}\n\n${built.message}`, built.botState, built.context);
    }

    if (existingClient) {
      const upcoming = await getUpcomingAppointments(professionalId, phone);
      const lastService = await getLastCompletedService(professionalId, phone);

      if (upcoming.length > 0) {
        // Cliente com agendamento futuro: menciona proativamente
        const next = upcoming[0];
        const dateStr = formatDateBR(next.starts_at);
        const timeStr = formatTimeBR(next.starts_at);
        const upcomingLine = `Vi que você tem *${next.service_name}* marcada para ${dateStr} às ${timeStr}. 📅`;
        return reply(
          `${greeting} Que bom te ver! 🥰

${upcomingLine}

Como posso ajudar?

1️⃣ Agendar outro horário
2️⃣ Cancelar agendamento
3️⃣ Ver meus agendamentos
4️⃣ Falar com a profissional`,
          'MENU',
          {}
        );
      }

      if (lastService) {
        // Cliente recorrente sem agendamento futuro: oferece repetir o último serviço
        return reply(
          `${greeting} Saudades! 🥰

Da última vez você fez *${lastService.service_name}*. Quer marcar de novo?

Responda *sim* para agendar ou *não* para ver todas as opções.`,
          'AGUARDANDO_REPETICAO',
          {
            lastServiceId: lastService.service_id,
            lastServiceName: lastService.service_name,
            lastServiceDuration: lastService.duration_minutes,
            lastServicePrice: lastService.price_cents,
            abandonment_notified: false,
          }
        );
      }

      // Cliente conhecida mas sem histórico de serviços concluídos
      return reply(
        `${greeting} Que bom te ver! 😊

Como posso ajudar?

1️⃣ Agendar horário
2️⃣ Cancelar agendamento
3️⃣ Ver meus agendamentos
4️⃣ Falar com a profissional`,
        'MENU',
        {}
      );
    }

    // Cliente nova
    return reply(
      `${greeting} Seja bem-vinda!

Como posso ajudar?

1️⃣ Agendar horário
2️⃣ Cancelar agendamento
3️⃣ Ver meus agendamentos
4️⃣ Falar com a profissional`,
      'MENU',
      {}
    );
  }

  // ---------- MENU ----------
  if (state === 'MENU') {
    // Serviço já identificado na própria mensagem (ex.: "quero fazer unha
    // sexta depois das 18h") → pula a lista de serviços e vai direto para
    // data/horário, já aplicando data/período se também reconhecidos.
    // Exige intenção explícita de agendar reconhecida no texto — não basta
    // citar o nome de um serviço (ex.: "quero cancelar minha manicure" não
    // deve ser tratado como um novo agendamento).
    if (ctx.slots?.serviceId && ctx.slots?.intent === 'agendar') {
      const services = await listActiveServices(professionalId);
      const chosen = services.find((s) => s.id === ctx.slots.serviceId);
      if (chosen) {
        const built = await buildDaysReply(professionalId, chosen, ctx.slots);
        return reply(built.message, built.botState, built.context);
      }
    }

    // agendar — \b (word boundary) é essencial aqui: sem ele, "desmarcar"
    // bate em "marcar" como substring e vira "agendar" por engano.
    if (/^1$/.test(text) || /\b(agendar|marcar|horario)\b/.test(text)) {
      const services = await listActiveServices(professionalId);
      if (services.length === 0) {
        return reply('No momento não temos serviços disponíveis. Por favor, entre em contato diretamente. 😊', 'MENU', {});
      }
      const servicesMap = {};
      const lines = services.map((s, i) => {
        servicesMap[String(i + 1)] = s;
        return `${i + 1}. ${s.name} - ${formatPrice(s.price_cents)} (${s.duration_minutes} min)`;
      });
      return reply(
        `Claro! 😊 Qual serviço você gostaria?\n\n${lines.join('\n')}\n\nDigite o número do serviço.`,
        'AGUARDANDO_SERVICO',
        { servicesMap, abandonment_notified: false }
      );
    }

    // cancelar — se a mensagem já trouxer uma pista (data/serviço) que
    // identifica exatamente um agendamento, pula direto pra confirmação
    // daquele; senão cai no menu numerado de sempre (buildCancelReply).
    // Inclui "desmarcar/desmarca" (sinônimo comum) — sem isso, uma frase
    // como "quero desmarcar meu agendamento" cairia no check de "ver"
    // logo abaixo, só por conter "meu"/"agendamento".
    if (/^2$/.test(text) || /cancelar|cancela|desmarcar|desmarca/.test(text)) {
      const built = await buildCancelReply(professionalId, phone, rawText);
      return reply(built.message, built.botState, built.context);
    }

    // ver agendamentos — sem reimprimir o menu 1-4 em seguida.
    if (/^3$/.test(text) || /ver|meu|agendamento|proximo/.test(text)) {
      const built = await buildViewAppointmentsReply(professionalId, phone);
      return reply(built.message, built.botState, built.context);
    }

    // saudação no meio de uma conversa: re-executa INICIO para personalizar
    if (/^(oi|ola|bom dia|boa tarde|boa noite|hello|hi)/.test(text)) {
      await updateConversation(professionalId, phone, { botState: 'INICIO', context: {} });
      conv.bot_state = 'INICIO';
      conv.context = {};
      return runStateMachine(conv, rawText, phone, professionalId, pushName);
    }

    // falar com a profissional (opção 4 do menu)
    if (/^4$/.test(text)) {
      await updateConversation(professionalId, phone, { mode: 'ATENDIMENTO_HUMANO' });
      return `Ok, entendi! 😊

Para falar com a profissional, é só aguardar um pouquinho. Ela pode estar atendendo outra cliente no momento, então talvez demore um pouco para responder.

Mas se for para agendar ou cancelar seu horário, eu consigo te ajudar por aqui mesmo. 💅

Quando quiser continuar pelo atendimento automático, é só enviar uma nova mensagem.`;
    }

    // Retry counter for unrecognized MENU input
    const menuRetries = (ctx.menuRetries || 0) + 1;
    if (menuRetries >= 3) {
      await updateConversation(professionalId, phone, { mode: 'ATENDIMENTO_HUMANO', botState: 'MENU', context: {} });
      return `Parece que não estou conseguindo te ajudar da forma certa. 😊 Vou chamar a profissional para te atender melhor! Aguarda um momento. 🌸`;
    }
    // Mensagem não reconhecida no MENU: não carrega slots parciais (data/
    // período/intenção/serviço) para a próxima tentativa — só uma menção
    // solta não deve influenciar um agendamento futuro sem confirmação
    // clara. Mantém só o contador de tentativas.
    return reply(
      `Não entendi. 😊 Por favor escolha uma opção:\n\n1️⃣ Agendar horário\n2️⃣ Cancelar agendamento\n3️⃣ Ver meus agendamentos\n4️⃣ Falar com a profissional`,
      'MENU',
      { menuRetries }
    );
  }

  // ---------- AGUARDANDO_SERVICO ----------
  if (state === 'AGUARDANDO_SERVICO') {
    if (isBackCommand(text)) {
      return reply(
        `Ok! 😊 Como posso ajudar?\n\n1️⃣ Agendar horário\n2️⃣ Cancelar agendamento\n3️⃣ Ver meus agendamentos\n4️⃣ Falar com a profissional`,
        'MENU', {}
      );
    }

    const servicesMap = ctx.servicesMap || {};
    let chosen = servicesMap[text];

    // Try name match if not a number
    if (!chosen) {
      const all = Object.values(servicesMap);
      chosen = all.find((s) => normalizeText(s.name).includes(text));
    }

    // Sinônimo coloquial reconhecido pelo motor de contexto (ex.: "unha"
    // → Manicure), quando o serviço citado está entre as opções mostradas.
    if (!chosen && ctx.slots?.serviceId) {
      chosen = Object.values(servicesMap).find((s) => s.id === ctx.slots.serviceId);
    }

    if (!chosen) {
      const lines = Object.entries(servicesMap).map(([k, s]) => `${k}. ${s.name}`);
      return reply(
        `Não reconheci o serviço. Por favor escolha:\n\n${lines.join('\n')}\n\nDigite o número, ou diga *menu* para voltar.`,
        'AGUARDANDO_SERVICO',
        ctx
      );
    }

    // Serviço escolhido (por número, nome ou sinônimo) — reaproveita o
    // mesmo caminho do atalho contextual: se a mensagem também já trazia
    // data/período/horário (ex.: cliente digitou "2" e a mensagem anterior
    // tinha "sexta às 14h" preservado em ctx.slots), pula direto pra lá em
    // vez de sempre listar os dias de novo.
    const built = await buildDaysReply(professionalId, chosen, ctx.slots);
    return reply(built.message, built.botState, built.context);
  }

  // ---------- AGUARDANDO_DATA ----------
  if (state === 'AGUARDANDO_DATA') {
    if (isBackCommand(text)) {
      return reply(
        `Ok! 😊 Como posso ajudar?\n\n1️⃣ Agendar horário\n2️⃣ Cancelar agendamento\n3️⃣ Ver meus agendamentos\n4️⃣ Falar com a profissional`,
        'MENU', {}
      );
    }

    const daysMap = ctx.daysMap || {};
    const dateStr = daysMap[text];

    if (!dateStr) {
      // Correção de data dita em texto livre (ex.: "Não, sábado é melhor"),
      // mesmo que não esteja entre as datas inicialmente oferecidas — busca
      // a disponibilidade real daquele dia em vez de inventar horário.
      const mentionedDate = extractDateMention(rawText);
      if (mentionedDate) {
        // Data + horário exato na mesma mensagem (ex.: "sexta às 14:30")
        // pula direto para a confirmação, sem listar horário nenhum.
        const mentionedTime = extractTimeMention(rawText);
        if (mentionedTime) {
          const service = { id: ctx.serviceId, name: ctx.serviceName, duration_minutes: ctx.serviceDuration, price_cents: ctx.servicePrice };
          const direct = await tryDirectBooking(professionalId, service, mentionedDate.toISOString().split('T')[0], mentionedTime);
          if (direct) {
            return reply(direct.message, direct.botState, direct.context);
          }
        }

        const daySlots = await getAvailableSlots(professionalId, mentionedDate, ctx.serviceDuration, { notBefore: customerNotBefore() });
        const period = extractPeriodMention(rawText) || ctx.slots?.period;
        const timeReply = daySlots.length > 0 ? buildTimeReply(mentionedDate, daySlots, ctx, period) : null;
        if (timeReply) {
          return reply(timeReply.message, timeReply.botState, timeReply.context);
        }
        return reply(
          `Não há horários disponíveis em ${formatDateBR(mentionedDate)}. 😕 Escolha outra data:\n\n${Object.entries(daysMap)
            .map(([k, v]) => `${k}. ${formatDateBR(new Date(v + 'T12:00:00'))}`)
            .join('\n')}`,
          'AGUARDANDO_DATA',
          ctx
        );
      }

      const lines = Object.entries(daysMap).map(([k, v]) => {
        const d = new Date(v + 'T12:00:00');
        return `${k}. ${formatDateBR(d)}`;
      });
      return reply(
        `Por favor escolha uma das datas disponíveis:\n\n${lines.join('\n')}\n\nDigite o número, ou diga *menu* para voltar.`,
        'AGUARDANDO_DATA',
        ctx
      );
    }

    // Load slots for that date
    const d = new Date(dateStr + 'T12:00:00-03:00');
    const slots = await getAvailableSlots(professionalId, d, ctx.serviceDuration, { notBefore: customerNotBefore() });

    if (slots.length === 0) {
      return reply(
        `Não há horários disponíveis nessa data. Escolha outra:\n\n${Object.entries(daysMap)
          .map(([k, v]) => `${k}. ${formatDateBR(new Date(v + 'T12:00:00'))}`)
          .join('\n')}`,
        'AGUARDANDO_DATA',
        ctx
      );
    }

    const slotsMap = {};
    const lines = slots.slice(0, 8).map((s, i) => {
      slotsMap[String(i + 1)] = s.start.toISOString();
      return `${i + 1}. ${formatTimeBR(s.start)}`;
    });

    return reply(
      `${formatDateBR(d)} 📅\n\nHorários disponíveis:\n\n${lines.join('\n')}\n\nDigite o número do horário.`,
      'AGUARDANDO_HORARIO',
      { ...ctx, selectedDate: dateStr, slotsMap, abandonment_notified: false }
    );
  }

  // ---------- AGUARDANDO_HORARIO ----------
  if (state === 'AGUARDANDO_HORARIO') {
    if (isBackCommand(text)) {
      return reply(
        `Ok! 😊 Como posso ajudar?\n\n1️⃣ Agendar horário\n2️⃣ Cancelar agendamento\n3️⃣ Ver meus agendamentos\n4️⃣ Falar com a profissional`,
        'MENU', {}
      );
    }

    const slotsMap = ctx.slotsMap || {};
    let slotIso = slotsMap[text];

    if (!slotIso) {
      const mentionedDate = extractDateMention(rawText);
      const mentionedTime = extractTimeMention(rawText);

      // Troca de dia dita nesta etapa (ex.: "sexta às 14h" ou só "sábado é
      // melhor") — verificada ANTES do período/hora do dia atual, senão
      // "sexta às 14h" tentaria achar 14h na grade do dia errado.
      if (mentionedDate) {
        const mentionedDateStr = mentionedDate.toISOString().split('T')[0];
        if (mentionedTime) {
          const service = { id: ctx.serviceId, name: ctx.serviceName, duration_minutes: ctx.serviceDuration, price_cents: ctx.servicePrice };
          const direct = await tryDirectBooking(professionalId, service, mentionedDateStr, mentionedTime);
          if (direct) {
            return reply(direct.message, direct.botState, direct.context);
          }
        }

        const daySlots = await getAvailableSlots(professionalId, mentionedDate, ctx.serviceDuration, { notBefore: customerNotBefore() });
        const newPeriod = extractPeriodMention(rawText) || ctx.slots?.period;
        const timeReply = daySlots.length > 0 ? buildTimeReply(mentionedDate, daySlots, ctx, newPeriod) : null;
        if (timeReply) {
          return reply(timeReply.message, timeReply.botState, timeReply.context);
        }
      } else {
        // Sem troca de dia: período ou horário exato dentro do MESMO dia
        // já escolhido.

        // Correção de período dita em texto livre (ex.: "Pode ser qualquer
        // horário à tarde") — refiltra os horários do MESMO dia já
        // escolhido, sem consultar de novo o banco além do necessário.
        const period = extractPeriodMention(rawText);
        if (period && ctx.selectedDate) {
          const d = new Date(ctx.selectedDate + 'T12:00:00-03:00');
          const daySlots = await getAvailableSlots(professionalId, d, ctx.serviceDuration, { notBefore: customerNotBefore() });
          const timeReply = buildTimeReply(d, daySlots, ctx, period);
          if (timeReply) {
            return reply(timeReply.message, timeReply.botState, timeReply.context);
          }
          return reply(
            `Não há horários nesse período para essa data. 😕 Escolha um dos horários abaixo:\n\n${Object.entries(slotsMap)
              .map(([k, v]) => `${k}. ${formatTimeBR(new Date(v))}`)
              .join('\n')}`,
            'AGUARDANDO_HORARIO',
            ctx
          );
        }

        // Horário exato dito em texto livre (ex.: "10:30", "10h30", "às
        // 10:30", "10 e meia", "dez e meia") — seleciona direto a opção
        // correspondente na grade já oferecida, sem exigir o número. Só
        // age quando o texto não foi reconhecido como período acima
        // (então "18h" sozinho seleciona o horário das 18h, mas "depois
        // das 18h" continua sendo tratado como período, igual antes).
        if (mentionedTime) {
          const matches = Object.entries(slotsMap).filter(([, iso]) => {
            const d = new Date(iso);
            const [h, m] = d
              .toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hour12: false })
              .split(':')
              .map(Number);
            return h === mentionedTime.hour && m === mentionedTime.minute;
          });
          if (matches.length === 1) {
            slotIso = matches[0][1];
          } else if (matches.length === 0) {
            // Horário reconhecido, mas fora da grade oferecida — explica e
            // mostra as opções válidas, sem inventar nenhum horário novo.
            const lines = Object.entries(slotsMap).map(([k, v]) => `${k}. ${formatTimeBR(new Date(v))}`);
            return reply(
              `Esse horário não está entre os disponíveis. 😕 Escolha um destes:\n\n${lines.join('\n')}\n\nDigite o número, ou diga *menu* para voltar.`,
              'AGUARDANDO_HORARIO',
              ctx
            );
          }
          // matches.length > 1 não deveria acontecer numa grade de 30 em
          // 30 minutos, mas por segurança cai no fallback abaixo sem
          // selecionar nada sozinho.
        }
      }

      // A partir daqui, só continua se nenhum horário exato foi resolvido
      // acima — se foi, `slotIso` já está preenchido e o fluxo segue
      // direto para a revalidação de disponibilidade logo abaixo.
      if (!slotIso) {
        const lines = Object.entries(slotsMap).map(([k, v]) => `${k}. ${formatTimeBR(new Date(v))}`);
        return reply(
          `Por favor escolha um dos horários:\n\n${lines.join('\n')}\n\nDigite o número, ou diga *menu* para voltar.`,
          'AGUARDANDO_HORARIO',
          ctx
        );
      }
    }

    // Validate availability one more time
    const check = await checkSlotAvailability(professionalId, ctx.serviceId, slotIso, null, { notBefore: customerNotBefore() });
    if (!check.available) {
      return reply(
        `Esse horário não está mais disponível. 😕 Vamos escolher outro?\n\n${
          Object.entries(slotsMap).map(([k, v]) => `${k}. ${formatTimeBR(new Date(v))}`).join('\n')
        }`,
        'AGUARDANDO_HORARIO',
        ctx
      );
    }

    return reply(
      formatConfirmationMessage(ctx.serviceName, slotIso, ctx.servicePrice),
      'AGUARDANDO_CONFIRMACAO_AGENDAMENTO',
      { ...ctx, selectedSlot: slotIso, abandonment_notified: false }
    );
  }

  // ---------- AGUARDANDO_CONFIRMACAO_AGENDAMENTO ----------
  if (state === 'AGUARDANDO_CONFIRMACAO_AGENDAMENTO') {
    if (isBackCommand(text)) {
      return reply(
        `Ok! 😊 Como posso ajudar?\n\n1️⃣ Agendar horário\n2️⃣ Cancelar agendamento\n3️⃣ Ver meus agendamentos\n4️⃣ Falar com a profissional`,
        'MENU', {}
      );
    }

    const answer = classifyReply(rawText, 'booking');

    if (answer === 'yes') {
      // Find or create client
      const client = await findOrCreateClient(professionalId, phone, pushName || 'Cliente WhatsApp');

      // Validate one last time
      const check = await checkSlotAvailability(professionalId, ctx.serviceId, ctx.selectedSlot, null, { notBefore: customerNotBefore() });
      if (!check.available) {
        const days = await getAvailableDaysWithSlots(professionalId, ctx.serviceDuration);
        if (days.length === 0) {
          return reply('Não há mais horários disponíveis. Por favor, tente novamente mais tarde. 😊', 'MENU', {});
        }
        const daysMap = {};
        const lines = days.map((d, i) => {
          daysMap[String(i + 1)] = d.date.toISOString().split('T')[0];
          return `${i + 1}. ${formatDateBR(d.date)}`;
        });
        return reply(
          `${check.reason === 'past_time'
            ? 'Esse horário não está mais disponível para reserva neste momento. 😕 Vamos escolher outro?'
            : 'Esse horário acabou de ser ocupado! 😕 Vamos escolher outro?'}\n\n${lines.join('\n')}\n\nDigite o número da data.`,
          'AGUARDANDO_DATA',
          { ...ctx, daysMap, slotsMap: undefined, selectedSlot: undefined, selectedDate: undefined }
        );
      }

      // Create appointment
      const { rows: svcRows } = await pool.query(
        'SELECT price_cents FROM services WHERE id = $1 AND professional_id = $2',
        [ctx.serviceId, professionalId]
      );
      const { rows: apptRows } = await pool.query(
        `INSERT INTO appointments
           (professional_id, client_id, service_id, starts_at, ends_at, status, price_cents_snapshot)
         VALUES ($1,$2,$3,$4,$5,'pendente',$6)
         RETURNING *`,
        [
          professionalId,
          client.id,
          ctx.serviceId,
          new Date(check.startsAt),
          new Date(check.endsAt),
          svcRows[0]?.price_cents ?? ctx.servicePrice,
        ]
      );

      const dateFormatted = formatDateBR(new Date(ctx.selectedSlot));
      const timeFormatted = formatTimeBR(new Date(ctx.selectedSlot));

      return reply(
        `Prontinho! 💅 *${ctx.serviceName}* confirmado para ${dateFormatted} às ${timeFormatted}. Qualquer coisa, é só chamar! 😊`,
        'MENU',
        {}
      );
    }

    if (answer === 'no') {
      return reply(
        `Tudo bem! 😊 O que mais posso ajudar?\n\n1️⃣ Agendar horário\n2️⃣ Cancelar agendamento\n3️⃣ Ver meus agendamentos\n4️⃣ Falar com a profissional`,
        'MENU',
        {}
      );
    }

    // Correção sem precisar responder sim/não primeiro (ex.: "Na verdade
    // pode ser 15h" ou "prefiro sábado") — mantém serviço e o resto do
    // contexto, só troca o horário/data proposto. Nunca confirma sozinho:
    // sempre revalida a disponibilidade e volta a pedir "sim/não".
    const correctionTime = extractTimeMention(rawText);
    if (correctionTime && ctx.selectedDate) {
      const service = { id: ctx.serviceId, name: ctx.serviceName, duration_minutes: ctx.serviceDuration, price_cents: ctx.servicePrice };
      const direct = await tryDirectBooking(professionalId, service, ctx.selectedDate, correctionTime);
      if (direct) {
        return reply(direct.message, direct.botState, direct.context);
      }
      const horaAtual = formatTimeBR(new Date(ctx.selectedSlot));
      return reply(
        `Esse horário não está disponível nesse dia. 😕 Quer tentar outro horário, ou confirmo o que já tínhamos combinado (${horaAtual})? Responda *sim* para confirmar ou me diga outro horário.`,
        'AGUARDANDO_CONFIRMACAO_AGENDAMENTO',
        ctx
      );
    }

    const correctionDate = extractDateMention(rawText);
    if (correctionDate) {
      const daySlots = await getAvailableSlots(professionalId, correctionDate, ctx.serviceDuration, { notBefore: customerNotBefore() });
      const period = extractPeriodMention(rawText) || ctx.slots?.period;
      const timeReply = daySlots.length > 0 ? buildTimeReply(correctionDate, daySlots, ctx, period) : null;
      if (timeReply) {
        return reply(timeReply.message, timeReply.botState, timeReply.context);
      }
    }

    return reply(
      `Por favor responda *sim* para confirmar, *não* para cancelar, ou me diga outro horário/data se quiser mudar. 😊`,
      'AGUARDANDO_CONFIRMACAO_AGENDAMENTO',
      ctx
    );
  }

  // ---------- AGUARDANDO_CANCELAMENTO ----------
  if (state === 'AGUARDANDO_CANCELAMENTO') {
    if (isBackCommand(text)) {
      return reply(
        `Ok! 😊 Como posso ajudar?\n\n1️⃣ Agendar horário\n2️⃣ Cancelar agendamento\n3️⃣ Ver meus agendamentos\n4️⃣ Falar com a profissional`,
        'MENU', {}
      );
    }

    const apptMap = ctx.apptMap || {};
    const apptId = apptMap[text];

    if (!apptId) {
      return reply(
        `Por favor escolha o número do agendamento a cancelar:\n\n${Object.keys(apptMap).map(k => `${k}. agendamento ${k}`).join('\n')}\n\nOu diga *menu* para voltar.`,
        'AGUARDANDO_CANCELAMENTO',
        ctx
      );
    }

    // Get appointment details for confirmation.
    // Exige tambem client_id: apptId vem de apptMap (context), que pode ter
    // sido adulterado via POST /bot/conversation/:phone; sem essa checagem,
    // uma conversa poderia confirmar o cancelamento do agendamento de OUTRA
    // cliente da mesma profissional.
    const cancelClient = await findClientByPhone(professionalId, phone);
    const { rows } = await pool.query(
      `SELECT a.starts_at, s.name AS service_name FROM appointments a
       JOIN services s ON s.id = a.service_id
       WHERE a.id = $1 AND a.professional_id = $2 AND a.client_id = $3`,
      [apptId, professionalId, cancelClient?.id ?? null]
    );
    if (!rows[0]) {
      return reply('Agendamento não encontrado. 😕', 'MENU', {});
    }

    return reply(
      `Posso cancelar *${rows[0].service_name}* de ${formatDateBR(rows[0].starts_at)} às ${formatTimeBR(rows[0].starts_at)}? (sim / não)`,
      'AGUARDANDO_CONFIRMACAO_CANCELAMENTO',
      { ...ctx, apptIdToCancel: apptId, abandonment_notified: false }
    );
  }

  // ---------- AGUARDANDO_CONFIRMACAO_CANCELAMENTO ----------
  if (state === 'AGUARDANDO_CONFIRMACAO_CANCELAMENTO') {
    if (isBackCommand(text)) {
      return reply(
        `Ok! 😊 Como posso ajudar?\n\n1️⃣ Agendar horário\n2️⃣ Cancelar agendamento\n3️⃣ Ver meus agendamentos\n4️⃣ Falar com a profissional`,
        'MENU', {}
      );
    }

    const answer = classifyReply(rawText, 'cancel');

    if (answer === 'yes') {
      // Mesma exigencia de client_id do passo anterior, para o caso de o
      // estado ter sido forjado direto em AGUARDANDO_CONFIRMACAO_CANCELAMENTO
      // (pulando a etapa de listagem) via POST /bot/conversation/:phone.
      const cancelClient = await findClientByPhone(professionalId, phone);
      const { rowCount } = await pool.query(
        `UPDATE appointments SET status = 'cancelado'
         WHERE id = $1 AND professional_id = $2 AND client_id = $3`,
        [ctx.apptIdToCancel, professionalId, cancelClient?.id ?? null]
      );
      if (rowCount === 0) {
        return reply('Agendamento não encontrado. 😕', 'MENU', {});
      }
      return reply(
        `Prontinho, cancelado! ✅ Se quiser remarcar, é só me chamar. 😊`,
        'MENU',
        {}
      );
    }

    if (answer === 'no') {
      return reply(
        `Ok, mantive seu agendamento! 😊 Posso ajudar com mais alguma coisa?\n\n1️⃣ Agendar horário\n2️⃣ Cancelar agendamento`,
        'MENU',
        {}
      );
    }

    return reply(
      `Por favor responda *sim* para cancelar ou *não* para manter. 😊`,
      'AGUARDANDO_CONFIRMACAO_CANCELAMENTO',
      ctx
    );
  }

  // ---------- AGUARDANDO_REPETICAO ----------
  if (state === 'AGUARDANDO_REPETICAO') {
    const answer = classifyReply(rawText, 'repeat');

    if (isBackCommand(text) || answer === 'no') {
      return reply(
        `Sem problema! 😊 Como posso ajudar?

1️⃣ Agendar horário
2️⃣ Cancelar agendamento
3️⃣ Ver meus agendamentos
4️⃣ Falar com a profissional`,
        'MENU',
        {}
      );
    }

    if (answer === 'yes') {
      const { lastServiceId, lastServiceName, lastServiceDuration, lastServicePrice } = ctx;

      if (!lastServiceId) {
        return reply(
          `Ops, perdi o contexto. 😅 Como posso ajudar?

1️⃣ Agendar horário
2️⃣ Cancelar agendamento
3️⃣ Ver meus agendamentos
4️⃣ Falar com a profissional`,
          'MENU',
          {}
        );
      }

      const days = await getAvailableDaysWithSlots(professionalId, lastServiceDuration);
      if (days.length === 0) {
        return reply(
          `No momento não há horários disponíveis para ${lastServiceName}. 😊 Posso ajudar com outra coisa?

1️⃣ Agendar horário
2️⃣ Cancelar agendamento`,
          'MENU',
          {}
        );
      }

      const daysMap = {};
      const lines = days.map((d, i) => {
        daysMap[String(i + 1)] = d.date.toISOString().split('T')[0];
        return `${i + 1}. ${formatDateBR(d.date)}`;
      });

      return reply(
        `Ótimo! ${lastServiceName} 💅

Escolha a data:

${lines.join('\n')}

Digite o número da data.`,
        'AGUARDANDO_DATA',
        {
          serviceId: lastServiceId,
          serviceName: lastServiceName,
          serviceDuration: lastServiceDuration,
          servicePrice: lastServicePrice,
          daysMap,
          abandonment_notified: false,
        }
      );
    }

    return reply(
      `Responde *sim* para marcar ${ctx.lastServiceName || 'o mesmo serviço'} ou *não* para ver outras opções. 😊`,
      'AGUARDANDO_REPETICAO',
      ctx
    );
  }

  // Fallback: reset to MENU
  return reply(
    `Oi! 😊 Como posso ajudar?

1️⃣ Agendar horário
2️⃣ Cancelar agendamento
3️⃣ Ver meus agendamentos
4️⃣ Falar com a profissional`,
    'MENU',
    {}
  );
}

// ---------- Route handlers ----------

// POST /bot/process
export async function getProfessionalInstances(req, res, next) {
  try {
    const { rows } = await pool.query(
      'SELECT wa_instance_name FROM professionals WHERE wa_instance_name IS NOT NULL ORDER BY created_at ASC'
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
}

export async function processMessage(req, res, next) {
  try {
    const { phone: rawPhone, text, waMessageId, fromMe, pushName } = req.body;
    if (!rawPhone || text === undefined || text === null) {
      return res.status(400).json({ error: 'phone e text são obrigatórios.' });
    }

    const phone = cleanPhone(rawPhone);
    const professionalId = req.professionalId;

    // --- fromMe = true: bot echo or professional message ---
    if (fromMe) {
      const existing = await findMessageBySender(professionalId, waMessageId);
      if (existing?.sender === 'bot') {
        return res.json({ reply: null, reason: 'bot_echo' });
      }

      const normalized = normalizeText(text);

      // "#bot" command returns control to bot
      if (normalized === '#bot') {
        await getOrCreateConversation(professionalId, phone);
        await updateConversation(professionalId, phone, { mode: 'BOT_ATIVO', botState: 'INICIO', context: {} });
        await recordMessage(professionalId, phone, {
          waMessageId,
          direction: 'outbound',
          sender: 'professional',
          content: text,
        });
        return res.json({ reply: null, reason: 'bot_activated' });
      }

      // Professional manual message → ATENDIMENTO_HUMANO
      await getOrCreateConversation(professionalId, phone);
      await updateConversation(professionalId, phone, { mode: 'ATENDIMENTO_HUMANO' });
      await recordMessage(professionalId, phone, {
        waMessageId,
        direction: 'outbound',
        sender: 'professional',
        content: text,
      });
      return res.json({ reply: null, reason: 'professional_message' });
    }

    // --- fromMe = false: message from client ---

    // Dedup check (in case webhook fires twice)
    if (waMessageId) {
      const existing = await findMessageBySender(professionalId, waMessageId);
      if (existing) {
        return res.json({ reply: null, reason: 'duplicate' });
      }
    }

    // Record incoming message
    await recordMessage(professionalId, phone, {
      waMessageId,
      direction: 'inbound',
      sender: 'client',
      content: text,
    });

    // Lê last_message_at anterior (necessário para TTL do BOT_ATIVO)
    const { rows: _prevRows } = await pool.query(
      'SELECT last_message_at, updated_at FROM conversation_states WHERE professional_id = $1 AND phone = $2 LIMIT 1',
      [professionalId, phone]
    );
    const _prevLastMsgAt = _prevRows[0]?.last_message_at ?? null;
    const _prevUpdatedAt = _prevRows[0]?.updated_at ?? null;

    // Get or create conversation (atualiza last_message_at = now())
    const conv = await getOrCreateConversation(professionalId, phone);

    const _TTL_MS = 4 * 60 * 60 * 1000;

    // ATENDIMENTO_HUMANO: TTL medido desde a última mensagem outbound da profissional.
    // Mensagens bloqueadas da cliente não reiniciam esse prazo.
    if (conv.mode === 'ATENDIMENTO_HUMANO') {
      const { rows: _profRows } = await pool.query(
        `SELECT created_at FROM message_history
         WHERE professional_id = $1 AND phone = $2
           AND direction = 'outbound' AND sender = 'professional'
         ORDER BY created_at DESC LIMIT 1`,
        [professionalId, phone]
      );
      const _profLastAt = _profRows[0]?.created_at ?? null;
      // TTL baseado na última mensagem da profissional.
      // Se nunca houve mensagem da profissional (cliente acabou de entrar em human_mode),
      // usa Date.now() para não expirar imediatamente.
      // Evita depender de updated_at, que o trigger de banco contamina a cada mensagem do cliente.
      const _modeTime = _profLastAt ? new Date(_profLastAt).getTime() : Date.now();
      const _msecSinceProfessional = Date.now() - _modeTime;

      if (_msecSinceProfessional > _TTL_MS) {
        // Mais de 4h desde a última mensagem da profissional → retorna ao bot
        await updateConversation(professionalId, phone, { mode: 'BOT_ATIVO', botState: 'INICIO', context: {} });
        conv.mode = 'BOT_ATIVO';
        conv.bot_state = 'INICIO';
        conv.context = {};
      } else {
        // Dentro das 4h → mantém silêncio
        return res.json({ reply: null, reason: 'human_mode' });
      }
    }

    // BOT_ATIVO + 4h sem mensagem → reinicia do INICIO
    if (conv.mode === 'BOT_ATIVO' && _prevLastMsgAt) {
      const _msecElapsed = Date.now() - new Date(_prevLastMsgAt).getTime();
      if (_msecElapsed > _TTL_MS) {
        await updateConversation(professionalId, phone, { botState: 'INICIO', context: {} });
        conv.bot_state = 'INICIO';
        conv.context = {};
      }
    }

    // Run bot state machine
    const replyText = await runStateMachine(conv, text, phone, professionalId, pushName);
    return res.json({ reply: replyText });
  } catch (err) {
    next(err);
  }
}

// POST /bot/record-sent  { phone, waMessageId, content }
export async function recordSentMessage(req, res, next) {
  try {
    const { phone: rawPhone, waMessageId, content } = req.body;
    const phone = cleanPhone(rawPhone);
    await recordMessage(req.professionalId, phone, {
      waMessageId,
      direction: 'outbound',
      sender: 'bot',
      content: content || '',
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

// GET /bot/conversation/:phone
export async function getConversation(req, res, next) {
  try {
    const phone = cleanPhone(req.params.phone);
    const { rows } = await pool.query(
      'SELECT * FROM conversation_states WHERE professional_id = $1 AND phone = $2 LIMIT 1',
      [req.professionalId, phone]
    );
    res.json(rows[0] ?? null);
  } catch (err) {
    next(err);
  }
}

// POST /bot/conversation/:phone  { mode?, botState?, context? }
export async function setConversation(req, res, next) {
  try {
    const phone = cleanPhone(req.params.phone);
    const { mode, botState, context } = req.body;
    await getOrCreateConversation(req.professionalId, phone);
    await updateConversation(req.professionalId, phone, { mode, botState, context });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

// GET /bot/abandoned-conversations
// Returns conversations stuck in AGUARDANDO_* for 30+ min with abandonment_notified != true
export async function getAbandonedConversations(req, res, next) {
  try {
    const { rows } = await pool.query(
      `SELECT professional_id, phone, bot_state, context, last_message_at
       FROM conversation_states
       WHERE professional_id = $1
         AND bot_state LIKE 'AGUARDANDO_%'
         AND mode = 'BOT_ATIVO'
         AND last_message_at < now() - interval '30 minutes'
         AND (context->>'abandonment_notified') IS DISTINCT FROM 'true'`,
      [req.professionalId]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
}

// POST /bot/mark-abandonment-notified  { phone }
export async function markAbandonmentNotified(req, res, next) {
  try {
    const phone = cleanPhone(req.body.phone);
    await pool.query(
      `UPDATE conversation_states
       SET context = context || '{"abandonment_notified": true}'::jsonb,
           updated_at = now()
       WHERE professional_id = $1 AND phone = $2`,
      [req.professionalId, phone]
    );
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

// GET /bot/appointments-tomorrow
// Returns tomorrow's appointments (confirmado|pendente, reminder_sent=false) for reminder cron
// GET /bot/appointments-for-reminder
// Returns appointments in the 23h30-24h30 window from now with reminder_sent=false
export async function getAppointmentsTomorrow(req, res, next) {
  try {
    const { rows } = await pool.query(
      `SELECT a.id, a.starts_at, a.status, a.reminder_sent,
              c.name AS client_name, c.phone AS client_phone,
              s.name AS service_name
       FROM appointments a
       JOIN clients  c ON c.id = a.client_id
       JOIN services s ON s.id = a.service_id
       WHERE a.professional_id = $1
         AND a.status IN ('confirmado', 'pendente')
         AND a.reminder_sent = false
         AND a.starts_at >= now() + interval '23 hours 30 minutes'
         AND a.starts_at <  now() + interval '24 hours 30 minutes'
       ORDER BY a.starts_at ASC`,
      [req.professionalId]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
}

export async function markReminderSent(req, res, next) {
  try {
    const { appointmentId } = req.body;
    if (!appointmentId) return res.status(400).json({ error: 'appointmentId obrigatório.' });
    await pool.query(
      `UPDATE appointments SET reminder_sent = true, updated_at = now()
       WHERE id = $1 AND professional_id = $2`,
      [appointmentId, req.professionalId]
    );
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}
