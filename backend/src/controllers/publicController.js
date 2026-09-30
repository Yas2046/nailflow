import { pool } from '../config/db.js';
import { getAvailableSlots } from '../utils/availability.js';
import { getZonedParts, timeStringToUtcOnDate } from '../utils/timezone.js';

// Busca profissional pelo slug (Phase 3 multi-tenancy).
async function getProfessionalBySlug(slug) {
  const { rows } = await pool.query(
    'SELECT id, business_name, phone_whatsapp, booking_horizon_days FROM professionals WHERE slug = $1',
    [slug]
  );
  return rows[0] || null;
}

// Calcula dias de disponibilidade para uma profissional respeitando o horizonte configurado.
async function buildAvailabilityResponse(professional, requestedDays) {
  const { rows: shortestService } = await pool.query(
    'SELECT duration_minutes FROM services WHERE professional_id = $1 AND active = true AND available_on_whatsapp = true ORDER BY duration_minutes ASC LIMIT 1',
    [professional.id]
  );
  const duration = shortestService[0]?.duration_minutes || 40;

  // Limita ao horizonte máximo configurado pela profissional
  const horizon = professional.booking_horizon_days ?? 60;
  const days = Math.min(requestedDays, horizon);

  const result = [];
  const now = new Date();
  const todaySpMidnight = timeStringToUtcOnDate(getZonedParts(now), '00:00');

  for (let i = 0; i < days; i++) {
    const date = new Date(todaySpMidnight.getTime() + i * 24 * 60 * 60 * 1000);
    const slots = await getAvailableSlots(professional.id, date, duration);
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
export async function getPublicInfoBySlug(req, res, next) {
  try {
    const professional = await getProfessionalBySlug(req.params.slug);
    if (!professional) return res.status(404).json({ error: 'Profissional não encontrada.' });
    res.json({
      businessName: professional.business_name,
      whatsappLink: professional.phone_whatsapp ? `https://wa.me/${professional.phone_whatsapp}` : null,
    });
  } catch (err) {
    next(err);
  }
}

// GET /public/:slug/availability?days=N
export async function getPublicAvailabilityBySlug(req, res, next) {
  try {
    const professional = await getProfessionalBySlug(req.params.slug);
    if (!professional) return res.status(404).json({ error: 'Profissional não encontrada.' });
    const requestedDays = Number(req.query.days) || (professional.booking_horizon_days ?? 60);
    res.json(await buildAvailabilityResponse(professional, requestedDays));
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
