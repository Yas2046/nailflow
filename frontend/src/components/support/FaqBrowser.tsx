import { useCallback, useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { ApiError } from '../../services/api';
import { categoryTitle, normalizeSearch, supportApi, type FaqArticle, type FaqResponse, type SupportCategory } from '../../services/support';
import { EmptyBox, ErrorBox, LoadingList } from './SupportUi';

/** Carrega a FAQ publicada (GET /support/faq). Com `enabled` falso (Central desligada) não chama a API. */
export function useFaq(enabled = true) {
  const [faq, setFaq] = useState<FaqResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setFaq(await supportApi.faq());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Verifique sua conexão e tente de novo.');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { if (enabled) void load(); }, [enabled, load]);
  return { faq, error, loading, reload: load };
}

/** Artigos que casam com o texto (assunto/título/corpo), sem acentos nem diferença de caixa. */
export function searchArticles(articles: FaqArticle[], text: string, limit = Infinity): FaqArticle[] {
  const terms = normalizeSearch(text).split(/\s+/).filter((t) => t.length >= 2);
  if (terms.length === 0) return [];
  const scored = articles
    .map((a) => {
      const title = normalizeSearch(a.title);
      const body = normalizeSearch(a.body);
      let score = 0;
      for (const t of terms) {
        if (title.includes(t)) score += 3;
        else if (body.includes(t)) score += 1;
        else return { a, score: -1 };
      }
      return { a, score };
    })
    .filter((x) => x.score > 0)
    .sort((x, y) => y.score - x.score);
  return scored.slice(0, limit).map((x) => x.a);
}

function Article({ article, open, onToggle }: { article: FaqArticle; open: boolean; onToggle: () => void }) {
  const id = useId();
  return (
    <li className="border-b border-wine-100 last:border-b-0">
      <h3>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={onToggle}
          className="flex min-h-[44px] w-full items-center justify-between gap-3 px-1 py-3 text-left text-[15px] font-medium text-ink/90 hover:text-wine-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-wine-400/50"
        >
          <span>{article.title}</span>
          <svg className={`h-4 w-4 shrink-0 text-wine-500 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" />
          </svg>
        </button>
      </h3>
      {open && (
        <div id={id} className="whitespace-pre-line px-1 pb-4 text-sm leading-relaxed text-ink/75">
          {article.body}
        </div>
      )}
    </li>
  );
}

/**
 * Navegação da FAQ: busca no navegador sobre os artigos já carregados, categorias (as vazias ficam ocultas) e
 * respostas expansíveis. `emptyAction` aparece quando não há resultado ou não há artigo publicado.
 */
export function FaqBrowser({
  faq, loading, error, onRetry, query, onQueryChange, compact = false, emptyAction, autoFocus = false,
}: {
  faq: FaqResponse | null; loading: boolean; error: string | null; onRetry: () => void;
  query: string; onQueryChange: (q: string) => void; compact?: boolean; emptyAction?: ReactNode; autoFocus?: boolean;
}) {
  const [category, setCategory] = useState<SupportCategory | 'all'>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const searchId = useId();

  const categories = useMemo(() => {
    if (!faq) return [];
    return faq.categories.filter((c) => faq.articles.some((a) => a.categorySlug === c.slug));
  }, [faq]);

  const visible = useMemo(() => {
    if (!faq) return [];
    const base = category === 'all' ? faq.articles : faq.articles.filter((a) => a.categorySlug === category);
    return query.trim() ? searchArticles(base, query) : base;
  }, [faq, category, query]);

  const grouped = useMemo(() => {
    const order = faq?.categories ?? [];
    return order
      .map((c) => ({ category: c, items: visible.filter((a) => a.categorySlug === c.slug) }))
      .filter((g) => g.items.length > 0);
  }, [faq, visible]);

  if (loading) return <LoadingList rows={3} label="Carregando a ajuda…" />;
  if (error) return <ErrorBox message={error} onRetry={onRetry} />;
  if (!faq || faq.articles.length === 0) {
    return (
      <EmptyBox title="Ainda não há artigos publicados" action={emptyAction}>
        Se precisar de ajuda agora, abra uma solicitação e nossa equipe responde por aqui.
      </EmptyBox>
    );
  }

  return (
    <div>
      <label htmlFor={searchId} className="sr-only">Buscar na ajuda</label>
      <input
        id={searchId}
        type="search"
        className="input"
        placeholder="Buscar na ajuda (ex.: bloquear horário)"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        autoFocus={autoFocus}
        autoComplete="off"
      />

      {categories.length > 1 && (
        <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Categorias">
          {([{ slug: 'all' as const, title: 'Todas' }, ...categories]).map((c) => (
            <button
              key={c.slug}
              type="button"
              aria-pressed={category === c.slug}
              onClick={() => setCategory(c.slug)}
              className={`min-h-[36px] rounded-full px-3.5 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-wine-400/50 ${
                category === c.slug ? 'bg-wine-600 text-white' : 'bg-wine-50 text-wine-700 hover:bg-wine-100'
              }`}
            >
              {c.title}
            </button>
          ))}
        </div>
      )}

      <div className={compact ? 'mt-4' : 'mt-6'} aria-live="polite">
        {grouped.length === 0 ? (
          <EmptyBox title="Nada encontrado" action={emptyAction}>
            Não achamos um artigo para essa busca. Tente outras palavras ou abra uma solicitação.
          </EmptyBox>
        ) : (
          grouped.map((g) => (
            <section key={g.category.slug} className="mb-5 last:mb-0">
              <h2 className="mb-1 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-wine-600">{categoryTitle(g.category.slug)}</h2>
              <ul className="rounded-2xl border border-wine-100 bg-white px-4">
                {g.items.map((a) => (
                  <Article key={a.id} article={a} open={openId === a.id} onToggle={() => setOpenId(openId === a.id ? null : a.id)} />
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
    </div>
  );
}
