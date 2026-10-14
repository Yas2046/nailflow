import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError } from '../../services/api';
import { usePageTitle } from '../../hooks/usePageTitle';
import { useVisiblePolling } from '../../hooks/useVisiblePolling';
import { useSupport } from '../../context/SupportContext';
import { useToast } from '../../context/ToastContext';
import {
  categoryTitle, fmtDateTime, supportApi, ticketCode,
  type SupportEvent, type SupportMessage, type SupportTicket,
} from '../../services/support';
import { Composer, Thread, maxSeq, mergeById } from '../../components/support/Thread';
import { ErrorBox, IconBubble, LoadingList, Notice, StatusPill, StatusProgress, Unavailable } from '../../components/support/SupportUi';
import { CategoryIcon, IconSearch } from '../../components/support/SupportIcons';

const POLL_MS = 20_000;   // dentro de uma conversa aberta

export default function SuporteConversa() {
  const { id = '' } = useParams();
  const { load, enabled, refresh } = useSupport();
  const { toast } = useToast();
  const [ticket, setTicket] = useState<SupportTicket | null>(null);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [events, setEvents] = useState<SupportEvent[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [nextBefore, setNextBefore] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<{ message: string; notFound: boolean } | null>(null);
  const readSent = useRef(0);

  usePageTitle(ticket ? `${ticketCode(ticket.ticketNumber)} · ${ticket.subject}` : 'Solicitação');

  const fetchLatest = useCallback(async (initial: boolean) => {
    if (initial) { setLoading(true); setError(null); }
    try {
      const r = await supportApi.get(id);
      setTicket(r.ticket);
      setMessages((cur) => (initial ? r.messages : mergeById(cur, r.messages)));
      setEvents((cur) => (initial ? r.events : mergeById(cur, r.events)));
      if (initial) { setHasMore(r.hasMore); setNextBefore(r.nextBefore); }
    } catch (e) {
      if (initial) setError({ message: e instanceof ApiError ? e.message : 'Verifique sua conexão e tente de novo.', notFound: e instanceof ApiError && e.status === 404 });
    } finally {
      if (initial) setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    readSent.current = 0;
    setTicket(null); setMessages([]); setEvents([]);
    if (enabled) void fetchLatest(true);
  }, [enabled, fetchLatest]);

  useVisiblePolling(() => { void fetchLatest(false); }, POLL_MS, enabled && !!ticket);

  // "Lida" só depois de exibir, com a aba visível, e só até o maior seq que a tela mostra.
  const top = maxSeq(messages, events);
  const markRead = useCallback(() => {
    if (!ticket || top === 0 || document.visibilityState !== 'visible') return;
    if (top <= readSent.current) return;                       // já enviado até aqui
    if (top <= ticket.profReadSeq) { readSent.current = top; return; }   // o servidor já sabe
    readSent.current = top;
    supportApi.read(id, top)
      .then(() => { void fetchLatest(false); void refresh(); })
      .catch(() => { readSent.current = 0; });
  }, [ticket, top, id, refresh, fetchLatest]);
  useEffect(() => { markRead(); }, [markRead]);
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') markRead(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [markRead]);

  async function loadOlder() {
    if (nextBefore === null) return;
    setLoadingMore(true);
    try {
      const r = await supportApi.get(id, { before: nextBefore });
      setMessages((cur) => mergeById(cur, r.messages));
      setEvents((cur) => mergeById(cur, r.events));
      setHasMore(r.hasMore);
      setNextBefore(r.nextBefore);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Não foi possível carregar as mensagens anteriores.', 'error');
    } finally {
      setLoadingMore(false);
    }
  }

  async function send(body: string, clientMessageId: string) {
    const r = await supportApi.send(id, { body, clientMessageId });
    setMessages((cur) => mergeById(cur, [r.message]));
    setTicket(r.ticket);
    void fetchLatest(false);   // traz o evento de status gerado pela resposta
  }

  async function reopen(body: string) {
    await supportApi.reopen(id, body);
    toast('Solicitação reaberta.', 'success');
    await fetchLatest(false);
    void refresh();
  }

  if (load === 'loading') return <LoadingList rows={2} label="Carregando…" />;
  if (!enabled) return <Unavailable />;
  if (loading) return <LoadingList rows={3} label="Carregando a conversa…" />;
  if (error) {
    return error.notFound
      ? (
        <div className="mx-auto max-w-md rounded-2xl border border-wine-100 bg-white p-10 text-center">
          <div className="mb-3 flex justify-center"><IconBubble size="lg"><IconSearch className="h-6 w-6" /></IconBubble></div>
          <p className="font-display text-xl font-semibold text-wine-800">Solicitação não encontrada</p>
          <p className="mt-1.5 text-sm text-ink/65">Ela pode ter sido removida ou o endereço está incorreto.</p>
          <Link to="/suporte/solicitacoes" className="btn-primary mt-5">Voltar às solicitações</Link>
        </div>
      )
      : <ErrorBox message={error.message} onRetry={() => void fetchLatest(true)} />;
  }
  if (!ticket) return null;

  const resolved = ticket.status === 'resolvida';

  return (
    <div className="mx-auto max-w-3xl">
      <Link to="/suporte/solicitacoes" className="inline-flex min-h-[44px] items-center text-sm text-wine-700 underline-offset-2 hover:underline">← Minhas solicitações</Link>
      <header className="mb-6 mt-1 rounded-2xl border border-wine-100 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex items-start gap-3.5">
          <IconBubble size="lg"><CategoryIcon category={ticket.category} className="h-6 w-6" /></IconBubble>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
              <h1 className="min-w-0 break-words font-display text-2xl text-wine-800 sm:text-3xl">{ticket.subject}</h1>
              <StatusPill status={ticket.status} viewer="professional" />
            </div>
            <p className="mt-1 text-xs text-ink/55">
              {ticketCode(ticket.ticketNumber)} · {categoryTitle(ticket.category)} · aberta em {fmtDateTime(ticket.createdAt)}
            </p>
          </div>
        </div>
        <StatusProgress status={ticket.status} viewer="professional" />
      </header>

      <Thread messages={messages} events={events} viewer="professional" hasMore={hasMore} loadingMore={loadingMore} onLoadMore={() => void loadOlder()} />

      <div className="mt-6">
        {!resolved ? (
          <Composer draftKey={`t-${id}`} onSend={send} placeholder="Escreva sua mensagem para a equipe…" />
        ) : ticket.canReopenUntil ? (
          <div className="space-y-3">
            <Notice tone="success">
              Esta solicitação foi resolvida{ticket.resolvedAt ? ` em ${fmtDateTime(ticket.resolvedAt)}` : ''}. O problema voltou? Você pode reabri-la até {fmtDateTime(ticket.canReopenUntil)}.
            </Notice>
            <Composer draftKey={`r-${id}`} onSend={(body) => reopen(body)} label="Conte o que aconteceu" submitLabel="Reabrir solicitação" hint="Explique por que está reabrindo. Ctrl+Enter envia." />
          </div>
        ) : (
          <div className="space-y-3">
            <Notice tone="info">O prazo de 7 dias para reabrir esta solicitação terminou.</Notice>
            <Link to={`/suporte/solicitacoes/nova?relacionada=${ticket.ticketNumber}`} className="btn-primary min-h-[44px]">Abrir nova solicitação</Link>
          </div>
        )}
      </div>
    </div>
  );
}
