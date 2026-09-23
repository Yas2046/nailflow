import { useEffect, useState } from 'react';
import { api } from '../services/api';
import { usePageTitle } from '../hooks/usePageTitle';
import type { Service } from '../types';

// ── Utils ────────────────────────────────────────────────────────────────────

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

// ── Icons ────────────────────────────────────────────────────────────────────

function IconScissors() {
  return (
    <svg className="w-8 h-8" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <circle cx="6" cy="6" r="3" /><circle cx="6" cy="18" r="3" />
      <path strokeLinecap="round" d="M20 4 8.12 15.88M14.47 14.48 20 20M8.12 8.12 12 12" />
    </svg>
  );
}
function IconClock() {
  return (
    <svg className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" /><path strokeLinecap="round" d="M12 7v5l3 3" />
    </svg>
  );
}
function CloseButton({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="p-1.5 rounded-lg hover:bg-wine-50 text-ink/40 hover:text-ink/70 transition-colors" aria-label="Fechar">
      <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
      </svg>
    </button>
  );
}

// ── Skeleton ─────────────────────────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 animate-pulse">
      {[0, 1, 2].map((i) => (
        <div key={i} className="bg-white border border-wine-100/80 rounded-2xl p-5 space-y-3">
          <div className="flex items-start justify-between">
            <div className="h-5 w-32 bg-wine-50 rounded" />
            <div className="h-5 w-14 bg-wine-50 rounded-full" />
          </div>
          <div className="h-7 w-24 bg-wine-50 rounded" />
          <div className="h-3.5 w-40 bg-wine-50/70 rounded" />
          <div className="h-5 w-16 bg-wine-50 rounded-full" />
        </div>
      ))}
    </div>
  );
}

// ── ServiceCard ───────────────────────────────────────────────────────────────

