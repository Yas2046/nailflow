// Importação de clientes por planilha (CSV): escolher o arquivo → conferir o mapeamento e a pré-visualização → confirmar.
// Nada é gravado antes da confirmação; clientes já cadastradas e linhas repetidas são ignoradas (nunca sobrescritas).
import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import LoadError from '../components/LoadError';
import { usePageTitle } from '../hooks/usePageTitle';
import { ApiError, api } from '../services/api';
import { detectColumns, looksLikeHeader, parseCsv, toImportRows, type ColumnMap } from '../utils/csv';

const MAX_ROWS = 500;
const MAX_BYTES = 1_000_000;

type Status = 'ok' | 'invalid' | 'duplicate_file' | 'duplicate_existing';
interface Result { index: number; status: Status; reason?: string }
interface Response { dryRun: boolean; summary: { total: number; importable: number; invalid: number; duplicateInFile: number; duplicateExisting: number; created: number; skippedRace: number }; results: Result[] }

const LABEL: Record<Status, { text: string; cls: string }> = {
  ok: { text: 'Será importada', cls: 'bg-sage-100 text-sage-700 border-sage-200' },
  invalid: { text: 'Dados inválidos', cls: 'bg-rose-50 text-rose-700 border-rose-200' },
  duplicate_file: { text: 'Repetida na planilha', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  duplicate_existing: { text: 'Já cadastrada', cls: 'bg-wine-50 text-wine-700 border-wine-100' },
};

const FIELDS: Array<{ key: keyof ColumnMap; label: string; required?: boolean }> = [
  { key: 'name', label: 'Nome', required: true },
  { key: 'phone', label: 'Telefone', required: true },
  { key: 'notes', label: 'Observação' },
  { key: 'tags', label: 'Etiquetas' },
];

export default function ImportarClientes() {
  usePageTitle('Importar clientes');
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [raw, setRaw] = useState('');
  const [pasted, setPasted] = useState('');
  const [hasHeader, setHasHeader] = useState(true);
  const [map, setMap] = useState<ColumnMap>({ name: null, phone: null, notes: null, tags: null });
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Response | null>(null);
  const [busy, setBusy] = useState(false);
  const [authorized, setAuthorized] = useState(false);
  const [done, setDone] = useState<Response | null>(null);

  const sheet = useMemo(() => (raw ? parseCsv(raw) : null), [raw]);
  const dataRows = useMemo(() => (sheet ? (hasHeader ? sheet.rows.slice(1) : sheet.rows) : []), [sheet, hasHeader]);
  const importRows = useMemo(() => toImportRows(dataRows, map), [dataRows, map]);
  const columns = sheet?.rows[0]?.length ?? 0;

  function load(text: string, name: string | null) {
    setError(null); setPreview(null); setDone(null); setAuthorized(false);
    setFileName(name); setRaw(text);
    const s = parseCsv(text);
    if (s.rows.length === 0) { setError('Não encontrei linhas nessa planilha.'); return; }
    const header = looksLikeHeader(s.rows[0]);
    setHasHeader(header);
    setMap(detectColumns(s.rows[0], header));
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    if (/\.xlsx?$/i.test(file.name)) { setError('Arquivos do Excel (.xlsx) ainda não são lidos. No Excel/Google Planilhas, use “Salvar como / Fazer download → CSV” e escolha o arquivo gerado.'); return; }
    if (file.size > MAX_BYTES) { setError('Arquivo muito grande (limite de 1 MB).'); return; }
    load(await file.text(), file.name);
  }

  async function check(dryRun: boolean) {
    setError(null);
    if (map.name === null || map.phone === null) { setError('Indique quais colunas são o nome e o telefone.'); return; }
    if (importRows.length === 0) { setError('Nenhuma linha de dados para importar.'); return; }
    if (importRows.length > MAX_ROWS) { setError(`A planilha tem ${importRows.length} linhas; importe até ${MAX_ROWS} por vez (divida o arquivo).`); return; }
    setBusy(true);
    try {
      const r = await api.post<Response>('/clients/import', { rows: importRows, dryRun });
      if (dryRun) setPreview(r); else { setDone(r); setPreview(null); }
    } catch (err) {
      setError(err instanceof ApiError || err instanceof Error ? err.message : 'Não foi possível processar a planilha.');
    } finally {
      setBusy(false);
    }
  }

  const statusOf = (i: number) => preview?.results.find((r) => r.index === i);

  return (
    <div className="space-y-6 pb-10 max-w-3xl">
      <nav aria-label="Navegação"><Link to="/clientes" className="text-sm text-wine-600 hover:underline">← Clientes</Link></nav>
      <header>
        <h1 className="font-display text-3xl sm:text-4xl text-wine-800 leading-tight">Importar clientes</h1>
        <p className="text-sm text-ink/60 mt-1.5">Traga sua lista de uma planilha (CSV). Você confere tudo antes de importar, e ninguém que já está cadastrada é alterada.</p>
      </header>

      {done ? (
        <section className="card p-5 space-y-3" role="status">
          <h2 className="font-display text-xl text-wine-700">Importação concluída</h2>
          <ul className="text-sm text-ink/75 space-y-1">
            <li><strong>{done.summary.created}</strong> clientes importadas.</li>
            {done.summary.duplicateExisting > 0 && <li>{done.summary.duplicateExisting} já estavam cadastradas (não foram alteradas).</li>}
            {done.summary.duplicateInFile > 0 && <li>{done.summary.duplicateInFile} repetidas na planilha (ignoradas).</li>}
            {done.summary.invalid > 0 && <li>{done.summary.invalid} com dados inválidos (ignoradas).</li>}
            {done.summary.skippedRace > 0 && <li>{done.summary.skippedRace} foram cadastradas por outro caminho enquanto você confirmava (ignoradas).</li>}
          </ul>
          <Link to="/clientes" className="btn-primary">Ver clientes</Link>
        </section>
      ) : (
        <>
          <section className="card p-5 space-y-3" aria-labelledby="imp-1">
            <h2 id="imp-1" className="section-title">1. Escolha a planilha</h2>
            <p className="text-sm text-ink/60">Formato CSV, até {MAX_ROWS} clientes por vez. Colunas esperadas: nome e telefone (observação e etiquetas são opcionais).</p>
            <input ref={fileRef} type="file" accept=".csv,.txt,.tsv,text/csv" className="sr-only" aria-label="Escolher arquivo CSV" onChange={(e) => onFile(e.target.files?.[0])} />
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" className="btn-secondary" onClick={() => fileRef.current?.click()}>Escolher arquivo</button>
              {fileName && <span className="text-sm text-ink/70 truncate">{fileName}</span>}
            </div>
            <details className="text-sm">
              <summary className="cursor-pointer text-wine-700 min-h-[32px]">Ou cole o conteúdo aqui</summary>
              <label htmlFor="imp-colar" className="sr-only">Conteúdo da planilha</label>
              <textarea id="imp-colar" className="input mt-2 font-mono text-xs" rows={5} placeholder={'nome;telefone\nMaria Silva;(31) 98888-1111'} value={pasted} onChange={(e) => setPasted(e.target.value)} />
              <button type="button" className="btn-secondary mt-2" disabled={!pasted.trim()} onClick={() => load(pasted, null)}>Usar este texto</button>
            </details>
          </section>

          {error && <LoadError message={error} />}

          {sheet && sheet.rows.length > 0 && (
            <section className="card p-5 space-y-4" aria-labelledby="imp-2">
              <h2 id="imp-2" className="section-title">2. Confira as colunas</h2>
              <label className="flex items-center gap-2 text-sm text-ink/75 min-h-[44px]">
                <input type="checkbox" checked={hasHeader} onChange={(e) => { setHasHeader(e.target.checked); setMap(detectColumns(sheet.rows[0], e.target.checked)); setPreview(null); }} />
                A primeira linha é o cabeçalho
              </label>
              <div className="grid sm:grid-cols-2 gap-3">
                {FIELDS.map((f) => (
                  <div key={f.key}>
                    <label htmlFor={`col-${f.key}`} className="block text-sm font-medium text-ink/70 mb-1.5">{f.label}{f.required ? ' *' : ''}</label>
                    <select id={`col-${f.key}`} className="input" value={map[f.key] ?? ''} onChange={(e) => { setMap({ ...map, [f.key]: e.target.value === '' ? null : Number(e.target.value) }); setPreview(null); }}>
                      <option value="">{f.required ? 'Escolha a coluna' : 'Não importar'}</option>
                      {Array.from({ length: columns }, (_, i) => <option key={i} value={i}>{hasHeader ? sheet.rows[0][i] || `Coluna ${i + 1}` : `Coluna ${i + 1}: ${sheet.rows[0][i] ?? ''}`}</option>)}
                    </select>
                  </div>
                ))}
              </div>
              <p className="text-xs text-ink/55">{dataRows.length} linha{dataRows.length === 1 ? '' : 's'} de dados lida{dataRows.length === 1 ? '' : 's'}.</p>
              <button type="button" className="btn-primary" onClick={() => check(true)} disabled={busy}>{busy && !preview ? 'Conferindo…' : 'Conferir antes de importar'}</button>
            </section>
          )}

          {preview && (
            <section className="card p-5 space-y-4" aria-labelledby="imp-3">
              <h2 id="imp-3" className="section-title">3. Confirme</h2>
              <p className="text-sm text-ink/75" role="status">
                <strong>{preview.summary.importable}</strong> serão importadas · {preview.summary.duplicateExisting} já cadastradas · {preview.summary.duplicateInFile} repetidas na planilha · {preview.summary.invalid} inválidas.
              </p>
              <div className="overflow-x-auto -mx-1 px-1">
                <table className="w-full text-sm">
                  <caption className="sr-only">Pré-visualização da importação (primeiras 50 linhas)</caption>
                  <thead><tr className="text-left text-[11px] uppercase tracking-widest text-ink/55"><th className="py-2 pr-3">Linha</th><th className="pr-3">Nome</th><th className="pr-3">Telefone</th><th>Situação</th></tr></thead>
                  <tbody className="divide-y divide-wine-50">
                    {importRows.slice(0, 50).map((r, i) => {
                      const st = statusOf(i);
                      const l = st ? LABEL[st.status] : null;
                      return (
                        <tr key={i} className={st && st.status !== 'ok' ? 'bg-wine-50/30' : ''}>
                          <td className="py-2 pr-3 tabular-nums text-ink/55">{i + 1 + (hasHeader ? 1 : 0)}</td>
                          <td className="pr-3 max-w-[12rem] truncate">{r.name || '—'}</td>
                          <td className="pr-3 tabular-nums">{r.phone || '—'}</td>
                          <td>{l && <span title={st?.reason} className={`inline-block text-[11px] px-2 py-0.5 rounded-full border ${l.cls}`}>{l.text}</span>}{st?.reason && st.status !== 'ok' && <span className="block text-xs text-ink/55">{st.reason}</span>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {importRows.length > 50 && <p className="text-xs text-ink/55">Mostrando 50 de {importRows.length} linhas; a importação considera todas.</p>}
              <label className="flex items-start gap-2 text-sm text-ink/75 min-h-[44px]">
                <input type="checkbox" className="mt-1" checked={authorized} onChange={(e) => setAuthorized(e.target.checked)} />
                <span>Confirmo que tenho o direito de guardar e usar esses contatos para atender minhas clientes.</span>
              </label>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn-primary" onClick={() => check(false)} disabled={busy || !authorized || preview.summary.importable === 0}>
                  {busy ? 'Importando…' : `Importar ${preview.summary.importable} cliente${preview.summary.importable === 1 ? '' : 's'}`}
                </button>
                <button type="button" className="btn-secondary" onClick={() => setPreview(null)} disabled={busy}>Voltar e ajustar</button>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
