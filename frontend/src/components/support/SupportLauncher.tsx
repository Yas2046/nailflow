import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useSupport } from '../../context/SupportContext';
import { useToast } from '../../context/ToastContext';
import { FaqBrowser, useFaq } from './FaqBrowser';
import { UnreadBadge } from './SupportUi';

function QuickPanel({ onClose, onHide, hiding }: { onClose: () => void; onHide: () => void; hiding: boolean }) {
  const { faq, loading, error, reload } = useFaq();
  const { unreadTickets } = useSupport();
  const [query, setQuery] = useState('');
  const newRequest = (
    <Link to="/suporte/solicitacoes/nova" className="btn-primary">Abrir solicitação</Link>
  );

  return (
    <div
      role="dialog"
      aria-label="Ajuda rápida"
      className="fixed inset-x-0 bottom-0 z-50 flex max-h-[75vh] flex-col rounded-t-2xl border border-wine-100 bg-cream shadow-[0_-12px_40px_-12px_rgba(43,35,32,0.35)] md:inset-x-auto md:bottom-24 md:right-6 md:w-[24rem] md:max-h-[70vh] md:rounded-2xl"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      <div className="flex items-center justify-between gap-2 border-b border-wine-100 px-4 py-3">
        <p className="font-display text-lg text-wine-800">Como podemos ajudar?</p>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onHide}
            disabled={hiding}
            className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-ink/60 hover:bg-wine-50 hover:text-ink/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-wine-400/50 disabled:opacity-60"
            title="Ocultar este botão (você pode reativá-lo em Ajuda e suporte)"
          >
            {hiding ? 'Ocultando…' : 'Ocultar botão'}
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar ajuda"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-ink/60 hover:bg-wine-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-wine-400/50"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" d="M6 6l12 12M18 6 6 18" /></svg>
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <FaqBrowser faq={faq} loading={loading} error={error} onRetry={reload} query={query} onQueryChange={setQuery} compact autoFocus emptyAction={newRequest} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-wine-100 px-4 py-3 text-sm">
        <Link to="/suporte" className="font-medium text-wine-700 underline-offset-2 hover:underline">Ver todas</Link>
        <Link to="/suporte/solicitacoes" className="inline-flex items-center gap-1.5 font-medium text-wine-700 underline-offset-2 hover:underline">
          Minhas solicitações <UnreadBadge count={unreadTickets} />
        </Link>
        <Link to="/suporte/solicitacoes/nova" className="w-full text-center font-semibold text-wine-800 underline-offset-2 hover:underline">
          Não encontrei o que precisava
        </Link>
      </div>
    </div>
  );
}

/**
 * Botão flutuante "?" da profissional. Só aparece quando o bootstrap informa Central ligada e botão não oculto,
 * e nunca dentro de /suporte. Ocultar grava a preferência na conta (PUT /support/preferences).
 */
export default function SupportLauncher() {
  const { enabled, fabHidden, setFabHidden } = useSupport();
  const { toast } = useToast();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const [hiding, setHiding] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => { setOpen(false); }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); buttonRef.current?.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  if (!enabled || fabHidden || pathname.startsWith('/suporte')) return null;

  async function hide() {
    setHiding(true);
    try {
      await setFabHidden(true);
      setOpen(false);
      toast('Botão oculto. Para mostrá-lo de novo, abra Ajuda e suporte.', 'info');
    } catch {
      toast('Não foi possível ocultar o botão. Tente de novo.', 'error');
    } finally {
      setHiding(false);
    }
  }

  return (
    <>
      {open && <QuickPanel onClose={() => { setOpen(false); buttonRef.current?.focus(); }} onHide={hide} hiding={hiding} />}
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? 'Fechar ajuda' : 'Abrir ajuda'}
        aria-expanded={open}
        className="fixed right-4 z-30 flex h-12 w-12 items-center justify-center rounded-full bg-wine-600 font-display text-xl font-semibold text-white shadow-lg transition-colors hover:bg-wine-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-wine-400 focus-visible:ring-offset-2 bottom-[calc(5rem+env(safe-area-inset-bottom,0px))] md:bottom-6 md:right-6"
      >
        ?
      </button>
    </>
  );
}
