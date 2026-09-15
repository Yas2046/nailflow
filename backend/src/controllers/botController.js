import { pool } from '../config/db.js';
import { HttpError } from '../middleware/errorHandler.js';
import { checkSlotAvailability, getAvailableSlots } from '../utils/availability.js';
import { zonedTimeToUtc } from '../utils/timezone.js';

// ---------- helpers ----------

function cleanPhone(raw) {
  return String(raw).replace('@s.whatsapp.net', '').replace(/\D/g, '');
}

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

async function findClientByPhone(professionalId, phone) {
  const { rows } = await pool.query(
    `SELECT * FROM clients
     WHERE professional_id = $1
       AND regexp_replace(phone, '\\D', '', 'g') = $2 LIMIT 1`,
    [professionalId, phone]
  );
  return rows[0] ?? null;
}

async function findOrCreateClient(professionalId, phone, name) {
  const existing = await findClientByPhone(professionalId, phone);
  if (existing) return existing;
  const { rows } = await pool.query(
    `INSERT INTO clients (professional_id, name, phone) VALUES ($1,$2,$3)
     ON CONFLICT (professional_id, phone) DO UPDATE SET name = EXCLUDED.name
     RETURNING *`,
    [professionalId, name || 'Cliente WhatsApp', phone]
  );
  return rows[0];
}

async function listActiveServices(professionalId) {
  const { rows } = await pool.query(
    `SELECT id, name, description, price_cents, duration_minutes
     FROM services WHERE professional_id = $1 AND active = true ORDER BY name ASC`,
    [professionalId]
  );
  return rows;
}

async function getUpcomingAppointments(professionalId, phone) {
  const client = await findClientByPhone(professionalId, phone);
  if (!client) return [];
  const { rows } = await pool.query(
    `SELECT a.id, a.starts_at, a.ends_at, a.status, s.name AS service_name
     FROM appointments a JOIN services s ON s.id = a.service_id
     WHERE a.client_id = $1
       AND a.status IN ('pendente','confirmado')
       AND a.starts_at > now()
     ORDER BY a.starts_at ASC`,
    [client.id]
  );
  return rows;
}

