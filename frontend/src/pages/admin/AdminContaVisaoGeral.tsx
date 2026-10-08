import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import AccountShell from '../../components/admin-account/AccountShell';
import { Skeleton, StatusDot } from '../../components/admin-account/AccountUi';
import {
  ENTER, ActivityPanel, Avatar, ErrorState, IconShield, dayLabel, firstName, initialsOf, longDate, timeLabel,
} from '../../components/admin-account/AccountBlocks';
import { useAccountOverview, type AccountOverview } from '../../components/admin-account/useAccountOverview';
import { IconArrow, IconClock, IconTick, IconUser } from '../../components/AdminIcons';
import { usePageTitle } from '../../hooks/usePageTitle';

// Visão geral = porta de entrada da Central da Conta. Só usa dados que o sistema realmente tem:
//  - /auth/me (nome, e-mail, WhatsApp, foto) · /admin/professionals (criada em / bloqueada) ·
//    /admin/audit-log (ações desta conta). Nada de métricas, scores ou dados estimados.

// ── hero ────────────────────────────────────────────────────────────────────

function Hero({ data }: { data: AccountOverview }) {
  const { me, blockedAt, createdAt } = data;
  const active = blockedAt === null;

  return (
    <section
      aria-labelledby="conta-hero"
      className={`relative overflow-hidden rounded-[2.25rem] bg-gradient-to-br from-wine-800 via-wine-800 to-wine-700 text-cream shadow-[0_44px_90px_-44px_rgba(61,29,40,0.75)] ring-1 ring-wine-800/30 ${ENTER}`}
    >
      {/* camadas de luz: champagne no canto superior, vinho mais claro embaixo, monograma bem discreto */}
      <div aria-hidden="true" className="pointer-events-none absolute -right-24 -top-36 h-[34rem] w-[34rem] rounded-full bg-[radial-gradient(closest-side,rgba(199,154,69,0.26),transparent)]" />
      <div aria-hidden="true" className="pointer-events-none absolute -bottom-44 -left-28 h-[30rem] w-[30rem] rounded-full bg-[radial-gradient(closest-side,rgba(166,116,138,0.38),transparent)]" />
      <span aria-hidden="true" className="pointer-events-none absolute -bottom-20 right-4 select-none font-display text-[20rem] font-semibold leading-none text-white/[0.035]">
        {initialsOf(me.name).charAt(0)}
      </span>
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-12 top-0 h-px bg-gradient-to-r from-transparent via-gold-400/70 to-transparent" />

      <div className="relative flex flex-col items-center gap-12 px-6 py-14 text-center sm:flex-row-reverse sm:justify-between sm:gap-12 sm:px-12 sm:py-16 sm:text-left lg:px-14 lg:py-20">
        <Avatar name={me.name} src={me.avatar_b64} />

        <div className="min-w-0 max-w-xl">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-gold-300">NailFlow · Administração</p>
          <h2 id="conta-hero" className="mt-4 font-display font-semibold leading-[1.02] tracking-tight">
            <span className="block text-2xl font-normal tracking-normal text-wine-200 sm:text-3xl">Olá,</span>
            <span className="block break-words text-6xl text-white sm:text-7xl">{firstName(me.name)}</span>
          </h2>

          <div className="mt-6 flex flex-wrap items-center justify-center gap-3 sm:justify-start">
            <span className="inline-flex items-center rounded-full border border-gold-400/50 bg-gold-300/15 px-4 py-1.5 text-sm font-semibold tracking-wide text-gold-300">
              Administradora
            </span>
            <span className="inline-flex items-center gap-3 whitespace-nowrap rounded-full bg-white/10 px-4 py-1.5 text-sm font-medium text-cream">
              <StatusDot tone={active ? 'sage' : 'rose'} />
              {active ? 'Conta ativa' : 'Conta bloqueada'}
            </span>
          </div>

          <p className="mt-6 max-w-md text-base leading-relaxed text-cream/70">
            Sua central para cuidar da identidade, da segurança e da atividade da sua conta.
          </p>

          <div className="mt-8">
            <Link
              to="/admin/conta/perfil?editar=1"
              className="inline-flex min-h-[48px] w-full items-center justify-center rounded-lg bg-cream px-7 text-sm font-semibold text-wine-800 shadow-[0_10px_24px_-12px_rgba(0,0,0,0.5)] transition-all duration-200 hover:-translate-y-0.5 hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-300 focus-visible:ring-offset-2 focus-visible:ring-offset-wine-800 sm:w-auto"
            >
              Editar perfil
            </Link>
          </div>

          <div className="mt-8 flex flex-col items-center gap-x-8 gap-y-2 border-t border-white/10 pt-6 text-sm text-cream/60 sm:flex-row sm:flex-wrap">
            <span className="break-all sm:break-normal">{me.email}</span>
            {createdAt && <span>Administradora desde {longDate(createdAt)}</span>}
          </div>
        </div>
      </div>
    </section>
  );
}

