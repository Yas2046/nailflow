import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../../services/api';
import { usePageTitle } from '../../hooks/usePageTitle';
import { useVisiblePolling } from '../../hooks/useVisiblePolling';
import { PageHeader } from '../../components/admin-account/AccountUi';
import { useAdminShell } from '../../components/adminShell';
import {
  CATEGORIES, PRIORITIES, STATUSES, adminSupportApi, categoryTitle, fmtShort, priorityLabel, relativeTime, statusLabel, ticketCode,
  type AdminListParams, type AdminTicket, type Paged, type SupportCategory, type SupportPriority, type SupportStatus,
} from '../../services/support';
import { EmptyBox, ErrorBox, IconBubble, LoadingList, Pager, PriorityPill, StatusPill, UnreadDot, Unavailable } from '../../components/support/SupportUi';
import { CategoryIcon, IconAlert, IconCheckCircle, IconChat, IconClock, IconFilter, IconInbox, IconSearch } from '../../components/support/SupportIcons';

const PAGE_SIZE = 15;

interface ProfessionalOption { id: string; name: string; business_name: string; is_admin?: boolean }

interface Filters {
  status: SupportStatus | '';
  priority: SupportPriority | '';
  category: SupportCategory | '';
  professionalId: string;
  from: string;
  to: string;
  unread: boolean;
  q: string;
}
const EMPTY: Filters = { status: '', priority: '', category: '', professionalId: '', from: '', to: '', unread: false, q: '' };

function Stat({ label, value, active, onClick, tone = 'plain', icon }: { label: string; value: number | null; active: boolean; onClick: () => void; tone?: 'plain' | 'alert'; icon: ReactNode }) {
  const alert = tone === 'alert' && value !== null && value > 0;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`min-w-0 rounded-2xl border p-4 text-left shadow-sm transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-wine-500/50 ${
        active ? 'border-wine-500 bg-wine-50 shadow-md' : 'border-wine-100 bg-white hover:-translate-y-px hover:border-wine-300'
      }`}
    >
      <span className="flex items-start justify-between gap-2">
        <span className="block font-mono text-[11px] uppercase leading-4 tracking-[0.14em] text-ink/60">{label}</span>
        <IconBubble size="sm" tone={alert ? 'gold' : 'wine'}>{icon}</IconBubble>
      </span>
      {value === null
        ? <span className="mt-2 block h-8 w-10 animate-pulse rounded-md bg-wine-100/70" />
        : <span className={`mt-2 block font-display text-3xl font-semibold leading-none tabular-nums ${alert ? 'text-gold-700' : 'text-wine-800'}`}>{value}</span>}
    </button>
  );
}

