import { useCallback, useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { ApiError } from '../../services/api';
import { categoryTitle, normalizeSearch, supportApi, type FaqArticle, type FaqResponse, type SupportCategory } from '../../services/support';
import { EmptyBox, ErrorBox, IconBubble, LoadingList } from './SupportUi';
import { CategoryIcon, IconBook, IconChevronDown, IconSearch } from './SupportIcons';

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
    <li className={`border-b border-wine-100 transition-colors last:border-b-0 ${open ? 'bg-wine-50/40' : ''}`}>
      <h3>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={onToggle}
          className="flex min-h-[48px] w-full items-center justify-between gap-3 px-4 py-3 text-left text-[15px] font-medium text-ink/90 transition-colors hover:text-wine-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-wine-400/50"
        >
          <span>{article.title}</span>
          <IconChevronDown className={`h-4 w-4 shrink-0 text-wine-500 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
        </button>
      </h3>
      {open && (
        <div id={id} className="animate-fade-in-up whitespace-pre-line px-4 pb-5 text-sm leading-relaxed text-ink/75">
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
      <EmptyBox title="Ainda não há artigos publicados" icon={<IconBook className="h-6 w-6" />} action={emptyAction}>
        Se precisar de ajuda agora, abra uma solicitação e nossa equipe responde por aqui.
      </EmptyBox>
    );
  }

  return (
    <div>
      <label htmlFor={searchId} className="sr-only">Buscar na ajuda</label>
      <div className="relative">
        <IconSearch className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-wine-400" />
        <input
          id={searchId}
          type="search"
          className="input !pl-10"
          placeholder="Buscar na ajuda (ex.: bloquear horário)"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          autoFocus={autoFocus}
          autoComplete="off"
        />
      </div>

      {categories.length > 1 && (
        <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Categorias">
          {([{ slug: 'all' as const, title: 'Todas' }, ...categories]).map((c) => (
            <button
              key={c.slug}
              type="button"
              aria-pressed={category === c.slug}
              onClick={() => setCategory(c.slug)}
              className={`inline-flex min-h-[38px] items-center gap-1.5 rounded-full px-3.5 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-wine-400/50 ${
                category === c.slug ? 'bg-wine-600 text-white shadow-sm' : 'bg-white text-wine-700 ring-1 ring-inset ring-wine-100 hover:bg-wine-50'
              }`}
            >
              {c.slug !== 'all' && <CategoryIcon category={c.slug} className="h-4 w-4" />}
              {c.title}
            </button>
          ))}
        </div>
      )}

      <div className={compact ? 'mt-4' : 'mt-6'} aria-live="polite">
        {grouped.length === 0 ? (
          <EmptyBox title="Nada encontrado" icon={<IconSearch className="h-6 w-6" />} action={emptyAction}>
            Não achamos um artigo para essa busca. Tente outras palavras ou abra uma solicitação.
          </EmptyBox>
        ) : (
          grouped.map((g) => (
            <section key={g.category.slug} className="mb-5 last:mb-0">
              <h2 className="mb-2 flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-wine-600">
                <IconBubble size="sm"><CategoryIcon category={g.category.slug} className="h-4 w-4" /></IconBubble>
                {categoryTitle(g.category.slug)}
              </h2>
              <ul className="overflow-hidden rounded-2xl border border-wine-100 bg-white shadow-sm">
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
