import { Link } from 'react-router-dom';
import { GUIA_COMECO, GUIA_PASSOS, GUIA_SUBTITULO, GUIA_TITULO, getPasso } from '../content/guiaRapido';
import { GuiaShell } from '../components/GuiaPecas';

function IconSeta() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 6l6 6-6 6" />
    </svg>
  );
}

export default function Ajuda() {
  return (
    <GuiaShell>
      <div className="space-y-10 sm:space-y-12">
        {/* abertura */}
        <section className="rounded-3xl bg-wine-800 text-cream px-6 sm:px-10 py-9 sm:py-12 relative overflow-hidden">
          <div className="absolute -right-10 -top-10 w-48 h-48 rounded-full border border-white/[0.07]" aria-hidden="true" />
          <div className="absolute -right-2 -top-2 w-28 h-28 rounded-full border border-white/[0.10]" aria-hidden="true" />
          <p className="text-wine-300 text-[11px] uppercase tracking-widest font-semibold relative">Primeiros passos</p>
          <h1 className="font-display text-3xl sm:text-4xl leading-tight mt-2 relative">{GUIA_TITULO}</h1>
          <p className="text-wine-200 text-base mt-2 max-w-md relative">{GUIA_SUBTITULO}</p>
          <div className="mt-6 flex flex-wrap gap-3 relative">
            <Link
              to={`/ajuda/${GUIA_PASSOS[0].slug}`}
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-wine-800 bg-cream hover:bg-white transition-colors rounded-xl px-5 py-2.5"
            >
              Começar o guia
              <IconSeta />
            </Link>
            <Link
              to="/ajuda/imprimir"
              className="inline-flex items-center text-sm font-medium text-cream/90 border border-white/25 hover:bg-white/10 transition-colors rounded-xl px-5 py-2.5"
            >
              Versão para imprimir / PDF
            </Link>
          </div>
        </section>

        {/* comece por aqui */}
        <section>
          <h2 className="font-display text-xl sm:text-2xl text-wine-800">Está começando agora?</h2>
          <p className="text-sm text-ink/50 mt-1">Veja como deixar seu NailFlow pronto para receber agendamentos.</p>
          <ul className="mt-5 grid sm:grid-cols-2 gap-3">
            {GUIA_COMECO.map((c, i) => {
              const passo = getPasso(c.slug)!;
              return (
                <li key={c.slug}>
                  <Link
                    to={`/ajuda/${c.slug}`}
                    className="group flex items-center gap-4 h-full bg-white rounded-2xl border border-wine-100/80 shadow-sm px-5 py-4 hover:border-wine-300 hover:shadow-md transition-all"
                  >
                    <span className="w-10 h-10 rounded-full bg-wine-50 text-wine-700 font-display text-lg flex items-center justify-center shrink-0" aria-hidden="true">
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block font-medium text-ink/85 leading-snug">{c.titulo}</span>
                      <span className="block text-xs text-ink/45 mt-0.5">{c.texto}</span>
                    </span>
                    <span className="text-wine-400 group-hover:text-wine-700 transition-colors" aria-label={`Abrir etapa ${passo.numero}`}>
                      <IconSeta />
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>

        {/* todas as etapas */}
        <section>
          <h2 className="font-display text-xl sm:text-2xl text-wine-800">O guia completo, passo a passo</h2>
          <ol className="mt-5 bg-white rounded-2xl border border-wine-100/80 shadow-sm divide-y divide-wine-50 overflow-hidden">
            {GUIA_PASSOS.map((p) => (
              <li key={p.slug}>
                <Link to={`/ajuda/${p.slug}`} className="group flex items-center gap-4 px-5 py-3.5 hover:bg-wine-50/50 transition-colors">
                  <span className="font-display text-lg text-wine-300 w-7 shrink-0 tabular-nums" aria-hidden="true">
                    {String(p.numero).padStart(2, '0')}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-medium text-ink/85">{p.titulo}</span>
                    <span className="block text-xs text-ink/45 truncate">{p.resumo}</span>
                  </span>
                  <span className="text-wine-300 group-hover:text-wine-700 transition-colors">
                    <IconSeta />
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </GuiaShell>
  );
}
