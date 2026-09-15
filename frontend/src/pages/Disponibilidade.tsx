import { useEffect, useState } from 'react';
import { api } from '../services/api';
import type { WeeklyAvailabilityDay } from '../types';

const weekdayLabels = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const weekdayShort  = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

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

// ─── componentes auxiliares ───────────────────────────────────────────────────

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex w-11 h-6 rounded-full transition-colors duration-200 focus:outline-none ${
        checked ? 'bg-wine-600' : 'bg-ink/20'
      }`}
    >
      <span
        className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform duration-200 ${
          checked ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  );
}

function TimeField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-ink/50 mb-1">{label}</span>
      <input
        type="time"
        className="input text-sm"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

function LoadingSkeleton() {
  return (
    <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 animate-pulse">
      {[0, 1, 2, 3, 4, 5, 6].map((i) => (
        <div key={i} className="bg-white border border-wine-100 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="h-4 w-20 bg-wine-50 rounded" />
            <div className="h-6 w-11 bg-wine-50 rounded-full" />
          </div>
          <div className="space-y-3">
            <div className="h-3 w-24 bg-wine-50/70 rounded" />
            <div className="grid grid-cols-2 gap-2">
              <div className="h-9 bg-wine-50 rounded-lg" />
              <div className="h-9 bg-wine-50 rounded-lg" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── card de um dia ───────────────────────────────────────────────────────────

function DayCard({
  day,
  onUpdate,
}: {
  day: DayForm;
  onUpdate: (patch: Partial<DayForm>) => void;
}) {
  const hasBreak = !!(day.breakStart && day.breakEnd);

  return (
    <div
      className={`bg-white border rounded-xl overflow-hidden transition-opacity ${
        day.isWorking ? 'border-wine-100 shadow-sm' : 'border-ink/10 opacity-60'
      }`}
    >
      {/* cabeçalho do card */}
      <div className="flex items-center justify-between px-5 py-4">
        <div className="flex items-center gap-3">
          <Toggle checked={day.isWorking} onChange={(v) => onUpdate({ isWorking: v })} />
          <div>
            <p className={`font-semibold text-sm leading-tight ${day.isWorking ? 'text-ink' : 'text-ink/40'}`}>
              {weekdayLabels[day.weekday]}
            </p>
            {day.isWorking ? (
              <p className="text-xs text-ink/40 leading-tight mt-0.5">
                {day.startTime} – {day.endTime}
              </p>
            ) : (
              <p className="text-xs text-ink/30 italic leading-tight mt-0.5">Folga</p>
            )}
          </div>
        </div>

        {/* badge dia da semana abreviado */}
        <span
          className={`text-xs font-medium px-2 py-1 rounded-md ${
            day.isWorking ? 'bg-wine-50 text-wine-600' : 'bg-ink/5 text-ink/30'
          }`}
        >
          {weekdayShort[day.weekday]}
        </span>
      </div>

      {/* corpo — só quando é dia de trabalho */}
      {day.isWorking && (
        <div className="border-t border-wine-50 px-5 pb-5 pt-4 space-y-4">
          {/* horário de atendimento */}
          <div>
            <p className="text-xs font-semibold text-ink/30 uppercase tracking-wide mb-2">
              Atendimento
            </p>
            <div className="grid grid-cols-2 gap-2">
              <TimeField
                label="Início"
                value={day.startTime}
                onChange={(v) => onUpdate({ startTime: v })}
              />
              <TimeField
                label="Fim"
                value={day.endTime}
                onChange={(v) => onUpdate({ endTime: v })}
              />
            </div>
          </div>

          {/* intervalo / almoço */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-ink/30 uppercase tracking-wide">
                Intervalo
              </p>
              {/* botão para limpar o intervalo quando preenchido */}
              {hasBreak && (
                <button
                  type="button"
                  onClick={() => onUpdate({ breakStart: '', breakEnd: '' })}
                  className="text-xs text-ink/30 hover:text-rose-500 transition-colors"
                >
                  Remover
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <TimeField
                label="Início"
                value={day.breakStart}
                onChange={(v) => onUpdate({ breakStart: v })}
              />
              <TimeField
                label="Fim"
                value={day.breakEnd}
                onChange={(v) => onUpdate({ breakEnd: v })}
              />
            </div>
            {!hasBreak && (
              <p className="text-xs text-ink/30 mt-1.5 italic">
                Deixe em branco se não houver intervalo.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── página ───────────────────────────────────────────────────────────────────

export default function Disponibilidade() {
  const [days, setDays]       = useState<DayForm[] | null>(null);
  const [error, setError]     = useState<string | null>(null);
  const [saved, setSaved]     = useState(false);
  const [saving, setSaving]   = useState(false);
  const [dirty, setDirty]     = useState(false);

  useEffect(() => {
    api.get<WeeklyAvailabilityDay[]>('/availability').then((rows) => {
      setDays(
        Array.from({ length: 7 }, (_, i) => {
          const found = rows.find((r) => r.weekday === i);
          if (!found) return emptyDay(i);
          return {
            weekday: i,
            isWorking: found.is_working,
            startTime: found.start_time?.slice(0, 5) || '08:00',
            endTime:   found.end_time?.slice(0, 5)   || '18:00',
            breakStart: found.break_start?.slice(0, 5) || '',
            breakEnd:   found.break_end?.slice(0, 5)   || '',
          };
        })
      );
    }).catch(() => setDays(Array.from({ length: 7 }, (_, i) => emptyDay(i))));
  }, []);

  function updateDay(weekday: number, patch: Partial<DayForm>) {
    setDays((prev) => prev!.map((d) => (d.weekday === weekday ? { ...d, ...patch } : d)));
    setSaved(false);
    setDirty(true);
    setError(null);
  }

  // Validações simples de formulário — só para pegar configurações
  // claramente inválidas (ex.: fim antes do início). A validação "de
  // verdade" de disponibilidade continua inteiramente no backend.
  function validate(): string | null {
    for (const day of days ?? []) {
      if (!day.isWorking) continue;
      const label = weekdayLabels[day.weekday];

      if (day.startTime >= day.endTime)
        return `${label}: o horário de início precisa ser antes do horário de fim.`;

      const hasBreakStart = !!day.breakStart;
      const hasBreakEnd   = !!day.breakEnd;
      if (hasBreakStart !== hasBreakEnd)
        return `${label}: preencha início e fim do intervalo, ou deixe os dois em branco.`;

      if (hasBreakStart && hasBreakEnd) {
        if (day.breakStart >= day.breakEnd)
          return `${label}: o início do intervalo precisa ser antes do fim.`;
        if (day.breakStart < day.startTime || day.breakEnd > day.endTime)
          return `${label}: o intervalo precisa estar dentro do horário de atendimento.`;
      }
    }
    return null;
  }

  async function handleSave() {
    setError(null);
    setSaved(false);

    const validationError = validate();
    if (validationError) { setError(validationError); return; }

    setSaving(true);
    try {
      await api.put('/availability', (days ?? []).map((d) => ({
        weekday:    d.weekday,
        isWorking:  d.isWorking,
        startTime:  d.isWorking ? d.startTime : null,
        endTime:    d.isWorking ? d.endTime   : null,
        breakStart: d.isWorking && d.breakStart ? d.breakStart : null,
        breakEnd:   d.isWorking && d.breakEnd   ? d.breakEnd   : null,
      })));
      setSaved(true);
      setDirty(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar disponibilidade.');
    } finally {
      setSaving(false);
    }
  }

  const workingCount = (days ?? []).filter((d) => d.isWorking).length;

  return (
    <div className="space-y-6">
      {/* cabeçalho */}
      <div>
        <h1 className="font-display text-3xl text-wine-700">Disponibilidade</h1>
        <p className="text-sm text-ink/50 mt-1 max-w-xl">
          Defina os dias e horários em que você atende. Esses horários são usados para calcular
          automaticamente os horários disponíveis na agenda e na página pública de agendamento.
        </p>
      </div>

      {/* resumo rápido */}
      {days !== null && (
        <div className="flex flex-wrap gap-2">
          {days.filter((d) => d.isWorking).map((d) => (
            <span key={d.weekday} className="text-xs px-3 py-1.5 rounded-full bg-wine-50 text-wine-700 font-medium">
              {weekdayShort[d.weekday]} · {d.startTime}–{d.endTime}
            </span>
          ))}
          {workingCount === 0 && (
            <span className="text-xs text-ink/40 italic">Nenhum dia ativo.</span>
          )}
        </div>
      )}

      {/* grade de dias */}
      {days === null ? (
        <LoadingSkeleton />
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {days.map((day) => (
            <DayCard key={day.weekday} day={day} onUpdate={(patch) => updateDay(day.weekday, patch)} />
          ))}
        </div>
      )}

      {/* feedback */}
      {error && (
        <div className="rounded-xl bg-rose-50 border border-rose-200 p-4 text-sm text-rose-700">
          {error}
        </div>
      )}
      {saved && (
        <div className="rounded-xl bg-green-50 border border-green-200 p-4 text-sm text-green-700 font-medium flex items-center gap-2">
          <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
          Disponibilidade salva com sucesso!
        </div>
      )}

      {/* botão salvar */}
      <div className="flex items-center gap-4">
        <button
          onClick={handleSave}
          disabled={saving || !days}
          className="px-6 py-2.5 rounded-lg bg-wine-600 text-white text-sm font-medium hover:bg-wine-700 disabled:opacity-60 transition-colors shadow-sm"
        >
          {saving ? 'Salvando…' : 'Salvar disponibilidade'}
        </button>
        {dirty && !saving && (
          <span className="text-xs text-ink/40">Você tem alterações não salvas.</span>
        )}
      </div>
    </div>
  );
}
