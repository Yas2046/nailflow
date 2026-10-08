import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { usePageTitle } from '../hooks/usePageTitle';
import { IconArrow, IconClipboard, IconRefresh, IconTick, IconUser, IconUsers } from '../components/AdminIcons';
import { Eyebrow, Panel, Skeleton, StatusDot } from '../components/admin-account/AccountUi';
import { ACTIVITY_META, ENTER, ErrorState, dayLabel, timeLabel } from '../components/admin-account/AccountBlocks';
import { useAdminDashboard, type DashboardData, type DashboardAuditItem, type Health } from '../components/admin-dashboard/useAdminDashboard';
import { chartIsMeaningful, computeAttention, computeStats, signupsByMonth, type MonthBucket } from '../components/admin-dashboard/derive';

// Dashboard ADM = visão operacional da plataforma. Só mostra o que os endpoints atuais fornecem:
// contas (/admin/professionals), ações administrativas (/admin/audit-log) e /health.
// Não há clientes, agendamentos, receita, uptime nem estado do banco/n8n/Evolution: nada disso é exibido.

const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, viewBox: '0 0 24 24', 'aria-hidden': true, className: 'h-[18px] w-[18px]' } as const;

const IconBook = () => <svg {...stroke}><path strokeLinecap="round" strokeLinejoin="round" d="M5 5.5A1.5 1.5 0 0 1 6.5 4H19v13H6.5A1.5 1.5 0 0 0 5 18.5v-13Zm0 13A1.5 1.5 0 0 0 6.5 20H19v-3" /></svg>;
const IconLink = () => <svg {...stroke}><path strokeLinecap="round" strokeLinejoin="round" d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></svg>;

