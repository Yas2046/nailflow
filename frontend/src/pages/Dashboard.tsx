import { useEffect, useState } from 'react';
import { api } from '../services/api';
import type { Appointment, DashboardSummary } from '../types';
import AppointmentModal from '../components/AppointmentModal';

// ─── utilitários ──────────────────────────────────────────────────────────────

function formatMoney(cents: number) {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Bom dia';
  if (h < 18) return 'Boa tarde';
  return 'Boa noite';
}

function getTodayLabel() {
  return new Date().toLocaleDateString('pt-BR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

function getCurrentMonthLabel() {
  return new Date().toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
}

const PT_MONTHS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

function monthShort(mesStr: string) {
  const [, m] = mesStr.split('-');
  return PT_MONTHS[parseInt(m, 10) - 1] ?? mesStr;
}

/** Garante que todos os 6 meses apareçam, mesmo sem dados */
function buildSixMonths(raw: Array<{ mes: string; totalCents: number }>) {
  const now = new Date();
  return Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const found = raw.find((r) => r.mes === key);
    return { mes: key, label: PT_MONTHS[d.getMonth()], totalCents: found?.totalCents ?? 0 };
  });
}

// ─── ícones ───────────────────────────────────────────────────────────────────

function IconClock() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="9" /><path strokeLinecap="round" d="M12 7v5l3 3" />
    </svg>
  );
}
function IconCalendar() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path strokeLinecap="round" d="M16 2v4M8 2v4M3 10h18" />
    </svg>
  );
}
function IconUsers() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
      <path strokeLinecap="round" d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path strokeLinecap="round" d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}
function IconMoney() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
      <rect x="2" y="6" width="20" height="14" rx="2" />
      <path strokeLinecap="round" d="M2 10h20M6 6V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v2" />
      <circle cx="12" cy="14" r="2" />
    </svg>
  );
}
function IconTrend() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M22 7l-8 8-4-4-6 6M22 7h-6M22 7v6" />
    </svg>
  );
}
function IconScissors() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
      <circle cx="6" cy="6" r="3" /><circle cx="6" cy="18" r="3" />
      <path strokeLinecap="round" d="M20 4 8.12 15.88M14.47 14.48 20 20M8.12 8.12 12 12" />
    </svg>
  );
}
function IconSparkle() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
      <path strokeLinecap="round" d="M12 3v2m0 14v2M3 12h2m14 0h2m-3.3-6.7-1.4 1.4M7.7 16.3l-1.4 1.4m12 0-1.4-1.4M7.7 7.7 6.3 6.3" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
function IconAlert() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    </svg>
  );
}

// ─── componentes ─────────────────────────────────────────────────────────────

const statusConfig: Record<string, { label: string; cls: string }> = {
  pendente:        { label: 'Pendente',       cls: 'bg-amber-50 text-amber-700 border border-amber-200' },
  confirmado:      { label: 'Confirmado',     cls: 'bg-emerald-50 text-emerald-700 border border-emerald-200' },
  concluido:       { label: 'Concluído',      cls: 'bg-green-50 text-green-700 border border-green-200' },
  cancelado:       { label: 'Cancelado',      cls: 'bg-rose-50 text-rose-600 border border-rose-200' },
  nao_compareceu:  { label: 'Não compareceu', cls: 'bg-gray-100 text-gray-500 border border-gray-200' },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = statusConfig[status] ?? { label: status, cls: 'bg-gray-100 text-gray-500' };
  return (
    <span className={`text-xs px-2.5 py-1 rounded-full font-medium whitespace-nowrap ${cfg.cls}`}>
      {cfg.label}
    </span>
  );
}

function VariacaoBadge({ variacao }: { variacao: number | null }) {
  if (variacao === null) return null;
  const positivo = variacao >= 0;
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-xs font-semibold px-2 py-0.5 rounded-full ${
        positivo ? 'bg-green-50 text-green-700' : 'bg-rose-50 text-rose-700'
      }`}
    >
      {positivo ? '↑' : '↓'} {Math.abs(variacao)}%
    </span>
  );
}

interface KpiCardProps {
  label: string;
  value: string;
  sub?: React.ReactNode;
  icon: React.ReactNode;
  accent?: string;
}
function KpiCard({ label, value, sub, icon, accent = 'bg-wine-50 text-wine-600' }: KpiCardProps) {
  return (
    <div className="bg-white rounded-xl border border-wine-100 p-5 flex flex-col gap-3 shadow-sm">
      <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${accent}`}>{icon}</div>
      <div>
        <p className="text-xs text-ink/50 leading-tight mb-1">{label}</p>
        <p className="font-display text-2xl text-wine-700 leading-none">{value}</p>
        {sub && <div className="mt-1.5">{sub}</div>}
      </div>
    </div>
  );
}

