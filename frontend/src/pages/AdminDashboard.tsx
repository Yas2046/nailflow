import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { usePageTitle } from '../hooks/usePageTitle';
import { IconArrow, IconRefresh, IconTick } from '../components/AdminIcons';
import { Badge, Eyebrow, Meter, Panel, Skeleton, StatusDot } from '../components/admin-account/AccountUi';
import { ACTIVITY_META, ActionIcon, ENTER, ErrorState, dayLabel, initialsOf, timeLabel } from '../components/admin-account/AccountBlocks';
import { useAdminDashboard, type DashboardData, type DashboardAuditItem, type Health } from '../components/admin-dashboard/useAdminDashboard';
import { computeAttention, computeStats, type AttentionItem, type ProfessionalRow } from '../components/admin-dashboard/derive';

// Central de comando do ADM. Só mostra o que os endpoints atuais fornecem: contas (/admin/professionals),
// ações administrativas (/admin/audit-log) e /health. Não há solicitações de suporte, clientes,
// agendamentos, receita, uptime nem estado do banco/n8n/Evolution: nada disso é exibido.

const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, viewBox: '0 0 24 24', 'aria-hidden': true, className: 'h-4 w-4' } as const;
const IconLink = () => <svg {...stroke}><path strokeLinecap="round" strokeLinejoin="round" d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></svg>;
const IconBook = () => <svg {...stroke}><path strokeLinecap="round" strokeLinejoin="round" d="M5 5.5A1.5 1.5 0 0 1 6.5 4H19v13H6.5A1.5 1.5 0 0 0 5 18.5v-13Zm0 13A1.5 1.5 0 0 0 6.5 20H19v-3" /></svg>;

const greeting = () => { const h = new Date().getHours(); return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite'; };
const todayLabel = () => new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }).toLowerCase();
const focusRing = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-wine-500/50';
const heroBtn = `inline-flex min-h-[40px] items-center gap-2 rounded-lg border border-white/15 bg-white/[0.06] px-3.5 text-sm font-medium text-cream transition-colors hover:bg-white/[0.12] focus:outline-none focus-visible:ring-2 focus-visible:ring-wine-300 disabled:opacity-60`;

// ── hero: o retrato da plataforma, em uma superfície noturna ────────────────

function HealthChip({ health }: { health: Health }) {
  return health.ok ? (
    <span role="status" className="inline-flex min-h-[40px] items-center gap-2.5 whitespace-nowrap rounded-lg border border-signal/25 bg-signal/10 px-3.5 font-mono text-xs text-signal">
      <StatusDot tone="signal" live />
      API online
      <span className="tabular-nums text-signal/70">{health.ms} ms</span>
    </span>
  ) : (
    <span role="status" className="inline-flex min-h-[40px] items-center gap-2.5 whitespace-nowrap rounded-lg border border-white/15 px-3.5 font-mono text-xs text-[#BDB3AC]">
      <StatusDot tone="muted" />
      status da API indisponível
    </span>
  );
}

function Metric({
  label, value, of, caption, meter,
}: { label: string; value: number; of?: number; caption: ReactNode; meter?: { value: number; max: number; tone: 'wine' | 'signal' } }) {
  return (
    <div className="min-w-0 px-5 py-5 sm:px-7 sm:py-6">
      <dt className="font-mono text-[11px] uppercase tracking-[0.16em] text-[#A0958E]">{label}</dt>
      <dd className="mt-2">
        <span className="font-display text-[2.5rem] font-semibold leading-none tabular-nums text-white sm:text-5xl">{value}</span>
        {of !== undefined && <span className="ml-1.5 font-mono text-sm tabular-nums text-[#A0958E]">/ {of}</span>}
        {meter && meter.max > 0 && <div className="mt-3.5"><Meter label={label} value={meter.value} max={meter.max} tone={meter.tone} /></div>}
        <span className="mt-3 block text-sm leading-snug text-[#BDB3AC]">{caption}</span>
      </dd>
    </div>
  );
}

