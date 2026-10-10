import type { ReactNode } from 'react';

// Peças visuais compartilhadas por toda a área administrativa ("Nocturne").
// Superfícies claras com borda fina (sem sombras decorativas) e superfícies noturnas para o que
// precisa de destaque. Cores vêm dos tokens wine/gold/sage/ink/cream, redefinidos em .admin-ui.

/** Rótulo técnico em caixa alta (mono). `night` = sobre superfície escura. */
export function Eyebrow({ children, tone = 'wine' }: { children: ReactNode; tone?: 'wine' | 'gold' | 'night' }) {
  const color = tone === 'gold' ? 'text-gold-600' : tone === 'night' ? 'text-wine-300' : 'text-wine-600';
  return <p className={`font-mono text-[11px] font-medium uppercase tracking-[0.16em] ${color}`}>{children}</p>;
}

/** Superfície: `light` (padrão) ou `night` (destaque escuro). */
export function Panel({ children, className = '', tone = 'light' }: { children: ReactNode; className?: string; tone?: 'light' | 'night' }) {
  const look = tone === 'night'
    ? 'border-wine-700 bg-wine-800 text-cream'
    : 'border-wine-100 bg-white';
  return <section className={`rounded-2xl border p-5 sm:p-6 ${look} ${className}`}>{children}</section>;
}

/** Cabeçalho padrão de cada tela: trilha técnica, título forte, subtítulo e ações. */
export function PageHeader({
  eyebrow, title, subtitle, actions,
}: { eyebrow: string; title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="mb-7 flex flex-wrap items-end justify-between gap-x-8 gap-y-4 border-b border-wine-100 pb-6 sm:mb-9">
      <div className="min-w-0">
        <Eyebrow>{eyebrow}</Eyebrow>
        <h1 className="mt-2 font-display text-[1.75rem] font-semibold leading-tight text-wine-800 sm:text-[2.125rem]">{title}</h1>
        {subtitle && <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-ink/70">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2.5">{actions}</div>}
    </header>
  );
}

export function StatusDot({ tone, live = false }: { tone: 'sage' | 'wine' | 'rose' | 'amber' | 'muted' | 'signal'; live?: boolean }) {
  const color = {
    sage: 'bg-sage-500',
    wine: 'bg-wine-500',
    rose: 'bg-rose-500',
    amber: 'bg-gold-500',
    signal: 'bg-signal',
    muted: 'bg-ink/25',
  }[tone];
  return (
    <span aria-hidden="true" className="relative inline-flex h-2 w-2 shrink-0">
      {live && <span className={`absolute inset-0 rounded-full ${color} motion-safe:animate-live-ping`} />}
      <span className={`relative inline-block h-2 w-2 rounded-full ${color}`} />
    </span>
  );
}

export type BadgeTone = 'ok' | 'warn' | 'danger' | 'info' | 'muted';

/** Selo de estado: texto sempre presente (a cor nunca é a única informação). */
export function Badge({ tone, children, dot = true }: { tone: BadgeTone; children: ReactNode; dot?: boolean }) {
  const look = {
    ok: 'bg-sage-100 text-sage-700',
    warn: 'bg-gold-300/35 text-gold-700',
    danger: 'bg-rose-50 text-rose-700',
    info: 'bg-wine-50 text-wine-700',
    muted: 'bg-ink/[0.06] text-ink/70',
  }[tone];
  const dotColor = { ok: 'bg-sage-500', warn: 'bg-gold-500', danger: 'bg-rose-500', info: 'bg-wine-500', muted: 'bg-ink/30' }[tone];
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-1 text-xs font-medium leading-none ${look}`}>
      {dot && <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${dotColor}`} />}
      {children}
    </span>
  );
}

export interface SegmentedOption<T extends string> { id: T; label: string; count?: number; disabled?: boolean }

/** Controle segmentado (filtros): um grupo de botões `aria-pressed`, no lugar das "pílulas" soltas. */
export function Segmented<T extends string>({
  label, value, options, onChange,
}: { label: string; value: T; options: Array<SegmentedOption<T>>; onChange: (id: T) => void }) {
  return (
    <div role="group" aria-label={label} className="-mx-1 max-w-full overflow-x-auto px-1 py-0.5">
      <div className="inline-flex gap-0.5 rounded-xl border border-wine-100 bg-wine-50/70 p-1">
        {options.map((o) => {
          const active = value === o.id;
          return (
            <button
              key={o.id}
              type="button"
              aria-pressed={active}
              disabled={o.disabled}
              onClick={() => onChange(o.id)}
              className={`inline-flex min-h-[38px] items-center gap-2 whitespace-nowrap rounded-lg px-3.5 text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-wine-500/50 disabled:cursor-not-allowed disabled:opacity-40 ${
                active ? 'bg-white font-semibold text-wine-800 shadow-[0_0_0_1px_rgb(var(--wine-200))]' : 'font-medium text-ink/70 hover:text-wine-800'
              }`}
            >
              {o.label}
              {o.count !== undefined && (
                <span className={`font-mono text-xs tabular-nums ${active ? 'text-wine-600' : 'text-ink/55'}`}>{o.count}</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Barra fina de proporção (parte de um todo). Só é desenhada com dados reais. */
export function Meter({ value, max, tone = 'wine', label }: { value: number; max: number; tone?: 'wine' | 'signal'; label: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      className="h-1.5 w-full overflow-hidden rounded-full bg-white/10"
    >
      <div className={`h-full rounded-full ${tone === 'signal' ? 'bg-signal' : 'bg-wine-400'}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Skeleton({ className }: { className: string }) {
  return <div aria-hidden="true" className={`animate-pulse rounded-xl bg-wine-100/60 ${className}`} />;
}
