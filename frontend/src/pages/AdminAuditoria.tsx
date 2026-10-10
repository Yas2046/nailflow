import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../services/api';
import { usePageTitle } from '../hooks/usePageTitle';
import { IconBan, IconRefresh } from '../components/AdminIcons';
import { Badge, PageHeader, Segmented } from '../components/admin-account/AccountUi';
import { ACTIVITY_META, ActionIcon } from '../components/admin-account/AccountBlocks';

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

// ── apresentação: a mesma de toda a área admin (ACTIVITY_META / ActionIcon) ──

const iconProps = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, viewBox: '0 0 24 24', 'aria-hidden': true } as const;

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
  return <div className={`animate-pulse rounded-md bg-wine-100/70 ${className}`} />;
}

function SummaryStat({ label, caption, value }: { label: string; caption: string; value: number | null }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-4 px-5 py-4 sm:px-6">
      <div className="min-w-0">
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink/60">{label}</p>
        <p className="mt-1 text-sm text-ink/65">{caption}</p>
      </div>
      {value === null ? (
        <SkeletonBlock className="h-8 w-12" />
      ) : (
        <p className="font-display text-4xl font-semibold leading-none tabular-nums text-wine-800">{value}</p>
      )}
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50/60 p-10 text-center">
      <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-lg bg-white text-rose-600"><IconBan /></span>
      <p className="mt-4 font-display text-xl font-semibold text-wine-800">Não foi possível carregar</p>
      <p className="mt-1 text-[15px] text-rose-700">{message}</p>
      <button onClick={onRetry} className="btn-primary mt-6">Tentar novamente</button>
    </div>
  );
}

function ListSkeleton() {
  return (
    <div aria-busy="true" aria-live="polite" className="divide-y divide-wine-100 rounded-2xl border border-wine-100 bg-white">
      <span className="sr-only">Carregando registros…</span>
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="flex items-center gap-4 p-4 sm:p-5">
          <div className="h-10 w-10 shrink-0 animate-pulse rounded-lg bg-wine-100/70" />
          <div className="flex-1 space-y-2">
            <SkeletonBlock className="h-4 w-44" />
            <SkeletonBlock className="h-3 w-56 max-w-full" />
          </div>
          <SkeletonBlock className="hidden h-4 w-24 sm:block" />
        </div>
      ))}
    </div>
  );
}

function DetailRow({ label, children, mono = false }: { label: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink/60">{label}</dt>
      <dd className={`mt-1 break-all text-sm text-ink/85 ${mono ? 'font-mono text-xs' : ''}`}>{children}</dd>
    </div>
  );
}

function TechRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="grid gap-x-4 gap-y-0.5 sm:grid-cols-[10rem_minmax(0,1fr)]">
      <dt className="text-[#A0958E]">{k}</dt>
      <dd className="break-all text-white">{v}</dd>
    </div>
  );
}

