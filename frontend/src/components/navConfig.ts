// Configuração pura da navegação principal (sem JSX, testável em Node): quatro destinos + rotas antigas que redirecionam.
export interface NavItemConfig { to: string; label: string; end?: boolean; also?: string[] }

export const NAV_ITEMS: NavItemConfig[] = [
  { to: '/', label: 'Início', end: true, also: ['/clientes', '/retorno'] },
  { to: '/agenda', label: 'Agenda' },
  { to: '/financeiro', label: 'Financeiro' },
  { to: '/mais', label: 'Mais', also: ['/comecar', '/mensagens', '/servicos', '/configuracoes', '/suporte', '/ajuda', '/perfil', '/disponibilidade'] },
];

/** Rotas que já existiram como destinos próprios; seguem funcionando e levam ao novo lugar. */
export const LEGACY_REDIRECTS: Array<{ from: string; to: string }> = [
  { from: '/dashboard', to: '/financeiro/desempenho' },
  { from: '/gastos', to: '/financeiro/gastos' },
  { from: '/perfil', to: '/configuracoes?tab=perfil' },
  { from: '/disponibilidade', to: '/configuracoes?tab=disponibilidade' },
];

export function isNavActive(link: NavItemConfig, pathname: string): boolean {
  if (link.end ? pathname === link.to : pathname === link.to || pathname.startsWith(`${link.to}/`)) return true;
  return (link.also ?? []).some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
