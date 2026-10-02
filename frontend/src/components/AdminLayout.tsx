import { Outlet, Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import LogoMark from './LogoMark';

function IconLogout() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
    </svg>
  );
}

export default function AdminLayout() {
  const { professional, logout } = useAuth();

  if (!professional) return <Navigate to="/login" replace />;
  if (!professional.isAdmin) return <Navigate to="/" replace />;

  return (
    <div className="min-h-screen bg-cream flex flex-col">

      {/* ── header ─────────────────────────────────────────────────────────── */}
      <header className="bg-wine-700 px-6 py-4 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3 text-cream">
          <LogoMark className="w-5 h-5 shrink-0" />
          <span className="font-display text-xl tracking-tight font-semibold">NailFlow</span>
          <span className="hidden sm:inline-flex items-center rounded-full bg-white/15 px-2.5 py-0.5 text-xs font-medium text-cream/90 ml-1">
            Administração
          </span>
        </div>

        <div className="flex items-center gap-3">
          <div className="text-right hidden sm:block">
            <p className="text-white text-xs font-medium leading-tight">{professional.name}</p>
            <p className="text-wine-100/50 text-[10px] leading-tight">{professional.email}</p>
          </div>
          <button
            onClick={logout}
            title="Sair da conta"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-wine-100/70 hover:text-white hover:bg-white/10 transition-colors text-sm"
          >
            <IconLogout />
            <span className="hidden sm:inline">Sair</span>
          </button>
        </div>
      </header>

      {/* ── conteúdo ───────────────────────────────────────────────────────── */}
      <main className="flex-1 p-4 md:p-10">
        <Outlet />
      </main>

    </div>
  );
}
