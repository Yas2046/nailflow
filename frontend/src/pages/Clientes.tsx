import { useEffect, useState } from 'react';
import { api } from '../services/api';
import type { Client } from '../types';

interface HistoryItem {
  id: string;
  starts_at: string;
  ends_at: string;
  status: string;
  service_name: string;
  price_cents_snapshot: number;
  appointment_notes: string | null;
}

interface ClientMetrics {
  totalConcluidos: number;
  totalCancelados: number;
  totalFaltas: number;
  valorTotalCents: number;
  ticketMedioCents: number;
  primeiroAtendimento: string | null;
  ultimoAtendimento: string | null;
  proximoAtendimento: string | null;
  freqMediaDias: number | null;
  inativaDias: number | null;
  servicoFavorito: string | null;
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

function isInativa(ultimoAtendimento: string | null | undefined): boolean {
  if (!ultimoAtendimento) return false;
  return (Date.now() - new Date(ultimoAtendimento).getTime()) / 86_400_000 >= 60;
}

function formatCents(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return (
    d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }) +
    ' ' +
    d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
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
  const [metrics, setMetrics] = useState<ClientMetrics | null>(null);
  const [showNew, setShowNew]   = useState(false);
  const [search, setSearch]     = useState('');

  // tags (ficha da cliente)
  const [localTags, setLocalTags]   = useState<string[]>([]);
  const [tagInput, setTagInput]     = useState('');
  const [tagsDirty, setTagsDirty]   = useState(false);
  const [tagsSaving, setTagsSaving] = useState(false);
  const [tagsError, setTagsError]   = useState<string | null>(null);

  // modo edição (ficha)
  const [editing, setEditing]           = useState(false);
  const [editName, setEditName]         = useState('');
  const [editPhone, setEditPhone]       = useState('');
  const [editNotes, setEditNotes]       = useState('');
  const [editTags, setEditTags]         = useState<string[]>([]);
  const [editTagInput, setEditTagInput] = useState('');
  const [editSaving, setEditSaving]     = useState(false);
  const [editError, setEditError]       = useState<string | null>(null);

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

  function closeModal() {
    setSelected(null);
    setLocalTags([]);
    setTagInput('');
    setTagsDirty(false);
    setTagsError(null);
    setEditing(false);
    setEditError(null);
  }

  function openHistory(client: Client) {
    setSelected(client);
    setHistory([]);
    setMetrics(null);
    setLocalTags(client.tags ?? []);
    setTagsDirty(false);
    setTagsError(null);
    setHistoryLoading(true);
    api
      .get<{ client: { tags?: string[] }; history: HistoryItem[]; metrics: ClientMetrics }>(`/clients/${client.id}`)
      .then((d) => {
        setLocalTags(d.client.tags ?? []);
        setHistory(d.history);
        setMetrics(d.metrics);
      })
      .catch(() => {})
      .finally(() => setHistoryLoading(false));
  }

  function addTag() {
    const tag = tagInput.trim();
    if (!tag) return;
    if (tag.length > 30) { setTagsError('Tag deve ter no máximo 30 caracteres.'); return; }
    if (localTags.includes(tag)) { setTagInput(''); return; }
    if (localTags.length >= 20) { setTagsError('Máximo de 20 tags por cliente.'); return; }
    setLocalTags([...localTags, tag]);
    setTagInput('');
    setTagsDirty(true);
    setTagsError(null);
  }

  function removeTag(tag: string) {
    setLocalTags(localTags.filter((t) => t !== tag));
    setTagsDirty(true);
    setTagsError(null);
  }

  async function saveTags() {
    if (!selected) return;
    setTagsSaving(true);
    setTagsError(null);
    try {
      await api.put(`/clients/${selected.id}`, { tags: localTags });
      setSelected({ ...selected, tags: localTags });
      setTagsDirty(false);
    } catch {
      setTagsError('Erro ao salvar tags. Tente novamente.');
    } finally {
      setTagsSaving(false);
    }
  }

  function startEditing() {
    if (!selected) return;
    setEditName(selected.name);
    setEditPhone(selected.phone);
    setEditNotes(selected.notes ?? '');
    setEditTags([...localTags]);
    setEditTagInput('');
    setEditError(null);
    setEditing(true);
  }

