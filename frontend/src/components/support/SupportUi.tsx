import type { ReactNode } from 'react';
import {
  priorityLabel, statusLabel,
  type SupportPriority, type SupportRole, type SupportStatus,
} from '../../services/support';
import { IconAlert, IconCheckCircle, IconInfo, IconLock } from './SupportIcons';

// Peças visuais da Central de Suporte, usadas pela área da profissional e pela da ADM. Só usam tokens do
// Tailwind do projeto (wine/gold/sage/rose/ink/cream), que cada área redefine no seu escopo.

const STATUS_STYLE: Record<SupportStatus, { pill: string; dot: string }> = {
  aberta: { pill: 'bg-wine-50 text-wine-700 ring-wine-200', dot: 'bg-wine-400' },
  em_atendimento: { pill: 'bg-gold-300/30 text-gold-700 ring-gold-400/50', dot: 'bg-gold-500' },
  aguardando_profissional: { pill: 'bg-wine-600 text-white ring-wine-600', dot: 'bg-white' },
  resolvida: { pill: 'bg-sage-100 text-sage-700 ring-sage-200', dot: 'bg-sage-500' },
};

export function StatusPill({ status, viewer }: { status: SupportStatus; viewer: SupportRole }) {
  // "Aguardando você" é a que pede ação da profissional: destaque cheio. Para a ADM é só um estado.
  const style = status === 'aguardando_profissional' && viewer === 'admin'
    ? { pill: 'bg-gold-300/30 text-gold-700 ring-gold-400/50', dot: 'bg-gold-500' }
    : STATUS_STYLE[status];
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${style.pill}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} aria-hidden="true" />
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

/** Círculo tingido que abriga um ícone (cartões, estados vazios, avisos). */
export function IconBubble({ children, tone = 'wine', size = 'md' }: { children: ReactNode; tone?: 'wine' | 'gold' | 'sage' | 'rose'; size?: 'sm' | 'md' | 'lg' }) {
  const color = {
    wine: 'bg-wine-50 text-wine-600 ring-wine-100',
    gold: 'bg-gold-300/25 text-gold-700 ring-gold-400/30',
    sage: 'bg-sage-100 text-sage-700 ring-sage-200',
    rose: 'bg-rose-50 text-rose-600 ring-rose-100',
  }[tone];
  const dim = { sm: 'h-8 w-8', md: 'h-10 w-10', lg: 'h-14 w-14' }[size];
  return <span className={`inline-flex ${dim} shrink-0 items-center justify-center rounded-full ring-1 ring-inset ${color}`} aria-hidden="true">{children}</span>;
}

/** Iniciais num círculo (a profissional ou a equipe), para identificar quem escreveu. */
export function Avatar({ name, tone = 'wine' }: { name: string; tone?: 'wine' | 'gold' }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => [...w][0]?.toUpperCase() ?? '').join('') || '?';
  const color = tone === 'gold' ? 'bg-gold-300/30 text-gold-700 ring-gold-400/40' : 'bg-wine-100 text-wine-700 ring-wine-200';
  return (
    <span className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ring-1 ring-inset ${color}`} aria-hidden="true">
      {initials}
    </span>
  );
}

const STEPS = ['Enviada', 'Em atendimento', 'Resolvida'] as const;

/**
 * Andamento em três passos, derivado só do status: aberta → enviada; em atendimento e aguardando a profissional →
 * em atendimento; resolvida → concluída. Decorativo (o status em texto vem logo ao lado).
 */
export function StatusProgress({ status, viewer }: { status: SupportStatus; viewer: SupportRole }) {
  const current = status === 'aberta' ? 0 : status === 'resolvida' ? 2 : 1;
  const waiting = status === 'aguardando_profissional' && viewer === 'professional';
  return (
    <div aria-hidden="true" className="mt-4">
      <ol className="flex items-center">
        {STEPS.map((label, i) => {
          const done = i < current || (i === 2 && current === 2);
          const active = i === current && !done;
          return (
            <li key={label} className={`flex items-center ${i < STEPS.length - 1 ? 'flex-1' : ''}`}>
              <span className="flex flex-col items-start">
                <span
                  className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ring-2 ring-inset transition-colors ${
                    done ? 'bg-sage-500 text-white ring-sage-500'
                      : active ? `${waiting ? 'bg-wine-600 text-white ring-wine-600' : 'bg-white text-wine-700 ring-wine-500'}`
                        : 'bg-white text-ink/30 ring-wine-100'
                  }`}
                >
                  {done ? '✓' : i + 1}
                </span>
              </span>
              {i < STEPS.length - 1 && <span className={`mx-2 h-0.5 flex-1 rounded-full ${i < current ? 'bg-sage-500' : 'bg-wine-100'}`} />}
            </li>
          );
        })}
      </ol>
      <ol className="mt-1.5 flex justify-between text-[11px] text-ink/55">
        {STEPS.map((label, i) => (
          <li key={label} className={`${i === current ? 'font-semibold text-wine-700' : ''} ${i === 1 ? 'text-center' : i === 2 ? 'text-right' : ''}`}>
            {label}{i === 1 && waiting ? ' · sua vez' : ''}
          </li>
        ))}
      </ol>
    </div>
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
        <div key={i} className="flex items-center gap-3 rounded-2xl border border-wine-100 bg-white p-4">
          <Skeleton className="h-10 w-10 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="mt-3 h-3 w-1/3" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ErrorBox({ message, onRetry, title = 'Não foi possível carregar' }: { message: string; onRetry?: () => void; title?: string }) {
  return (
    <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50/60 p-8 text-center">
      <div className="mb-3 flex justify-center"><IconBubble tone="rose" size="lg"><IconAlert className="h-6 w-6" /></IconBubble></div>
      <p className="font-display text-lg font-semibold text-wine-800">{title}</p>
      <p className="mt-1 text-sm text-rose-700">{message}</p>
      {onRetry && <button type="button" onClick={onRetry} className="btn-primary mt-5">Tentar novamente</button>}
    </div>
  );
}

export function EmptyBox({ title, children, action, icon }: { title: string; children?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-wine-200 bg-white/70 p-10 text-center">
      {icon && <div className="mb-3 flex justify-center"><IconBubble size="lg">{icon}</IconBubble></div>}
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
  const Icon = tone === 'error' ? IconAlert : tone === 'success' ? IconCheckCircle : IconInfo;
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`flex items-start gap-3 rounded-xl border px-4 py-3 text-sm leading-relaxed ${style}`}>
      <Icon className="mt-0.5 h-[18px] w-[18px] shrink-0 opacity-80" />
      <div className="min-w-0">{children}</div>
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
      <div className="mb-3 flex justify-center"><IconBubble size="lg"><IconLock className="h-6 w-6" /></IconBubble></div>
      <p className="font-display text-xl font-semibold text-wine-800">Esta área não está disponível no momento</p>
      <p className="mt-2 text-sm text-ink/65">Tente novamente mais tarde.</p>
    </div>
  );
}
