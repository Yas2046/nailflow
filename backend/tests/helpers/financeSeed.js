// Dados financeiros completos em todas as tabelas da 025, para os testes que precisam de um banco "com uso real".
// Só para banco DESCARTÁVEL (use depois de resolveFinanceTestDb). Cria contas com o prefixo de e-mail informado.
import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';

const HASH = createHash('sha256').update('seed-financeiro').digest('hex');
let seq = 0;

export function seedTools(pool, prefix) {
  const q = (sql, params) => pool.query(sql, params);

  async function tx(fn, settings = {}) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const [k, v] of Object.entries(settings)) await client.query('SELECT set_config($1, $2, true)', [k, v]);
      const out = await fn(client);
      await client.query('COMMIT');
      return out;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async function mkProf(tag) {
    const id = randomUUID();
    await q(`INSERT INTO professionals (id, name, email, password_hash, slug) VALUES ($1, $2, $3, 'x', $4)`,
      [id, `Seed ${tag}`, `${prefix}-${tag}-${id.slice(0, 8)}@nf.test`, `${prefix}-${tag}-${id.slice(0, 8)}`]);
    const svc = (await q(`INSERT INTO services (professional_id, name, price_cents, duration_minutes) VALUES ($1, 'Serviço', 10000, 30) RETURNING id`, [id])).rows[0].id;
    const cli = (await q(`INSERT INTO clients (professional_id, name, phone) VALUES ($1, 'Cliente', $2) RETURNING id`, [id, `5541${String(500000000 + (++seq))}`])).rows[0].id;
    return { id, svc, cli };
  }
  async function mkAppt(p, { deposit = null, paidAt = null } = {}) {
    const start = new Date(Date.UTC(2026, 5, 1 + (++seq), 12, 0, 0));
    return (await q(`INSERT INTO appointments (professional_id, client_id, service_id, starts_at, ends_at, status, price_cents_snapshot, deposit_cents, paid_at)
        VALUES ($1, $2, $3, $4, $5, 'confirmado', 10000, $6, $7) RETURNING id`,
      [p.id, p.cli, p.svc, start, new Date(start.getTime() + 3600_000), deposit, paidAt])).rows[0].id;
  }
  const pay = (p, a, o = {}) => q(
    `INSERT INTO financial_payments (professional_id, appointment_id, kind, amount_cents, method, occurred_on, source, reverses_payment_id, notes, idempotency_key, request_hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
    [p.id, a, o.kind ?? 'recebimento', o.amount ?? 1000, o.method ?? 'pix', o.day ?? '2026-06-10', o.source ?? 'manual', o.reverses ?? null, o.notes ?? null, o.key ?? null, o.hash ?? null]);

  /** Estorno, sinal confirmado, correções com motivo, check-in, revisão, despesas paga/pendente/a revisar e caixas fechado/reaberto. */
  async function seedFinancialData(tagSuffix = '') {
    const p1 = await mkProf(`um${tagSuffix}`);
    const p2 = await mkProf(`dois${tagSuffix}`);
    const a1 = await mkAppt(p1, { deposit: 3000, paidAt: new Date('2026-06-01T10:00:00Z') });
    const a2 = await mkAppt(p1);
    const a3 = await mkAppt(p1);
    const b1 = await mkAppt(p2);
    const actor = randomUUID();
    const key = `chave-${randomUUID().slice(0, 12)}`;

    const rec = (await pay(p1, a1, { amount: 8000, day: '2026-06-10' })).rows[0].id;
    await pay(p1, a1, { kind: 'estorno', amount: 1000, reverses: rec, notes: 'Cliente devolveu um item', day: '2026-06-12' });
    await pay(p1, a1, { amount: 3000, source: 'sinal_pix_confirmado', day: '2026-06-10' });
    await pay(p1, a2, { amount: 5000, method: 'cartao_credito', day: '2026-06-11', key, hash: HASH });
    await pay(p2, b1, { amount: 2500, method: 'dinheiro', day: '2026-06-10' });

    await q(`UPDATE appointments SET checked_in_at = '2026-06-02T12:05:00Z', final_price_cents = 11000 WHERE id = $1`, [a1]);
    await tx((c) => c.query(`UPDATE appointments SET final_price_cents = 10500 WHERE id = $1`, [a1]), { 'nailflow.audit_reason': 'Desconto combinado', 'nailflow.actor_id': actor });
    await q(`UPDATE appointments SET finance_review = 'realizado' WHERE id = $1`, [a2]);
    await q(`UPDATE appointments SET finance_review = 'sem_movimentacao', checked_in_at = '2026-06-03T09:00:00Z' WHERE id = $1`, [a3]);

    await q(`INSERT INTO expenses (professional_id, description, category, amount_cents, expense_date) VALUES ($1, 'Despesa legada', 'Outros', 2500, '2026-05-02')`, [p1.id]);
    await q(`INSERT INTO expenses (professional_id, description, amount_cents, expense_date, payment_status, due_on) VALUES ($1, 'Aluguel', 90000, '2026-06-05', 'pendente', '2026-06-20')`, [p1.id]);
    const e3 = (await q(`INSERT INTO expenses (professional_id, description, amount_cents, expense_date, payment_status, paid_on, paid_method, notes)
        VALUES ($1, 'Materiais', 4000, '2026-06-05', 'paga', '2026-06-12', 'pix', 'nota 1') RETURNING id`, [p1.id])).rows[0].id;
    await tx((c) => c.query(`UPDATE expenses SET amount_cents = 4500 WHERE id = $1`, [e3]), { 'nailflow.audit_reason': 'Valor do recibo', 'nailflow.actor_id': actor });
    await q(`INSERT INTO expenses (professional_id, description, amount_cents, expense_date, payment_status, due_on) VALUES ($1, 'Internet', 12000, '2026-06-06', 'pendente', '2026-06-25')`, [p2.id]);

    await q(`INSERT INTO cash_closings (professional_id, closing_date, received_cents, refunded_cents, expenses_paid_cents) VALUES ($1, '2026-06-10', 11000, 0, 0)`, [p1.id]);
    await q(`UPDATE cash_closings SET status = 'aberto', reopen_reason = 'Esqueci um recebimento' WHERE professional_id = $1 AND closing_date = '2026-06-10'`, [p1.id]);
    await q(`UPDATE cash_closings SET status = 'fechado', received_cents = 11500 WHERE professional_id = $1 AND closing_date = '2026-06-10'`, [p1.id]);
    await q(`INSERT INTO cash_closings (professional_id, closing_date, received_cents, refunded_cents, expenses_paid_cents) VALUES ($1, '2026-06-12', 0, 1000, 4500)`, [p1.id]);
    await q(`INSERT INTO cash_closings (professional_id, closing_date) VALUES ($1, '2026-06-13')`, [p1.id]);
    await q(`UPDATE cash_closings SET status = 'aberto', reopen_reason = 'Conferência pendente' WHERE professional_id = $1 AND closing_date = '2026-06-13'`, [p1.id]);
    await q(`INSERT INTO cash_closings (professional_id, closing_date, received_cents) VALUES ($1, '2026-06-10', 2500)`, [p2.id]);
    return { p1, p2, a1, a2, a3, b1, e3 };
  }

  return { q, tx, mkProf, mkAppt, pay, seedFinancialData };
}
