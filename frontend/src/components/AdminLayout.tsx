import { useEffect, useState, type ReactNode } from 'react';
import { Outlet, Navigate, NavLink, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';
import type { AdminShellContext } from './adminShell';
import { IconClipboard, IconHome, IconLogout, IconUser, IconUsers } from './AdminIcons';
import LogoMark from './LogoMark';

const NAV: Array<{ to: string; label: string; short?: string; icon: ReactNode; end?: boolean }> = [
  { to: '/admin', label: 'Visão geral', icon: <IconHome />, end: true },
  { to: '/admin/profissionais', label: 'Profissionais', icon: <IconUsers /> },
  { to: '/admin/auditoria', label: 'Auditoria', icon: <IconClipboard /> },
  { to: '/admin/conta', label: 'Central da conta', short: 'Conta', icon: <IconUser />, end: false },
];

export default function AdminLayout() {
  const { professional, logout } = useAuth();
  // foto da administradora no menu (dado real de GET /auth/me; sem foto, aparecem as iniciais)
  const [avatar, setAvatar] = useState<string | null>(null);
  useEffect(() => {
    if (!professional?.isAdmin) return;
    api.get<{ avatar_b64: string | null }>('/auth/me').then((me) => setAvatar(me.avatar_b64 ?? null)).catch(() => {});
  }, [professional?.id, professional?.isAdmin]);

  if (!professional) return <Navigate to="/login" replace />;
  if (!professional.isAdmin) return <Navigate to="/" replace />;

  const initial = (professional.name?.trim()[0] ?? 'A').toUpperCase();

  return (
    <div className="min-h-screen bg-cream lg:flex">

      {/* ── barra lateral (desktop) ──────────────────────────────────────── */}
      <aside className="hidden lg:flex lg:w-64 lg:fixed lg:inset-y-0 flex-col bg-gradient-to-b from-wine-800 to-wine-700 text-cream z-30">
        <div className="px-6 pt-8 pb-7">
          <div className="flex items-center gap-2.5">
            <span className="w-9 h-9 rounded-xl bg-white/10 ring-1 ring-gold-400/40 flex items-center justify-center text-gold-400">
              <LogoMark className="w-[18px] h-[18px]" />
            </span>
            <div>
              <p className="font-display text-xl tracking-tight font-semibold leading-none">NailFlow</p>
              <p className="text-xs uppercase tracking-[0.22em] text-gold-300/90 mt-1.5">Administração</p>
            </div>
          </div>
        </div>

        <div className="mx-6 h-px bg-gradient-to-r from-gold-400/50 via-white/10 to-transparent" aria-hidden="true" />

        <nav aria-label="Navegação administrativa" className="flex-1 px-4 py-6 space-y-1">
          <p className="px-3 mb-2 text-xs uppercase tracking-[0.2em] text-wine-100/40">Gestão</p>
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end ?? true}
              className={({ isActive }) =>
                `relative flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-400/60 ${
                  isActive ? 'bg-white/12 text-white' : 'text-wine-100/70 hover:bg-white/10 hover:text-white'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-r-full bg-gold-400" aria-hidden="true" />}
                  {item.icon}
                  {item.label}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="m-4 rounded-2xl bg-white/5 ring-1 ring-white/10 p-3.5 flex items-center gap-3">
          <Link to="/admin/conta" aria-label="Central da conta" className="flex items-center gap-3 min-w-0 flex-1 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-400/60">
            <span className="w-9 h-9 rounded-full bg-gold-300/25 ring-1 ring-gold-400/40 text-gold-300 flex items-center justify-center font-display text-sm shrink-0 overflow-hidden" aria-hidden="true">
              {avatar ? <img src={avatar} alt="" className="h-full w-full object-cover" /> : initial}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-white truncate leading-tight">{professional.name}</p>
              <p className="text-xs text-wine-100/50 truncate leading-tight mt-0.5">{professional.email}</p>
            </div>
          </Link>
          <button
            onClick={logout}
            title="Sair da conta"
            aria-label="Sair da conta"
            className="shrink-0 p-2 rounded-lg text-wine-100/60 hover:text-white hover:bg-white/10 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-400/60"
          >
            <IconLogout />
          </button>
        </div>
      </aside>

      {/* ── barra superior + abas (mobile e tablet) ──────────────────────── */}
      <div className="lg:hidden sticky top-0 z-30 bg-gradient-to-r from-wine-800 to-wine-700 text-cream border-b border-gold-500/50">
        <div className="px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="w-8 h-8 rounded-lg bg-white/10 ring-1 ring-gold-400/40 flex items-center justify-center text-gold-400 shrink-0">
              <LogoMark className="w-4 h-4" />
            </span>
            <div className="min-w-0">
              <p className="font-display text-lg tracking-tight font-semibold leading-none">NailFlow</p>
              <p className="text-xs uppercase tracking-[0.2em] text-gold-300/90 mt-1">Administração</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Link to="/admin/conta" aria-label="Central da conta" className="w-8 h-8 rounded-full bg-gold-300/25 ring-1 ring-gold-400/40 text-gold-300 flex items-center justify-center font-display text-sm overflow-hidden focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-400/60">
              {avatar ? <img src={avatar} alt="" className="h-full w-full object-cover" /> : initial}
            </Link>
            <button
              onClick={logout}
              title="Sair da conta"
              aria-label="Sair da conta"
              className="p-2 rounded-lg text-wine-100/70 hover:text-white hover:bg-white/10 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-400/60"
            >
              <IconLogout />
            </button>
          </div>
        </div>
        <nav aria-label="Navegação administrativa" className="px-4 sm:px-6 pb-2.5 flex gap-1.5 sm:gap-2 overflow-x-auto">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end ?? true}
              className={({ isActive }) =>
                `flex-1 shrink-0 sm:flex-none inline-flex items-center justify-center gap-2 px-2.5 sm:px-4 py-2 rounded-xl text-[13px] sm:text-sm font-medium whitespace-nowrap transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-400/60 ${
                  isActive ? 'bg-white/15 text-white ring-1 ring-gold-400/40' : 'text-wine-100/70 hover:bg-white/10 hover:text-white'
                }`
              }
            >
              <span className="hidden min-[430px]:inline-flex">{item.icon}</span>
              {item.short ? (<><span className="sm:hidden">{item.short}</span><span className="hidden sm:inline">{item.label}</span></>) : item.label}
            </NavLink>
          ))}
        </nav>
      </div>

      {/* ── conteúdo ─────────────────────────────────────────────────────── */}
      <main className="relative flex-1 lg:pl-64 min-w-0">
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-[28rem] bg-[radial-gradient(48rem_22rem_at_88%_-8%,rgba(199,154,69,0.14),transparent),radial-gradient(40rem_24rem_at_-6%_4%,rgba(140,74,94,0.09),transparent)]"
          aria-hidden="true"
        />
        <div className="relative px-4 sm:px-8 xl:px-12 py-8 sm:py-10">
          <Outlet context={{ setAvatar } satisfies AdminShellContext} />
        </div>
      </main>

    </div>
  );
}
