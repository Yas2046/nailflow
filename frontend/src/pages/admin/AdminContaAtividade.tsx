import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import AccountShell from '../../components/admin-account/AccountShell';
import { Eyebrow, Panel, Skeleton } from '../../components/admin-account/AccountUi';
import { ENTER, ErrorState, dayLabel, timeLabel } from '../../components/admin-account/AccountBlocks';
import { useAccountActivity, type AccountActivity } from '../../components/admin-account/useAccountActivity';
import type { AuditAction, AuditItem } from '../../components/admin-account/useAccountOverview';

// Só aparece o que existe de verdade no admin_audit_log: quatro tipos de ação (edição, bloqueio,
// desbloqueio, exclusão), todas registradas apenas quando concluídas com sucesso. Por isso os
// filtros seguem esses tipos reais; não há categorias de "Perfil", "Segurança" ou "Sistema".

// ── apresentação por tipo de ação ───────────────────────────────────────────

const svg = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, viewBox: '0 0 24 24', 'aria-hidden': true, className: 'h-[18px] w-[18px]' } as const;

const ICONS: Record<AuditAction, ReactNode> = {
  update: <svg {...svg}><path strokeLinecap="round" strokeLinejoin="round" d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3Zm9.5-13.5 3 3" /></svg>,
  block: <svg {...svg}><rect x="5" y="11" width="14" height="9" rx="2" /><path strokeLinecap="round" d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>,
  unblock: <svg {...svg}><rect x="5" y="11" width="14" height="9" rx="2" /><path strokeLinecap="round" d="M8 11V8a4 4 0 0 1 7.5-1.9" /></svg>,
  delete: <svg {...svg}><path strokeLinecap="round" strokeLinejoin="round" d="M5 7h14M10 7V4h4v3m-7 0 1 13h8l1-13M10 11v6m4-6v6" /></svg>,
};

const META: Record<AuditAction, { title: string; tile: string }> = {
  update: { title: 'Você editou o cadastro de uma profissional', tile: 'bg-wine-50 text-wine-600' },
  block: { title: 'Você bloqueou uma conta', tile: 'bg-rose-50 text-rose-600' },
  unblock: { title: 'Você desbloqueou uma conta', tile: 'bg-sage-100 text-[#3F5F46]' },
  delete: { title: 'Você excluiu uma conta', tile: 'bg-rose-100 text-rose-700' },
};

type FilterId = 'todas' | 'edicoes' | 'bloqueios' | 'exclusoes';

const FILTERS: Array<{ id: FilterId; label: string; match: (a: AuditAction) => boolean }> = [
  { id: 'todas', label: 'Todas', match: () => true },
  { id: 'edicoes', label: 'Edições', match: (a) => a === 'update' },
  { id: 'bloqueios', label: 'Bloqueios', match: (a) => a === 'block' || a === 'unblock' },
  { id: 'exclusoes', label: 'Exclusões', match: (a) => a === 'delete' },
];

// ── datas ───────────────────────────────────────────────────────────────────

type GroupId = 'hoje' | 'ontem' | 'antes';
const GROUPS: Array<{ id: GroupId; label: string }> = [
  { id: 'hoje', label: 'Hoje' },
  { id: 'ontem', label: 'Ontem' },
  { id: 'antes', label: 'Datas anteriores' },
];

function groupOf(iso: string): GroupId {
  const l = dayLabel(iso);
  return l === 'Hoje' ? 'hoje' : l === 'Ontem' ? 'ontem' : 'antes';
}

function shortDate(iso: string) {
  const d = new Date(iso);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) }).replace(/\./g, '');
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

// ── resumo ──────────────────────────────────────────────────────────────────

function Stat({ label, value, caption }: { label: string; value: ReactNode; caption: string }) {
  return (
    <div className="min-w-0 px-1 py-5 sm:px-8 sm:py-1 sm:first:pl-0 sm:last:pr-0">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink/40">{label}</p>
      <p className="mt-2 font-display text-3xl font-semibold leading-tight text-wine-800">{value}</p>
      <p className="mt-1 break-words text-[15px] text-ink/50">{caption}</p>
    </div>
  );
}

