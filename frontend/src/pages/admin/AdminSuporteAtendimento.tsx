import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { usePageTitle } from '../../hooks/usePageTitle';
import { useVisiblePolling } from '../../hooks/useVisiblePolling';
import { Eyebrow, Panel } from '../../components/admin-account/AccountUi';
import { useAdminShell } from '../../components/adminShell';
import {
  PRIORITIES, STATUSES, adminSupportApi, categoryTitle, fmtDateTime, priorityLabel, relativeTime, statusLabel, ticketCode,
  type AdminTicket, type SupportEvent, type SupportMessage, type SupportPriority, type SupportStatus,
} from '../../services/support';
import { Composer, Thread, maxSeq, mergeById } from '../../components/support/Thread';
import { Avatar, ErrorBox, IconBubble, LoadingList, Notice, PriorityPill, StatusPill, StatusProgress, Unavailable } from '../../components/support/SupportUi';
import { IconSearch } from '../../components/support/SupportIcons';

const POLL_MS = 20_000;

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink/60">{label}</dt>
      <dd className="mt-0.5 break-words text-sm text-ink/85">{children}</dd>
    </div>
  );
}

export default function AdminSuporteAtendimento() {
  const { id = '' } = useParams();
  const { professional: me } = useAuth();
  const { toast } = useToast();
  const shell = useAdminShell();
  const refreshSummary = shell?.support.refresh;
  const [ticket, setTicket] = useState<AdminTicket | null>(null);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [events, setEvents] = useState<SupportEvent[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [nextBefore, setNextBefore] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<{ message: string; notFound: boolean; off: boolean } | null>(null);
  const [saving, setSaving] = useState<'status' | 'priority' | null>(null);
  const [savingTo, setSavingTo] = useState<SupportStatus | null>(null);
  const readSent = useRef(0);

  usePageTitle(ticket ? `${ticketCode(ticket.ticketNumber)} · Suporte` : 'Suporte');

  const fetchLatest = useCallback(async (initial: boolean) => {
    if (initial) { setLoading(true); setError(null); }
    try {
      const r = await adminSupportApi.get(id);
      setTicket(r.ticket);
      setMessages((cur) => (initial ? r.messages : mergeById(cur, r.messages)));
      setEvents((cur) => (initial ? r.events : mergeById(cur, r.events)));
      if (initial) { setHasMore(r.hasMore); setNextBefore(r.nextBefore); }
    } catch (e) {
      if (initial) {
        const status = e instanceof ApiError ? e.status : 0;
        setError({ message: e instanceof ApiError ? e.message : 'Verifique sua conexão e tente de novo.', notFound: status === 404 && !(e instanceof ApiError && e.message === 'Recurso não encontrado.'), off: status === 404 && e instanceof ApiError && e.message === 'Recurso não encontrado.' });
      }
    } finally {
      if (initial) setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    readSent.current = 0;
    setTicket(null); setMessages([]); setEvents([]);
    void fetchLatest(true);
  }, [fetchLatest]);

  useVisiblePolling(() => { void fetchLatest(false); }, POLL_MS, !!ticket);

  const top = maxSeq(messages, events);
  const markRead = useCallback(() => {
    if (!ticket || top === 0 || document.visibilityState !== 'visible') return;
    if (top <= readSent.current) return;
    if (top <= ticket.adminReadSeq) { readSent.current = top; return; }
    readSent.current = top;
    adminSupportApi.read(id, top)
      .then(() => { void fetchLatest(false); refreshSummary?.(); })
      .catch(() => { readSent.current = 0; });
  }, [ticket, top, id, fetchLatest, refreshSummary]);
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
      const r = await adminSupportApi.get(id, { before: nextBefore });
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
    const r = await adminSupportApi.send(id, { body, clientMessageId });
    setMessages((cur) => mergeById(cur, [r.message]));
    setTicket(r.ticket);
    void fetchLatest(false);
    refreshSummary?.();
  }

  async function changeStatus(to: SupportStatus) {
    if (!ticket) return;
    setSaving('status');
    setSavingTo(to);
    try {
      const r = await adminSupportApi.setStatus(id, to, ticket.status);
      setTicket(r.ticket);
      toast(`Status alterado para “${statusLabel(to, 'admin')}”.`, 'success');
      await fetchLatest(false);
      refreshSummary?.();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Não foi possível alterar o status.', 'error');
      if (e instanceof ApiError && e.reason === 'stale_status') void fetchLatest(false);
    } finally {
      setSaving(null);
      setSavingTo(null);
    }
  }

  async function changePriority(to: SupportPriority) {
    if (!ticket || to === ticket.priority) return;
    setSaving('priority');
    try {
      const r = await adminSupportApi.setPriority(id, to);
      setTicket(r.ticket);
      toast(`Prioridade alterada para ${priorityLabel(to)}.`, 'success');
      await fetchLatest(false);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Não foi possível alterar a prioridade.', 'error');
    } finally {
      setSaving(null);
    }
  }

  if (shell?.support.checked && !shell.support.enabled) return <Unavailable />;
  if (loading) return <LoadingList rows={3} label="Carregando a solicitação…" />;
  if (error) {
    if (error.off) return <Unavailable />;
    return error.notFound
      ? (
        <div className="mx-auto max-w-md rounded-2xl border border-wine-100 bg-white p-10 text-center">
          <div className="mb-3 flex justify-center"><IconBubble size="lg"><IconSearch className="h-6 w-6" /></IconBubble></div>
          <p className="font-display text-xl font-semibold text-wine-800">Solicitação não encontrada</p>
          <Link to="/admin/suporte" className="btn-primary mt-5">Voltar à fila</Link>
        </div>
      )
      : <ErrorBox message={error.message} onRetry={() => void fetchLatest(true)} />;
  }
  if (!ticket) return null;

  const resolved = ticket.status === 'resolvida';
  const statusOptions = STATUSES.filter((s) => s !== ticket.status && (resolved ? s !== 'aguardando_profissional' : s !== 'resolvida'));

  return (
    <div>
      <header className="mb-6 border-b border-wine-100 pb-5">
        <Link to="/admin/suporte" className="inline-flex min-h-[44px] items-center text-sm text-wine-700 underline-offset-2 hover:underline">← Fila de solicitações</Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <Eyebrow>{ticketCode(ticket.ticketNumber)} · {categoryTitle(ticket.category)}</Eyebrow>
            <h1 className="mt-1.5 break-words font-display text-2xl font-semibold text-wine-800 sm:text-[1.9rem]">{ticket.subject}</h1>
            <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink/65">
              <Avatar name={ticket.professional.businessName} />
              <span className="font-medium text-ink/80">{ticket.professional.businessName}</span>
              <span aria-hidden="true">·</span>
              <span>{ticket.professional.name}</span>
              <span aria-hidden="true">·</span>
              <span title={fmtDateTime(ticket.lastActivityAt)}>última atividade {relativeTime(ticket.lastActivityAt)}</span>
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <PriorityPill priority={ticket.priority} />
            <StatusPill status={ticket.status} viewer="admin" />
          </div>
        </div>
        <div className="max-w-md"><StatusProgress status={ticket.status} viewer="admin" /></div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0">
          <Thread
            messages={messages} events={events} viewer="admin" currentUserId={me?.id} professionalName={ticket.professional.businessName}
            hasMore={hasMore} loadingMore={loadingMore} onLoadMore={() => void loadOlder()}
          />
          <div className="mt-6">
            {resolved ? (
              <Notice tone="info">Esta solicitação está resolvida. Para responder, reabra-a em “Alterar status”.</Notice>
            ) : (
              <Composer
                draftKey={`adm-${id}`} onSend={send} label="Responder à profissional" submitLabel="Enviar resposta"
                hint="Ao enviar, o status muda para “Aguardando a profissional”. Ctrl+Enter envia."
              />
            )}
          </div>
        </div>

        <aside className="space-y-4" aria-label="Detalhes do atendimento">
          <Panel>
            <Eyebrow>Profissional</Eyebrow>
            <dl className="mt-3 space-y-3">
              <Fact label="Negócio">{ticket.professional.businessName}</Fact>
              <Fact label="Nome">{ticket.professional.name}</Fact>
              <Fact label="Aberta em">{fmtDateTime(ticket.createdAt)}</Fact>
              <Fact label="Última atividade">{fmtDateTime(ticket.lastActivityAt)}</Fact>
              {ticket.resolvedAt && <Fact label="Resolvida em">{fmtDateTime(ticket.resolvedAt)}</Fact>}
              {ticket.reopenCount > 0 && <Fact label="Reaberturas pela profissional">{ticket.reopenCount}</Fact>}
            </dl>
          </Panel>

          <Panel>
            <Eyebrow>Alterar status</Eyebrow>
            <div className="mt-3 space-y-3">
              {!resolved && (
                <button type="button" className="btn-primary w-full" disabled={saving !== null} onClick={() => void changeStatus('resolvida')}>
                  {savingTo === 'resolvida' ? 'Salvando…' : 'Marcar como resolvida'}
                </button>
              )}
              {statusOptions.filter((o) => o !== 'resolvida').length > 0 && (
                <div>
                  <p className="mb-1.5 text-xs font-medium text-ink/70">{resolved ? 'Reabrir como' : 'Mudar para'}</p>
                  <div className="flex flex-col gap-2">
                    {statusOptions.filter((o) => o !== 'resolvida').map((o) => (
                      <button key={o} type="button" className="btn-secondary w-full justify-center" disabled={saving !== null} onClick={() => void changeStatus(o)}>
                        {savingTo === o ? 'Salvando…' : statusLabel(o, 'admin')}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </Panel>

          <Panel>
            <Eyebrow>Prioridade</Eyebrow>
            <div className="mt-3">
              <label htmlFor="prioridade" className="sr-only">Prioridade</label>
              <select id="prioridade" className="input" value={ticket.priority} disabled={saving !== null} onChange={(e) => void changePriority(e.target.value as SupportPriority)}>
                {PRIORITIES.map((p) => <option key={p} value={p}>{priorityLabel(p)}</option>)}
              </select>
              <p className="mt-2 text-xs text-ink/60">
                {ticket.prioritySource === 'manual' ? 'Ajustada manualmente.' : 'Sugerida automaticamente.'} A profissional não vê a prioridade e a mudança não gera aviso.
              </p>
            </div>
          </Panel>
        </aside>
      </div>
    </div>
  );
}
