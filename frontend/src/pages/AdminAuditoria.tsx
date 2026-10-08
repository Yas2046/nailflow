import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../services/api';
import { usePageTitle } from '../hooks/usePageTitle';
import { IconBan, IconCheckCircle, IconRefresh } from '../components/AdminIcons';

type AuditAction = 'update' | 'block' | 'unblock' | 'delete';

interface AuditItem {
  id: string;
  action: AuditAction;
  actorId: string;
  actorEmail: string;
  targetId: string;
  targetBusinessName: string;
  createdAt: string;
}

interface AuditResponse {
  items: AuditItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  summary: { today: number; last7Days: number };
}

const PAGE_SIZE = 15;

// ── apresentação por tipo de ação ───────────────────────────────────────────

const iconProps = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, viewBox: '0 0 24 24', 'aria-hidden': true } as const;

function IconPencil({ className = 'w-5 h-5' }: { className?: string }) {
  return <svg className={className} {...iconProps}><path strokeLinecap="round" strokeLinejoin="round" d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3ZM14.5 7.5l3 3" /></svg>;
}
function IconTrash({ className = 'w-5 h-5' }: { className?: string }) {
  return <svg className={className} {...iconProps}><path strokeLinecap="round" strokeLinejoin="round" d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12M10.5 11v5M13.5 11v5" /></svg>;
}
function IconClock({ className = 'w-5 h-5' }: { className?: string }) {
  return <svg className={className} {...iconProps}><circle cx="12" cy="12" r="8.5" /><path strokeLinecap="round" strokeLinejoin="round" d="M12 7.5V12l3 2" /></svg>;
}
function IconChevron({ open }: { open: boolean }) {
  return (
    <svg className={`w-4 h-4 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} {...iconProps}>
      <path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" />
    </svg>
  );
}

const ACTION_META: Record<AuditAction, { filter: string; title: string; icon: ReactNode; tile: string; text: string }> = {
  update: { filter: 'Edição', title: 'Cadastro editado', icon: <IconPencil />, tile: 'bg-wine-100 text-wine-700', text: 'text-wine-700' },
  block: { filter: 'Bloqueio', title: 'Conta bloqueada', icon: <IconBan />, tile: 'bg-rose-50 text-rose-600', text: 'text-rose-700' },
  unblock: { filter: 'Desbloqueio', title: 'Conta desbloqueada', icon: <IconCheckCircle />, tile: 'bg-sage-100 text-[#3F5F46]', text: 'text-[#3F5F46]' },
  delete: { filter: 'Exclusão', title: 'Conta excluída', icon: <IconTrash />, tile: 'bg-rose-100 text-rose-700', text: 'text-rose-700' },
};

const ACTION_FILTERS: Array<{ id: 'all' | AuditAction; label: string }> = [
  { id: 'all', label: 'Todas' },
  { id: 'update', label: 'Edição' },
  { id: 'block', label: 'Bloqueio' },
  { id: 'unblock', label: 'Desbloqueio' },
  { id: 'delete', label: 'Exclusão' },
];

type Preset = 'all' | 'today' | '7d' | '30d' | 'custom';
const PRESETS: Array<{ id: Exclude<Preset, 'custom'>; label: string }> = [
  { id: 'all', label: 'Todo o período' },
  { id: 'today', label: 'Hoje' },
  { id: '7d', label: '7 dias' },
  { id: '30d', label: '30 dias' },
];

// ── datas (apresentação) ────────────────────────────────────────────────────

function toDateParam(d: Date) {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function presetRange(preset: Exclude<Preset, 'custom'>): { from: string; to: string } {
  if (preset === 'all') return { from: '', to: '' };
  const today = new Date();
  const start = new Date(today);
  if (preset === '7d') start.setDate(start.getDate() - 6);
  if (preset === '30d') start.setDate(start.getDate() - 29);
  return { from: toDateParam(start), to: toDateParam(today) };
}

function formatShort(iso: string) {
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function formatFull(iso: string) {
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// ── peças visuais ───────────────────────────────────────────────────────────

function SkeletonBlock({ className }: { className: string }) {
  return <div className={`bg-wine-100/60 rounded-lg animate-pulse ${className}`} />;
}

function SummaryStat({ label, caption, value }: { label: string; caption: string; value: number | null }) {
  return (
    <div className="min-w-0 p-5 sm:p-7">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ink/60">{label}</p>
      {value === null ? (
        <SkeletonBlock className="mt-3 h-9 w-14" />
      ) : (
        <p className="mt-2 font-display text-4xl font-semibold leading-none text-wine-800">{value}</p>
      )}
      <p className="mt-2 text-sm text-ink/65">{caption}</p>
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="rounded-3xl bg-white border border-rose-200 p-10 text-center shadow-sm">
      <span className="mx-auto w-12 h-12 rounded-2xl bg-rose-50 text-rose-500 flex items-center justify-center"><IconBan /></span>
      <p className="font-display text-xl text-wine-800 mt-4">Não foi possível carregar</p>
      <p className="text-sm text-rose-700 mt-1">{message}</p>
      <button onClick={onRetry} className="btn-primary mt-6">Tentar novamente</button>
    </div>
  );
}

function ListSkeleton() {
  return (
    <div aria-busy="true" aria-live="polite" className="rounded-3xl bg-white border border-wine-100/70 shadow-sm divide-y divide-wine-100/60">
      <span className="sr-only">Carregando registros…</span>
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="flex items-center gap-4 p-4 sm:p-5">
          <div className="w-11 h-11 rounded-2xl bg-wine-100/60 animate-pulse shrink-0" />
          <div className="flex-1 space-y-2">
            <SkeletonBlock className="h-4 w-44" />
            <SkeletonBlock className="h-3 w-56 max-w-full" />
          </div>
          <SkeletonBlock className="h-4 w-24 hidden sm:block" />
        </div>
      ))}
    </div>
  );
}

function DetailRow({ label, children, mono = false }: { label: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs uppercase tracking-widest font-semibold text-ink/60">{label}</dt>
      <dd className={`mt-1 text-sm text-ink/75 break-all ${mono ? 'font-mono text-xs text-ink/60' : ''}`}>{children}</dd>
    </div>
  );
}

function AuditRow({ item, open, onToggle }: { item: AuditItem; open: boolean; onToggle: () => void }) {
  const meta = ACTION_META[item.action];
  const panelId = useId();
  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={panelId}
        className="w-full text-left flex items-start sm:items-center gap-4 p-4 sm:p-5 hover:bg-wine-50/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-wine-400/50 transition-colors"
      >
        <span className={`w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 ${meta.tile}`}>{meta.icon}</span>
        <span className="min-w-0 flex-1 grid sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] gap-x-6 gap-y-1">
          <span className="min-w-0">
            <span className={`block text-sm font-semibold ${meta.text}`}>{meta.title}</span>
            <span className="block text-sm text-ink/70 truncate" title={item.targetBusinessName}>{item.targetBusinessName}</span>
          </span>
          <span className="min-w-0 sm:text-right">
            <span className="block text-xs text-ink/60 truncate" title={item.actorEmail}>por {item.actorEmail}</span>
            <span className="block text-xs text-ink/65 tabular-nums mt-0.5">{formatShort(item.createdAt)}</span>
          </span>
        </span>
        <span className="text-ink/60 shrink-0 mt-1 sm:mt-0"><IconChevron open={open} /></span>
      </button>

      {open && (
        <div id={panelId} className="px-4 sm:px-5 pb-5 -mt-1">
          <div className="rounded-2xl bg-cream border border-wine-100/60 p-4 sm:p-5">
            <dl className="grid sm:grid-cols-2 gap-x-8 gap-y-4">
              <DetailRow label="Ação">{meta.filter}</DetailRow>
              <DetailRow label="Data e hora">{formatFull(item.createdAt)}</DetailRow>
              <DetailRow label="Feita por">{item.actorEmail}</DetailRow>
              <DetailRow label="Profissional (nome do negócio no registro)">{item.targetBusinessName}</DetailRow>
            </dl>
            <details className="mt-4 text-sm">
              <summary className="cursor-pointer rounded font-medium text-wine-600 hover:text-wine-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-wine-500/40">Detalhes técnicos</summary>
              <dl className="mt-3 grid sm:grid-cols-2 gap-x-8 gap-y-3">
                <DetailRow label="ID do administrador" mono>{item.actorId}</DetailRow>
                <DetailRow label="ID da profissional" mono>{item.targetId}</DetailRow>
                <DetailRow label="ID do registro" mono>{item.id}</DetailRow>
              </dl>
            </details>
            <p className="text-xs text-ink/60 mt-4 leading-relaxed">
              Este registro guarda apenas quem fez a ação, qual foi a ação, em qual conta e quando.
              Os campos alterados em uma edição não são armazenados.
              {item.action === 'delete' && ' A conta foi excluída; o nome do negócio acima é o que ficou gravado no momento da exclusão.'}
            </p>
          </div>
        </div>
      )}
    </li>
  );
}

// ── página ──────────────────────────────────────────────────────────────────

export default function AdminAuditoria() {
  usePageTitle('Auditoria');
  const [action, setAction] = useState<'all' | AuditAction>('all');
  const [preset, setPreset] = useState<Preset>('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<AuditResponse | null>(null);
  const [summary, setSummary] = useState<AuditResponse['summary'] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const requestRef = useRef(0);
  const actionsLabelId = useId();
  const periodLabelId = useId();

  const rangeInvalid = from !== '' && to !== '' && from > to;
  const hasFilters = action !== 'all' || from !== '' || to !== '';

  useEffect(() => {
    if (rangeInvalid) return;
    const id = ++requestRef.current;
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
    if (action !== 'all') params.set('action', action);
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    setLoading(true);
    setError(null);
    api.get<AuditResponse>(`/admin/audit-log?${params.toString()}`)
      .then((res) => {
        if (id !== requestRef.current) return; // resposta antiga
        setData(res);
        setSummary(res.summary);
        setExpandedId(null);
      })
      .catch(() => {
        if (id !== requestRef.current) return;
        setError('Erro ao carregar o histórico de auditoria.');
      })
      .finally(() => {
        if (id === requestRef.current) setLoading(false);
      });
  }, [action, from, to, page, reloadKey, rangeInvalid]);

  const retry = useCallback(() => setReloadKey((k) => k + 1), []);

  // ao trocar de página, volta ao começo da lista (respeita "reduzir movimento")
  const listRef = useRef<HTMLElement>(null);
  const firstPageRender = useRef(true);
  useEffect(() => {
    if (firstPageRender.current) { firstPageRender.current = false; return; }
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    listRef.current?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  }, [page]);

  function chooseAction(a: 'all' | AuditAction) {
    setAction(a);
    setPage(1);
  }
  function choosePreset(p: Exclude<Preset, 'custom'>) {
    const r = presetRange(p);
    setPreset(p);
    setFrom(r.from);
    setTo(r.to);
    setPage(1);
  }
  function changeDate(which: 'from' | 'to', value: string) {
    if (which === 'from') setFrom(value); else setTo(value);
    setPreset('custom');
    setPage(1);
  }
  function clearFilters() {
    setAction('all');
    setPreset('all');
    setFrom('');
    setTo('');
    setPage(1);
  }

  const total = data?.total ?? 0;
  const pageSize = data?.pageSize ?? PAGE_SIZE;
  const firstShown = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastShown = Math.min(page * pageSize, total);
  const totalPages = data?.totalPages ?? 1;
  const initialLoad = loading && data === null;

  return (
    <div className="max-w-[78rem] mx-auto">

      {/* ── topo ─────────────────────────────────────────────────────────── */}
      <header className="mb-8 sm:mb-10">
        <p className="text-xs uppercase tracking-[0.22em] font-semibold text-gold-600">Gestão</p>
        <h1 className="font-display text-3xl sm:text-4xl font-semibold text-wine-800 leading-tight mt-2">Auditoria</h1>
        <p className="text-base text-ink/65 mt-1.5 max-w-2xl">
          Histórico das ações administrativas feitas sobre as contas das profissionais: edições, bloqueios,
          desbloqueios e exclusões. Só ações concluídas com sucesso são registradas. Suas próprias ações também
          aparecem em{' '}
          <Link to="/admin/conta/atividade" className="font-medium text-wine-600 underline-offset-4 hover:text-wine-800 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-wine-500/40 rounded">Atividade</Link>.
        </p>
      </header>

      {/* ── resumo ───────────────────────────────────────────────────────── */}
      <section
        aria-label="Resumo"
        className="mb-8 grid overflow-hidden rounded-3xl border border-wine-100/80 bg-white/85 shadow-[0_1px_2px_rgba(61,29,40,0.04),0_26px_60px_-34px_rgba(61,29,40,0.22)] sm:mb-10 sm:grid-cols-2 [&>*]:border-wine-100/70 [&>*:last-child]:border-t sm:[&>*:first-child]:border-r sm:[&>*:last-child]:border-t-0"
      >
        <SummaryStat label="Ações hoje" caption="desde as 00:00 (horário de Brasília)" value={summary?.today ?? null} />
        <SummaryStat label="Últimos 7 dias" caption="nas últimas 168 horas" value={summary?.last7Days ?? null} />
      </section>

      {/* ── filtros ──────────────────────────────────────────────────────── */}
      <section aria-label="Filtros" className="mb-6 space-y-5">
        <div>
          <p id={actionsLabelId} className="text-xs uppercase tracking-widest font-semibold text-ink/60 mb-2">Ação</p>
          <div role="group" aria-labelledby={actionsLabelId} className="flex flex-wrap gap-2">
            {ACTION_FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                aria-pressed={action === f.id}
                onClick={() => chooseAction(f.id)}
                className={`inline-flex min-h-[42px] items-center rounded-full border px-4 text-[15px] transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-wine-500/40 ${
                  action === f.id ? 'border-wine-600 bg-wine-600 font-medium text-white' : 'border-wine-100 bg-white/80 text-ink/70 hover:border-wine-300 hover:text-wine-800'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p id={periodLabelId} className="text-xs uppercase tracking-widest font-semibold text-ink/60 mb-2">Período</p>
          <div className="flex flex-col xl:flex-row xl:items-end gap-3">
            <div role="group" aria-labelledby={periodLabelId} className="flex flex-wrap gap-2">
              {PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  aria-pressed={preset === p.id}
                  onClick={() => choosePreset(p.id)}
                  className={`inline-flex min-h-[42px] items-center rounded-full border px-4 text-[15px] transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-wine-500/40 ${
                    preset === p.id ? 'border-wine-600 bg-wine-600 font-medium text-white' : 'border-wine-100 bg-white/80 text-ink/70 hover:border-wine-300 hover:text-wine-800'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-end gap-3 xl:ml-auto">
              <label className="block">
                <span className="block text-xs text-ink/60 mb-1">De</span>
                <input type="date" className="input !py-1.5 w-40" value={from} max={to || undefined} onChange={(e) => changeDate('from', e.target.value)} />
              </label>
              <label className="block">
                <span className="block text-xs text-ink/60 mb-1">Até</span>
                <input type="date" className="input !py-1.5 w-40" value={to} min={from || undefined} onChange={(e) => changeDate('to', e.target.value)} />
              </label>
              {hasFilters && (
                <button type="button" onClick={clearFilters} className="btn-ghost !py-2">Limpar filtros</button>
              )}
            </div>
          </div>
          {rangeInvalid && (
            <p role="alert" className="text-xs text-rose-600 mt-2">A data inicial não pode ser depois da data final.</p>
          )}
        </div>
      </section>

      {/* ── lista ────────────────────────────────────────────────────────── */}
      <section aria-label="Registros" ref={listRef} className="scroll-mt-24 lg:scroll-mt-6">
        <div className="flex items-center justify-between gap-3 mb-4">
          <p className="text-sm text-ink/65" aria-live="polite">
            {initialLoad || rangeInvalid || error ? ' ' : total === 0 ? 'Nenhum registro' : `${firstShown}–${lastShown} de ${total} ${total === 1 ? 'registro' : 'registros'}`}
          </p>
          <button type="button" onClick={retry} disabled={loading} className="inline-flex min-h-[40px] items-center gap-2 rounded-full border border-wine-100 bg-white/80 px-4 text-sm text-ink/65 transition-colors hover:border-wine-300 hover:text-wine-800 disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-wine-500/40">
            <IconRefresh />
            Atualizar
          </button>
        </div>

        {error && !loading ? (
          <ErrorState message={error} onRetry={retry} />
        ) : initialLoad ? (
          <ListSkeleton />
        ) : data && data.items.length === 0 ? (
          <div className="rounded-3xl bg-white border border-wine-100/70 p-14 text-center shadow-sm">
            <span className="mx-auto w-14 h-14 rounded-2xl bg-gold-300/30 text-gold-600 flex items-center justify-center"><IconClock className="w-6 h-6" /></span>
            <p className="font-display text-xl text-wine-800 mt-5">
              {hasFilters ? 'Nenhum registro com esses filtros' : 'Ainda não há ações registradas'}
            </p>
            <p className="text-sm text-ink/60 mt-1.5">
              {hasFilters ? 'Tente outro período ou outro tipo de ação.' : 'Quando uma conta for editada, bloqueada, desbloqueada ou excluída, o registro aparece aqui.'}
            </p>
            {hasFilters && <button onClick={clearFilters} className="btn-secondary mt-6">Limpar filtros</button>}
          </div>
        ) : data ? (
          <ul
            aria-busy={loading}
            className={`rounded-3xl bg-white border border-wine-100/70 shadow-[0_1px_2px_rgba(61,29,40,0.04),0_10px_28px_-14px_rgba(61,29,40,0.14)] divide-y divide-wine-100/60 transition-opacity ${loading ? 'opacity-60' : ''}`}
          >
            {data.items.map((item) => (
              <AuditRow
                key={item.id}
                item={item}
                open={expandedId === item.id}
                onToggle={() => setExpandedId((cur) => (cur === item.id ? null : item.id))}
              />
            ))}
          </ul>
        ) : null}

        {/* paginação */}
        {data && data.items.length > 0 && !error && (
          <nav aria-label="Paginação" className="mt-6 flex items-center justify-between gap-3">
            <button type="button" className="btn-secondary" disabled={page <= 1 || loading} onClick={() => setPage((p) => Math.max(1, p - 1))}>
              Anterior
            </button>
            <span className="text-sm text-ink/65 tabular-nums">Página {page} de {totalPages}</span>
            <button type="button" className="btn-secondary" disabled={page >= totalPages || loading} onClick={() => setPage((p) => p + 1)}>
              Próxima
            </button>
          </nav>
        )}
      </section>
    </div>
  );
}
