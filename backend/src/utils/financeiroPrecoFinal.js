// Preço final do atendimento (Financeiro, etapa 3). Regras compartilhadas pela rota PUT /financeiro/atendimentos/:id/preco-final
// e pela finalização na Agenda (PUT /appointments/:id com finalPriceCents).
//  * Só atendimento CONCLUÍDO tem preço final. Concluir NÃO registra pagamento: o valor final só muda o teto do que pode ser recebido.
//  * Definir um valor diferente do preço do serviço, ou alterar um valor final já definido, exige justificativa; o histórico
//    (antes/depois, motivo, autor) é gravado pelo trigger da migration 025 (appointment_final_price).
//  * O valor final nunca fica abaixo do LÍQUIDO já recebido (recebimentos - estornos): para baixá-lo é preciso, antes, estornar ou
//    corrigir o recebimento (procedimentos financeiros válidos, com histórico). A migration 027 repete essa regra no banco.
// As funções recebem um cliente DENTRO de uma transação, com o atendimento já travado por quem chama.
import { z } from 'zod';
import { FinanceError, MAX_AMOUNT_CENTS } from './financeiroPagamentos.js';

const reason = z.string().trim().min(3, 'Informe a justificativa (mínimo 3 caracteres).').max(300, 'Justificativa muito longa.');
const cents = z.number({ invalid_type_error: 'Valor inválido.', required_error: 'Informe o preço final.' })
  .int('O valor deve ser em centavos (inteiro).').min(0, 'O valor não pode ser negativo.').max(MAX_AMOUNT_CENTS, 'Valor acima do limite permitido.');

export const finalPriceSchema = z.object({ finalPriceCents: cents, reason: reason.optional() }).strict();
export const agendaFinalPriceFields = { finalPriceCents: cents.optional(), finalPriceReason: reason.optional() };

/** O Financeiro (025: coluna e histórico) existe neste banco? Sem erro dentro da transação. */
export async function finalPriceAvailable(db) {
  const { rows } = await db.query(
    `SELECT to_regclass('public.financial_payments') IS NOT NULL
        AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'appointments' AND column_name = 'final_price_cents') AS ok`);
  return rows[0].ok === true;
}

/** Mesma trava por atendimento dos recebimentos (a chave é a mesma do banco, migrations 025/027). Reentrante na transação. */
export async function advisoryLock(client, appointmentId) {
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))', [`fin_pay:${appointmentId}`]);
}

export async function netReceivedCents(db, appointmentId, professionalId) {
  const { rows } = await db.query(
    `SELECT COALESCE(SUM(CASE WHEN kind = 'recebimento' THEN amount_cents ELSE -amount_cents END), 0)::int AS net
       FROM financial_payments WHERE appointment_id = $1 AND professional_id = $2`, [appointmentId, professionalId]);
  return rows[0].net;
}

/** Valida a definição do preço final de `row` ({ status, price_cents_snapshot, final_price_cents }). { unchanged: true } ou lança FinanceError. */
export async function checkFinalPrice(db, appointmentId, professionalId, row, newCents, why) {
  if (row.status !== 'concluido') throw new FinanceError(409, 'not_completed', 'O preço final só pode ser definido em um atendimento concluído.');
  if (row.final_price_cents === newCents) return { unchanged: true };
  const needsReason = row.final_price_cents != null || newCents !== row.price_cents_snapshot;
  if (needsReason && !why) {
    throw new FinanceError(400, 'reason_required', 'Informe a justificativa: o preço final difere do preço do serviço ou altera um valor final já definido.');
  }
  const net = await netReceivedCents(db, appointmentId, professionalId);
  if (newCents < net) {
    throw new FinanceError(409, 'below_received', 'O preço final não pode ficar abaixo do valor já recebido. Estorne ou corrija o recebimento antes.',
      { finalPriceCents: newCents, netReceivedCents: net });
  }
  return { unchanged: false };
}

/** Grava o preço final (autor e justificativa vão ao histórico pelo trigger da 025). */
export async function setFinalPrice(client, { appointmentId, professionalId, row, newCents, reason: why }) {
  const check = await checkFinalPrice(client, appointmentId, professionalId, row, newCents, why);
  if (check.unchanged) return { changed: false };
  await client.query(`SELECT set_config('nailflow.actor_id', $1, true)`, [professionalId]);
  if (why) await client.query(`SELECT set_config('nailflow.audit_reason', $1, true)`, [why]);
  await client.query(`UPDATE appointments SET final_price_cents = $3 WHERE id = $1 AND professional_id = $2`, [appointmentId, professionalId, newCents]);
  return { changed: true };
}
