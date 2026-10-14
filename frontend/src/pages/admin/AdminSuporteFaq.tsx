import { useCallback, useEffect, useId, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ApiError } from '../../services/api';
import { useToast } from '../../context/ToastContext';
import { usePageTitle } from '../../hooks/usePageTitle';
import { PageHeader } from '../../components/admin-account/AccountUi';
import { Modal } from '../../components/admin-professionals/Modal';
import { useAdminShell } from '../../components/adminShell';
import {
  CATEGORIES, FAQ_BODY_MAX, FAQ_TITLE_MAX, adminSupportApi, categoryTitle, charCount,
  type AdminArticle, type AdminFaqResponse, type SupportCategory,
} from '../../services/support';
import { CharCounter, EmptyBox, ErrorBox, LoadingList, Notice, Unavailable } from '../../components/support/SupportUi';

interface EditorState { mode: 'create' | 'edit'; article: AdminArticle | null; category: SupportCategory }

function ArticleEditor({ state, onClose, onSaved }: { state: EditorState; onClose: () => void; onSaved: (a: AdminArticle) => void }) {
  const titleId = useId();
  const { toast } = useToast();
  const a = state.article;
  const [category, setCategory] = useState<SupportCategory>(a?.categorySlug ?? state.category);
  const [title, setTitle] = useState(a?.title ?? '');
  const [body, setBody] = useState(a?.body ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errs, setErrs] = useState<{ title?: string; body?: string }>({});
  const titleLen = charCount(title.trim());
  const bodyLen = charCount(body.trim());

  function validate() {
    const e: { title?: string; body?: string } = {};
    if (titleLen < 3) e.title = 'O título precisa ter pelo menos 3 caracteres.';
    else if (titleLen > FAQ_TITLE_MAX) e.title = `O título pode ter no máximo ${FAQ_TITLE_MAX} caracteres.`;
    if (bodyLen < 1) e.body = 'O texto não pode ficar em branco.';
    else if (bodyLen > FAQ_BODY_MAX) e.body = `O texto pode ter no máximo ${FAQ_BODY_MAX} caracteres.`;
    setErrs(e);
    return Object.keys(e).length === 0;
  }

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    if (saving || !validate()) return;
    setSaving(true);
    setError(null);
    const input = { categorySlug: category, title: title.trim(), body: body.trim() };
    try {
      const r = a ? await adminSupportApi.updateArticle(a.id, input) : await adminSupportApi.createArticle(input);
      toast(a ? 'Artigo atualizado.' : 'Artigo criado como rascunho.', 'success');
      onSaved(r.article);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível salvar. Tente de novo.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal titleId={titleId} busy={saving} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <h3 id={titleId} className="mb-4 font-display text-xl text-wine-800">{a ? 'Editar artigo' : 'Novo artigo'}</h3>
        <div className="space-y-4">
          <div>
            <label htmlFor="faq-cat" className="mb-1 block text-sm font-medium text-ink/80">Categoria</label>
            <select id="faq-cat" className="input" value={category} onChange={(e) => setCategory(e.target.value as SupportCategory)} disabled={saving}>
              {CATEGORIES.map((c) => <option key={c.slug} value={c.slug}>{c.title}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="faq-title" className="mb-1 block text-sm font-medium text-ink/80">Título</label>
            <input id="faq-title" data-autofocus className="input" value={title} onChange={(e) => setTitle(e.target.value)} disabled={saving} aria-invalid={!!errs.title} autoComplete="off" />
            <div className="mt-1 flex justify-between gap-3"><p className="text-xs text-rose-600">{errs.title}</p><CharCounter value={titleLen} max={FAQ_TITLE_MAX} /></div>
          </div>
          <div>
            <label htmlFor="faq-body" className="mb-1 block text-sm font-medium text-ink/80">Texto da resposta</label>
            <textarea id="faq-body" className="input min-h-[180px] resize-y" rows={8} value={body} onChange={(e) => setBody(e.target.value)} disabled={saving} aria-invalid={!!errs.body} aria-describedby="faq-body-hint" />
            <div className="mt-1 flex justify-between gap-3">
              <p id="faq-body-hint" className="text-xs text-ink/55">Texto simples. Use linhas e passos numerados (1., 2., 3.).</p>
              <CharCounter value={bodyLen} max={FAQ_BODY_MAX} />
            </div>
            {errs.body && <p className="text-xs text-rose-600">{errs.body}</p>}
          </div>
          {!a && <Notice tone="info">O artigo é criado como rascunho: a profissional só o vê depois de publicado.</Notice>}
          {error && <Notice tone="error">{error}</Notice>}
        </div>
        <div className="mt-6 flex gap-3">
          <button type="button" className="btn-secondary flex-1" onClick={onClose} disabled={saving}>Cancelar</button>
          <button type="submit" className="btn-primary flex-1" disabled={saving}>{saving ? 'Salvando…' : 'Salvar'}</button>
        </div>
      </form>
    </Modal>
  );
}

function ConfirmUnpublish({ article, busy, onCancel, onConfirm }: { article: AdminArticle; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  const titleId = useId();
  return (
    <Modal titleId={titleId} busy={busy} onClose={onCancel}>
      <h3 id={titleId} className="mb-2 font-display text-xl text-wine-800">Despublicar este artigo?</h3>
      <p className="mb-5 text-sm leading-relaxed text-ink/70">
        “{article.title}” deixa de aparecer para as profissionais. As solicitações já abertas não mudam, e você pode publicá-lo de novo quando quiser.
      </p>
      <div className="flex gap-3">
        <button type="button" className="btn-secondary flex-1" data-autofocus onClick={onCancel} disabled={busy}>Cancelar</button>
        <button type="button" className="btn-primary flex-1" onClick={onConfirm} disabled={busy}>{busy ? 'Despublicando…' : 'Despublicar'}</button>
      </div>
    </Modal>
  );
}

export default function AdminSuporteFaq() {
  usePageTitle('FAQ · Suporte');
  const { toast } = useToast();
  const shell = useAdminShell();
  const [data, setData] = useState<AdminFaqResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ message: string; off: boolean } | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [unpublishing, setUnpublishing] = useState<AdminArticle | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) { setLoading(true); setError(null); }
    try {
      setData(await adminSupportApi.faq());
    } catch (e) {
      if (!silent) setError({ message: e instanceof ApiError ? e.message : 'Verifique sua conexão e tente de novo.', off: e instanceof ApiError && e.status === 404 });
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const byCategory = useMemo(() => {
    const map = new Map<SupportCategory, AdminArticle[]>();
    for (const c of CATEGORIES) map.set(c.slug, []);
    for (const a of data?.articles ?? []) map.get(a.categorySlug)?.push(a);
    for (const list of map.values()) list.sort((x, y) => x.position - y.position || x.title.localeCompare(y.title));
    return map;
  }, [data]);

  if (shell?.support.checked && !shell.support.enabled) return <Unavailable />;
  if (error?.off) return <Unavailable />;

  async function run(article: AdminArticle, fn: () => Promise<unknown>, okMessage: string) {
    setBusyId(article.id);
    try {
      await fn();
      toast(okMessage, 'success');
      await load(true);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Não foi possível concluir a ação.', 'error');
    } finally {
      setBusyId(null);
    }
  }

  async function move(category: SupportCategory, article: AdminArticle, delta: -1 | 1) {
    const list = byCategory.get(category) ?? [];
    const i = list.findIndex((a) => a.id === article.id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= list.length) return;
    const ids = list.map((a) => a.id);
    [ids[i], ids[j]] = [ids[j], ids[i]];
    await run(article, () => adminSupportApi.reorder(category, ids), 'Ordem atualizada.');
  }

  const total = data?.articles.length ?? 0;

  return (
    <div>
      <PageHeader
        eyebrow="Suporte"
        title="FAQ"
        subtitle="Artigos que as profissionais encontram na central de ajuda. Rascunhos não aparecem para elas até serem publicados."
        actions={(
          <>
            <Link to="/admin/suporte" className="btn-secondary">Solicitações</Link>
            <button type="button" className="btn-primary" onClick={() => setEditor({ mode: 'create', article: null, category: 'agenda' })}>Novo artigo</button>
          </>
        )}
      />

      {loading ? (
        <LoadingList rows={4} label="Carregando a FAQ…" />
      ) : error ? (
        <ErrorBox message={error.message} onRetry={() => void load()} />
      ) : total === 0 ? (
        <EmptyBox title="Nenhum artigo ainda" action={<button type="button" className="btn-primary" onClick={() => setEditor({ mode: 'create', article: null, category: 'agenda' })}>Criar o primeiro artigo</button>}>
          Crie artigos para responder as dúvidas mais comuns. Eles começam como rascunho.
        </EmptyBox>
      ) : (
        <div className="space-y-8">
          {CATEGORIES.map((c) => {
            const list = byCategory.get(c.slug) ?? [];
            return (
              <section key={c.slug} aria-labelledby={`cat-${c.slug}`}>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <h2 id={`cat-${c.slug}`} className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-wine-600">
                    {categoryTitle(c.slug)} · {list.length}
                  </h2>
                  <button type="button" className="btn-ghost !py-1 text-sm" onClick={() => setEditor({ mode: 'create', article: null, category: c.slug })}>+ Artigo</button>
                </div>
                {list.length === 0 ? (
                  <p className="rounded-2xl border border-dashed border-wine-200 bg-white px-4 py-5 text-sm text-ink/55">Nenhum artigo nesta categoria.</p>
                ) : (
                  <ul className="divide-y divide-wine-100 overflow-hidden rounded-2xl border border-wine-100 bg-white">
                    {list.map((a, i) => {
                      const busy = busyId === a.id;
                      return (
                        <li key={a.id} className="p-4">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <p className="break-words text-[15px] font-medium text-ink/90">{a.title}</p>
                              <p className="mt-0.5 text-xs text-ink/55">Posição {i + 1}</p>
                            </div>
                            <span className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${a.status === 'publicado' ? 'bg-sage-100 text-sage-700 ring-sage-200' : 'bg-wine-50 text-wine-700 ring-wine-200'}`}>
                              {a.status === 'publicado' ? 'Publicado' : 'Rascunho'}
                            </span>
                          </div>
                          <div className="mt-3 flex flex-wrap items-center gap-2">
                            <button type="button" className="btn-secondary !px-3 !py-1.5 text-sm" onClick={() => setEditor({ mode: 'edit', article: a, category: a.categorySlug })} disabled={busy}>Editar</button>
                            {a.status === 'publicado'
                              ? <button type="button" className="btn-secondary !px-3 !py-1.5 text-sm" onClick={() => setUnpublishing(a)} disabled={busy}>Despublicar</button>
                              : <button type="button" className="btn-primary !px-3 !py-1.5 text-sm" onClick={() => void run(a, () => adminSupportApi.publish(a.id), 'Artigo publicado.')} disabled={busy}>{busy ? 'Publicando…' : 'Publicar'}</button>}
                            <button type="button" className="btn-ghost !px-3 !py-1.5 text-sm" aria-expanded={preview === a.id} onClick={() => setPreview(preview === a.id ? null : a.id)}>Prévia</button>
                            <span className="ml-auto flex gap-1">
                              <button type="button" aria-label={`Subir “${a.title}”`} className="btn-ghost !px-2.5 !py-1.5 text-sm" onClick={() => void move(c.slug, a, -1)} disabled={busy || i === 0}>↑</button>
                              <button type="button" aria-label={`Descer “${a.title}”`} className="btn-ghost !px-2.5 !py-1.5 text-sm" onClick={() => void move(c.slug, a, 1)} disabled={busy || i === list.length - 1}>↓</button>
                            </span>
                          </div>
                          {preview === a.id && (
                            <div className="mt-3 rounded-xl border border-wine-100 bg-cream p-4">
                              <p className="mb-1 font-mono text-[11px] uppercase tracking-[0.14em] text-ink/55">Como a profissional vê</p>
                              <p className="font-medium text-ink/90">{a.title}</p>
                              <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-ink/75">{a.body}</p>
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}

      {editor && <ArticleEditor state={editor} onClose={() => setEditor(null)} onSaved={() => { setEditor(null); void load(true); }} />}
      {unpublishing && (
        <ConfirmUnpublish
          article={unpublishing}
          busy={busyId === unpublishing.id}
          onCancel={() => setUnpublishing(null)}
          onConfirm={() => { const a = unpublishing; void run(a, () => adminSupportApi.unpublish(a.id), 'Artigo despublicado.').then(() => setUnpublishing(null)); }}
        />
      )}
    </div>
  );
}
