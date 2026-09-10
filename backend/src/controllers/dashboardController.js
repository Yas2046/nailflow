import { pool } from '../config/db.js';
import { getAvailableSlots } from '../utils/availability.js';
import { getZonedParts, timeStringToUtcOnDate } from '../utils/timezone.js';

export async function getDashboardSummary(req, res, next) {
  try {
    const professionalId = req.professionalId;
    const now = new Date();
    const todayStart = timeStringToUtcOnDate(getZonedParts(now), '00:00');
    const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000 - 1);

    const { rows: todayAppts } = await pool.query(
      `SELECT a.*, c.name AS client_name, s.name AS service_name
       FROM appointments a
       JOIN clients c ON c.id = a.client_id
       JOIN services s ON s.id = a.service_id
       WHERE a.professional_id = $1 AND a.starts_at BETWEEN $2 AND $3 AND a.status <> 'cancelado'
       ORDER BY a.starts_at ASC`,
      [professionalId, todayStart, todayEnd]
    );

    const proximo = todayAppts.find((a) => new Date(a.starts_at) > now) || null;

    const faturamentoEstimado = todayAppts
      .filter((a) => a.status !== 'nao_compareceu')
      .reduce((sum, a) => sum + a.price_cents_snapshot, 0);

    const { rows: clientCountRows } = await pool.query(
      'SELECT COUNT(*)::int AS total FROM clients WHERE professional_id = $1',
      [professionalId]
    );

    const { rows: shortestService } = await pool.query(
      'SELECT duration_minutes FROM services WHERE professional_id = $1 AND active = true ORDER BY duration_minutes ASC LIMIT 1',
      [professionalId]
    );
    const duration = shortestService[0]?.duration_minutes || 40;
    const availableToday = await getAvailableSlots(professionalId, todayStart, duration);

    res.json({
      agendamentosHoje: todayAppts.map((a) => ({
        id: a.id,
        clientName: a.client_name,
        serviceName: a.service_name,
        startsAt: a.starts_at,
        status: a.status,
      })),
      proximoAtendimento: proximo
        ? { id: proximo.id, clientName: proximo.client_name, serviceName: proximo.service_name, startsAt: proximo.starts_at }
        : null,
      horariosDisponiveisHoje: availableToday.length,
      totalClientes: clientCountRows[0].total,
      faturamentoEstimadoHojeCents: faturamentoEstimado,
    });
  } catch (err) {
    next(err);
  }
}
