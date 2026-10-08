import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

/** Rótulo pequeno em caixa alta, usado no topo de cada seção da Central da Conta. */
export function Eyebrow({ children, tone = 'wine' }: { children: ReactNode; tone?: 'wine' | 'gold' }) {
  return (
    <p className={`text-xs font-semibold uppercase tracking-[0.2em] ${tone === 'gold' ? 'text-gold-600' : 'text-wine-500'}`}>
      {children}
    </p>
  );
}

/** Superfície suave: cartão discreto, com sombra muito leve. Usar com moderação. */
export function Panel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <section
      className={`rounded-3xl border border-wine-100/70 bg-white/80 p-6 sm:p-8 shadow-[0_1px_2px_rgba(61,29,40,0.03),0_16px_40px_-24px_rgba(61,29,40,0.16)] transition-[border-color,box-shadow,transform] duration-300 hover:border-wine-200/80 hover:shadow-[0_1px_2px_rgba(61,29,40,0.04),0_22px_48px_-24px_rgba(61,29,40,0.22)] motion-safe:hover:-translate-y-0.5 ${className}`}
    >
      {children}
    </section>
  );
}

export function StatusDot({ tone }: { tone: 'sage' | 'wine' | 'rose' | 'muted' }) {
  const color = {
    sage: 'bg-sage-500 shadow-[0_0_0_4px_rgba(110,143,115,0.18)]',
    wine: 'bg-wine-500 shadow-[0_0_0_4px_rgba(140,74,94,0.12)]',
    rose: 'bg-rose-500 shadow-[0_0_0_4px_rgba(244,63,94,0.12)]',
    muted: 'bg-ink/20',
  }[tone];
  return <span aria-hidden="true" className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${color}`} />;
}

export function Skeleton({ className }: { className: string }) {
  return <div aria-hidden="true" className={`animate-pulse rounded-2xl bg-wine-100/50 ${className}`} />;
}

/**
 * Link para uma página da Central da Conta que ainda pode não existir.
 * Quando `available` é falso, nada clicável é renderizado.
 */
export function ContaLink({ to, available, children, className = '' }: { to: string; available: boolean; children: ReactNode; className?: string }) {
  if (!available) return null;
  return <Link to={to} className={className}>{children}</Link>;
}

/** Ação ainda não implementada: aparece desativada, sem levar a lugar nenhum. */
export function SoonButton({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-3 whitespace-nowrap">
      <button type="button" disabled title="Disponível em breve" className="btn-secondary min-h-[46px] cursor-not-allowed whitespace-nowrap px-6 opacity-45">
        {children}
      </button>
      <span className="text-xs tracking-wide text-ink/30">em breve</span>
    </span>
  );
}
