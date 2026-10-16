import { useState } from 'react';
import { api } from '../services/api';
import type { Client } from '../types';

// Cadastro de cliente reutilizado pela página Clientes e pelo agendamento (Agenda). Mesmos campos, textos e
// validações; a API (POST /clients) continua sendo a autoridade (telefone válido e sem duplicidade).
interface Props {
  onClose: () => void;
  onCreated: (client: Client) => void;
}

export default function NovaClienteModal({ onClose, onCreated }: Props) {
  const [name, setName]   = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleCreate() {
    setError(null);
    if (!name.trim() || !phone.trim()) {
      setError('Nome e telefone são obrigatórios.');
      return;
    }
    setSaving(true);
    try {
      const created = await api.post<Client>('/clients', { name: name.trim(), phone: phone.trim(), notes: notes.trim() || null });
      onCreated(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao cadastrar cliente.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 bg-ink/50 flex items-center justify-center p-4 z-[60]"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-2xl w-full max-w-sm shadow-xl">
        <div className="flex items-center justify-between p-6 pb-4 border-b border-wine-50">
          <h3 className="font-display text-xl text-wine-700">Nova cliente</h3>
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
          <label className="block">
            <span className="block text-sm font-medium text-ink/60 mb-1">Nome</span>
            <input
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nome completo"
              autoFocus
            />
          </label>

          <label className="block">
            <span className="block text-sm font-medium text-ink/60 mb-1">Telefone</span>
            <input
              className="input"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="55319XXXXXXXX"
              type="tel"
            />
            <span className="block text-xs text-ink/40 mt-1">Formato: código do país + DDD + número</span>
          </label>

          <label className="block">
            <span className="block text-sm font-medium text-ink/60 mb-1">
              Observações <span className="font-normal text-ink/30">(opcional)</span>
            </span>
            <textarea
              className="input"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Alergias, preferências, etc."
            />
          </label>

          {error && (
            <div className="rounded-xl bg-rose-50 border border-rose-200 p-3 text-sm text-rose-700">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button onClick={onClose} className="btn-secondary">
              Cancelar
            </button>
            <button onClick={handleCreate} disabled={saving} className="btn-primary disabled:opacity-60">
              {saving ? 'Cadastrando…' : 'Cadastrar'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
