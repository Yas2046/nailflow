import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError } from '../../services/api';
import { usePageTitle } from '../../hooks/usePageTitle';
import { useVisiblePolling } from '../../hooks/useVisiblePolling';
import { useSupport } from '../../context/SupportContext';
import {
  STATUSES, categoryTitle, fmtDate, fmtShort, statusLabel, supportApi, ticketCode,
  type Paged, type SupportStatus, type SupportTicket,
} from '../../services/support';
import { EmptyBox, ErrorBox, LoadingList, Pager, StatusPill, UnreadDot, Unavailable } from '../../components/support/SupportUi';

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

      <div className="mb-5 grid gap-3 sm:grid-cols-[1fr_14rem]">
        <div>
          <label htmlFor="busca-solicitacoes" className="sr-only">Buscar solicitações</label>
          <input id="busca-solicitacoes" type="search" className="input" placeholder="Buscar por assunto ou número (#0142)" value={search} onChange={(e) => setSearch(e.target.value)} autoComplete="off" />
        </div>
        <div>
          <label htmlFor="filtro-status" className="sr-only">Filtrar por status</label>
          <select id="filtro-status" className="input" value={status} onChange={(e) => { setStatus(e.target.value as SupportStatus | ''); setPage(1); }}>
            <option value="">Todos os status</option>
            {STATUSES.map((s) => <option key={s} value={s}>{statusLabel(s, 'professional')}</option>)}
          </select>
        </div>
      </div>

      {loading ? (
        <LoadingList label="Carregando solicitações…" />
      ) : error ? (
        <ErrorBox message={error} onRetry={() => void fetchList(false)} />
      ) : !data || data.items.length === 0 ? (
        filtered ? (
          <EmptyBox
            title="Nenhuma solicitação encontrada"
            action={<button type="button" className="btn-secondary" onClick={() => { setSearch(''); setQ(''); setStatus(''); setPage(1); }}>Limpar filtros</button>}
          >
            Nenhuma solicitação combina com esses filtros.
          </EmptyBox>
        ) : (
          <EmptyBox title="Você ainda não abriu nenhuma solicitação" action={<Link to="/suporte/solicitacoes/nova" className="btn-primary">Abrir solicitação</Link>}>
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
                  className={`block rounded-2xl border bg-white p-4 shadow-sm transition-colors hover:border-wine-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-wine-400/50 ${t.unread ? 'border-gold-400' : 'border-wine-100'}`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <p className="flex min-w-0 items-center gap-2 font-medium text-ink/90">
                      {t.unread && <UnreadDot />}
                      <span className="truncate">{t.subject}</span>
                    </p>
                    <StatusPill status={t.status} viewer="professional" />
                  </div>
                  <p className="mt-1.5 text-xs text-ink/55">
                    {ticketCode(t.ticketNumber)} · {categoryTitle(t.category)} · última atividade {fmtShort(t.lastActivityAt)}
                  </p>
                  {t.unread && <p className="mt-1.5 text-xs font-semibold text-gold-700">Nova resposta da equipe</p>}
                  {t.status === 'resolvida' && t.canReopenUntil && (
                    <p className="mt-1.5 text-xs text-ink/60">Você pode reabrir até {fmtDate(t.canReopenUntil)}.</p>
                  )}
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