// Returns up to maxDays days that have slots for given service duration
async function getAvailableDaysWithSlots(professionalId, durationMinutes, maxDays = 5) {
  const days = [];
  const today = new Date();
  for (let i = 1; i <= 21 && days.length < maxDays; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    d.setHours(12, 0, 0, 0); // use noon so timezone math is safe
    const slots = await getAvailableSlots(professionalId, d, durationMinutes);
    if (slots.length > 0) {
      days.push({ date: d, slots });
    }
  }
  return days;
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

  // ---------- INICIO ----------
  if (state === 'INICIO') {
    return reply(
      `Oi! 😊 Seja bem-vinda!\n\nComo posso ajudar?\n\n1️⃣ Agendar horário\n2️⃣ Cancelar agendamento\n3️⃣ Ver meus agendamentos`,
      'MENU',
      {}
    );
  }

  // ---------- MENU ----------
  if (state === 'MENU') {
    // agendar
    if (/^1$/.test(text) || /agendar|marcar|horario|quero marcar/.test(text)) {
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

    // cancelar
    if (/^2$/.test(text) || /cancelar|cancela/.test(text)) {
      const appointments = await getUpcomingAppointments(professionalId, phone);
      if (appointments.length === 0) {
        return reply('Não encontrei agendamentos ativos. 😊 Posso ajudar com mais alguma coisa?', 'MENU', {});
      }
      const apptMap = {};
      const lines = appointments.map((a, i) => {
        apptMap[String(i + 1)] = a.id;
        return `${i + 1}. ${a.service_name} - ${formatDateBR(a.starts_at)} às ${formatTimeBR(a.starts_at)}`;
      });
      return reply(
        `Encontrei seus agendamentos:\n\n${lines.join('\n')}\n\nQual deseja cancelar? (Digite o número)`,
        'AGUARDANDO_CANCELAMENTO',
        { apptMap, abandonment_notified: false }
      );
    }

    // ver agendamentos
    if (/^3$/.test(text) || /ver|meu|agendamento|proximo/.test(text)) {
      const appointments = await getUpcomingAppointments(professionalId, phone);
      if (appointments.length === 0) {
        return reply('Você não possui agendamentos futuros. 😊\n\nPosso ajudar com mais alguma coisa?\n\n1️⃣ Agendar horário\n2️⃣ Cancelar agendamento', 'MENU', {});
      }
      const lines = appointments.map(
        (a) => `• ${a.service_name}: ${formatDateBR(a.starts_at)} às ${formatTimeBR(a.starts_at)}`
      );
      return reply(
        `Seus próximos agendamentos:\n\n${lines.join('\n')}\n\nPosso ajudar com mais alguma coisa?\n\n1️⃣ Agendar horário\n2️⃣ Cancelar agendamento`,
        'MENU',
        {}
      );
    }

    // saudação no meio de uma conversa
    if (/^(oi|ola|bom dia|boa tarde|boa noite|hello|hi)/.test(text)) {
      return reply(
        `Olá! 😊 Como posso ajudar?\n\n1️⃣ Agendar horário\n2️⃣ Cancelar agendamento\n3️⃣ Ver meus agendamentos`,
        'MENU',
        {}
      );
    }

    // Retry counter for unrecognized MENU input
    const menuRetries = (ctx.menuRetries || 0) + 1;
    if (menuRetries >= 3) {
      await updateConversation(professionalId, phone, { mode: 'ATENDIMENTO_HUMANO', botState: 'MENU', context: {} });
      return `Parece que não estou conseguindo te ajudar da forma certa. 😊 Vou chamar a profissional para te atender melhor! Aguarda um momento. 🌸`;
    }
    return reply(
      `Não entendi. 😊 Por favor escolha uma opção:\n\n1️⃣ Agendar horário\n2️⃣ Cancelar agendamento\n3️⃣ Ver meus agendamentos`,
      'MENU',
      { ...ctx, menuRetries }
    );
  }

  // ---------- AGUARDANDO_SERVICO ----------
  if (state === 'AGUARDANDO_SERVICO') {
    if (isBackCommand(text)) {
      return reply(
        `Ok! 😊 Como posso ajudar?\n\n1️⃣ Agendar horário\n2️⃣ Cancelar agendamento\n3️⃣ Ver meus agendamentos`,
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

    if (!chosen) {
      const lines = Object.entries(servicesMap).map(([k, s]) => `${k}. ${s.name}`);
      return reply(
        `Não reconheci o serviço. Por favor escolha:\n\n${lines.join('\n')}\n\nDigite o número, ou diga *menu* para voltar.`,
        'AGUARDANDO_SERVICO',
        ctx
      );
    }

    // Load available days
    const days = await getAvailableDaysWithSlots(professionalId, chosen.duration_minutes);
    if (days.length === 0) {
      return reply(
        `No momento não há horários disponíveis para ${chosen.name}. Tente novamente mais tarde ou entre em contato diretamente. 😊`,
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
      `Ótimo! ${chosen.name} 💅\n\nEscolha a data:\n\n${lines.join('\n')}\n\nDigite o número da data.`,
      'AGUARDANDO_DATA',
      {
        serviceId: chosen.id,
        serviceName: chosen.name,
        serviceDuration: chosen.duration_minutes,
        servicePrice: chosen.price_cents,
        daysMap,
        abandonment_notified: false,
      }
    );
  }

  // ---------- AGUARDANDO_DATA ----------
  if (state === 'AGUARDANDO_DATA') {
    if (isBackCommand(text)) {
      return reply(
        `Ok! 😊 Como posso ajudar?\n\n1️⃣ Agendar horário\n2️⃣ Cancelar agendamento\n3️⃣ Ver meus agendamentos`,
        'MENU', {}
      );
    }

    const daysMap = ctx.daysMap || {};
    const dateStr = daysMap[text];

    if (!dateStr) {
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
    const slots = await getAvailableSlots(professionalId, d, ctx.serviceDuration);

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
        `Ok! 😊 Como posso ajudar?\n\n1️⃣ Agendar horário\n2️⃣ Cancelar agendamento\n3️⃣ Ver meus agendamentos`,
        'MENU', {}
      );
    }

    const slotsMap = ctx.slotsMap || {};
    const slotIso = slotsMap[text];

    if (!slotIso) {
      const lines = Object.entries(slotsMap).map(([k, v]) => `${k}. ${formatTimeBR(new Date(v))}`);
      return reply(
        `Por favor escolha um dos horários:\n\n${lines.join('\n')}\n\nDigite o número, ou diga *menu* para voltar.`,
        'AGUARDANDO_HORARIO',
        ctx
      );
    }

    // Validate availability one more time
    const check = await checkSlotAvailability(professionalId, ctx.serviceId, slotIso);
    if (!check.available) {
      return reply(
        `Esse horário não está mais disponível. 😕 Vamos escolher outro?\n\n${
          Object.entries(slotsMap).map(([k, v]) => `${k}. ${formatTimeBR(new Date(v))}`).join('\n')
        }`,
        'AGUARDANDO_HORARIO',
        ctx
      );
    }

    const dateFormatted = formatDateBR(new Date(slotIso));
    const timeFormatted = formatTimeBR(new Date(slotIso));

    return reply(
      `Perfeito! 😊 Vou confirmar:\n\n📌 Serviço: ${ctx.serviceName}\n📅 Data: ${dateFormatted}\n⏰ Hora: ${timeFormatted}\n💰 Valor: ${formatPrice(ctx.servicePrice)}\n\nConfirma? (sim / não)`,
      'AGUARDANDO_CONFIRMACAO_AGENDAMENTO',
      { ...ctx, selectedSlot: slotIso, abandonment_notified: false }
    );
  }

  // ---------- AGUARDANDO_CONFIRMACAO_AGENDAMENTO ----------
  if (state === 'AGUARDANDO_CONFIRMACAO_AGENDAMENTO') {
    if (isBackCommand(text)) {
      return reply(
        `Ok! 😊 Como posso ajudar?\n\n1️⃣ Agendar horário\n2️⃣ Cancelar agendamento\n3️⃣ Ver meus agendamentos`,
        'MENU', {}
      );
    }

    if (/^(s|sim|yes|confirma|ok|isso)/.test(text)) {
      // Find or create client
      const client = await findOrCreateClient(professionalId, phone, pushName || 'Cliente WhatsApp');

      // Validate one last time
      const check = await checkSlotAvailability(professionalId, ctx.serviceId, ctx.selectedSlot);
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
          `Esse horário acabou de ser ocupado! 😕 Vamos escolher outro?\n\n${lines.join('\n')}\n\nDigite o número da data.`,
          'AGUARDANDO_DATA',
          { ...ctx, daysMap, slotsMap: undefined, selectedSlot: undefined, selectedDate: undefined }
        );
      }

      // Create appointment
      const { rows: svcRows } = await pool.query(
        'SELECT price_cents FROM services WHERE id = $1',
        [ctx.serviceId]
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
        `Prontinho! 💅 Seu horário foi marcado:\n\n📌 ${ctx.serviceName}\n📅 ${dateFormatted}\n⏰ ${timeFormatted}\n\nSe precisar cancelar ou alterar, é só me avisar. Até lá! 😊`,
        'MENU',
        {}
      );
    }

    if (/^(n|nao|nope|cancel)/.test(text)) {
      return reply(
        `Tudo bem! 😊 O que mais posso ajudar?\n\n1️⃣ Agendar horário\n2️⃣ Cancelar agendamento\n3️⃣ Ver meus agendamentos`,
        'MENU',
        {}
      );
    }

    return reply(
      `Por favor responda *sim* para confirmar ou *não* para cancelar. 😊`,
      'AGUARDANDO_CONFIRMACAO_AGENDAMENTO',
      ctx
    );
  }

  // ---------- AGUARDANDO_CANCELAMENTO ----------
  if (state === 'AGUARDANDO_CANCELAMENTO') {
    if (isBackCommand(text)) {
      return reply(
        `Ok! 😊 Como posso ajudar?\n\n1️⃣ Agendar horário\n2️⃣ Cancelar agendamento\n3️⃣ Ver meus agendamentos`,
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

    // Get appointment details for confirmation
    const { rows } = await pool.query(
      `SELECT a.starts_at, s.name AS service_name FROM appointments a
       JOIN services s ON s.id = a.service_id WHERE a.id = $1`,
      [apptId]
    );
    if (!rows[0]) {
      return reply('Agendamento não encontrado. 😕', 'MENU', {});
    }

    return reply(
      `Confirma o cancelamento?\n\n📌 ${rows[0].service_name}\n📅 ${formatDateBR(rows[0].starts_at)} às ${formatTimeBR(rows[0].starts_at)}\n\nResponda *sim* para cancelar ou *não* para manter.`,
      'AGUARDANDO_CONFIRMACAO_CANCELAMENTO',
      { ...ctx, apptIdToCancel: apptId, abandonment_notified: false }
    );
  }

  // ---------- AGUARDANDO_CONFIRMACAO_CANCELAMENTO ----------
  if (state === 'AGUARDANDO_CONFIRMACAO_CANCELAMENTO') {
    if (isBackCommand(text)) {
      return reply(
        `Ok! 😊 Como posso ajudar?\n\n1️⃣ Agendar horário\n2️⃣ Cancelar agendamento\n3️⃣ Ver meus agendamentos`,
        'MENU', {}
      );
    }

    if (/^(s|sim|yes|confirma|ok)/.test(text)) {
      await pool.query(
        `UPDATE appointments SET status = 'cancelado' WHERE id = $1 AND professional_id = $2`,
        [ctx.apptIdToCancel, professionalId]
      );
      return reply(
        `Agendamento cancelado com sucesso! ✅\n\nSe quiser remarcar, é só me avisar. 😊\n\n1️⃣ Agendar horário`,
        'MENU',
        {}
      );
    }

    if (/^(n|nao|nope)/.test(text)) {
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

  // Fallback: reset to MENU
  return reply(
    `Oi! 😊 Como posso ajudar?\n\n1️⃣ Agendar horário\n2️⃣ Cancelar agendamento\n3️⃣ Ver meus agendamentos`,
    'MENU',
    {}
  );
}

// ---------- Route handlers ----------

// POST /bot/process
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

    // Get or create conversation
    const conv = await getOrCreateConversation(professionalId, phone);

    // If ATENDIMENTO_HUMANO → do not respond
    if (conv.mode === 'ATENDIMENTO_HUMANO') {
      return res.json({ reply: null, reason: 'human_mode' });
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
