// Consultas compartilhadas dos indicadores financeiros REAIS: recebido (recebimentos - estornos, na data em que ocorreram) e despesas
// efetivamente pagas (expense_payments e despesas 'paga' antigas sem lançamentos, na data do pagamento). Usadas pelo relatório, pelo
// Dashboard e por Gastos, para que todos mostrem os mesmos números. Atendimento concluído NÃO é dinheiro recebido.
import { financeiroPagamentosEnabled, PAYMENT_METHODS } from './financeiroPagamentos.js';

export const BUSINESS_TZ = 'America/Sao_Paulo';

/** Flag ligada E estruturas (025, 028) presentes. Sem isso, os indicadores antigos seguem como estavam (publicação em etapas). */
export async function financeiroReady(db) {
  if (!financeiroPagamentosEnabled()) return false;
  const { rows } = await db.query(`SELECT to_regclass('public.financial_payments') IS NOT NULL AND to_regclass('public.expense_payments') IS NOT NULL AS ok`);
  return rows[0].ok === true;
}

/** Pagamentos de despesa efetivos: lançamentos + despesas antigas 'paga' sem lançamentos (método original, possivelmente nulo). */
export const EXPENSE_PAID_SQL = `(
  SELECT x.professional_id, x.expense_id, x.method, x.amount_cents, x.paid_on FROM expense_payments x
  UNION ALL
  SELECT e.professional_id, e.id, e.paid_method, e.amount_cents, e.paid_on FROM expenses e
   WHERE e.payment_status = 'paga' AND e.paid_on IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM expense_payments x WHERE x.expense_id = e.id AND x.professional_id = e.professional_id)
)`;

/** Totais do período (datas AAAA-MM-DD, inclusivas): por método, despesas por método e por categoria. */
export async function periodSums(db, pid, from, to) {
  const rec = await db.query(
    `SELECT method, COALESCE(SUM(amount_cents) FILTER (WHERE kind = 'recebimento'), 0)::int AS received,
            COALESCE(SUM(amount_cents) FILTER (WHERE kind = 'estorno'), 0)::int AS refunded
       FROM financial_payments WHERE professional_id = $1 AND occurred_on BETWEEN $2::date AND $3::date GROUP BY method`, [pid, from, to]);
  const byM = new Map(rec.rows.map((r) => [r.method, r]));
  const recebimentosPorMetodo = PAYMENT_METHODS.map((m) => {
    const r = byM.get(m);
    const received = r?.received ?? 0;
    const refunded = r?.refunded ?? 0;
    return { method: m, receivedCents: received, refundedCents: refunded, netCents: received - refunded };
  });
  const dm = await db.query(
    `SELECT COALESCE(p.method, 'nao_informado') AS method, SUM(p.amount_cents)::int AS paid FROM ${EXPENSE_PAID_SQL} p
      WHERE p.professional_id = $1 AND p.paid_on BETWEEN $2::date AND $3::date GROUP BY 1 ORDER BY 1`, [pid, from, to]);
  const dc = await db.query(
    `SELECT ex.category, SUM(p.amount_cents)::int AS paid, count(*)::int AS n FROM ${EXPENSE_PAID_SQL} p
       JOIN expenses ex ON ex.id = p.expense_id AND ex.professional_id = p.professional_id
      WHERE p.professional_id = $1 AND p.paid_on BETWEEN $2::date AND $3::date GROUP BY 1 ORDER BY 2 DESC, 1`, [pid, from, to]);
  const receivedCents = recebimentosPorMetodo.reduce((s, m) => s + m.receivedCents, 0);
  const refundedCents = recebimentosPorMetodo.reduce((s, m) => s + m.refundedCents, 0);
  const expensesPaidCents = dm.rows.reduce((s, r) => s + r.paid, 0);
  return {
    recebimentosPorMetodo,
    despesasPagasPorMetodo: dm.rows.map((r) => ({ method: r.method, paidCents: r.paid })),
    despesasPagasPorCategoria: dc.rows.map((r) => ({ category: r.category, paidCents: r.paid, count: r.n })),
    totais: { receivedCents, refundedCents, netReceivedCents: receivedCents - refundedCents, expensesPaidCents, saldoCents: receivedCents - refundedCents - expensesPaidCents },
  };
}

/** Série mensal (AAAA-MM) de recebido líquido e despesas pagas a partir de `fromDate` (inclusive). */
export async function monthlySeries(db, pid, fromDate) {
  const rec = await db.query(
    `SELECT to_char(occurred_on, 'YYYY-MM') AS mes,
            (COALESCE(SUM(amount_cents) FILTER (WHERE kind = 'recebimento'), 0) - COALESCE(SUM(amount_cents) FILTER (WHERE kind = 'estorno'), 0))::int AS net
       FROM financial_payments WHERE professional_id = $1 AND occurred_on >= $2::date GROUP BY 1 ORDER BY 1`, [pid, fromDate]);
  const dep = await db.query(
    `SELECT to_char(p.paid_on, 'YYYY-MM') AS mes, SUM(p.amount_cents)::int AS paid FROM ${EXPENSE_PAID_SQL} p
      WHERE p.professional_id = $1 AND p.paid_on >= $2::date GROUP BY 1 ORDER BY 1`, [pid, fromDate]);
  return { recebido: rec.rows.map((r) => ({ mes: r.mes, totalCents: r.net })), despesasPagas: dep.rows.map((r) => ({ mes: r.mes, totalCents: r.paid })) };
}

