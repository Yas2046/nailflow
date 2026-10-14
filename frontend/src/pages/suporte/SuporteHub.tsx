import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { usePageTitle } from '../../hooks/usePageTitle';
import { useSupport } from '../../context/SupportContext';
import { useToast } from '../../context/ToastContext';
import { FaqBrowser, useFaq } from '../../components/support/FaqBrowser';
import { IconArrowRight, IconBook, IconChat, IconLifebuoy, IconPencil } from '../../components/support/SupportIcons';
import { IconBubble, LoadingList, UnreadBadge, Unavailable } from '../../components/support/SupportUi';

function ActionCard({ to, icon, title, children, badge }: { to: string; icon: ReactNode; title: string; children: ReactNode; badge?: ReactNode }) {
  return (
    <Link
      to={to}
      className="group flex items-start gap-4 rounded-2xl border border-wine-100 bg-white p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-wine-300 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-wine-400/50"
    >
      <IconBubble size="lg">{icon}</IconBubble>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2 font-display text-lg text-wine-800">{title} {badge}</span>
        <span className="mt-1 block text-sm leading-relaxed text-ink/60">{children}</span>
      </span>
      <IconArrowRight className="mt-1 h-4 w-4 shrink-0 text-wine-300 transition-all group-hover:translate-x-0.5 group-hover:text-wine-600" />
    </Link>
  );
}

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
      <header className="mb-6 overflow-hidden rounded-3xl border border-wine-100 bg-gradient-to-br from-wine-50 via-white to-gold-300/10 p-6 sm:p-8">
        <div className="flex items-start gap-4">
          <IconBubble size="lg" tone="gold"><IconLifebuoy className="h-7 w-7" /></IconBubble>
          <div className="min-w-0">
            <h1 className="font-display text-3xl text-wine-800 sm:text-4xl">Ajuda e suporte</h1>
            <p className="mt-1.5 max-w-xl text-[15px] leading-relaxed text-ink/65">
              Encontre respostas rápidas ou fale com a equipe NailFlow. Quando você abre uma solicitação, a resposta chega aqui.
            </p>
          </div>
        </div>
      </header>

      <div className="mb-10 grid gap-3 sm:grid-cols-2">
        <ActionCard to="/suporte/solicitacoes/nova" icon={<IconPencil className="h-6 w-6" />} title="Abrir uma solicitação">
          Não achou a resposta? Conte o que aconteceu e acompanhe por aqui.
        </ActionCard>
        <ActionCard to="/suporte/solicitacoes" icon={<IconChat className="h-6 w-6" />} title="Minhas solicitações" badge={<UnreadBadge count={unreadTickets} />}>
          Veja o andamento e converse com a equipe.
        </ActionCard>
      </div>

      <section aria-labelledby="faq-titulo">
        <h2 id="faq-titulo" className="mb-3 font-display text-xl text-wine-800">Perguntas frequentes</h2>
        <FaqBrowser
          faq={faq} loading={loading} error={error} onRetry={reload} query={query} onQueryChange={setQuery}
          emptyAction={<Link to="/suporte/solicitacoes/nova" className="btn-primary">Abrir solicitação</Link>}
        />
      </section>

      {!loading && !error && faq && faq.articles.length > 0 && (
        <section className="mt-8 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-wine-100 bg-wine-50/50 p-5">
          <div className="flex items-center gap-3">
            <IconBubble tone="gold"><IconChat className="h-5 w-5" /></IconBubble>
            <div>
              <p className="font-display text-lg text-wine-800">Não encontrou o que procurava?</p>
              <p className="text-sm text-ink/60">Nossa equipe responde pela própria Central.</p>
            </div>
          </div>
          <Link to="/suporte/solicitacoes/nova" className="btn-primary min-h-[44px]">Abrir solicitação</Link>
        </section>
      )}

      <section className="mt-10 rounded-2xl border border-wine-100 bg-white p-5 text-sm text-ink/70">
        <p className="flex items-start gap-2.5">
          <IconBook className="mt-0.5 h-[18px] w-[18px] shrink-0 text-wine-500" />
          <span>
            Quer um passo a passo para começar? Veja o{' '}
            <Link to="/ajuda" className="font-medium text-wine-700 underline underline-offset-2">guia rápido</Link>.
          </span>
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
