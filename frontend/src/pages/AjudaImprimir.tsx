import { Link } from 'react-router-dom';
import { GUIA_PASSOS, GUIA_SUBTITULO, GUIA_TITULO } from '../content/guiaRapido';
import { GuiaShell } from '../components/GuiaPecas';
import GuiaCorpo from '../components/GuiaCorpo';

// Folha de estilo só da impressão: A4, margens, cores preservadas e sem fundo creme.
const ESTILO_IMPRESSAO = `
@media print {
  @page { size: A4; margin: 11mm 14mm; }
  html, body { background: #fff !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .guia-imprimir { font-size: 13px; }
  .guia-passo { break-inside: avoid; page-break-inside: avoid; }
  .guia-passo-novo { break-before: page; page-break-before: always; }
}
`;

// Versão do guia em uma única página, própria para imprimir ou "Salvar como PDF" no navegador.
export default function AjudaImprimir() {
  return (
    <GuiaShell>
      <style>{ESTILO_IMPRESSAO}</style>
      <div className="guia-imprimir space-y-10 print:space-y-7">
        <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
          <Link to="/ajuda" className="text-sm text-ink/45 hover:text-wine-700 transition-colors">
            ← Guia rápido
          </Link>
          <button onClick={() => window.print()} className="btn-primary">
            Imprimir ou salvar como PDF
          </button>
        </div>

        <header className="text-center border-b border-wine-100 pb-8 print:pb-4">
          <p className="text-[11px] uppercase tracking-widest font-semibold text-wine-500">NailFlow</p>
          <h1 className="font-display text-4xl text-wine-800 leading-tight mt-1">{GUIA_TITULO}</h1>
          <p className="text-base text-ink/55 mt-2">{GUIA_SUBTITULO}</p>
        </header>

        {GUIA_PASSOS.map((p, i) => (
          <section key={p.slug} className={`guia-passo space-y-4 ${i > 1 || i === 1 ? 'guia-passo-novo' : ''}`}>
            <div className="flex items-baseline gap-3 break-after-avoid">
              <span className="font-display text-3xl text-wine-300 tabular-nums">{String(p.numero).padStart(2, '0')}</span>
              <div>
                <h2 className="font-display text-2xl text-wine-800 leading-tight">{p.titulo}</h2>
                <p className="text-sm text-ink/55 mt-0.5">{p.resumo}</p>
              </div>
            </div>
            <GuiaCorpo passo={p} imprimir />
          </section>
        ))}
      </div>
    </GuiaShell>
  );
}
