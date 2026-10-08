// Ícones usados em mais de uma tela do ADM (antes cada tela redefinia os seus).
// Traço de 1.7 (2 para o "tick"), tamanho pela prop `className`.

const base = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, viewBox: '0 0 24 24', 'aria-hidden': true } as const;

type P = { className?: string };

export function IconUser({ className = 'h-5 w-5' }: P) {
  return <svg {...base} className={className}><path strokeLinecap="round" strokeLinejoin="round" d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4.5 20a7.5 7.5 0 0 1 15 0" /></svg>;
}

export function IconUsers({ className = 'h-5 w-5' }: P) {
  return <svg {...base} className={className}><path strokeLinecap="round" strokeLinejoin="round" d="M16 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 18.5V20M10 12a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM20 20v-1.5a3.5 3.5 0 0 0-2.5-3.35M15.5 5.2a3.5 3.5 0 0 1 0 6.6" /></svg>;
}

export function IconClipboard({ className = 'h-5 w-5' }: P) {
  return <svg {...base} className={className}><path strokeLinecap="round" strokeLinejoin="round" d="M9 4h6a1 1 0 0 1 1 1v1H8V5a1 1 0 0 1 1-1ZM8 6H6.5A1.5 1.5 0 0 0 5 7.5v12A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5v-12A1.5 1.5 0 0 0 17.5 6H16M9 12h6M9 16h4" /></svg>;
}

export function IconHome({ className = 'h-5 w-5' }: P) {
  return <svg {...base} className={className}><rect x="4" y="4" width="7" height="8" rx="1.5" /><rect x="13" y="4" width="7" height="5" rx="1.5" /><rect x="13" y="11" width="7" height="9" rx="1.5" /><rect x="4" y="14" width="7" height="6" rx="1.5" /></svg>;
}

export function IconLogout({ className = 'h-[18px] w-[18px]' }: P) {
  return <svg {...base} className={className}><path strokeLinecap="round" strokeLinejoin="round" d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" /></svg>;
}

export function IconClock({ className = 'h-5 w-5' }: P) {
  return <svg {...base} className={className}><circle cx="12" cy="12" r="9" /><path strokeLinecap="round" d="M12 7.5V12l3 2" /></svg>;
}

export function IconArrow({ className = 'h-4 w-4' }: P) {
  return <svg {...base} strokeWidth={1.8} className={`${className} shrink-0 transition-transform duration-300 group-hover:translate-x-1`}><path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14m-5-5 5 5-5 5" /></svg>;
}

/** Marca de verificação simples (sem círculo). */
export function IconTick({ className = 'h-3 w-3' }: P) {
  return <svg {...base} strokeWidth={2.2} className={className}><path strokeLinecap="round" strokeLinejoin="round" d="m5 12.5 4.5 4.5L19 7.5" /></svg>;
}

export function IconRefresh({ className = 'h-4 w-4' }: P) {
  return <svg {...base} className={className}><path strokeLinecap="round" strokeLinejoin="round" d="M20 11a8 8 0 0 0-14.3-4.3L4 8.5M4 4v4.5h4.5M4 13a8 8 0 0 0 14.3 4.3L20 15.5M20 20v-4.5h-4.5" /></svg>;
}

export function IconBan({ className = 'h-5 w-5' }: P) {
  return <svg {...base} className={className}><circle cx="12" cy="12" r="8.5" /><path strokeLinecap="round" d="m6 6 12 12" /></svg>;
}

export function IconCheckCircle({ className = 'h-5 w-5' }: P) {
  return <svg {...base} className={className}><circle cx="12" cy="12" r="8.5" /><path strokeLinecap="round" strokeLinejoin="round" d="m8.5 12.3 2.4 2.4 4.6-5" /></svg>;
}
