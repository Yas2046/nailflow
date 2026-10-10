import type { PlatformStats } from '../admin-dashboard/derive';

// Resumo compacto em uma só faixa (os mesmos números da Central de comando).
export function SummaryStrip({ stats }: { stats: PlatformStats }) {
  const items = [
    { label: 'Contas', value: stats.accounts },
    { label: 'Ativas', value: stats.active },
    { label: 'Bloqueadas', value: stats.blocked },
    { label: 'Sem WhatsApp', value: stats.accounts - stats.withInstance },
  ];
  return (
    <section
      aria-label="Resumo"
      className="mb-6 grid grid-cols-2 overflow-hidden rounded-2xl border border-wine-100 bg-white sm:grid-cols-4 [&>*]:border-wine-100 [&>*:nth-child(odd)]:border-r sm:[&>*:not(:last-child)]:border-r [&>*:nth-child(n+3)]:border-t sm:[&>*:nth-child(n+3)]:border-t-0"
    >
      {items.map((it) => (
        <div key={it.label} className="flex min-w-0 items-baseline justify-between gap-3 px-4 py-3.5 sm:px-5">
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink/60">{it.label}</p>
          <p className="font-display text-2xl font-semibold leading-none tabular-nums text-wine-800">{it.value}</p>
        </div>
      ))}
    </section>
  );
}
