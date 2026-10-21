// Importação de clientes (planilha já lida pelo navegador): validação, pré-visualização e gravação em lote.
// Regras: nunca altera nem apaga cliente existente (duplicada = ignorada); a mesma regra de telefone do cadastro manual
// (normalizeClientPhone / isValidBrPhone / findClientByPhone); dryRun não grava nada; gravação em uma transação; limite de 500 linhas.
import { z } from 'zod';
import { pool } from '../config/db.js';
import { HttpError } from '../middleware/errorHandler.js';
import { normalizeBrPhone, normalizeClientPhone, isValidBrPhone, findClientByPhone } from '../utils/phone.js';

export const MAX_IMPORT_ROWS = 500;

const rowSchema = z.object({
  name: z.string().max(500).optional().nullable(),
  phone: z.string().max(100).optional().nullable(),
  notes: z.string().max(5000).optional().nullable(),
  tags: z.array(z.string().max(100)).max(50).optional(),
});
const bodySchema = z.object({
  rows: z.array(rowSchema).min(1, 'Nenhuma linha para importar.').max(MAX_IMPORT_ROWS, `Importe no máximo ${MAX_IMPORT_ROWS} clientes por vez.`),
  dryRun: z.boolean().optional(),
}).strict();

/** Valida e normaliza uma linha (sem consultar o banco). Devolve { ok:true, value } ou { ok:false, reason }. */
export function validateImportRow(row) {
  const name = String(row.name ?? '').replace(/\s+/g, ' ').trim();
  if (!name) return { ok: false, reason: 'Nome em branco.' };
  if (name.length > 120) return { ok: false, reason: 'Nome com mais de 120 caracteres.' };
  const phone = normalizeClientPhone(row.phone);
  if (!isValidBrPhone(phone)) return { ok: false, reason: 'Telefone inválido (use DDD + número).' };
  const notes = String(row.notes ?? '').trim();
  const tags = [...new Set((row.tags ?? []).map((t) => String(t).trim()).filter(Boolean))];
  if (tags.some((t) => t.length > 30)) return { ok: false, reason: 'Etiqueta com mais de 30 caracteres.' };
  if (tags.length > 20) return { ok: false, reason: 'Mais de 20 etiquetas.' };
  return { ok: true, value: { name, phone, notes: notes || null, tags } };
}

// POST /clients/import
export async function importClients(req, res, next) {
  try {
    const { rows, dryRun = false } = bodySchema.parse(req.body);
    const pid = req.professionalId;
    const seen = new Map(); // telefone normalizado -> índice da primeira linha
    const results = [];

    for (let i = 0; i < rows.length; i += 1) {
      const v = validateImportRow(rows[i]);
      if (!v.ok) { results.push({ index: i, status: 'invalid', reason: v.reason }); continue; }
      const key = normalizeBrPhone(v.value.phone);
      if (seen.has(key)) { results.push({ index: i, status: 'duplicate_file', reason: `Mesmo telefone da linha ${seen.get(key) + 1}.`, phone: v.value.phone }); continue; }
      seen.set(key, i);
      const existing = await findClientByPhone(pid, v.value.phone, { includeWithoutDdi: true });
      if (existing) { results.push({ index: i, status: 'duplicate_existing', reason: `Já cadastrada como "${existing.name}".`, phone: v.value.phone }); continue; }
      results.push({ index: i, status: 'ok', phone: v.value.phone, value: v.value });
    }

    const importable = results.filter((r) => r.status === 'ok');
    let created = 0;
    let skippedRace = 0;
    if (!dryRun && importable.length > 0) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        for (const r of importable) {
          // ON CONFLICT: se alguém cadastrou o mesmo telefone entre a conferência e a gravação, pula sem erro e sem alterar a ficha.
          const ins = await client.query(
            `INSERT INTO clients (professional_id, name, phone, notes, tags) VALUES ($1,$2,$3,$4,$5)
             ON CONFLICT (professional_id, phone) DO NOTHING RETURNING id`,
            [pid, r.value.name, r.value.phone, r.value.notes, r.value.tags]
          );
          if (ins.rows[0]) created += 1; else skippedRace += 1;
        }
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    }

    const count = (s) => results.filter((r) => r.status === s).length;
    res.json({
      dryRun,
      summary: {
        total: rows.length,
        importable: importable.length,
        invalid: count('invalid'),
        duplicateInFile: count('duplicate_file'),
        duplicateExisting: count('duplicate_existing'),
        created,
        skippedRace,
      },
      results: results.map(({ value, ...rest }) => rest),
    });
  } catch (err) {
    if (err instanceof z.ZodError) return next(new HttpError(400, err.errors[0]?.message ?? 'Dados de importação inválidos.'));
    next(err);
  }
}
