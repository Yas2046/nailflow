// Acessibilidade de diálogos: renderize como primeiro filho do elemento com role="dialog".
// Faz: foco inicial no primeiro campo, foco preso (Tab/Shift+Tab), Esc fecha, trava a rolagem do fundo e devolve o foco a quem abriu.
// Com diálogos empilhados (ex.: "Nova cliente" sobre o agendamento) só o de cima reage ao teclado.
import { useEffect, useRef } from 'react';

const stack: symbol[] = [];

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export default function ModalA11y({ onClose }: { onClose: () => void }) {
  const marker = useRef<HTMLSpanElement>(null);
  // Quem tinha o foco ANTES do diálogo aparecer (lido na renderização, antes de campos com autoFocus roubarem o foco).
  const openerRef = useRef<HTMLElement | null>(typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const dialog = marker.current?.closest<HTMLElement>('[role="dialog"]');
    if (!dialog) return;
    const id = Symbol('modal');
    stack.push(id);
    const opener = openerRef.current && openerRef.current !== document.body && !dialog.contains(openerRef.current) ? openerRef.current : null;
    const focusables = () => [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);

    if (!dialog.contains(document.activeElement)) {
      (dialog.querySelector<HTMLElement>('input:not([disabled]),select:not([disabled]),textarea:not([disabled])') ?? focusables()[0])?.focus();
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    function onKey(e: KeyboardEvent) {
      if (stack[stack.length - 1] !== id) return;
      if (e.key === 'Escape') { e.stopPropagation(); closeRef.current(); return; }
      if (e.key !== 'Tab') return;
      const items = focusables();
      if (!items.length) { e.preventDefault(); return; }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (!dialog!.contains(active) || (e.shiftKey && active === first)) { e.preventDefault(); (e.shiftKey ? last : first).focus(); }
      else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
    }
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      stack.splice(stack.indexOf(id), 1);
      document.body.style.overflow = previousOverflow;
      opener?.focus?.();
    };
  }, []);

  return <span ref={marker} hidden />;
}