// ─── gráfico de barras SVG ────────────────────────────────────────────────────

function BarChart({ data }: { data: Array<{ label: string; totalCents: number }> }) {
  const max = Math.max(...data.map((d) => d.totalCents), 1);
  const H = 120; // altura útil das barras
  const barW = 32;
  const gap = 16;
  const totalW = data.length * (barW + gap) - gap;
  const viewW = totalW + 16;
  const viewH = H + 40; // + espaço para labels

  return (
    <svg
      viewBox={`0 0 ${viewW} ${viewH}`}
      className="w-full"
      style={{ maxHeight: 180 }}
      aria-label="Gráfico de faturamento dos últimos 6 meses"
    >
      {/* linhas de grade */}
      {[0, 0.25, 0.5, 0.75, 1].map((frac) => {
        const y = H - frac * H;
        return (
          <line key={frac} x1="0" y1={y} x2={viewW} y2={y}
            stroke="currentColor" strokeOpacity="0.06" strokeWidth="1" />
        );
      })}

      {data.map((d, i) => {
        const barH = Math.max((d.totalCents / max) * H, d.totalCents > 0 ? 4 : 0);
        const x = i * (barW + gap) + 8;
        const y = H - barH;
        const isEmpty = d.totalCents === 0;

        return (
          <g key={d.label}>
            {/* barra */}
            <rect
              x={x} y={y} width={barW} height={barH || 2}
              rx="4"
              className={isEmpty ? 'fill-wine-100' : 'fill-wine-600'}
            />
            {/* valor no topo */}
            {!isEmpty && (
              <text
                x={x + barW / 2} y={y - 4}
                textAnchor="middle"
                fontSize="8"
                className="fill-wine-700"
                fontWeight="600"
              >
                {formatMoney(d.totalCents).replace('R$ ', 'R$')}
              </text>
            )}
            {/* label do mês */}
            <text
              x={x + barW / 2} y={H + 16}
              textAnchor="middle"
              fontSize="10"
              className="fill-ink/50"
            >
              {d.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ─── skeleton ─────────────────────────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <div className="animate-pulse space-y-8">
      <div className="h-8 w-48 bg-wine-100 rounded-lg" />
      <div className="bg-wine-700/30 rounded-xl h-20" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="bg-white rounded-xl border border-wine-100 p-5 space-y-3">
            <div className="w-9 h-9 bg-wine-50 rounded-lg" />
            <div className="h-3 w-24 bg-wine-50 rounded" />
            <div className="h-7 w-20 bg-wine-100 rounded" />
          </div>
        ))}
      </div>
      <div className="bg-white rounded-xl border border-wine-100 h-40" />
    </div>
  );
}

// ─── página ──────────────────────────────────────────────────────────────────

function todayRange() {
  const s = new Date();
  s.setHours(0, 0, 0, 0);
  const e = new Date(s);
  e.setDate(e.getDate() + 1);
  return { from: s.toISOString(), to: e.toISOString() };
}

export default function Dashboard() {
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [todayAppointments, setTodayAppointments] = useState<Appointment[]>([]);
  const [selectedAppt, setSelectedAppt] = useState<Appointment | null>(null);

  function fetchAll() {
    api.get<DashboardSummary>('/dashboard').then(setData).catch((e) => setError(e.message));
    const { from, to } = todayRange();
    api
      .get<Appointment[]>(`/appointments?from=${from}&to=${to}`)
      .then(setTodayAppointments)
      .catch(() => {});
  }

  useEffect(() => { fetchAll(); }, []);

  if (error)
    return (
      <div className="rounded-xl bg-rose-50 border border-rose-200 p-5 text-rose-600 text-sm">
        Erro ao carregar painel: {error}
      </div>
    );

  if (!data) return <LoadingSkeleton />;

  const sixMonths = buildSixMonths(data.faturamento6Meses);
  const mesLabel  = getCurrentMonthLabel();

  return (
    <>
      <div className="space-y-8">

        {/* ── cabeçalho ──────────────────────────────────────────────────────── */}
        <div>
          <h1 className="font-display text-3xl text-wine-700">{getGreeting()} ✨</h1>
          <p className="text-sm text-ink/50 mt-1 capitalize">{getTodayLabel()}</p>
        </div>

        {/* ── próximo atendimento ────────────────────────────────────────────── */}
        {data.proximoAtendimento ? (
          <div className="bg-wine-700 text-cream rounded-xl p-5 flex items-start gap-4 shadow-sm">
            <div className="w-10 h-10 rounded-lg bg-wine-600 flex items-center justify-center shrink-0">
              <IconSparkle />
            </div>
            <div>
              <p className="text-wine-100 text-xs mb-1">Próximo atendimento</p>
              <p className="font-display text-xl leading-snug">{data.proximoAtendimento.clientName}</p>
              <p className="text-wine-100 text-sm mt-0.5">
                {data.proximoAtendimento.serviceName} · {formatTime(data.proximoAtendimento.startsAt)}
              </p>
            </div>
          </div>
        ) : (
          <div className="bg-wine-50 border border-wine-100 rounded-xl p-5 text-sm text-ink/50 flex items-center gap-3">
            <IconCalendar />
            <span>Nenhum atendimento pendente para hoje.</span>
          </div>
        )}

        {/* ── KPIs de hoje ──────────────────────────────────────────────────── */}
        <div>
          <h2 className="font-display text-xl text-wine-700 mb-3">Hoje</h2>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
            <KpiCard
              label="Agendamentos hoje"
              value={String(data.agendamentosHoje.length)}
              icon={<IconCalendar />}
            />
            <KpiCard
              label="Horários disponíveis"
              value={String(data.horariosDisponiveisHoje)}
              icon={<IconClock />}
            />
            <KpiCard
              label="Faturamento estimado hoje"
              value={formatMoney(data.faturamentoEstimadoHojeCents)}
              icon={<IconMoney />}
              accent="bg-green-50 text-green-700"
            />
          </div>
        </div>

        {/* ── faturamento do mês ────────────────────────────────────────────── */}
        <div>
          <h2 className="font-display text-xl text-wine-700 mb-3 capitalize">{mesLabel}</h2>

          {/* linha 1: financeiro */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
            <KpiCard
              label="Faturamento realizado"
              value={formatMoney(data.mes.faturamentoRealizadoCents)}
              icon={<IconMoney />}
              accent="bg-green-50 text-green-700"
              sub={
                <div className="flex items-center gap-2 flex-wrap">
                  {data.variacao !== null && <VariacaoBadge variacao={data.variacao} />}
                  {data.mesAnterior && (
                    <span className="text-xs text-ink/40">
                      Mês ant.: {formatMoney(data.mesAnterior.faturamentoRealizadoCents)}
                    </span>
                  )}
                </div>
              }
            />
            <KpiCard
              label="Faturamento previsto"
              value={formatMoney(data.mes.faturamentoPrevistoCents)}
              icon={<IconTrend />}
              accent="bg-blue-50 text-blue-600"
              sub={<span className="text-xs text-ink/40">Agendamentos futuros ativos</span>}
            />
            <KpiCard
              label="Faturamento perdido"
              value={formatMoney(data.mes.faturamentoPerdidoCents)}
              icon={<IconAlert />}
              accent="bg-rose-50 text-rose-500"
              sub={
                data.mes.agendamentosNaoCompareceu > 0 ? (
                  <span className="text-xs text-ink/40">
                    {data.mes.agendamentosNaoCompareceu} não compareceu
                  </span>
                ) : undefined
              }
            />
          </div>

          {/* linha 2: atendimentos + clientes */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <KpiCard
              label="Concluídos"
              value={String(data.mes.agendamentosConcluidos)}
              icon={<IconCalendar />}
              accent="bg-green-50 text-green-700"
            />
            <KpiCard
              label="Cancelados"
              value={String(data.mes.agendamentosCancelados)}
              icon={<IconCalendar />}
              accent="bg-rose-50 text-rose-500"
            />
            <KpiCard
              label="Total de clientes"
              value={String(data.totalClientes)}
              icon={<IconUsers />}
            />
            <KpiCard
              label="Novos clientes"
              value={String(data.mes.novosClientes)}
              icon={<IconUsers />}
              accent="bg-blue-50 text-blue-600"
              sub={<span className="text-xs text-ink/40">no mês</span>}
            />
          </div>
        </div>

        {/* ── gráfico 6 meses ───────────────────────────────────────────────── */}
        <div>
          <h2 className="font-display text-xl text-wine-700 mb-3">Faturamento — últimos 6 meses</h2>
          <div className="bg-white rounded-xl border border-wine-100 p-5 shadow-sm">
            {sixMonths.every((m) => m.totalCents === 0) ? (
              <div className="flex flex-col items-center gap-2 py-8 text-ink/30 text-sm">
                <IconMoney />
                <p>Nenhum atendimento concluído registrado ainda.</p>
              </div>
            ) : (
              <BarChart data={sixMonths} />
            )}
          </div>
        </div>

        {/* ── top serviços ──────────────────────────────────────────────────── */}
        {data.topServicos.length > 0 && (
          <div>
            <h2 className="font-display text-xl text-wine-700 mb-3">Serviços mais realizados</h2>
            <div className="bg-white rounded-xl border border-wine-100 overflow-hidden shadow-sm">
              <ul className="divide-y divide-wine-50">
                {data.topServicos.map((s, i) => (
                  <li key={s.serviceName} className="flex items-center justify-between px-5 py-4 gap-4">
                    <div className="flex items-center gap-4 min-w-0">
                      <span className="shrink-0 w-6 h-6 rounded-full bg-wine-50 text-wine-600 text-xs font-bold flex items-center justify-center">
                        {i + 1}
                      </span>
                      <div className="flex items-center gap-2 min-w-0">
                        <IconScissors />
                        <p className="font-medium text-ink truncate">{s.serviceName}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0 text-right">
                      <span className="text-xs px-2.5 py-1 rounded-full bg-wine-50 text-wine-700 font-semibold whitespace-nowrap">
                        {s.count}×
                      </span>
                      <span className="text-sm font-semibold text-wine-700 tabular-nums whitespace-nowrap">
                        {formatMoney(s.totalCents)}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {/* ── agenda do dia ─────────────────────────────────────────────────── */}
        <div>
          <h2 className="font-display text-xl text-wine-700 mb-3">Agenda de hoje</h2>
          <div className="bg-white rounded-xl border border-wine-100 overflow-hidden shadow-sm">
            {data.agendamentosHoje.length === 0 ? (
              <div className="p-8 flex flex-col items-center gap-2 text-ink/40">
                <IconCalendar />
                <p className="text-sm">Nenhum agendamento para hoje.</p>
              </div>
            ) : (
              <ul className="divide-y divide-wine-50">
                {data.agendamentosHoje.map((a) => {
                  const full = todayAppointments.find((t) => t.id === a.id);
                  return (
                    <li key={a.id}>
                      <button
                        onClick={() => full && setSelectedAppt(full)}
                        disabled={!full}
                        className="w-full flex items-center justify-between px-5 py-4 gap-4 text-left hover:bg-wine-50/60 transition-colors disabled:cursor-default"
                      >
                        <div className="flex items-center gap-4 min-w-0">
                          <span className="shrink-0 text-sm font-semibold text-wine-700 tabular-nums w-11">
                            {formatTime(a.startsAt)}
                          </span>
                          <div className="min-w-0">
                            <p className="font-medium text-ink truncate">{a.clientName}</p>
                            <p className="text-xs text-ink/50 truncate">{a.serviceName}</p>
                          </div>
                        </div>
                        <StatusBadge status={a.status} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

      </div>

      {selectedAppt && (
        <AppointmentModal
          date={new Date(selectedAppt.startsAt)}
          time={null}
          appointment={selectedAppt}
          onClose={() => setSelectedAppt(null)}
          onSaved={() => { fetchAll(); setSelectedAppt(null); }}
        />
      )}
    </>
  );
}
