import { useEffect, useState } from 'react';
import { usePageTitle } from '../hooks/usePageTitle';
import { useNavigate } from 'react-router-dom';
import { api } from '../services/api';
import type { Appointment, DashboardSummary, Service } from '../types';
import AppointmentModal from '../components/AppointmentModal';

// ── Utils ────────────────────────────────────────────────────────────────────

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
  return new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
}
function todayRange() {
  const s = new Date(); s.setHours(0, 0, 0, 0);
  const e = new Date(s); e.setDate(e.getDate() + 1);
  return { from: s.toISOString(), to: e.toISOString() };
}
function durationMinutes(startsAt: string, endsAt: string) {
  return Math.round((new Date(endsAt).getTime() - new Date(startsAt).getTime()) / 60000);
}

// ── Status config ─────────────────────────────────────────────────────────────

const statusConfig: Record<string, { label: string; cls: string; dot: string }> = {
  pendente:       { label: 'Pendente',        cls: 'bg-amber-50 text-amber-700 border border-amber-200',     dot: 'bg-amber-400' },
  confirmado:     { label: 'Confirmado',      cls: 'bg-emerald-50 text-emerald-700 border border-emerald-200', dot: 'bg-emerald-500' },
  concluido:      { label: 'Concluído',       cls: 'bg-green-50 text-green-700 border border-green-200',     dot: 'bg-green-500' },
  cancelado:      { label: 'Cancelado',       cls: 'bg-rose-50 text-rose-600 border border-rose-200',        dot: 'bg-rose-400' },
  nao_compareceu: { label: 'Não compareceu',  cls: 'bg-gray-100 text-gray-500 border border-gray-200',       dot: 'bg-gray-400' },
};

function StatusBadge({ status, small }: { status: string; small?: boolean }) {
  const cfg = statusConfig[status] ?? { label: status, cls: 'bg-gray-100 text-gray-500 border border-gray-200', dot: 'bg-gray-400' };
  return (
    <span className={`inline-flex items-center gap-1.5 font-medium whitespace-nowrap rounded-full ${
      small ? 'text-[10px] px-2 py-0.5' : 'text-xs px-2.5 py-1'
    } ${cfg.cls}`}>
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${cfg.dot}`} />
      {cfg.label}
    </span>
  );
}

function StatusBadgeHero({ status }: { status: string }) {
  const cfg = statusConfig[status] ?? { label: status, cls: '', dot: 'bg-white/40' };
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold bg-white/12 text-white/90 rounded-full px-2.5 py-1 border border-white/15">
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${cfg.dot}`} />
      {cfg.label}
    </span>
  );
}

// ── Icons ────────────────────────────────────────────────────────────────────

function IconCalendar() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.6} viewBox="0 0 24 24">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path strokeLinecap="round" d="M16 2v4M8 2v4M3 10h18" />
    </svg>
  );
}
function IconArrowRight() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 18l6-6-6-6" />
    </svg>
  );
}
function IconClock() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="9" />
      <path strokeLinecap="round" d="M12 7v5l3 3" />
    </svg>
  );
}

// ── LoadingSkeleton ───────────────────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <div className="animate-pulse space-y-8">
      <div className="h-8 w-48 bg-wine-100 rounded-lg" />
      <div className="bg-wine-200/50 rounded-2xl h-48" />
      <div className="bg-white rounded-xl border border-wine-100 h-16" />
      <div className="bg-white rounded-xl border border-wine-100 h-52" />
    </div>
  );
}

// ── Component ────────────────────────────────────────────────────────────────

