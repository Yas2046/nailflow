import { useEffect, useState } from 'react';
import { api } from '../services/api';
import type { Client } from '../types';

interface HistoryItem {
  id: string;
  starts_at: string;
  status: string;
  service_name: string;
}

export default function Clientes() {
  const [clients, setClients] = useState<Client[]>([]);
  const [selected, setSelected] = useState<Client | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [showNew, setShowNew] = useState(false);
  const [editing, setEditing] = useState<Client | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  function reload() {
    api.get<Client[]>('/clients')
      .then((data) => { setClients(data); setLoadError(null); })
      .catch(() => setLoadError('Não foi possível carregar os clientes.'));
  }
  useEffect(reload, []);

  function openHistory(client: Client) {
    setSelected(client);
    api.get<{ history: HistoryItem[] }>(`/clients/${client.id}`)
      .then((d) => setHistory(d.history))
      .catch(() => setLoadError('Não foi possível carregar o histórico da cliente.'));
  }

  function openNew() {
    setName('');
    setPhone('');
    setNotes('');
    setError(null);
    setShowNew(true);
  }

  function openEdit(client: Client) {
    setName(client.name);
    setPhone(client.phone);
    setNotes(client.notes ?? '');
    setError(null);
    setEditing(client);
  }

  async function handleCreate() {
    setError(null);
    try {
      await api.post('/clients', { name, phone, notes: notes || null });
      setShowNew(false);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao cadastrar cliente.');
    }
  }

  async function handleUpdate() {
    if (!editing) return;
    setError(null);
    try {
      await api.put(`/clients/${editing.id}`, {
        name,
        phone,
        notes: notes.trim() === '' ? null : notes,
      });
      setEditing(null);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar cliente.');
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
        <h1 className="font-display text-3xl text-wine-700">Clientes</h1>
        <button onClick={openNew} className="px-4 py-2 rounded-lg bg-wine-600 text-white text-sm hover:bg-wine-700">
          + Nova cliente
        </button>
      </div>

      <div className="bg-white border border-wine-100 rounded-xl divide-y divide-wine-50">
        {clients.map((c) => (
          <div key={c.id} className="flex items-center justify-between px-5 py-4 hover:bg-wine-50/50">
            <button className="flex-1 text-left" onClick={() => openHistory(c)}>
              <p className="font-medium">{c.name}</p>
              <p className="text-sm text-ink/60">{c.phone}</p>
            </button>
            <div className="flex items-center gap-4">
              <div className="text-right text-sm text-ink/60">
                <p>{c.totalAtendimentos ?? 0} atendimento(s)</p>
                {c.ultimoAtendimento && <p>Último: {new Date(c.ultimoAtendimento).toLocaleDateString('pt-BR')}</p>}
              </div>
              <button
                onClick={() => openEdit(c)}
                className="text-sm px-3 py-1 rounded-md border border-wine-100 text-wine-600 hover:bg-wine-50 whitespace-nowrap"
              >
                Editar
              </button>
            </div>
          </div>
        ))}
        {clients.length === 0 && <p className="p-5 text-ink/60 text-sm">Nenhuma cliente cadastrada ainda.</p>}
      </div>

      {selected && (
        <div className="fixed inset-0 bg-ink/40 flex items-center justify-center p-4 z-50" onClick={() => setSelected(null)}>
          <div className="bg-white rounded-2xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-display text-xl text-wine-700 mb-1">{selected.name}</h3>
            <p className="text-sm text-ink/60 mb-4">{selected.phone}</p>
            {selected.notes && <p className="text-sm bg-wine-50 rounded-lg p-3 mb-4">{selected.notes}</p>}
            <h4 className="text-sm font-medium mb-2 text-ink/70">Histórico de atendimentos</h4>
            <div className="max-h-64 overflow-y-auto flex flex-col gap-2">
              {history.length === 0 && <p className="text-sm text-ink/50">Sem atendimentos registrados.</p>}
              {history.map((h) => (
                <div key={h.id} className="flex justify-between text-sm border-b border-wine-50 pb-2">
                  <span>{h.service_name}</span>
                  <span className="text-ink/60">{new Date(h.starts_at).toLocaleDateString('pt-BR')}</span>
                </div>
              ))}
            </div>
            <button onClick={() => setSelected(null)} className="mt-5 w-full py-2 rounded-lg border border-wine-100 text-sm">
              Fechar
            </button>
          </div>
        </div>
      )}

      {showNew && (
        <div className="fixed inset-0 bg-ink/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl w-full max-w-sm p-6">
            <h3 className="font-display text-xl text-wine-700 mb-4">Nova cliente</h3>
            <label className="block mb-3">
              <span className="block text-sm text-ink/70 mb-1">Nome</span>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label className="block mb-3">
              <span className="block text-sm text-ink/70 mb-1">Telefone</span>
              <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="55DDDNÚMERO" />
            </label>
            <label className="block mb-4">
              <span className="block text-sm text-ink/70 mb-1">Observações</span>
              <textarea className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </label>
            {error && <p className="text-sm text-red-600 mb-3">{error}</p>}
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowNew(false)} className="px-4 py-2 text-sm rounded-lg border border-wine-100">
                Cancelar
              </button>
              <button onClick={handleCreate} className="px-4 py-2 text-sm rounded-lg bg-wine-600 text-white hover:bg-wine-700">
                Cadastrar
              </button>
            </div>
          </div>
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 bg-ink/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl w-full max-w-sm p-6">
            <h3 className="font-display text-xl text-wine-700 mb-4">Editar cliente</h3>
            <label className="block mb-3">
              <span className="block text-sm text-ink/70 mb-1">Nome</span>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label className="block mb-3">
              <span className="block text-sm text-ink/70 mb-1">Telefone</span>
              <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="55DDDNÚMERO" />
            </label>
            <label className="block mb-4">
              <span className="block text-sm text-ink/70 mb-1">Observações</span>
              <textarea className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </label>
            {error && <p className="text-sm text-red-600 mb-3">{error}</p>}
            <div className="flex justify-end gap-2">
              <button onClick={() => setEditing(null)} className="px-4 py-2 text-sm rounded-lg border border-wine-100">
                Cancelar
              </button>
              <button onClick={handleUpdate} className="px-4 py-2 text-sm rounded-lg bg-wine-600 text-white hover:bg-wine-700">
                Salvar alterações
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