/** Contas a receber (atendimentos concluídos: valor final ou do serviço - recebido líquido). Vencido = concluído há mais de graceDays. */
export async function receivableRows(db, pid, today, graceDays = 7) {
  const { rows } = await db.query(
    `WITH base AS (
       SELECT a.id, c.name AS client_name, s.name AS service_name, (a.ends_at AT TIME ZONE $3::text)::date AS ended_on,
              COALESCE(a.final_price_cents, a.price_cents_snapshot, 0) AS value_cents,
              COALESCE(p.received, 0) - COALESCE(p.refunded, 0) AS net, ($2::date - (a.ends_at AT TIME ZONE $3::text)::date) AS days_since
         FROM appointments a JOIN clients c ON c.id = a.client_id AND c.professional_id = a.professional_id
         JOIN services s ON s.id = a.service_id AND s.professional_id = a.professional_id
         LEFT JOIN LATERAL (SELECT COALESCE(SUM(fp.amount_cents) FILTER (WHERE fp.kind = 'recebimento'), 0)::int AS received,
                                   COALESCE(SUM(fp.amount_cents) FILTER (WHERE fp.kind = 'estorno'), 0)::int AS refunded
                              FROM financial_payments fp WHERE fp.appointment_id = a.id AND fp.professional_id = a.professional_id) p ON true
        WHERE a.professional_id = $1 AND a.status = 'concluido'
     ) SELECT id, client_name, service_name, to_char(ended_on, 'YYYY-MM-DD') AS ended_on, value_cents, net, GREATEST(value_cents - net, 0) AS balance,
              (GREATEST(value_cents - net, 0) > 0 AND days_since > $4) AS overdue
         FROM base WHERE GREATEST(value_cents - net, 0) > 0 ORDER BY ended_on, id`, [pid, today, BUSINESS_TZ, graceDays]);
  return rows;
}

/** Despesas ainda em aberto (a revisar, pendentes, vencidas) com o saldo; 'vencida' = pendente com vencimento anterior a hoje. */
export async function openExpenseRows(db, pid, today) {
  const { rows } = await db.query(
    `SELECT e.id, e.description, e.category, e.amount_cents, to_char(e.due_on, 'YYYY-MM-DD') AS due_on, e.payment_status,
            COALESCE(p.paid, 0)::int AS paid_cents,
            CASE WHEN e.payment_status = 'a_revisar' THEN 'a_revisar' WHEN e.due_on IS NOT NULL AND e.due_on < $2::date THEN 'vencida' ELSE 'pendente' END AS state
       FROM expenses e LEFT JOIN LATERAL (SELECT SUM(x.amount_cents) AS paid FROM expense_payments x WHERE x.expense_id = e.id AND x.professional_id = e.professional_id) p ON true
      WHERE e.professional_id = $1 AND e.payment_status IN ('a_revisar', 'pendente') ORDER BY e.due_on NULLS LAST, e.created_at, e.id`, [pid, today]);
  return rows;
}

/** Fechamentos fechados no período com a última versão por método; "divergente" = alguma diferença diferente de zero. */
export async function closingRows(db, pid, from, to) {
  const { rows } = await db.query(
    `SELECT c.id, to_char(c.closing_date, 'YYYY-MM-DD') AS day, c.status, c.reopen_count,
            e.method, e.expected_cents, e.counted_cents, e.difference_cents, e.justification
       FROM cash_closings c
       LEFT JOIN cash_closing_entries e ON e.closing_id = c.id AND e.professional_id = c.professional_id AND e.version = (
         SELECT MAX(v.version) FROM cash_closing_entries v WHERE v.closing_id = c.id AND v.professional_id = c.professional_id)
      WHERE c.professional_id = $1 AND c.closing_date BETWEEN $2::date AND $3::date ORDER BY c.closing_date, e.method`, [pid, from, to]);
  const byDay = new Map();
  for (const r of rows) {
    const d = byDay.get(r.id) ?? { day: r.day, status: r.status, reopenCount: r.reopen_count, metodos: [] };
    if (r.method) d.metodos.push({ method: r.method, expectedCents: r.expected_cents, countedCents: r.counted_cents, differenceCents: r.difference_cents, justification: r.justification });
    byDay.set(r.id, d);
  }
  return [...byDay.values()].map((d) => ({ ...d, divergente: d.metodos.some((m) => m.differenceCents !== 0) }));
}
