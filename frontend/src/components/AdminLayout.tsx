import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Outlet, Navigate, NavLink, Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';
import type { AdminShellContext } from './adminShell';
import { IconClipboard, IconHome, IconLogout, IconUser, IconUsers } from './AdminIcons';
import { StatusDot } from './admin-account/AccountUi';
import LogoMark from './LogoMark';

interface NavItem { to: string; label: string; short: string; icon: ReactNode; end: boolean }

// Duas áreas: gestão da plataforma e a conta de quem administra.
const NAV_GROUPS: Array<{ title: string; items: NavItem[] }> = [
  {
    title: 'Gestão',
    items: [
      { to: '/admin', label: 'Visão geral', short: 'Visão geral', icon: <IconHome />, end: true },
      { to: '/admin/profissionais', label: 'Profissionais', short: 'Profissionais', icon: <IconUsers />, end: false },
      { to: '/admin/auditoria', label: 'Auditoria', short: 'Auditoria', icon: <IconClipboard />, end: false },
    ],
  },
  {
    title: 'Minha conta',
    items: [{ to: '/admin/conta', label: 'Central da conta', short: 'Conta', icon: <IconUser />, end: false }],
  },
];
const ALL_ITEMS = NAV_GROUPS.flatMap((g) => g.items);

const focusRing = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-wine-400';

// Trilha da barra superior, derivada da rota (nenhum dado novo).
const CRUMBS: Array<[string, string[]]> = [
  ['/admin/conta/perfil', ['Conta', 'Perfil']],
  ['/admin/conta/seguranca', ['Conta', 'Segurança']],
  ['/admin/conta/atividade', ['Conta', 'Atividade']],
  ['/admin/conta', ['Conta', 'Visão geral']],
  ['/admin/profissionais', ['Gestão', 'Profissionais']],
  ['/admin/auditoria', ['Gestão', 'Auditoria']],
  ['/admin', ['Gestão', 'Visão geral']],
];
const crumbsFor = (pathname: string) => CRUMBS.find(([p]) => pathname === p || pathname.startsWith(`${p}/`))?.[1] ?? ['Gestão'];

type ApiStatus = { state: 'checking' } | { state: 'up'; ms: number } | { state: 'down' };

/** Estado real da API (GET /health), medido no navegador ao abrir e a cada minuto. */
function useApiStatus(enabled: boolean): ApiStatus {
  const [status, setStatus] = useState<ApiStatus>({ state: 'checking' });
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    async function ping() {
      const t0 = performance.now();
      try {
        await api.get('/health');
        if (alive) setStatus({ state: 'up', ms: Math.round(performance.now() - t0) });
      } catch {
        if (alive) setStatus({ state: 'down' });
      }
    }
    void ping();
    const timer = window.setInterval(ping, 60_000);
    return () => { alive = false; window.clearInterval(timer); };
  }, [enabled]);
  return status;
}

