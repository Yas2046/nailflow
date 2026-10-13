import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { pool } from '../config/db.js';
import { HttpError } from '../middleware/errorHandler.js';
import { updateMeSchema } from './authController.js';
import { deleteEvolutionInstanceByName } from './whatsappController.js';
import { logAdminAction } from '../utils/auditLog.js';
import { pruneSnapshots } from '../utils/snapshotRetention.js';

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

// Central de Suporte (migration 023): solicitações, mensagens e eventos também caem em cascade (FK composta,
// ON DELETE CASCADE) e têm professional_id. Só entram no snapshot/contagem quando as três tabelas existem:
// em bancos sem a migration 023 aplicada a exclusão continua funcionando exatamente como antes.
const SUPPORT_TABLES = ['support_tickets', 'support_messages', 'support_ticket_events'];

async function supportTablesPresent(db) {
  const { rows } = await db.query(
    `SELECT to_regclass('public.support_tickets') IS NOT NULL
        AND to_regclass('public.support_messages') IS NOT NULL
        AND to_regclass('public.support_ticket_events') IS NOT NULL AS present`
  );
  return rows[0].present === true;
}

async function supportCounts(db, professionalId) {
  const counts = {};
  for (const table of SUPPORT_TABLES) {
    const { rows } = await db.query(`SELECT count(*)::int AS n FROM ${table} WHERE professional_id = $1`, [professionalId]);
    counts[table] = rows[0].n;
  }
  return counts;
}

const SNAPSHOT_DIR = process.env.DELETED_PROFESSIONAL_BACKUP_DIR || '/var/backups/nailflow/deleted-professionals';

// Cópia de segurança operacional, gravada ANTES de qualquer exclusão física.
// Fica fora de /var/www (nunca é servida pela aplicação -- nenhuma rota lê
// esse diretório), com permissão 600 no arquivo e 700 no diretório. Retenção:
// SNAPSHOT_RETENTION_DAYS (30 dias, utils/snapshotRetention.js), podada a cada
// nova exclusão e pela rotina por tempo scripts/prune-deleted-snapshots.js.
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
  const withSupport = await supportTablesPresent(pool);
  for (const table of withSupport ? [...CASCADED_TABLES, ...SUPPORT_TABLES] : CASCADED_TABLES) {
    const { rows } = await pool.query(`SELECT * FROM ${table} WHERE professional_id = $1`, [professionalId]);
    data[table] = rows;
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filePath = path.join(SNAPSHOT_DIR, `professional_${professionalId}_${timestamp}.json`);
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), { mode: 0o600 });
  await fs.chmod(filePath, 0o600).catch(() => {});

  // Poda por idade (SNAPSHOT_RETENTION_DAYS) também a cada exclusão. Só arquivos com o nome exato gerado acima e
  // que não estejam no .retention-hold; a rotina por tempo (scripts/prune-deleted-snapshots.js) cobre o caso de
  // não haver exclusões. Uma falha de poda nunca impede a exclusão.
  await pruneSnapshots(SNAPSHOT_DIR, { apply: true }).catch(() => {});

  // Contagens de suporte no momento do snapshot (null = banco sem a migration 023): a exclusão confere que
  // nada novo foi gravado depois delas, para nenhuma conversa ser apagada sem estar no snapshot.
  const snapshotSupportCounts = withSupport
    ? Object.fromEntries(SUPPORT_TABLES.map((t) => [t, data[t].length]))
    : null;
  return { filePath, supportCounts: snapshotSupportCounts };
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
    // Solicitações da Central de Suporte que seriam apagadas junto (0 quando a migration 023 não está aplicada).
    const supportTickets = (await supportTablesPresent(pool))
      ? (await supportCounts(pool, id)).support_tickets
      : 0;
    res.json({ ...rows[0], supportTickets });
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
    const { supportCounts: snapshotSupport } = await writeProfessionalSnapshot(id);

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
      if (snapshotSupport) {
        // Trava as solicitações e depois a conta (mesma ordem de quem grava mensagem: solicitação -> conta),
        // o que impede novas atividades de suporte até o COMMIT, e confere que nada novo foi gravado depois do
        // snapshot. Se foi, aborta sem excluir: nenhuma conversa é apagada fora do snapshot.
        await client.query('SELECT id FROM support_tickets WHERE professional_id = $1 FOR UPDATE', [id]);
        await client.query('SELECT id FROM professionals WHERE id = $1 FOR UPDATE', [id]);
        const now = await supportCounts(client, id);
        if (SUPPORT_TABLES.some((t) => now[t] > snapshotSupport[t])) {
          throw new HttpError(409, 'Houve atividade de suporte nesta conta durante a exclusão. Nada foi excluído; tente novamente.');
        }
      }
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
