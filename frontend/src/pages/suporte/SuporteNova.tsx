import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ApiError } from '../../services/api';
import { usePageTitle } from '../../hooks/usePageTitle';
import { useSupport } from '../../context/SupportContext';
import { useToast } from '../../context/ToastContext';
import {
  BODY_MAX, CATEGORIES, PRIVACY_NOTICE, SUBJECT_MAX, charCount, newId, supportApi,
  type SupportCategory,
} from '../../services/support';
import { searchArticles, useFaq } from '../../components/support/FaqBrowser';
import { CharCounter, LoadingList, Notice, Unavailable } from '../../components/support/SupportUi';

const DRAFT_KEY = 'nf_support_new_draft';

interface Draft { category: SupportCategory | ''; subject: string; body: string }

function readDraft(): Draft {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
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

  const [draft, setDraft] = useState<Draft>(readDraft);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof Draft, string>>>({});
  // Um identificador por formulário: se o envio falhar e a pessoa tentar de novo, a mesma solicitação nunca duplica.
  const attempt = useRef<{ id: string; sig: string } | null>(null);
  const { faq } = useFaq(enabled);

  useEffect(() => {
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); } catch { /* sem armazenamento */ }
  }, [draft]);

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
      try { localStorage.removeItem(DRAFT_KEY); } catch { /* ok */ }
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
        {relatedNumber && <p className="mt-1 text-sm text-ink/60">Relacionada à solicitação #{String(relatedNumber).padStart(4, '0')}.</p>}
      </header>

      <form onSubmit={submit} noValidate className="space-y-5">
        <div>
          <label htmlFor="sup-cat" className="mb-1.5 block text-sm font-medium text-ink/80">Categoria</label>
          <select id="sup-cat" className={fieldClass('category')} value={draft.category} aria-invalid={!!fieldErrors.category} aria-describedby={fieldErrors.category ? 'sup-cat-err' : undefined}
            onChange={(e) => setDraft({ ...draft, category: e.target.value as SupportCategory | '' })} disabled={sending}>
            <option value="">Selecione…</option>
            {CATEGORIES.map((c) => <option key={c.slug} value={c.slug}>{c.title}</option>)}
          </select>
          {fieldErrors.category && <p id="sup-cat-err" className="mt-1 text-xs text-rose-600">{fieldErrors.category}</p>}
        </div>

        <div>
          <label htmlFor="sup-subject" className="mb-1.5 block text-sm font-medium text-ink/80">Assunto</label>
          <input id="sup-subject" className={fieldClass('subject')} value={draft.subject} aria-invalid={!!fieldErrors.subject} aria-describedby={fieldErrors.subject ? 'sup-subject-err' : undefined}
            onChange={(e) => setDraft({ ...draft, subject: e.target.value })} disabled={sending} autoComplete="off" />
          <div className="mt-1 flex items-start justify-between gap-3">
            <p id="sup-subject-err" className="text-xs text-rose-600">{fieldErrors.subject}</p>
            <CharCounter value={subjectLen} max={SUBJECT_MAX} />
          </div>
          {suggestions.length > 0 && (
            <div className="mt-2 rounded-xl border border-wine-100 bg-wine-50/60 p-3 text-sm">
              <p className="font-medium text-ink/80">Talvez estes artigos já resolvam:</p>
              <ul className="mt-1.5 list-disc space-y-1 pl-5 text-ink/70">
                {suggestions.map((a) => <li key={a.id}>{a.title}</li>)}
              </ul>
              <Link to="/suporte" className="mt-2 inline-block font-medium text-wine-700 underline underline-offset-2">Abrir a ajuda para ler</Link>
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
          Não é possível enviar anexos nesta versão. {PRIVACY_NOTICE}
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
