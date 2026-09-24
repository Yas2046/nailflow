import { useEffect, useState } from 'react';
import { usePageTitle } from '../hooks/usePageTitle';
import { api } from '../services/api';
import type { Client, DashboardSummary, Appointment, Expense } from '../types';

function formatMoney(cents: number) {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function getCurrentMonthLabel() {
  return new Date().toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
}
const PT_MONTHS = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

function buildChartData(
  rawFat: Array<{ mes: string; totalCents: number }>,
  rawGas: Array<{ mes: string; totalCents: number }>,
) {
  const now = new Date();
  return Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const fat = rawFat.find((r) => r.mes === key);
    const gas = rawGas.find((r) => r.mes === key);
    return {
      mes:          key,
      label:        PT_MONTHS[d.getMonth()],
      faturadoCents: fat?.totalCents ?? 0,
      gastosCents:   gas?.totalCents ?? 0,
      isCurrent:    i === 5,
    };
  });
}

function monthRange() {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const to   = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString();
  return { from, to };
}
function monthRangeDate() {
  const now  = new Date();
  const y    = now.getFullYear();
  const m    = String(now.getMonth() + 1).padStart(2, '0');
  const last = new Date(y, now.getMonth() + 1, 0).getDate();
  return { from: `${y}-${m}-01`, to: `${y}-${m}-${last}` };
}
function pct(part: number, total: number) {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

// ── Icons ───────────────────────────────────────────────────────────────────

function IconTrending() {
  return (<svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M22 7l-9 9-4-4-6 6"/><path strokeLinecap="round" strokeLinejoin="round" d="M16 7h6v6"/></svg>);
}

// ── VariacaoBadge ────────────────────────────────────────────────────────────

function VariacaoBadge({ variacao }: { variacao: number | null }) {
  if (variacao === null) return null;
  const pos = variacao >= 0;
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full ${
      pos ? 'bg-white/15 text-white' : 'bg-rose-400/25 text-rose-200'
    }`}>
      {pos ? '↑' : '↓'} {Math.abs(variacao)}%
    </span>
  );
}

// ── ComboChart — barras faturamento + linha gastos ───────────────────────────

function ComboChart({ data }: {
  data: Array<{ label: string; faturadoCents: number; gastosCents: number; isCurrent?: boolean }>;
}) {
  const H = 130; const barW = 30; const gap = 18;
  const totalW = data.length * (barW + gap) - gap;
  const viewW  = totalW + 20;
  const viewH  = H + 56; // extra para legenda

  const max = Math.max(...data.map((d) => Math.max(d.faturadoCents, d.gastosCents)), 1);

  function shortMoney(cents: number) {
    const v = cents / 100;
    if (v >= 1000) return `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k`;
    return `${Math.round(v)}`;
  }

  // pontos da linha de gastos (centro do topo de cada barra ou ponto zero)
  const linePoints = data.map((d, i) => {
    const x = i * (barW + gap) + 10 + barW / 2;
    const gh = Math.max((d.gastosCents / max) * H, d.gastosCents > 0 ? 3 : 0);
    const y  = H - gh;
    return `${x},${y}`;
  }).join(' ');

  const dotPoints = data.map((d, i) => {
    const x = i * (barW + gap) + 10 + barW / 2;
    const gh = Math.max((d.gastosCents / max) * H, d.gastosCents > 0 ? 3 : 0);
    return { x, y: H - gh, v: d.gastosCents };
  });

  return (
    <svg viewBox={`0 0 ${viewW} ${viewH}`} className="w-full" style={{ maxHeight: 220 }} aria-label="Gráfico de faturamento e gastos">
      {/* grid lines */}
      {[0, 0.25, 0.5, 0.75, 1].map((frac) => (
        <line key={frac} x1="0" y1={H - frac * H} x2={viewW} y2={H - frac * H}
          stroke="currentColor" strokeOpacity={frac === 0 ? 0.12 : 0.05} strokeWidth="1" />
      ))}

      {/* barras de faturamento */}
      {data.map((d, i) => {
        const barH = Math.max((d.faturadoCents / max) * H, d.faturadoCents > 0 ? 5 : 0);
        const x = i * (barW + gap) + 10;
        const y = H - barH;
        return (
          <g key={d.label}>
            <rect x={x} y={y} width={barW} height={Math.max(barH, 2)} rx="5"
              className={d.faturadoCents === 0 ? 'fill-wine-100/60' : d.isCurrent ? 'fill-wine-500' : 'fill-wine-300/70'} />
            {d.faturadoCents > 0 && (
              <text x={x + barW / 2} y={y - 6} textAnchor="middle" fontSize="8"
                className={d.isCurrent ? 'fill-wine-700' : 'fill-wine-600/70'} fontWeight="600">
                {shortMoney(d.faturadoCents)}
              </text>
            )}
            <text x={x + barW / 2} y={H + 16} textAnchor="middle" fontSize="10"
              className={d.isCurrent ? 'fill-wine-700' : 'fill-ink/40'} fontWeight={d.isCurrent ? '700' : '400'}>
              {d.label}
            </text>
          </g>
        );
      })}

      {/* linha de gastos */}
      {data.some((d) => d.gastosCents > 0) && (
        <>
          <polyline
            points={linePoints}
            fill="none"
            stroke="#e11d48"
            strokeWidth="1.5"
            strokeOpacity="0.7"
            strokeDasharray="4 2"
          />
          {dotPoints.map((p, i) => p.v > 0 && (
            <circle key={i} cx={p.x} cy={p.y} r="3" fill="#e11d48" fillOpacity="0.8" />
          ))}
        </>
      )}

      {/* legenda */}
      <g transform={`translate(10, ${H + 30})`}>
        <rect width="8" height="8" rx="2" className="fill-wine-400" />
        <text x="12" y="8" fontSize="9" className="fill-ink/50">Faturamento</text>
        <line x1="80" y1="4" x2="92" y2="4" stroke="#e11d48" strokeWidth="1.5" strokeDasharray="4 2" strokeOpacity="0.7" />
        <circle cx="86" cy="4" r="2.5" fill="#e11d48" fillOpacity="0.8" />
        <text x="96" y="8" fontSize="9" className="fill-ink/50">Gastos</text>
      </g>
    </svg>
  );
}

// ── ProportionBar ────────────────────────────────────────────────────────────

function ProportionBar({ segments, total }: {
  segments: Array<{ label: string; value: number; color: string }>;
  total: number;
}) {
  if (total === 0) return <div className="h-1.5 bg-wine-50 rounded-full" />;
  return (
    <div>
      <div className="flex h-1.5 rounded-full overflow-hidden gap-px">
        {segments.filter((s) => s.value > 0).map((s) => (
          <div key={s.label} className={`${s.color}`} style={{ flex: s.value }} />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-2">
        {segments.map((s) => (
          <span key={s.label} className="flex items-center gap-1.5 text-[10px] text-ink/45">
            <span className={`w-1.5 h-1.5 rounded-full ${s.color} shrink-0`} />
            {s.label} {pct(s.value, total)}%
          </span>
        ))}
      </div>
    </div>
  );
}

// ── LoadingSkeleton ──────────────────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <div className="max-w-2xl mx-auto animate-pulse space-y-8">
      <div className="h-7 w-40 bg-wine-100 rounded-lg" />
      <div className="bg-wine-200/50 rounded-2xl h-52" />
      <div className="bg-wine-100/60 rounded-2xl h-56" />
      <div className="bg-white rounded-xl border border-wine-100 h-24" />
      <div className="bg-white rounded-xl border border-wine-100 h-20" />
      <div className="bg-white rounded-xl border border-wine-100 h-36" />
    </div>
  );
}

// ── Dashboard ────────────────────────────────────────────────────────────────

export default function Dashboard() {
  usePageTitle('Dashboard');
  const [summary, setSummary]       = useState<DashboardSummary | null>(null);
  const [clients, setClients]       = useState<Client[]>([]);
  const [monthAppts, setMonthAppts] = useState<Appointment[]>([]);
  const [gastosCents, setGastosCents] = useState<number>(0);
  const [error, setError]           = useState<string | null>(null);

  useEffect(() => {
    const { from, to }   = monthRange();
    const { from: df, to: dt } = monthRangeDate();

    Promise.all([
      api.get<DashboardSummary>('/dashboard'),
      api.get<Client[]>('/clients'),
      api.get<Appointment[]>(`/appointments?from=${from}&to=${to}`),
      api.get<Expense[]>(`/expenses?from=${df}&to=${dt}`).catch(() => [] as Expense[]),
    ])
      .then(([s, c, a, expenses]) => {
        setSummary(s);
        setClients(c);
        setMonthAppts(a);
        setGastosCents(expenses.reduce((acc: number, e: Expense) => acc + e.amount_cents, 0));
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  if (error) return (
    <div className="max-w-2xl mx-auto rounded-xl bg-rose-50 border border-rose-200 p-6 text-center space-y-2">
      <p className="text-wine-700 font-semibold">Erro ao carregar dados</p>
      <p className="text-sm text-ink/50">{error}</p>
    </div>
  );
  if (!summary) return <LoadingSkeleton />;

  const { mes, variacao, topServicos, faturamento6Meses, gastos6Meses } = summary;

  // Financeiro
  const faturado    = mes.faturamentoRealizadoCents;
  const resultado   = faturado - gastosCents;
  const ticketMedio = mes.agendamentosConcluidos > 0
    ? Math.round(faturado / mes.agendamentosConcluidos) : 0;
  const resultadoPos = resultado >= 0;

  // Clientes
  const INATIVO_MS = 60 * 24 * 60 * 60 * 1000;
  const agora = Date.now();
  const clientesInativos = clients.filter((c) =>
    c.ultimoAtendimento ? agora - new Date(c.ultimoAtendimento).getTime() > INATIVO_MS : false
  ).length;
  const activeIds   = new Set(monthAppts.filter((a) => a.status !== 'cancelado').map((a) => a.clientId));
  const clientesAtivos = activeIds.size;

  // Operação
  const totalAtend     = mes.agendamentosTotal;
  const maxServCount   = Math.max(...topServicos.map((s) => s.count), 1);

  // Gráfico combo
  const chartData = buildChartData(faturamento6Meses, gastos6Meses ?? []);

  return (
    <div className="max-w-2xl mx-auto space-y-8 pb-10">

      {/* ── Cabeçalho ── */}
      <div>
        <h1 className="font-display text-3xl sm:text-4xl text-wine-800 leading-tight">Dashboard</h1>
        <p className="text-sm text-ink/40 mt-1.5 capitalize tracking-wide">{getCurrentMonthLabel()}</p>
      </div>

      {/* ── 1. RESUMO FINANCEIRO — herói ── */}
      <section className="bg-wine-800 rounded-2xl overflow-hidden text-cream shadow-lg">
        {/* Faturamento — protagonista */}
        <div className="px-6 pt-6 pb-5">
          <div className="flex items-start justify-between gap-3">
            <p className="text-wine-300 text-xs uppercase tracking-widest font-semibold">Faturamento realizado</p>
            <VariacaoBadge variacao={variacao} />
          </div>
          <p className="font-display text-5xl sm:text-6xl leading-none tabular-nums mt-2">{formatMoney(faturado)}</p>
          {variacao !== null && (
            <p className="text-wine-400 text-xs mt-1.5 flex items-center gap-1">
              <IconTrending /> vs mês anterior
            </p>
          )}
        </div>

        {/* Linha divisória + Gastos / Resultado */}
        <div className="border-t border-wine-700/60 grid grid-cols-2 divide-x divide-wine-700/60">
          <div className="px-6 py-4">
            <p className="text-wine-400 text-[10px] uppercase tracking-widest font-semibold mb-1.5">Gastos</p>
            <p className="font-display text-2xl tabular-nums leading-none text-wine-200">
              {gastosCents > 0 ? formatMoney(gastosCents) : '—'}
            </p>
          </div>
          <div className="px-6 py-4">
            <p className="text-wine-400 text-[10px] uppercase tracking-widest font-semibold mb-1.5">Resultado</p>
            {gastosCents > 0 ? (
              <p className={`font-display text-2xl tabular-nums leading-none ${resultadoPos ? 'text-emerald-300' : 'text-rose-300'}`}>
                {formatMoney(resultado)}
              </p>
            ) : (
              <p className="font-display text-2xl tabular-nums leading-none text-wine-400 text-sm font-sans font-normal">
                sem gastos lançados
              </p>
            )}
          </div>
        </div>

        {/* Rodapé: Ticket médio · Previsto · Perdido */}
        <div className="border-t border-wine-700/60 px-6 py-4 flex flex-wrap gap-x-6 gap-y-2">
          <div>
            <p className="text-wine-400 text-[10px] uppercase tracking-widest font-semibold">Ticket médio</p>
            <p className="font-display text-xl tabular-nums text-cream mt-0.5">{formatMoney(ticketMedio)}</p>
          </div>
          <div>
            <p className="text-wine-400 text-[10px] uppercase tracking-widest font-semibold">Previsto</p>
            <p className="font-display text-xl tabular-nums text-cream mt-0.5">{formatMoney(mes.faturamentoPrevistoCents)}</p>
          </div>
          <div>
            <p className="text-wine-400 text-[10px] uppercase tracking-widest font-semibold">Perdido</p>
            <p className="font-display text-xl tabular-nums text-rose-300 mt-0.5">{formatMoney(mes.faturamentoPerdidoCents)}</p>
          </div>
        </div>
      </section>

      {/* ── 2. EVOLUÇÃO — herói secundário ── */}
      <section>
        <div className="flex items-center gap-3 mb-4">
          <span className="w-0.5 h-4 rounded-full bg-gold-500 shrink-0" aria-hidden="true" />
          <h2 className="font-display text-lg sm:text-xl text-wine-700">Evolução — 6 meses</h2>
        </div>
        <div className="bg-white rounded-2xl border border-wine-100/80 px-5 pt-5 pb-4 shadow-sm">
          <ComboChart data={chartData} />
        </div>
      </section>

      {/* ── 3. OPERAÇÃO — compacto ── */}
      <section>
        <div className="flex items-center gap-3 mb-3">
          <span className="w-0.5 h-4 rounded-full bg-gold-500 shrink-0" aria-hidden="true" />
          <h2 className="font-display text-lg sm:text-xl text-wine-700">Atendimentos do mês</h2>
        </div>
        <div className="bg-white rounded-2xl border border-wine-100/80 p-5 shadow-sm space-y-4">
          {/* Stats em linha */}
          <div className="grid grid-cols-4 gap-2">
            {[
              { label: 'Total',       value: totalAtend,                    note: undefined,                              dim: false },
              { label: 'Concluídos', value: mes.agendamentosConcluidos,     note: `${pct(mes.agendamentosConcluidos, totalAtend)}%`, color: 'text-green-600' },
              { label: 'Cancelados', value: mes.agendamentosCancelados,     note: `${pct(mes.agendamentosCancelados, totalAtend)}%`, color: 'text-rose-500' },
              { label: 'No-show',    value: mes.agendamentosNaoCompareceu, note: `${pct(mes.agendamentosNaoCompareceu, totalAtend)}%`, color: 'text-amber-600' },
            ].map((s) => (
              <div key={s.label} className="flex flex-col gap-0.5">
                <p className="text-[10px] text-ink/40 leading-none">{s.label}</p>
                <p className="font-display text-2xl text-wine-700 tabular-nums leading-tight">{s.value}</p>
                {s.note && <p className={`text-[10px] font-semibold ${'color' in s ? s.color : ''}`}>{s.note}</p>}
              </div>
            ))}
          </div>
          <ProportionBar total={totalAtend} segments={[
            { label: 'Concluídos', value: mes.agendamentosConcluidos,     color: 'bg-green-500' },
            { label: 'Cancelados', value: mes.agendamentosCancelados,     color: 'bg-rose-400' },
            { label: 'No-show',    value: mes.agendamentosNaoCompareceu, color: 'bg-amber-400' },
          ]} />
        </div>
      </section>

      {/* ── 4. CLIENTES — compacto ── */}
      <section>
        <div className="flex items-center gap-3 mb-3">
          <span className="w-0.5 h-4 rounded-full bg-gold-500 shrink-0" aria-hidden="true" />
          <h2 className="font-display text-lg sm:text-xl text-wine-700">Clientes</h2>
        </div>
        <div className="bg-white rounded-2xl border border-wine-100/80 px-5 py-4 shadow-sm">
          <div className="grid grid-cols-4 gap-2">
            {[
              { label: 'Total na base', value: summary.totalClientes,  note: undefined },
              { label: 'Novos no mês',  value: mes.novosClientes,      note: undefined },
              { label: 'Ativos no mês', value: clientesAtivos,         note: undefined },
              { label: 'Inativos +60d', value: clientesInativos,       note: clientesInativos > 0 ? '!' : undefined },
            ].map((s) => (
              <div key={s.label} className="flex flex-col gap-0.5">
                <p className="text-[10px] text-ink/40 leading-none">{s.label}</p>
                <div className="flex items-baseline gap-1">
                  <p className="font-display text-2xl text-wine-700 tabular-nums leading-tight">{s.value}</p>
                  {s.note && <span className="text-xs font-bold text-amber-600">{s.note}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 5. SERVIÇOS ── */}
      {topServicos.length > 0 && (
        <section>
          <div className="flex items-center gap-3 mb-3">
            <span className="w-0.5 h-4 rounded-full bg-gold-500 shrink-0" aria-hidden="true" />
            <h2 className="font-display text-lg sm:text-xl text-wine-700">Serviços mais realizados</h2>
          </div>
          <div className="bg-white rounded-2xl border border-wine-100/80 divide-y divide-wine-50 shadow-sm">
            {topServicos.map((s, i) => (
              <div key={s.serviceName} className="px-5 py-3.5 space-y-2">
                <div className="flex items-center gap-3">
                  <span className="w-5 h-5 rounded-full bg-wine-50 text-wine-600 text-[10px] font-bold flex items-center justify-center shrink-0">{i + 1}</span>
                  <span className="flex-1 min-w-0 text-sm text-ink/80 truncate">{s.serviceName}</span>
                  <span className="text-xs text-ink/35 tabular-nums shrink-0">{s.count}x</span>
                  <span className="text-sm font-semibold text-wine-700 tabular-nums shrink-0">{formatMoney(s.totalCents)}</span>
                </div>
                <div className="h-1 bg-wine-50 rounded-full overflow-hidden">
                  <div className="h-full bg-wine-300 rounded-full transition-all" style={{ width: `${pct(s.count, maxServCount)}%` }} />
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

    </div>
  );
}
