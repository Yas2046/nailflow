import { useEffect, useState } from 'react';
import { useToast } from '../context/ToastContext';
import { usePageTitle } from '../hooks/usePageTitle';
import { api } from '../services/api';
import type { WeeklyAvailabilityDay } from '../types';

const weekdayLabels = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const weekdayShort  = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const WEEK_OF_MONTH_LABELS: Record<number, string> = { 1: '1ª', 2: '2ª', 3: '3ª', 4: '4ª', 5: '5ª', '-1': 'Última' };

interface RecurringException {
  id: string;
  exception_type: 'specific_date' | 'weekday_of_month' | 'date_range';
  specific_date: string | null;
  weekday: number | null;
  week_of_month: number | null;
  date_from: string | null;
  date_to: string | null;
  label: string | null;
}

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
  const { toast } = useToast();
  usePageTitle('Disponibilidade');

  const [days, setDays]             = useState<DayForm[] | null>(null);
  const [horizonDays, setHorizonDays] = useState<number>(60);
  const [error, setError]           = useState<string | null>(null);
  const [saved, setSaved]           = useState(false);
  const [saving, setSaving]         = useState(false);
  const [dirty, setDirty]           = useState(false);
  const [hasSavedDays, setHasSavedDays] = useState<boolean | null>(null);

  // Exceções recorrentes
  const [exceptions, setExceptions]           = useState<RecurringException[]>([]);
  const [exType, setExType]                   = useState<'specific_date' | 'weekday_of_month' | 'date_range'>('weekday_of_month');
  const [exDate, setExDate]                   = useState('');
  const [exDateTo, setExDateTo]               = useState('');
  const [exWeekday, setExWeekday]             = useState(6); // sábado default
  const [exWeekOfMonth, setExWeekOfMonth]     = useState(3); // 3ª ocorrência default
  const [exLabel, setExLabel]                 = useState('');
  const [exAdding, setExAdding]               = useState(false);
  const [exError, setExError]                 = useState<string | null>(null);

  function reloadExceptions() {
    api.get<RecurringException[]>('/availability/exceptions')
      .then(setExceptions)
      .catch(() => {});
  }

  useEffect(() => {
    api.get<{ bookingHorizonDays: number }>('/availability/horizon')
      .then((d) => setHorizonDays(d.bookingHorizonDays))
      .catch(() => {});
    reloadExceptions();
  }, []);

  useEffect(() => {
    api.get<WeeklyAvailabilityDay[]>('/availability').then((rows) => {
      setHasSavedDays(rows.some((r) => r.is_working));
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

    const clampedHorizon = Math.max(7, Math.min(365, horizonDays));

    setSaving(true);
    try {
      await Promise.all([
        api.put('/availability', (days ?? []).map((d) => ({
          weekday:    d.weekday,
          isWorking:  d.isWorking,
          startTime:  d.isWorking ? d.startTime : null,
          endTime:    d.isWorking ? d.endTime   : null,
          breakStart: d.isWorking && d.breakStart ? d.breakStart : null,
          breakEnd:   d.isWorking && d.breakEnd   ? d.breakEnd   : null,
        }))),
        api.put('/availability/horizon', { bookingHorizonDays: clampedHorizon }),
      ]);
      setHorizonDays(clampedHorizon);
      setSaved(true);
      setDirty(false);
      setHasSavedDays((days ?? []).some((d) => d.isWorking));
      toast('Disponibilidade salva com sucesso');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar disponibilidade.');
    } finally {
      setSaving(false);
    }
  }

  async function handleAddException() {
    setExError(null);
    if (exType === 'specific_date' && !exDate) { setExError('Informe a data.'); return; }
    if (exType === 'date_range' && (!exDate || !exDateTo)) { setExError('Informe a data inicial e a data final.'); return; }
    if (exType === 'date_range' && exDateTo < exDate) { setExError('A data final deve ser igual ou posterior à inicial.'); return; }
    setExAdding(true);
    try {
      let body: Record<string, unknown>;
      if (exType === 'specific_date') {
        body = { exceptionType: 'specific_date', specificDate: exDate, label: exLabel || null };
      } else if (exType === 'date_range') {
        body = { exceptionType: 'date_range', dateFrom: exDate, dateTo: exDateTo, label: exLabel || null };
      } else {
        body = { exceptionType: 'weekday_of_month', weekday: exWeekday, weekOfMonth: exWeekOfMonth, label: exLabel || null };
      }
      await api.post('/availability/exceptions', body);
      setExDate('');
      setExDateTo('');
      setExLabel('');
      reloadExceptions();
      toast('Fechamento adicionado');
    } catch (err) {
      setExError(err instanceof Error ? err.message : 'Erro ao adicionar.');
    } finally {
      setExAdding(false);
    }
  }

  async function handleDeleteException(id: string) {
    try {
      await api.delete(`/availability/exceptions/${id}`);
      reloadExceptions();
      toast('Fechamento removido');
    } catch {
      toast('Erro ao remover fechamento');
    }
  }

  function exceptionLabel(ex: RecurringException): string {
    if (ex.exception_type === 'specific_date') {
      const dateStr = ex.specific_date
        ? new Date(`${ex.specific_date}T12:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })
        : '—';
      return ex.label || dateStr;
    }
    if (ex.exception_type === 'date_range') {
      const from = ex.date_from ? new Date(`${ex.date_from}T12:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }) : '?';
      const to   = ex.date_to   ? new Date(`${ex.date_to}T12:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }) : '?';
      return ex.label || `${from} – ${to}`;
    }
    const wom = WEEK_OF_MONTH_LABELS[ex.week_of_month ?? 1] ?? '?';
    const wd  = weekdayLabels[ex.weekday ?? 0];
    return ex.label || `${wom} ${wd} do mês`;
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

      {hasSavedDays === false && (
        <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800 flex items-start gap-2">
          <svg className="w-4 h-4 mt-0.5 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            <path strokeLinecap="round" d="M12 8v4m0 4h.01" />
          </svg>
          Estes horários são apenas uma sugestão. Clique em Salvar para abrir sua agenda.
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

      {/* antecedência máxima */}
      <div className="bg-white border border-wine-100 rounded-xl p-5 shadow-sm space-y-2">
        <div>
          <p className="text-sm font-semibold text-ink/80">Antecedência máxima para agendamento</p>
          <p className="text-xs text-ink/40 mt-0.5">
            Clientes e o WhatsApp só poderão agendar dentro desse período.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="number"
            min={7}
            max={365}
            value={horizonDays}
            onChange={(e) => {
              setHorizonDays(Number(e.target.value));
              setDirty(true);
              setSaved(false);
            }}
            className="input w-24 text-sm"
          />
          <span className="text-sm text-ink/50">dias</span>
        </div>
      </div>

      {/* fechamentos recorrentes */}
      <div className="bg-white border border-wine-100 rounded-xl p-5 shadow-sm space-y-4">
        <div>
          <p className="text-sm font-semibold text-ink/80">Fechamentos recorrentes</p>
          <p className="text-xs text-ink/40 mt-0.5">
            Dias em que a agenda fecha automaticamente, todo mês. Ex.: 3º sábado.
          </p>
        </div>

        {/* lista existente */}
        {exceptions.length > 0 && (
          <ul className="space-y-2">
            {exceptions.map((ex) => (
              <li key={ex.id} className="flex items-center justify-between gap-3 rounded-lg bg-wine-50 px-3 py-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="w-1.5 h-1.5 rounded-full bg-wine-400 shrink-0" />
                  <span className="text-sm text-ink/75 truncate">{exceptionLabel(ex)}</span>
                  {ex.exception_type === 'specific_date' && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-ink/5 text-ink/40 shrink-0">Data</span>
                  )}
                  {ex.exception_type === 'date_range' && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-600 shrink-0">Período</span>
                  )}
                </div>
                <button
                  onClick={() => handleDeleteException(ex.id)}
                  className="shrink-0 text-ink/30 hover:text-rose-500 transition-colors p-1"
                  title="Remover"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/>
                  </svg>
                </button>
              </li>
            ))}
          </ul>
        )}

        {/* formulário de adição */}
        <div className="space-y-3 pt-1 border-t border-wine-50">
          {/* tipo */}
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setExType('weekday_of_month')}
              className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors ${exType === 'weekday_of_month' ? 'bg-wine-600 text-white' : 'border border-wine-100 text-ink/50 hover:bg-wine-50'}`}
            >
              Dia da semana
            </button>
            <button
              onClick={() => setExType('specific_date')}
              className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors ${exType === 'specific_date' ? 'bg-wine-600 text-white' : 'border border-wine-100 text-ink/50 hover:bg-wine-50'}`}
            >
              Data específica
            </button>
            <button
              onClick={() => setExType('date_range')}
              className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors ${exType === 'date_range' ? 'bg-wine-600 text-white' : 'border border-wine-100 text-ink/50 hover:bg-wine-50'}`}
            >
              Período
            </button>
          </div>

          {exType === 'weekday_of_month' && (
            <div className="flex flex-wrap gap-3 items-end">
              <label className="block">
                <span className="block text-xs text-ink/50 mb-1">Ocorrência</span>
                <select value={exWeekOfMonth} onChange={(e) => setExWeekOfMonth(Number(e.target.value))} className="input text-sm">
                  <option value={1}>1ª</option>
                  <option value={2}>2ª</option>
                  <option value={3}>3ª</option>
                  <option value={4}>4ª</option>
                  <option value={5}>5ª</option>
                  <option value={-1}>Última</option>
                </select>
              </label>
              <label className="block">
                <span className="block text-xs text-ink/50 mb-1">Dia da semana</span>
                <select value={exWeekday} onChange={(e) => setExWeekday(Number(e.target.value))} className="input text-sm">
                  {weekdayLabels.map((l, i) => <option key={i} value={i}>{l}</option>)}
                </select>
              </label>
            </div>
          )}

          {exType === 'specific_date' && (
            <label className="block">
              <span className="block text-xs text-ink/50 mb-1">Data</span>
              <input type="date" value={exDate} onChange={(e) => setExDate(e.target.value)} className="input text-sm" />
            </label>
          )}

          {exType === 'date_range' && (
            <div className="flex flex-wrap gap-3 items-end">
              <label className="block">
                <span className="block text-xs text-ink/50 mb-1">Data inicial</span>
                <input type="date" value={exDate} onChange={(e) => setExDate(e.target.value)} className="input text-sm" />
              </label>
              <label className="block">
                <span className="block text-xs text-ink/50 mb-1">Data final</span>
                <input type="date" value={exDateTo} min={exDate || undefined} onChange={(e) => setExDateTo(e.target.value)} className="input text-sm" />
              </label>
            </div>
          )}

          <label className="block">
            <span className="block text-xs text-ink/50 mb-1">Etiqueta (opcional)</span>
            <input
              type="text"
              placeholder="Ex.: Reunião mensal"
              value={exLabel}
              onChange={(e) => setExLabel(e.target.value)}
              className="input text-sm w-full max-w-xs"
            />
          </label>

          {exError && <p className="text-xs text-rose-600">{exError}</p>}

          <button
            onClick={handleAddException}
            disabled={exAdding}
            className="text-xs px-4 py-2 rounded-lg bg-wine-600 text-white hover:bg-wine-700 disabled:opacity-60 transition-colors font-medium"
          >
            {exAdding ? 'Adicionando…' : '+ Adicionar fechamento'}
          </button>
        </div>
      </div>

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