  function cancelEditing() {
    setEditing(false);
    setEditError(null);
    setEditTagInput('');
  }

  function addEditTag() {
    const tag = editTagInput.trim();
    if (!tag) return;
    if (tag.length > 30) { setEditError('Tag deve ter no máximo 30 caracteres.'); return; }
    if (editTags.includes(tag)) { setEditTagInput(''); return; }
    if (editTags.length >= 20) { setEditError('Máximo de 20 tags por cliente.'); return; }
    setEditTags([...editTags, tag]);
    setEditTagInput('');
    setEditError(null);
  }

  function removeEditTag(tag: string) {
    setEditTags(editTags.filter((t) => t !== tag));
  }

  async function saveEdits() {
    if (!selected) return;
    const trimmedName  = editName.trim();
    const trimmedPhone = editPhone.trim();
    if (!trimmedName)              { setEditError('Nome é obrigatório.');     return; }
    if (trimmedPhone.length < 8)   { setEditError('Telefone inválido (mínimo 8 dígitos).'); return; }

    setEditSaving(true);
    setEditError(null);
    try {
      await api.put(`/clients/${selected.id}`, {
        name:  trimmedName,
        phone: trimmedPhone,
        notes: editNotes.trim() || null,
        tags:  editTags,
      });

      const updated: Client = {
        ...selected,
        name:  trimmedName,
        phone: trimmedPhone,
        notes: editNotes.trim() || null,
        tags:  editTags,
      };
      setSelected(updated);
      setLocalTags(editTags);
      setTagsDirty(false);

      // reflete nome/telefone na lista sem reload completo
      setClients((prev) =>
        prev
          ? prev.map((c) => c.id === selected.id ? { ...c, name: trimmedName, phone: trimmedPhone } : c)
          : prev
      );

      setEditing(false);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Erro ao salvar. Tente novamente.');
    } finally {
      setEditSaving(false);
    }
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
                    <div className="flex justify-end items-center gap-1.5">
                      {isInativa(c.ultimoAtendimento) && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 font-medium">
                          Inativa
                        </span>
                      )}
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

