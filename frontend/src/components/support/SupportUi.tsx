import type { ReactNode } from 'react';
import {
  priorityLabel, statusLabel,
  type SupportPriority, type SupportRole, type SupportStatus,
} from '../../services/support';

// Peças visuais da Central de Suporte, usadas pela área da profissional e pela da ADM. Só usam tokens do
// Tailwind do projeto (wine/gold/sage/rose/ink/cream), que cada área redefine no seu escopo.

const STATUS_STYLE: Record<SupportStatus, string> = {
  aberta: 'bg-wine-50 text-wine-700 ring-wine-200',
  em_atendimento: 'bg-gold-300/30 text-gold-700 ring-gold-400/50',
  aguardando_profissional: 'bg-wine-600 text-white ring-wine-600',
  resolvida: 'bg-sage-100 text-sage-700 ring-sage-200',
};

export function StatusPill({ status, viewer }: { status: SupportStatus; viewer: SupportRole }) {
  // "Aguardando você" é a que pede ação da profissional: destaque cheio. Para a ADM é só um estado.
  const style = status === 'aguardando_profissional' && viewer === 'admin'
    ? 'bg-gold-300/30 text-gold-700 ring-gold-400/50'
    : STATUS_STYLE[status];
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${style}`}>
      {statusLabel(status, viewer)}
    </span>
  );
}

const PRIORITY_STYLE: Record<SupportPriority, string> = {
  alta: 'bg-rose-50 text-rose-700 ring-rose-200',
  media: 'bg-gold-300/30 text-gold-700 ring-gold-400/50',
  baixa: 'bg-sage-100 text-sage-700 ring-sage-200',
};

export function PriorityPill({ priority }: { priority: SupportPriority }) {
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${PRIORITY_STYLE[priority]}`}>
      {priorityLabel(priority)}
    </span>
  );
}

export function UnreadDot({ label = 'Nova resposta' }: { label?: string }) {
  return (
    <span className="inline-flex items-center" title={label}>
      <span className="h-2.5 w-2.5 rounded-full bg-gold-500" aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </span>
  );
}

export function UnreadBadge({ count, className = '' }: { count: number; className?: string }) {
  if (count <= 0) return null;
  return (
    <span
      className={`inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-gold-500 px-1.5 text-[11px] font-bold leading-5 text-white ${className}`}
      aria-label={`${count} ${count === 1 ? 'nova' : 'novas'}`}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}

export function Skeleton({ className }: { className: string }) {
  return <div className={`animate-pulse rounded-md bg-wine-100/70 ${className}`} />;
}

export function LoadingList({ rows = 4, label = 'Carregando…' }: { rows?: number; label?: string }) {
  return (
    <div aria-busy="true" aria-live="polite" className="space-y-3">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="rounded-2xl border border-wine-100 bg-white p-4">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="mt-3 h-3 w-1/3" />
        </div>
      ))}
    </div>
  );
}

export function ErrorBox({ message, onRetry, title = 'Não foi possível carregar' }: { message: string; onRetry?: () => void; title?: string }) {
  return (
    <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50/60 p-8 text-center">
      <p className="font-display text-lg font-semibold text-wine-800">{title}</p>
      <p className="mt-1 text-sm text-rose-700">{message}</p>
      {onRetry && <button type="button" onClick={onRetry} className="btn-primary mt-5">Tentar novamente</button>}
    </div>
  );
}

export function EmptyBox({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-wine-200 bg-white p-10 text-center">
      <p className="font-display text-lg font-semibold text-wine-800">{title}</p>
      {children && <p className="mx-auto mt-1.5 max-w-sm text-sm text-ink/65">{children}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Notice({ tone, children }: { tone: 'info' | 'error' | 'success'; children: ReactNode }) {
  const style = tone === 'error'
    ? 'border-rose-200 bg-rose-50 text-rose-700'
    : tone === 'success'
      ? 'border-sage-200 bg-sage-100 text-sage-700'
      : 'border-wine-100 bg-wine-50/70 text-ink/75';
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`rounded-xl border px-4 py-3 text-sm leading-relaxed ${style}`}>
      {children}
    </div>
  );
}

export function Pager({ page, totalPages, total, onPage }: { page: number; totalPages: number; total: number; onPage: (p: number) => void }) {
  if (total === 0) return null;
  return (
    <nav aria-label="Paginação" className="mt-5 flex items-center justify-between gap-3 text-sm text-ink/70">
      <span aria-live="polite">Página {page} de {totalPages} · {total} {total === 1 ? 'resultado' : 'resultados'}</span>
      <span className="flex gap-2">
        <button type="button" className="btn-secondary !px-3 !py-1.5" disabled={page <= 1} onClick={() => onPage(page - 1)}>Anterior</button>
        <button type="button" className="btn-secondary !px-3 !py-1.5" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>Próxima</button>
      </span>
    </nav>
  );
}

export function CharCounter({ value, max }: { value: number; max: number }) {
  return (
    <span className={`text-xs tabular-nums ${value > max ? 'font-semibold text-rose-600' : 'text-ink/50'}`} aria-live="off">
      {value}/{max}
    </span>
  );
}

export function Unavailable() {
  return (
    <div className="mx-auto max-w-md rounded-2xl border border-wine-100 bg-white p-10 text-center">
      <p className="font-display text-xl font-semibold text-wine-800">Esta área não está disponível no momento</p>
      <p className="mt-2 text-sm text-ink/65">Tente novamente mais tarde.</p>
    </div>
  );
}