function Summary({ data }: { data: AccountActivity }) {
  const { items, truncated } = data;
  const last = items[0];
  const weekAgo = Date.now() - 7 * 86400000;
  const recent = items.filter((i) => new Date(i.createdAt).getTime() >= weekAgo).length;
  return (
    <Panel className={`!p-6 sm:!p-8 ${ENTER}`}>
      <div className="grid divide-y divide-wine-100/70 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <Stat
          label="Última atividade"
          value={<>{dayLabel(last.createdAt)}<span className="text-xl font-normal text-ink/45">, {timeLabel(last.createdAt)}</span></>}
          caption={`${META[last.action].title.replace('Você ', '').replace(/^./, (c) => c.toUpperCase())} · ${last.targetBusinessName}`}
        />
        <Stat
          label="Total de atividades"
          value={items.length}
          caption={truncated ? 'as mais recentes do histórico' : 'ações administrativas registradas'}
        />
        <Stat label="Período recente" value={recent} caption={recent === 1 ? 'ação nos últimos 7 dias' : 'ações nos últimos 7 dias'} />
      </div>
    </Panel>
  );
}

// ── timeline ────────────────────────────────────────────────────────────────

function Row({ item, group, last }: { item: AuditItem; group: GroupId; last: boolean }) {
  const meta = META[item.action];
  return (
    <li className={`group grid grid-cols-[3.75rem_2.5rem_minmax(0,1fr)] gap-x-3 sm:grid-cols-[5rem_2.5rem_minmax(0,1fr)] sm:gap-x-5 ${last ? '' : 'pb-8'}`}>
      <p className="pt-0.5 text-right">
        <span className="block text-[15px] font-semibold text-ink/80">{timeLabel(item.createdAt)}</span>
        {group === 'antes' && <span className="block text-sm text-ink/40">{shortDate(item.createdAt)}</span>}
      </p>
      <div className="relative flex justify-center">
        <span className={`relative z-10 flex h-10 w-10 items-center justify-center rounded-xl ring-4 ring-white transition-transform duration-300 motion-safe:group-hover:scale-105 ${meta.tile}`}>{ICONS[item.action]}</span>
        {!last && <span aria-hidden="true" className="absolute -bottom-1 top-10 w-px bg-gradient-to-b from-wine-200/80 to-wine-100/20" />}
      </div>
      <div className="min-w-0 pt-0.5">
        <p className="text-base font-medium leading-snug text-ink/85 sm:text-lg">{meta.title}</p>
        <p className="mt-1 break-words text-[15px] text-ink/50">Profissional · {item.targetBusinessName}</p>
        <p className="mt-2 inline-flex items-center gap-2 rounded-full bg-sage-100/70 px-2.5 py-0.5 text-xs font-medium text-[#3F5F46]">
          <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-sage-500" />Concluída
        </p>
      </div>
    </li>
  );
}

// ── filtros ─────────────────────────────────────────────────────────────────

function Toolbar({
  counts, filter, setFilter, query, setQuery,
}: {
  counts: Record<FilterId, number>; filter: FilterId; setFilter: (f: FilterId) => void; query: string; setQuery: (q: string) => void;
}) {
  return (
    <div className={`flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between ${ENTER} [animation-delay:90ms]`}>
      <div role="group" aria-label="Filtrar por tipo de ação" className="-mx-1 flex flex-wrap gap-2 px-1">
        {FILTERS.map((f) => {
          const active = filter === f.id;
          const empty = f.id !== 'todas' && counts[f.id] === 0;
          return (
            <button
              key={f.id}
              type="button"
              aria-pressed={active}
              disabled={empty}
              onClick={() => setFilter(f.id)}
              className={`inline-flex min-h-[42px] items-center gap-2 rounded-full border px-4 text-[15px] transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-wine-500/40 disabled:cursor-not-allowed disabled:opacity-40 ${
                active ? 'border-wine-600 bg-wine-600 font-medium text-white' : 'border-wine-100 bg-white/80 text-ink/70 hover:border-wine-300 hover:text-wine-800'
              }`}
            >
              {f.label}
              <span className={`text-sm ${active ? 'text-white/75' : 'text-ink/35'}`}>{counts[f.id]}</span>
            </button>
          );
        })}
      </div>
      <div className="relative lg:w-72">
        <label htmlFor="atividade-busca" className="sr-only">Buscar pelo nome do negócio</label>
        <svg className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink/35" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path strokeLinecap="round" d="m16 16 4 4" /></svg>
        <input
          id="atividade-busca"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar por negócio"
          className="input h-[42px] rounded-full pl-10 text-[15px]"
        />
      </div>
    </div>
  );
}

// ── conteúdo ────────────────────────────────────────────────────────────────

function EmptyAll() {
  return (
    <Panel className={`${ENTER}`}>
      <div className="rounded-2xl border border-dashed border-wine-200/70 px-6 py-16 text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink/40">Ainda não há atividades</p>
        <h3 className="mx-auto mt-4 max-w-sm font-display text-2xl leading-snug text-wine-800">Nada registrado por aqui ainda</h3>
        <p className="mx-auto mt-3 max-w-sm text-base leading-relaxed text-ink/55">
          As ações administrativas que você realizar nas contas das profissionais aparecerão aqui.
        </p>
      </div>
    </Panel>
  );
}

