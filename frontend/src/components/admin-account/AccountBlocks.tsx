import { Link } from 'react-router-dom';
import { Eyebrow, Panel, StatusDot, type BadgeTone } from './AccountUi';
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

// ── tipos de ação do histórico: apresentação única para todas as telas ─────────

export const ACTIVITY_META: Record<AuditAction, { title: string; label: string; tone: BadgeTone; ring: string; tile: string }> = {
  update: { title: 'Cadastro editado', label: 'Edição', tone: 'info', ring: 'border-wine-500', tile: 'bg-wine-50 text-wine-600' },
  block: { title: 'Conta bloqueada', label: 'Bloqueio', tone: 'danger', ring: 'border-rose-500', tile: 'bg-rose-50 text-rose-600' },
  unblock: { title: 'Conta desbloqueada', label: 'Desbloqueio', tone: 'ok', ring: 'border-sage-500', tile: 'bg-sage-100 text-sage-700' },
  delete: { title: 'Conta excluída', label: 'Exclusão', tone: 'danger', ring: 'border-rose-600', tile: 'bg-rose-100 text-rose-700' },
};

const aiProps = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, viewBox: '0 0 24 24', 'aria-hidden': true } as const;

export function ActionIcon({ action, className = 'h-[18px] w-[18px]' }: { action: AuditAction; className?: string }) {
  switch (action) {
    case 'update':
      return <svg {...aiProps} className={className}><path strokeLinecap="round" strokeLinejoin="round" d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3Zm9.5-13.5 3 3" /></svg>;
    case 'block':
      return <svg {...aiProps} className={className}><rect x="5" y="11" width="14" height="9" rx="2" /><path strokeLinecap="round" d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>;
    case 'unblock':
      return <svg {...aiProps} className={className}><rect x="5" y="11" width="14" height="9" rx="2" /><path strokeLinecap="round" d="M8 11V8a4 4 0 0 1 7.5-1.9" /></svg>;
    case 'delete':
      return <svg {...aiProps} className={className}><path strokeLinecap="round" strokeLinejoin="round" d="M5 7h14M10 7V4h4v3m-7 0 1 13h8l1-13M10 11v6m4-6v6" /></svg>;
  }
}

/** Foto ou iniciais, em quadrado de cantos suaves (sem auras nem anéis decorativos). */
export function Avatar({ name, src, size = 'lg' }: { name: string; src: string | null; size?: 'lg' | 'md' }) {
  const box = size === 'md' ? 'h-24 w-24 text-3xl' : 'h-28 w-28 text-4xl sm:h-32 sm:w-32 sm:text-5xl';
  return src ? (
    <img src={src} alt={`Foto de ${name}`} className={`${box} shrink-0 rounded-2xl object-cover ring-1 ring-wine-200`} />
  ) : (
    <span
      aria-hidden="true"
      className={`${box} flex shrink-0 items-center justify-center rounded-2xl bg-wine-600 font-display font-semibold text-white`}
    >
      {initialsOf(name)}
    </span>
  );
}


export function Pill({ ok, children }: { ok: boolean; children: string }) {
  return (
    <span className={`inline-flex items-center gap-2 whitespace-nowrap rounded-md px-2 py-1 text-xs font-medium ${ok ? 'bg-sage-100 text-sage-700' : 'bg-ink/[0.06] text-ink/70'}`}>
      {ok && <StatusDot tone="sage" />}
      {children}
    </span>
  );
}


export function ActivityItemRow({ item, last }: { item: AuditItem; last: boolean }) {
  const meta = ACTIVITY_META[item.action];
  return (
    <li className={`group flex items-start gap-4 py-4 ${last ? '' : 'border-b border-wine-100'}`}>
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${meta.tile}`}><ActionIcon action={item.action} /></span>
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-medium leading-snug text-ink/90">{meta.title}</p>
        <p className="mt-0.5 truncate text-sm text-ink/65">Profissional · {item.targetBusinessName}</p>
      </div>
      <p className="shrink-0 text-right font-mono text-xs leading-5 text-ink/65">
        <span className="block font-medium text-ink/80">{dayLabel(item.createdAt)}</span>
        {timeLabel(item.createdAt)}
      </p>
    </li>
  );
}

export function ActivityPanel({ activity }: { activity: AuditItem[] | null }) {
  return (
    <Panel className={`${ENTER} [animation-delay:210ms]`}>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div>
          <Eyebrow>Atividade recente</Eyebrow>
          <h3 className="mt-2 font-display text-xl font-semibold leading-tight text-wine-800">Suas ações administrativas</h3>
        </div>
        {activity && activity.length > 0 && (
          <Link
            to="/admin/conta/atividade"
            className="rounded-lg py-1 text-sm font-medium text-wine-600 transition-colors hover:text-wine-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-wine-500/50"
          >
            Ver atividade →
          </Link>
        )}
      </div>

      {activity === null ? (
        <p className="mt-6 text-[15px] text-ink/70">Não foi possível carregar a atividade agora. Tente novamente em instantes.</p>
      ) : activity.length === 0 ? (
        <div className="mt-6 rounded-xl border border-dashed border-wine-200 px-6 py-10 text-center">
          <Eyebrow>Ainda não há atividades</Eyebrow>
          <p className="mx-auto mt-3 max-w-xs text-[15px] leading-relaxed text-ink/70">As ações importantes da sua conta aparecerão aqui.</p>
        </div>
      ) : (
        <ol className="mt-3">
          {activity.map((a, i) => <ActivityItemRow key={a.id} item={a} last={i === activity.length - 1} />)}
        </ol>
      )}
    </Panel>
  );
}


export function ErrorState({ message, onRetry, title = 'Não foi possível abrir sua conta' }: { message: string; onRetry: () => void; title?: string }) {
  return (
    <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50/70 px-6 py-12 text-center">
      <p className="font-display text-xl font-semibold text-rose-700">{title}</p>
      <p className="mx-auto mt-2 max-w-md text-[15px] text-ink/70">{message}</p>
      <button type="button" onClick={onRetry} className="btn-secondary mt-6 min-h-[44px] px-6">Tentar novamente</button>
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
