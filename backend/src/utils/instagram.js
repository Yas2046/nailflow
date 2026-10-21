// Usuário do Instagram para o link da página pública. Aceita "@usuario", "usuario", "instagram.com/usuario" e a URL completa;
// guarda só o nome de usuário (letras, números, ponto e sublinhado, até 30). O link final é sempre montado por nós
// (https://www.instagram.com/<usuario>/), nunca um endereço digitado pela profissional.
export const INSTAGRAM_RE = /^[A-Za-z0-9._]{1,30}$/;

/** Devolve { ok:true, value:string|null } (null = remover) ou { ok:false }. */
export function normalizeInstagram(raw) {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  let v = String(raw).trim();
  if (v === '') return { ok: true, value: null };
  const fromUrl = v.match(/^(?:https?:\/\/)?(?:www\.)?instagram\.com\/([^/?#\s]+)/i);
  if (fromUrl) v = fromUrl[1];
  v = v.replace(/^@/, '');
  if (!INSTAGRAM_RE.test(v) || /^\.|\.$|\.\./.test(v)) return { ok: false };
  return { ok: true, value: v.toLowerCase() };
}

export const instagramUrl = (username) => (username && INSTAGRAM_RE.test(username) ? `https://www.instagram.com/${username}/` : null);