export default function Inicio() {
  usePageTitle('Início');
  const navigate = useNavigate();

  const [data, setData]                       = useState<DashboardSummary | null>(null);
  const [error, setError]                     = useState<string | null>(null);
  const [todayAppts, setTodayAppts]           = useState<Appointment[]>([]);
  const [services, setServices]               = useState<Service[]>([]);
  const [selectedAppt, setSelectedAppt]       = useState<Appointment | null>(null);

  function fetchAll() {
    api.get<DashboardSummary>('/dashboard').then(setData).catch((e: Error) => setError(e.message));
    const { from, to } = todayRange();
    api.get<Appointment[]>(`/appointments?from=${from}&to=${to}`).then(setTodayAppts).catch(() => {});
    api.get<Service[]>('/services').then(setServices).catch(() => {});
  }
  useEffect(() => { fetchAll(); }, []);

  if (error) return (
    <div className="rounded-xl bg-rose-50 border border-rose-200 p-5 text-rose-600 text-sm">
      Erro ao carregar: {error}
    </div>
  );
  if (!data) return <LoadingSkeleton />;

  // Próximo atendimento
  const proximo      = data.proximoAtendimento;
  const proximoFull  = proximo ? todayAppts.find(a => a.id === proximo.id) ?? null : null;
  const proximoSvc   = proximoFull ? services.find(s => s.id === proximoFull.serviceId) ?? null : null;
  const proximoDur   = proximoFull ? durationMinutes(proximoFull.startsAt, proximoFull.endsAt) : null;
  const proximoStatus = data.agendamentosHoje.find(a => a.id === proximo?.id)?.status ?? 'pendente';

  // Agenda do dia — enriquecer com serviço completo
  const agendaHoje = data.agendamentosHoje.map(a => {
    const full = todayAppts.find(t => t.id === a.id);
    const svc  = full ? services.find(s => s.id === full.serviceId) ?? null : null;
    return { ...a, full, svc };
  });

  const isProximoId = proximo?.id;

  return (
    <>
      <div className="space-y-7 pb-10">

        {/* ── Greeting ── */}
        <div>
          <h1 className="font-display text-3xl sm:text-4xl text-wine-800 leading-tight">{getGreeting()}</h1>
          <p className="text-sm text-ink/40 mt-1.5 capitalize">{getTodayLabel()}</p>
        </div>

        {/* ── 1. PRÓXIMO ATENDIMENTO — HERO ── */}
        {proximo ? (
          <div className="bg-wine-800 rounded-2xl overflow-hidden shadow-lg shadow-wine-800/20 text-cream">
            {/* Topo: label + status */}
            <div className="px-6 pt-5 pb-4 flex items-center justify-between gap-3">
              <p className="text-wine-400 text-[11px] uppercase tracking-widest font-semibold">Próximo atendimento</p>
              <StatusBadgeHero status={proximoStatus} />
            </div>

            {/* Hora em destaque */}
            <div className="px-6 pb-2">
              <p className="font-display text-6xl sm:text-7xl tabular-nums leading-none text-cream">
                {formatTime(proximo.startsAt)}
              </p>
            </div>

            {/* Nome + Serviço */}
            <div className="px-6 pb-5">
              <p className="font-display text-xl sm:text-2xl text-cream leading-snug mt-2">
                {proximo.clientName}
              </p>
              <p className="text-wine-300 text-sm mt-0.5">{proximo.serviceName}</p>
            </div>

            {/* Rodapé: duração, valor, CTA */}
            <div className="border-t border-wine-700/60 px-6 py-4 flex items-center justify-between gap-4">
              <div className="flex items-center gap-4 text-wine-300 text-sm">
                {proximoDur !== null && (
                  <span className="flex items-center gap-1.5">
                    <IconClock />
                    {proximoDur} min
                  </span>
                )}
                {proximoSvc && (
                  <span className="font-semibold text-cream">
                    {formatMoney(proximoSvc.priceCents)}
                  </span>
                )}
              </div>
              <button
                onClick={() => proximoFull && setSelectedAppt(proximoFull)}
                disabled={!proximoFull}
                className="flex items-center gap-1.5 text-sm font-semibold text-white bg-white/12 hover:bg-white/20 transition-colors rounded-xl px-4 py-2 border border-white/15 disabled:opacity-40 disabled:cursor-default"
              >
                Ver detalhes
                <IconArrowRight />
              </button>
            </div>
          </div>
        ) : (
          /* Estado vazio elegante */
          <div className="bg-wine-50 border border-wine-100/80 rounded-2xl p-8 flex flex-col items-center text-center gap-3">
            <div className="w-12 h-12 rounded-full bg-wine-100 flex items-center justify-center text-wine-400">
              <IconCalendar />
            </div>
            <div>
              <p className="font-display text-lg text-wine-700">Nenhum próximo atendimento</p>
              <p className="text-sm text-ink/40 mt-1">Sem agendamentos pendentes para hoje.</p>
            </div>
            <button
              onClick={() => navigate('/agenda')}
              className="mt-1 flex items-center gap-1.5 text-sm font-semibold text-wine-700 bg-white border border-wine-200 hover:bg-wine-50 hover:border-wine-300 rounded-xl px-4 py-2 transition-colors"
            >
              Ver agenda
              <IconArrowRight />
            </button>
          </div>
        )}

        {/* ── 2. RESUMO DO DIA ── */}
        <div className="bg-white rounded-2xl border border-wine-100/80 px-5 py-4 shadow-sm">
          <div className="flex flex-wrap gap-x-6 gap-y-3">
            <div>
              <p className="text-[10px] text-ink/40 uppercase tracking-widest font-medium">Hoje</p>
              <div className="flex items-baseline gap-1.5 mt-0.5">
                <span className="font-display text-2xl text-wine-700 tabular-nums leading-none">{data.agendamentosHoje.length}</span>
                <span className="text-xs text-ink/40">{data.agendamentosHoje.length === 1 ? 'atendimento' : 'atendimentos'}</span>
              </div>
            </div>
            <div className="w-px bg-wine-100 self-stretch" />
            <div>
              <p className="text-[10px] text-ink/40 uppercase tracking-widest font-medium">Disponíveis</p>
              <div className="flex items-baseline gap-1.5 mt-0.5">
                <span className="font-display text-2xl text-wine-700 tabular-nums leading-none">{data.horariosDisponiveisHoje}</span>
                <span className="text-xs text-ink/40">{data.horariosDisponiveisHoje === 1 ? 'horário' : 'horários'}</span>
              </div>
            </div>
            <div className="w-px bg-wine-100 self-stretch" />
            <div>
              <p className="text-[10px] text-ink/40 uppercase tracking-widest font-medium">Estimado</p>
              <div className="flex items-baseline gap-1.5 mt-0.5">
                <span className="font-display text-2xl text-wine-700 tabular-nums leading-none">{formatMoney(data.faturamentoEstimadoHojeCents)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* ── 3. AGENDA DE HOJE ── */}
        <div>
          <div className="flex items-center gap-3 mb-3">
            <span className="w-0.5 h-4 rounded-full bg-gold-500 shrink-0" aria-hidden="true" />
            <h2 className="font-display text-lg sm:text-xl text-wine-700">Agenda de hoje</h2>
          </div>

          <div className="bg-white rounded-2xl border border-wine-100/80 overflow-hidden shadow-sm">
            {agendaHoje.length === 0 ? (
              <div className="p-10 flex flex-col items-center gap-2 text-ink/40">
                <IconCalendar />
                <p className="text-sm">Nenhum agendamento para hoje.</p>
                <button
                  onClick={() => navigate('/agenda')}
                  className="mt-2 text-xs font-semibold text-wine-600 hover:underline"
                >
                  Ir para agenda →
                </button>
              </div>
            ) : (
              <ul className="divide-y divide-wine-50">
                {agendaHoje.map((a) => {
                  const isNext = a.id === isProximoId;
                  return (
                    <li key={a.id} className={isNext ? 'border-l-2 border-wine-500' : 'border-l-2 border-transparent'}>
                      <button
                        onClick={() => a.full && setSelectedAppt(a.full)}
                        disabled={!a.full}
                        className={`w-full flex items-center justify-between px-4 py-3.5 gap-3 text-left transition-colors disabled:cursor-default ${
                          isNext
                            ? 'bg-wine-50/70 hover:bg-wine-50'
                            : 'hover:bg-wine-50/40'
                        }`}
                      >
                        {/* Hora */}
                        <span className={`shrink-0 font-bold tabular-nums w-11 text-sm ${isNext ? 'text-wine-700' : 'text-ink/50'}`}>
                          {formatTime(a.startsAt)}
                        </span>

                        {/* Nome + Serviço */}
                        <div className="flex-1 min-w-0">
                          <p className={`font-medium truncate leading-snug ${isNext ? 'text-ink' : 'text-ink/80'}`}>
                            {a.clientName}
                          </p>
                          <p className="text-xs text-ink/45 truncate">{a.serviceName}</p>
                        </div>

                        {/* Valor + Status */}
                        <div className="flex flex-col items-end gap-1 shrink-0">
                          {a.svc && (
                            <span className={`text-sm font-semibold tabular-nums ${isNext ? 'text-wine-700' : 'text-ink/60'}`}>
                              {formatMoney(a.svc.priceCents)}
                            </span>
                          )}
                          <StatusBadge status={a.status} small />
                        </div>
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