// ── estado da conta: uma superfície, três portas ────────────────────────────

function Line({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <li className={`flex items-center gap-3 text-[15px] ${ok ? 'text-ink/75' : 'text-ink/60'}`}>
      <span aria-hidden="true" className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full ${ok ? 'bg-sage-100 text-[#3F5F46]' : 'bg-ink/[0.05] text-transparent'}`}>
        {ok ? <IconTick /> : <span className="h-0.5 w-2 rounded-full bg-ink/25" />}
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
      className="group relative flex h-full flex-col p-7 transition-colors duration-300 hover:bg-wine-50/60 focus:outline-none focus-visible:bg-wine-50/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-wine-500/40 sm:p-8 lg:p-6 min-[1400px]:p-8"
    >
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-wine-50 text-wine-500 transition-colors duration-300 group-hover:bg-white">{icon}</span>
      <p className="mt-5 text-xs font-semibold uppercase tracking-[0.2em] text-wine-500">{label}</p>
      <p className="mt-2 font-display text-2xl font-semibold leading-snug text-wine-800">{headline}</p>
      <div className="mt-5 flex-1">{children}</div>
      <span className="mt-7 inline-flex items-center gap-2 text-[15px] font-medium text-wine-600 transition-colors group-hover:text-wine-800">
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
      className={`overflow-hidden rounded-3xl border border-wine-100/80 bg-white/85 shadow-[0_1px_2px_rgba(61,29,40,0.04),0_26px_60px_-34px_rgba(61,29,40,0.28)] ${ENTER} [animation-delay:90ms]`}
    >
      <div className="grid divide-y divide-wine-100/70 md:grid-cols-3 md:divide-x md:divide-y-0">
        <StateColumn to="/admin/conta/perfil" icon={<IconUser />} label="Perfil" cta="Ver perfil" headline={profileDone ? 'Dados principais preenchidos' : 'Falta informar o WhatsApp'}>
          <ul className="space-y-2.5">
            <Line ok>Nome</Line>
            <Line ok>E-mail</Line>
            <Line ok={hasPhone}>{hasPhone ? 'WhatsApp' : 'WhatsApp não informado'}</Line>
          </ul>
        </StateColumn>

        <StateColumn to="/admin/conta/seguranca" icon={<span className="[&_svg]:h-5 [&_svg]:w-5"><IconShield /></span>} label="Segurança" cta="Ver segurança" headline="Acesso protegido por senha">
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
          headline={last ? <>{dayLabel(last.createdAt)}<span className="font-sans text-lg font-normal text-ink/60">, {timeLabel(last.createdAt)}</span></> : activity === null ? 'Indisponível agora' : 'Sem atividade ainda'}
        >
          {last ? (
            <p className="text-[15px] text-ink/65">Última ação registrada</p>
          ) : (
            <p className="text-[15px] leading-relaxed text-ink/65">
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
    <div role="status" aria-label="Carregando sua conta" className="space-y-8">
      <Skeleton className="h-[30rem] rounded-[2.25rem] sm:h-[24rem]" />
      <Skeleton className="h-96 rounded-3xl md:h-72" />
      <Skeleton className="h-72 rounded-3xl" />
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
        <div className="space-y-8 sm:space-y-10">
          <Hero data={state.data} />
          <StateOfAccount data={state.data} />
          <ActivityPanel activity={state.data.activity === null ? null : state.data.activity.slice(0, 3)} />
        </div>
      )}
    </AccountShell>
  );
}
