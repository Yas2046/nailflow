import { useEffect, useState } from 'react';
import { api } from '../services/api';
import { getFriendlyAvailabilityMessage, getSuggestedAlternatives } from '../utils/availabilityErrors';
import type { Appointment, AppointmentStatus, Client, Service } from '../types';

interface Props {
  date: Date;
  time: string | null; // "HH:mm" pré-selecionado ao clicar num horário vazio
  appointment: Appointment | null; // presente = edição
  onClose: () => void;
  onSaved: () => void;
}

const statusOptions: { value: AppointmentStatus; label: string }[] = [
  { value: 'pendente', label: 'Pendente' },
  { value: 'confirmado', label: 'Confirmado' },
  { value: 'concluido', label: 'Concluído' },
  { value: 'nao_compareceu', label: 'Não compareceu' },
  { value: 'cancelado', label: 'Cancelado' },
];

export default function AppointmentModal({ date, time, appointment, onClose, onSaved }: Props) {
  const [clients, setClients] = useState<Client[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [clientId, setClientId] = useState(appointment?.clientId || '');
  const [serviceId, setServiceId] = useState(appointment?.serviceId || '');
  const [timeValue, setTimeValue] = useState(
    time || (appointment ? new Date(appointment.startsAt).toTimeString().slice(0, 5) : '09:00')
  );
  const [status, setStatus] = useState<AppointmentStatus>(appointment?.status || 'pendente');
  const [notes, setNotes] = useState(appointment?.notes || '');
  const [error, setError] = useState<string | null>(null);
  const [alternatives, setAlternatives] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get<Client[]>('/clients').then(setClients).catch(() => {});
    api.get<Service[]>('/services').then((s) => setServices(s.filter((x) => x.active))).catch(() => {});
  }, []);

  async function handleSubmit() {
    setError(null);
    setAlternatives([]);
    if (!clientId || !serviceId) {
      setError('Selecione cliente e serviço.');
      return;
    }
    setSaving(true);
    try {
      // O horário aceita qualquer minuto (ex.: 14:15) — a grade de 30 em 30
      // é só uma sugestão visual na Agenda. Quem calcula o fim do
      // atendimento e valida a disponibilidade é sempre o backend.
      const [h, m] = timeValue.split(':').map(Number);
      const startsAt = new Date(date);
      startsAt.setHours(h, m, 0, 0);

      if (appointment) {
        await api.put(`/appointments/${appointment.id}`, {
          clientId,
          serviceId,
          startsAt: startsAt.toISOString(),
          status,
          notes,
        });
      } else {
        await api.post('/appointments', {
          clientId,
          serviceId,
          startsAt: startsAt.toISOString(),
          status,
          notes,
        });
      }
      onSaved();
    } catch (err) {
      setError(getFriendlyAvailabilityMessage(err, 'Não foi possível salvar o agendamento.'));
      setAlternatives(getSuggestedAlternatives(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleCancel() {
    if (!appointment) return;
    if (!confirm('Cancelar este agendamento? O horário voltará a ficar disponível.')) return;
    setSaving(true);
    try {
      await api.delete(`/appointments/${appointment.id}`);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao cancelar.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-ink/40 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-2xl w-full max-w-md p-6">
        <h3 className="font-display text-xl text-wine-700 mb-5">
          {appointment ? 'Editar agendamento' : 'Novo agendamento'}
        </h3>

        <div className="flex flex-col gap-4">
          <Field label="Cliente">
            <select className="input" value={clientId} onChange={(e) => setClientId(e.target.value)}>
              <option value="">Selecione...</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} — {c.phone}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Serviço">
            <select className="input" value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
              <option value="">Selecione...</option>
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.durationMinutes} min)
                </option>
              ))}
            </select>
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Data">
              <input className="input" type="text" value={date.toLocaleDateString('pt-BR')} disabled />
            </Field>
            <Field label="Horário">
              <input className="input" type="time" step={60} value={timeValue} onChange={(e) => setTimeValue(e.target.value)} />
              <span className="block text-xs text-ink/40 mt-1">Pode digitar qualquer horário, ex.: 14:15</span>
            </Field>
          </div>

          {appointment && (
            <Field label="Status">
              <select className="input" value={status} onChange={(e) => setStatus(e.target.value as AppointmentStatus)}>
                {statusOptions.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </Field>
          )}

          <Field label="Observação">
            <textarea className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>

          {error && (
            <div className="text-sm text-red-600">
              <p>{error}</p>
              {alternatives.length > 0 && (
                <div className="mt-2">
                  <p className="text-ink/60 mb-1">Horários alternativos:</p>
                  <div className="flex flex-wrap gap-2">
                    {alternatives.map((iso) => (
                      <button
                        key={iso}
                        type="button"
                        onClick={() => setTimeValue(new Date(iso).toTimeString().slice(0, 5))}
                        className="px-2 py-1 rounded-md bg-wine-50 text-wine-700 text-xs hover:bg-wine-100"
                      >
                        {new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="flex justify-between items-center pt-2">
            <div>
              {appointment && (
                <button onClick={handleCancel} disabled={saving} className="text-sm text-red-600 hover:underline">
                  Cancelar agendamento
                </button>
              )}
            </div>
            <div className="flex gap-2">
              <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-wine-100">
                Fechar
              </button>
              <button
                onClick={handleSubmit}
                disabled={saving}
                className="px-4 py-2 text-sm rounded-lg bg-wine-600 text-white hover:bg-wine-700 disabled:opacity-60"
              >
                {saving ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-sm text-ink/70 mb-1">{label}</span>
      {children}
    </label>
  );
}
