import LogoMark from '../LogoMark';
import { IconBan } from '../AdminIcons';

export function SkeletonBlock({ className }: { className: string }) {
  return <div className={`animate-pulse rounded-md bg-wine-100/70 ${className}`} />;
}

export function LoadingState() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Carregando profissionais…</span>
      <SkeletonBlock className="mb-6 h-16 w-full !rounded-2xl sm:h-14" />
      <div className="divide-y divide-wine-100 overflow-hidden rounded-2xl border border-wine-100 bg-white">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="flex items-center gap-4 px-6 py-4">
            <div className="h-11 w-11 shrink-0 animate-pulse rounded-lg bg-wine-100/70" />
            <div className="flex-1 space-y-2">
              <SkeletonBlock className="h-4 w-44 max-w-full" />
              <SkeletonBlock className="h-3 w-28" />
            </div>
            <SkeletonBlock className="hidden h-5 w-16 sm:block" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50/60 p-10 text-center">
      <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-lg bg-white text-rose-600"><IconBan /></span>
      <p className="mt-4 font-display text-xl font-semibold text-wine-800">Não foi possível carregar</p>
      <p className="mt-1 text-[15px] text-rose-700">{message}</p>
      <button onClick={onRetry} className="btn-primary mt-6">Tentar novamente</button>
    </div>
  );
}

export function EmptyState() {
  return (
    <div className="rounded-2xl border border-dashed border-wine-200 bg-white p-14 text-center">
      <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg bg-night-900 text-gold-400"><LogoMark className="h-6 w-6" /></span>
      <p className="mt-5 font-display text-xl font-semibold text-wine-800">Nenhuma profissional encontrada</p>
      <p className="mt-1.5 text-[15px] text-ink/65">Quando alguém se cadastrar, a conta aparece aqui.</p>
    </div>
  );
}
