import { z } from 'zod';
import { pool } from '../config/db.js';
import { getAvailableSlots, checkSlotAvailability, customerNotBefore, clock } from '../utils/availability.js';
import { getZonedParts, timeStringToUtcOnDate } from '../utils/timezone.js';
import { normalizeClientPhone, isValidBrPhone, findClientByPhone } from '../utils/phone.js';
import { HttpError } from '../middleware/errorHandler.js';
import { notifyN8n } from '../utils/notifyN8n.js';
import { expireDueHolds, initialBookingState, formatWhen, calculateDepositCents, paymentInstructionsText } from '../utils/bookingRules.js';
import { AVATAR_DATA_URL_RE, PUBLIC_THEMES } from './authController.js';

// Busca profissional pelo slug (Phase 3 multi-tenancy).
async function getProfessionalBySlug(slug) {
  const { rows } = await pool.query(
    'SELECT id, business_name, phone_whatsapp, booking_horizon_days, wa_instance_name, confirmation_mode, deposit_required, deposit_type, deposit_value, pix_key FROM professionals WHERE slug = $1',
    [slug]
  );
  return rows[0] || null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Calcula dias de disponibilidade para uma profissional respeitando o horizonte configurado.
// `overrideDurationMinutes`, quando informado, substitui a menor duração entre
// os serviços públicos (usada por padrão) — permite que a grade de horários
// reflita o serviço específico que a cliente já escolheu na página pública.
async function buildAvailabilityResponse(professional, requestedDays, overrideDurationMinutes) {
  let duration = overrideDurationMinutes;
  if (duration == null) {
    const { rows: shortestService } = await pool.query(
      'SELECT duration_minutes FROM services WHERE professional_id = $1 AND active = true AND available_on_whatsapp = true ORDER BY duration_minutes ASC LIMIT 1',
      [professional.id]
    );
    duration = shortestService[0]?.duration_minutes || 40;
  }

  // Limita ao horizonte máximo configurado pela profissional
  const horizon = professional.booking_horizon_days ?? 60;
  const days = Math.min(requestedDays, horizon);

  const result = [];
  const now = clock.now();
  const notBefore = customerNotBefore();
  const todaySpMidnight = timeStringToUtcOnDate(getZonedParts(now), '00:00');

  for (let i = 0; i < days; i++) {
    const date = new Date(todaySpMidnight.getTime() + i * 24 * 60 * 60 * 1000);
    const slots = await getAvailableSlots(professional.id, date, duration, { notBefore });
    if (slots.length > 0) {
      const parts = getZonedParts(date);
      const dateStr = `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
      result.push({
        date: dateStr,
        slots: slots.map((s) => s.start.toISOString()),
      });
    }
  }

  return {
    businessName: professional.business_name,
    whatsappLink: professional.phone_whatsapp ? `https://wa.me/${professional.phone_whatsapp}` : null,
    days: result,
  };
}

// ─── Rotas por slug (Phase 3) ─────────────────────────────────────────────────

// GET /public/:slug/info
// Somente campos públicos (cabeçalho da página). Nunca expõe id, e-mail nem
// qualquer dado interno; a foto só é devolvida se for uma data URL de imagem
// válida (defesa em profundidade além da validação ao salvar).
export async function getPublicInfoBySlug(req, res, next) {
  try {
    const { rows } = await pool.query(
      'SELECT business_name, phone_whatsapp, bio, public_theme, avatar_b64 FROM professionals WHERE slug = $1',
      [req.params.slug]
    );
    const professional = rows[0];
    if (!professional) return res.status(404).json({ error: 'Profissional não encontrada.' });
    res.json({
      businessName: professional.business_name,
      whatsappLink: professional.phone_whatsapp ? `https://wa.me/${professional.phone_whatsapp}` : null,
      bio: professional.bio || null,
      theme: PUBLIC_THEMES.includes(professional.public_theme) ? professional.public_theme : 'vinho',
      photo: AVATAR_DATA_URL_RE.test(professional.avatar_b64 || '') ? professional.avatar_b64 : null,
    });
  } catch (err) {
    next(err);
  }
}

// GET /public/:slug/availability?days=N&serviceId=uuid (serviceId opcional)
// Sem serviceId: comportamento inalterado (menor duração entre os serviços
// públicos). Com serviceId: valida que o serviço pertence a esta profissional
// (resolvida pelo slug, nunca aceito diretamente) e está ativo/visível no
// WhatsApp, e usa a duração dele para calcular a grade de horários.
export async function getPublicAvailabilityBySlug(req, res, next) {
  try {
    const professional = await getProfessionalBySlug(req.params.slug);
    if (!professional) return res.status(404).json({ error: 'Profissional não encontrada.' });

    let overrideDuration;
    const { serviceId } = req.query;
    if (serviceId) {
      if (typeof serviceId !== 'string' || !UUID_RE.test(serviceId)) {
        return res.status(400).json({ error: 'Serviço inválido.' });
      }
      const { rows: serviceRows } = await pool.query(
        'SELECT duration_minutes FROM services WHERE id = $1 AND professional_id = $2 AND active = true AND available_on_whatsapp = true',
        [serviceId, professional.id]
      );
      if (!serviceRows[0]) return res.status(400).json({ error: 'Serviço inválido.' });
      overrideDuration = serviceRows[0].duration_minutes;
    }

    const requestedDays = Number(req.query.days) || (professional.booking_horizon_days ?? 60);
    res.json(await buildAvailabilityResponse(professional, requestedDays, overrideDuration));
  } catch (err) {
    next(err);
  }
}

// GET /public/:slug/services
// Lista os serviços dessa profissional visíveis para agendamento externo
// (WhatsApp/página pública). professional_id nunca vem da requisição — só
// da resolução do slug, para garantir isolamento entre profissionais.
export async function getPublicServicesBySlug(req, res, next) {
  try {
    const professional = await getProfessionalBySlug(req.params.slug);
    if (!professional) return res.status(404).json({ error: 'Profissional não encontrada.' });

    const { rows } = await pool.query(
      `SELECT id, name, price_cents, duration_minutes
       FROM services
       WHERE professional_id = $1 AND active = true AND available_on_whatsapp = true
       ORDER BY name ASC`,
      [professional.id]
    );

    res.json(
      rows.map((s) => ({
        id: s.id,
        name: s.name,
        priceCents: s.price_cents,
        durationMinutes: s.duration_minutes,
      }))
    );
  } catch (err) {
    next(err);
  }
}

// Middleware: valida e normaliza o telefone ANTES do rate limit por
// telefone+slug (o keyGenerator do limiter precisa de um telefone já
// normalizado, senão duas grafias do mesmo número escapariam do limite).
// Roda antes de qualquer outra validação do corpo da requisição.
export function validatePublicClientPhone(req, res, next) {
  const raw = req.body?.clientPhone;
  if (typeof raw !== 'string' || !raw.trim()) {
    return res.status(400).json({ error: 'Telefone inválido.' });
  }
  const phone = normalizeClientPhone(raw);
  if (!isValidBrPhone(phone)) {
    return res.status(400).json({ error: 'Telefone inválido.' });
  }
  req.normalizedClientPhone = phone;
  next();
}

const MAX_FUTURE_APPOINTMENTS_PER_PHONE = 3;

const createPublicAppointmentSchema = z.object({
  serviceId: z.string().uuid(),
  startsAt: z.string().min(1),
  clientName: z.string().trim().min(1, 'Nome é obrigatório.').max(120, 'Nome muito longo.'),
  notes: z.string().optional().nullable(),
});

// POST /public/:slug/appointments
// Cria um agendamento a partir da página pública, sem autenticação.
// professional_id vem exclusivamente da resolução do slug; clientId e
// professionalId nunca são aceitos do corpo da requisição (o schema nem
// os declara, então são ignorados se enviados). Status sempre nasce
// 'pendente' — não é possível controlar o status pelo body.
export async function createPublicAppointment(req, res, next) {
  try {
    const data = createPublicAppointmentSchema.parse(req.body);
    const phone = req.normalizedClientPhone; // já validado por validatePublicClientPhone

    const professional = await getProfessionalBySlug(req.params.slug);
    if (!professional) return res.status(404).json({ error: 'Profissional não encontrada.' });

    const { rows: serviceRows } = await pool.query(
      `SELECT id, name, price_cents
       FROM services
       WHERE id = $1 AND professional_id = $2 AND active = true AND available_on_whatsapp = true`,
      [data.serviceId, professional.id]
    );
    const service = serviceRows[0];
    if (!service) throw new HttpError(400, 'Serviço inválido.');

    // Libera reservas vencidas antes de contar/checar (a EXCLUDE ainda as enxerga).
    await expireDueHolds({ professionalId: professional.id });

    // Limite de agendamentos futuros pendentes/confirmados para este telefone
    // com esta profissional — funciona mesmo se a cliente ainda não tiver
    // ficha (COUNT dá 0 nesse caso).
    const { rows: futureRows } = await pool.query(
      `SELECT COUNT(*)::int AS total
       FROM appointments a
       JOIN clients c ON c.id = a.client_id
       WHERE c.professional_id = $1 AND c.phone = $2
         AND a.status IN ('pendente','aguardando_pagamento','confirmado') AND a.starts_at > now()`,
      [professional.id, phone]
    );
    if (futureRows[0].total >= MAX_FUTURE_APPOINTMENTS_PER_PHONE) {
      return res.status(409).json({
        error: 'Limite de agendamentos futuros atingido para este telefone.',
        reason: 'max_future_appointments',
      });
    }

    // Pré-checagem de disponibilidade (mesma função usada pela Agenda/bot).
    // A garantia final contra corrida é a EXCLUDE constraint do Postgres em
    // appointments — esta chamada só existe para dar um erro específico
    // (reason) sem precisar abrir a transação primeiro.
    const check = await checkSlotAvailability(professional.id, data.serviceId, data.startsAt, null, { notBefore: customerNotBefore() });
    if (!check.available) {
      return res.status(409).json({ error: 'Horário não disponível.', reason: check.reason });
    }

    // Busca cliente existente por telefone (fora da transação — é só leitura).
    // Se existir, o registro é reaproveitado tal como está; nome/dados nunca
    // são sobrescritos por este formulário público.
    const existingClient = await findClientByPhone(professional.id, phone);

    // Estado inicial conforme a configuração da profissional (manual/automático/sinal).
    const depositCents = calculateDepositCents(professional, service.price_cents);
    const initial = initialBookingState(professional, clock.now(), depositCents);

    const txClient = await pool.connect();
    try {
      await txClient.query('BEGIN');

      let clientId;
      if (existingClient) {
        clientId = existingClient.id;
      } else {
        const { rows: newClientRows } = await txClient.query(
          `INSERT INTO clients (professional_id, name, phone) VALUES ($1,$2,$3) RETURNING id`,
          [professional.id, data.clientName, phone]
        );
        clientId = newClientRows[0].id;
      }

      const { rows: apptRows } = await txClient.query(
        `INSERT INTO appointments (professional_id, client_id, service_id, starts_at, ends_at, status, notes, price_cents_snapshot, source, expires_at, deposit_cents)
         VALUES ($1,$2,$3,$4,$5,$8,$6,$7,'public',$9,$10)
         RETURNING id, starts_at, ends_at, status, expires_at, deposit_cents`,
        [
          professional.id,
          clientId,
          data.serviceId,
          new Date(check.startsAt),
          new Date(check.endsAt),
          data.notes ?? null,
          service.price_cents,
          initial.status,
          initial.expiresAt,
          initial.status === 'aguardando_pagamento' ? depositCents : null,
        ]
      );

      await txClient.query('COMMIT');

      // Notifica a profissional pelo WhatsApp (fire-and-forget: uma falha
      // aqui nunca desfaz nem atrasa a resposta do agendamento já criado).
      notifyN8n('appointment.public_created', {
        professionalId: professional.id,
        professionalPhone: professional.phone_whatsapp,
        waInstance: professional.wa_instance_name,
        clientName: data.clientName,
        clientPhone: phone,
        serviceName: service.name,
        startsAt: apptRows[0].starts_at,
        endsAt: apptRows[0].ends_at,
      });

      // Mensagem à cliente (o backend decide o texto; o n8n só entrega):
      //   pendente    → "recebemos sua solicitação, aguardando confirmação"
      //   confirmado  → confirmação imediata (modo automático)
      const firstName = String(data.clientName).trim().split(/\s+/)[0];
      if (apptRows[0].status === 'pendente') {
        notifyN8n('message.send', {
          kind: 'appointment_requested',
          waInstance: professional.wa_instance_name,
          clientPhone: phone,
          clientName: data.clientName,
          text: `Olá, ${firstName}! Recebemos sua solicitação de *${service.name}* para ${formatWhen(apptRows[0].starts_at)}. 💅 Ela está aguardando a confirmação da profissional — assim que for confirmada, te aviso por aqui.`,
        });
      } else if (apptRows[0].status === 'aguardando_pagamento') {
        notifyN8n('message.send', {
          kind: 'payment_instructions',
          waInstance: professional.wa_instance_name,
          clientPhone: phone,
          clientName: data.clientName,
          text: `Olá, ${firstName}! ${paymentInstructionsText({
            serviceName: service.name,
            startsAt: apptRows[0].starts_at,
            amountCents: apptRows[0].deposit_cents,
            pixKey: professional.pix_key,
            expiresAt: apptRows[0].expires_at,
          })}`,
        });
      } else if (apptRows[0].status === 'confirmado') {
        notifyN8n('appointment.confirmed', {
          professionalId: professional.id,
          waInstance: professional.wa_instance_name,
          clientName: data.clientName,
          clientPhone: phone,
          serviceName: service.name,
          startsAt: apptRows[0].starts_at,
          endsAt: apptRows[0].ends_at,
          status: 'confirmado',
        });
      }

      return res.status(201).json({
        id: apptRows[0].id,
        startsAt: apptRows[0].starts_at,
        endsAt: apptRows[0].ends_at,
        serviceName: service.name,
        status: apptRows[0].status,
        expiresAt: apptRows[0].expires_at,
        // A chave Pix só é revelada aqui, depois que a reserva foi criada.
        ...(apptRows[0].status === 'aguardando_pagamento'
          ? { deposit: { amountCents: apptRows[0].deposit_cents, pixKey: professional.pix_key, expiresAt: apptRows[0].expires_at } }
          : {}),
      });
    } catch (err) {
      await txClient.query('ROLLBACK');
      if (err.code === '23P01') {
        return res.status(409).json({ error: 'Horário não disponível.', reason: 'appointment_overlap' });
      }
      if (err.code === '23505') {
        return res.status(409).json({ error: 'Não foi possível concluir o agendamento. Tente novamente.', reason: 'conflict' });
      }
      throw err;
    } finally {
      txClient.release();
    }
  } catch (err) {
    if (err instanceof z.ZodError) return next(new HttpError(400, 'Dados de agendamento inválidos.'));
    next(err);
  }
}
