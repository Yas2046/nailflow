import { NavLink, Outlet, Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import LogoMark from './LogoMark';

// ─── ícones de navegação ──────────────────────────────────────────────────────

function IconHome() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round"
        d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
    </svg>
  );
}
function IconCalendar() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path strokeLinecap="round" d="M16 2v4M8 2v4M3 10h18" />
    </svg>
  );
}
function IconUsers() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path strokeLinecap="round" d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}
function IconScissors() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="6" cy="6" r="3" /><circle cx="6" cy="18" r="3" />
      <path strokeLinecap="round" d="M20 4 8.12 15.88M14.47 14.48 20 20M8.12 8.12 12 12" />
    </svg>
  );
}
function IconClock() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" /><path strokeLinecap="round" d="M12 7v5l3 3" />
    </svg>
  );
}
function IconUser() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="8" r="4" />
      <path strokeLinecap="round" d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
    </svg>
  );
}
function IconSettings() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}
function IconLogout() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
    </svg>
  );
}

// ─── dados da navegação ───────────────────────────────────────────────────────

const links = [
  { to: '/',                label: 'Painel',          shortLabel: 'Painel',   end: true,  icon: <IconHome /> },
  { to: '/agenda',          label: 'Agenda',           shortLabel: 'Agenda',   end: false, icon: <IconCalendar /> },
  { to: '/clientes',        label: 'Clientes',         shortLabel: 'Clientes', end: false, icon: <IconUsers /> },
  { to: '/servicos',        label: 'Serviços',         shortLabel: 'Serviços', end: false, icon: <IconScissors /> },
  { to: '/disponibilidade', label: 'Disponibilidade',  shortLabel: 'Horários', end: false, icon: <IconClock /> },
  { to: '/perfil',          label: 'Perfil',           shortLabel: 'Perfil',   end: false, icon: <IconUser /> },
  { to: '/configuracoes',   label: 'Configurações',    shortLabel: 'Config',   end: false, icon: <IconSettings /> },
];

// ─── layout ───────────────────────────────────────────────────────────────────

export default function Layout() {
  const { professional, logout } = useAuth();

  if (!professional) return <Navigate to="/login" replace />;

  const initial = (professional.name || professional.businessName || '?')[0].toUpperCase();

  return (
    <div className="min-h-screen flex flex-col md:flex-row">

      {/* ── sidebar desktop ────────────────────────────────────────────────── */}
      <aside className="hidden md:flex md:w-60 min-h-screen bg-wine-700 flex-col shrink-0">

        {/* logo */}
        <div className="px-5 pt-7 pb-5 border-b border-wine-600/40">
          <div className="flex items-center gap-2.5 text-cream">
            <LogoMark className="w-5 h-5 shrink-0" />
            <span className="font-display text-xl tracking-tight">NailFlow</span>
          </div>
          <p className="text-wine-100/55 text-xs mt-1.5 truncate leading-tight">
            {professional.businessName}
          </p>
        </div>

        {/* links */}
        <nav className="flex-1 px-3 py-4 flex flex-col gap-0.5">
          {links.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.end}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-wine-600 text-white'
                    : 'text-wine-100/75 hover:bg-wine-600/50 hover:text-white'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <span className={`shrink-0 transition-opacity ${isActive ? 'opacity-100' : 'opacity-50'}`}>
                    {link.icon}
                  </span>
                  {link.label}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        {/* rodapé: avatar + nome + sair */}
        <div className="px-4 py-4 border-t border-wine-600/40 flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-wine-500/70 text-cream flex items-center justify-center font-display text-sm font-medium shrink-0 select-none">
            {initial}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white text-xs font-medium truncate leading-tight">{professional.name}</p>
            <p className="text-wine-100/45 text-[10px] truncate leading-tight">{professional.email}</p>
          </div>
          <button
            onClick={logout}
            title="Sair da conta"
            className="shrink-0 p-1.5 rounded-lg text-wine-100/45 hover:text-white hover:bg-wine-600/50 transition-colors"
          >
            <IconLogout />
          </button>
        </div>
      </aside>

      {/* ── top bar mobile ─────────────────────────────────────────────────── */}
      <div className="md:hidden flex items-center justify-between px-4 py-3 bg-wine-700 text-cream shrink-0">
        <div className="flex items-center gap-2">
          <LogoMark className="w-5 h-5 shrink-0" />
          <span className="font-display text-lg tracking-tight">NailFlow</span>
        </div>
        <p className="text-wine-100/55 text-xs truncate max-w-[160px]">{professional.businessName}</p>
      </div>

      {/* ── conteúdo principal ─────────────────────────────────────────────── */}
      <main className="flex-1 bg-cream p-4 pb-24 md:p-10 md:pb-10">
        <Outlet />
      </main>

      {/* ── tab bar mobile (fixo no rodapé) ────────────────────────────────── */}
      <nav
        className="md:hidden fixed bottom-0 inset-x-0 bg-wine-700 border-t border-wine-600/60 flex z-40"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        {links.map((link) => (
          <NavLink
            key={link.to}
            to={link.to}
            end={link.end}
            className={({ isActive }) =>
              `flex-1 flex flex-col items-center gap-0.5 pt-2 pb-2.5 text-[10px] font-medium transition-colors ${
                isActive ? 'text-white' : 'text-wine-100/55 hover:text-wine-100'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <span className={`p-1 rounded-lg transition-colors ${isActive ? 'bg-wine-600' : ''}`}>
                  {link.icon}
                </span>
                {link.shortLabel}
              </>
            )}
          </NavLink>
        ))}
      </nav>

    </div>
  );
}
