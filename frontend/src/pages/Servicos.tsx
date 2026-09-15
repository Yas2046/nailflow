import { useEffect, useState } from 'react';
import { api } from '../services/api';
import type { Service } from '../types';

// ─── utilitários ──────────────────────────────────────────────────────────────

function formatMoney(cents: number) {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatDuration(min: number): string {
  if (!min || min <= 0) return '—';
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}min`;
}

function parsePriceCents(raw: string): number {
  const cleaned = raw.replace(/[^\d,\.]/g, '').replace(',', '.');
  return Math.round((parseFloat(cleaned) || 0) * 100);
}

// ─── ícones ───────────────────────────────────────────────────────────────────

function IconScissors() {
  return (
    <svg className="w-8 h-8" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <circle cx="6" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path strokeLinecap="round" d="M20 4 8.12 15.88M14.47 14.48 20 20M8.12 8.12 12 12" />
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

// ─── skeleton ─────────────────────────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 animate-pulse">
      {[0, 1, 2].map((i) => (
        <div key={i} className="bg-white border border-wine-100 rounded-xl p-5 space-y-3">
          <div className="flex items-start justify-between">
            <div className="h-5 w-32 bg-wine-50 rounded" />
            <div className="h-5 w-14 bg-wine-50 rounded-full" />
          </div>
          <div className="h-3.5 w-48 bg-wine-50/70 rounded" />
          <div className="flex gap-2 pt-1">
            <div className="h-6 w-16 bg-wine-50 rounded-full" />
            <div className="h-6 w-20 bg-wine-50 rounded-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── card de serviço ──────────────────────────────────────────────────────────

function ServiceCard({ service, onClick }: { service: Service; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`group text-left bg-white border rounded-xl p-5 hover:shadow-md transition-all ${
        service.active ? 'border-wine-100' : 'border-ink/10 opacity-60'
      }`}
    >
      {/* cabeçalho */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <p className="font-display text-lg text-wine-700 leading-tight">{service.name}</p>
        {service.active ? (
          <span className="shrink-0 flex items-center gap-1 text-xs px-2.5 py-1 rounded-full bg-green-50 text-green-700 border border-green-200 font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
            Ativo
          </span>
        ) : (
          <span className="shrink-0 text-xs px-2.5 py-1 rounded-full bg-gray-100 text-gray-500 border border-gray-200 font-medium">
            Inativo
          </span>
        )}
      </div>

      {/* descrição */}
      {service.description && (
        <p className="text-sm text-ink/50 mb-3 line-clamp-2">{service.description}</p>
      )}

      {/* chips de preço e duração */}
      <div className="flex flex-wrap gap-2 mt-3">
        <span className="text-xs px-3 py-1.5 rounded-full bg-wine-50 text-wine-700 font-semibold">
          {formatMoney(service.priceCents)}
        </span>
        <span className="text-xs px-3 py-1.5 rounded-full bg-ink/5 text-ink/60 font-medium">
          ⏱ {formatDuration(service.durationMinutes)}
        </span>
      </div>
    </button>
  );
}

// ─── página ───────────────────────────────────────────────────────────────────

export default function Servicos() {
  const [services, setServices] = useState<Service[] | null>(null);
  const [editing, setEditing]   = useState<Service | 'new' | null>(null);

  // form
  const [name, setName]               = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice]             = useState('');
  const [duration, setDuration]       = useState('40');
  const [active, setActive]           = useState(true);
  const [error, setError]             = useState<string | null>(null);
  const [success, setSuccess]         = useState(false);
  const [saving, setSaving]           = useState(false);

  function reload() {
    api.get<Service[]>('/services').then(setServices).catch(() => setServices([]));
  }
  useEffect(reload, []);

  function openNew() {
    setName(''); setDescription(''); setPrice(''); setDuration('40');
    setActive(true); setError(null); setSuccess(false);
    setEditing('new');
  }

  function openEdit(s: Service) {
    setName(s.name);
    setDescription(s.description || '');
    setPrice((s.priceCents / 100).toFixed(2).replace('.', ','));
    setDuration(String(s.durationMinutes));
    setActive(s.active);
    setError(null); setSuccess(false);
    setEditing(s);
  }

  function closeModal() {
    setEditing(null);
    setError(null);
    setSuccess(false);
  }

  async function handleSave() {
    setError(null);
    setSuccess(false);

    if (!name.trim()) { setError('O nome do serviço é obrigatório.'); return; }
    const durationMin = parseInt(duration, 10);
    if (!durationMin || durationMin <= 0) { setError('Informe uma duração válida.'); return; }
    const priceCents = parsePriceCents(price);
    if (priceCents <= 0) { setError('Informe um preço válido (ex.: 35,00).'); return; }

    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        description: description.trim() || null,
        priceCents,
        durationMinutes: durationMin,
        active,
      };
      if (editing === 'new') {
        await api.post('/services', payload);
      } else if (editing) {
        await api.put(`/services/${editing.id}`, payload);
      }
      setSuccess(true);
      reload();
      setTimeout(closeModal, 900);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar serviço.');
    } finally {
      setSaving(false);
    }
  }

  const durationMin = parseInt(duration, 10);
  const durationPreview = !isNaN(durationMin) && durationMin > 0 ? formatDuration(durationMin) : null;
  const isNew = editing === 'new';

  return (
    <div className="space-y-6">
      {/* cabeçalho */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="font-display text-3xl text-wine-700">Serviços</h1>
        <button
          onClick={openNew}
          className="px-4 py-2 rounded-lg bg-wine-600 text-white text-sm font-medium hover:bg-wine-700 transition-colors shadow-sm"
        >
          + Novo serviço
        </button>
      </div>

      {/* conteúdo */}
      {services === null ? (
        <LoadingSkeleton />
      ) : services.length === 0 ? (
        <div className="bg-white border border-wine-100 rounded-xl p-12 flex flex-col items-center gap-3 text-ink/30">
          <IconScissors />
          <p className="text-sm">Nenhum serviço cadastrado ainda.</p>
        </div>
      ) : (
        <>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {services.map((s) => (
              <ServiceCard key={s.id} service={s} onClick={() => openEdit(s)} />
            ))}
          </div>
          <p className="text-xs text-ink/30">
            {services.length} serviço{services.length !== 1 ? 's' : ''} cadastrado{services.length !== 1 ? 's' : ''}
            {services.filter((s) => !s.active).length > 0 &&
              ` · ${services.filter((s) => !s.active).length} inativo${services.filter((s) => !s.active).length !== 1 ? 's' : ''}`}
          </p>
        </>
      )}

      {/* ── modal ──────────────────────────────────────────────────────── */}
      {editing && (
        <div
          className="fixed inset-0 bg-ink/50 flex items-center justify-center p-4 z-50"
          onClick={(e) => { if (e.target === e.currentTarget) closeModal(); }}
        >
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-xl">
            {/* cabeçalho */}
            <div className="flex items-center justify-between p-6 pb-4 border-b border-wine-50">
              <h3 className="font-display text-xl text-wine-700">
                {isNew ? 'Novo serviço' : 'Editar serviço'}
              </h3>
              <CloseButton onClick={closeModal} />
            </div>

            <div className="p-6 flex flex-col gap-4">
              {/* nome */}
              <label className="block">
                <span className="block text-sm font-medium text-ink/60 mb-1">Nome</span>
                <input
                  className="input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ex.: Manicure, Pedicure…"
                  autoFocus={isNew}
                />
              </label>

              {/* descrição */}
              <label className="block">
                <span className="block text-sm font-medium text-ink/60 mb-1">
                  Descrição <span className="font-normal text-ink/30">(opcional)</span>
                </span>
                <input
                  className="input"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Breve descrição do serviço"
                />
              </label>

              {/* preço e duração lado a lado */}
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="block text-sm font-medium text-ink/60 mb-1">Preço</span>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-ink/40 pointer-events-none">
                      R$
                    </span>
                    <input
                      className="input pl-8"
                      value={price}
                      onChange={(e) => setPrice(e.target.value)}
                      placeholder="0,00"
                      inputMode="decimal"
                    />
                  </div>
                </label>

                <label className="block">
                  <span className="block text-sm font-medium text-ink/60 mb-1">Duração (min)</span>
                  <input
                    className="input"
                    type="number"
                    min={5}
                    step={5}
                    value={duration}
                    onChange={(e) => setDuration(e.target.value)}
                  />
                  {durationPreview && (
                    <span className="block text-xs text-ink/40 mt-1">{durationPreview}</span>
                  )}
                </label>
              </div>

              {/* status */}
              <label className="flex items-center gap-3 p-3 rounded-xl border border-wine-100 cursor-pointer hover:bg-wine-50/50 transition-colors">
                <input
                  type="checkbox"
                  checked={active}
                  onChange={(e) => setActive(e.target.checked)}
                  className="w-4 h-4 accent-wine-600"
                />
                <div>
                  <p className="text-sm font-medium text-ink/80">Serviço ativo</p>
                  <p className="text-xs text-ink/40">
                    {active ? 'Disponível para agendamento' : 'Não aparece para novos agendamentos'}
                  </p>
                </div>
              </label>

              {/* feedback */}
              {error && (
                <div className="rounded-xl bg-rose-50 border border-rose-200 p-3 text-sm text-rose-700">
                  {error}
                </div>
              )}
              {success && (
                <div className="rounded-xl bg-green-50 border border-green-200 p-3 text-sm text-green-700 font-medium">
                  Serviço salvo com sucesso!
                </div>
              )}

              {/* ações */}
              <div className="flex justify-end gap-2 pt-1">
                <button
                  onClick={closeModal}
                  className="px-4 py-2 text-sm rounded-lg border border-wine-100 text-ink/70 hover:bg-wine-50 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving || success}
                  className="px-5 py-2 text-sm rounded-lg bg-wine-600 text-white font-medium hover:bg-wine-700 disabled:opacity-60 transition-colors"
                >
                  {saving ? 'Salvando…' : 'Salvar serviço'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