function Hero({ name, data, refreshing, onRefresh }: { name: string; data: DashboardData; refreshing: boolean; onRefresh: () => void }) {
  const { toast } = useToast();
  const s = computeStats(data.rows);
  const first = name.trim().split(/\s+/)[0];
  const withoutInstance = s.accounts - s.withInstance;

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/register`);
      toast('Link de cadastro copiado');
    } catch {
      toast('Não foi possível copiar o link', 'error');
    }
  }

  return (
    <Panel tone="night" className={`relative !p-0 overflow-hidden ${ENTER}`}>
      <div aria-hidden="true" className="absolute inset-x-0 top-0 h-px bg-gold-500/70" />
      <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-5 p-5 sm:p-8">
        <div className="min-w-0">
          <Eyebrow tone="night">central de comando · {todayLabel()}</Eyebrow>
          <h1 className="mt-3 font-display text-[1.875rem] font-semibold leading-tight text-white sm:text-[2.5rem]">
            {greeting()}{first ? `, ${first}` : ''}
          </h1>
          <p className="mt-2 text-[15px] text-[#BDB3AC]">
            A plataforma agora: contas, acessos e atividade.
            <span className="ml-2 font-mono text-xs text-[#8F847D]">
              atualizado às {data.loadedAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
            </span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <HealthChip health={data.health} />
          <button type="button" onClick={onRefresh} disabled={refreshing} aria-busy={refreshing} className={heroBtn}>
            <IconRefresh className={refreshing ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
            {refreshing ? 'Atualizando…' : 'Atualizar'}
          </button>
          <button type="button" onClick={copyLink} aria-label="Copiar link de cadastro" className={heroBtn}><IconLink /><span className="sm:hidden">Link de cadastro</span><span className="hidden sm:inline">Copiar link de cadastro</span></button>
          <Link to="/ajuda" className={heroBtn}><IconBook />Guia rápido</Link>
        </div>
      </div>

      <dl className="grid grid-cols-2 border-t border-white/10 lg:grid-cols-4 [&>*]:border-white/10 [&>*:nth-child(odd)]:border-r [&>*:nth-child(n+3)]:border-t lg:[&>*:nth-child(n+3)]:border-t-0 lg:[&>*:not(:last-child)]:border-r">
        <Metric
          label="Contas"
          value={s.accounts}
          caption={s.admins > 0 ? `sem contar ${s.admins} ${s.admins === 1 ? 'administradora' : 'administradoras'}` : 'profissionais cadastradas'}
        />
        <Metric
          label="Acesso liberado"
          value={s.active}
          of={s.accounts}
          meter={{ value: s.active, max: s.accounts, tone: 'signal' }}
          caption={s.blocked > 0 ? `${s.blocked} ${s.blocked === 1 ? 'conta bloqueada' : 'contas bloqueadas'}` : 'nenhuma conta bloqueada'}
        />
        <Metric
          label="WhatsApp configurado"
          value={s.withInstance}
          of={s.accounts}
          meter={{ value: s.withInstance, max: s.accounts, tone: 'wine' }}
          caption={withoutInstance > 0 ? `${withoutInstance} sem instância` : 'todas com instância'}
        />
        <Metric label="Novas · 30 dias" value={s.newLast30} caption="cadastros recentes" />
      </dl>
    </Panel>
  );
}

// ── pendências ──────────────────────────────────────────────────────────────

const SEVERE = new Set(['bloqueadas', 'exclusoes']);

function splitCount(text: string): { n: string | null; rest: string } {
  const m = /^(\d+)\s+(.*)$/.exec(text);
  return m ? { n: m[1], rest: m[2] } : { n: null, rest: text };
}

function QueueRow({ it }: { it: AttentionItem }) {
  const { n, rest } = splitCount(it.text);
  const severe = SEVERE.has(it.id);
  const body = (
    <>
      <span aria-hidden="true" className={`self-stretch w-[3px] shrink-0 rounded-full ${severe ? 'bg-rose-500' : 'bg-gold-500'}`} />
      <span className={`inline-flex h-8 min-w-[2rem] shrink-0 items-center justify-center rounded-md px-2 font-mono text-sm font-medium tabular-nums ${severe ? 'bg-rose-50 text-rose-700' : 'bg-gold-300/35 text-gold-700'}`}>{n ?? '·'}</span>
      <span className="min-w-0 flex-1 text-[15px] leading-snug text-ink/85">{rest}</span>
      {it.to && <span className="shrink-0 text-wine-500"><IconArrow /></span>}
    </>
  );
  return it.to ? (
    <Link to={it.to} className={`group flex min-h-[56px] items-center gap-3.5 rounded-lg px-1 py-2 transition-colors hover:bg-wine-50/70 ${focusRing}`}>{body}</Link>
  ) : (
    <div className="flex min-h-[56px] items-center gap-3.5 px-1 py-2">{body}</div>
  );
}

function AttentionPanel({ data }: { data: DashboardData }) {
  const items = computeAttention(data.rows, data.deletes7);
  const actionable = items.filter((i) => !i.info);
  const notes = items.filter((i) => i.info);

  return (
    <Panel className={`${ENTER} [animation-delay:60ms]`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <Eyebrow>Fila de pendências</Eyebrow>
          <h2 className="mt-2 font-display text-xl font-semibold leading-tight text-wine-800">O que pede atenção</h2>
        </div>
        {actionable.length > 0 && <Badge tone="warn">{actionable.length} {actionable.length === 1 ? 'item' : 'itens'}</Badge>}
      </div>

      {actionable.length === 0 ? (
        <div className="mt-6 flex items-start gap-4 rounded-xl border border-sage-200 bg-sage-100/60 p-5">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white text-sage-700"><IconTick className="h-5 w-5" /></span>
          <div>
            <p className="font-display text-lg font-semibold text-wine-800">Tudo em ordem</p>
            <p className="mt-0.5 text-[15px] text-ink/70">Nenhuma pendência no momento.</p>
          </div>
        </div>
      ) : (
        <ul className="mt-4 divide-y divide-wine-100">
          {actionable.map((it) => <li key={it.id}><QueueRow it={it} /></li>)}
        </ul>
      )}

      {notes.map((n) => (
        <p key={n.id} className="mt-4 flex items-center gap-2.5 border-t border-wine-100 pt-4 text-sm text-ink/70">
          <StatusDot tone="muted" />{n.text}
        </p>
      ))}
    </Panel>
  );
}

// ── atividade recente ───────────────────────────────────────────────────────

function ActivityRow({ item, meEmail }: { item: DashboardAuditItem; meEmail: string | undefined }) {
  const meta = ACTIVITY_META[item.action];
  const author = item.actorEmail === meEmail ? 'você' : item.actorEmail;
  return (
    <li className="flex items-start gap-3.5 py-3.5">
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${meta.tile}`}><ActionIcon action={item.action} /></span>
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-medium leading-snug text-ink/90">{meta.title}</p>
        <p className="mt-0.5 break-words text-sm text-ink/70">{item.targetBusinessName}</p>
        <p className="mt-0.5 break-all font-mono text-xs text-ink/55 sm:break-normal">por {author}</p>
      </div>
      <p className="shrink-0 text-right font-mono text-xs leading-5 text-ink/65">
        <span className="block font-medium text-ink/80">{dayLabel(item.createdAt)}</span>
        {timeLabel(item.createdAt)}
      </p>
    </li>
  );
}

