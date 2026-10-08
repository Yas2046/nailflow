import type { PlatformStats } from '../admin-dashboard/derive';

export function SummaryStrip({ stats }: { stats: PlatformStats }) {
  const items = [
    { label: 'Contas', value: stats.accounts, caption: stats.accounts === 1 ? 'conta de profissional' : 'contas de profissionais' },
    { label: 'Ativas', value: stats.active, caption: 'com acesso liberado' },
    { label: 'Bloqueadas', value: stats.blocked, caption: 'sem acesso ao sistema' },
    { label: 'Sem WhatsApp', value: stats.accounts - stats.withInstance, caption: 'sem instância configurada' },
  ];
  return (
    <section
      aria-label="Resumo"
      className="mb-8 grid grid-cols-2 overflow-hidden rounded-3xl border border-wine-100/80 bg-white/85 shadow-[0_1px_2px_rgba(61,29,40,0.04),0_26px_60px_-34px_rgba(61,29,40,0.22)] sm:mb-10 lg:grid-cols-4 [&>*]:border-wine-100/70 [&>*:nth-child(odd)]:border-r [&>*:nth-child(n+3)]:border-t lg:[&>*:nth-child(n+3)]:border-t-0 lg:[&>*:not(:last-child)]:border-r"
    >
      {items.map((it) => (
        <div key={it.label} className="min-w-0 p-5 sm:p-7">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ink/60">{it.label}</p>
          <p className="mt-2 font-display text-4xl font-semibold leading-none text-wine-800">{it.value}</p>
          <p className="mt-2 text-sm text-ink/65">{it.caption}</p>
        </div>
      ))}
    </section>
  );
}
