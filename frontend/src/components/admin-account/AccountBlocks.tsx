import { Link } from 'react-router-dom';
import { Eyebrow, Panel, StatusDot } from './AccountUi';
import type { AuditAction, AuditItem } from './useAccountOverview';

// Entrada suave das seções (respeita "reduzir movimento"); o atraso escalona a leitura.
export const ENTER = 'motion-safe:animate-fade-in-up [animation-fill-mode:backwards]';


export function firstName(name: string) {
  return name.trim().split(/\s+/)[0] || name;
}

export function initialsOf(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return ((parts[0][0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

export function longDate(iso: string) {
  return new Date(iso).toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });
}

export function dayLabel(iso: string) {
  const d = new Date(iso);
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((startOf(new Date()) - startOf(d)) / 86400000);
  if (diff === 0) return 'Hoje';
  if (diff === 1) return 'Ontem';
  return d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' }).replace('.', '');
}

export function timeLabel(iso: string) {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}


export const ACTIVITY_META: Record<AuditAction, { title: string; ring: string }> = {
  update: { title: 'Cadastro editado', ring: 'border-wine-400' },
  block: { title: 'Conta bloqueada', ring: 'border-rose-400' },
  unblock: { title: 'Conta desbloqueada', ring: 'border-sage-500' },
  delete: { title: 'Conta excluída', ring: 'border-rose-400' },
};


export function Avatar({ name, src, size = 'lg' }: { name: string; src: string | null; size?: 'lg' | 'md' }) {
  const md = size === 'md';
  const shadow = 'ring-[5px] ring-white shadow-[0_24px_48px_-18px_rgba(61,29,40,0.5)]';
  return (
    <div className={`group relative shrink-0 ${md ? 'h-28 w-28 sm:h-32 sm:w-32' : 'h-36 w-36 sm:h-44 sm:w-44'}`}>
      {/* aura: luz vinho/dourada difusa atrás do avatar */}
      <span aria-hidden="true" className={`absolute ${md ? '-inset-9' : '-inset-14'} rounded-full bg-[radial-gradient(closest-side,rgba(140,74,94,0.26),rgba(199,154,69,0.12)_58%,transparent)] blur-xl`} />
      <span aria-hidden="true" className={`absolute ${md ? '-inset-2.5' : '-inset-4'} rounded-full border border-gold-400/40 transition-transform duration-700 motion-safe:group-hover:scale-[1.03]`} />
      <span aria-hidden="true" className={`absolute ${md ? '-inset-5' : '-inset-9'} rounded-full border border-wine-300/25 transition-transform duration-700 motion-safe:group-hover:scale-[1.04]`} />
      {src ? (
        <img src={src} alt={`Foto de ${name}`} className={`relative h-full w-full rounded-full object-cover ${shadow}`} />
      ) : (
        <span
          aria-hidden="true"
          className={`relative flex h-full w-full items-center justify-center rounded-full bg-gradient-to-br from-wine-100 via-white to-gold-300/50 font-display ${md ? 'text-4xl' : 'text-6xl'} text-wine-700 ${shadow}`}
        >
          {initialsOf(name)}
        </span>
      )}
    </div>
  );
}


export function Pill({ ok, children }: { ok: boolean; children: string }) {
  return (
    <span className={`inline-flex items-center gap-2 whitespace-nowrap rounded-full px-3 py-1 text-[13px] ${ok ? 'bg-sage-100/80 font-medium text-[#3F5F46]' : 'bg-ink/[0.04] px-2.5 text-ink/45'}`}>
      {ok && <StatusDot tone="sage" />}
      {children}
    </span>
  );
}


export function ActivityItemRow({ item, last }: { item: AuditItem; last: boolean }) {
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

export function ActivityPanel({ activity }: { activity: AuditItem[] | null }) {
  return (
    <Panel className={`${ENTER} [animation-delay:210ms]`}>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div>
          <Eyebrow>Atividade recente</Eyebrow>
          <h3 className="mt-3 font-display text-3xl leading-tight text-wine-800">Suas ações administrativas</h3>
        </div>
        {activity && activity.length > 0 && (
          <Link
            to="/admin/conta/atividade"
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


export function ErrorState({ message, onRetry, title = 'Não foi possível abrir sua conta' }: { message: string; onRetry: () => void; title?: string }) {
  return (
    <div role="alert" className="rounded-3xl border border-rose-200 bg-rose-50/60 px-6 py-12 text-center">
      <p className="font-display text-2xl text-rose-700">{title}</p>
      <p className="mx-auto mt-2 max-w-md text-base text-ink/60">{message}</p>
      <button type="button" onClick={onRetry} className="btn-secondary mt-6 min-h-[46px] px-6">Tentar novamente</button>
    </div>
  );
}

// Navegador e sistema deste dispositivo, lidos localmente (nada vem do servidor).
export function describeThisDevice() {
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\/|Opera/.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Navegador';
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad|iPod/.test(ua) ? 'iOS' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'sistema não identificado';
  return { label: `${browser} · ${os}`, mobile: /Android|iPhone|iPad|iPod/.test(ua) };
}

// ── ícones (poucos e discretos) ─────────────────────────────────────────────

export const icon = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, viewBox: '0 0 24 24', 'aria-hidden': true, className: 'h-5 w-5' } as const;

export function IconShield() {
  return (
    <svg {...icon}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 3 5 6v5.5c0 4.2 2.9 7.6 7 9.5 4.1-1.9 7-5.3 7-9.5V6l-7-3Zm-2.5 9 2 2 3.5-4" />
    </svg>
  );
}

export function IconDevice({ mobile }: { mobile: boolean }) {
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
