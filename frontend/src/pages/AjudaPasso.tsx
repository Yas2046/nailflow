import { useEffect } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { GUIA_PASSOS, getPasso } from '../content/guiaRapido';
import { GuiaShell } from '../components/GuiaPecas';
import GuiaCorpo from '../components/GuiaCorpo';

export default function AjudaPasso() {
  const { passo: slug } = useParams();
  const { professional } = useAuth();
  const passo = getPasso(slug);

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [slug]);

  if (!passo) return <Navigate to="/ajuda" replace />;

  const idx = GUIA_PASSOS.findIndex((p) => p.slug === passo.slug);
  const anterior = GUIA_PASSOS[idx - 1];
  const proximo = GUIA_PASSOS[idx + 1];
  const total = GUIA_PASSOS.length;
  const logadaProfissional = !!professional && !professional.isAdmin;
  const pct = Math.round((passo.numero / total) * 100);

  return (
    <GuiaShell>
      <article className="space-y-7">
        <div>
          <Link to="/ajuda" className="text-sm text-ink/45 hover:text-wine-700 transition-colors">
            ← Voltar para o guia
          </Link>

          <div className="mt-4 flex items-center gap-3">
            <div
              className="flex-1 h-1.5 rounded-full bg-wine-50 overflow-hidden"
              role="progressbar"
              aria-valuenow={passo.numero}
              aria-valuemin={1}
              aria-valuemax={total}
              aria-label="Progresso do guia"
            >
              <div className="h-full rounded-full bg-wine-600" style={{ width: `${pct}%` }} />
            </div>
            <span className="text-xs font-semibold text-wine-700 tabular-nums shrink-0">
              Passo {passo.numero} de {total}
            </span>
          </div>

          <h1 className="font-display text-3xl sm:text-4xl text-wine-800 leading-tight mt-5">{passo.titulo}</h1>
          <p className="text-base text-ink/60 mt-2 max-w-xl leading-relaxed">{passo.resumo}</p>
        </div>

        <GuiaCorpo passo={passo} />

        {/* atalhos */}
        <div className="flex flex-wrap gap-3">
          {logadaProfissional && passo.atalho && (
            <Link to={passo.atalho.to} className="btn-primary">
              {passo.atalho.label}
            </Link>
          )}
          {!professional && passo.slug === 'criando-sua-conta' && (
            <Link to="/register" className="btn-primary">Criar minha conta</Link>
          )}
          {!professional && passo.slug === 'e-agora' && (
            <>
              <Link to="/register" className="btn-primary">Criar minha conta</Link>
              <Link to="/login" className="btn-secondary">Já tenho conta</Link>
            </>
          )}
        </div>

        {/* anterior / próximo */}
        <nav className="flex items-center justify-between gap-3 pt-6 border-t border-wine-100/70" aria-label="Navegar entre as etapas">
          {anterior ? (
            <Link
              to={`/ajuda/${anterior.slug}`}
              className="btn-secondary"
              aria-label={`Etapa anterior: ${anterior.titulo}`}
              title={anterior.titulo}
            >
              ← Anterior
            </Link>
          ) : (
            <span />
          )}
          {proximo && (
            <Link
              to={`/ajuda/${proximo.slug}`}
              className="btn-primary"
              aria-label={`Próxima etapa: ${proximo.titulo}`}
              title={proximo.titulo}
            >
              Próxima →
            </Link>
          )}
        </nav>
      </article>
    </GuiaShell>
  );
}