export default function AdminLayout() {
  const { professional, logout } = useAuth();
  const { pathname } = useLocation();
  const mainRef = useRef<HTMLElement>(null);
  const firstRender = useRef(true);
  const apiStatus = useApiStatus(!!professional?.isAdmin);

  // foto da administradora no menu (dado real de GET /auth/me; sem foto, aparecem as iniciais)
  const [avatar, setAvatar] = useState<string | null>(null);
  useEffect(() => {
    if (!professional?.isAdmin) return;
    api.get<{ avatar_b64: string | null }>('/auth/me').then((me) => setAvatar(me.avatar_b64 ?? null)).catch(() => {});
  }, [professional?.id, professional?.isAdmin]);

  // Ao trocar de tela, o foco vai para o conteúdo: leitores de tela e teclado não ficam presos no menu.
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    mainRef.current?.focus({ preventScroll: true });
  }, [pathname]);

  if (!professional) return <Navigate to="/login" replace />;
  if (!professional.isAdmin) return <Navigate to="/" replace />;

  const initial = (professional.name?.trim()[0] ?? 'A').toUpperCase();
  const crumbs = crumbsFor(pathname);

  const avatarBubble = (size: string) => (
    <span className={`${size} flex shrink-0 items-center justify-center overflow-hidden rounded-lg bg-wine-600 font-display text-sm font-semibold text-white`} aria-hidden="true">
      {avatar ? <img src={avatar} alt="" className="h-full w-full object-cover" /> : initial}
    </span>
  );

  const brand = (
    <>
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-night-800 text-gold-400">
        <LogoMark className="h-[18px] w-[18px]" />
      </span>
      <span className="flex items-center gap-2">
        <span className="font-display text-lg font-semibold leading-none tracking-tight text-white">NailFlow</span>
        <span className="rounded border border-gold-400/50 px-1.5 py-0.5 font-mono text-[10px] font-medium uppercase leading-none tracking-wider text-gold-300">admin</span>
      </span>
    </>
  );

  return (
    <div className="admin-ui min-h-screen bg-cream text-ink lg:flex">
      <a
        href="#conteudo"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-wine-600 focus:px-4 focus:py-2.5 focus:text-sm focus:font-semibold focus:text-white focus:outline-none focus:ring-2 focus:ring-white"
      >
        Pular para o conteúdo
      </a>

      {/* ── barra lateral (desktop) ──────────────────────────────────────── */}
      <aside className="z-30 hidden flex-col border-r border-white/5 bg-night-950 text-cream lg:fixed lg:inset-y-0 lg:flex lg:w-64">
        <div className="px-5 pb-6 pt-6">
          <Link to="/admin" aria-label="NailFlow Administração: ir para a visão geral" className={`flex items-center gap-3 rounded-lg ${focusRing}`}>
            {brand}
          </Link>
        </div>

        <nav aria-label="Navegação administrativa" className="flex-1 space-y-7 overflow-y-auto px-3 py-2">
          {NAV_GROUPS.map((group) => (
            <div key={group.title}>
              <p className="mb-2 px-3 font-mono text-[10.5px] uppercase tracking-[0.18em] text-[#8F847D]">{group.title}</p>
              <ul className="space-y-0.5">
                {group.items.map((item) => (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      end={item.end}
                      className={({ isActive }) =>
                        `relative flex min-h-[42px] items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors ${focusRing} ${
                          isActive ? 'bg-wine-600/45 text-white' : 'text-[#BDB3AC] hover:bg-white/[0.05] hover:text-white'
                        }`
                      }
                    >
                      {({ isActive }) => (
                        <>
                          {isActive && <span className="absolute -left-3 top-2 bottom-2 w-[3px] rounded-r bg-gold-400" aria-hidden="true" />}
                          <span className={isActive ? 'text-gold-300' : 'text-[#8F847D]'}>{item.icon}</span>
                          {item.label}
                        </>
                      )}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <div className="m-3 flex items-center gap-3 rounded-xl border border-white/10 bg-night-900 p-3">
          <Link to="/admin/conta" aria-label={`Central da conta de ${professional.name}`} className={`flex min-w-0 flex-1 items-center gap-3 rounded-lg ${focusRing}`}>
            {avatarBubble('h-9 w-9')}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium leading-tight text-white">{professional.name}</span>
              <span className="mt-0.5 block truncate text-xs leading-tight text-[#A0958E]">{professional.email}</span>
            </span>
          </Link>
          <button
            type="button"
            onClick={logout}
            title="Sair da conta"
            aria-label="Sair da conta"
            className={`shrink-0 rounded-lg p-2.5 text-[#A0958E] transition-colors hover:bg-white/10 hover:text-white ${focusRing}`}
          >
            <IconLogout />
          </button>
        </div>
      </aside>

      {/* ── barra superior (celular e tablet): marca, conta e sair ───────── */}
      <header className="sticky top-0 z-30 border-b border-white/5 bg-night-950 text-cream lg:hidden">
        <div className="flex items-center justify-between gap-3 px-4 py-2.5 sm:px-6">
          <Link to="/admin" aria-label="NailFlow Administração: ir para a visão geral" className={`flex min-w-0 items-center gap-3 rounded-lg ${focusRing}`}>
            {brand}
          </Link>
          <div className="flex shrink-0 items-center gap-1">
            <Link to="/admin/conta" aria-label={`Central da conta de ${professional.name}`} className={`flex h-11 w-11 items-center justify-center rounded-lg ${focusRing}`}>
              {avatarBubble('h-8 w-8')}
            </Link>
            <button
              type="button"
              onClick={logout}
              title="Sair da conta"
              aria-label="Sair da conta"
              className={`flex h-11 w-11 items-center justify-center rounded-lg text-[#BDB3AC] transition-colors hover:bg-white/10 hover:text-white ${focusRing}`}
            >
              <IconLogout />
            </button>
          </div>
        </div>
      </header>

      {/* ── conteúdo ─────────────────────────────────────────────────────── */}
      <div className="min-w-0 flex-1 lg:pl-64">
        {/* barra de contexto (desktop): onde estou + estado real da API */}
        <div className="sticky top-0 z-20 hidden h-14 items-center justify-between gap-6 border-b border-wine-100 bg-cream/90 px-8 backdrop-blur lg:flex xl:px-12">
          <nav aria-label="Você está em" className="flex items-center gap-2 font-mono text-xs text-ink/65">
            <span>admin</span>
            {crumbs.map((c, i) => (
              <span key={c} className="flex items-center gap-2">
                <span aria-hidden="true" className="text-ink/30">/</span>
                <span aria-current={i === crumbs.length - 1 ? 'page' : undefined} className={i === crumbs.length - 1 ? 'font-medium text-wine-800' : ''}>{c.toLowerCase()}</span>
              </span>
            ))}
          </nav>
          <p role="status" className="flex items-center gap-2.5 font-mono text-xs text-ink/70">
            {apiStatus.state === 'up' && (<><StatusDot tone="sage" live />api online<span className="tabular-nums text-ink/50">{apiStatus.ms} ms</span></>)}
            {apiStatus.state === 'down' && (<><StatusDot tone="rose" />api sem resposta</>)}
            {apiStatus.state === 'checking' && (<><StatusDot tone="muted" />verificando api…</>)}
          </p>
        </div>

        <main
          id="conteudo"
          ref={mainRef}
          tabIndex={-1}
          className="relative px-4 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-7 focus:outline-none sm:px-8 sm:pt-9 lg:pb-14 xl:px-12"
        >
          <Outlet context={{ setAvatar } satisfies AdminShellContext} />
        </main>
      </div>

      {/* ── navegação inferior (celular e tablet): ao alcance do polegar ──── */}
      <nav
        aria-label="Navegação administrativa"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-white/10 bg-night-950/95 pb-[env(safe-area-inset-bottom)] text-cream backdrop-blur lg:hidden"
      >
        <ul className="mx-auto grid max-w-lg grid-cols-4 px-2">
          {ALL_ITEMS.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `relative flex min-h-[62px] flex-col items-center justify-center gap-1 rounded-lg px-1 text-[11px] font-medium transition-colors ${focusRing} ${
                    isActive ? 'text-white' : 'text-[#A0958E] hover:text-white'
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    {isActive && <span className="absolute inset-x-6 top-0 h-[3px] rounded-b bg-gold-400" aria-hidden="true" />}
                    <span className={isActive ? 'text-gold-300' : ''}>{item.icon}</span>
                    {item.short}
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
