import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ApiError } from '../../services/api';
import { usePageTitle } from '../../hooks/usePageTitle';
import { useSupport } from '../../context/SupportContext';
import { useAuth } from '../../context/AuthContext';
import { readSupportDraft, writeSupportDraft } from '../../services/supportDrafts';
import { useToast } from '../../context/ToastContext';
import {
  BODY_MAX, CATEGORIES, CATEGORY_HINTS, SUBJECT_MAX, charCount, newId, supportApi,
  type SupportCategory,
} from '../../services/support';
import { searchArticles, useFaq } from '../../components/support/FaqBrowser';
import { CharCounter, IconBubble, LoadingList, Notice, Unavailable } from '../../components/support/SupportUi';
import { CategoryIcon, IconBook } from '../../components/support/SupportIcons';
import SupportPrivacyNotice from '../../components/support/SupportPrivacyNotice';

const DRAFT_SCOPE = 'new';

interface Draft { category: SupportCategory | ''; subject: string; body: string }

function readDraft(ownerId: string | undefined): Draft {
  try {
    const raw = readSupportDraft(ownerId, DRAFT_SCOPE);
    if (raw) {
      const d = JSON.parse(raw) as Partial<Draft>;
      return { category: (d.category as SupportCategory) ?? '', subject: d.subject ?? '', body: d.body ?? '' };
    }
  } catch { /* rascunho ilegível: começa vazio */ }
  return { category: '', subject: '', body: '' };
}

