import { useState } from 'react';
import { api } from '../services/api';

interface Props {
  date: Date;
  time: string;
  onClose: () => void;
  onSaved: () => void;
}

export default function BlockTimeModal({ date, time, onClose, onSaved }: Props) {
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

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

  return (
    <div className="fixed inset-0 bg-ink/40 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-2xl w-full max-w-sm p-6">
        <h3 className="font-display text-xl text-wine-700 mb-5">Bloquear horário</h3>
        <p className="text-sm text-ink/60 mb-4">
          {date.toLocaleDateString('pt-BR')} às {time}
        </p>

        <label className="block mb-4">
          <span className="block text-sm text-ink/70 mb-1">Duração (minutos)</span>
          <input
            className="input"
            type="number"
            min={15}
            step={15}
            value={durationMinutes}
            onChange={(e) => setDurationMinutes(Number(e.target.value))}
          />
        </label>

        <label className="block mb-4">
          <span className="block text-sm text-ink/70 mb-1">Motivo (opcional)</span>
          <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex.: almoço, compromisso pessoal" />
        </label>

        {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-wine-100">
            Cancelar
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="px-4 py-2 text-sm rounded-lg bg-wine-600 text-white hover:bg-wine-700 disabled:opacity-60"
          >
            {saving ? 'Bloqueando...' : 'Bloquear'}
          </button>
        </div>
      </div>
    </div>
  );
}
