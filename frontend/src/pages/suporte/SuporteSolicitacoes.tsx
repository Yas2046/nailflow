import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError } from '../../services/api';
import { usePageTitle } from '../../hooks/usePageTitle';
import { useVisiblePolling } from '../../hooks/useVisiblePolling';
import { useSupport } from '../../context/SupportContext';
import {
  STATUSES, categoryTitle, fmtDate, fmtShort, relativeTime, statusLabel, supportApi, ticketCode,
  type Paged, type SupportStatus, type SupportTicket,
} from '../../services/support';
import { EmptyBox, ErrorBox, IconBubble, LoadingList, Pager, StatusPill, UnreadDot, Unavailable } from '../../components/support/SupportUi';
import { CategoryIcon, IconArrowRight, IconInbox, IconSearch } from '../../components/support/SupportIcons';

const PAGE_SIZE = 10;

export default function SuporteSolicitacoes() {
  usePageTitle('Minhas solicitações');
  const { load, enabled, refresh } = useSupport();
  const [status, setStatus] = useState<SupportStatus | ''>('');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Paged<SupportTicket> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);

  // Busca com pequena espera: não consulta a API a cada tecla.
  useEffect(() => {
    const t = window.setTimeout(() => { setQ(search.trim()); setPage(1); }, 350);
    return () => window.clearTimeout(t);
  }, [search]);

  const fetchList = useCallback(async (silent: boolean) => {
    const mine = ++seq.current;
    if (!silent) { setLoading(true); setError(null); }
    try {
      const r = await supportApi.list({ status, q, page, pageSize: PAGE_SIZE });
      if (mine === seq.current) { setData(r); setError(null); }
    } catch (e) {
      if (mine === seq.current && !silent) setError(e instanceof ApiError ? e.message : 'Verifique sua conexão e tente de novo.');
    } finally {
      if (mine === seq.current && !silent) setLoading(false);
    }
  }, [status, q, page]);

  useEffect(() => { if (enabled) void fetchList(false); }, [enabled, fetchList]);
  // Cadência da central: 60 s com a aba visível (pausa quando oculta).
  useVisiblePolling(() => { void fetchList(true); void refresh(); }, 60_000, enabled);

  if (load === 'loading') return <LoadingList rows={2} label="Carregando…" />;
  if (!enabled) return <Unavailable />;

  const filtered = status !== '' || q !== '';

  return (
    <div className="mx-auto max-w-3xl">
      <header className="page-header flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl text-wine-800">Minhas solicitações</h1>
          <p className="mt-1 text-sm text-ink/60">Acompanhe o atendimento e converse com a equipe NailFlow.</p>
        </div>
        <Link to="/suporte/solicitacoes/nova" className="btn-primary min-h-[44px]">Nova solicitação</Link>
      </header>

      <div className="mb-3">
        <label htmlFor="busca-solicitacoes" className="sr-only">Buscar solicitações</label>
        <div className="relative">
          <IconSearch className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-wine-400" />
          <input id="busca-solicitacoes" type="search" className="input !pl-10" placeholder="Buscar por assunto ou número (#0142)" value={search} onChange={(e) => setSearch(e.target.value)} autoComplete="off" />
        </div>
      </div>
      <div className="-mx-1 mb-5 flex gap-2 overflow-x-auto px-1 pb-1" role="group" aria-label="Filtrar por status">
        {([{ value: '' as const, label: 'Todas' }, ...STATUSES.map((v) => ({ value: v, label: statusLabel(v, 'professional') }))]).map((o) => (
          <button
            key={o.value || 'todas'}
            type="button"
            aria-pressed={status === o.value}
            onClick={() => { setStatus(o.value); setPage(1); }}
            className={`min-h-[38px] shrink-0 rounded-full px-3.5 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-wine-400/50 ${
              status === o.value ? 'bg-wine-600 text-white shadow-sm' : 'bg-white text-wine-700 ring-1 ring-inset ring-wine-100 hover:bg-wine-50'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>

      {loading ? (
        <LoadingList label="Carregando solicitações…" />
      ) : error ? (
        <ErrorBox message={error} onRetry={() => void fetchList(false)} />
      ) : !data || data.items.length === 0 ? (
        filtered ? (
          <EmptyBox
            icon={<IconSearch className="h-6 w-6" />}
            title="Nenhuma solicitação encontrada"
            action={<button type="button" className="btn-secondary" onClick={() => { setSearch(''); setQ(''); setStatus(''); setPage(1); }}>Limpar filtros</button>}
          >
            Nenhuma solicitação combina com esses filtros.
          </EmptyBox>
        ) : (
          <EmptyBox icon={<IconInbox className="h-6 w-6" />} title="Você ainda não abriu nenhuma solicitação" action={<Link to="/suporte/solicitacoes/nova" className="btn-primary">Abrir solicitação</Link>}>
            Quando precisar de ajuda, é só abrir uma solicitação. A resposta chega aqui.
          </EmptyBox>
        )
      ) : (
        <>
          <ul className="space-y-3">
            {data.items.map((t) => (
              <li key={t.id}>
                <Link
                  to={`/suporte/solicitacoes/${t.id}`}
                  className={`group flex items-start gap-3.5 rounded-2xl border bg-white p-4 shadow-sm transition-all hover:-translate-y-px hover:border-wine-300 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-wine-400/50 sm:gap-4 ${t.unread ? 'border-gold-400 bg-gold-300/[0.07]' : 'border-wine-100'}`}
                >
                  <IconBubble tone={t.status === 'resolvida' ? 'sage' : t.unread ? 'gold' : 'wine'}><CategoryIcon category={t.category} className="h-5 w-5" /></IconBubble>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
                      <p className="flex min-w-0 items-center gap-2 font-medium text-ink/90">
                        {t.unread && <UnreadDot />}
                        <span className="truncate">{t.subject}</span>
                      </p>
                      <StatusPill status={t.status} viewer="professional" />
                    </div>
                    <p className="mt-1.5 text-xs text-ink/55">
                      {ticketCode(t.ticketNumber)} · {categoryTitle(t.category)} · <span title={fmtShort(t.lastActivityAt)}>{relativeTime(t.lastActivityAt)}</span>
                    </p>
                    {t.unread && <p className="mt-1.5 text-xs font-semibold text-gold-700">Nova resposta da equipe</p>}
                    {t.status === 'resolvida' && t.canReopenUntil && (
                      <p className="mt-1.5 text-xs text-ink/60">Você pode reabrir até {fmtDate(t.canReopenUntil)}.</p>
                    )}
                  </div>
                  <IconArrowRight className="mt-2 hidden h-4 w-4 shrink-0 text-wine-300 transition-all group-hover:translate-x-0.5 group-hover:text-wine-600 sm:block" />
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