function AuditRow({ item, open, onToggle }: { item: AuditItem; open: boolean; onToggle: () => void }) {
  const meta = ACTIVITY_META[item.action];
  const panelId = useId();
  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={panelId}
        className={`flex w-full items-start gap-4 p-4 text-left transition-colors hover:bg-wine-50/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-wine-500/50 sm:items-center sm:px-6 ${open ? 'bg-wine-50/50' : ''}`}
      >
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${meta.tile}`}><ActionIcon action={item.action} /></span>
        <span className="grid min-w-0 flex-1 gap-x-6 gap-y-1.5 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_9.5rem]">
          <span className="min-w-0">
            <span className="block text-[15px] font-semibold text-ink/95">{meta.title}</span>
            <span className="mt-0.5 block truncate text-sm text-ink/70" title={item.targetBusinessName}>{item.targetBusinessName}</span>
          </span>
          <span className="block min-w-0 truncate font-mono text-xs leading-5 text-ink/65" title={item.actorEmail}>por {item.actorEmail}</span>
          <span className="font-mono text-xs tabular-nums text-ink/70 sm:text-right">{formatShort(item.createdAt)}</span>
        </span>
        <span className="mt-1 shrink-0 text-ink/55 sm:mt-0"><IconChevron open={open} /></span>
      </button>

      {open && (
        <div id={panelId} className="px-4 pb-5 sm:px-6">
          <div className="rounded-xl border border-wine-100 bg-cream p-4 sm:p-5">
            <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
              <DetailRow label="Ação"><Badge tone={meta.tone}>{meta.label}</Badge></DetailRow>
              <DetailRow label="Data e hora">{formatFull(item.createdAt)}</DetailRow>
              <DetailRow label="Feita por">{item.actorEmail}</DetailRow>
              <DetailRow label="Profissional (nome do negócio no registro)">{item.targetBusinessName}</DetailRow>
            </dl>
            <details className="mt-4 text-sm">
              <summary className="cursor-pointer rounded font-medium text-wine-600 hover:text-wine-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-wine-500/50">Detalhes técnicos</summary>
              <dl className="mt-3 space-y-2 rounded-lg bg-night-900 p-4 font-mono text-xs leading-relaxed">
                <TechRow k="admin_id" v={item.actorId} />
                <TechRow k="profissional_id" v={item.targetId} />
                <TechRow k="registro_id" v={item.id} />
              </dl>
            </details>
            <p className="mt-4 text-xs leading-relaxed text-ink/65">
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
  function choosePreset(p: Preset) {
    if (p === 'custom') return;
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
    <div className="mx-auto max-w-[80rem]">

      <PageHeader
        eyebrow="gestão / auditoria"
        title="Auditoria"
        subtitle={
          <>
            Histórico das ações administrativas sobre as contas das profissionais: edições, bloqueios,
            desbloqueios e exclusões. Só ações concluídas com sucesso são registradas. As suas também
            aparecem em{' '}
            <Link to="/admin/conta/atividade" className="font-medium text-wine-600 underline-offset-4 hover:text-wine-800 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-wine-500/50 rounded">Atividade</Link>.
          </>
        }
      />

      {/* ── resumo ───────────────────────────────────────────────────────── */}
      <section
        aria-label="Resumo"
        className="mb-6 grid overflow-hidden rounded-2xl border border-wine-100 bg-white sm:grid-cols-2 [&>*]:border-wine-100 [&>*:last-child]:border-t sm:[&>*:first-child]:border-r sm:[&>*:last-child]:border-t-0"
      >
        <SummaryStat label="Ações hoje" caption="desde as 00:00 (horário de Brasília)" value={summary?.today ?? null} />
        <SummaryStat label="Últimos 7 dias" caption="nas últimas 168 horas" value={summary?.last7Days ?? null} />
      </section>

      {/* ── filtros ──────────────────────────────────────────────────────── */}
      <section aria-label="Filtros" className="mb-5 space-y-3">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <Segmented<'all' | AuditAction>
            label="Filtrar por ação"
            value={action}
            onChange={chooseAction}
            options={ACTION_FILTERS}
          />
          <Segmented<Preset>
            label="Filtrar por período"
            value={preset}
            onChange={choosePreset}
            options={PRESETS}
          />
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="mb-1 block font-mono text-[11px] uppercase tracking-wider text-ink/60">De</span>
            <input type="date" className="input !py-1.5 w-40" value={from} max={to || undefined} onChange={(e) => changeDate('from', e.target.value)} />
          </label>
          <label className="block">
            <span className="mb-1 block font-mono text-[11px] uppercase tracking-wider text-ink/60">Até</span>
            <input type="date" className="input !py-1.5 w-40" value={to} min={from || undefined} onChange={(e) => changeDate('to', e.target.value)} />
          </label>
          {hasFilters && (
            <button type="button" onClick={clearFilters} className="btn-ghost !py-2.5">Limpar filtros</button>
          )}
        </div>
        {rangeInvalid && (
          <p role="alert" className="text-xs text-rose-600">A data inicial não pode ser depois da data final.</p>
        )}
      </section>

      {/* ── lista ────────────────────────────────────────────────────────── */}
      <section aria-label="Registros" ref={listRef} className="scroll-mt-24 lg:scroll-mt-20">
        <div className="mb-3 flex items-center justify-between gap-3">
          <p className="font-mono text-xs text-ink/65" aria-live="polite">
            {initialLoad || rangeInvalid || error ? ' ' : total === 0 ? 'nenhum registro' : `${firstShown}–${lastShown} de ${total} ${total === 1 ? 'registro' : 'registros'}`}
          </p>
          <button
            type="button"
            onClick={retry}
            disabled={loading}
            title="Atualizar registros"
            aria-label="Atualizar registros"
            className="btn-secondary h-[40px] w-[40px] !p-0"
          >
            <IconRefresh className={loading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
          </button>
        </div>

        {error && !loading ? (
          <ErrorState message={error} onRetry={retry} />
        ) : initialLoad ? (
          <ListSkeleton />
        ) : data && data.items.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-wine-200 bg-white p-14 text-center">
            <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg bg-night-900 text-wine-300"><IconClock className="h-6 w-6" /></span>
            <p className="mt-5 font-display text-xl font-semibold text-wine-800">
              {hasFilters ? 'Nenhum registro com esses filtros' : 'Ainda não há ações registradas'}
            </p>
            <p className="mt-1.5 text-[15px] text-ink/65">
              {hasFilters ? 'Tente outro período ou outro tipo de ação.' : 'Quando uma conta for editada, bloqueada, desbloqueada ou excluída, o registro aparece aqui.'}
            </p>
            {hasFilters && <button onClick={clearFilters} className="btn-secondary mt-6">Limpar filtros</button>}
          </div>
        ) : data ? (
          <ul
            aria-busy={loading}
            className={`divide-y divide-wine-100 overflow-hidden rounded-2xl border border-wine-100 bg-white transition-opacity ${loading ? 'opacity-60' : ''}`}
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
          <nav aria-label="Paginação" className="mt-5 flex items-center justify-between gap-3">
            <button type="button" className="btn-secondary" disabled={page <= 1 || loading} onClick={() => setPage((p) => Math.max(1, p - 1))}>
              Anterior
            </button>
            <span className="font-mono text-xs tabular-nums text-ink/65">página {page} de {totalPages}</span>
            <button type="button" className="btn-secondary" disabled={page >= totalPages || loading} onClick={() => setPage((p) => p + 1)}>
              Próxima
            </button>
          </nav>
        )}
      </section>
    </div>
  );
}
