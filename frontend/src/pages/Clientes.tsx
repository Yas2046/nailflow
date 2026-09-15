import { useEffect, useState } from 'react';
import { api } from '../services/api';
import type { Client } from '../types';

interface HistoryItem {
  id: string;
  starts_at: string;
  status: string;
  service_name: string;
}

// ─── utilitários ─────────────────────────────────────────────────────────────

const AVATAR_COLORS = [
  'bg-wine-500/20 text-wine-700',
  'bg-gold-500/20 text-gold-500',
  'bg-sage-500/20 text-sage-500',
  'bg-wine-700/15 text-wine-700',
];

function avatarColor(name: string) {
  return AVATAR_COLORS[name.charCodeAt(0) % AVATAR_COLORS.length];
}

function relativeDate(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days === 0) return 'hoje';
  if (days === 1) return 'ontem';
  if (days < 7)  return `há ${days} dias`;
  if (days < 30) return `há ${Math.floor(days / 7)} sem.`;
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
}

const historyStatusConfig: Record<string, { label: string; cls: string }> = {
  pendente:       { label: 'Pendente',       cls: 'bg-amber-50 text-amber-700 border border-amber-200' },
  confirmado:     { label: 'Confirmado',     cls: 'bg-emerald-50 text-emerald-700 border border-emerald-200' },
  concluido:      { label: 'Concluído',      cls: 'bg-green-50 text-green-700 border border-green-200' },
  cancelado:      { label: 'Cancelado',      cls: 'bg-rose-50 text-rose-600 border border-rose-200' },
  nao_compareceu: { label: 'Não compareceu', cls: 'bg-gray-100 text-gray-500 border border-gray-200' },
};

// ─── componentes auxiliares ───────────────────────────────────────────────────

function Avatar({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' | 'lg' }) {
  const sizeClass = size === 'lg' ? 'w-14 h-14 text-2xl' : size === 'sm' ? 'w-8 h-8 text-sm' : 'w-10 h-10 text-lg';
  return (
    <div className={`${sizeClass} rounded-full flex items-center justify-center font-display font-medium shrink-0 ${avatarColor(name)}`}>
      {name[0]?.toUpperCase() ?? '?'}
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="bg-white border border-wine-100 rounded-xl overflow-hidden animate-pulse">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="flex items-center gap-4 px-5 py-4 border-b border-wine-50 last:border-0">
          <div className="w-10 h-10 rounded-full bg-wine-50 shrink-0" />
          <div className="flex-1 space-y-2">
            <div className="h-3.5 w-36 bg-wine-50 rounded" />
            <div className="h-3 w-24 bg-wine-50/70 rounded" />
          </div>
          <div className="shrink-0 space-y-1.5 text-right">
            <div className="h-5 w-14 bg-wine-50 rounded-full ml-auto" />
            <div className="h-3 w-20 bg-wine-50/70 rounded" />
          </div>
        </div>
      ))}
    </div>
  );
}

function IconSearch() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <circle cx="11" cy="11" r="8" />
      <path strokeLinecap="round" d="m21 21-4.35-4.35" />
    </svg>
  );
}

function IconUsers() {
  return (
    <svg className="w-8 h-8" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path strokeLinecap="round" d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function CloseButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="p-1.5 rounded-lg hover:bg-wine-50 text-ink/40 hover:text-ink/70 transition-colors"
      aria-label="Fechar"
    >
      <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
      </svg>
    </button>
  );
}

// ─── página ───────────────────────────────────────────────────────────────────