function ActivityPanel({ data, meEmail }: { data: DashboardData; meEmail: string | undefined }) {
  const audit = data.audit;
  return (
    <Panel className={`${ENTER} [animation-delay:120ms]`}>
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
        <div>
          <Eyebrow>Atividade recente</Eyebrow>
          <h2 className="mt-2 font-display text-xl font-semibold leading-tight text-wine-800">Ações administrativas</h2>
        </div>
        {audit && audit.items.length > 0 && (
          <Link to="/admin/auditoria" className={`rounded-lg py-1 text-sm font-medium text-wine-600 transition-colors hover:text-wine-800 ${focusRing}`}>
            Ver auditoria →
          </Link>
        )}
      </div>

      {audit === null ? (
        <p className="mt-6 text-[15px] text-ink/70">Não foi possível carregar a atividade agora. Tente atualizar em instantes.</p>
      ) : audit.items.length === 0 ? (
        <div className="mt-6 rounded-xl border border-dashed border-wine-200 px-6 py-10 text-center">
          <Eyebrow>Ainda não há atividades</Eyebrow>
          <p className="mx-auto mt-3 max-w-xs text-[15px] leading-relaxed text-ink/70">As ações administrativas realizadas na plataforma aparecerão aqui.</p>
        </div>
      ) : (
        <>
          <p className="mt-3 font-mono text-xs text-ink/65">
            {audit.today} {audit.today === 1 ? 'ação hoje' : 'ações hoje'} · {audit.last7Days} nos últimos 7 dias
          </p>
          <ol className="mt-1 divide-y divide-wine-100">
            {audit.items.map((it) => <ActivityRow key={it.id} item={it} meEmail={meEmail} />)}
          </ol>
        </>
      )}
    </Panel>
  );
}

// ── cadastros recentes (tabela) ─────────────────────────────────────────────

const RECENT = 5;
const COLS = 'md:grid-cols-[minmax(0,2.2fr)_8.5rem_minmax(0,1.2fr)_6.5rem]';

