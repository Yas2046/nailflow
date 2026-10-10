import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import AccountShell from '../../components/admin-account/AccountShell';
import { Eyebrow, Panel, Segmented, Skeleton } from '../../components/admin-account/AccountUi';
import { ACTIVITY_META, ActionIcon, ENTER, ErrorState, dayLabel, timeLabel } from '../../components/admin-account/AccountBlocks';
import { useAccountActivity, type AccountActivity } from '../../components/admin-account/useAccountActivity';
import type { AuditAction, AuditItem } from '../../components/admin-account/useAccountOverview';
import { usePageTitle } from '../../hooks/usePageTitle';

// Só aparece o que existe de verdade no admin_audit_log: quatro tipos de ação (edição, bloqueio,
// desbloqueio, exclusão), todas registradas apenas quando concluídas com sucesso. Por isso os
// filtros seguem esses tipos reais; não há categorias de "Perfil", "Segurança" ou "Sistema".

// ── apresentação por tipo de ação ───────────────────────────────────────────

const FIRST_PERSON: Record<AuditAction, string> = {
  update: 'Você editou o cadastro de uma profissional',
  block: 'Você bloqueou uma conta',
  unblock: 'Você desbloqueou uma conta',
  delete: 'Você excluiu uma conta',
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

// ── resumo (uma faixa) ──────────────────────────────────────────────────────

function Stat({ label, value, caption }: { label: string; value: ReactNode; caption: string }) {
  return (
    <div className="min-w-0 px-5 py-4 sm:px-6">
      <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink/60">{label}</p>
      <p className="mt-1.5 font-display text-2xl font-semibold leading-tight tabular-nums text-wine-800">{value}</p>
      <p className="mt-1 break-words text-sm text-ink/65">{caption}</p>
    </div>
  );
}

function Summary({ data }: { data: AccountActivity }) {
  const { items, truncated } = data;
  const last = items[0];
  const weekAgo = Date.now() - 7 * 86400000;
  const recent = items.filter((i) => new Date(i.createdAt).getTime() >= weekAgo).length;
  return (
    <section aria-label="Resumo" className={`overflow-hidden rounded-2xl border border-wine-100 bg-white ${ENTER}`}>
      <div className="grid divide-y divide-wine-100 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <Stat
          label="Última atividade"
          value={<>{dayLabel(last.createdAt)}<span className="ml-1.5 font-mono text-sm font-normal text-ink/65">{timeLabel(last.createdAt)}</span></>}
          caption={`${ACTIVITY_META[last.action].title} · ${last.targetBusinessName}`}
        />
        <Stat
          label="Total de atividades"
          value={items.length}
          caption={truncated ? 'as mais recentes do histórico' : 'ações administrativas registradas'}
        />
        <Stat label="Período recente" value={recent} caption={recent === 1 ? 'ação nos últimos 7 dias' : 'ações nos últimos 7 dias'} />
      </div>
    </section>
  );
}

// ── registro (log) ──────────────────────────────────────────────────────────

function Row({ item, group }: { item: AuditItem; group: GroupId }) {
  const meta = ACTIVITY_META[item.action];
  return (
    <li className="grid grid-cols-[3.75rem_2.5rem_minmax(0,1fr)] items-start gap-x-3 px-1 py-3.5 sm:grid-cols-[5.25rem_2.5rem_minmax(0,1fr)] sm:gap-x-4">
      <p className="pt-1 text-right font-mono text-xs leading-5 text-ink/65">
        <span className="block font-medium text-ink/85">{timeLabel(item.createdAt)}</span>
        {group === 'antes' && <span className="block">{shortDate(item.createdAt)}</span>}
      </p>
      <span className={`flex h-10 w-10 items-center justify-center rounded-lg ${meta.tile}`}><ActionIcon action={item.action} /></span>
      <div className="min-w-0 pt-0.5">
        <p className="text-[15px] font-medium leading-snug text-ink/90">{FIRST_PERSON[item.action]}</p>
        <p className="mt-0.5 break-words text-sm text-ink/70">Profissional · {item.targetBusinessName}</p>
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
    <div className={`flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between ${ENTER} [animation-delay:90ms]`}>
      <Segmented<FilterId>
        label="Filtrar por tipo de ação"
        value={filter}
        onChange={setFilter}
        options={FILTERS.map((f) => ({ id: f.id, label: f.label, count: counts[f.id], disabled: f.id !== 'todas' && counts[f.id] === 0 }))}
      />
      <div className="relative lg:w-72">
        <label htmlFor="atividade-busca" className="sr-only">Buscar pelo nome do negócio</label>
        <svg className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink/55" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path strokeLinecap="round" d="m16 16 4 4" /></svg>
        <input
          id="atividade-busca"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar por negócio"
          className="input h-[42px] !pl-9"
        />
      </div>
    </div>
  );
}

// ── conteúdo ────────────────────────────────────────────────────────────────

function EmptyAll() {
  return (
    <Panel className={`${ENTER}`}>
      <div className="rounded-xl border border-dashed border-wine-200 px-6 py-14 text-center">
        <Eyebrow>Ainda não há atividades</Eyebrow>
        <h3 className="mx-auto mt-4 max-w-sm font-display text-xl font-semibold leading-snug text-wine-800">Nada registrado por aqui ainda</h3>
        <p className="mx-auto mt-3 max-w-sm text-[15px] leading-relaxed text-ink/70">
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
    <div className="space-y-6">
      <Summary data={data} />
      <Toolbar counts={counts} filter={filter} setFilter={setFilter} query={query} setQuery={setQuery} />

      <Panel className={`${ENTER} [animation-delay:150ms]`}>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <Eyebrow>Registro</Eyebrow>
            <h3 className="mt-2 font-display text-xl font-semibold leading-tight text-wine-800">Suas ações administrativas</h3>
          </div>
          <p className="font-mono text-xs text-ink/65" aria-live="polite">
            {filtering ? `${visible.length} de ${data.items.length} ações` : `${data.items.length} ${data.items.length === 1 ? 'ação' : 'ações'}`}
          </p>
        </div>

        {visible.length === 0 ? (
          <div className="mt-6 rounded-xl border border-dashed border-wine-200 px-6 py-12 text-center">
            <p className="text-[15px] text-ink/70">Nenhuma atividade encontrada com esses filtros.</p>
            <button type="button" onClick={() => { setFilter('todas'); setQuery(''); }} className="btn-secondary mt-5 min-h-[44px] px-5">
              Limpar filtros
            </button>
          </div>
        ) : (
          <div className="mt-6 space-y-8">
            {grouped.map((g) => (
              <section key={g.id} aria-labelledby={`grupo-${g.id}`}>
                <div className="mb-1 flex items-baseline justify-between gap-4 border-b border-wine-100 pb-2.5">
                  <h4 id={`grupo-${g.id}`} className="font-mono text-xs font-medium uppercase tracking-[0.16em] text-wine-700">{g.label}</h4>
                  <p className="font-mono text-xs text-ink/60">{g.items.length} {g.items.length === 1 ? 'ação' : 'ações'}</p>
                </div>
                <ol className="divide-y divide-wine-100/70">
                  {g.items.map((it) => <Row key={it.id} item={it} group={g.id} />)}
                </ol>
              </section>
            ))}
          </div>
        )}
      </Panel>

      <p className={`text-[15px] leading-relaxed text-ink/70 ${ENTER} [animation-delay:210ms]`}>
        {data.truncated && 'Mostrando as ações mais recentes do histórico. '}
        Para ver o histórico de todas as contas administrativas, abra a{' '}
        <Link to="/admin/auditoria" className="rounded font-medium text-wine-600 underline-offset-4 transition-colors hover:text-wine-800 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-wine-500/50">
          Auditoria
        </Link>.
      </p>
    </div>
  );
}

// ── estados ─────────────────────────────────────────────────────────────────

function LoadingState() {
  return (
    <div role="status" aria-label="Carregando a atividade da conta" className="space-y-6">
      <Skeleton className="h-36 rounded-2xl sm:h-28" />
      <Skeleton className="h-11 w-full rounded-xl sm:w-96" />
      <Skeleton className="h-[26rem] rounded-2xl" />
    </div>
  );
}

// ── página ──────────────────────────────────────────────────────────────────

export default function AdminContaAtividade() {
  usePageTitle('Atividade · Central da conta');
  const { state, reload } = useAccountActivity();
  return (
    <AccountShell title="Atividade" subtitle="Suas ações administrativas recentes. Para o histórico de todas as contas, use a Auditoria.">
      {state.status === 'loading' && <LoadingState />}
      {state.status === 'error' && <ErrorState title="Não foi possível carregar a atividade" message={state.message} onRetry={reload} />}
      {state.status === 'ready' && <Content data={state.data} />}
    </AccountShell>
  );
}
