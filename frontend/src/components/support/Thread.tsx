import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ApiError } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { readSupportDraft, writeSupportDraft } from '../../services/supportDrafts';
import {
  BODY_MAX, charCount, eventText, fmtDateTime, newId,
  type SupportEvent, type SupportMessage, type SupportRole,
} from '../../services/support';
import { CharCounter, Notice } from './SupportUi';

type Item =
  | { kind: 'message'; seq: number; id: string; message: SupportMessage }
  | { kind: 'event'; seq: number; id: string; event: SupportEvent };

/** Mescla mensagens e eventos por seq; `id` repetido (reconsulta da mesma janela) conta uma vez. */
export function mergeById<T extends { id: string; seq: number }>(current: T[], incoming: T[]): T[] {
  const map = new Map(current.map((x) => [x.id, x]));
  for (const x of incoming) map.set(x.id, x);
  return [...map.values()].sort((a, b) => a.seq - b.seq);
}

export function maxSeq(messages: SupportMessage[], events: SupportEvent[]): number {
  return Math.max(0, ...messages.map((m) => m.seq), ...events.map((e) => e.seq));
}

/**
 * Linha do tempo da conversa: mensagens e mudanças de status/prioridade em ordem de seq. Compartilhada pelas duas
 * áreas; `viewer` decide os rótulos ("Equipe NailFlow" para a profissional; nome do negócio para a ADM).
 */
export function Thread({
  messages, events, viewer, currentUserId, professionalName, hasMore, loadingMore, onLoadMore,
}: {
  messages: SupportMessage[]; events: SupportEvent[]; viewer: SupportRole; currentUserId?: string;
  professionalName?: string; hasMore: boolean; loadingMore: boolean; onLoadMore: () => void;
}) {
  const items = useMemo<Item[]>(() => {
    const all: Item[] = [
      ...messages.map((m) => ({ kind: 'message' as const, seq: m.seq, id: `m-${m.id}`, message: m })),
      ...events.map((e) => ({ kind: 'event' as const, seq: e.seq, id: `e-${e.id}`, event: e })),
    ];
    return all.sort((a, b) => a.seq - b.seq);
  }, [messages, events]);

  const endRef = useRef<HTMLDivElement>(null);
  const lastSeq = items.length ? items[items.length - 1].seq : 0;
  const prevLast = useRef(0);

  // Rola para o fim ao abrir e quando chega algo novo no fim (não ao carregar mensagens antigas).
  useEffect(() => {
    if (lastSeq > prevLast.current) endRef.current?.scrollIntoView({ block: 'end' });
    prevLast.current = lastSeq;
  }, [lastSeq]);

  return (
    <div>
      {hasMore && (
        <div className="mb-4 text-center">
          <button type="button" className="btn-secondary !py-1.5 text-sm" onClick={onLoadMore} disabled={loadingMore}>
            {loadingMore ? 'Carregando…' : 'Carregar mensagens anteriores'}
          </button>
        </div>
      )}
      <ol role="log" aria-live="polite" aria-relevant="additions" aria-label="Conversa" className="space-y-3">
        {items.map((it) => {
          if (it.kind === 'event') {
            return (
              <li key={it.id} className="flex justify-center">
                <p className="rounded-full bg-wine-50 px-3 py-1 text-center text-xs text-ink/65">
                  {eventText(it.event, viewer)} · {fmtDateTime(it.event.createdAt)}
                </p>
              </li>
            );
          }
          const m = it.message;
          const mine = viewer === 'professional'
            ? m.authorRole === 'professional'
            : m.authorRole === 'admin' && m.authorId === currentUserId;
          const who = viewer === 'professional'
            ? (mine ? 'Você' : 'Equipe NailFlow')
            : (m.authorRole === 'professional' ? (professionalName ?? 'Profissional') : (mine ? 'Você' : 'Equipe NailFlow'));
          return (
            <li key={it.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[88%] rounded-2xl px-4 py-2.5 sm:max-w-[75%] ${mine ? 'bg-wine-600 text-white' : 'border border-wine-100 bg-white text-ink/90'}`}>
                <p className={`mb-0.5 text-[11px] font-semibold uppercase tracking-wide ${mine ? 'text-white/75' : 'text-wine-600'}`}>{who}</p>
                <p className="whitespace-pre-wrap break-words text-[15px] leading-relaxed">{m.body}</p>
                <p className={`mt-1 text-right text-[11px] ${mine ? 'text-white/70' : 'text-ink/50'}`}>{fmtDateTime(m.createdAt)}</p>
              </div>
            </li>
          );
        })}
      </ol>
      <div ref={endRef} />
    </div>
  );
}

// ── caixa de resposta ───────────────────────────────────────────────────────

/**
 * Caixa de resposta. O identificador de idempotência (clientMessageId) vale para o texto exato tentado: se o envio
 * falhar e a pessoa tentar de novo com o mesmo texto, o mesmo id é reutilizado (nunca duplica); se mudar o texto,
 * um id novo é gerado. O rascunho fica salvo por solicitação e é limpo ao enviar.
 */
export function Composer({
  draftKey, onSend, label = 'Sua mensagem', submitLabel = 'Enviar', placeholder, hint,
}: {
  draftKey: string; onSend: (body: string, clientMessageId: string) => Promise<void>;
  label?: string; submitLabel?: string; placeholder?: string; hint?: string;
}) {
  const ownerId = useAuth().professional?.id;
  const [text, setText] = useState(() => readSupportDraft(ownerId, draftKey));
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const attempt = useRef<{ id: string; text: string } | null>(null);
  const areaId = useId();
  const hintId = useId();
  const length = charCount(text.trim());
  const tooLong = length > BODY_MAX;
  const empty = text.trim() === '';

  async function submit() {
    if (sending || empty || tooLong) return;
    const body = text.trim();
    if (!attempt.current || attempt.current.text !== body) attempt.current = { id: newId(), text: body };
    setSending(true);
    setError(null);
    try {
      await onSend(body, attempt.current.id);
      attempt.current = null;
      setText('');
      writeSupportDraft(ownerId, draftKey, '');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível enviar. Sua mensagem foi mantida: tente de novo.');
    } finally {
      setSending(false);
    }
  }

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); void submit(); }}
      className="rounded-2xl border border-wine-100 bg-white p-3 sm:p-4"
    >
      <label htmlFor={areaId} className="mb-1.5 block text-sm font-medium text-ink/80">{label}</label>
      <textarea
        id={areaId}
        className="input min-h-[96px] resize-y"
        rows={3}
        value={text}
        placeholder={placeholder}
        aria-describedby={hintId}
        aria-invalid={tooLong || undefined}
        onChange={(e) => { setText(e.target.value); writeSupportDraft(ownerId, draftKey, e.target.value); if (error) setError(null); }}
        onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); void submit(); } }}
        disabled={sending}
      />
      <div className="mt-2 flex items-center justify-between gap-3">
        <span id={hintId} className="text-xs text-ink/55">{hint ?? 'Ctrl+Enter envia.'}</span>
        <CharCounter value={length} max={BODY_MAX} />
      </div>
      {error && <div className="mt-3"><Notice tone="error">{error}</Notice></div>}
      <div className="mt-3 flex justify-end">
        <button type="submit" className="btn-primary min-h-[44px]" disabled={sending || empty || tooLong}>
          {sending ? 'Enviando…' : error ? 'Tentar de novo' : submitLabel}
        </button>
      </div>
    </form>
  );
}
