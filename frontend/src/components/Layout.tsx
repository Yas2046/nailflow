import { NavLink, Outlet, Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const links = [
  { to: '/',                label: 'Painel',          end: true  },
  { to: '/agenda',          label: 'Agenda',           end: false },
  { to: '/clientes',        label: 'Clientes',         end: false },
  { to: '/servicos',        label: 'Serviços',         end: false },
  { to: '/disponibilidade', label: 'Disponibilidade',  end: false },
  { to: '/perfil',          label: 'Perfil',           end: false },
];

export default function Layout() {
  const { professional, logout } = useAuth();

  if (!professional) return <Navigate to="/login" replace />;

  const navClass = ({ isActive }: { isActive: boolean }) =>
    `px-3 py-2 rounded-md text-sm transition-colors ${
      isActive ? 'bg-wine-600 text-white' : 'text-wine-100 hover:bg-wine-600/60'
    }`;

  return (
    <div className="min-h-screen flex flex-col md:flex-row">

      {/* ── sidebar desktop ────────────────────────────────────────────────── */}
      <aside className="md:w-64 md:min-h-screen bg-wine-700 text-cream flex md:flex-col justify-between">
        <div className="p-6">
          <div className="font-display text-2xl tracking-tight mb-1">NailFlow</div>
          <div className="text-wine-100 text-sm mb-8">{professional.businessName}</div>
          <nav className="hidden md:flex flex-col gap-1">
            {links.map((link) => (
              <NavLink key={link.to} to={link.to} end={link.end} className={navClass}>
                {link.label}
              </NavLink>
            ))}
          </nav>
        </div>
        <div className="p-6 hidden md:block">
          <button
            onClick={logout}
            className="text-sm text-wine-100 hover:text-white focus-ring"
          >
            Sair
          </button>
        </div>
      </aside>

      {/* ── nav mobile ─────────────────────────────────────────────────────── */}
      <div className="md:hidden flex bg-wine-700 text-wine-100">
        <nav className="flex overflow-x-auto flex-1 px-2">
          {links.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.end}
              className={({ isActive }) =>
                `px-3 py-3 text-sm whitespace-nowrap ${isActive ? 'text-white border-b-2 border-gold-400' : ''}`
              }
            >
              {link.label}
            </NavLink>
          ))}
        </nav>
        <button
          onClick={logout}
          className="shrink-0 px-4 py-3 text-sm border-l border-wine-600 hover:bg-wine-600/50"
        >
          Sair
        </button>
      </div>

      <main className="flex-1 bg-cream p-4 md:p-10">
        <Outlet />
      </main>
    </div>
  );
}