export default function SuporteNova() {
  usePageTitle('Nova solicitação');
  const { load, enabled, refresh } = useSupport();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const related = Number(params.get('relacionada'));
  const relatedNumber = Number.isInteger(related) && related > 0 ? related : undefined;

  const ownerId = useAuth().professional?.id;
  const [draft, setDraft] = useState<Draft>(() => readDraft(ownerId));
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof Draft, string>>>({});
  // Um identificador por formulário: se o envio falhar e a pessoa tentar de novo, a mesma solicitação nunca duplica.
  const attempt = useRef<{ id: string; sig: string } | null>(null);
  const { faq } = useFaq(enabled);

  useEffect(() => {
    writeSupportDraft(ownerId, DRAFT_SCOPE, JSON.stringify(draft));
  }, [draft, ownerId]);

  const suggestions = useMemo(
    () => (faq && draft.subject.trim().length >= 4 ? searchArticles(faq.articles, draft.subject, 3) : []),
    [faq, draft.subject]
  );

  if (load === 'loading') return <LoadingList rows={2} label="Carregando…" />;
  if (!enabled) return <Unavailable />;

  const subjectLen = charCount(draft.subject.trim());
  const bodyLen = charCount(draft.body.trim());

  function validate(): boolean {
    const e: Partial<Record<keyof Draft, string>> = {};
    if (!draft.category) e.category = 'Escolha uma categoria.';
    if (subjectLen < 3) e.subject = 'O assunto precisa ter pelo menos 3 caracteres.';
    else if (subjectLen > SUBJECT_MAX) e.subject = `O assunto pode ter no máximo ${SUBJECT_MAX} caracteres.`;
    if (bodyLen < 1) e.body = 'Descreva o que aconteceu.';
    else if (bodyLen > BODY_MAX) e.body = `A descrição pode ter no máximo ${BODY_MAX} caracteres.`;
    setFieldErrors(e);
    return Object.keys(e).length === 0;
  }

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    if (sending || !validate() || !draft.category) return;
    const subject = draft.subject.trim();
    const body = draft.body.trim();
    const sig = JSON.stringify([draft.category, subject, body, relatedNumber ?? null]);
    if (!attempt.current || attempt.current.sig !== sig) attempt.current = { id: newId(), sig };
    setSending(true);
    setError(null);
    try {
      const { ticket } = await supportApi.create({
        subject, category: draft.category, body, clientRequestId: attempt.current.id, relatedTicketNumber: relatedNumber,
      });
      writeSupportDraft(ownerId, DRAFT_SCOPE, '');
      toast('Solicitação enviada! Nossa equipe responde por aqui.', 'success');
      void refresh();
      navigate(`/suporte/solicitacoes/${ticket.id}`, { replace: true });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível enviar. Seus dados foram mantidos: tente de novo.');
    } finally {
      setSending(false);
    }
  }

  const fieldClass = (k: keyof Draft) => `input ${fieldErrors[k] ? '!border-rose-500' : ''}`;

  return (
    <div className="mx-auto max-w-2xl">
      <header className="page-header">
        <Link to="/suporte" className="inline-flex min-h-[44px] items-center text-sm text-wine-700 underline-offset-2 hover:underline">← Ajuda e suporte</Link>
        <h1 className="mt-2 font-display text-3xl text-wine-800">Nova solicitação</h1>
        <p className="mt-1 text-sm text-ink/60">Conte o que aconteceu. A resposta da equipe chega aqui, na Central.</p>
        {relatedNumber && <p className="mt-2 inline-flex rounded-full bg-wine-50 px-3 py-1 text-xs font-medium text-wine-700 ring-1 ring-inset ring-wine-100">Relacionada à solicitação #{String(relatedNumber).padStart(4, '0')}</p>}
      </header>

      <form onSubmit={submit} noValidate className="space-y-5">
        <fieldset disabled={sending} aria-describedby={fieldErrors.category ? 'sup-cat-err' : undefined}>
          <legend className="mb-2 text-sm font-medium text-ink/80">Sobre o que é?</legend>
          <div role="radiogroup" aria-label="Categoria" aria-invalid={!!fieldErrors.category} className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            {CATEGORIES.map((c) => (
              <label key={c.slug} className="relative cursor-pointer">
                <input
                  type="radio" name="sup-cat" value={c.slug} className="peer sr-only"
                  checked={draft.category === c.slug}
                  onChange={() => setDraft({ ...draft, category: c.slug })}
                />
                <span className={`flex h-full flex-col items-start gap-2.5 rounded-2xl border bg-white p-3.5 sm:flex-row sm:gap-3 transition-all hover:border-wine-300 peer-checked:border-wine-500 peer-checked:bg-wine-50/70 peer-checked:shadow-sm peer-focus-visible:ring-2 peer-focus-visible:ring-wine-400/60 ${fieldErrors.category ? 'border-rose-400' : 'border-wine-100'}`}>
                  <IconBubble size="sm"><CategoryIcon category={c.slug} className="h-[18px] w-[18px]" /></IconBubble>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-ink/90">{c.title}</span>
                    <span className="mt-0.5 block text-xs leading-snug text-ink/55">{CATEGORY_HINTS[c.slug]}</span>
                  </span>
                </span>
              </label>
            ))}
          </div>
          {fieldErrors.category && <p id="sup-cat-err" className="mt-1.5 text-xs text-rose-600">{fieldErrors.category}</p>}
        </fieldset>

        <div>
          <label htmlFor="sup-subject" className="mb-1.5 block text-sm font-medium text-ink/80">Assunto</label>
          <input id="sup-subject" className={fieldClass('subject')} value={draft.subject} aria-invalid={!!fieldErrors.subject} aria-describedby={fieldErrors.subject ? 'sup-subject-err' : undefined}
            onChange={(e) => setDraft({ ...draft, subject: e.target.value })} disabled={sending} autoComplete="off" />
          <div className="mt-1 flex items-start justify-between gap-3">
            <p id="sup-subject-err" className="text-xs text-rose-600">{fieldErrors.subject}</p>
            <CharCounter value={subjectLen} max={SUBJECT_MAX} />
          </div>
          {suggestions.length > 0 && (
            <div className="mt-2.5 rounded-xl border border-gold-400/40 bg-gold-300/10 p-3.5 text-sm">
              <p className="flex items-center gap-2 font-medium text-ink/80"><IconBook className="h-4 w-4 text-gold-700" />Talvez estes artigos já resolvam:</p>
              <ul className="mt-2 space-y-1.5">
                {suggestions.map((a) => (
                  <li key={a.id}>
                    <details className="group rounded-lg bg-white/80 px-3 py-2 ring-1 ring-inset ring-wine-100">
                      <summary className="cursor-pointer list-none font-medium text-wine-800 marker:hidden focus:outline-none focus-visible:ring-2 focus-visible:ring-wine-400/50">{a.title}</summary>
                      <p className="mt-2 whitespace-pre-line text-ink/70">{a.body}</p>
                    </details>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div>
          <label htmlFor="sup-body" className="mb-1.5 block text-sm font-medium text-ink/80">Descrição</label>
          <textarea id="sup-body" className={`${fieldClass('body')} min-h-[140px] resize-y`} rows={6} value={draft.body} aria-invalid={!!fieldErrors.body} aria-describedby={fieldErrors.body ? 'sup-body-err' : undefined}
            onChange={(e) => setDraft({ ...draft, body: e.target.value })} disabled={sending} />
          <div className="mt-1 flex items-start justify-between gap-3">
            <p id="sup-body-err" className="text-xs text-rose-600">{fieldErrors.body}</p>
            <CharCounter value={bodyLen} max={BODY_MAX} />
          </div>
        </div>

        <Notice tone="info">
          <SupportPrivacyNotice />
        </Notice>
        {error && <Notice tone="error">{error}</Notice>}

        <div className="flex flex-wrap justify-end gap-3">
          <Link to="/suporte/solicitacoes" className="btn-secondary min-h-[44px]">Cancelar</Link>
          <button type="submit" className="btn-primary min-h-[44px]" disabled={sending}>
            {sending ? 'Enviando…' : error ? 'Tentar de novo' : 'Enviar solicitação'}
          </button>
        </div>
      </form>
    </div>
  );
}