      {/* ── ficha da cliente ────────────────────────────────────────────── */}
      {selected && (
        <div
          className="fixed inset-0 bg-ink/50 flex items-center justify-center p-4 z-50"
          onClick={editing ? cancelEditing : closeModal}
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
                  <div className="flex items-center gap-2 flex-wrap mt-0.5">
                    <p className="text-sm text-ink/50">{selected.phone}</p>
                    {metrics?.inativaDias != null && metrics.inativaDias >= 60 && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 font-medium">
                        Inativa há {metrics.inativaDias}d
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {!editing && (
                  <button
                    onClick={startEditing}
                    className="p-1.5 rounded-lg hover:bg-wine-50 text-ink/40 hover:text-wine-600 transition-colors"
                    aria-label="Editar cliente"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </button>
                )}
                <CloseButton onClick={closeModal} />
              </div>
            </div>

            {/* KPIs */}
            {metrics && (
              <div className="grid grid-cols-2 gap-px bg-wine-100 border-b border-wine-100">
                <div className="bg-white px-5 py-3">
                  <p className="text-xs text-ink/40 mb-0.5">Total gasto</p>
                  <p className="text-base font-semibold text-ink">{formatCents(metrics.valorTotalCents)}</p>
                </div>
                <div className="bg-white px-5 py-3">
                  <p className="text-xs text-ink/40 mb-0.5">Ticket médio</p>
                  <p className="text-base font-semibold text-ink">
                    {metrics.totalConcluidos > 0 ? formatCents(metrics.ticketMedioCents) : '—'}
                  </p>
                </div>
                <div className="bg-white px-5 py-3">
                  <p className="text-xs text-ink/40 mb-0.5">Freq. de retorno</p>
                  <p className="text-base font-semibold text-ink">
                    {metrics.freqMediaDias != null && metrics.totalConcluidos > 1
                      ? `${metrics.freqMediaDias} dias`
                      : '—'}
                  </p>
                </div>
                <div className="bg-wine-50/50 px-5 py-3">
                  <p className="text-xs text-ink/40 mb-0.5">Concluídos</p>
                  <p className="text-base font-semibold text-wine-700">{metrics.totalConcluidos}</p>
                </div>
              </div>
            )}

            <div className="overflow-y-auto flex-1">
              {editing ? (
                /* ── modo edição ── */
                <div className="p-6 flex flex-col gap-4">
                  <label className="block">
                    <span className="block text-sm font-medium text-ink/60 mb-1">Nome</span>
                    <input
                      className="input"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      placeholder="Nome completo"
                      autoFocus
                    />
                  </label>

                  <label className="block">
                    <span className="block text-sm font-medium text-ink/60 mb-1">Telefone</span>
                    <input
                      className="input"
                      value={editPhone}
                      onChange={(e) => setEditPhone(e.target.value)}
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
                      rows={3}
                      value={editNotes}
                      onChange={(e) => setEditNotes(e.target.value)}
                      placeholder="Alergias, preferências, etc."
                    />
                  </label>

                  <div>
                    <span className="block text-sm font-medium text-ink/60 mb-2">Tags</span>
                    <div className="flex flex-wrap gap-1.5 mb-2 min-h-[1.75rem]">
                      {editTags.map((tag) => (
                        <span
                          key={tag}
                          className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full bg-wine-50 text-wine-700 border border-wine-100"
                        >
                          {tag}
                          <button
                            onClick={() => removeEditTag(tag)}
                            className="text-wine-400 hover:text-wine-700 transition-colors leading-none"
                            aria-label={`Remover tag ${tag}`}
                          >
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </span>
                      ))}
                      {editTags.length === 0 && (
                        <span className="text-xs text-ink/30 py-1">Nenhuma tag.</span>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <input
                        className="input text-sm py-1.5 flex-1 min-w-0"
                        placeholder="Nova tag…"
                        value={editTagInput}
                        maxLength={30}
                        onChange={(e) => setEditTagInput(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addEditTag(); } }}
                      />
                      <button
                        onClick={addEditTag}
                        className="px-3 py-1.5 text-sm rounded-lg bg-wine-50 text-wine-700 border border-wine-100 hover:bg-wine-100 transition-colors shrink-0 font-medium"
                      >
                        +
                      </button>
                    </div>
                  </div>

                  {editError && (
                    <div className="rounded-xl bg-rose-50 border border-rose-200 p-3 text-sm text-rose-700">
                      {editError}
                    </div>
                  )}
                </div>
              ) : (
                /* ── modo visualização ── */
                <>
                  {/* informações rápidas */}
                  {metrics && (metrics.proximoAtendimento || metrics.ultimoAtendimento || metrics.servicoFavorito) && (
                    <div className="px-6 pt-4 pb-1 space-y-2">
                      {metrics.proximoAtendimento && (
                        <div className="flex items-start gap-2 text-sm">
                          <span className="text-ink/40 w-28 shrink-0 pt-0.5">Próx. agend.</span>
                          <span className="text-emerald-700 font-medium">{formatDateTime(metrics.proximoAtendimento)}</span>
                        </div>
                      )}
                      {metrics.ultimoAtendimento && (
                        <div className="flex items-center gap-2 text-sm">
                          <span className="text-ink/40 w-28 shrink-0">Último atend.</span>
                          <span className="text-ink/70">{formatDate(metrics.ultimoAtendimento)}</span>
                        </div>
                      )}
                      {metrics.servicoFavorito && (
                        <div className="flex items-center gap-2 text-sm">
                          <span className="text-ink/40 w-28 shrink-0">Serv. favorito</span>
                          <span className="text-ink/70">{metrics.servicoFavorito}</span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* observações */}
                  {selected.notes && (
                    <div className="px-6 pt-4">
                      <p className="text-xs font-medium text-ink/40 uppercase tracking-wide mb-1.5">Observações</p>
                      <p className="text-sm bg-wine-50 rounded-xl p-3 text-ink/70">{selected.notes}</p>
                    </div>
                  )}

                  {/* tags */}
                  <div className="px-6 pt-4">
                    <p className="text-xs font-medium text-ink/40 uppercase tracking-wide mb-2">Tags</p>
                    <div className="flex flex-wrap gap-1.5 mb-2 min-h-[1.75rem]">
                      {localTags.map((tag) => (
                        <span
                          key={tag}
                          className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full bg-wine-50 text-wine-700 border border-wine-100"
                        >
                          {tag}
                          <button
                            onClick={() => removeTag(tag)}
                            className="text-wine-400 hover:text-wine-700 transition-colors leading-none"
                            aria-label={`Remover tag ${tag}`}
                          >
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </span>
                      ))}
                      {localTags.length === 0 && (
                        <span className="text-xs text-ink/30 py-1">Nenhuma tag adicionada.</span>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <input
                        className="input text-sm py-1.5 flex-1 min-w-0"
                        placeholder="Nova tag…"
                        value={tagInput}
                        maxLength={30}
                        onChange={(e) => setTagInput(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }}
                      />
                      <button
                        onClick={addTag}
                        className="px-3 py-1.5 text-sm rounded-lg bg-wine-50 text-wine-700 border border-wine-100 hover:bg-wine-100 transition-colors shrink-0 font-medium"
                      >
                        +
                      </button>
                    </div>
                    {tagsDirty && (
                      <div className="flex items-center justify-between mt-2 gap-2">
                        {tagsError
                          ? <p className="text-xs text-rose-600 flex-1">{tagsError}</p>
                          : <span className="flex-1" />
                        }
                        <button
                          onClick={saveTags}
                          disabled={tagsSaving}
                          className="px-3 py-1.5 text-xs rounded-lg bg-wine-600 text-white font-medium hover:bg-wine-700 disabled:opacity-60 transition-colors shrink-0"
                        >
                          {tagsSaving ? 'Salvando…' : 'Salvar tags'}
                        </button>
                      </div>
                    )}
                    {!tagsDirty && tagsError && (
                      <p className="text-xs text-rose-600 mt-1">{tagsError}</p>
                    )}
                  </div>

                  {/* histórico */}
                  <div className="px-6 pt-4 pb-2">
                    <p className="text-xs font-medium text-ink/40 uppercase tracking-wide mb-3">
                      Histórico de atendimentos
                    </p>
                  </div>

                  <div className="px-6 pb-4">
                    {historyLoading ? (
                      <div className="space-y-2 animate-pulse">
                        {[0, 1, 2].map((i) => (
                          <div key={i} className="h-10 bg-wine-50 rounded-lg" />
                        ))}
                      </div>
                    ) : history.length === 0 ? (
                      <p className="text-sm text-ink/40 py-4 text-center">Sem atendimentos registrados.</p>
                    ) : (
                      <ul>
                        {history.map((h) => {
                          const cfg = historyStatusConfig[h.status] ?? { label: h.status, cls: 'bg-gray-100 text-gray-500' };
                          return (
                            <li
                              key={h.id}
                              className="flex items-center justify-between gap-3 py-2.5 border-b border-wine-50 last:border-0"
                            >
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-medium text-ink truncate">{h.service_name}</p>
                                <p className="text-xs text-ink/40">{formatDate(h.starts_at)}</p>
                              </div>
                              <div className="shrink-0 flex flex-col items-end gap-1">
                                <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${cfg.cls}`}>
                                  {cfg.label}
                                </span>
                                {h.price_cents_snapshot > 0 && (
                                  <span className="text-xs text-ink/40">{formatCents(h.price_cents_snapshot)}</span>
                                )}
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                </>
              )}
            </div>

            <div className="px-6 py-4 border-t border-wine-50">
              {editing ? (
                <div className="flex gap-2">
                  <button
                    onClick={cancelEditing}
                    className="flex-1 py-2.5 rounded-xl border border-wine-100 text-sm text-ink/70 hover:bg-wine-50 transition-colors"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={saveEdits}
                    disabled={editSaving}
                    className="flex-1 py-2.5 rounded-xl bg-wine-600 text-white text-sm font-medium hover:bg-wine-700 disabled:opacity-60 transition-colors"
                  >
                    {editSaving ? 'Salvando…' : 'Salvar alterações'}
                  </button>
                </div>
              ) : (
              <button
                onClick={closeModal}
                className="w-full py-2.5 rounded-xl border border-wine-100 text-sm text-ink/70 hover:bg-wine-50 transition-colors"
              >
                Fechar
              </button>
              )}
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
