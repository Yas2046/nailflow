// Ícones usados só na gestão de profissionais (os compartilhados ficam em components/AdminIcons).

const iconProps = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, viewBox: '0 0 24 24', 'aria-hidden': true } as const;

export function IconMail({ className = 'w-4 h-4' }: { className?: string }) {
  return <svg className={className} {...iconProps}><path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16v12H4zM4 7l8 6 8-6" /></svg>;
}
export function IconPhone({ className = 'w-4 h-4' }: { className?: string }) {
  return <svg className={className} {...iconProps}><path strokeLinecap="round" strokeLinejoin="round" d="M5 4h3l1.5 4-2 1.2a11 11 0 0 0 5.3 5.3L14 12.5l4 1.5v3a2 2 0 0 1-2 2A13 13 0 0 1 3 6a2 2 0 0 1 2-2Z" /></svg>;
}
export function IconPlug({ className = 'w-4 h-4' }: { className?: string }) {
  return <svg className={className} {...iconProps}><path strokeLinecap="round" strokeLinejoin="round" d="M9 3v4M15 3v4M7 7h10v4a5 5 0 0 1-10 0V7ZM12 16v5" /></svg>;
}
export function IconCalendar({ className = 'w-4 h-4' }: { className?: string }) {
  return <svg className={className} {...iconProps}><rect x="3.5" y="5" width="17" height="15" rx="2" /><path strokeLinecap="round" d="M3.5 10h17M8 3v4M16 3v4" /></svg>;
}
export function IconSearch({ className = 'w-4 h-4' }: { className?: string }) {
  return <svg className={className} {...iconProps}><circle cx="11" cy="11" r="6.5" /><path strokeLinecap="round" d="m20 20-4-4" /></svg>;
}
export function IconDots() {
  return (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="5" cy="12" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="19" cy="12" r="1.7" />
    </svg>
  );
}
