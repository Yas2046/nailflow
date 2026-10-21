// Leitura de planilha CSV/TSV para a importação de clientes (sem dependências; roda no navegador e em testes Node).
// Aceita separador vírgula, ponto e vírgula (Excel em português) ou tabulação, aspas, BOM e quebras CRLF/LF.
// Arquivos .xlsx NÃO são lidos aqui: a tela orienta a salvar como CSV.

export interface Sheet { rows: string[][]; delimiter: string }
export interface ColumnMap { name: number | null; phone: number | null; notes: number | null; tags: number | null }
export interface ImportRow { name: string; phone: string; notes?: string; tags?: string[] }

const DELIMITERS = [';', ',', '\t'] as const;

/** Separador mais provável: o que mais aparece (fora de aspas) na primeira linha com conteúdo. */
export function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r\n|\n|\r/).find((l) => l.trim() !== '') ?? '';
  let best: string = ',';
  let bestCount = 0;
  for (const d of DELIMITERS) {
    let inQuotes = false;
    let n = 0;
    for (const ch of firstLine) {
      if (ch === '"') inQuotes = !inQuotes;
      else if (ch === d && !inQuotes) n += 1;
    }
    if (n > bestCount) { best = d; bestCount = n; }
  }
  return best;
}

export function parseCsv(input: string): Sheet {
  const text = input.replace(/^﻿/, '');
  const delimiter = detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i += 1; } else inQuotes = false;
      } else cell += ch;
    } else if (ch === '"' && cell === '') inQuotes = true;
    else if (ch === delimiter) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(cell); cell = '';
      rows.push(row); row = [];
    } else cell += ch;
  }
  if (cell !== '' || row.length > 0) { row.push(cell); rows.push(row); }
  return { rows: rows.filter((r) => r.some((c) => c.trim() !== '')).map((r) => r.map((c) => c.trim())), delimiter };
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const SYNONYMS: Record<keyof ColumnMap, string[]> = {
  name: ['nome', 'name', 'cliente', 'nome da cliente', 'nome completo', 'contato'],
  phone: ['telefone', 'celular', 'whatsapp', 'whats', 'fone', 'phone', 'tel', 'numero', 'telefone celular', 'contato telefone'],
  notes: ['observacao', 'observacoes', 'obs', 'notas', 'nota', 'notes', 'anotacoes', 'comentario'],
  tags: ['etiquetas', 'etiqueta', 'tags', 'tag', 'categorias', 'grupo'],
};

/** A primeira linha é cabeçalho quando alguma célula bate com um nome de coluna conhecido. */
export function looksLikeHeader(first: string[]): boolean {
  const cells = first.map(norm);
  return (Object.values(SYNONYMS).flat()).some((syn) => cells.includes(syn));
}

export function detectColumns(first: string[], hasHeader: boolean): ColumnMap {
  const map: ColumnMap = { name: null, phone: null, notes: null, tags: null };
  if (hasHeader) {
    const cells = first.map(norm);
    (Object.keys(SYNONYMS) as Array<keyof ColumnMap>).forEach((k) => {
      const i = cells.findIndex((c) => SYNONYMS[k].includes(c));
      map[k] = i >= 0 ? i : null;
    });
  }
  // sem cabeçalho (ou sem reconhecer): nome na 1ª coluna, telefone na 2ª
  if (map.name === null && map.phone === null) { map.name = 0; map.phone = first.length > 1 ? 1 : null; }
  return map;
}

export function toImportRows(rows: string[][], map: ColumnMap): ImportRow[] {
  const cell = (r: string[], i: number | null) => (i === null ? '' : (r[i] ?? '').trim());
  return rows.map((r) => {
    const tags = cell(r, map.tags).split(/[;,|]/).map((t) => t.trim()).filter(Boolean);
    return { name: cell(r, map.name), phone: cell(r, map.phone), ...(cell(r, map.notes) ? { notes: cell(r, map.notes) } : {}), ...(tags.length ? { tags } : {}) };
  });
}
