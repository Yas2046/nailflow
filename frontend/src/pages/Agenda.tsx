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
  const h = Math.floor(min / 60)
    .toString()
    .padStart(2, '0');
  const m = (min % 60).toString().padStart(2, '0');
  return `${h}:${m}`;
}

const statusColors: Record<string, string> = {
  disponivel: 'bg-sage-500/10 border-sage-500/40 text-sage-500',
  agendado: 'bg-wine-500/10 border-wine-500/40 text-wine-600',
  bloqueado: 'bg-ink/10 border-ink/30 text-ink/70',
  pendente: 'bg-gold-500/10 border-gold-500/50 text-gold-500',
  concluido: 'bg-sage-500/20 border-sage-500/50 text-sage-500',
};

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

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <h1 className="font-display text-3xl text-wine-700">Agenda</h1>
        <div className="flex gap-1 bg-white border border-wine-100 rounded-lg p-1">
          {(['dia', 'semana', 'mes'] as ViewMode[]).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`px-3 py-1.5 text-sm rounded-md capitalize ${
                view === v ? 'bg-wine-600 text-white' : 'text-ink/70 hover:bg-wine-50'
              }`}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => setCurrentDate((d) => addDays(d, view === 'mes' ? -30 : view === 'semana' ? -7 : -1))}
          className="px-3 py-1.5 rounded-lg border border-wine-100 text-sm hover:bg-white"
        >
          ← Anterior
        </button>
        <span className="font-medium text-ink/80">
          {view === 'dia' && currentDate.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })}
          {view === 'semana' && `Semana de ${rangeStart.toLocaleDateString('pt-BR')}`}
          {view === 'mes' && currentDate.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}
        </span>
        <button
          onClick={() => setCurrentDate((d) => addDays(d, view === 'mes' ? 30 : view === 'semana' ? 7 : 1))}
          className="px-3 py-1.5 rounded-lg border border-wine-100 text-sm hover:bg-white"
        >
          Próximo →
        </button>
      </div>

      {view === 'dia' && (
        <DayView
          date={currentDate}
          availability={dayAvailability}
          appointments={appointments}
          blocked={blocked}
          onSlotClick={(time, existing) =>
            existing ? setModalState({ type: 'edit', appointment: existing }) : setModalState({ type: 'create', time })
          }
          onBlockClick={(time) => setModalState({ type: 'block', time })}
        />
      )}

      {view === 'semana' && (
        <WeekView
          rangeStart={rangeStart}
          appointments={appointments}
          onDayClick={(d) => {
            setCurrentDate(d);
            setView('dia');
          }}
        />
      )}

      {view === 'mes' && (
        <MonthView
          rangeStart={rangeStart}
          appointments={appointments}
          onDayClick={(d) => {
            setCurrentDate(d);
            setView('dia');
          }}
        />
      )}

      {modalState?.type === 'create' && (
        <AppointmentModal date={currentDate} time={modalState.time} appointment={null} onClose={() => setModalState(null)} onSaved={reload} />
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
        <BlockTimeModal date={currentDate} time={modalState.time} onClose={() => setModalState(null)} onSaved={reload} />
      )}
    </div>
  );
}

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
    return <p className="text-ink/60 bg-white border border-wine-100 rounded-xl p-6">Dia de folga.</p>;
  }

  const dayStart = toMinutes(availability.start_time!);
  const dayEnd = toMinutes(availability.end_time!);
  const breakStart = availability.break_start ? toMinutes(availability.break_start) : null;
  const breakEnd = availability.break_end ? toMinutes(availability.break_end) : null;

  const slots: number[] = [];
  for (let m = dayStart; m < dayEnd; m += 30) slots.push(m);

  const dayStartDate = startOfDay(date);

  return (
    <div className="bg-white border border-wine-100 rounded-xl divide-y divide-wine-50">
      {slots.map((min) => {
        const time = minutesToLabel(min);
        const slotDate = new Date(dayStartDate.getTime() + min * 60000);

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

        let content;
        let colorClass = statusColors.disponivel;
        let clickable = true;

        if (isBreak) {
          content = <span className="text-ink/50">Intervalo</span>;
          colorClass = 'bg-ink/5 border-ink/10 text-ink/40';
          clickable = false;
        } else if (apptHere) {
          content = (
            <span>
              <strong>{apptHere.clientName}</strong> — {apptHere.serviceName}
            </span>
          );
          colorClass = apptHere.status === 'concluido' ? statusColors.concluido : apptHere.status === 'pendente' ? statusColors.pendente : statusColors.agendado;
        } else if (blockedHere) {
          // Horário bloqueado nunca deve poder ser agendado — sem botão de
          // ação aqui, igual ao intervalo de almoço.
          content = <span>Bloqueado{blockedHere.reason ? ` — ${blockedHere.reason}` : ''}</span>;
          colorClass = statusColors.bloqueado;
          clickable = false;
        } else {
          content = <span>Disponível</span>;
        }

        return (
          <div key={time} className={`flex items-center justify-between px-4 py-3 ${colorClass} border-l-4`}>
            <div className="flex items-center gap-4">
              <span className="text-sm font-medium w-14">{time}</span>
              {content}
            </div>
            {clickable && (
              <div className="flex gap-2">
                <button
                  onClick={() => onSlotClick(time, apptHere || null)}
                  className="text-xs px-3 py-1 rounded-md border border-current hover:bg-white"
                >
                  {apptHere ? 'Editar' : 'Agendar'}
                </button>
                {!apptHere && !blockedHere && (
                  <button
                    onClick={() => onBlockClick(time)}
                    className="text-xs px-3 py-1 rounded-md border border-current hover:bg-white"
                  >
                    Bloquear
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function WeekView({
  rangeStart,
  appointments,
  onDayClick,
}: {
  rangeStart: Date;
  appointments: Appointment[];
  onDayClick: (d: Date) => void;
}) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(rangeStart, i));
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {days.map((day) => {
        const dayAppts = appointments.filter(
          (a) => startOfDay(new Date(a.startsAt)).getTime() === day.getTime() && a.status !== 'cancelado'
        );
        return (
          <button
            key={day.toISOString()}
            onClick={() => onDayClick(day)}
            className="text-left bg-white border border-wine-100 rounded-xl p-4 hover:shadow-md transition-shadow"
          >
            <p className="text-sm text-ink/60 mb-2 capitalize">
              {day.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' })}
            </p>
            <p className="font-display text-2xl text-wine-700 mb-1">{dayAppts.length}</p>
            <p className="text-xs text-ink/50">agendamento(s)</p>
          </button>
        );
      })}
    </div>
  );
}

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
  const cells: (Date | null)[] = [...Array(firstWeekday).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => new Date(rangeStart.getFullYear(), rangeStart.getMonth(), i + 1))];

  return (
    <div className="grid grid-cols-7 gap-2">
      {['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map((d, i) => (
        <div key={i} className="text-center text-xs text-ink/50 font-medium py-1">
          {d}
        </div>
      ))}
      {cells.map((day, i) => {
        if (!day) return <div key={i} />;
        const count = appointments.filter(
          (a) => startOfDay(new Date(a.startsAt)).getTime() === day.getTime() && a.status !== 'cancelado'
        ).length;
        return (
          <button
            key={i}
            onClick={() => onDayClick(day)}
            className="aspect-square bg-white border border-wine-100 rounded-lg flex flex-col items-center justify-center hover:shadow-md"
          >
            <span className="text-sm">{day.getDate()}</span>
            {count > 0 && <span className="text-[10px] mt-1 px-1.5 rounded-full bg-wine-500/10 text-wine-600">{count}</span>}
          </button>
        );
      })}
    </div>
  );
}
