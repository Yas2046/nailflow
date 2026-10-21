// Galeria de trabalhos da página pública: até 6 fotos por profissional, guardadas no banco (bytea), servidas como imagem.
// Só JPEG/PNG/WebP com assinatura de arquivo conferida; até 300 KB cada (o navegador reduz antes de enviar). Sem serviços externos.
import { z } from 'zod';
import { pool } from '../config/db.js';
import { HttpError } from '../middleware/errorHandler.js';
import { UUID_RE } from '../utils/appointmentStatus.js';

export const MAX_PHOTOS = 6;
export const MAX_PHOTO_BYTES = 300_000;
const DATA_URL_RE = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+=*)$/;

/** O conteúdo precisa começar como o tipo declarado (evita arquivo qualquer disfarçado de imagem). */
export function matchesSignature(mime, buf) {
  if (mime === 'image/jpeg') return buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  if (mime === 'image/png') return buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (mime === 'image/webp') return buf.length > 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP';
  return false;
}

async function tableAvailable(db) {
  const { rows } = await db.query(`SELECT to_regclass('public.portfolio_photos') IS NOT NULL AS ok`);
  return rows[0].ok === true;
}

const uploadSchema = z.object({ dataUrl: z.string().max(Math.ceil(MAX_PHOTO_BYTES * 1.4) + 200) }).strict();

// GET /portfolio — as fotos da própria profissional (ids; a imagem sai por /public/:slug/photos/:id)
export async function listMyPhotos(req, res, next) {
  try {
    if (!(await tableAvailable(pool))) return res.json({ available: false, max: MAX_PHOTOS, photos: [] });
    const { rows } = await pool.query('SELECT id, created_at FROM portfolio_photos WHERE professional_id = $1 ORDER BY created_at, id', [req.professionalId]);
    res.json({ available: true, max: MAX_PHOTOS, photos: rows.map((r) => ({ id: r.id, createdAt: r.created_at })) });
  } catch (err) {
    next(err);
  }
}

// POST /portfolio { dataUrl }
export async function addPhoto(req, res, next) {
  try {
    const { dataUrl } = uploadSchema.parse(req.body);
    const m = dataUrl.match(DATA_URL_RE);
    if (!m) throw new HttpError(400, 'Formato de imagem inválido. Use JPEG, PNG ou WebP.');
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > MAX_PHOTO_BYTES) throw new HttpError(400, 'Imagem muito grande (máximo de 300 KB).');
    if (!matchesSignature(m[1], buf)) throw new HttpError(400, 'O arquivo não parece ser uma imagem válida.');
    if (!(await tableAvailable(pool))) throw new HttpError(503, 'Galeria indisponível: a migration 031 não foi aplicada.');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))', [`portfolio:${req.professionalId}`]);
      const { rows: n } = await client.query('SELECT count(*)::int AS n FROM portfolio_photos WHERE professional_id = $1', [req.professionalId]);
      if (n[0].n >= MAX_PHOTOS) { await client.query('ROLLBACK'); throw new HttpError(409, `Você já tem ${MAX_PHOTOS} fotos. Remova uma para adicionar outra.`); }
      const { rows } = await client.query('INSERT INTO portfolio_photos (professional_id, mime, data) VALUES ($1, $2, $3) RETURNING id, created_at', [req.professionalId, m[1], buf]);
      await client.query('COMMIT');
      res.status(201).json({ id: rows[0].id, createdAt: rows[0].created_at });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    if (err instanceof z.ZodError) return next(new HttpError(400, 'Imagem inválida ou muito grande.'));
    next(err);
  }
}

// DELETE /portfolio/:id
export async function deletePhoto(req, res, next) {
  try {
    if (!UUID_RE.test(req.params.id)) throw new HttpError(404, 'Foto não encontrada.');
    if (!(await tableAvailable(pool))) throw new HttpError(404, 'Foto não encontrada.');
    const { rowCount } = await pool.query('DELETE FROM portfolio_photos WHERE id = $1 AND professional_id = $2', [req.params.id, req.professionalId]);
    if (!rowCount) throw new HttpError(404, 'Foto não encontrada.');
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}

// GET /public/:slug/gallery — ids das fotos (a página pública monta as imagens)
export async function getPublicGallery(req, res, next) {
  try {
    if (!(await tableAvailable(pool))) return res.json({ photos: [] });
    const { rows } = await pool.query(
      `SELECT ph.id FROM portfolio_photos ph JOIN professionals p ON p.id = ph.professional_id
        WHERE p.slug = $1 AND p.blocked_at IS NULL ORDER BY ph.created_at, ph.id`,
      [req.params.slug]
    );
    res.json({ photos: rows.map((r) => ({ id: r.id })) });
  } catch (err) {
    next(err);
  }
}

// GET /public/:slug/photos/:id — o arquivo da imagem (só se a foto pertencer à profissional do slug e ela não estiver bloqueada)
export async function getPublicPhoto(req, res, next) {
  try {
    if (!UUID_RE.test(req.params.id) || !(await tableAvailable(pool))) return res.status(404).json({ error: 'Foto não encontrada.' });
    const { rows } = await pool.query(
      `SELECT ph.mime, ph.data FROM portfolio_photos ph JOIN professionals p ON p.id = ph.professional_id
        WHERE ph.id = $1 AND p.slug = $2 AND p.blocked_at IS NULL`,
      [req.params.id, req.params.slug]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Foto não encontrada.' });
    res.setHeader('Content-Type', rows[0].mime);
    res.setHeader('Content-Length', String(rows[0].data.length));
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.setHeader('Content-Security-Policy', "default-src 'none'");
    res.end(rows[0].data);
  } catch (err) {
    next(err);
  }
}
