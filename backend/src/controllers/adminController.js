import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { pool } from '../config/db.js';
import { HttpError } from '../middleware/errorHandler.js';
import { updateMeSchema } from './authController.js';
import { deleteEvolutionInstanceByName } from './whatsappController.js';
import { logAdminAction } from '../utils/auditLog.js';

export async function listProfessionals(req, res, next) {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, email, phone_whatsapp, business_name,
              wa_instance_name, created_at, is_admin, blocked_at
       FROM professionals
       ORDER BY created_at ASC`
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
}

// POST /admin/professionals/:id/block
// Preenche blocked_at. Não altera token_version: o bloqueio já derruba a
// sessão em qualquer request (requireAuth/requireAdmin checam blocked_at a
// cada chamada), então não é preciso invalidar o token separadamente.
export async function blockProfessional(req, res, next) {
  try {
    const { id } = req.params;
    if (id === req.professionalId) {
      throw new HttpError(400, 'Você não pode bloquear a própria conta.');
    }
    const { rows } = await pool.query(
      `UPDATE professionals SET blocked_at = now() WHERE id = $1
       RETURNING id, blocked_at, business_name`,
      [id]
    );
    if (!rows[0]) throw new HttpError(404, 'Profissional não encontrada.');
    await logAdminAction({
      actorId: req.professionalId,
      actorEmail: req.actorEmail,
      action: 'block',
      targetId: rows[0].id,
      targetBusinessName: rows[0].business_name,
    });
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
}

// POST /admin/professionals/:id/unblock
// Limpa blocked_at e sobe token_version (conforme previsto na migration 016)
// para invalidar qualquer token emitido antes do desbloqueio, forçando novo login.
export async function unblockProfessional(req, res, next) {
  try {
    const { id } = req.params;
    const { rows } = await pool.query(
      `UPDATE professionals
         SET blocked_at = NULL, token_version = token_version + 1
       WHERE id = $1
       RETURNING id, blocked_at, business_name`,
      [id]
    );
    if (!rows[0]) throw new HttpError(404, 'Profissional não encontrada.');
    await logAdminAction({
      actorId: req.professionalId,
      actorEmail: req.actorEmail,
      action: 'unblock',
      targetId: rows[0].id,
      targetBusinessName: rows[0].business_name,
    });
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
}

// PUT /admin/professionals/:id
// Reaproveita o mesmo schema/regras de PUT /auth/me (updateMeSchema): mesmos
// campos (name, business_name, phone_whatsapp, email, avatar_b64), mesma
// checagem de e-mail único. Não permite editar slug, wa_instance_name,
// is_admin, blocked_at, token_version ou senha -- de propósito: cada um
// desses tem um fluxo próprio (wa_instance_name depende da Evolution API,
// blocked_at/token_version já têm o endpoint de bloqueio, slug é a URL
// pública e não deve mudar, e não existe troca de senha no sistema ainda).
export async function updateProfessional(req, res, next) {
  try {
    const { id } = req.params;
    if (id === req.professionalId) {
      throw new HttpError(400, 'Use a tela de perfil para editar a própria conta.');
    }

    const { name, business_name, phone_whatsapp, email, avatar_b64 } = updateMeSchema.parse(req.body);
    const hasAvatar = Object.prototype.hasOwnProperty.call(req.body, 'avatar_b64');

    const { rows: conflict } = await pool.query(
      'SELECT id FROM professionals WHERE email = $1 AND id != $2',
      [email, id]
    );
    if (conflict.length > 0) throw new HttpError(409, 'Este e-mail já está em uso por outra conta.');

    let rows;
    if (hasAvatar) {
      ({ rows } = await pool.query(
        `UPDATE professionals
           SET name = $1, business_name = $2, phone_whatsapp = $3, email = $4, avatar_b64 = $5
         WHERE id = $6
         RETURNING id, name, email, business_name, phone_whatsapp, wa_instance_name, created_at, is_admin, blocked_at`,
        [name, business_name, phone_whatsapp, email, avatar_b64 ?? null, id]
      ));
    } else {
      ({ rows } = await pool.query(
        `UPDATE professionals
           SET name = $1, business_name = $2, phone_whatsapp = $3, email = $4
         WHERE id = $5
         RETURNING id, name, email, business_name, phone_whatsapp, wa_instance_name, created_at, is_admin, blocked_at`,
        [name, business_name, phone_whatsapp, email, id]
      ));
    }

    if (!rows[0]) throw new HttpError(404, 'Profissional não encontrada.');
    await logAdminAction({
      actorId: req.professionalId,
      actorEmail: req.actorEmail,
      action: 'update',
      targetId: rows[0].id,
      targetBusinessName: rows[0].business_name,
    });
    res.json(rows[0]);
  } catch (err) {
    if (err instanceof z.ZodError)
      return next(new HttpError(400, err.errors[0]?.message ?? 'Dados inválidos.'));
    next(err);
  }
}

// Tabelas com professional_id que são apagadas em cascade ao excluir a
// profissional (ON DELETE CASCADE, ver migration 017). Lista fixa e
// hardcoded -- nunca vem de entrada do usuário, então interpolar o nome da
// tabela na query abaixo é seguro.
const CASCADED_TABLES = [
  'clients', 'appointments', 'services', 'weekly_availability', 'blocked_times',
  'recurring_groups', 'recurring_exceptions', 'expenses', 'conversation_states', 'message_history',
];

const SNAPSHOT_DIR = process.env.DELETED_PROFESSIONAL_BACKUP_DIR || '/var/backups/nailflow/deleted-professionals';
const SNAPSHOT_RETENTION_DAYS = 90;

// Cópia de segurança operacional, gravada ANTES de qualquer exclusão física.
// Fica fora de /var/www (nunca é servida pela aplicação -- nenhuma rota lê
// esse diretório), com permissão 600 no arquivo e 700 no diretório, e uma
// retenção de 90 dias podada a cada nova exclusão (arquivos mais antigos são
// removidos aqui mesmo, sem depender de cron externo).
async function writeProfessionalSnapshot(professionalId) {
  await fs.mkdir(SNAPSHOT_DIR, { recursive: true, mode: 0o700 });
  await fs.chmod(SNAPSHOT_DIR, 0o700).catch(() => {});

  const { rows: professionalRows } = await pool.query(
    'SELECT * FROM professionals WHERE id = $1',
    [professionalId]
  );
  const professionalRow = professionalRows[0] ?? null;
  if (professionalRow) delete professionalRow.password_hash; // nunca persistir hash de senha no snapshot

  const data = { snapshotTakenAt: new Date().toISOString(), professional: professionalRow };
  for (const table of CASCADED_TABLES) {
    const { rows } = await pool.query(`SELECT * FROM ${table} WHERE professional_id = $1`, [professionalId]);
    data[table] = rows;
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filePath = path.join(SNAPSHOT_DIR, `professional_${professionalId}_${timestamp}.json`);
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), { mode: 0o600 });
  await fs.chmod(filePath, 0o600).catch(() => {});

  const cutoff = Date.now() - SNAPSHOT_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const entries = await fs.readdir(SNAPSHOT_DIR).catch(() => []);
  for (const entry of entries) {
    if (!entry.startsWith('professional_') || !entry.endsWith('.json')) continue;
    const entryPath = path.join(SNAPSHOT_DIR, entry);
    const stat = await fs.stat(entryPath).catch(() => null);
    if (stat && stat.mtimeMs < cutoff) await fs.unlink(entryPath).catch(() => {});
  }

  return filePath;
}

// GET /admin/professionals/:id/delete-preview
// Só leitura -- contagens para o admin ver o tamanho do estrago antes de confirmar.
export async function getDeleteProfessionalPreview(req, res, next) {
  try {
    const { id } = req.params;
    const { rows } = await pool.query(
      `SELECT
         (SELECT count(*)::int FROM clients WHERE professional_id = $1) AS clients,
         (SELECT count(*)::int FROM appointments WHERE professional_id = $1) AS appointments,
         (SELECT count(*)::int FROM services WHERE professional_id = $1) AS services,
         (SELECT count(*)::int FROM recurring_groups WHERE professional_id = $1) AS "recurringGroups",
         (SELECT count(*)::int FROM message_history WHERE professional_id = $1) AS messages,
         (SELECT count(*)::int FROM expenses WHERE professional_id = $1) AS expenses`,
      [id]
    );
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
}

const deleteProfessionalSchema = z.object({
  businessNameConfirmation: z.string().min(1, 'Digite o nome do negócio para confirmar.'),
});

// DELETE /admin/professionals/:id
// Exclusão física e definitiva: profissional + tudo que o ON DELETE CASCADE
// alcança (ver migration 017). Ordem: 1) snapshot em disco, 2) excluir
// instância na Evolution SE houver (chamada externa, fora da transação SQL
// -- se falhar, aborta e não mexe no banco), 3) DELETE em transação.
export async function deleteProfessional(req, res, next) {
  try {
    const { id } = req.params;
    if (id === req.professionalId) {
      throw new HttpError(400, 'Você não pode excluir a própria conta.');
    }

    const { businessNameConfirmation } = deleteProfessionalSchema.parse(req.body);

    const { rows } = await pool.query(
      'SELECT id, business_name, is_admin, wa_instance_name FROM professionals WHERE id = $1',
      [id]
    );
    const target = rows[0];
    if (!target) throw new HttpError(404, 'Profissional não encontrada.');

    if (businessNameConfirmation.trim() !== target.business_name) {
      throw new HttpError(400, 'O nome do negócio digitado não confere. Exclusão cancelada.');
    }

    if (target.is_admin) {
      const { rows: adminCountRows } = await pool.query(
        'SELECT count(*)::int AS count FROM professionals WHERE is_admin = true'
      );
      if (adminCountRows[0].count <= 1) {
        throw new HttpError(400, 'Não é possível excluir a última conta de administrador.');
      }
    }

    // 1) Rede de segurança operacional -- antes de qualquer exclusão.
    await writeProfessionalSnapshot(id);

    // 2) Evolution é externa ao Postgres: resolve antes de abrir a transação.
    //    Se falhar, aborta aqui -- a profissional NÃO é excluída do banco.
    if (target.wa_instance_name) {
      const deleted = await deleteEvolutionInstanceByName(target.wa_instance_name);
      if (!deleted) {
        throw new HttpError(502, 'Falha ao excluir a instância do WhatsApp na Evolution. A profissional não foi excluída.');
      }
    }

    // 3) Exclusão física em transação. Os CASCADEs (migration 017) apagam
    //    clients/appointments/services/... na mesma operação.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM professionals WHERE id = $1', [id]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    // Só registra depois do COMMIT: se a transação falhar, nada é logado.
    await logAdminAction({
      actorId: req.professionalId,
      actorEmail: req.actorEmail,
      action: 'delete',
      targetId: id,
      targetBusinessName: target.business_name,
    });

    res.status(204).end();
  } catch (err) {
    if (err instanceof z.ZodError)
      return next(new HttpError(400, err.errors[0]?.message ?? 'Dados inválidos.'));
    next(err);
  }
}