function AccountBadge({ row }: { row: ProfessionalRow }) {
  if (row.blocked_at) return <Badge tone="danger">Bloqueada</Badge>;
  if (!row.wa_instance_name) return <Badge tone="warn">Sem WhatsApp</Badge>;
  return <Badge tone="ok">Ativa</Badge>;
}

function sinceLabel(iso: string) {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

function RecentAccounts({ data }: { data: DashboardData }) {
  const recent = data.rows
    .filter((r) => !r.is_admin)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, RECENT);

  return (
    <Panel className={`!p-0 overflow-hidden ${ENTER} [animation-delay:180ms]`}>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2 px-5 pt-5 sm:px-6 sm:pt-6">
        <div>
          <Eyebrow>Profissionais</Eyebrow>
          <h2 className="mt-2 font-display text-xl font-semibold leading-tight text-wine-800">Cadastros recentes</h2>
        </div>
        {recent.length > 0 && (
          <Link to="/admin/profissionais" className={`rounded-lg py-1 text-sm font-medium text-wine-600 transition-colors hover:text-wine-800 ${focusRing}`}>
            Ver todas →
          </Link>
        )}
      </div>

      {recent.length === 0 ? (
        <div className="m-5 rounded-xl border border-dashed border-wine-200 px-6 py-10 text-center sm:m-6">
          <Eyebrow>Nenhuma profissional ainda</Eyebrow>
          <p className="mx-auto mt-3 max-w-xs text-[15px] leading-relaxed text-ink/70">Quando alguém se cadastrar, a conta aparece aqui.</p>
        </div>
      ) : (
        <div className="mt-4">
          <div aria-hidden="true" className={`hidden border-y border-wine-100 bg-wine-50/60 px-6 py-2 font-mono text-[11px] uppercase tracking-[0.14em] text-ink/60 md:grid ${COLS} md:gap-x-4`}>
            <span>Conta</span><span>Situação</span><span>Instância</span><span className="text-right">Cadastro</span>
          </div>
          <ul className="divide-y divide-wine-100 border-t border-wine-100 md:border-t-0">
            {recent.map((r) => (
              <li key={r.id} className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-5 py-3.5 sm:px-6 ${COLS}`}>
                <div className="flex min-w-0 items-center gap-3.5">
                  <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-wine-50 font-display text-sm font-semibold text-wine-700">
                    {initialsOf(r.business_name || r.name)}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-[15px] font-medium text-ink/90">{r.business_name || r.name}</p>
                    <p className="truncate text-sm text-ink/65">{r.name}</p>
                  </div>
                </div>
                <div className="justify-self-end md:justify-self-start"><AccountBadge row={r} /></div>
                <p className="col-span-2 truncate font-mono text-xs text-ink/65 md:col-span-1">
                  {r.wa_instance_name ?? <span className="text-ink/45">— sem instância</span>}
                </p>
                <p className="col-span-2 whitespace-nowrap font-mono text-xs text-ink/65 md:col-span-1 md:text-right">{sinceLabel(r.created_at)}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}

// ── estados ─────────────────────────────────────────────────────────────────

function LoadingState() {
  return (
    <div role="status" aria-label="Carregando o painel" className="space-y-6">
      <Skeleton className="h-72 rounded-2xl sm:h-64" />
      <div className="grid gap-6 lg:grid-cols-2">
        <Skeleton className="h-72 rounded-2xl" />
        <Skeleton className="h-72 rounded-2xl" />
      </div>
      <Skeleton className="h-72 rounded-2xl" />
    </div>
  );
}

// ── página ──────────────────────────────────────────────────────────────────

export default function AdminDashboard() {
  usePageTitle('Visão geral');
  const { professional } = useAuth();
  const { state, refreshing, reload, retry } = useAdminDashboard();
  const data = state.status === 'ready' ? state.data : null;

  return (
    <div className="mx-auto max-w-[80rem]">
      {state.status === 'loading' && <LoadingState />}
      {state.status === 'error' && (
        <>
          <h1 className="mb-6 font-display text-[1.875rem] font-semibold text-wine-800">Central de comando</h1>
          <ErrorState title="Não foi possível carregar o painel" message={state.message} onRetry={retry} />
        </>
      )}
      {data && (
        <div className="space-y-6">
          <Hero name={professional?.name ?? ''} data={data} refreshing={refreshing} onRefresh={reload} />
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start">
            <AttentionPanel data={data} />
            <ActivityPanel data={data} meEmail={professional?.email} />
          </div>
          <RecentAccounts data={data} />
        </div>
      )}
    </div>
  );
}
