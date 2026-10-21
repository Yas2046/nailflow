// Galeria de trabalhos da página pública (até 6 fotos). As fotos são reduzidas no navegador antes de enviar e guardadas no próprio NailFlow.
import { useCallback, useEffect, useRef, useState } from 'react';
import { API_URL, ApiError, api } from '../services/api';

export interface MyPhoto { id: string; createdAt: string; previewSrc?: string }
interface MyPhotos { available: boolean; max: number; photos: MyPhoto[] }

const MAX_SIDE = 1000;
const MAX_BYTES = 280_000;   // o servidor aceita até 300 KB

/** Reduz a imagem (lado maior até 1000 px) e comprime em JPEG até caber no limite. */
export async function shrinkImage(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) throw new Error('Não consegui ler essa imagem. Use JPEG, PNG ou WebP.');
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Seu navegador não conseguiu preparar a imagem.');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  for (const q of [0.85, 0.75, 0.65, 0.55, 0.45]) {
    const dataUrl = canvas.toDataURL('image/jpeg', q);
    if (Math.floor(((dataUrl.length - dataUrl.indexOf(',') - 1) * 3) / 4) <= MAX_BYTES) return dataUrl;
  }
  throw new Error('Não foi possível reduzir essa imagem o bastante. Tente outra foto.');
}

export default function VitrinePanel({ slug }: { slug: string }) {
  const [state, setState] = useState<MyPhotos | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    api.get<MyPhotos>('/portfolio').then(setState).catch(() => setError('Não foi possível carregar as fotos.'));
  }, []);
  useEffect(load, [load]);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setError(null); setBusy(true);
    try {
      const dataUrl = await shrinkImage(file);
      await api.post('/portfolio', { dataUrl });
      load();
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : 'Não foi possível enviar a foto.');
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }
  async function remove(id: string) {
    setError(null); setBusy(true);
    try { await api.delete(`/portfolio/${id}`); setConfirm(null); load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível remover.'); }
    finally { setBusy(false); }
  }

  const src = (p: MyPhoto) => p.previewSrc ?? `${API_URL}/public/${slug}/photos/${p.id}`;
  const full = state ? state.photos.length >= state.max : false;

  return (
    <section className="card p-5 space-y-4" aria-labelledby="vit-t">
      <div>
        <h2 id="vit-t" className="font-display text-lg text-wine-700">Fotos dos seus trabalhos</h2>
        <p className="text-sm text-ink/60 mt-0.5">Aparecem na sua página de agendamento. Use só fotos que você pode mostrar (evite rosto e dados pessoais das clientes).</p>
      </div>
      {error && <p role="alert" className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-4 py-3">{error}</p>}
      {!state && !error && <div className="h-24 rounded-xl bg-wine-50 animate-pulse" role="status" aria-label="Carregando" />}
      {state && !state.available && <p className="text-sm text-ink/60">A galeria ainda não está disponível neste ambiente.</p>}
      {state?.available && (
        <>
          {state.photos.length === 0 ? (
            <p className="text-sm text-ink/60">Nenhuma foto ainda.</p>
          ) : (
            <ul className="grid grid-cols-3 gap-2 sm:gap-3" aria-label="Fotos da galeria">
              {state.photos.map((p, i) => (
                <li key={p.id} className="relative aspect-square rounded-xl overflow-hidden bg-wine-50 border border-wine-100">
                  <img src={src(p)} alt={`Foto do trabalho ${i + 1}`} className="w-full h-full object-cover" loading="lazy" />
                  {confirm === p.id ? (
                    <div className="absolute inset-0 bg-wine-800/80 flex flex-col items-center justify-center gap-2 p-2">
                      <button type="button" className="btn-danger !min-h-[36px] text-xs" disabled={busy} onClick={() => remove(p.id)}>Remover foto</button>
                      <button type="button" className="text-xs text-white underline" onClick={() => setConfirm(null)}>Cancelar</button>
                    </div>
                  ) : (
                    <button type="button" aria-label={`Remover foto ${i + 1}`} onClick={() => setConfirm(p.id)}
                      className="absolute top-1 right-1 min-w-[36px] min-h-[36px] rounded-full bg-white/90 text-rose-700 text-lg leading-none shadow hover:bg-white">×</button>
                  )}
                </li>
              ))}
            </ul>
          )}
          <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" aria-label="Escolher foto para a galeria" onChange={(e) => onFile(e.target.files?.[0])} />
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className="btn-secondary" disabled={busy || full} onClick={() => input.current?.click()}>{busy ? 'Enviando…' : 'Adicionar foto'}</button>
            <span className="text-xs text-ink/60" aria-live="polite">{state.photos.length} de {state.max} fotos{full ? ' (remova uma para adicionar outra)' : ''}</span>
          </div>
        </>
      )}
    </section>
  );
}
