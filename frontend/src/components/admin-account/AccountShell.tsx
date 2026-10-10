import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { PageHeader } from './AccountUi';

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
      <p className="mb-3 px-3 font-mono text-[11px] uppercase tracking-[0.16em] text-ink/60">Central da conta</p>
      <ul className="space-y-0.5 border-l border-wine-100">
        {ACCOUNT_NAV.map((item) => {
          const active = pathname === item.to;
          return (
            <li key={item.id}>
              <Link
                to={item.to}
                aria-current={active ? 'page' : undefined}
                className={`relative -ml-px flex min-h-[40px] items-center border-l-2 px-4 text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-wine-500/50 ${
                  active ? 'border-wine-600 font-semibold text-wine-800' : 'border-transparent font-medium text-ink/70 hover:border-wine-300 hover:text-wine-800'
                }`}
              >
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
        className="flex min-h-[52px] w-full items-center justify-between gap-3 rounded-xl border border-wine-200 bg-white px-4 py-3 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-wine-500/50"
      >
        <span>
          <span className="block font-mono text-[11px] uppercase tracking-[0.16em] text-ink/60">Central da conta</span>
          <span className="block text-[15px] font-semibold text-wine-800">{current.label}</span>
        </span>
        <svg className={`h-5 w-5 text-wine-600 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div className="absolute inset-x-0 top-full z-20 mt-2 animate-fade-in-up rounded-xl border border-wine-200 bg-white p-2 shadow-[0_18px_40px_-12px_rgba(20,17,16,0.35)]" onClick={() => setOpen(false)}>
          <ul className="space-y-0.5">
            {ACCOUNT_NAV.map((item) => (
              <li key={item.id}>
                <Link
                  to={item.to}
                  aria-current={pathname === item.to ? 'page' : undefined}
                  className={`flex min-h-[44px] items-center rounded-lg px-3 text-[15px] ${pathname === item.to ? 'bg-wine-50 font-semibold text-wine-800' : 'font-medium text-ink/75'}`}
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
  const { pathname } = useLocation();
  const section = ACCOUNT_NAV.find((i) => i.to === pathname)?.label.toLowerCase() ?? 'conta';
  return (
    <div className="mx-auto max-w-[80rem]">
      <PageHeader eyebrow={`conta / ${section}`} title={title} subtitle={subtitle} />

      <div className="lg:grid lg:grid-cols-[11.5rem_minmax(0,1fr)] lg:gap-10 xl:gap-14">
        <div className="mb-6 lg:hidden"><MobileNav /></div>
        <aside className="hidden lg:block">
          <div className="sticky top-24"><SideNav /></div>
        </aside>
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
