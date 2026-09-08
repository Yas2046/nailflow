import { pool } from '../config/db.js';
import { getAvailableSlots } from '../utils/availability.js';
import { getZonedParts, timeStringToUtcOnDate } from '../utils/timezone.js';

/**
 * MVP roda com UMA profissional por instalação (sem multi-tenant na URL pública).
 * Por isso pegamos sempre a primeira/única linha de "professionals".
 * Quando o produto evoluir para múltiplas profissionais, trocar por um slug
 * público (ex.: /p/camila-nails) e filtrar por ele aqui.
 */
async function getSingleProfessional() {
  const { rows } = await pool.query(
    'SELECT id, business_name, phone_whatsapp FROM professionals ORDER BY created_at ASC LIMIT 1'
  );
  return rows[0] || null;
}

// GET /public/info — nome do negócio e link do WhatsApp
export async function getPublicInfo(req, res, next) {
  try {
    const professional = await getSingleProfessional();
    if (!professional) return res.status(404).json({ error: 'Nenhuma profissional cadastrada.' });
    res.json({
      businessName: professional.business_name,
      whatsappLink: `https://wa.me/${professional.phone_whatsapp}`,
    });
  } catch (err) {
    next(err);
  }
}

// GET /public/availability?days=3 — próximos N dias com horários livres
// Usa a duração do serviço mais curto como granularidade padrão de exibição,
// já que a cliente ainda não escolheu o serviço nesta tela pública.
export async function getPublicAvailability(req, res, next) {
  try {
    const professional = await getSingleProfessional();
    if (!professional) return res.status(404).json({ error: 'Nenhuma profissional cadastrada.' });

    const days = Math.min(Number(req.query.days) || 5, 14);

    const { rows: shortestService } = await pool.query(
      'SELECT duration_minutes FROM services WHERE professional_id = $1 AND active = true ORDER BY duration_minutes ASC LIMIT 1',
      [professional.id]
    );
    const duration = shortestService[0]?.duration_minutes || 40;

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

    res.json({
      businessName: professional.business_name,
      whatsappLink: `https://wa.me/${professional.phone_whatsapp}`,
      days: result,
    });
  } catch (err) {
    next(err);
  }
}
