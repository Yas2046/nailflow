import LogoMark from '../LogoMark';
import { IconBan } from '../AdminIcons';

export function SkeletonBlock({ className }: { className: string }) {
  return <div className={`bg-wine-100/60 rounded-lg animate-pulse ${className}`} />;
}

export function LoadingState() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Carregando profissionais…</span>
      <SkeletonBlock className="mb-8 h-40 w-full rounded-3xl sm:mb-10 sm:h-32" />
      <div className="grid sm:grid-cols-2 2xl:grid-cols-3 gap-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="rounded-3xl bg-white border border-wine-100/70 p-6 shadow-sm">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-2xl bg-wine-100/60 animate-pulse" />
              <div className="flex-1 space-y-2">
                <SkeletonBlock className="h-4 w-40" />
                <SkeletonBlock className="h-3 w-28" />
              </div>
            </div>
            <div className="mt-6 space-y-3">
              <SkeletonBlock className="h-3 w-full" />
              <SkeletonBlock className="h-3 w-3/4" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="rounded-3xl bg-white border border-rose-200 p-10 text-center shadow-sm">
      <span className="mx-auto w-12 h-12 rounded-2xl bg-rose-50 text-rose-500 flex items-center justify-center"><IconBan /></span>
      <p className="font-display text-xl text-wine-800 mt-4">Não foi possível carregar</p>
      <p className="text-sm text-rose-700 mt-1">{message}</p>
      <button onClick={onRetry} className="btn-primary mt-6">Tentar novamente</button>
    </div>
  );
}

export function EmptyState() {
  return (
    <div className="rounded-3xl bg-white border border-wine-100/70 p-14 text-center shadow-sm">
      <span className="mx-auto w-14 h-14 rounded-2xl bg-gold-300/30 text-gold-600 flex items-center justify-center"><LogoMark className="w-6 h-6" /></span>
      <p className="font-display text-xl text-wine-800 mt-5">Nenhuma profissional encontrada</p>
      <p className="text-sm text-ink/60 mt-1.5">Quando alguém se cadastrar, a conta aparece aqui.</p>
    </div>
  );
}
