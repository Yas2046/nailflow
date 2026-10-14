import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Retenção dos snapshots de exclusão de conta (arquivos professional_<uuid>_<timestamp>.json).
 *
 * Política (docs/SUPORTE_PRIVACIDADE_RETENCAO.md): 30 dias, aplicada por tempo (rotina diária, ver
 * scripts/prune-deleted-snapshots.js) e também a cada nova exclusão. O snapshot serve só para desfazer uma
 * exclusão indevida e contém dados de clientes finais (terceiros).
 *
 * Só são candidatos arquivos regulares cujo NOME segue exatamente o padrão gerado por writeProfessionalSnapshot.
 * Qualquer outra coisa no diretório (links, subdiretórios, outros nomes) nunca é tocada.
 *
 * Suspensão (hold): nomes listados (um por linha) no arquivo `.retention-hold` do próprio diretório não são
 * removidos, para proteger arquivos até que a origem deles seja verificada. Linhas vazias e iniciadas por # são
 * ignoradas; o arquivo é lido, nunca criado nem alterado por este módulo.
 */
export const SNAPSHOT_RETENTION_DAYS = 30;
export const SNAPSHOT_HOLD_FILE = '.retention-hold';
export const SNAPSHOT_NAME_RE =
  /^professional_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}_\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.json$/i;

const DAY_MS = 24 * 60 * 60 * 1000;

async function readHold(dir) {
  let text;
  try { text = await fs.readFile(path.join(dir, SNAPSHOT_HOLD_FILE), 'utf8'); } catch { return new Set(); }
  return new Set(text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#')));
}

/**
 * Lista (e, com apply, remove) os snapshots mais antigos que `days` dias, pelo mtime do arquivo.
 * Sem apply nada é removido (simulação). Nunca lança por falha em um arquivo isolado.
 * @returns {{ candidates: string[], removed: string[], held: string[], kept: number }}
 */
export async function pruneSnapshots(dir, { days = SNAPSHOT_RETENTION_DAYS, now = Date.now(), apply = false } = {}) {
  if (!Number.isFinite(days) || days < 1) throw new Error('days deve ser um número >= 1');
  const result = { candidates: [], removed: [], held: [], kept: 0 };
  const entries = await fs.readdir(dir).catch(() => []);
  const hold = await readHold(dir);
  const cutoff = now - days * DAY_MS;
  for (const name of entries) {
    if (!SNAPSHOT_NAME_RE.test(name)) continue;
    const file = path.join(dir, name);
    const st = await fs.lstat(file).catch(() => null);
    if (!st || !st.isFile()) continue;           // lstat: link simbólico não é arquivo regular, então é ignorado
    if (st.mtimeMs >= cutoff) { result.kept += 1; continue; }
    if (hold.has(name)) { result.held.push(name); continue; }
    result.candidates.push(name);
    if (apply) {
      const ok = await fs.unlink(file).then(() => true, () => false);
      if (ok) result.removed.push(name);
    }
  }
  return result;
}