function Content({ data }: { data: AccountActivity }) {
  const [filter, setFilter] = useState<FilterId>('todas');
  const [query, setQuery] = useState('');

  const counts = useMemo(() => {
    const c = {} as Record<FilterId, number>;
    for (const f of FILTERS) c[f.id] = data.items.filter((i) => f.match(i.action)).length;
    return c;
  }, [data.items]);

  const visible = useMemo(() => {
    const f = FILTERS.find((x) => x.id === filter)!;
    const q = norm(query);
    return data.items.filter((i) => f.match(i.action) && (!q || norm(i.targetBusinessName).includes(q)));
  }, [data.items, filter, query]);

  if (data.items.length === 0) return <EmptyAll />;

  const grouped = GROUPS.map((g) => ({ ...g, items: visible.filter((i) => groupOf(i.createdAt) === g.id) })).filter((g) => g.items.length > 0);
  const filtering = filter !== 'todas' || query.trim() !== '';

  return (
    <div className="space-y-8 sm:space-y-10">
      <Summary data={data} />
      <Toolbar counts={counts} filter={filter} setFilter={setFilter} query={query} setQuery={setQuery} />

      <Panel className={`${ENTER} [animation-delay:150ms]`}>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <Eyebrow>Linha do tempo</Eyebrow>
            <h3 className="mt-3 font-display text-3xl leading-tight text-wine-800">Suas ações administrativas</h3>
          </div>
          <p className="text-[15px] text-ink/45" aria-live="polite">
            {filtering ? `${visible.length} de ${data.items.length} ações` : `${data.items.length} ${data.items.length === 1 ? 'ação' : 'ações'}`}
          </p>
        </div>

        {visible.length === 0 ? (
          <div className="mt-10 rounded-2xl border border-dashed border-wine-200/70 px-6 py-12 text-center">
            <p className="text-base text-ink/60">Nenhuma atividade encontrada com esses filtros.</p>
            <button type="button" onClick={() => { setFilter('todas'); setQuery(''); }} className="btn-secondary mt-5 min-h-[44px] px-5">
              Limpar filtros
            </button>
          </div>
        ) : (
          <div className="mt-10 space-y-12">
            {grouped.map((g) => (
              <section key={g.id} aria-labelledby={`grupo-${g.id}`}>
                <div className="mb-6 flex items-baseline justify-between gap-4 border-b border-wine-100/70 pb-3">
                  <h4 id={`grupo-${g.id}`} className="font-display text-2xl text-wine-800">{g.label}</h4>
                  <p className="text-sm text-ink/40">{g.items.length} {g.items.length === 1 ? 'ação' : 'ações'}</p>
                </div>
                <ol>
                  {g.items.map((it, i) => <Row key={it.id} item={it} group={g.id} last={i === g.items.length - 1} />)}
                </ol>
              </section>
            ))}
          </div>
        )}
      </Panel>

      <p className={`text-[15px] leading-relaxed text-ink/50 ${ENTER} [animation-delay:210ms]`}>
        {data.truncated && 'Mostrando as ações mais recentes do histórico. '}
        Para ver o histórico de todas as contas administrativas, abra a{' '}
        <Link to="/admin/auditoria" className="rounded font-medium text-wine-600 underline-offset-4 transition-colors hover:text-wine-800 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-wine-500/40">
          Auditoria
        </Link>.
      </p>
    </div>
  );
}

// ── estados ─────────────────────────────────────────────────────────────────

function LoadingState() {
  return (
    <div role="status" aria-label="Carregando a atividade da conta" className="space-y-8">
      <Skeleton className="h-36 rounded-3xl sm:h-32" />
      <Skeleton className="h-11 w-full rounded-full sm:w-96" />
      <Skeleton className="h-[26rem] rounded-3xl" />
    </div>
  );
}

// ── página ──────────────────────────────────────────────────────────────────

export default function AdminContaAtividade() {
  const { state, reload } = useAccountActivity();
  return (
    <AccountShell title="Atividade da conta" subtitle="Acompanhe as ações administrativas realizadas recentemente na sua conta.">
      {state.status === 'loading' && <LoadingState />}
      {state.status === 'error' && <ErrorState title="Não foi possível carregar a atividade" message={state.message} onRetry={reload} />}
      {state.status === 'ready' && <Content data={state.data} />}
    </AccountShell>
  );
}
