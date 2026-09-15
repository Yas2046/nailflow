import { useEffect, useState } from 'react';
import { api } from '../services/api';
import { getFriendlyAvailabilityMessage, getSuggestedAlternatives } from '../utils/availabilityErrors';
import type { Appointment, AppointmentStatus, Client, RecurringFrequency, RecurringResult, Service } from '../types';

interface Props {
  date: Date;
  time: string | null;
  appointment: Appointment | null;
  onClose: () => void;
  onSaved: () => void;
}

const statusOptions: { value: AppointmentStatus; label: string }[] = [
  { value: 'pendente',        label: 'Pendente' },
  { value: 'confirmado',      label: 'Confirmado' },
  { value: 'concluido',       label: 'Concluído' },
  { value: 'nao_compareceu',  label: 'Não compareceu' },
  { value: 'cancelado',       label: 'Cancelado' },
];

const frequencyOptions: { value: RecurringFrequency; label: string }[] = [
  { value: 'weekly',   label: 'Semanal (toda semana)' },
  { value: 'biweekly', label: 'A cada 2 semanas' },
];

// Formata ISO para exibição amigável
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' });
}

type Step = 'form' | 'scope-edit' | 'scope-cancel' | 'confirm-cancel' | 'result';

export default function AppointmentModal({ date, time, appointment, onClose, onSaved }: Props) {
  const [clients, setClients]       = useState<Client[]>([]);
  const [services, setServices]     = useState<Service[]>([]);
  const [clientId, setClientId]     = useState(appointment?.clientId || '');
  const [serviceId, setServiceId]   = useState(appointment?.serviceId || '');
  const [timeValue, setTimeValue]   = useState(
    time || (appointment ? new Date(appointment.startsAt).toTimeString().slice(0, 5) : '09:00')
  );
  const [status, setStatus]         = useState<AppointmentStatus>(appointment?.status || 'pendente');
  const [notes, setNotes]           = useState(appointment?.notes || '');
  const [error, setError]           = useState<string | null>(null);
  const [alternatives, setAlternatives] = useState<string[]>([]);
  const [saving, setSaving]         = useState(false);

  // Recorrência (somente na criação)
  const [isRecurring, setIsRecurring] = useState(false);
  const [frequency, setFrequency]     = useState<RecurringFrequency>('weekly');
  const [endsOn, setEndsOn]           = useState(() => {
    const d = new Date(date);
    d.setMonth(d.getMonth() + 3);
    return d.toISOString().slice(0, 10);
  });

  // Fluxo de passos
  const [step, setStep]             = useState<Step>('form');
  const [recurringResult, setRecurringResult] = useState<RecurringResult | null>(null);

  const isEditing = !!appointment;
  const isRecurringAppt = isEditing && !!appointment?.recurringGroupId;

  useEffect(() => {
    api.get<Client[]>('/clients').then(setClients).catch(() => {});
    api.get<Service[]>('/services').then((s) => setServices(s.filter((x) => x.active))).catch(() => {});
  }, []);

  const selectedService = services.find((s) => s.id === serviceId);

  function clearError() { setError(null); setAlternatives([]); }

  // ── Salvar / criar ─────────────────────────────────────────────────────────

  async function handleSubmit() {
    clearError();
    if (!clientId || !serviceId) { setError('Selecione cliente e serviço.'); return; }

    // Agendamento recorrente existente: pede escopo antes de salvar
    if (isRecurringAppt) { setStep('scope-edit'); return; }

    await doSave('single');
  }

  async function doSave(scope: 'single' | 'following') {
    setSaving(true);
    try {
      const [h, m] = timeValue.split(':').map(Number);
      const startsAt = new Date(date);
      startsAt.setHours(h, m, 0, 0);

      if (isEditing && scope === 'following') {
        // Atualiza este e os próximos (status + notes)
        await api.put(`/appointments/${appointment!.id}/and-following`, { status, notes: notes || null });
        onSaved();
        return;
      }

      if (isEditing) {
        await api.put(`/appointments/${appointment!.id}`, {
          clientId, serviceId, startsAt: startsAt.toISOString(), status, notes: notes || null,
        });
        onSaved();
        return;
      }

      if (isRecurring) {
        const result = await api.post<RecurringResult>('/appointments/recurring', {
          clientId, serviceId, startsAt: startsAt.toISOString(),
          frequency, endsOn, notes: notes || null,
        });
        setRecurringResult(result);
        setStep('result');
        return;
      }

      await api.post('/appointments', {
        clientId, serviceId, startsAt: startsAt.toISOString(), status, notes: notes || null,
      });
      onSaved();
    } catch (err) {
      setError(getFriendlyAvailabilityMessage(err, 'Não foi possível salvar o agendamento.'));
      setAlternatives(getSuggestedAlternatives(err));
      setStep('form');
    } finally {
      setSaving(false);
    }
  }

  // ── Cancelar ───────────────────────────────────────────────────────────────

  async function handleCancelClick() {
    if (!appointment) return;
    if (isRecurringAppt) { setStep('scope-cancel'); return; }
    setStep('confirm-cancel');
  }

  async function doCancel(scope: 'single' | 'following') {
    setSaving(true);
    try {
      if (scope === 'following') {
        await api.delete(`/appointments/${appointment!.id}/and-following`);
      } else {
        await api.delete(`/appointments/${appointment!.id}`);
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao cancelar.');
      setStep('form');
    } finally {
      setSaving(false);
    }
  }

  // ── Labels ─────────────────────────────────────────────────────────────────

  const dateLabel = date.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div
      className="fixed inset-0 bg-ink/50 flex items-center justify-center p-4 z-50"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-2xl w-full max-w-md shadow-xl flex flex-col max-h-[90vh]">

        {/* cabeçalho — fixo no topo */}
        <div className="flex items-start justify-between p-6 pb-4 border-b border-wine-50 shrink-0">
          <div>
            <h3 className="font-display text-xl text-wine-700">
              {step === 'result' ? 'Série criada'
                : step === 'scope-edit' ? 'Editar recorrente'
                : step === 'scope-cancel' ? 'Cancelar recorrente'
                : step === 'confirm-cancel' ? 'Cancelar agendamento'
                : isEditing ? 'Editar agendamento' : 'Novo agendamento'}
            </h3>
            <p className="text-sm text-ink/50 mt-0.5 capitalize">{dateLabel}</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-wine-50 text-ink/40 hover:text-ink/70 transition-colors"
            aria-label="Fechar"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* ── step: resultado da série criada ──────────────────────────────── */}
        {step === 'result' && recurringResult && (
          <div className="p-6 space-y-4 overflow-y-auto">
            <div className="rounded-xl bg-green-50 border border-green-200 p-4">
              <p className="text-sm font-semibold text-green-800 mb-1">
                {recurringResult.created.length} agendamento{recurringResult.created.length !== 1 ? 's' : ''} criado{recurringResult.created.length !== 1 ? 's' : ''}
              </p>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {recurringResult.created.map((c) => (
                  <span key={c.startsAt} className="text-xs px-2 py-0.5 bg-green-100 text-green-700 rounded-md">
                    {fmtDate(c.startsAt)}
                  </span>
                ))}
              </div>
            </div>

            {recurringResult.skipped.length > 0 && (
              <div className="rounded-xl bg-amber-50 border border-amber-200 p-4">
                <p className="text-sm font-semibold text-amber-800 mb-1">
                  {recurringResult.skipped.length} data{recurringResult.skipped.length !== 1 ? 's' : ''} pulada{recurringResult.skipped.length !== 1 ? 's' : ''} (conflito)
                </p>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {recurringResult.skipped.map((s) => (
                    <span key={s.startsAt} className="text-xs px-2 py-0.5 bg-amber-100 text-amber-700 rounded-md">
                      {fmtDate(s.startsAt)}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div className="flex justify-end pt-1">
              <button
                onClick={onSaved}
                className="px-5 py-2 text-sm rounded-lg bg-wine-600 text-white hover:bg-wine-700 transition-colors font-medium"
              >
                Fechar
              </button>
            </div>
          </div>
        )}

        {/* ── step: escopo de edição ────────────────────────────────────────── */}
        {step === 'scope-edit' && (
          <div className="p-6 space-y-4 overflow-y-auto">
            <p className="text-sm text-ink/70">Este agendamento faz parte de uma série recorrente. O que deseja alterar?</p>
            <p className="text-xs text-ink/40">Nota: "Este e os próximos" atualiza somente status e observação.</p>
            <div className="flex flex-col gap-2 pt-1">
              <button
                onClick={() => doSave('single')}
                disabled={saving}
                className="w-full px-4 py-3 text-sm rounded-xl border border-wine-200 text-wine-700 hover:bg-wine-50 transition-colors text-left font-medium disabled:opacity-60"
              >
                Somente este agendamento
              </button>
              <button
                onClick={() => doSave('following')}
                disabled={saving}
                className="w-full px-4 py-3 text-sm rounded-xl bg-wine-600 text-white hover:bg-wine-700 transition-colors text-left font-medium disabled:opacity-60"
              >
                Este e os próximos
              </button>
            </div>
            <div className="flex justify-end pt-1">
              <button onClick={() => setStep('form')} className="text-sm text-ink/50 hover:text-ink/70">
                Voltar
              </button>
            </div>
          </div>
        )}

        {/* ── step: confirmar cancelamento simples ─────────────────────────── */}
        {step === 'confirm-cancel' && (
          <div className="p-6 space-y-4 overflow-y-auto">
            <p className="text-sm text-ink/70">O horário voltará a ficar disponível. Confirma o cancelamento?</p>
            <div className="flex flex-col gap-2 pt-1">
              <button
                onClick={() => doCancel('single')}
                disabled={saving}
                className="w-full px-4 py-3 text-sm rounded-xl border border-rose-200 text-rose-700 hover:bg-rose-50 transition-colors text-left font-medium disabled:opacity-60"
              >
                {saving ? 'Cancelando…' : 'Sim, cancelar agendamento'}
              </button>
            </div>
            <div className="flex justify-end pt-1">
              <button onClick={() => setStep('form')} className="text-sm text-ink/50 hover:text-ink/70">
                Voltar
              </button>
            </div>
          </div>
        )}

        {/* ── step: escopo de cancelamento ─────────────────────────────────── */}
        {step === 'scope-cancel' && (
          <div className="p-6 space-y-4 overflow-y-auto">
            <p className="text-sm text-ink/70">Este agendamento faz parte de uma série recorrente. O que deseja cancelar?</p>
            <div className="flex flex-col gap-2 pt-1">
              <button
                onClick={() => doCancel('single')}
                disabled={saving}
                className="w-full px-4 py-3 text-sm rounded-xl border border-wine-200 text-wine-700 hover:bg-wine-50 transition-colors text-left font-medium disabled:opacity-60"
              >
                Somente este agendamento
              </button>
              <button
                onClick={() => doCancel('following')}
                disabled={saving}
                className="w-full px-4 py-3 text-sm rounded-xl border border-rose-200 text-rose-700 hover:bg-rose-50 transition-colors text-left font-medium disabled:opacity-60"
              >
                Este e os próximos
              </button>
            </div>
            <div className="flex justify-end pt-1">
              <button onClick={() => setStep('form')} className="text-sm text-ink/50 hover:text-ink/70">
                Voltar
              </button>
            </div>
          </div>
        )}

        {/* ── step: formulário principal ────────────────────────────────────── */}
        {step === 'form' && (
          <div className="p-6 flex flex-col gap-4 overflow-y-auto">

            {/* badge série recorrente */}
            {isRecurringAppt && (
              <div className="flex items-center gap-2 text-xs text-wine-600 bg-wine-50 border border-wine-100 rounded-lg px-3 py-2">
                <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                <span>Agendamento recorrente</span>
              </div>
            )}

            {/* cliente */}
            <Field label="Cliente">
              <select className="input" value={clientId} onChange={(e) => setClientId(e.target.value)}>
                <option value="">Selecione...</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>{c.name} — {c.phone}</option>
                ))}
              </select>
            </Field>

            {/* serviço */}
            <Field label="Serviço">
              <select className="input" value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
                <option value="">Selecione...</option>
                {services.map((s) => (
                  <option key={s.id} value={s.id}>{s.name} ({s.durationMinutes} min)</option>
                ))}
              </select>
              {selectedService && (
                <span className="block text-xs text-ink/40 mt-1">
                  Duração: {selectedService.durationMinutes} min
                  {selectedService.priceCents
                    ? ` · ${(selectedService.priceCents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`
                    : ''}
                </span>
              )}
            </Field>

            {/* horário */}
            <Field label="Horário">
              <input
                className="input"
                type="time"
                step={60}
                value={timeValue}
                onChange={(e) => setTimeValue(e.target.value)}
              />
              <span className="block text-xs text-ink/40 mt-1">Pode digitar qualquer horário, ex.: 14:15</span>
            </Field>

            {/* status (somente ao editar) */}
            {isEditing && (
              <Field label="Status">
                <select className="input" value={status} onChange={(e) => setStatus(e.target.value as AppointmentStatus)}>
                  {statusOptions.map((s) => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
              </Field>
            )}

            {/* observação */}
            <Field label="Observação">
              <textarea className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Field>

            {/* ── recorrência (somente criação) ─────────────────────────────── */}
            {!isEditing && (
              <div className="rounded-xl border border-wine-100 bg-wine-50/40 p-4 space-y-3">
                <label className="flex items-center gap-3 cursor-pointer select-none">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={isRecurring}
                    onClick={() => setIsRecurring((v) => !v)}
                    className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-wine-600 ${
                      isRecurring ? 'bg-wine-600' : 'bg-ink/20'
                    }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-sm ring-0 transition-transform ${
                        isRecurring ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                  <span className="text-sm font-medium text-ink/70">Repetir agendamento</span>
                </label>

                {isRecurring && (
                  <div className="space-y-3 pt-1">
                    <Field label="Frequência">
                      <select className="input" value={frequency} onChange={(e) => setFrequency(e.target.value as RecurringFrequency)}>
                        {frequencyOptions.map((f) => (
                          <option key={f.value} value={f.value}>{f.label}</option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Repetir até">
                      <input
                        className="input"
                        type="date"
                        value={endsOn}
                        min={date.toISOString().slice(0, 10)}
                        onChange={(e) => setEndsOn(e.target.value)}
                      />
                    </Field>
                  </div>
                )}
              </div>
            )}

            {/* erro */}
            {error && (
              <div className="rounded-xl bg-rose-50 border border-rose-200 p-4 text-sm text-rose-700">
                <p className="font-medium">{error}</p>
                {alternatives.length > 0 && (
                  <div className="mt-3">
                    <p className="text-rose-600/70 text-xs mb-2">Horários alternativos disponíveis:</p>
                    <div className="flex flex-wrap gap-2">
                      {alternatives.map((iso) => (
                        <button
                          key={iso}
                          type="button"
                          onClick={() => { setTimeValue(new Date(iso).toTimeString().slice(0, 5)); clearError(); }}
                          className="px-3 py-1.5 rounded-lg bg-white border border-rose-200 text-rose-700 text-xs hover:bg-rose-50 transition-colors"
                        >
                          {new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* rodapé */}
            <div className="flex items-center justify-between pt-1">
              <div>
                {isEditing && (
                  <button
                    onClick={handleCancelClick}
                    disabled={saving}
                    className="text-sm text-rose-600 hover:text-rose-700 hover:underline disabled:opacity-40 transition-colors"
                  >
                    Cancelar agendamento
                  </button>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={onClose}
                  className="px-4 py-2 text-sm rounded-lg border border-wine-100 text-ink/70 hover:bg-wine-50 transition-colors"
                >
                  Fechar
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={saving}
                  className="px-5 py-2 text-sm rounded-lg bg-wine-600 text-white hover:bg-wine-700 disabled:opacity-60 transition-colors font-medium"
                >
                  {saving ? 'Salvando…' : 'Salvar'}
                </button>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-sm font-medium text-ink/60 mb-1">{label}</span>
      {children}
    </label>
  );
}
