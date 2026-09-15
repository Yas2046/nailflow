import { useState } from 'react';
import { api } from '../services/api';

interface Props {
  date: Date;
  time: string;
  onClose: () => void;
  onSaved: () => void;
}

const durationOptions = [
  { value: 15,  label: '15 minutos' },
  { value: 30,  label: '30 minutos' },
  { value: 45,  label: '45 minutos' },
  { value: 60,  label: '1 hora' },
  { value: 90,  label: '1h 30min' },
  { value: 120, label: '2 horas' },
  { value: 180, label: '3 horas' },
  { value: 240, label: '4 horas' },
];

export default function BlockTimeModal({ date, time, onClose, onSaved }: Props) {
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [reason, setReason]                   = useState('');
  const [error, setError]                     = useState<string | null>(null);
  const [saving, setSaving]                   = useState(false);

  async function handleSubmit() {
    setSaving(true);
    setError(null);
    try {
      const [h, m] = time.split(':').map(Number);
      const startsAt = new Date(date);
      startsAt.setHours(h, m, 0, 0);
      const endsAt = new Date(startsAt.getTime() + durationMinutes * 60000);

      await api.post('/availability/blocked', {
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        reason: reason || 'Horário bloqueado',
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao bloquear horário.');
    } finally {
      setSaving(false);
    }
  }

  const dateLabel = date.toLocaleDateString('pt-BR', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
  });

  return (
    <div
      className="fixed inset-0 bg-ink/50 flex items-center justify-center p-4 z-50"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-2xl w-full max-w-sm shadow-xl">
        {/* cabeçalho */}
        <div className="flex items-start justify-between p-6 pb-4 border-b border-wine-50">
          <div>
            <h3 className="font-display text-xl text-wine-700">Bloquear horário</h3>
            <p className="text-sm text-ink/50 mt-0.5 capitalize">{dateLabel} às {time}</p>
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

        <div className="p-6 flex flex-col gap-4">
          {/* duração */}
          <label className="block">
            <span className="block text-sm font-medium text-ink/60 mb-1">Duração</span>
            <select
              className="input"
              value={durationMinutes}
              onChange={(e) => setDurationMinutes(Number(e.target.value))}
            >
              {durationOptions.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </label>

          {/* motivo */}
          <label className="block">
            <span className="block text-sm font-medium text-ink/60 mb-1">Motivo (opcional)</span>
            <input
              className="input"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ex.: compromisso pessoal"
            />
          </label>

          {/* erro */}
          {error && (
            <div className="rounded-xl bg-rose-50 border border-rose-200 p-3 text-sm text-rose-700">
              {error}
            </div>
          )}

          {/* ações */}
          <div className="flex justify-end gap-2 pt-1">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm rounded-lg border border-wine-100 text-ink/70 hover:bg-wine-50 transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={handleSubmit}
              disabled={saving}
              className="px-5 py-2 text-sm rounded-lg bg-wine-600 text-white hover:bg-wine-700 disabled:opacity-60 transition-colors font-medium"
            >
              {saving ? 'Bloqueando…' : 'Bloquear'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
