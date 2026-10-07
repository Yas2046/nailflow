import type { ReactNode } from 'react';
import { GUIA_STATUS, type GuiaPasso } from '../content/guiaRapido';
import {
  GuiaDica, GuiaFluxo, GuiaLista, GuiaMoldura, GuiaOpcional, GuiaStatus, Destaque,
} from './GuiaPecas';

function IconCheck() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={3} viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  );
}

function GuiaImportante({ titulo, texto }: { titulo: string; texto: string }) {
  return (
    <aside className="rounded-xl bg-wine-50 border border-wine-200 px-5 py-4 flex gap-3.5 break-inside-avoid">
      <span className="mt-0.5 w-6 h-6 rounded-full bg-wine-600 text-white text-sm font-semibold flex items-center justify-center shrink-0" aria-hidden="true">
        !
      </span>
      <div>
        <p className="font-display text-lg text-wine-800 leading-snug">{titulo}</p>
        <p className="text-[15px] text-ink/75 leading-relaxed mt-1">
          <Destaque texto={texto} />
        </p>
      </div>
    </aside>
  );
}

function GuiaFeito({ itens }: { itens: string[] }) {
  return (
    <ul className="space-y-2.5">
      {itens.map((t) => (
        <li key={t} className="flex items-center gap-3.5 break-inside-avoid">
          <span className="w-6 h-6 rounded-full bg-sage-500 text-white flex items-center justify-center shrink-0" aria-hidden="true">
            <IconCheck />
          </span>
          <p className="text-[15px] text-ink/80 leading-relaxed">{t}</p>
        </li>
      ))}
    </ul>
  );
}

function Subtitulo({ children }: { children: ReactNode }) {
  return <h2 className="font-display text-xl text-wine-800 break-after-avoid">{children}</h2>;
}

/** Conteúdo de uma etapa (usado na página da etapa e na versão para imprimir). */
export default function GuiaCorpo({ passo, imprimir = false }: { passo: GuiaPasso; imprimir?: boolean }) {
  return (
    <div className={imprimir ? 'space-y-3' : 'space-y-7'}>
      {passo.fluxo && <GuiaFluxo etapas={passo.fluxo} />}

      {passo.itens && <GuiaLista itens={passo.itens} numerada />}
      {passo.importante && <GuiaImportante titulo={passo.importante.titulo} texto={passo.importante.texto} />}

      {passo.slug === 'entendendo-a-agenda' && (
        <section>
          <Subtitulo>O que cada situação significa</Subtitulo>
          <div className="mt-3">
            <GuiaStatus itens={GUIA_STATUS} />
          </div>
        </section>
      )}

      {passo.feito && (
        <section>
          <Subtitulo>O que você já fez</Subtitulo>
          <div className="mt-3">
            <GuiaFeito itens={passo.feito} />
          </div>
        </section>
      )}

      {passo.pontos && (
        <section>
          {passo.tituloPontos && <Subtitulo>{passo.tituloPontos}</Subtitulo>}
          <div className={passo.tituloPontos ? 'mt-3' : ''}>
            <GuiaLista itens={passo.pontos} numerada={false} />
          </div>
        </section>
      )}

      {passo.opcional && <GuiaOpcional titulo={passo.opcional.titulo} texto={passo.opcional.texto} />}

      {passo.imagem && (
        <GuiaMoldura imagem={passo.imagem} imprimir={imprimir} />
      )}

      {passo.dica && <GuiaDica texto={passo.dica} />}
    </div>
  );
}
