import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import AccountShell from '../../components/admin-account/AccountShell';
import { Eyebrow, Panel, Skeleton } from '../../components/admin-account/AccountUi';
import {
  ENTER, ActivityPanel, ErrorState, IconShield, dayLabel, initialsOf, longDate, timeLabel,
} from '../../components/admin-account/AccountBlocks';
import { useAccountOverview, type AccountOverview } from '../../components/admin-account/useAccountOverview';
import { IconArrow, IconClock, IconTick, IconUser } from '../../components/AdminIcons';
import { usePageTitle } from '../../hooks/usePageTitle';

// Visão geral = porta de entrada da Central da Conta. Só usa dados que o sistema realmente tem:
//  - /auth/me (nome, e-mail, WhatsApp, foto) · /admin/professionals (criada em / bloqueada) ·
//    /admin/audit-log (ações desta conta). Nada de métricas, scores ou dados estimados.

// ── identidade: cartão noturno ──────────────────────────────────────────────

function Identity({ data }: { data: AccountOverview }) {
  const { me, blockedAt, createdAt } = data;
  const active = blockedAt === null;

  return (
    <Panel tone="night" className={`relative overflow-hidden !p-0 ${ENTER}`}>
      <div aria-hidden="true" className="absolute inset-x-0 top-0 h-px bg-gold-500/70" />
      <div className="flex flex-col gap-6 p-5 sm:flex-row sm:items-center sm:gap-8 sm:p-8">
        {me.avatar_b64 ? (
          <img src={me.avatar_b64} alt={`Foto de ${me.name}`} className="h-24 w-24 shrink-0 rounded-2xl object-cover ring-1 ring-white/20 sm:h-28 sm:w-28" />
        ) : (
          <span aria-hidden="true" className="flex h-24 w-24 shrink-0 items-center justify-center rounded-2xl bg-wine-600 font-display text-4xl font-semibold text-white sm:h-28 sm:w-28 sm:text-5xl">
            {initialsOf(me.name)}
          </span>
        )}

        <div className="min-w-0 flex-1">
          <Eyebrow tone="night">nailflow · administração</Eyebrow>
          <h2 className="mt-2 break-words font-display text-[1.875rem] font-semibold leading-tight text-white sm:text-4xl">{me.name}</h2>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center rounded-md border border-gold-400/50 bg-gold-400/10 px-2 py-1 text-xs font-medium text-gold-300">Administradora</span>
            <span className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium ${active ? 'bg-signal/10 text-signal' : 'bg-rose-500/20 text-rose-200'}`}>
              <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${active ? 'bg-signal' : 'bg-rose-400'}`} />
              {active ? 'Conta ativa' : 'Conta bloqueada'}
            </span>
          </div>
          <dl className="mt-4 flex flex-col gap-x-8 gap-y-1 font-mono text-xs text-[#BDB3AC] sm:flex-row sm:flex-wrap">
            <div className="flex gap-2"><dt className="sr-only">E-mail</dt><dd className="break-all sm:break-normal">{me.email}</dd></div>
            {createdAt && <div className="flex gap-2"><dt className="sr-only">Desde</dt><dd>administradora desde {longDate(createdAt)}</dd></div>}
          </dl>
        </div>

        <Link
          to="/admin/conta/perfil?editar=1"
          className="inline-flex min-h-[44px] items-center justify-center rounded-lg bg-white px-5 text-sm font-semibold text-wine-800 transition-colors hover:bg-wine-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-wine-300 focus-visible:ring-offset-2 focus-visible:ring-offset-night-900 sm:self-start"
        >
          Editar perfil
        </Link>
      </div>
    </Panel>
  );
}

// ── estado da conta: três portas ────────────────────────────────────────────

