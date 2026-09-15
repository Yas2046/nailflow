import { pool } from '../config/db.js';
import { getAvailableSlots } from '../utils/availability.js';
import { getZonedParts, timeStringToUtcOnDate, zonedTimeToUtc, BUSINESS_TIMEZONE } from '../utils/timezone.js';

export async function getDashboardSummary(req, res, next) {
  try {
    const professionalId = req.professionalId;
    const now = new Date();
    const todayParts = getZonedParts(now);

    // ── limites do dia ────────────────────────────────────────────────────────
    const todayStart = timeStringToUtcOnDate(todayParts, '00:00');
    const todayEnd   = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000 - 1);

    // ── limites do mês atual ─────────────────────────────────────────────────
    const monthStart = zonedTimeToUtc(todayParts.year, todayParts.month, 1, 0, 0);
    const nextMonthStart = todayParts.month === 12
      ? zonedTimeToUtc(todayParts.year + 1, 1, 1, 0, 0)
      : zonedTimeToUtc(todayParts.year, todayParts.month + 1, 1, 0, 0);

    // ── limites do mês anterior ───────────────────────────────────────────────
    const prevMonth     = todayParts.month === 1 ? 12 : todayParts.month - 1;
    const prevMonthYear = todayParts.month === 1 ? todayParts.year - 1 : todayParts.year;
    const prevMonthStart = zonedTimeToUtc(prevMonthYear, prevMonth, 1, 0, 0);

    // ── início dos últimos 6 meses (mês atual − 5) ────────────────────────────
    let sixM = todayParts.month - 5;
    let sixY = todayParts.year;
    if (sixM <= 0) { sixM += 12; sixY -= 1; }
    const sixMonthsAgoStart = zonedTimeToUtc(sixY, sixM, 1, 0, 0);

    // ── queries paralelas ─────────────────────────────────────────────────────
    const [
      todayResult,
      clientCountResult,
      shortestServiceResult,
      monthStatsResult,
      prevMonthResult,
      futurePrevistResult,
      novosClientesResult,
      topServicosResult,
      sixMonthsResult,
    ] = await Promise.all([
      // agendamentos de hoje (exceto cancelados)
      pool.query(
        `SELECT a.*, c.name AS client_name, s.name AS service_name
         FROM appointments a
         JOIN clients c ON c.id = a.client_id
         JOIN services s ON s.id = a.service_id
         WHERE a.professional_id = $1 AND a.starts_at BETWEEN $2 AND $3
           AND a.status <> 'cancelado'
         ORDER BY a.starts_at ASC`,
        [professionalId, todayStart, todayEnd]
      ),

      // total de clientes
      pool.query(
        'SELECT COUNT(*)::int AS total FROM clients WHERE professional_id = $1',
        [professionalId]
      ),

      // menor serviço ativo (para calcular slots disponíveis)
      pool.query(
        `SELECT duration_minutes FROM services
         WHERE professional_id = $1 AND active = true
         ORDER BY duration_minutes ASC LIMIT 1`,
        [professionalId]
      ),

      // estatísticas do mês por status
      pool.query(
        `SELECT status,
                COUNT(*)::int AS count,
                COALESCE(SUM(price_cents_snapshot), 0)::int AS total_cents
         FROM appointments
         WHERE professional_id = $1 AND starts_at >= $2 AND starts_at < $3
         GROUP BY status`,
        [professionalId, monthStart, nextMonthStart]
      ),

      // faturamento realizado no mês anterior
      pool.query(
        `SELECT COALESCE(SUM(price_cents_snapshot), 0)::int AS total_cents
         FROM appointments
         WHERE professional_id = $1 AND starts_at >= $2 AND starts_at < $3
           AND status = 'concluido'`,
        [professionalId, prevMonthStart, monthStart]
      ),

      // faturamento previsto (agendamentos futuros pendente/confirmado)
      pool.query(
        `SELECT COALESCE(SUM(price_cents_snapshot), 0)::int AS total_cents
         FROM appointments
         WHERE professional_id = $1 AND starts_at > $2
           AND status IN ('pendente', 'confirmado')`,
        [professionalId, now]
      ),

      // novos clientes no mês
      pool.query(
        `SELECT COUNT(*)::int AS count FROM clients
         WHERE professional_id = $1 AND created_at >= $2 AND created_at < $3`,
        [professionalId, monthStart, nextMonthStart]
      ),

      // top 5 serviços mais realizados (todos os tempos)
      pool.query(
        `SELECT s.name AS service_name,
                COUNT(*)::int AS count,
                COALESCE(SUM(a.price_cents_snapshot), 0)::int AS total_cents
         FROM appointments a
         JOIN services s ON s.id = a.service_id
         WHERE a.professional_id = $1 AND a.status = 'concluido'
         GROUP BY s.id, s.name
         ORDER BY count DESC
         LIMIT 5`,
        [professionalId]
      ),

      // faturamento dos últimos 6 meses (agrupado por mês no tz do negócio)
      pool.query(
        `SELECT TO_CHAR(DATE_TRUNC('month', starts_at AT TIME ZONE $3), 'YYYY-MM') AS mes,
                COALESCE(SUM(price_cents_snapshot), 0)::int AS total_cents
         FROM appointments
         WHERE professional_id = $1 AND status = 'concluido' AND starts_at >= $2
         GROUP BY DATE_TRUNC('month', starts_at AT TIME ZONE $3)
         ORDER BY 1 ASC`,
        [professionalId, sixMonthsAgoStart, BUSINESS_TIMEZONE]
      ),
    ]);

    // ── hoje ──────────────────────────────────────────────────────────────────
    const todayAppts = todayResult.rows;
    const proximo = todayAppts.find((a) => new Date(a.starts_at) > now) || null;
    const faturamentoEstimado = todayAppts
      .filter((a) => a.status !== 'nao_compareceu')
      .reduce((sum, a) => sum + a.price_cents_snapshot, 0);

    // slots disponíveis hoje
    const duration = shortestServiceResult.rows[0]?.duration_minutes || 40;
    const availableToday = await getAvailableSlots(professionalId, todayStart, duration);

    // ── mês atual: agrega por status ─────────────────────────────────────────
    const monthMap = {};
    for (const row of monthStatsResult.rows) {
      monthMap[row.status] = { count: row.count, totalCents: row.total_cents };
    }
    const ms = (s) => monthMap[s] || { count: 0, totalCents: 0 };

    const faturamentoRealizado  = ms('concluido').totalCents;
    const prevMesFaturamento    = prevMonthResult.rows[0]?.total_cents ?? 0;
    const agendamentosTotal     = monthStatsResult.rows.reduce((s, r) => s + r.count, 0);

    let variacao = null;
    if (prevMesFaturamento > 0) {
      variacao = Math.round(((faturamentoRealizado - prevMesFaturamento) / prevMesFaturamento) * 100);
    }

    res.json({
      // ── dados já existentes ────────────────────────────────────────────────
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
      totalClientes: clientCountResult.rows[0].total,
      faturamentoEstimadoHojeCents: faturamentoEstimado,

      // ── dados novos ────────────────────────────────────────────────────────
      mes: {
        faturamentoRealizadoCents:   faturamentoRealizado,
        faturamentoPrevistoCents:    futurePrevistResult.rows[0]?.total_cents ?? 0,
        faturamentoPerdidoCents:     ms('nao_compareceu').totalCents,
        agendamentosTotal,
        agendamentosConcluidos:      ms('concluido').count,
        agendamentosNaoCompareceu:   ms('nao_compareceu').count,
        agendamentosCancelados:      ms('cancelado').count,
        novosClientes:               novosClientesResult.rows[0]?.count ?? 0,
      },
      mesAnterior: { faturamentoRealizadoCents: prevMesFaturamento },
      variacao,
      topServicos: topServicosResult.rows.map((r) => ({
        serviceName: r.service_name,
        count: r.count,
        totalCents: r.total_cents,
      })),
      faturamento6Meses: sixMonthsResult.rows.map((r) => ({
        mes: r.mes,
        totalCents: r.total_cents,
      })),
    });
  } catch (err) {
    next(err);
  }
}