const greeting = () => { const h = new Date().getHours(); return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite'; };
const todayLabel = () => new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
const focusRing = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-wine-500/40';

// ── cabeçalho ───────────────────────────────────────────────────────────────

function HealthChip({ health }: { health: Health }) {
  return health.ok ? (
    <span className="inline-flex items-center gap-2.5 whitespace-nowrap rounded-full bg-sage-100/70 px-3.5 py-1.5 text-sm font-medium text-[#3F5F46]">
      <StatusDot tone="sage" />
      API respondendo
      <span className="text-xs font-normal text-[#3F5F46]/55 tabular-nums">{health.ms} ms</span>
    </span>
  ) : (
    <span className="inline-flex items-center gap-2.5 whitespace-nowrap rounded-full bg-ink/[0.05] px-3.5 py-1.5 text-sm text-ink/65">
      <StatusDot tone="muted" />
      Status da API indisponível
    </span>
  );
}

function Header({ name, health, refreshing, onRefresh }: { name: string; health: Health | null; refreshing: boolean; onRefresh: () => void }) {
  const first = name.trim().split(/\s+/)[0];
  return (
    <header className="mb-8 flex flex-wrap items-end justify-between gap-x-6 gap-y-4 sm:mb-10">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-gold-600">{todayLabel()}</p>
        <h1 className="mt-2 font-display text-3xl font-semibold leading-tight text-wine-800 sm:text-4xl">
          {greeting()}{first ? `, ${first}` : ''}
        </h1>
        <p className="mt-1 text-[15px] text-ink/65">Visão geral da plataforma NailFlow.</p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {health && <HealthChip health={health} />}
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          className={`inline-flex min-h-[40px] items-center gap-2 rounded-full border border-wine-100 bg-white/80 px-4 text-sm text-ink/65 transition-colors hover:border-wine-300 hover:text-wine-800 disabled:opacity-60 ${focusRing}`}
        >
          <IconRefresh className={refreshing ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
          {refreshing ? 'Atualizando…' : 'Atualizar'}
        </button>
      </div>
    </header>
  );
}

// ── visão da plataforma ─────────────────────────────────────────────────────

function Kpi({ label, value, caption }: { label: string; value: number; caption: string }) {
  return (
    <div className="min-w-0 px-1 py-5 sm:px-6 sm:py-6">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ink/60">{label}</p>
      <p className="mt-2 font-display text-4xl font-semibold leading-none text-wine-800 lining-nums">{value}</p>
      <p className="mt-2 text-sm text-ink/65">{caption}</p>
    </div>
  );
}

function SignupsChart({ buckets }: { buckets: MonthBucket[] }) {
  const max = Math.max(...buckets.map((b) => b.count), 1);
  return (
    <div className="mt-2 border-t border-wine-100/70 pt-7">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ink/60">Cadastros por mês</p>
      <ul className="mt-5 flex h-28 items-end gap-3 sm:gap-5" aria-label="Cadastros de profissionais nos últimos 6 meses">
        {buckets.map((b) => (
          <li key={b.key} className="flex h-full flex-1 flex-col items-center justify-end gap-2" title={`${b.label}: ${b.count}`}>
            <span className="text-xs tabular-nums text-ink/60">{b.count}</span>
            <span
              aria-hidden="true"
              className={`w-full max-w-[3rem] rounded-t-lg transition-colors ${b.count > 0 ? 'bg-gradient-to-t from-wine-600 to-wine-400' : 'bg-wine-100/70'}`}
              style={{ height: `${Math.max((b.count / max) * 100, b.count > 0 ? 14 : 4)}%` }}
            />
            <span className="text-xs text-ink/60">{b.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PlatformPanel({ data }: { data: DashboardData }) {
  const s = computeStats(data.rows);
  const buckets = signupsByMonth(data.rows);
  return (
    <Panel className={`!p-6 sm:!p-8 ${ENTER}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Eyebrow>Visão da plataforma</Eyebrow>
        <p className="text-xs text-ink/60">Atualizado às {data.loadedAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</p>
      </div>

      <div className="mt-5 grid gap-x-2 sm:grid-cols-[13rem_minmax(0,1fr)]">
        <div className="border-b border-wine-100/70 pb-6 sm:border-b-0 sm:border-r sm:pb-0 sm:pr-8">
          <p className="font-display text-7xl font-semibold leading-none text-wine-800 lining-nums">{s.accounts}</p>
          <p className="mt-3 text-base font-medium text-ink/75">{s.accounts === 1 ? 'conta de profissional' : 'contas de profissionais'}</p>
          <p className="mt-1 text-sm text-ink/60">
            {s.admins > 0 ? `sem contar ${s.admins} ${s.admins === 1 ? 'conta administradora' : 'contas administradoras'}` : 'cadastradas na plataforma'}
          </p>
        </div>
        <div className="grid grid-cols-2 divide-wine-100/70 [&>*:nth-child(n+3)]:border-t [&>*:nth-child(n+3)]:border-wine-100/70 [&>*:nth-child(even)]:border-l [&>*:nth-child(even)]:border-wine-100/70">
          <Kpi label="Ativas" value={s.active} caption="com acesso liberado" />
          <Kpi label="Bloqueadas" value={s.blocked} caption="sem acesso ao sistema" />
          <Kpi label="WhatsApp" value={s.withInstance} caption="com instância configurada" />
          <Kpi label="Novas" value={s.newLast30} caption="nos últimos 30 dias" />
        </div>
      </div>

      {chartIsMeaningful(buckets) && <SignupsChart buckets={buckets} />}
    </Panel>
  );
}

// ── atenção ─────────────────────────────────────────────────────────────────

const MAX_ATTENTION = 4;

function AttentionPanel({ data }: { data: DashboardData }) {
  const items = computeAttention(data.rows, data.deletes7);
  const actionable = items.filter((i) => !i.info);
  const notes = items.filter((i) => i.info);
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, MAX_ATTENTION);
  const hidden = items.length - shown.length;

  return (
    <Panel className={`!p-6 sm:!p-7 ${ENTER} [animation-delay:90ms]`}>
      <Eyebrow tone="gold">Atenção</Eyebrow>
      {actionable.length === 0 ? (
        <div className="mt-4 flex items-start gap-4">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-sage-100 text-[#3F5F46]"><IconTick className="h-5 w-5" /></span>
          <div>
            <p className="font-display text-2xl leading-tight text-wine-800">Tudo em ordem</p>
            <p className="mt-1 text-[15px] text-ink/65">Nenhuma atenção necessária no momento.</p>
            {notes.map((n) => (
              <p key={n.id} className="mt-3 flex items-center gap-2.5 text-sm text-ink/60">
                <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-ink/20" />{n.text}
              </p>
            ))}
          </div>
        </div>
      ) : (
        <>
          <h2 className="mt-3 font-display text-2xl leading-tight text-wine-800">O que merece um olhar</h2>
          <ul className="mt-5 divide-y divide-wine-100/60">
            {shown.map((it) => {
              const body = (
                <>
                  <span aria-hidden="true" className="mt-[7px] h-2 w-2 shrink-0 rounded-full bg-gold-500" />
                  <span className="min-w-0 flex-1 text-[15px] leading-snug text-ink/75">{it.text}</span>
                  {it.to && <span className="mt-0.5 text-wine-500"><IconArrow /></span>}
                </>
              );
              return (
                <li key={it.id}>
                  {it.to ? (
                    <Link to={it.to} className={`group flex items-start gap-3.5 rounded-lg py-3.5 transition-colors hover:text-wine-800 ${focusRing}`}>{body}</Link>
                  ) : (
                    <div className="flex items-start gap-3.5 py-3.5">{body}</div>
                  )}
                </li>
              );
            })}
          </ul>
          {items.length > MAX_ATTENTION && (
            <button type="button" onClick={() => setAll((v) => !v)} className={`mt-2 rounded-md py-1 text-sm font-medium text-wine-600 hover:text-wine-800 ${focusRing}`}>
              {all ? 'Mostrar menos' : `Mostrar mais (${hidden})`}
            </button>
          )}
        </>
      )}
    </Panel>
  );
}

// ── atividade recente ───────────────────────────────────────────────────────

function ActivityRow({ item, meEmail }: { item: DashboardAuditItem; meEmail: string | undefined }) {
  const meta = ACTIVITY_META[item.action];
  const author = item.actorEmail === meEmail ? 'você' : item.actorEmail;
  return (
    <li className="flex items-start gap-4 py-4">
      <span aria-hidden="true" className={`mt-1.5 h-3 w-3 shrink-0 rounded-full border-2 bg-white ${meta.ring}`} />
      <div className="min-w-0 flex-1">
        <p className="text-base font-medium leading-snug text-ink/85">{meta.title}</p>
        <p className="mt-0.5 break-words text-[15px] text-ink/65">Profissional · {item.targetBusinessName}</p>
        <p className="mt-0.5 break-all text-sm text-ink/60 sm:break-normal">por {author}</p>
      </div>
      <p className="shrink-0 text-right text-sm text-ink/60">
        <span className="block font-medium text-ink/65">{dayLabel(item.createdAt)}</span>
        {timeLabel(item.createdAt)}
      </p>
    </li>
  );
}

function ActivityPanel({ data, meEmail }: { data: DashboardData; meEmail: string | undefined }) {
  const audit = data.audit;
  return (
    <Panel className={`!p-6 sm:!p-8 ${ENTER} [animation-delay:150ms]`}>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div>
          <Eyebrow>Atividade recente</Eyebrow>
          <h2 className="mt-3 font-display text-2xl leading-tight text-wine-800">Ações administrativas</h2>
        </div>
        {audit && audit.items.length > 0 && (
          <Link to="/admin/auditoria" className={`rounded-lg py-1 text-[15px] font-medium text-wine-600 transition-colors hover:text-wine-800 ${focusRing}`}>
            Ver auditoria →
          </Link>
        )}
      </div>

      {audit === null ? (
        <p className="mt-8 text-base text-ink/65">Não foi possível carregar a atividade agora. Tente atualizar em instantes.</p>
      ) : audit.items.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-dashed border-wine-200/70 px-6 py-10 text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink/60">Ainda não há atividades</p>
          <p className="mx-auto mt-3 max-w-xs text-base leading-relaxed text-ink/65">As ações administrativas realizadas na plataforma aparecerão aqui.</p>
        </div>
      ) : (
        <>
          <p className="mt-4 text-sm text-ink/60">
            {audit.today} {audit.today === 1 ? 'ação hoje' : 'ações hoje'} · {audit.last7Days} {audit.last7Days === 1 ? 'ação' : 'ações'} nos últimos 7 dias
          </p>
          <ol className="mt-3 divide-y divide-wine-100/60">
            {audit.items.map((it) => <ActivityRow key={it.id} item={it} meEmail={meEmail} />)}
          </ol>
        </>
      )}
    </Panel>
  );
}

// ── atalhos ─────────────────────────────────────────────────────────────────

function Shortcut({ to, icon, children }: { to: string; icon: ReactNode; children: ReactNode }) {
  return (
    <Link to={to} className={`group flex min-h-[48px] items-center gap-3.5 rounded-xl px-3 text-[15px] font-medium text-ink/75 transition-colors hover:bg-wine-50/70 hover:text-wine-800 ${focusRing}`}>
      <span className="text-wine-500">{icon}</span>
      <span className="flex-1">{children}</span>
      <span className="text-wine-400"><IconArrow /></span>
    </Link>
  );
}

function ShortcutsPanel() {
  const { toast } = useToast();
  async function copyLink() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/register`);
      toast('Link de cadastro copiado');
    } catch {
      toast('Não foi possível copiar o link', 'error');
    }
  }
  return (
    <Panel className={`!p-4 sm:!p-5 ${ENTER} [animation-delay:210ms]`}>
      <div className="px-3 pt-2 pb-3"><Eyebrow>Atalhos</Eyebrow></div>
      <nav aria-label="Atalhos administrativos" className="space-y-0.5">
        <Shortcut to="/admin/profissionais" icon={<IconUsers className="h-[18px] w-[18px]" />}>Profissionais</Shortcut>
        <Shortcut to="/admin/auditoria" icon={<IconClipboard className="h-[18px] w-[18px]" />}>Auditoria</Shortcut>
        <Shortcut to="/admin/conta" icon={<IconUser className="h-[18px] w-[18px]" />}>Central da conta</Shortcut>
        <Shortcut to="/ajuda" icon={<IconBook />}>Guia rápido</Shortcut>
      </nav>
      <div className="mt-2 border-t border-wine-100/70 pt-2">
        <button
          type="button"
          onClick={copyLink}
          className={`flex min-h-[48px] w-full items-center gap-3.5 rounded-xl px-3 text-left text-[15px] text-ink/60 transition-colors hover:bg-wine-50/70 hover:text-wine-800 ${focusRing}`}
        >
          <span className="text-wine-400"><IconLink /></span>
          Copiar link de cadastro
        </button>
      </div>
    </Panel>
  );
}

// ── estados ─────────────────────────────────────────────────────────────────

function LoadingState() {
  return (
    <div role="status" aria-label="Carregando o painel" className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_21rem]">
      <div className="space-y-8">
        <Skeleton className="h-72 rounded-3xl" />
        <Skeleton className="h-96 rounded-3xl" />
      </div>
      <div className="space-y-8">
        <Skeleton className="h-60 rounded-3xl" />
        <Skeleton className="h-64 rounded-3xl" />
      </div>
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
    <div className="mx-auto max-w-[78rem]">
      <Header name={professional?.name ?? ''} health={data?.health ?? null} refreshing={refreshing} onRefresh={reload} />

      {state.status === 'loading' && <LoadingState />}
      {state.status === 'error' && <ErrorState title="Não foi possível carregar o painel" message={state.message} onRetry={retry} />}
      {data && (
        // No celular a ordem é: resumo → atenção → atividade → atalhos; no desktop, duas colunas.
        <div className="flex flex-col gap-8 lg:grid lg:grid-cols-[minmax(0,1fr)_21rem] lg:items-start">
          <div className="contents lg:block lg:min-w-0 lg:space-y-8">
            <div className="order-1 lg:order-none"><PlatformPanel data={data} /></div>
            <div className="order-3 lg:order-none"><ActivityPanel data={data} meEmail={professional?.email} /></div>
          </div>
          <div className="contents lg:block lg:min-w-0 lg:space-y-8">
            <div className="order-2 lg:order-none"><AttentionPanel data={data} /></div>
            <div className="order-4 lg:order-none"><ShortcutsPanel /></div>
          </div>
        </div>
      )}
    </div>
  );
}
