import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import LogoMark from './LogoMark';
import type { GuiaImagem } from '../content/guiaRapido';

/** Renderiza **trechos em destaque** de um texto simples. */
export function Destaque({ texto }: { texto: string }) {
  const partes = texto.split(/\*\*(.+?)\*\*/g);
  return (
    <>
      {partes.map((p, i) =>
        i % 2 === 1 ? (
          <strong key={i} className="font-semibold text-wine-800">{p}</strong>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

/** Cabeçalho + rodapé das páginas públicas do guia (não exige login). */
export function GuiaShell({ children }: { children: ReactNode }) {
  const { professional } = useAuth();
  const dentro = !!professional;
  const voltar = professional?.isAdmin ? '/admin' : '/';

  return (
    <div className="min-h-screen flex flex-col bg-cream print:bg-white print:min-h-0">
      <header className="bg-wine-700 text-cream print:hidden">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
          <Link to="/ajuda" className="flex items-center gap-2.5 min-w-0">
            <LogoMark className="w-5 h-5 shrink-0" />
            <span className="font-display text-xl tracking-tight">NailFlow</span>
            <span className="hidden sm:inline text-xs uppercase tracking-widest text-wine-100/60 pl-2.5 ml-0.5 border-l border-white/15">
              Guia rápido
            </span>
          </Link>
          <div className="flex items-center gap-2 shrink-0">
            {dentro ? (
              <Link to={voltar} className="text-sm font-medium text-cream/90 hover:text-white px-3 py-1.5 rounded-lg hover:bg-white/10 transition-colors">
                Voltar ao NailFlow
              </Link>
            ) : (
              <>
                <Link to="/login" className="text-sm font-medium text-cream/90 hover:text-white px-3 py-1.5 rounded-lg hover:bg-white/10 transition-colors">
                  Entrar
                </Link>
                <Link to="/register" className="text-sm font-semibold text-wine-800 bg-cream hover:bg-white px-3.5 py-1.5 rounded-lg transition-colors">
                  Criar conta
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 w-full max-w-4xl mx-auto px-4 sm:px-6 py-8 sm:py-12 print:py-0 print:px-0 print:max-w-none">{children}</main>

      <footer className="py-6 text-center text-xs text-ink/30 print:hidden">
        NailFlow · Transformando beleza em experiências.
      </footer>
    </div>
  );
}

/** Moldura de “janela” para as capturas de tela; se a imagem não existir, mostra um aviso discreto. */
export function GuiaMoldura({ imagem, imprimir = false }: { imagem: GuiaImagem; imprimir?: boolean }) {
  const [falhou, setFalhou] = useState(false);

  return (
    <figure className={`mt-2 break-inside-avoid ${imagem.estreita ? (imprimir ? 'max-w-[12rem] mx-auto' : 'max-w-sm mx-auto') : imprimir ? 'max-w-[17rem] mx-auto' : ''}`}>
      <div className="rounded-2xl border border-wine-100 bg-white shadow-sm overflow-hidden">
        <div className="flex items-center gap-1.5 px-4 py-2.5 bg-wine-50/60 border-b border-wine-100/70" aria-hidden="true">
          <span className="w-2.5 h-2.5 rounded-full bg-wine-200" />
          <span className="w-2.5 h-2.5 rounded-full bg-gold-300" />
          <span className="w-2.5 h-2.5 rounded-full bg-sage-200" />
        </div>
        {falhou ? (
          <div className="px-6 py-14 text-center text-sm text-ink/40">Imagem em breve</div>
        ) : (
          <img
            src={`/guia/${imagem.arquivo}`}
            alt={imagem.alt}
            loading="lazy"
            onError={() => setFalhou(true)}
            className="w-full h-auto block"
          />
        )}
      </div>
      {imagem.legenda && <figcaption className="mt-2 text-center text-xs text-ink/40">{imagem.legenda}</figcaption>}
    </figure>
  );
}

/** Esquema visual: Horário livre → Cliente → Serviço → Horário → Salvar. */
export function GuiaFluxo({ etapas }: { etapas: string[] }) {
  return (
    <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-2" aria-label="Resumo do caminho">
      {etapas.map((e, i) => (
        <li key={e} className="flex items-center gap-1.5">
          <span className="inline-flex items-center gap-2 rounded-full bg-white border border-wine-100 pl-1.5 pr-3.5 py-1.5 text-sm font-medium text-wine-800 shadow-sm">
            <span className="w-5 h-5 rounded-full bg-wine-600 text-white text-[11px] font-semibold flex items-center justify-center" aria-hidden="true">
              {i + 1}
            </span>
            {e}
          </span>
          {i < etapas.length - 1 && (
            <svg className="w-4 h-4 text-wine-300" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 6l6 6-6 6" />
            </svg>
          )}
        </li>
      ))}
    </ol>
  );
}

const COR_STATUS: Record<string, string> = {
  wine: 'bg-wine-50 text-wine-700 border-wine-200',
  gold: 'bg-amber-50 text-amber-700 border-amber-200',
  sky: 'bg-sky-50 text-sky-700 border-sky-200',
  sage: 'bg-green-50 text-green-700 border-green-200',
  rose: 'bg-rose-50 text-rose-600 border-rose-200',
  gray: 'bg-gray-100 text-gray-500 border-gray-200',
};

export function GuiaStatus({ itens }: { itens: { nome: string; cor: string; significado: string }[] }) {
  return (
    <ul className="space-y-2.5 print:space-y-1.5">
      {itens.map((s) => (
        <li key={s.nome} className="flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-4 bg-white rounded-xl border border-wine-100/70 px-4 py-3 print:py-1 break-inside-avoid">
          <span className={`self-start shrink-0 text-xs font-semibold px-2.5 py-1 print:py-0.5 rounded-full border sm:w-48 text-center ${COR_STATUS[s.cor]}`}>
            {s.nome}
          </span>
          <span className="text-sm print:text-[12px] text-ink/65 leading-snug">{s.significado}</span>
        </li>
      ))}
    </ul>
  );
}

export function GuiaDica({ texto }: { texto: string }) {
  return (
    <aside className="rounded-xl bg-gold-300/20 border border-gold-300/60 px-5 py-4 flex gap-3 break-inside-avoid">
      <span className="mt-0.5 text-gold-600 shrink-0" aria-hidden="true">
        <LogoMark className="w-4 h-4" />
      </span>
      <p className="text-sm text-ink/75 leading-relaxed">
        <strong className="font-semibold text-wine-800">Dica: </strong>
        <Destaque texto={texto} />
      </p>
    </aside>
  );
}

export function GuiaOpcional({ titulo, texto }: { titulo: string; texto: string }) {
  return (
    <aside className="rounded-xl bg-sage-100 border border-sage-200 px-5 py-4 break-inside-avoid">
      <p className="text-[11px] uppercase tracking-widest font-semibold text-sage-500">Opcional</p>
      <p className="font-display text-lg text-wine-800 mt-0.5">{titulo}</p>
      <p className="text-sm text-ink/70 leading-relaxed mt-1">
        <Destaque texto={texto} />
      </p>
    </aside>
  );
}

/** Lista numerada (passo a passo) ou lista simples. */
export function GuiaLista({ itens, numerada }: { itens: string[]; numerada: boolean }) {
  return (
    <ol className="space-y-3 print:space-y-2">
      {itens.map((t, i) => (
        <li key={i} className="flex gap-3.5 break-inside-avoid">
          {numerada ? (
            <span className="mt-0.5 w-6 h-6 rounded-full bg-wine-600 text-white text-xs font-semibold flex items-center justify-center shrink-0" aria-hidden="true">
              {i + 1}
            </span>
          ) : (
            <span className="mt-2 w-2 h-2 rounded-full bg-gold-500 shrink-0" aria-hidden="true" />
          )}
          <p className="text-[15px] text-ink/80 leading-relaxed">
            <Destaque texto={t} />
          </p>
        </li>
      ))}
    </ol>
  );
}
