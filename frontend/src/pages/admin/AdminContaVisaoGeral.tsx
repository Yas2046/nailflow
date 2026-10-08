import { Link } from 'react-router-dom';
import AccountShell, { isContaPageAvailable } from '../../components/admin-account/AccountShell';
import { Eyebrow, Panel, Skeleton, StatusDot } from '../../components/admin-account/AccountUi';
import {
  ENTER, ActivityPanel, Avatar, ErrorState, IconDevice, IconShield, Pill, describeThisDevice, firstName, longDate,
} from '../../components/admin-account/AccountBlocks';
import {
  useAccountOverview,
  type AccountOverview,
} from '../../components/admin-account/useAccountOverview';

// ── utilitários ─────────────────────────────────────────────────────────────

// ── hero ────────────────────────────────────────────────────────────────────

function Hero({ data }: { data: AccountOverview }) {
  const { me, blockedAt } = data;
  const active = blockedAt === null;
  const canView = isContaPageAvailable('perfil');

  return (
    <section
      aria-labelledby="conta-hero"
      className={`relative overflow-hidden rounded-[2.25rem] border border-wine-100/80 bg-gradient-to-br from-white via-white to-wine-50/70 shadow-[inset_0_1px_0_rgba(255,255,255,0.95),0_1px_2px_rgba(61,29,40,0.05),0_40px_90px_-40px_rgba(61,29,40,0.34)] ${ENTER}`}
    >
      <div aria-hidden="true" className="pointer-events-none absolute -left-32 -top-32 h-[34rem] w-[34rem] rounded-full bg-[radial-gradient(closest-side,rgba(140,74,94,0.14),rgba(199,154,69,0.06)_60%,transparent)]" />
      <div aria-hidden="true" className="pointer-events-none absolute -bottom-40 -right-32 h-[30rem] w-[30rem] rounded-full bg-[radial-gradient(closest-side,rgba(199,154,69,0.15),transparent)]" />
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-12 top-0 h-px bg-gradient-to-r from-transparent via-gold-400/60 to-transparent" />

      <div className="relative flex flex-col items-center gap-12 px-6 py-14 text-center sm:flex-row sm:gap-12 sm:px-12 sm:py-16 sm:text-left lg:px-14 lg:py-20 xl:gap-16">
        <Avatar name={me.name} src={me.avatar_b64} />

        <div className="min-w-0 flex-1">
          <Eyebrow tone="gold">Administração do NailFlow</Eyebrow>
          <h2 id="conta-hero" className="mt-4 font-display font-semibold leading-[1.02] tracking-tight text-wine-800">
            <span className="block text-2xl font-normal tracking-normal text-wine-400 sm:text-3xl">Olá,</span>
            <span className="block break-words text-6xl sm:text-7xl">{firstName(me.name)}</span>
          </h2>

          <p className="mt-6 inline-flex items-center rounded-full border border-gold-400/50 bg-gold-300/20 px-4 py-1.5 text-sm font-semibold tracking-wide text-gold-600">
            Administradora
          </p>

          <div className="mt-8 flex flex-col items-center gap-5 border-t border-wine-100/80 pt-7 sm:items-start">
            <p className="break-all text-lg text-ink/70 sm:break-normal">{me.email}</p>
            <div className="flex flex-col items-center gap-5 sm:flex-row sm:flex-wrap sm:gap-x-6 sm:gap-y-4">
              <p className="inline-flex items-center gap-3 whitespace-nowrap rounded-full bg-sage-100/70 px-4 py-2 text-[15px] font-medium text-[#3F5F46]">
                <StatusDot tone={active ? 'sage' : 'rose'} />
                {active ? 'Conta ativa' : 'Conta bloqueada'}
              </p>
              {canView && (
              <Link to="/admin/conta/perfil" className="btn-secondary min-h-[46px] whitespace-nowrap px-6 focus-visible:ring-2 focus-visible:ring-wine-500/40">Ver perfil</Link>
            )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ── proteção ────────────────────────────────────────────────────────────────

function ProtectionPanel() {
  const rows: Array<{ label: string; value: string; ok: boolean }> = [
    { label: 'Senha', value: 'Definida', ok: true },
    { label: 'Sessões ativas', value: 'Não monitoradas', ok: false },
    { label: 'Autenticação em 2 etapas', value: 'Não disponível', ok: false },
  ];
  return (
    <Panel className={`${ENTER} [animation-delay:90ms]`}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <Eyebrow>Proteção da conta</Eyebrow>
          <h3 className="mt-3 font-display text-3xl leading-tight text-wine-800">Sua conta está protegida</h3>
          <p className="mt-2 text-base text-ink/55">O acesso exige a sua senha.</p>
        </div>
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-sage-100/80 text-[#3F5F46]"><IconShield /></span>
      </div>
      <dl className="mt-8 space-y-1">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between gap-4 py-3">
            <dt className="min-w-0 flex-1 text-[15px] text-ink/75">{r.label}</dt>
            <dd className="shrink-0"><Pill ok={r.ok}>{r.value}</Pill></dd>
          </div>
        ))}
      </dl>
    </Panel>
  );
}

// ── dispositivos ────────────────────────────────────────────────────────────

function DevicesPanel() {
  const device = describeThisDevice();
  return (
    <Panel className={`${ENTER} [animation-delay:150ms]`}>
      <Eyebrow>Seus dispositivos</Eyebrow>
      <h3 className="mt-3 font-display text-3xl leading-tight text-wine-800">Este dispositivo</h3>

      <div className="mt-8 flex items-center gap-4 rounded-2xl border border-sage-200/80 bg-gradient-to-br from-sage-100/70 to-white px-5 py-5">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white text-wine-600 shadow-sm"><IconDevice mobile={device.mobile} /></span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-lg font-medium text-ink/85">{device.label}</p>
          <p className="mt-0.5 flex items-center gap-2 text-sm text-[#3F5F46]"><StatusDot tone="sage" />Sessão atual</p>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-4 rounded-2xl border border-dashed border-wine-200/70 px-5 py-4">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-wine-50/60 text-wine-300"><IconDevice mobile /></span>
        <p className="text-[15px] leading-snug text-ink/40">Outros dispositivos ainda não são monitorados</p>
      </div>
    </Panel>
  );
}

// ── atividade ───────────────────────────────────────────────────────────────

// ── identidade da conta ─────────────────────────────────────────────────────

function IdentityFooter({ data }: { data: AccountOverview }) {
  return (
    <footer className={`border-t border-wine-100/70 pt-10 ${ENTER} [animation-delay:270ms]`}>
      <p className="font-display text-2xl text-wine-800">Sua conta no NailFlow</p>
      <dl className="mt-6 grid gap-x-12 gap-y-6 sm:grid-cols-2">
        <div>
          <dt className="text-sm text-ink/45">Administradora desde</dt>
          <dd className="mt-1 text-lg text-ink/80">{data.createdAt ? longDate(data.createdAt) : 'Data indisponível'}</dd>
        </div>
        <div>
          <dt className="text-sm text-ink/45">Status</dt>
          <dd className="mt-1 flex items-center gap-2.5 text-lg text-ink/80">
            <StatusDot tone={data.blockedAt === null ? 'sage' : 'rose'} />
            {data.blockedAt === null ? 'Ativa' : 'Bloqueada'}
          </dd>
        </div>
      </dl>
    </footer>
  );
}

// ── estados ─────────────────────────────────────────────────────────────────

function LoadingState() {
  return (
    <div role="status" aria-label="Carregando sua conta" className="space-y-8">
      <Skeleton className="h-[26rem] rounded-[2.25rem] sm:h-[22rem]" />
      <div className="grid gap-6 md:grid-cols-2">
        <Skeleton className="h-72 rounded-3xl" />
        <Skeleton className="h-72 rounded-3xl" />
      </div>
      <Skeleton className="h-64 rounded-3xl" />
    </div>
  );
}

// ── página ──────────────────────────────────────────────────────────────────

export default function AdminContaVisaoGeral() {
  const { state, reload } = useAccountOverview();

  return (
    <AccountShell title="Minha conta" subtitle="Seu espaço no NailFlow">
      {state.status === 'loading' && <LoadingState />}
      {state.status === 'error' && <ErrorState message={state.message} onRetry={reload} />}
      {state.status === 'ready' && (
        <div className="space-y-8 sm:space-y-10">
          <Hero data={state.data} />
          <div className="grid gap-6 sm:gap-8 md:grid-cols-2 lg:grid-cols-1 min-[1400px]:grid-cols-2">
            <ProtectionPanel />
            <DevicesPanel />
          </div>
          <ActivityPanel activity={state.data.activity} />
          <IdentityFooter data={state.data} />
        </div>
      )}
    </AccountShell>
  );
}
