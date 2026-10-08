import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';

export interface AccountNavItem {
  id: string;
  label: string;
  to: string;
}

// Navegação da Central da Conta: só o que existe. Uma nova página entra aqui quando for implementada.
export const ACCOUNT_NAV: AccountNavItem[] = [
  { id: 'visao-geral', label: 'Visão geral', to: '/admin/conta' },
  { id: 'perfil', label: 'Perfil', to: '/admin/conta/perfil' },
  { id: 'seguranca', label: 'Segurança', to: '/admin/conta/seguranca' },
  { id: 'atividade', label: 'Atividade', to: '/admin/conta/atividade' },
];

function SideNav() {
  const { pathname } = useLocation();
  return (
    <nav aria-label="Central da conta">
      <p className="mb-3 px-3 text-xs font-semibold uppercase tracking-[0.2em] text-ink/60">Central da conta</p>
      <ul className="space-y-0.5">
        {ACCOUNT_NAV.map((item) => {
          const active = pathname === item.to;
          return (
            <li key={item.id}>
              <Link
                to={item.to}
                aria-current={active ? 'page' : undefined}
                className={`relative flex min-h-[44px] items-center rounded-xl px-3 py-2 text-[15px] transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-wine-500/40 lg:min-h-0 ${
                  active ? 'bg-wine-50 font-semibold text-wine-800' : 'font-medium text-ink/70 hover:bg-wine-50/60 hover:text-wine-800'
                }`}
              >
                {active && <span aria-hidden="true" className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r-full bg-gold-500" />}
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function MobileNav() {
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = ACCOUNT_NAV.find((i) => i.to === pathname) ?? ACCOUNT_NAV[0];

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onDown); };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="true"
        className="flex min-h-[52px] w-full items-center justify-between gap-3 rounded-2xl border border-wine-100/80 bg-white/80 px-4 py-3 text-left shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-wine-500/40"
      >
        <span>
          <span className="block text-xs font-semibold uppercase tracking-[0.2em] text-ink/60">Central da conta</span>
          <span className="block text-base font-medium text-wine-800">{current.label}</span>
        </span>
        <svg className={`h-5 w-5 text-wine-500 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div className="absolute inset-x-0 top-full z-20 mt-2 animate-fade-in-up rounded-2xl border border-wine-100/80 bg-white p-3 shadow-[0_24px_50px_-20px_rgba(61,29,40,0.28)]" onClick={() => setOpen(false)}>
          <ul className="space-y-0.5">
            {ACCOUNT_NAV.map((item) => (
              <li key={item.id}>
                <Link
                  to={item.to}
                  aria-current={pathname === item.to ? 'page' : undefined}
                  className={`flex min-h-[44px] items-center rounded-xl px-3 text-[15px] ${pathname === item.to ? 'bg-wine-50 font-semibold text-wine-800' : 'font-medium text-ink/70'}`}
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Moldura de todas as páginas da Central da Conta: cabeçalho + navegação + conteúdo. */
export default function AccountShell({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="mx-auto max-w-[72rem]">
      <header className="mb-8 sm:mb-10">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-gold-600">Central da conta</p>
        <h1 className="mt-2 font-display text-3xl font-semibold leading-tight text-wine-800 sm:text-4xl">{title}</h1>
        <p className="mt-1.5 text-base text-ink/65">{subtitle}</p>
      </header>

      <div className="lg:grid lg:grid-cols-[12.5rem_minmax(0,1fr)] lg:gap-12 xl:gap-16">
        <div className="mb-8 lg:hidden"><MobileNav /></div>
        <aside className="hidden lg:block">
          <div className="sticky top-10"><SideNav /></div>
        </aside>
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