export default function Clientes() {
  const [clients, setClients]   = useState<Client[] | null>(null);
  const [selected, setSelected] = useState<Client | null>(null);
  const [history, setHistory]   = useState<HistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [showNew, setShowNew]   = useState(false);
  const [search, setSearch]     = useState('');

  // form
  const [name, setName]   = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function reload() {
    api.get<Client[]>('/clients').then(setClients).catch(() => setClients([]));
  }
  useEffect(reload, []);

  function openHistory(client: Client) {
    setSelected(client);
    setHistory([]);
    setHistoryLoading(true);
    api
      .get<{ history: HistoryItem[] }>(`/clients/${client.id}`)
      .then((d) => setHistory(d.history))
      .catch(() => {})
      .finally(() => setHistoryLoading(false));
  }

  function openNew() {
    setName(''); setPhone(''); setNotes(''); setError(null);
    setShowNew(true);
  }

  async function handleCreate() {
    setError(null);
    if (!name.trim() || !phone.trim()) {
      setError('Nome e telefone são obrigatórios.');
      return;
    }
    setSaving(true);
    try {
      await api.post('/clients', { name: name.trim(), phone: phone.trim(), notes: notes.trim() || null });
      setShowNew(false);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao cadastrar cliente.');
    } finally {
      setSaving(false);
    }
  }

  const filtered = (clients ?? []).filter((c) => {
    const q = search.toLowerCase();
    return c.name.toLowerCase().includes(q) || c.phone.includes(q);
  });

  return (
    <div className="space-y-5">
      {/* cabeçalho */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="font-display text-3xl text-wine-700">Clientes</h1>
        <button
          onClick={openNew}
          className="px-4 py-2 rounded-lg bg-wine-600 text-white text-sm font-medium hover:bg-wine-700 transition-colors shadow-sm"
        >
          + Nova cliente
        </button>
      </div>

      {/* busca */}
      <div className="relative">
        <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink/30">
          <IconSearch />
        </span>
        <input
          className="input pl-10"
          placeholder="Buscar por nome ou telefone…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* lista */}
      {clients === null ? (
        <LoadingSkeleton />
      ) : filtered.length === 0 ? (
        <div className="bg-white border border-wine-100 rounded-xl p-10 flex flex-col items-center gap-3 text-ink/30">
          <IconUsers />
          <p className="text-sm">
            {search ? 'Nenhuma cliente encontrada para esta busca.' : 'Nenhuma cliente cadastrada ainda.'}
          </p>
        </div>
      ) : (
        <div className="bg-white border border-wine-100 rounded-xl overflow-hidden shadow-sm">
          <ul className="divide-y divide-wine-50">
            {filtered.map((c) => (
              <li key={c.id}>
                <button
                  onClick={() => openHistory(c)}
                  className="w-full text-left flex items-center gap-4 px-5 py-4 hover:bg-wine-50/50 transition-colors"
                >
                  {/* avatar */}
                  <Avatar name={c.name} />

                  {/* nome + telefone */}
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-ink truncate">{c.name}</p>
                    <p className="text-sm text-ink/50 truncate">{c.phone}</p>
                  </div>

                  {/* estatísticas */}
                  <div className="shrink-0 text-right space-y-1">
                    <div className="flex justify-end">
                      <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-wine-50 text-wine-700">
                        {c.totalAtendimentos ?? 0}{' '}
                        {(c.totalAtendimentos ?? 0) === 1 ? 'atend.' : 'atend.'}
                      </span>
                    </div>
                    {c.ultimoAtendimento ? (
                      <p className="text-xs text-ink/40">Último: {relativeDate(c.ultimoAtendimento)}</p>
                    ) : (
                      <p className="text-xs text-ink/30">Sem atendimentos</p>
                    )}
                  </div>
                </button>
              </li>
            ))}
          </ul>

          {/* rodapé da lista */}
          {clients.length > 0 && (
            <div className="px-5 py-2.5 border-t border-wine-50 bg-wine-50/30">
              <p className="text-xs text-ink/40">
                {search
                  ? `${filtered.length} de ${clients.length} clientes`
                  : `${clients.length} cliente${clients.length !== 1 ? 's' : ''} cadastrada${clients.length !== 1 ? 's' : ''}`}
              </p>
            </div>
          )}
        </div>
      )}

      {/* ── modal histórico ─────────────────────────────────────────────── */}
      {selected && (
        <div
          className="fixed inset-0 bg-ink/50 flex items-center justify-center p-4 z-50"
          onClick={() => setSelected(null)}
        >
          <div
            className="bg-white rounded-2xl w-full max-w-md shadow-xl flex flex-col max-h-[90vh]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* cabeçalho */}
            <div className="flex items-start justify-between p-6 pb-4 border-b border-wine-50">
              <div className="flex items-center gap-4 min-w-0">
                <Avatar name={selected.name} size="lg" />
                <div className="min-w-0">
                  <h3 className="font-display text-xl text-wine-700 truncate">{selected.name}</h3>
                  <p className="text-sm text-ink/50">{selected.phone}</p>
                </div>
              </div>
              <CloseButton onClick={() => setSelected(null)} />
            </div>

            {/* observações */}
            {selected.notes && (
              <div className="px-6 pt-4">
                <p className="text-xs font-medium text-ink/40 uppercase tracking-wide mb-1.5">Observações</p>
                <p className="text-sm bg-wine-50 rounded-xl p-3 text-ink/70">{selected.notes}</p>
              </div>
            )}

            {/* histórico */}
            <div className="px-6 pt-4 pb-2">
              <p className="text-xs font-medium text-ink/40 uppercase tracking-wide mb-3">
                Histórico de atendimentos
              </p>
            </div>

            <div className="overflow-y-auto flex-1 px-6 pb-6">
              {historyLoading ? (
                <div className="space-y-2 animate-pulse">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="h-10 bg-wine-50 rounded-lg" />
                  ))}
                </div>
              ) : history.length === 0 ? (
                <p className="text-sm text-ink/40 py-4 text-center">Sem atendimentos registrados.</p>
              ) : (
                <ul className="space-y-2">
                  {history.map((h) => {
                    const cfg = historyStatusConfig[h.status] ?? { label: h.status, cls: 'bg-gray-100 text-gray-500' };
                    return (
                      <li
                        key={h.id}
                        className="flex items-center justify-between gap-3 py-2.5 border-b border-wine-50 last:border-0"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-ink truncate">{h.service_name}</p>
                          <p className="text-xs text-ink/40">
                            {new Date(h.starts_at).toLocaleDateString('pt-BR', {
                              day: '2-digit',
                              month: 'short',
                              year: 'numeric',
                            })}
                          </p>
                        </div>
                        <span className={`shrink-0 text-xs px-2.5 py-1 rounded-full font-medium ${cfg.cls}`}>
                          {cfg.label}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className="px-6 pb-6">
              <button
                onClick={() => setSelected(null)}
                className="w-full py-2.5 rounded-xl border border-wine-100 text-sm text-ink/70 hover:bg-wine-50 transition-colors"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── modal nova cliente ───────────────────────────────────────────── */}
      {showNew && (
        <div
          className="fixed inset-0 bg-ink/50 flex items-center justify-center p-4 z-50"
          onClick={(e) => { if (e.target === e.currentTarget) setShowNew(false); }}
        >
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-xl">
            {/* cabeçalho */}
            <div className="flex items-center justify-between p-6 pb-4 border-b border-wine-50">
              <h3 className="font-display text-xl text-wine-700">Nova cliente</h3>
              <CloseButton onClick={() => setShowNew(false)} />
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
                <span className="block text-sm font-medium text-ink/60 mb-1">Observações <span className="font-normal text-ink/30">(opcional)</span></span>
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
                <button
                  onClick={() => setShowNew(false)}
                  className="px-4 py-2 text-sm rounded-lg border border-wine-100 text-ink/70 hover:bg-wine-50 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleCreate}
                  disabled={saving}
                  className="px-5 py-2 text-sm rounded-lg bg-wine-600 text-white font-medium hover:bg-wine-700 disabled:opacity-60 transition-colors"
                >
                  {saving ? 'Cadastrando…' : 'Cadastrar'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
