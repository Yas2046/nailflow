// Erro de carregamento de uma tela/lista: diz o que houve e oferece tentar de novo.
// Existe para NÃO mostrar "Nenhum registro" quando, na verdade, a consulta falhou (parece perda de dados).
export default function LoadError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700 flex flex-wrap items-center justify-between gap-3">
      <span>{message}</span>
      {onRetry && <button type="button" onClick={onRetry} className="btn-secondary">Tentar de novo</button>}
    </div>
  );
}
