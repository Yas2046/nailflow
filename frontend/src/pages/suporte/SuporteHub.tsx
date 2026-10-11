import { useState } from 'react';
import { Link } from 'react-router-dom';
import { usePageTitle } from '../../hooks/usePageTitle';
import { useSupport } from '../../context/SupportContext';
import { useToast } from '../../context/ToastContext';
import { FaqBrowser, useFaq } from '../../components/support/FaqBrowser';
import { LoadingList, UnreadBadge, Unavailable } from '../../components/support/SupportUi';

export default function SuporteHub() {
  usePageTitle('Ajuda e suporte');
  const { load, enabled, fabHidden, unreadTickets, setFabHidden } = useSupport();
  const { toast } = useToast();
  const { faq, loading, error, reload } = useFaq(enabled);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);

  if (load === 'loading') return <LoadingList rows={2} label="Carregando…" />;
  if (!enabled) return <Unavailable />;

  async function toggleFab() {
    setBusy(true);
    try {
      await setFabHidden(!fabHidden);
      toast(fabHidden ? 'Botão de ajuda ativado.' : 'Botão de ajuda oculto.', 'success');
    } catch {
      toast('Não foi possível salvar essa preferência. Tente de novo.', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <header className="page-header">
        <h1 className="font-display text-3xl text-wine-800">Ajuda e suporte</h1>
        <p className="mt-1 text-sm text-ink/60">Encontre respostas rápidas ou fale com a equipe NailFlow.</p>
      </header>

      <div className="mb-8 grid gap-3 sm:grid-cols-2">
        <Link
          to="/suporte/solicitacoes/nova"
          className="rounded-2xl border border-wine-100 bg-white p-5 transition-colors hover:border-wine-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-wine-400/50"
        >
          <p className="font-display text-lg text-wine-800">Abrir uma solicitação</p>
          <p className="mt-1 text-sm text-ink/60">Não achou a resposta? Conte o que aconteceu e acompanhe por aqui.</p>
        </Link>
        <Link
          to="/suporte/solicitacoes"
          className="rounded-2xl border border-wine-100 bg-white p-5 transition-colors hover:border-wine-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-wine-400/50"
        >
          <p className="flex items-center gap-2 font-display text-lg text-wine-800">Minhas solicitações <UnreadBadge count={unreadTickets} /></p>
          <p className="mt-1 text-sm text-ink/60">Veja o andamento e converse com a equipe.</p>
        </Link>
      </div>

      <section aria-labelledby="faq-titulo">
        <h2 id="faq-titulo" className="mb-3 font-display text-xl text-wine-800">Perguntas frequentes</h2>
        <FaqBrowser
          faq={faq} loading={loading} error={error} onRetry={reload} query={query} onQueryChange={setQuery}
          emptyAction={<Link to="/suporte/solicitacoes/nova" className="btn-primary">Abrir solicitação</Link>}
        />
      </section>

      <section className="mt-10 rounded-2xl border border-wine-100 bg-white p-5 text-sm text-ink/70">
        <p>
          Quer um passo a passo para começar? Veja o{' '}
          <Link to="/ajuda" className="font-medium text-wine-700 underline underline-offset-2">guia rápido</Link>.
        </p>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-wine-100 pt-4">
          <span>Botão flutuante de ajuda: <strong>{fabHidden ? 'oculto' : 'visível'}</strong> nas suas telas.</span>
          <button type="button" className="btn-secondary" onClick={toggleFab} disabled={busy} aria-pressed={!fabHidden}>
            {busy ? 'Salvando…' : fabHidden ? 'Mostrar o botão de ajuda' : 'Ocultar o botão de ajuda'}
          </button>
        </div>
      </section>
    </div>
  );
}