function Line({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <li className={`flex items-center gap-3 text-[15px] ${ok ? 'text-ink/85' : 'text-ink/60'}`}>
      <span aria-hidden="true" className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md ${ok ? 'bg-sage-100 text-sage-700' : 'bg-ink/[0.06] text-transparent'}`}>
        {ok ? <IconTick /> : <span className="h-0.5 w-2 rounded-full bg-ink/30" />}
      </span>
      {children}
    </li>
  );
}

function StateColumn({
  to, icon, label, headline, children, cta,
}: { to: string; icon: ReactNode; label: string; headline: ReactNode; children: ReactNode; cta: string }) {
  return (
    <Link
      to={to}
      className="group relative flex h-full flex-col p-6 transition-colors duration-200 hover:bg-wine-50/60 focus:outline-none focus-visible:bg-wine-50/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-wine-500/50 sm:p-7"
    >
      <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-wine-50 text-wine-600 transition-colors group-hover:bg-white">{icon}</span>
      <p className="mt-5 font-mono text-[11px] uppercase tracking-[0.16em] text-wine-600">{label}</p>
      <p className="mt-1.5 font-display text-xl font-semibold leading-snug text-wine-800">{headline}</p>
      <div className="mt-4 flex-1">{children}</div>
      <span className="mt-6 inline-flex items-center gap-2 text-sm font-medium text-wine-600 transition-colors group-hover:text-wine-800">
        {cta}<IconArrow />
      </span>
    </Link>
  );
}

function StateOfAccount({ data }: { data: AccountOverview }) {
  const { me, activity } = data;
  const hasPhone = !!me.phone_whatsapp?.trim();
  const profileDone = !!me.name.trim() && !!me.email.trim() && hasPhone;
  const last = activity?.[0];

  return (
    <section
      aria-label="Estado da conta"
      className={`overflow-hidden rounded-2xl border border-wine-100 bg-white ${ENTER} [animation-delay:90ms]`}
    >
      <div className="grid divide-y divide-wine-100 md:grid-cols-3 md:divide-x md:divide-y-0">
        <StateColumn to="/admin/conta/perfil" icon={<IconUser />} label="Perfil" cta="Ver perfil" headline={profileDone ? 'Dados principais preenchidos' : 'Falta informar o WhatsApp'}>
          <ul className="space-y-2.5">
            <Line ok>Nome</Line>
            <Line ok>E-mail</Line>
            <Line ok={hasPhone}>{hasPhone ? 'WhatsApp' : 'WhatsApp não informado'}</Line>
          </ul>
        </StateColumn>

        <StateColumn to="/admin/conta/seguranca" icon={<IconShield />} label="Segurança" cta="Ver segurança" headline="Acesso protegido por senha">
          <ul className="space-y-2.5">
            <Line ok>Senha definida</Line>
            <Line ok>Sessão em cookie protegido</Line>
            <Line ok={false}>Duas etapas indisponível</Line>
          </ul>
        </StateColumn>

        <StateColumn
          to="/admin/conta/atividade"
          icon={<IconClock />}
          label="Atividade"
          cta="Ver atividade"
          headline={last ? <>{dayLabel(last.createdAt)}<span className="ml-1 font-mono text-sm font-normal text-ink/65">{timeLabel(last.createdAt)}</span></> : activity === null ? 'Indisponível agora' : 'Sem atividade ainda'}
        >
          {last ? (
            <p className="text-[15px] text-ink/70">Última ação registrada</p>
          ) : (
            <p className="text-[15px] leading-relaxed text-ink/70">
              {activity === null ? 'Não foi possível carregar a atividade. Tente novamente em instantes.' : 'As ações administrativas que você realizar aparecerão aqui.'}
            </p>
          )}
        </StateColumn>
      </div>
    </section>
  );
}

// ── estados ─────────────────────────────────────────────────────────────────

function LoadingState() {
  return (
    <div role="status" aria-label="Carregando sua conta" className="space-y-6">
      <Skeleton className="h-64 rounded-2xl sm:h-44" />
      <Skeleton className="h-96 rounded-2xl md:h-64" />
      <Skeleton className="h-72 rounded-2xl" />
    </div>
  );
}

// ── página ──────────────────────────────────────────────────────────────────

export default function AdminContaVisaoGeral() {
  usePageTitle('Central da conta');
  const { state, reload } = useAccountOverview();

  return (
    <AccountShell title="Visão geral" subtitle="Resumo da sua conta de administradora.">
      {state.status === 'loading' && <LoadingState />}
      {state.status === 'error' && <ErrorState message={state.message} onRetry={reload} />}
      {state.status === 'ready' && (
        <div className="space-y-6">
          <Identity data={state.data} />
          <StateOfAccount data={state.data} />
          <ActivityPanel activity={state.data.activity === null ? null : state.data.activity.slice(0, 3)} />
        </div>
      )}
    </AccountShell>
  );
}
