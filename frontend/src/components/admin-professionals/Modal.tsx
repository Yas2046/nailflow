import { useEffect, useRef } from 'react';
import type { ReactNode, RefObject } from 'react';

// ── diálogo acessível ───────────────────────────────────────────────────────

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface ModalProps {
  titleId: string;
  onClose: () => void;
  busy?: boolean;                       // enquanto true, Esc e clique fora não fecham
  focusKey?: string | number;           // muda → o foco volta ao primeiro controle (ex.: troca de etapa)
  returnFocusRef?: RefObject<HTMLElement | null>;
  children: ReactNode;
}

export function Modal({ titleId, onClose, busy = false, focusKey, returnFocusRef, children }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const busyRef = useRef(busy);
  const onCloseRef = useRef(onClose);
  busyRef.current = busy;
  onCloseRef.current = onClose;

  // trava a rolagem da página e devolve o foco a quem abriu o diálogo
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const returnTo = returnFocusRef?.current ?? (document.activeElement as HTMLElement | null);
    return () => {
      document.body.style.overflow = previous;
      if (returnTo && returnTo.isConnected) returnTo.focus();
    };
  }, [returnFocusRef]);

  // foco inicial (e a cada troca de etapa)
  useEffect(() => {
    const preferred = panelRef.current?.querySelector<HTMLElement>('[data-autofocus]');
    const first = preferred ?? panelRef.current?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panelRef.current)?.focus();
  }, [focusKey]);

  // Esc fecha; Tab fica preso dentro do diálogo
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (!busyRef.current) { e.stopPropagation(); onCloseRef.current(); }
        return;
      }
      if (e.key !== 'Tab' || !panelRef.current) return;
      const items = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) { e.preventDefault(); return; }
      const firstEl = items[0];
      const lastEl = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === firstEl || !panelRef.current.contains(active))) {
        e.preventDefault(); lastEl.focus();
      } else if (!e.shiftKey && (active === lastEl || !panelRef.current.contains(active))) {
        e.preventDefault(); firstEl.focus();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div
      className="fixed inset-0 bg-wine-800/40 backdrop-blur-[2px] flex items-end sm:items-center justify-center p-4 z-50"
      onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="bg-white rounded-3xl w-full max-w-md shadow-2xl ring-1 ring-wine-100 p-6 sm:p-7 max-h-[90vh] overflow-y-auto focus:outline-none"
      >
        {children}
      </div>
    </div>
  );
}
