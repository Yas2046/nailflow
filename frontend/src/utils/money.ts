// Formatação e leitura de valores/datas do Financeiro. Valores trafegam em CENTAVOS inteiros; datas de movimentação são
// "AAAA-MM-DD" (calendário do negócio, fuso America/Sao_Paulo). Nenhuma regra financeira mora aqui: só apresentação e leitura de digitação.
export const BUSINESS_TZ = 'America/Sao_Paulo';

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export function formatBRL(cents: number | null | undefined): string {
  if (cents == null || !Number.isFinite(cents)) return '—';
  return brl.format(cents / 100);
}

/** Digitação em reais ("1.234,56", "10", "10,5") -> centavos inteiros; null se vazio/inválido/<= 0 (quando allowZero=false). */
export function parseBRLToCents(raw: string, { allowZero = false }: { allowZero?: boolean } = {}): number | null {
  const s = raw.trim().replace(/^R\$\s*/i, '');
  if (!s) return null;
  if (!/^\d{1,3}(\.\d{3})*(,\d{1,2})?$|^\d+(,\d{1,2})?$/.test(s)) return null;
  const n = Number(s.replace(/\./g, '').replace(',', '.'));
  if (!Number.isFinite(n)) return null;
  const cents = Math.round(n * 100);
  if (cents < 0 || (cents === 0 && !allowZero)) return null;
  return cents;
}

/** Centavos -> texto editável ("1234,50"), para preencher campos. */
export function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2).replace('.', ',');
}

/** "2026-10-19" -> "19/10/2026" (sem passar por Date: não há deslocamento de fuso). */
export function formatDateBR(iso: string | null | undefined): string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return '—';
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

/** Instante ISO (UTC) -> "19/10/2026 14:30" no fuso do negócio. */
export function formatDateTimeBR(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('pt-BR', { timeZone: BUSINESS_TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** Data civil (AAAA-MM-DD) de um instante, no fuso do negócio. */
export function dateInBusinessTz(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: BUSINESS_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export const todayBR = (now: Date = new Date()): string => dateInBusinessTz(now);

export function addDaysISO(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Primeiro e último dia do mês (AAAA-MM-DD) de `offset` meses a partir de hoje (no fuso do negócio). */
export function monthBoundsBR(offset = 0, now: Date = new Date()): { from: string; to: string } {
  const [y, m] = todayBR(now).split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1 + offset, 1, 12));
  const last = new Date(Date.UTC(y, m + offset, 0, 12));
  return { from: first.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10) };
}

export const METHOD_LABEL: Record<string, string> = {
  pix: 'Pix', dinheiro: 'Dinheiro', cartao_debito: 'Débito', cartao_credito: 'Crédito', transferencia: 'Transferência', outra: 'Outros', boleto: 'Boleto',
  nao_informado: 'Método não informado',
};
export const methodLabel = (m: string | null | undefined): string => METHOD_LABEL[m ?? 'nao_informado'] ?? String(m);
