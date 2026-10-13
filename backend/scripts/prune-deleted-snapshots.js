#!/usr/bin/env node
/**
 * Limpeza por tempo dos snapshots de exclusão de conta (retenção: ver src/utils/snapshotRetention.js).
 *
 * SIMULAÇÃO por padrão: sem --apply nada é removido. Imprime só contagens (os nomes contêm o id da conta e só
 * saem com --list).
 *
 *   node scripts/prune-deleted-snapshots.js [--dir <diretório>] [--days <n>] [--list] [--apply]
 *
 * O diretório padrão é DELETED_PROFESSIONAL_BACKUP_DIR ou /var/backups/nailflow/deleted-professionals.
 * Arquivos listados em <diretório>/.retention-hold são preservados.
 * Esta rotina NÃO está agendada: o agendamento (cron do sistema) é uma decisão operacional (ops/README.md).
 */
import { pruneSnapshots, SNAPSHOT_RETENTION_DAYS } from '../src/utils/snapshotRetention.js';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };

const dir = value('--dir') ?? process.env.DELETED_PROFESSIONAL_BACKUP_DIR ?? '/var/backups/nailflow/deleted-professionals';
const days = value('--days') === undefined ? SNAPSHOT_RETENTION_DAYS : Number(value('--days'));
const apply = flag('--apply');

if (!Number.isInteger(days) || days < 1) {
  console.error('--days deve ser um inteiro >= 1');
  process.exit(2);
}

const r = await pruneSnapshots(dir, { days, apply });
console.log(`${apply ? 'APLICADO' : 'SIMULAÇÃO (nada removido; use --apply)'}: diretório=${dir} dias=${days}`);
console.log(`dentro do prazo: ${r.kept}; vencidos: ${r.candidates.length}; suspensos (.retention-hold): ${r.held.length}; removidos: ${r.removed.length}`);
if (flag('--list')) for (const n of r.candidates) console.log(`  vencido: ${n}${r.removed.includes(n) ? ' (removido)' : ''}`);
if (apply && r.removed.length !== r.candidates.length) {
  console.error(`ATENÇÃO: ${r.candidates.length - r.removed.length} arquivo(s) vencido(s) não puderam ser removidos`);
  process.exit(1);
}
