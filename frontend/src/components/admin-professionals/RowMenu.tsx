import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { IconDots } from './icons';

// ── menu de ações (três pontos) ─────────────────────────────────────────────

export interface MenuItem {
  label: string;
  onSelect: () => void;
  tone?: 'default' | 'success' | 'danger';
}

export function RowMenu({
  label, items, onOpenTrigger,
}: {
  label: string;
  items: MenuItem[];
  onOpenTrigger: (el: HTMLElement | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) buttonRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    wrapRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    function onPointerDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.stopPropagation(); close(true); return; }
      if (e.key === 'Tab') { setOpen(false); return; }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      const els = Array.from(wrapRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
      if (els.length === 0) return;
      e.preventDefault();
      const idx = els.indexOf(document.activeElement as HTMLElement);
      const next = e.key === 'ArrowDown' ? (idx + 1) % els.length : (idx - 1 + els.length) % els.length;
      els[next].focus();
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);

  const toneClass = (tone: MenuItem['tone']) =>
    tone === 'danger'
      ? 'text-rose-700 hover:bg-rose-50 focus:bg-rose-50'
      : tone === 'success'
        ? 'text-sage-700 hover:bg-sage-100 focus:bg-sage-100'
        : 'text-ink/80 hover:bg-wine-50 focus:bg-wine-50';

  return (
    <div ref={wrapRef} className={`relative inline-block text-left ${open ? 'z-40' : ''}`}>
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={label}
        onClick={() => setOpen((o) => !o)}
        className="h-10 w-10 rounded-lg flex items-center justify-center text-ink/60 hover:text-wine-700 hover:bg-wine-50 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-wine-400/50"
      >
        <IconDots />
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label={label}
          className="absolute right-0 top-full z-40 mt-1 w-52 rounded-xl border border-wine-100 bg-white py-1.5 shadow-[0_18px_40px_-12px_rgba(20,17,16,0.35)]"
        >
          {items.map((item, i) => (
            <div key={item.label}>
              {item.tone === 'danger' && i > 0 && <div className="my-1 border-t border-wine-100/70" role="separator" />}
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  onOpenTrigger(buttonRef.current);
                  setOpen(false);
                  item.onSelect();
                }}
                className={`w-full text-left px-4 py-2 text-sm font-medium focus:outline-none transition-colors ${toneClass(item.tone)}`}
              >
                {item.label}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
