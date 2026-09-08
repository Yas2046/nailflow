import { useEffect, useState } from 'react';
import { api } from '../services/api';
import type { WeeklyAvailabilityDay } from '../types';

const weekdayLabels = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

interface DayForm {
  weekday: number;
  isWorking: boolean;
  startTime: string;
  endTime: string;
  breakStart: string;
  breakEnd: string;
}

const emptyDay = (weekday: number): DayForm => ({
  weekday,
  isWorking: weekday !== 0,
  startTime: '08:00',
  endTime: '18:00',
  breakStart: '12:00',
  breakEnd: '13:00',
});

export default function Disponibilidade() {
  const [days, setDays] = useState<DayForm[]>(Array.from({ length: 7 }, (_, i) => emptyDay(i)));
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<WeeklyAvailabilityDay[]>('/availability').then((rows) => {
      if (rows.length === 0) return;
      setDays(
        Array.from({ length: 7 }, (_, i) => {
          const found = rows.find((r) => r.weekday === i);
          if (!found) return emptyDay(i);
          return {
            weekday: i,
            isWorking: found.is_working,
            startTime: found.start_time?.slice(0, 5) || '08:00',
            endTime: found.end_time?.slice(0, 5) || '18:00',
            breakStart: found.break_start?.slice(0, 5) || '',
            breakEnd: found.break_end?.slice(0, 5) || '',
          };
        })
      );
    });
  }, []);

  function updateDay(weekday: number, patch: Partial<DayForm>) {
    setDays((prev) => prev.map((d) => (d.weekday === weekday ? { ...d, ...patch } : d)));
    setSaved(false);
  }

  // Validações simples de formulário — só para pegar configurações
  // claramente inválidas (ex.: fim antes do início). A validação "de
  // verdade" de disponibilidade continua inteiramente no backend.
  function validate(): string | null {
    for (const day of days) {
      if (!day.isWorking) continue;
      const label = weekdayLabels[day.weekday];

      if (day.startTime >= day.endTime) {
        return `${label}: o horário de início precisa ser antes do horário de fim.`;
      }

      const hasBreakStart = !!day.breakStart;
      const hasBreakEnd = !!day.breakEnd;
      if (hasBreakStart !== hasBreakEnd) {
        return `${label}: preencha início e fim do almoço, ou deixe os dois em branco.`;
      }
      if (hasBreakStart && hasBreakEnd) {
        if (day.breakStart >= day.breakEnd) {
          return `${label}: o início do almoço precisa ser antes do fim do almoço.`;
        }
        if (day.breakStart < day.startTime || day.breakEnd > day.endTime) {
          return `${label}: o intervalo de almoço precisa estar dentro do expediente.`;
        }
      }
    }
    return null;
  }

  async function handleSave() {
    setError(null);
    setSaved(false);

    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    try {
      await api.put('/availability', days.map((d) => ({
        weekday: d.weekday,
        isWorking: d.isWorking,
        startTime: d.isWorking ? d.startTime : null,
        endTime: d.isWorking ? d.endTime : null,
        breakStart: d.isWorking && d.breakStart ? d.breakStart : null,
        breakEnd: d.isWorking && d.breakEnd ? d.breakEnd : null,
      })));
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar disponibilidade.');
    }
  }

  return (
    <div>
      <h1 className="font-display text-3xl text-wine-700 mb-6">Disponibilidade</h1>
      <p className="text-sm text-ink/60 mb-6 max-w-xl">
        Defina os dias e horários em que você atende. Esses horários são usados para calcular
        automaticamente os horários disponíveis na agenda e na página pública.
      </p>

      <div className="bg-white border border-wine-100 rounded-xl divide-y divide-wine-50 mb-6">
        {days.map((day) => (
          <div key={day.weekday} className="flex flex-wrap items-center gap-4 px-5 py-4">
            <label className="flex items-center gap-2 w-32">
              <input
                type="checkbox"
                checked={day.isWorking}
                onChange={(e) => updateDay(day.weekday, { isWorking: e.target.checked })}
              />
              <span className="font-medium text-sm">{weekdayLabels[day.weekday]}</span>
            </label>

            {day.isWorking ? (
              <>
                <TimeField label="Início" value={day.startTime} onChange={(v) => updateDay(day.weekday, { startTime: v })} />
                <TimeField label="Fim" value={day.endTime} onChange={(v) => updateDay(day.weekday, { endTime: v })} />
                <TimeField label="Almoço início" value={day.breakStart} onChange={(v) => updateDay(day.weekday, { breakStart: v })} />
                <TimeField label="Almoço fim" value={day.breakEnd} onChange={(v) => updateDay(day.weekday, { breakEnd: v })} />
              </>
            ) : (
              <span className="text-sm text-ink/40">Folga</span>
            )}
          </div>
        ))}
      </div>

      {error && <p className="text-sm text-red-600 mb-3">{error}</p>}
      {saved && <p className="text-sm text-sage-500 mb-3">Disponibilidade salva com sucesso.</p>}

      <button onClick={handleSave} className="px-5 py-2.5 rounded-lg bg-wine-600 text-white text-sm hover:bg-wine-700">
        Salvar disponibilidade
      </button>
    </div>
  );
}

function TimeField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex flex-col text-xs text-ink/60">
      {label}
      <input type="time" className="input mt-1" value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}
