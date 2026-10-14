import type { SVGProps } from 'react';
import type { SupportCategory } from '../../services/support';

// Ícones de linha da Central de Suporte (traço de 1.6, `currentColor`), no mesmo estilo dos ícones do admin.
// Decorativos: o texto ao lado sempre diz o mesmo, então são `aria-hidden`.

type P = { className?: string };
const base: SVGProps<SVGSVGElement> = {
  viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true,
};
const cls = (c?: string) => c ?? 'h-5 w-5';

export const IconLifebuoy = ({ className }: P) => (
  <svg {...base} className={cls(className)}><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="3.2" /><path d="m6 6 3.8 3.8M18 6l-3.8 3.8M6 18l3.8-3.8M18 18l-3.8-3.8" /></svg>
);
export const IconChat = ({ className }: P) => (
  <svg {...base} className={cls(className)}><path d="M20 12a8 8 0 0 1-11.6 7.1L4 20l1-3.9A8 8 0 1 1 20 12Z" /><path d="M8.5 11h7M8.5 14h4" /></svg>
);
export const IconPencil = ({ className }: P) => (
  <svg {...base} className={cls(className)}><path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3Z" /><path d="m14.5 7.5 3 3" /></svg>
);
export const IconInbox = ({ className }: P) => (
  <svg {...base} className={cls(className)}><path d="M4 13.5 6.2 6.6A2 2 0 0 1 8.1 5h7.8a2 2 0 0 1 1.9 1.6L20 13.5" /><path d="M4 13.5V18a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4.5h-4.2a1 1 0 0 0-.9.6 3.3 3.3 0 0 1-5.8 0 1 1 0 0 0-.9-.6H4Z" /></svg>
);
export const IconSearch = ({ className }: P) => (
  <svg {...base} className={cls(className)}><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></svg>
);
export const IconArrowRight = ({ className }: P) => (
  <svg {...base} className={cls(className)}><path d="M5 12h14M13 6l6 6-6 6" /></svg>
);
export const IconChevronDown = ({ className }: P) => (
  <svg {...base} className={cls(className)}><path d="m6 9 6 6 6-6" /></svg>
);
export const IconCheckCircle = ({ className }: P) => (
  <svg {...base} className={cls(className)}><circle cx="12" cy="12" r="8.5" /><path d="m8.5 12.3 2.4 2.4 4.6-5" /></svg>
);
export const IconAlert = ({ className }: P) => (
  <svg {...base} className={cls(className)}><path d="M12 4 3.5 19h17L12 4Z" /><path d="M12 10v4M12 16.8v.2" /></svg>
);
export const IconInfo = ({ className }: P) => (
  <svg {...base} className={cls(className)}><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5M12 8v.2" /></svg>
);
export const IconLock = ({ className }: P) => (
  <svg {...base} className={cls(className)}><rect x="5" y="10.5" width="14" height="9.5" rx="2" /><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" /></svg>
);
export const IconBook = ({ className }: P) => (
  <svg {...base} className={cls(className)}><path d="M5 5.5A1.5 1.5 0 0 1 6.5 4H19v14H6.5A1.5 1.5 0 0 0 5 19.5v-14Z" /><path d="M5 19.5A1.5 1.5 0 0 0 6.5 21H19v-3" /></svg>
);
export const IconClock = ({ className }: P) => (
  <svg {...base} className={cls(className)}><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></svg>
);
export const IconFilter = ({ className }: P) => (
  <svg {...base} className={cls(className)}><path d="M4 6h16M7 12h10M10 18h4" /></svg>
);
export const IconUser = ({ className }: P) => (
  <svg {...base} className={cls(className)}><circle cx="12" cy="8.5" r="3.5" /><path d="M5 20a7 7 0 0 1 14 0" /></svg>
);

// Categorias (mesmos slugs do backend)
const IconCalendar = ({ className }: P) => (
  <svg {...base} className={cls(className)}><rect x="4" y="5.5" width="16" height="14.5" rx="2.5" /><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4" /></svg>
);
const IconUsers = ({ className }: P) => (
  <svg {...base} className={cls(className)}><circle cx="9" cy="9" r="3.2" /><path d="M3 19a6 6 0 0 1 12 0" /><path d="M16 6.2a3 3 0 0 1 0 5.6M18 19a5.6 5.6 0 0 0-2.4-4.6" /></svg>
);
const IconSliders = ({ className }: P) => (
  <svg {...base} className={cls(className)}><path d="M5 7h9M18 7h1M5 17h1M10 17h9" /><circle cx="16" cy="7" r="2" /><circle cx="8" cy="17" r="2" /></svg>
);
const IconShield = ({ className }: P) => (
  <svg {...base} className={cls(className)}><path d="M12 3.5 5 6v5.5c0 4 2.8 7 7 9 4.2-2 7-5 7-9V6l-7-2.5Z" /><path d="m9.3 12 2 2 3.6-3.8" /></svg>
);
const IconWallet = ({ className }: P) => (
  <svg {...base} className={cls(className)}><rect x="3.5" y="6" width="17" height="13" rx="2.5" /><path d="M3.5 10h17M16 14.5h1.5" /></svg>
);
const IconWrench = ({ className }: P) => (
  <svg {...base} className={cls(className)}><path d="M14.5 6.5a4 4 0 0 0 4.8 4.8L9 21.6a2 2 0 0 1-2.8-2.8l10.3-10.3" /><path d="M14.5 6.5 17 4l2.5 2.5-2.5 2.5" /></svg>
);

const CATEGORY_ICONS: Record<SupportCategory, (p: P) => JSX.Element> = {
  agenda: IconCalendar,
  clientes: IconUsers,
  servicos_config: IconSliders,
  perfil_acesso: IconShield,
  financeiro: IconWallet,
  tecnico: IconWrench,
};

export function CategoryIcon({ category, className }: { category: SupportCategory | string; className?: string }) {
  const Icon = CATEGORY_ICONS[category as SupportCategory] ?? IconLifebuoy;
  return <Icon className={className} />;
}
