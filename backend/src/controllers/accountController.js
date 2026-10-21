// Conta da profissional: redefinição de senha por link de uso único e exportação dos próprios dados.
// Sem envio de e-mail: o link é emitido pela administração (issuePasswordReset) e entregue por ela à profissional.
import bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { pool } from '../config/db.js';
import { HttpError } from '../middleware/errorHandler.js';

export const RESET_TTL_MINUTES = 60;
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

async function resetTableAvailable(db) {
  const { rows } = await db.query(`SELECT to_regclass('public.password_reset_tokens') IS NOT NULL AS ok`);
  return rows[0].ok === true;
}

// POST /admin/professionals/:id/password-reset (somente administradora; requireAdmin já rodou)
// Invalida links anteriores ainda não usados e devolve o novo link UMA vez (só o hash fica no banco).
export async function issuePasswordReset(req, res, next) {
  try {
    const target = await pool.query('SELECT id, is_admin FROM professionals WHERE id = $1', [req.params.id]);
    if (!target.rows[0]) throw new HttpError(404, 'Profissional não encontrada.');
    if (target.rows[0].is_admin) throw new HttpError(400, 'Contas administradoras não usam este fluxo.');
    if (!(await resetTableAvailable(pool))) throw new HttpError(503, 'Redefinição de senha indisponível: a migration 030 não foi aplicada.');

    const token = randomBytes(32).toString('base64url');
    const client = await pool.connect();
    let expiresAt;
    try {
      await client.query('BEGIN');
      await client.query('UPDATE password_reset_tokens SET used_at = now() WHERE professional_id = $1 AND used_at IS NULL', [req.params.id]);
      const ins = await client.query(
        `INSERT INTO password_reset_tokens (professional_id, token_hash, issued_by, expires_at)
         VALUES ($1, $2, $3, now() + make_interval(mins => $4)) RETURNING expires_at`,
        [req.params.id, sha256(token), req.professionalId, RESET_TTL_MINUTES]
      );
      expiresAt = ins.rows[0].expires_at;
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
    res.setHeader('Cache-Control', 'no-store');
    res.status(201).json({ resetPath: `/redefinir-senha?token=${token}`, expiresAt, validForMinutes: RESET_TTL_MINUTES });
  } catch (err) {
    next(err);
  }
}

const resetSchema = z.object({
  token: z.string().min(20).max(200),
  newPassword: z.string().min(8, 'A nova senha deve ter ao menos 8 caracteres.').max(72, 'A nova senha deve ter no máximo 72 caracteres.'),
  confirmPassword: z.string(),
}).strict();

// POST /auth/reset-password (público, com limite por IP). Resposta de falha SEMPRE igual: não revela se o link existiu.
export async function resetPassword(req, res, next) {
  try {
    const { token, newPassword, confirmPassword } = resetSchema.parse(req.body);
    if (newPassword !== confirmPassword) throw new HttpError(400, 'A confirmação não confere com a nova senha.');
    const invalid = () => new HttpError(400, 'Link inválido ou expirado. Peça um novo à administração.');
    if (!(await resetTableAvailable(pool))) throw invalid();

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `SELECT id, professional_id FROM password_reset_tokens
          WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now() FOR UPDATE`,
        [sha256(token)]
      );
      if (!rows[0]) { await client.query('ROLLBACK'); throw invalid(); }
      const passwordHash = await bcrypt.hash(newPassword, 10);
      // token_version + 1: derruba todas as sessões abertas da conta. Conta bloqueada também pode redefinir, mas segue bloqueada.
      await client.query('UPDATE professionals SET password_hash = $1, token_version = token_version + 1 WHERE id = $2', [passwordHash, rows[0].professional_id]);
      await client.query('UPDATE password_reset_tokens SET used_at = now() WHERE professional_id = $1 AND used_at IS NULL', [rows[0].professional_id]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
    res.status(204).end();
  } catch (err) {
    if (err instanceof z.ZodError) return next(new HttpError(400, err.errors[0]?.message ?? 'Dados inválidos.'));
    next(err);
  }
}

// Tabelas por-profissional exportadas (colunas explícitas onde há segredo; nunca password_hash nem token_version).
const EXPORT_TABLES = [
  ['services', 'SELECT * FROM services WHERE professional_id = $1 ORDER BY created_at'],
  ['clients', 'SELECT * FROM clients WHERE professional_id = $1 ORDER BY created_at'],
  ['appointments', 'SELECT * FROM appointments WHERE professional_id = $1 ORDER BY starts_at'],
  ['expenses', 'SELECT * FROM expenses WHERE professional_id = $1 ORDER BY expense_date'],
  ['weekly_availability', 'SELECT * FROM weekly_availability WHERE professional_id = $1 ORDER BY weekday'],
  ['blocked_times', 'SELECT * FROM blocked_times WHERE professional_id = $1 ORDER BY starts_at'],
];
const EXPORT_OPTIONAL = [
  ['financial_payments', 'SELECT * FROM financial_payments WHERE professional_id = $1 ORDER BY created_at'],
  ['cash_closings', 'SELECT * FROM cash_closings WHERE professional_id = $1 ORDER BY closed_at'],
  ['expense_payments', 'SELECT * FROM expense_payments WHERE professional_id = $1 ORDER BY created_at'],
];

// GET /auth/export — os dados da PRÓPRIA conta em JSON (download). Não inclui senha, sessões, tokens nem dados de outras contas.
export async function exportMyData(req, res, next) {
  try {
    const pid = req.professionalId;
    const prof = await pool.query(
      `SELECT id, name, email, business_name, phone_whatsapp, slug, bio, public_theme, avatar_b64, created_at FROM professionals WHERE id = $1`,
      [pid]
    );
    if (!prof.rows[0]) throw new HttpError(404, 'Profissional não encontrada.');
    const data = { professional: prof.rows[0] };
    for (const [name, sql] of EXPORT_TABLES) data[name] = (await pool.query(sql, [pid])).rows;
    for (const [name, sql] of EXPORT_OPTIONAL) {
      const has = (await pool.query('SELECT to_regclass($1) IS NOT NULL AS ok', [`public.${name}`])).rows[0].ok;
      if (has) data[name] = (await pool.query(sql, [pid])).rows;
    }
    const day = new Date().toISOString().slice(0, 10);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="nailflow-meus-dados-${day}.json"`);
    res.send(JSON.stringify({ exportedAt: new Date().toISOString(), format: 'nailflow-export-v1', ...data }, null, 2));
  } catch (err) {
    next(err);
  }
}
