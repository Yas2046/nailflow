import { useEffect, useMemo, useState } from 'react';
import { api } from '../services/api';
import type { Appointment, WeeklyAvailabilityDay } from '../types';
import AppointmentModal from '../components/AppointmentModal';
import BlockTimeModal from '../components/BlockTimeModal';

type ViewMode = 'dia' | 'semana' | 'mes';

interface BlockedTime {
  id: string;
  starts_at: string;
  ends_at: string;
  reason: string | null;
}

function startOfDay(d: Date) {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}
function addDays(d: Date, n: number) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}
function toMinutes(t: string) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}
function minutesToLabel(min: number) {
  return `${Math.floor(min / 60).toString().padStart(2, '0')}:${(min % 60).toString().padStart(2, '0')}`;
}
function isToday(d: Date) {
  return startOfDay(d).getTime() === startOfDay(new Date()).getTime();
}

// ─── ícones ──────────────────────────────────────────────────────────────────

function IconChevronLeft() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
    </svg>
  );
}
function IconChevronRight() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
    </svg>
  );
}

// ─── página principal ─────────────────────────────────────────────────────────

export default function Agenda() {
  const [view, setView] = useState<ViewMode>('dia');
  const [currentDate, setCurrentDate] = useState(startOfDay(new Date()));
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [blocked, setBlocked] = useState<BlockedTime[]>([]);
  const [weeklyAvailability, setWeeklyAvailability] = useState<WeeklyAvailabilityDay[]>([]);
  const [modalState, setModalState] = useState<
    | { type: 'create'; time: string }
    | { type: 'edit'; appointment: Appointment }
    | { type: 'block'; time: string }
    | null
  >(null);

  useEffect(() => {
    api.get<WeeklyAvailabilityDay[]>('/availability').then(setWeeklyAvailability).catch(() => {});
  }, []);

  const rangeStart = useMemo(() => {
    if (view === 'dia') return currentDate;
    if (view === 'semana') return addDays(currentDate, -currentDate.getDay());
    const d = new Date(currentDate);
    d.setDate(1);
    return d;
  }, [view, currentDate]);

  const rangeEnd = useMemo(() => {
    if (view === 'dia') return addDays(currentDate, 1);
    if (view === 'semana') return addDays(rangeStart, 7);
    const d = new Date(rangeStart);
    d.setMonth(d.getMonth() + 1);
    return d;
  }, [view, currentDate, rangeStart]);

  function reload() {
    api
      .get<Appointment[]>(`/appointments?from=${rangeStart.toISOString()}&to=${rangeEnd.toISOString()}`)
      .then(setAppointments)
      .catch(() => {});
    api.get<BlockedTime[]>('/availability/blocked').then(setBlocked).catch(() => {});
    setModalState(null);
  }

  useEffect(reload, [rangeStart.getTime(), rangeEnd.getTime()]);

  const dayAvailability = weeklyAvailability.find((d) => d.weekday === currentDate.getDay());

  function navigate(dir: -1 | 1) {
    setCurrentDate((d) => addDays(d, dir * (view === 'mes' ? 30 : view === 'semana' ? 7 : 1)));
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
      {/* cabeçalho */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="font-display text-3xl text-wine-700">Agenda</h1>

        {/* toggle de view */}
        <div className="flex gap-1 bg-white border border-wine-100 rounded-lg p-1 shadow-sm">
          {(['dia', 'semana', 'mes'] as ViewMode[]).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`px-3 py-1.5 text-sm rounded-md capitalize transition-colors ${
                view === v ? 'bg-wine-600 text-white shadow-sm' : 'text-ink/60 hover:bg-wine-50'
              }`}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {/* barra de navegação de data */}
      <div className="flex items-center gap-2 bg-white border border-wine-100 rounded-xl px-3 py-2 shadow-sm">
        <button
          onClick={() => navigate(-1)}
          className="shrink-0 p-1.5 rounded-md hover:bg-wine-50 text-ink/60 transition-colors"
          aria-label="Anterior"
        >
          <IconChevronLeft />
        </button>

        <button
          onClick={() => setCurrentDate(startOfDay(new Date()))}
          className="shrink-0 px-2.5 py-1 text-xs rounded-md bg-wine-50 text-wine-600 hover:bg-wine-100 transition-colors font-medium"
        >
          Hoje
        </button>

        <span className="flex-1 min-w-0 font-medium text-ink/80 text-sm px-1 capitalize text-center truncate">
          {dateLabel}
        </span>

        <button
          onClick={() => navigate(1)}
          className="shrink-0 p-1.5 rounded-md hover:bg-wine-50 text-ink/60 transition-colors"
          aria-label="Próximo"
        >
          <IconChevronRight />
        </button>
      </div>

      {/* views */}
      {view === 'dia' && (
        <DayView
          date={currentDate}
          availability={dayAvailability}
          appointments={appointments}
          blocked={blocked}
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
          onDayClick={(d) => { setCurrentDate(d); setView('dia'); }}
        />
      )}

      {view === 'mes' && (
        <MonthView
          rangeStart={rangeStart}
          appointments={appointments}
          onDayClick={(d) => { setCurrentDate(d); setView('dia'); }}
        />
      )}

      {/* modais */}
      {modalState?.type === 'create' && (
        <AppointmentModal
          date={currentDate}
          time={modalState.time}
          appointment={null}
          onClose={() => setModalState(null)}
          onSaved={reload}
        />
      )}
      {modalState?.type === 'edit' && (
        <AppointmentModal
          date={new Date(modalState.appointment.startsAt)}
          time={null}
          appointment={modalState.appointment}
          onClose={() => setModalState(null)}
          onSaved={reload}
        />
      )}
      {modalState?.type === 'block' && (
        <BlockTimeModal
          date={currentDate}
          time={modalState.time}
          onClose={() => setModalState(null)}
          onSaved={reload}
        />
      )}
    </div>
  );
}

// ─── DayView ──────────────────────────────────────────────────────────────────

function DayView({
  date,
  availability,
  appointments,
  blocked,
  onSlotClick,
  onBlockClick,
}: {
  date: Date;
  availability?: WeeklyAvailabilityDay;
  appointments: Appointment[];
  blocked: BlockedTime[];
  onSlotClick: (time: string, existing: Appointment | null) => void;
  onBlockClick: (time: string) => void;
}) {
  if (!availability || !availability.is_working) {
    return (
      <div className="bg-white border border-wine-100 rounded-xl p-10 flex flex-col items-center gap-2 text-ink/40">
        <svg className="w-8 h-8" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
          <path strokeLinecap="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
        <p className="text-sm">Dia de folga</p>
      </div>
    );
  }

  const dayStart = toMinutes(availability.start_time!);
  const dayEnd = toMinutes(availability.end_time!);
  const breakStart = availability.break_start ? toMinutes(availability.break_start) : null;
  const breakEnd = availability.break_end ? toMinutes(availability.break_end) : null;

  const slots: number[] = [];
  for (let m = dayStart; m < dayEnd; m += 30) slots.push(m);

  const dayStartDate = startOfDay(date);

  return (
    <div className="bg-white border border-wine-100 rounded-xl overflow-hidden shadow-sm">
      {/* cabeçalho do dia */}
      <div className="px-5 py-3 border-b border-wine-50 bg-wine-50/40 flex items-center justify-between">
        <span className="text-sm font-medium text-ink/70 capitalize">
          {date.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })}
        </span>
        {isToday(date) && (
          <span className="text-xs px-2.5 py-1 rounded-full bg-wine-600 text-white font-medium">Hoje</span>
        )}
      </div>

      <div className="divide-y divide-wine-50/60">
        {slots.map((min) => {
          const time = minutesToLabel(min);
          const slotDate = new Date(dayStartDate.getTime() + min * 60000);

          const isBreak =
            breakStart !== null && breakEnd !== null && min >= breakStart && min < breakEnd;

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

          // ── slot de intervalo ──
          if (isBreak) {
            return (
              <div key={time} className="flex items-center gap-4 px-5 py-2 bg-ink/[0.03]">
                <span className="text-xs font-medium text-ink/30 tabular-nums w-10">{time}</span>
                <span className="text-xs text-ink/30 italic">Intervalo</span>
              </div>
            );
          }

          // ── slot bloqueado ──
          if (blockedHere) {
            return (
              <div key={time} className="flex items-center gap-4 px-5 py-2.5 border-l-4 border-ink/20 bg-ink/[0.03]">
                <span className="text-xs font-medium text-ink/40 tabular-nums w-10">{time}</span>
                <span className="flex items-center gap-1.5 text-xs text-ink/50">
                  <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
                    <rect x="3" y="11" width="18" height="11" rx="2" />
                    <path strokeLinecap="round" d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                  Bloqueado{blockedHere.reason ? ` — ${blockedHere.reason}` : ''}
                </span>
              </div>
            );
          }

          // ── slot com agendamento ──
          if (apptHere) {
            const isStartSlot = new Date(apptHere.startsAt).getTime() === slotDate.getTime();

            const accentMap: Record<string, string> = {
              confirmado: 'border-wine-500',
              pendente:   'border-gold-500',
              concluido:  'border-sage-500',
            };
            const bgMap: Record<string, string> = {
              confirmado: 'bg-wine-500/5',
              pendente:   'bg-gold-500/5',
              concluido:  'bg-sage-500/5',
            };
            const accent = accentMap[apptHere.status] ?? 'border-wine-500';
            const bg = bgMap[apptHere.status] ?? 'bg-wine-500/5';

            return (
              <div
                key={time}
                className={`group flex items-center justify-between gap-2 px-4 py-2.5 min-h-[44px] border-l-4 ${accent} ${bg}`}
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <span className="text-xs font-semibold text-ink/50 tabular-nums w-10 shrink-0">{time}</span>
                  {isStartSlot ? (
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="text-sm font-semibold text-ink leading-tight truncate">{apptHere.clientName}</p>
                        {apptHere.recurringGroupId && (
                          <svg className="shrink-0 w-3.5 h-3.5 text-wine-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-label="Recorrente">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                          </svg>
                        )}
                      </div>
                      <p className="text-xs text-ink/50 truncate">{apptHere.serviceName}</p>
                    </div>
                  ) : (
                    <span className="text-xs text-ink/20 select-none tracking-widest">· · ·</span>
                  )}
                </div>
                {isStartSlot && (
                  <button
                    onClick={() => onSlotClick(time, apptHere)}
                    className="shrink-0 text-xs px-3 py-1.5 rounded-lg border border-wine-200 text-wine-700 hover:bg-wine-50 transition-colors md:opacity-0 md:group-hover:opacity-100 md:transition-opacity"
                  >
                    Editar
                  </button>
                )}
              </div>
            );
          }

          // ── slot disponível ──
          return (
            <div
              key={time}
              className="group flex items-center justify-between gap-2 px-4 py-2.5 min-h-[44px] hover:bg-wine-50/50 transition-colors"
            >
              <span className="text-xs font-medium text-ink/30 tabular-nums w-10 shrink-0">{time}</span>
              <div className="flex gap-2 md:opacity-0 md:group-hover:opacity-100 md:transition-opacity md:duration-150">
                <button
                  onClick={() => onSlotClick(time, null)}
                  className="text-xs px-3 py-1.5 rounded-lg bg-wine-600 text-white hover:bg-wine-700 transition-colors"
                >
                  + Agendar
                </button>
                <button
                  onClick={() => onBlockClick(time)}
                  className="text-xs px-3 py-1.5 rounded-lg border border-wine-100 text-ink/60 hover:bg-white transition-colors"
                >
                  Bloquear
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── WeekView ─────────────────────────────────────────────────────────────────

const WEEKDAY_NAMES = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

function WeekView({
  rangeStart,
  appointments,
  weeklyAvailability,
  onDayClick,
}: {
  rangeStart: Date;
  appointments: Appointment[];
  weeklyAvailability: WeeklyAvailabilityDay[];
  onDayClick: (d: Date) => void;
}) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(rangeStart, i));

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
      {days.map((day) => {
        const today = isToday(day);
        const avail = weeklyAvailability.find((a) => a.weekday === day.getDay());
        const isWorking = avail?.is_working ?? true;

        const dayAppts = appointments
          .filter(
            (a) =>
              startOfDay(new Date(a.startsAt)).getTime() === day.getTime() &&
              a.status !== 'cancelado'
          )
          .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());

        return (
          <button
            key={day.toISOString()}
            onClick={() => onDayClick(day)}
            className={`text-left rounded-xl border p-4 transition-all hover:shadow-md ${
              today
                ? 'border-wine-500 bg-wine-50 shadow-sm'
                : 'border-wine-100 bg-white hover:border-wine-200'
            } ${!isWorking ? 'opacity-50' : ''}`}
          >
            {/* cabeçalho do card */}
            <div className="flex items-start justify-between mb-3">
              <div>
                <p className="text-xs text-ink/50 font-medium">{WEEKDAY_NAMES[day.getDay()]}</p>
                <p
                  className={`font-display text-2xl leading-none mt-0.5 ${
                    today ? 'text-wine-700' : 'text-ink/70'
                  }`}
                >
                  {day.getDate()}
                </p>
              </div>
              {today && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-wine-600 text-white font-medium">
                  Hoje
                </span>
              )}
            </div>

            {/* lista de agendamentos */}
            {dayAppts.length === 0 ? (
              <p className="text-xs text-ink/30 italic">
                {isWorking ? 'Sem agendamentos' : 'Folga'}
              </p>
            ) : (
              <ul className="space-y-1">
                {dayAppts.slice(0, 3).map((a) => (
                  <li key={a.id} className="text-xs text-ink/70 truncate leading-tight">
                    <span className="font-semibold text-wine-700">
                      {new Date(a.startsAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                    </span>{' '}
                    {a.clientName}
                  </li>
                ))}
                {dayAppts.length > 3 && (
                  <li className="text-xs text-ink/40">+{dayAppts.length - 3} mais</li>
                )}
              </ul>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ─── MonthView ────────────────────────────────────────────────────────────────

const MONTH_HEADERS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

function MonthView({
  rangeStart,
  appointments,
  onDayClick,
}: {
  rangeStart: Date;
  appointments: Appointment[];
  onDayClick: (d: Date) => void;
}) {
  const firstWeekday = rangeStart.getDay();
  const daysInMonth = new Date(rangeStart.getFullYear(), rangeStart.getMonth() + 1, 0).getDate();
  const cells: (Date | null)[] = [
    ...Array(firstWeekday).fill(null),
    ...Array.from(
      { length: daysInMonth },
      (_, i) => new Date(rangeStart.getFullYear(), rangeStart.getMonth(), i + 1)
    ),
  ];

  return (
    <div className="bg-white border border-wine-100 rounded-xl overflow-hidden shadow-sm">
      {/* cabeçalho dos dias da semana */}
      <div className="grid grid-cols-7 border-b border-wine-50">
        {MONTH_HEADERS.map((d) => (
          <div key={d} className="text-center text-xs font-medium text-ink/40 py-2.5">
            {d}
          </div>
        ))}
      </div>

      {/* células do mês */}
      <div className="grid grid-cols-7 divide-x divide-y divide-wine-50/60">
        {cells.map((day, i) => {
          if (!day) return <div key={i} className="aspect-square" />;

          const today = isToday(day);
          const count = appointments.filter(
            (a) =>
              startOfDay(new Date(a.startsAt)).getTime() === day.getTime() &&
              a.status !== 'cancelado'
          ).length;

          return (
            <button
              key={i}
              onClick={() => onDayClick(day)}
              className={`aspect-square flex flex-col items-center justify-center gap-1 transition-colors hover:bg-wine-50 ${
                today ? 'bg-wine-50' : ''
              }`}
            >
              <span
                className={`text-sm w-7 h-7 flex items-center justify-center rounded-full font-medium leading-none ${
                  today ? 'bg-wine-600 text-white' : 'text-ink/70'
                }`}
              >
                {day.getDate()}
              </span>
              {count > 0 && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-wine-500/10 text-wine-600 font-medium leading-none">
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
