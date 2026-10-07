import { Link } from 'react-router-dom';
import AccountShell, { isContaPageAvailable } from '../../components/admin-account/AccountShell';
import { Eyebrow, Panel, Skeleton, StatusDot } from '../../components/admin-account/AccountUi';
import {
  useAccountOverview,
  type AccountOverview,
  type AuditAction,
  type AuditItem,
} from '../../components/admin-account/useAccountOverview';

// Entrada suave das seções (respeita "reduzir movimento"); o atraso escalona a leitura.
const ENTER = 'motion-safe:animate-fade-in-up [animation-fill-mode:backwards]';

// ── utilitários ─────────────────────────────────────────────────────────────

function firstName(name: string) {
  return name.trim().split(/\s+/)[0] || name;
}

function initialsOf(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return ((parts[0][0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

function longDate(iso: string) {
  return new Date(iso).toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });
}

function dayLabel(iso: string) {
  const d = new Date(iso);
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((startOf(new Date()) - startOf(d)) / 86400000);
  if (diff === 0) return 'Hoje';
  if (diff === 1) return 'Ontem';
  return d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' }).replace('.', '');
}

function timeLabel(iso: string) {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

// Navegador e sistema deste dispositivo, lidos localmente (nada vem do servidor).
function describeThisDevice() {
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\/|Opera/.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Navegador';
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad|iPod/.test(ua) ? 'iOS' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'sistema não identificado';
  return { label: `${browser} · ${os}`, mobile: /Android|iPhone|iPad|iPod/.test(ua) };
}

const ACTIVITY_META: Record<AuditAction, { title: string; ring: string }> = {
  update: { title: 'Cadastro editado', ring: 'border-wine-400' },
  block: { title: 'Conta bloqueada', ring: 'border-rose-400' },
  unblock: { title: 'Conta desbloqueada', ring: 'border-sage-500' },
  delete: { title: 'Conta excluída', ring: 'border-rose-400' },
};

// ── ícones (poucos e discretos) ─────────────────────────────────────────────

const icon = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, viewBox: '0 0 24 24', 'aria-hidden': true, className: 'h-5 w-5' } as const;

function IconShield() {
  return (
    <svg {...icon}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 3 5 6v5.5c0 4.2 2.9 7.6 7 9.5 4.1-1.9 7-5.3 7-9.5V6l-7-3Zm-2.5 9 2 2 3.5-4" />
    </svg>
  );
}

function IconDevice({ mobile }: { mobile: boolean }) {
  return mobile ? (
    <svg {...icon}>
      <rect x="7" y="3" width="10" height="18" rx="2.5" />
      <path strokeLinecap="round" d="M11 18h2" />
    </svg>
  ) : (
    <svg {...icon}>
      <rect x="3" y="4.5" width="18" height="12" rx="2" />
      <path strokeLinecap="round" d="M9 20h6M12 16.5V20" />
    </svg>
  );
}

// ── hero ────────────────────────────────────────────────────────────────────

function Avatar({ name, src }: { name: string; src: string | null }) {
  const shadow = 'ring-[5px] ring-white shadow-[0_24px_48px_-18px_rgba(61,29,40,0.5)]';
  return (
    <div className="group relative h-36 w-36 shrink-0 sm:h-44 sm:w-44">
      {/* aura: luz vinho/dourada difusa atrás do avatar */}
      <span aria-hidden="true" className="absolute -inset-14 rounded-full bg-[radial-gradient(closest-side,rgba(140,74,94,0.26),rgba(199,154,69,0.12)_58%,transparent)] blur-xl" />
      <span aria-hidden="true" className="absolute -inset-4 rounded-full border border-gold-400/40 transition-transform duration-700 motion-safe:group-hover:scale-[1.03]" />
      <span aria-hidden="true" className="absolute -inset-9 rounded-full border border-wine-300/25 transition-transform duration-700 motion-safe:group-hover:scale-[1.04]" />
      {src ? (
        <img src={src} alt={`Foto de ${name}`} className={`relative h-full w-full rounded-full object-cover ${shadow}`} />
      ) : (
        <span
          aria-hidden="true"
          className={`relative flex h-full w-full items-center justify-center rounded-full bg-gradient-to-br from-wine-100 via-white to-gold-300/50 font-display text-6xl text-wine-700 ${shadow}`}
        >
          {initialsOf(name)}
        </span>
      )}
    </div>
  );
}

function Hero({ data }: { data: AccountOverview }) {
  const { me, blockedAt } = data;
  const active = blockedAt === null;
  const canEdit = isContaPageAvailable('perfil');

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
              {canEdit ? (
                <Link to="/admin/conta/perfil" className="btn-secondary min-h-[46px] px-6 focus-visible:ring-2 focus-visible:ring-wine-500/40">Editar perfil</Link>
              ) : (
                <span className="inline-flex items-center gap-3 whitespace-nowrap">
                  <button type="button" disabled className="btn-secondary min-h-[46px] cursor-not-allowed whitespace-nowrap px-6 opacity-45">Editar perfil</button>
                  <span className="text-xs uppercase tracking-widest text-ink/30">em breve</span>
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ── proteção ────────────────────────────────────────────────────────────────

function Pill({ ok, children }: { ok: boolean; children: string }) {
  return (
    <span className={`inline-flex items-center gap-2 whitespace-nowrap rounded-full px-3 py-1 text-[13px] ${ok ? 'bg-sage-100/80 font-medium text-[#3F5F46]' : 'bg-ink/[0.04] px-2.5 text-ink/45'}`}>
      {ok && <StatusDot tone="sage" />}
      {children}
    </span>
  );
}

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

function ActivityItemRow({ item, last }: { item: AuditItem; last: boolean }) {
  const meta = ACTIVITY_META[item.action];
  return (
    <li className={`group grid grid-cols-[4.25rem_1rem_minmax(0,1fr)] gap-x-4 sm:grid-cols-[5.5rem_1rem_minmax(0,1fr)] sm:gap-x-6 ${last ? '' : 'pb-9'}`}>
      <p className="pt-0.5 text-right">
        <span className="block text-[15px] font-semibold text-ink/80">{dayLabel(item.createdAt)}</span>
        <span className="block text-sm text-ink/40">{timeLabel(item.createdAt)}</span>
      </p>
      <div className="relative flex justify-center">
        <span aria-hidden="true" className={`relative z-10 mt-1.5 h-3 w-3 rounded-full border-2 bg-white transition-transform duration-300 motion-safe:group-hover:scale-125 ${meta.ring}`} />
        {!last && <span aria-hidden="true" className="absolute -bottom-1.5 top-6 w-px bg-gradient-to-b from-wine-200/80 to-wine-100/30" />}
      </div>
      <div className="min-w-0">
        <p className="text-lg font-medium leading-snug text-ink/85">{meta.title}</p>
        <p className="mt-0.5 truncate text-[15px] text-ink/50">Profissional · {item.targetBusinessName}</p>
      </div>
    </li>
  );
}

function ActivityPanel({ activity }: { activity: AuditItem[] | null }) {
  return (
    <Panel className={`${ENTER} [animation-delay:210ms]`}>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div>
          <Eyebrow>Atividade recente</Eyebrow>
          <h3 className="mt-3 font-display text-3xl leading-tight text-wine-800">Suas ações administrativas</h3>
        </div>
        {activity && activity.length > 0 && (
          <Link
            to="/admin/auditoria"
            className="rounded-lg py-1 text-[15px] font-medium text-wine-600 transition-colors hover:text-wine-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-wine-500/40"
          >
            Ver histórico completo →
          </Link>
        )}
      </div>

      {activity === null ? (
        <p className="mt-10 text-base text-ink/55">Não foi possível carregar a atividade agora. Tente novamente em instantes.</p>
      ) : activity.length === 0 ? (
        <div className="mt-10 rounded-2xl border border-dashed border-wine-200/70 px-6 py-12 text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink/40">Ainda não há atividades</p>
          <p className="mx-auto mt-3 max-w-xs text-base leading-relaxed text-ink/55">
            As ações importantes da sua conta aparecerão aqui.
          </p>
        </div>
      ) : (
        <ol className="mt-10">
          {activity.map((a, i) => <ActivityItemRow key={a.id} item={a} last={i === activity.length - 1} />)}
        </ol>
      )}
    </Panel>
  );
}

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

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="rounded-3xl border border-rose-200 bg-rose-50/60 px-6 py-12 text-center">
      <p className="font-display text-2xl text-rose-700">Não foi possível abrir sua conta</p>
      <p className="mx-auto mt-2 max-w-md text-base text-ink/60">{message}</p>
      <button type="button" onClick={onRetry} className="btn-secondary mt-6 min-h-[46px] px-6">Tentar novamente</button>
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
