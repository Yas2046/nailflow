import { useEffect, useRef } from 'react';

/**
 * Chama `callback` a cada `intervalMs` enquanto a aba estiver visível. Aba oculta pausa; ao voltar a ficar
 * visível chama uma vez na hora e retoma. Não chama ao montar (quem usa já carrega os dados por conta própria).
 */
export function useVisiblePolling(callback: () => void, intervalMs: number, enabled = true) {
  const ref = useRef(callback);
  ref.current = callback;

  useEffect(() => {
    if (!enabled) return;
    let timer: number | undefined;

    const start = () => {
      if (timer === undefined) timer = window.setInterval(() => ref.current(), intervalMs);
    };
    const stop = () => {
      if (timer !== undefined) { window.clearInterval(timer); timer = undefined; }
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') { ref.current(); start(); } else stop();
    };

    if (document.visibilityState === 'visible') start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => { stop(); document.removeEventListener('visibilitychange', onVisibility); };
  }, [intervalMs, enabled]);
}
