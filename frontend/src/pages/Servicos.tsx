import { useEffect, useState } from 'react';
import { api } from '../services/api';
import type { Service } from '../types';

function formatMoney(cents: number) {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export default function Servicos() {
  const [services, setServices] = useState<Service[]>([]);
  const [editing, setEditing] = useState<Service | 'new' | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [duration, setDuration] = useState('40');
  const [active, setActive] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  function reload() {
    api.get<Service[]>('/services')
      .then((data) => { setServices(data); setLoadError(null); })
      .catch(() => setLoadError('Não foi possível carregar os serviços.'));
  }
  useEffect(reload, []);

  function openNew() {
    setEditing('new');
    setName('');
    setDescription('');
    setPrice('');
    setDuration('40');
    setActive(true);
  }

  function openEdit(s: Service) {
    setEditing(s);
    setName(s.name);
    setDescription(s.description || '');
    setPrice((s.priceCents / 100).toString());
    setDuration(String(s.durationMinutes));
    setActive(s.active);
  }

  async function handleSave() {
    setError(null);
    try {
      const payload = {
        name,
        description: description || null,
        priceCents: Math.round(parseFloat(price.replace(',', '.')) * 100),
        durationMinutes: parseInt(duration, 10),
        active,
      };
      if (editing === 'new') {
        await api.post('/services', payload);
      } else if (editing) {
        await api.put(`/services/${editing.id}`, payload);
      }
      setEditing(null);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar serviço.');
    }
  }

  return (
    <div>
      {loadError && (
        <p className="mb-4 rounded-lg bg-red-50 border border-red-100 px-4 py-3 text-sm text-red-700">
          {loadError}
        </p>
      )}
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-display text-3xl text-wine-700">Serviços</h1>
        <button onClick={openNew} className="px-4 py-2 rounded-lg bg-wine-600 text-white text-sm hover:bg-wine-700">
          + Novo serviço
        </button>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {services.map((s) => (
          <button
            key={s.id}
            onClick={() => openEdit(s)}
            className={`text-left bg-white border rounded-xl p-5 hover:shadow-md transition-shadow ${
              s.active ? 'border-wine-100' : 'border-ink/10 opacity-60'
            }`}
          >
            <p className="font-display text-lg text-wine-700 mb-1">{s.name}</p>
            {s.description && <p className="text-sm text-ink/60 mb-3">{s.description}</p>}
            <div className="flex justify-between text-sm">
              <span>{formatMoney(s.priceCents)}</span>
              <span className="text-ink/60">{s.durationMinutes} min</span>
            </div>
            {!s.active && <span className="text-xs text-ink/40 mt-2 block">Inativo</span>}
          </button>
        ))}
      </div>

      {editing && (
        <div className="fixed inset-0 bg-ink/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl w-full max-w-sm p-6">
            <h3 className="font-display text-xl text-wine-700 mb-4">
              {editing === 'new' ? 'Novo serviço' : 'Editar serviço'}
            </h3>
            <label className="block mb-3">
              <span className="block text-sm text-ink/70 mb-1">Nome</span>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label className="block mb-3">
              <span className="block text-sm text-ink/70 mb-1">Descrição</span>
              <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} />
            </label>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <label className="block">
                <span className="block text-sm text-ink/70 mb-1">Preço (R$)</span>
                <input className="input" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="35,00" />
              </label>
              <label className="block">
                <span className="block text-sm text-ink/70 mb-1">Duração (min)</span>
                <input className="input" type="number" value={duration} onChange={(e) => setDuration(e.target.value)} />
              </label>
            </div>
            <label className="flex items-center gap-2 mb-4 text-sm">
              <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
              Serviço ativo
            </label>
            {error && <p className="text-sm text-red-600 mb-3">{error}</p>}
            <div className="flex justify-end gap-2">
              <button onClick={() => setEditing(null)} className="px-4 py-2 text-sm rounded-lg border border-wine-100">
                Cancelar
              </button>
              <button onClick={handleSave} className="px-4 py-2 text-sm rounded-lg bg-wine-600 text-white hover:bg-wine-700">
                Salvar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
