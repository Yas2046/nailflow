import { useEffect, useMemo, useState } from 'react';
import { usePageTitle } from '../hooks/usePageTitle';
import { api } from '../services/api';
import type { Appointment, Service, WeeklyAvailabilityDay } from '../types';
import AppointmentModal from '../components/AppointmentModal';
import BlockTimeModal from '../components/BlockTimeModal';

type ViewMode = 'dia' | 'semana' | 'mes';

interface BlockedTime {
  id: string;
  starts_at: string;
  ends_at: string;
  reason: string | null;
}

// ── Utils ────────────────────────────────────────────────────────────────────

function startOfDay(d: Date) {
  const r = new Date(d); r.setHours(0, 0, 0, 0); return r;
}
function addDays(d: Date, n: number) {
  const r = new Date(d); r.setDate(r.getDate() + n); return r;
}
function toMinutes(t: string) {
  const [h, m] = t.split(':').map(Number); return h * 60 + m;
}
function minutesToLabel(min: number) {
  return `${Math.floor(min / 60).toString().padStart(2, '0')}:${(min % 60).toString().padStart(2, '0')}`;
}
function isToday(d: Date) {
  return startOfDay(d).getTime() === startOfDay(new Date()).getTime();
}
function formatMoney(cents: number) {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function durationMin(a: Appointment) {
  return Math.round((new Date(a.endsAt).getTime() - new Date(a.startsAt).getTime()) / 60000);
}

// ── Icons ────────────────────────────────────────────────────────────────────

function IconChevronLeft() {
  return (<svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7"/></svg>);
}
function IconChevronRight() {
  return (<svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7"/></svg>);
}
function IconLock() {
  return (<svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2"/><path strokeLinecap="round" d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>);
}
function IconRecurring() {
  return (<svg className="shrink-0 w-3.5 h-3.5 text-wine-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-label="Recorrente"><path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>);
}
function IconPencil() {
  return (<svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M16.862 3.487a2.25 2.25 0 113.182 3.182L7.5 19.213l-4.5 1.125 1.125-4.5 13.737-13.351z"/></svg>);
}

// ── Status config ─────────────────────────────────────────────────────────────

const STATUS_CFG: Record<string, { label: string; dot: string; badge: string; border: string; bg: string }> = {
  confirmado:     { label: 'Confirmado',      dot: 'bg-wine-500',    badge: 'bg-wine-50 text-wine-700 border border-wine-200',       border: 'border-wine-500',  bg: 'bg-wine-500/5' },
  pendente:       { label: 'Pendente',        dot: 'bg-gold-500',    badge: 'bg-amber-50 text-amber-700 border border-amber-200',    border: 'border-gold-500',  bg: 'bg-gold-500/5' },
  concluido:      { label: 'Concluído',       dot: 'bg-sage-500',    badge: 'bg-green-50 text-green-700 border border-green-200',    border: 'border-sage-500',  bg: 'bg-sage-500/5' },
  cancelado:      { label: 'Cancelado',       dot: 'bg-rose-400',    badge: 'bg-rose-50 text-rose-600 border border-rose-200',       border: 'border-rose-300',  bg: 'bg-rose-50/40' },
  nao_compareceu: { label: 'Não compareceu',  dot: 'bg-gray-400',    badge: 'bg-gray-100 text-gray-500 border border-gray-200',     border: 'border-gray-300',  bg: 'bg-gray-50/40' },
};
function getCfg(status: string) {
  return STATUS_CFG[status] ?? STATUS_CFG.pendente;
}

function StatusDot({ status, size = 'sm' }: { status: string; size?: 'xs' | 'sm' }) {
  const cfg = getCfg(status);
  return <span className={`shrink-0 rounded-full ${size === 'xs' ? 'w-1.5 h-1.5' : 'w-2 h-2'} ${cfg.dot}`} />;
}
function StatusBadge({ status }: { status: string }) {
  const cfg = getCfg(status);
  return (
    <span className={`inline-flex items-center gap-1.5 text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${cfg.badge}`}>
      <StatusDot status={status} size="xs" />
      {cfg.label}
    </span>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function Agenda() {
  usePageTitle('Agenda');
  const [view, setView]             = useState<ViewMode>('dia');
  const [currentDate, setCurrentDate] = useState(startOfDay(new Date()));
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [blocked, setBlocked]       = useState<BlockedTime[]>([]);
  const [weeklyAvailability, setWeeklyAvailability] = useState<WeeklyAvailabilityDay[]>([]);
  const [services, setServices]     = useState<Service[]>([]);
  const [horizonDays, setHorizonDays] = useState<number>(60);
  const [modalState, setModalState] = useState<
    | { type: 'create'; time: string }
    | { type: 'edit'; appointment: Appointment }
    | { type: 'block'; time: string }
    | null
  >(null);

  useEffect(() => {
    api.get<WeeklyAvailabilityDay[]>('/availability').then(setWeeklyAvailability).catch(() => {});
    api.get<Service[]>('/services').then(setServices).catch(() => {});
    api.get<{ bookingHorizonDays: number }>('/availability/horizon')
      .then((d) => setHorizonDays(d.bookingHorizonDays))
      .catch(() => {});
  }, []);

  const maxDate = useMemo(() => addDays(startOfDay(new Date()), horizonDays), [horizonDays]);

  const rangeStart = useMemo(() => {
    if (view === 'dia') return currentDate;
    if (view === 'semana') return addDays(currentDate, -currentDate.getDay());
    const d = new Date(currentDate); d.setDate(1); return d;
  }, [view, currentDate]);

  const rangeEnd = useMemo(() => {
    if (view === 'dia') return addDays(currentDate, 1);
    if (view === 'semana') return addDays(rangeStart, 7);
    const d = new Date(rangeStart); d.setMonth(d.getMonth() + 1); return d;
  }, [view, currentDate, rangeStart]);

  function reload() {
    api.get<Appointment[]>(`/appointments?from=${rangeStart.toISOString()}&to=${rangeEnd.toISOString()}`)
      .then(setAppointments).catch(() => {});
    api.get<BlockedTime[]>(`/availability/blocked?from=${rangeStart.toISOString()}&to=${rangeEnd.toISOString()}`).then(setBlocked).catch(() => {});
    setModalState(null);
  }
  useEffect(reload, [rangeStart.getTime(), rangeEnd.getTime()]);

  const dayAvailability = weeklyAvailability.find((d) => d.weekday === currentDate.getDay());

  const canGoForward = useMemo(() => {
    if (view === 'dia') return addDays(currentDate, 1).getTime() <= maxDate.getTime();
    if (view === 'semana') return addDays(rangeStart, 7).getTime() <= maxDate.getTime();
    const nextMonth = new Date(rangeStart);
    nextMonth.setMonth(nextMonth.getMonth() + 1);
    nextMonth.setDate(1);
    return nextMonth.getTime() <= maxDate.getTime();
  }, [view, currentDate, rangeStart, maxDate]);

  function navigate(dir: -1 | 1) {
    if (dir === 1 && !canGoForward) return;
    setCurrentDate((d) => {
      if (view === 'mes') {
        const r = new Date(d);
        r.setMonth(r.getMonth() + dir);
        r.setDate(1);
        return r;
      }
      return addDays(d, dir * (view === 'semana' ? 7 : 1));
    });
  }

  const dateLabel = (() => {
    if (view === 'dia')
      return currentDate.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
    if (view === 'semana')
      return `${rangeStart.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })} — ${addDays(rangeStart, 6).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })}`;
    return currentDate.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  })();

  return (
    <div className="space-y-6">

      {/* ── Cabeçalho ── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-3xl sm:text-4xl text-wine-800 leading-tight">Agenda</h1>
        {/* Toggle view */}
        <div className="flex gap-1 bg-white border border-wine-100/80 rounded-xl p-1 shadow-sm">
          {(['dia', 'semana', 'mes'] as ViewMode[]).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`px-3.5 py-1.5 text-sm rounded-lg capitalize font-medium transition-colors ${
                view === v ? 'bg-wine-600 text-white shadow-sm' : 'text-ink/55 hover:bg-wine-50 hover:text-ink/80'
              }`}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {/* ── Barra de navegação ── */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2 bg-white border border-wine-100/80 rounded-2xl px-3 py-2.5 shadow-sm">
          <button
            onClick={() => navigate(-1)}
            className="shrink-0 p-2 rounded-lg hover:bg-wine-50 text-ink/50 hover:text-wine-700 transition-colors"
            aria-label="Anterior"
          >
            <IconChevronLeft />
          </button>

          <span className="flex-1 min-w-0 font-medium text-ink/75 text-sm sm:text-base px-1 capitalize text-center truncate">
            {dateLabel}
          </span>

          <button
            onClick={() => setCurrentDate(startOfDay(new Date()))}
            className="shrink-0 px-3 py-1.5 text-xs rounded-lg bg-wine-600 text-white hover:bg-wine-700 transition-colors font-semibold"
          >
            Hoje
          </button>

          <button
            onClick={() => navigate(1)}
            disabled={!canGoForward}
            className={`shrink-0 p-2 rounded-lg transition-colors ${
              canGoForward
                ? 'hover:bg-wine-50 text-ink/50 hover:text-wine-700'
                : 'text-ink/20 cursor-not-allowed'
            }`}
            aria-label="Próximo"
            title={!canGoForward ? `Limite de ${horizonDays} dias de antecedência` : undefined}
          >
            <IconChevronRight />
          </button>
        </div>
        <p className="text-xs text-ink/30 text-right pr-1">
          Agenda aberta até{' '}
          <span className="font-medium text-ink/45">
            {maxDate.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })}
          </span>
        </p>
      </div>

      {/* ── Views ── */}
      {view === 'dia' && (
        <DayView
          date={currentDate}
          availability={dayAvailability}
          appointments={appointments}
          blocked={blocked}
          services={services}
          isBeyondHorizon={currentDate.getTime() > maxDate.getTime()}
          onSlotClick={(time, existing) =>
            existing
              ? setModalState({ type: 'edit', appointment: existing })
              : setModalState({ type: 'create', time })
          }
          onBlockClick={(time) => setModalState({ type: 'block', time })}
        />
      )}

      {view === 'semana' && (
        <WeekView
          rangeStart={rangeStart}
          appointments={appointments}
          weeklyAvailability={weeklyAvailability}
          maxDate={maxDate}
          onDayClick={(d) => { setCurrentDate(d); setView('dia'); }}
        />
      )}

      {view === 'mes' && (
        <MonthView
          rangeStart={rangeStart}
          appointments={appointments}
          maxDate={maxDate}
          onDayClick={(d) => { setCurrentDate(d); setView('dia'); }}
        />
      )}

      {/* ── Modais ── */}
      {modalState?.type === 'create' && (
        <AppointmentModal date={currentDate} time={modalState.time} appointment={null}
          onClose={() => setModalState(null)} onSaved={reload} />
      )}
      {modalState?.type === 'edit' && (
        <AppointmentModal date={new Date(modalState.appointment.startsAt)} time={null}
          appointment={modalState.appointment}
          onClose={() => setModalState(null)} onSaved={reload} />
      )}
      {modalState?.type === 'block' && (
        <BlockTimeModal date={currentDate} time={modalState.time}
          onClose={() => setModalState(null)} onSaved={reload} />
      )}
    </div>
  );
}

// ── DayView ───────────────────────────────────────────────────────────────────

function DayView({
  date,
  availability,
  appointments,
  blocked,
  services,
  isBeyondHorizon,
  onSlotClick,
  onBlockClick,
}: {
  date: Date;
  availability?: WeeklyAvailabilityDay;
  appointments: Appointment[];
  blocked: BlockedTime[];
  services: Service[];
  isBeyondHorizon: boolean;
  onSlotClick: (time: string, existing: Appointment | null) => void;
  onBlockClick: (time: string) => void;
}) {
  if (!availability || !availability.is_working) {
    return (
      <div className="bg-wine-50 border border-wine-100 rounded-2xl p-12 flex flex-col items-center gap-3 text-center">
        <div className="w-12 h-12 rounded-full bg-wine-100 flex items-center justify-center text-wine-400">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={1.6} viewBox="0 0 24 24">
            <path strokeLinecap="round" d="M3 12h18M12 3a9 9 0 1 0 0 18A9 9 0 0 0 12 3z" opacity=".3"/>
            <path strokeLinecap="round" d="M9 9l6 6M15 9l-6 6"/>
          </svg>
        </div>
        <div>
          <p className="font-display text-lg text-wine-700">Dia de folga</p>
          <p className="text-sm text-ink/40 mt-0.5">Nenhum horário disponível neste dia.</p>
        </div>
      </div>
    );
  }

  const dayStart    = toMinutes(availability.start_time!);
  const dayEnd      = toMinutes(availability.end_time!);
  const breakStart  = availability.break_start ? toMinutes(availability.break_start) : null;
  const breakEnd    = availability.break_end   ? toMinutes(availability.break_end)   : null;

  const slots: number[] = [];
  for (let m = dayStart; m < dayEnd; m += 30) slots.push(m);

  const dayStartDate = startOfDay(date);
  const now = new Date();

  // Detectar próximo atendimento do dia
  const nextAppt = isToday(date)
    ? appointments
        .filter(a => new Date(a.startsAt) > now && a.status !== 'cancelado' && a.status !== 'concluido')
        .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime())[0]
    : undefined;

  return (
    <div className="bg-white border border-wine-100/80 rounded-2xl overflow-hidden shadow-sm">
      {/* Cabeçalho interno */}
      <div className="px-5 py-3 border-b border-wine-50 bg-gradient-to-r from-wine-50/60 to-transparent flex items-center justify-between">
        <span className="text-sm font-medium text-ink/60 capitalize">
          {date.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })}
        </span>
        {isToday(date) && (
          <span className="text-xs px-2.5 py-1 rounded-full bg-wine-600 text-white font-semibold">Hoje</span>
        )}
      </div>

      {/* Banner: data além do horizonte */}
      {isBeyondHorizon && (
        <div className="px-5 py-3 bg-amber-50/80 border-b border-amber-100 flex items-center gap-2 text-xs text-amber-700">
          <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
          </svg>
          Esta data está além da antecedência máxima configurada. Agendamentos desabilitados.
        </div>
      )}

      <div>
        {slots.map((min) => {
          const time        = minutesToLabel(min);
          const slotDate    = new Date(dayStartDate.getTime() + min * 60000);
          const isPast      = isToday(date) && slotDate < now;

          const isBreak = breakStart !== null && breakEnd !== null && min >= breakStart && min < breakEnd;

          const blockedHere = blocked.find((b) => {
            const s = new Date(b.starts_at).getTime();
            const e = new Date(b.ends_at).getTime();
            return slotDate.getTime() >= s && slotDate.getTime() < e;
          });

          const apptHere = appointments.find((a) => {
            const s = new Date(a.startsAt).getTime();
            const e = new Date(a.endsAt).getTime();
            return slotDate.getTime() >= s && slotDate.getTime() < e && a.status !== 'cancelado';
          });

          // ── Intervalo ──
          if (isBreak) {
            return (
              <div key={time} className="flex items-center gap-4 px-5 py-2.5 bg-ink/[0.02] border-b border-wine-50/60">
                <span className="text-xs font-medium text-ink/25 tabular-nums w-12 shrink-0">{time}</span>
                <span className="text-xs text-ink/30 italic">Intervalo</span>
              </div>
            );
          }

          // ── Bloqueado ──
          if (blockedHere) {
            return (
              <div key={time} className="flex items-center gap-4 px-5 py-3 border-l-2 border-ink/20 bg-ink/[0.02] border-b border-wine-50/60">
                <span className="text-xs font-semibold text-ink/30 tabular-nums w-12 shrink-0">{time}</span>
                <span className="flex items-center gap-1.5 text-xs text-ink/40">
                  <IconLock />
                  Bloqueado{blockedHere.reason ? ` — ${blockedHere.reason}` : ''}
                </span>
              </div>
            );
          }

          // ── Com agendamento ──
          if (apptHere) {
            const isStartSlot = new Date(apptHere.startsAt).getTime() === slotDate.getTime();
            const isNext      = nextAppt?.id === apptHere.id;
            const cfg         = getCfg(apptHere.status);
            const svc         = services.find(s => s.id === apptHere.serviceId);
            const dur         = durationMin(apptHere);

            if (isStartSlot) {
              return (
                <div
                  key={time}
                  className={`group flex gap-3 px-4 py-3 border-l-[3px] border-b border-wine-50/60 ${cfg.border} ${cfg.bg} ${isNext ? 'ring-inset ring-1 ring-gold-400/30' : ''}`}
                >
                  {/* Time */}
                  <div className="shrink-0 pt-0.5">
                    <span className={`text-sm font-bold tabular-nums ${isNext ? 'text-wine-700' : 'text-ink/55'}`}>
                      {time}
                    </span>
                  </div>

                  {/* Conteúdo */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2 flex-wrap">
                      {/* Nome + badge de próximo */}
                      <div className="flex items-center gap-2 min-w-0 flex-wrap">
                        <p className="font-bold text-ink leading-tight truncate">{apptHere.clientName}</p>
                        {apptHere.recurringGroupId && <IconRecurring />}
                        {isNext && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-gold-400/20 text-gold-600 border border-gold-300/50 rounded-full px-2 py-0.5 whitespace-nowrap">
                            <span className="w-1.5 h-1.5 rounded-full bg-gold-500 animate-pulse" />
                            Próximo
                          </span>
                        )}
                      </div>
                      {/* Status + editar */}
                      <div className="flex items-center gap-2 shrink-0">
                        <StatusBadge status={apptHere.status} />
                        <button
                          onClick={() => onSlotClick(time, apptHere)}
                          className="p-1.5 rounded-lg hover:bg-white/80 text-ink/40 hover:text-wine-700 transition-colors md:opacity-0 md:group-hover:opacity-100"
                          title="Editar"
                        >
                          <IconPencil />
                        </button>
                      </div>
                    </div>
                    {/* Serviço + detalhes */}
                    <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                      <p className="text-xs text-ink/50 truncate">{apptHere.serviceName}</p>
                      <span className="text-ink/20 text-xs">·</span>
                      <span className="text-xs text-ink/40">{dur} min</span>
                      {svc && (
                        <>
                          <span className="text-ink/20 text-xs">·</span>
                          <span className="text-xs font-semibold text-wine-700">{formatMoney(svc.priceCents)}</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            }

            // Slot de continuação
            return (
              <div
                key={time}
                className={`flex items-center gap-3 px-4 py-2 border-l-[3px] border-b border-wine-50/60 ${cfg.border} ${cfg.bg}`}
              >
                <span className="text-xs text-ink/20 tabular-nums w-12 shrink-0">{time}</span>
                <span className="text-ink/20 text-xs tracking-widest select-none">· · ·</span>
              </div>
            );
          }

          // ── Disponível ──
          return (
            <div
              key={time}
              className={`group flex items-center justify-between gap-2 px-4 py-2.5 min-h-[44px] border-b border-wine-50/40 transition-colors ${
                isPast || isBeyondHorizon ? 'opacity-50' : 'hover:bg-wine-50/40'
              }`}
            >
              <span className={`text-xs tabular-nums w-12 shrink-0 ${isPast || isBeyondHorizon ? 'text-ink/20 font-normal' : 'text-ink/30 font-medium'}`}>
                {time}
              </span>
              {!isBeyondHorizon && (
                <div className="flex gap-2 transition-opacity md:opacity-0 md:group-hover:opacity-100">
                  <button
                    onClick={() => onSlotClick(time, null)}
                    className="text-xs px-3 py-1.5 rounded-lg bg-wine-600 text-white hover:bg-wine-700 transition-colors font-medium"
                  >
                    + Agendar
                  </button>
                  <button
                    onClick={() => onBlockClick(time)}
                    className="hidden sm:block text-xs px-3 py-1.5 rounded-lg border border-wine-100 text-ink/50 hover:bg-white hover:border-wine-200 transition-colors"
                  >
                    Bloquear
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── WeekView ──────────────────────────────────────────────────────────────────

const WEEKDAY_NAMES = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

function WeekView({
  rangeStart,
  appointments,
  weeklyAvailability,
  maxDate,
  onDayClick,
}: {
  rangeStart: Date;
  appointments: Appointment[];
  weeklyAvailability: WeeklyAvailabilityDay[];
  maxDate: Date;
  onDayClick: (d: Date) => void;
}) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(rangeStart, i));

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
      {days.map((day) => {
        const today    = isToday(day);
        const avail    = weeklyAvailability.find((a) => a.weekday === day.getDay());
        const isWorking = avail?.is_working ?? true;
        const beyond   = day.getTime() > maxDate.getTime();
        const dayAppts = appointments
          .filter(a => startOfDay(new Date(a.startsAt)).getTime() === day.getTime() && a.status !== 'cancelado')
          .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());

        return (
          <button
            key={day.toISOString()}
            onClick={() => !beyond && onDayClick(day)}
            disabled={beyond}
            className={`text-left rounded-2xl border p-4 transition-all ${
              beyond
                ? 'border-ink/5 bg-ink/[0.02] opacity-40 cursor-not-allowed'
                : today
                  ? 'border-wine-400 bg-wine-50 shadow-sm hover:shadow-md'
                  : 'border-wine-100/80 bg-white hover:border-wine-200 hover:shadow-md'
            } ${!isWorking && !beyond ? 'opacity-45' : ''}`}
          >
            <div className="flex items-start justify-between mb-3">
              <div>
                <p className="text-[11px] text-ink/45 font-semibold uppercase tracking-wide">{WEEKDAY_NAMES[day.getDay()]}</p>
                <p className={`font-display text-2xl leading-none mt-0.5 ${today ? 'text-wine-700' : 'text-ink/65'}`}>
                  {day.getDate()}
                </p>
              </div>
              {today && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-wine-600 text-white font-semibold">Hoje</span>
              )}
            </div>

            {dayAppts.length === 0 ? (
              <p className="text-xs text-ink/30 italic">{isWorking ? 'Livre' : 'Folga'}</p>
            ) : (
              <ul className="space-y-1.5">
                {dayAppts.slice(0, 3).map((a) => (
                  <li key={a.id} className="flex items-center gap-1.5">
                    <StatusDot status={a.status} size="xs" />
                    <span className="text-xs text-ink/65 truncate leading-tight">
                      <span className="font-semibold text-wine-700 tabular-nums">
                        {new Date(a.startsAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                      </span>{' '}
                      {a.clientName}
                    </span>
                  </li>
                ))}
                {dayAppts.length > 3 && (
                  <li className="text-xs text-ink/35">+{dayAppts.length - 3} mais</li>
                )}
              </ul>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ── MonthView ─────────────────────────────────────────────────────────────────

const MONTH_HEADERS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

function MonthView({
  rangeStart,
  appointments,
  maxDate,
  onDayClick,
}: {
  rangeStart: Date;
  appointments: Appointment[];
  maxDate: Date;
  onDayClick: (d: Date) => void;
}) {
  const firstWeekday = rangeStart.getDay();
  const daysInMonth  = new Date(rangeStart.getFullYear(), rangeStart.getMonth() + 1, 0).getDate();
  const cells: (Date | null)[] = [
    ...Array(firstWeekday).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => new Date(rangeStart.getFullYear(), rangeStart.getMonth(), i + 1)),
  ];

  return (
    <div className="bg-white border border-wine-100/80 rounded-2xl overflow-hidden shadow-sm">
      <div className="grid grid-cols-7 border-b border-wine-50">
        {MONTH_HEADERS.map((d) => (
          <div key={d} className="text-center text-[11px] font-semibold text-ink/35 uppercase tracking-wide py-3">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 divide-x divide-y divide-wine-50/60">
        {cells.map((day, i) => {
          if (!day) return <div key={i} className="aspect-square" />;
          const today  = isToday(day);
          const beyond = day.getTime() > maxDate.getTime();
          const dayAppts = appointments.filter(
            a => startOfDay(new Date(a.startsAt)).getTime() === day.getTime() && a.status !== 'cancelado'
          );
          const statusSet = [...new Set(dayAppts.map(a => a.status))].slice(0, 3);

          return (
            <button
              key={i}
              onClick={() => !beyond && onDayClick(day)}
              disabled={beyond}
              className={`aspect-square flex flex-col items-center justify-center gap-1 transition-colors ${
                beyond
                  ? 'opacity-30 cursor-not-allowed'
                  : `hover:bg-wine-50/60 ${today ? 'bg-wine-50' : ''}`
              }`}
            >
              <span className={`text-sm w-7 h-7 flex items-center justify-center rounded-full font-medium leading-none transition-colors ${
                today && !beyond ? 'bg-wine-600 text-white' : 'text-ink/65 hover:bg-wine-100'
              }`}>
                {day.getDate()}
              </span>
              {statusSet.length > 0 && !beyond && (
                <div className="flex gap-0.5 items-center">
                  {statusSet.map(s => (
                    <span key={s} className={`w-1.5 h-1.5 rounded-full ${getCfg(s).dot}`} />
                  ))}
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