function ServiceCard({ service, onClick }: { service: Service; onClick: () => void }) {
  const isActive = service.active;
  return (
    <button
      onClick={onClick}
      className={`group text-left rounded-2xl p-5 transition-all duration-200 ${
        isActive
          ? 'bg-white border border-wine-100/80 hover:border-wine-300/60 hover:shadow-md hover:-translate-y-0.5'
          : 'bg-ink/[0.015] border border-dashed border-ink/15 hover:bg-ink/[0.025]'
      }`}
    >
      {/* Nome + badge status */}
      <div className="flex items-start justify-between gap-2 mb-3">
        <p className={`font-display text-lg leading-tight ${isActive ? 'text-wine-800' : 'text-ink/45'}`}>
          {service.name}
        </p>
        {isActive ? (
          <span className="shrink-0 flex items-center gap-1.5 text-[10px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 font-semibold whitespace-nowrap">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block animate-pulse" />
            Ativo
          </span>
        ) : (
          <span className="shrink-0 text-[10px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-400 border border-gray-200 font-semibold whitespace-nowrap">
            Inativo
          </span>
        )}
      </div>

      {/* Preço — protagonista */}
      <p className={`font-display tabular-nums leading-none mb-3 ${
        isActive ? 'text-3xl text-wine-700' : 'text-xl text-ink/35'
      }`}>
        {formatMoney(service.priceCents)}
      </p>

      {/* Linha divisória */}
      <div className={`border-t mb-3 ${isActive ? 'border-wine-50' : 'border-ink/8'}`} />

      {/* Descrição */}
      {service.description && (
        <p className={`text-xs mb-3 line-clamp-2 ${isActive ? 'text-ink/50' : 'text-ink/30'}`}>
          {service.description}
        </p>
      )}

      {/* Duração */}
      <span className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full font-medium ${
        isActive ? 'bg-wine-50 text-wine-600' : 'bg-ink/5 text-ink/35'
      }`}>
        <IconClock />
        {formatDuration(service.durationMinutes)}
      </span>
    </button>
  );
}

// ── Página ────────────────────────────────────────────────────────────────────

export default function Servicos() {
  usePageTitle('Serviços');
  const [services, setServices] = useState<Service[] | null>(null);
  const [editing, setEditing]   = useState<Service | 'new' | null>(null);

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
  function closeModal() { setEditing(null); setError(null); setSuccess(false); }

  async function handleSave() {
    setError(null); setSuccess(false);
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

  const ativos   = (services ?? []).filter(s => s.active).length;
  const inativos = (services ?? []).filter(s => !s.active).length;

  return (
    <div className="space-y-7">

      {/* ── Cabeçalho ── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl sm:text-4xl text-wine-800 leading-tight">Serviços</h1>
          {services !== null && (
            <p className="text-sm text-ink/40 mt-1">
              {ativos} ativo{ativos !== 1 ? 's' : ''}
              {inativos > 0 && ` · ${inativos} inativo${inativos !== 1 ? 's' : ''}`}
            </p>
          )}
        </div>
        <button onClick={openNew} className="btn-primary">+ Novo serviço</button>
      </div>

      {/* ── Conteúdo ── */}
      {services === null ? (
        <LoadingSkeleton />
      ) : services.length === 0 ? (
        <div className="bg-white border border-wine-100/80 rounded-2xl p-10 flex flex-col items-center gap-4 text-center">
          <div className="w-12 h-12 rounded-full bg-wine-50 flex items-center justify-center text-wine-200">
            <IconScissors />
          </div>
          <div>
            <p className="font-display text-lg text-wine-700">Nenhum serviço cadastrado</p>
            <p className="text-xs text-ink/40 mt-1">Adicione os serviços que você oferece para começar a agendar</p>
          </div>
          <button onClick={openNew} className="btn-primary">+ Adicionar primeiro serviço</button>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {services.map((s) => (
            <ServiceCard key={s.id} service={s} onClick={() => openEdit(s)} />
          ))}
        </div>
      )}

      {/* ── Modal ── */}
      {editing && (
        <div
          className="fixed inset-0 bg-ink/50 flex items-end sm:items-center justify-center p-4 z-50"
          onClick={(e) => { if (e.target === e.currentTarget) closeModal(); }}
        >
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-xl">
            {/* Cabeçalho */}
            <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-wine-50">
              <h3 className="font-display text-xl text-wine-800">
                {isNew ? 'Novo serviço' : 'Editar serviço'}
              </h3>
              <CloseButton onClick={closeModal} />
            </div>

            <div className="p-6 flex flex-col gap-4">
              {/* Nome */}
              <label className="block">
                <span className="block text-xs font-medium text-ink/50 uppercase tracking-wide mb-1.5">Nome</span>
                <input
                  className="input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ex.: Manicure, Pedicure…"
                  autoFocus={isNew}
                />
              </label>

              {/* Descrição */}
              <label className="block">
                <span className="block text-xs font-medium text-ink/50 uppercase tracking-wide mb-1.5">
                  Descrição <span className="font-normal normal-case text-ink/30">(opcional)</span>
                </span>
                <input
                  className="input"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Breve descrição do serviço"
                />
              </label>

              {/* Preço + Duração */}
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="block text-xs font-medium text-ink/50 uppercase tracking-wide mb-1.5">Preço</span>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-ink/40 pointer-events-none">R$</span>
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
                  <span className="block text-xs font-medium text-ink/50 uppercase tracking-wide mb-1.5">Duração (min)</span>
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

              {/* Status */}
              <label className="flex items-center gap-3 p-3 rounded-xl border border-wine-100/80 cursor-pointer hover:bg-wine-50/40 transition-colors">
                <input
                  type="checkbox"
                  checked={active}
                  onChange={(e) => setActive(e.target.checked)}
                  className="w-4 h-4 accent-wine-600"
                />
                <div>
                  <p className="text-sm font-medium text-ink/80">Serviço ativo</p>
                  <p className="text-xs text-ink/40">
                    {active ? 'Disponível para agendamento' : 'Não aparece em novos agendamentos'}
                  </p>
                </div>
              </label>

              {/* Feedback */}
              {error && (
                <div className="rounded-xl bg-rose-50 border border-rose-200 p-3 text-sm text-rose-700">{error}</div>
              )}
              {success && (
                <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3 text-sm text-emerald-700 font-medium">
                  Serviço salvo com sucesso!
                </div>
              )}

              {/* Ações */}
              <div className="flex gap-3 pt-1">
                <button onClick={closeModal} className="btn-secondary flex-1">Cancelar</button>
                <button onClick={handleSave} disabled={saving || success} className="btn-primary flex-1 disabled:opacity-60">
                  {saving ? 'Salvando…' : 'Salvar'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