export default function AdminSuporte() {
  usePageTitle('Suporte');
  const shell = useAdminShell();
  const support = shell?.support;
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Paged<AdminTicket> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ message: string; off: boolean } | null>(null);
  const [professionals, setProfessionals] = useState<ProfessionalOption[]>([]);
  const seq = useRef(0);
  // Em telas largas os filtros já começam abertos; no celular ficam recolhidos para a fila aparecer primeiro.
  const [showFilters, setShowFilters] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.('(min-width: 1024px)').matches);

  useEffect(() => {
    api.get<ProfessionalOption[]>('/admin/professionals').then((r) => setProfessionals(r.filter((p) => !p.is_admin))).catch(() => {});
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => { setFilters((f) => (f.q === search.trim() ? f : { ...f, q: search.trim() })); setPage(1); }, 350);
    return () => window.clearTimeout(t);
  }, [search]);

  const fetchList = useCallback(async (silent: boolean) => {
    const mine = ++seq.current;
    if (!silent) { setLoading(true); setError(null); }
    const params: AdminListParams = { ...filters, page, pageSize: PAGE_SIZE, professionalId: filters.professionalId || undefined };
    try {
      const r = await adminSupportApi.list(params);
      if (mine === seq.current) { setData(r); setError(null); }
    } catch (e) {
      if (mine === seq.current && !silent) setError({ message: e instanceof ApiError ? e.message : 'Verifique sua conexão e tente de novo.', off: e instanceof ApiError && e.status === 404 });
    } finally {
      if (mine === seq.current && !silent) setLoading(false);
    }
  }, [filters, page]);

  useEffect(() => { void fetchList(false); }, [fetchList]);
  useVisiblePolling(() => { void fetchList(true); }, 60_000, true);

  if (support?.checked && !support.enabled) return <Unavailable />;
  if (error?.off) return <Unavailable />;

  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => { setFilters((f) => ({ ...f, [k]: v })); setPage(1); };
  const clear = () => { setFilters(EMPTY); setSearch(''); setPage(1); };
  const anyFilter = JSON.stringify(filters) !== JSON.stringify(EMPTY);
  const activeCount = (Object.keys(EMPTY) as Array<keyof Filters>).filter((k) => k !== 'q' && filters[k] !== EMPTY[k]).length;
  const s = support?.summary ?? null;
  const only = (patch: Partial<Filters>) => { setFilters({ ...EMPTY, q: filters.q, ...patch }); setPage(1); };

  return (
    <div>
      <PageHeader
        eyebrow="Suporte"
        title="Solicitações"
        subtitle="Fila de atendimento das profissionais. Responder move a solicitação para “Aguardando a profissional”."
        actions={<Link to="/admin/suporte/faq" className="btn-secondary">Editar FAQ</Link>}
      />

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-5" aria-label="Indicadores">
        <Stat icon={<IconInbox className="h-4 w-4" />} label="Abertas" value={s?.abertas ?? null} active={filters.status === 'aberta'} onClick={() => only(filters.status === 'aberta' ? {} : { status: 'aberta' })} />
        <Stat icon={<IconChat className="h-4 w-4" />} label="Em atendimento" value={s?.emAtendimento ?? null} active={filters.status === 'em_atendimento'} onClick={() => only(filters.status === 'em_atendimento' ? {} : { status: 'em_atendimento' })} />
        <Stat icon={<IconClock className="h-4 w-4" />} label="Aguardando" value={s?.aguardando ?? null} active={filters.status === 'aguardando_profissional'} onClick={() => only(filters.status === 'aguardando_profissional' ? {} : { status: 'aguardando_profissional' })} />
        <Stat icon={<IconCheckCircle className="h-4 w-4" />} label="Resolvidas · 7 dias" value={s?.resolvidas7d ?? null} active={filters.status === 'resolvida'} onClick={() => only(filters.status === 'resolvida' ? {} : { status: 'resolvida' })} />
        <Stat icon={<IconAlert className="h-4 w-4" />} label="Não lidas" value={s?.naoLidas ?? null} tone="alert" active={filters.unread} onClick={() => only(filters.unread ? {} : { unread: true })} />
      </div>

      <section aria-label="Filtros" className="mb-5 rounded-2xl border border-wine-100 bg-white p-4 sm:p-5">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <label htmlFor="adm-q" className="sr-only">Buscar</label>
            <IconSearch className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-wine-400" />
            <input id="adm-q" type="search" className="input !pl-10" placeholder="Buscar por número, assunto ou profissional" value={search} onChange={(e) => setSearch(e.target.value)} autoComplete="off" />
          </div>
          <button type="button" className="btn-secondary min-h-[44px] shrink-0 gap-2" aria-expanded={showFilters} aria-controls="adm-filtros" onClick={() => setShowFilters((v) => !v)}>
            <IconFilter className="h-4 w-4" />
            <span className="hidden sm:inline">Filtros</span>
            {activeCount > 0 && <span className="inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-wine-600 px-1.5 text-[11px] font-bold text-white">{activeCount}</span>}
          </button>
        </div>
        <div id="adm-filtros" className={`mt-4 gap-3 sm:grid-cols-2 lg:grid-cols-4 ${showFilters ? 'grid' : 'hidden'}`}>
          <div>
            <label htmlFor="adm-status" className="mb-1 block text-xs font-medium text-ink/70">Status</label>
            <select id="adm-status" className="input" value={filters.status} onChange={(e) => set('status', e.target.value as SupportStatus | '')}>
              <option value="">Todos</option>
              {STATUSES.map((v) => <option key={v} value={v}>{statusLabel(v, 'admin')}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="adm-prio" className="mb-1 block text-xs font-medium text-ink/70">Prioridade</label>
            <select id="adm-prio" className="input" value={filters.priority} onChange={(e) => set('priority', e.target.value as SupportPriority | '')}>
              <option value="">Todas</option>
              {PRIORITIES.map((v) => <option key={v} value={v}>{priorityLabel(v)}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="adm-cat" className="mb-1 block text-xs font-medium text-ink/70">Categoria</label>
            <select id="adm-cat" className="input" value={filters.category} onChange={(e) => set('category', e.target.value as SupportCategory | '')}>
              <option value="">Todas</option>
              {CATEGORIES.map((c) => <option key={c.slug} value={c.slug}>{c.title}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="adm-prof" className="mb-1 block text-xs font-medium text-ink/70">Profissional</label>
            <select id="adm-prof" className="input" value={filters.professionalId} onChange={(e) => set('professionalId', e.target.value)}>
              <option value="">Todas</option>
              {professionals.map((p) => <option key={p.id} value={p.id}>{p.business_name} · {p.name}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="adm-from" className="mb-1 block text-xs font-medium text-ink/70">Criada a partir de</label>
            <input id="adm-from" type="date" className="input" value={filters.from} max={filters.to || undefined} onChange={(e) => set('from', e.target.value)} />
          </div>
          <div>
            <label htmlFor="adm-to" className="mb-1 block text-xs font-medium text-ink/70">Criada até</label>
            <input id="adm-to" type="date" className="input" value={filters.to} min={filters.from || undefined} onChange={(e) => set('to', e.target.value)} />
          </div>
          <div className="flex items-end">
            <label className="flex min-h-[44px] cursor-pointer items-center gap-2.5 text-sm text-ink/80">
              <input type="checkbox" className="h-4 w-4 accent-wine-600" checked={filters.unread} onChange={(e) => set('unread', e.target.checked)} />
              Só não lidas
            </label>
          </div>
          <div className="flex items-end justify-end">
            <button type="button" className="btn-ghost" onClick={clear} disabled={!anyFilter && search === ''}>Limpar filtros</button>
          </div>
        </div>
      </section>

      {loading ? (
        <LoadingList rows={5} label="Carregando solicitações…" />
      ) : error ? (
        <ErrorBox message={error.message} onRetry={() => void fetchList(false)} />
      ) : !data || data.items.length === 0 ? (
        anyFilter || search
          ? <EmptyBox icon={<IconSearch className="h-6 w-6" />} title="Nenhuma solicitação para esses filtros" action={<button type="button" className="btn-secondary" onClick={clear}>Limpar filtros</button>}>Ajuste a busca ou os filtros.</EmptyBox>
          : <EmptyBox icon={<IconInbox className="h-6 w-6" />} title="Nenhuma solicitação ainda">Quando uma profissional abrir uma solicitação, ela aparece aqui.</EmptyBox>
      ) : (
        <>
          <ul className="divide-y divide-wine-100 overflow-hidden rounded-2xl border border-wine-100 bg-white">
            {data.items.map((t) => (
              <li key={t.id}>
                <Link
                  to={`/admin/suporte/${t.id}`}
                  className={`group flex items-start gap-3 border-l-4 p-4 transition-colors hover:bg-wine-50/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-wine-500/50 sm:items-center sm:px-5 ${
                    t.priority === 'alta' ? 'border-l-rose-400' : t.priority === 'media' ? 'border-l-gold-400' : 'border-l-transparent'
                  } ${t.unread ? 'bg-gold-300/10' : ''}`}
                >
                  <IconBubble tone={t.status === 'resolvida' ? 'sage' : t.unread ? 'gold' : 'wine'}><CategoryIcon category={t.category} className="h-5 w-5" /></IconBubble>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      {t.unread && <UnreadDot label="Não lida" />}
                      <span className={`block truncate text-[15px] ${t.unread ? 'font-semibold text-ink' : 'font-medium text-ink/90'}`}>{t.subject}</span>
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-ink/65">
                      {ticketCode(t.ticketNumber)} · {t.professional.businessName} · {t.professional.name} · {categoryTitle(t.category)}
                    </span>
                    <span className="mt-0.5 block text-xs text-ink/50 lg:hidden" title={fmtShort(t.lastActivityAt)}>Última atividade {relativeTime(t.lastActivityAt)}</span>
                    <span className="mt-2 flex flex-wrap items-center gap-1.5 sm:hidden">
                      <PriorityPill priority={t.priority} />
                      <StatusPill status={t.status} viewer="admin" />
                    </span>
                  </span>
                  <span className="hidden shrink-0 items-center gap-2 sm:flex">
                    <PriorityPill priority={t.priority} />
                    <StatusPill status={t.status} viewer="admin" />
                    <span className="hidden w-24 text-right text-xs text-ink/60 lg:block" title={fmtShort(t.lastActivityAt)}>{relativeTime(t.lastActivityAt)}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <Pager page={data.page} totalPages={data.totalPages} total={data.total} onPage={setPage} />
        </>
      )}
    </div>
  );
}
