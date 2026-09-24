import { useEffect, useState, useRef } from 'react';
import { usePageTitle } from '../hooks/usePageTitle';
import { useToast } from '../context/ToastContext';
import { api } from '../services/api';
import type { Expense, ExpenseSummary } from '../types';

const CATEGORIES = [
  'Aluguel', 'Materiais', 'Energia', 'Água', 'Internet',
  'Telefone', 'Marketing', 'Higiene', 'Equipamento', 'Outros',
];

const CATEGORY_COLORS: Record<string, string> = {
  Aluguel:     'bg-wine-100 text-wine-700',
  Materiais:   'bg-sage-100 text-sage-700',
  Energia:     'bg-amber-100 text-amber-700',
  Água:        'bg-sky-100 text-sky-700',
  Internet:    'bg-blue-100 text-blue-700',
  Telefone:    'bg-indigo-100 text-indigo-700',
  Marketing:   'bg-pink-100 text-pink-700',
  Higiene:     'bg-teal-100 text-teal-700',
  Equipamento: 'bg-orange-100 text-orange-700',
  Outros:      'bg-gray-100 text-gray-600',
};

function formatCurrency(cents: number) {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function monthRange(offset = 0): { from: string; to: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + offset;
  const first = new Date(y, m, 1);
  const last  = new Date(y, m + 1, 0);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { from: iso(first), to: iso(last) };
}

function periodLabel(period: string, customFrom: string, customTo: string): string {
  if (period === 'current') {
    return new Date().toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  }
  if (period === 'previous') {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  }
  if (customFrom && customTo) {
    const fmt = (s: string) => new Date(s + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
    return `${fmt(customFrom)} – ${fmt(customTo)}`;
  }
  return 'Personalizado';
}

const PERIODS = [
  { label: 'Este mês',   value: 'current'  },
  { label: 'Mês passado', value: 'previous' },
  { label: 'Personalizado', value: 'custom' },
];

interface FormState {
  description: string;
  category: string;
  amount: string;
  expense_date: string;
  notes: string;
}

const emptyForm = (): FormState => ({
  description:  '',
  category:     'Outros',
  amount:       '',
  expense_date: todayIso(),
  notes:        '',
});

export default function Gastos() {
  usePageTitle('Gastos');
  const { toast } = useToast();

  const [expenses, setExpenses]     = useState<Expense[]>([]);
  const [summary, setSummary]       = useState<ExpenseSummary | null>(null);
  const [loading, setLoading]       = useState(true);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [period, setPeriod]         = useState<'current' | 'previous' | 'custom'>('current');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo]     = useState('');
  const [filterCat, setFilterCat]   = useState('');
  const [modalOpen, setModalOpen]   = useState(false);
  const [editing, setEditing]       = useState<Expense | null>(null);
  const [form, setForm]             = useState<FormState>(emptyForm());
  const [saving, setSaving]         = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Expense | null>(null);
  const descRef = useRef<HTMLInputElement>(null);

  function getRange() {
    if (period === 'current')  return monthRange(0);
    if (period === 'previous') return monthRange(-1);
    return { from: customFrom, to: customTo };
  }

  async function fetchExpenses() {
    setLoading(true);
    try {
      const { from, to } = getRange();
      const params: Record<string, string> = {};
      if (from) params.from = from;
      if (to)   params.to   = to;
      const qs = new URLSearchParams(params).toString();
      const data = await api.get<Expense[]>(`/expenses${qs ? `?${qs}` : ''}`);
      setExpenses(data);
    } catch {
      toast('Erro ao carregar gastos.', 'error');
    } finally {
      setLoading(false);
    }
  }

  async function fetchSummary() {
    const { from, to } = getRange();
    if (!from || !to) { setSummary(null); return; }
    setSummaryLoading(true);
    try {
      const data = await api.get<ExpenseSummary>(`/expenses/summary?from=${from}&to=${to}`);
      setSummary(data);
    } catch {
      setSummary(null);
    } finally {
      setSummaryLoading(false);
    }
  }

  useEffect(() => {
    if (period === 'custom' && (!customFrom || !customTo)) return;
    fetchExpenses();
    fetchSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, customFrom, customTo]);

  function openAdd() {
    setEditing(null);
    setForm(emptyForm());
    setModalOpen(true);
    setTimeout(() => descRef.current?.focus(), 80);
  }

  function openEdit(e: Expense) {
    setEditing(e);
    setForm({
      description:  e.description,
      category:     e.category,
      amount:       (e.amount_cents / 100).toFixed(2).replace('.', ','),
      expense_date: e.expense_date,
      notes:        e.notes ?? '',
    });
    setModalOpen(true);
    setTimeout(() => descRef.current?.focus(), 80);
  }

  function parseCents(raw: string): number {
    const cleaned = raw.replace(/\./g, '').replace(',', '.');
    const n = parseFloat(cleaned);
    if (isNaN(n) || n <= 0) return 0;
    return Math.round(n * 100);
  }

  async function handleSave() {
    const cents = parseCents(form.amount);
    if (!form.description.trim()) { toast('Informe a descrição.', 'error'); return; }
    if (!cents)                    { toast('Informe um valor válido.', 'error'); return; }
    if (!form.expense_date)        { toast('Informe a data.', 'error'); return; }
    setSaving(true);
    try {
      const body = {
        description:  form.description.trim(),
        category:     form.category,
        amount_cents: cents,
        expense_date: form.expense_date,
        notes:        form.notes.trim() || null,
      };
      if (editing) {
        await api.put(`/expenses/${editing.id}`, body);
        toast('Gasto atualizado.');
      } else {
        await api.post('/expenses', body);
        toast('Gasto adicionado.');
      }
      setModalOpen(false);
      fetchExpenses();
      fetchSummary();
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : 'Erro ao salvar.', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(expense: Expense) {
    try {
      await api.delete(`/expenses/${expense.id}`);
      toast('Gasto excluído.');
      setConfirmDelete(null);
      fetchExpenses();
      fetchSummary();
    } catch {
      toast('Erro ao excluir.', 'error');
    }
  }

  const filtered     = filterCat ? expenses.filter((e) => e.category === filterCat) : expenses;
  const filteredTotal = filtered.reduce((s, e) => s + e.amount_cents, 0);
  const hasCustomFilter = !!filterCat;

  const subtitle = periodLabel(period, customFrom, customTo);

  return (
    <div className="space-y-6 pb-10">

      {/* ── Cabeçalho ── */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl sm:text-4xl text-wine-800 leading-tight">Gastos</h1>
          <p className="text-sm text-ink/40 mt-1 capitalize">{subtitle}</p>
        </div>
        <button onClick={openAdd} className="btn-primary">
          + Novo gasto
        </button>
      </div>

      {/* ── Filtros de período ── */}
      <div className="bg-white rounded-2xl border border-wine-100/60 p-4 space-y-3 shadow-sm">
        <div className="flex flex-wrap gap-2">
          {PERIODS.map((p) => (
            <button
              key={p.value}
              onClick={() => setPeriod(p.value as typeof period)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                period === p.value
                  ? 'bg-wine-600 text-white'
                  : 'bg-wine-50 text-wine-700 hover:bg-wine-100'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        {period === 'custom' && (
          <div className="flex gap-3 flex-wrap">
            <div className="flex flex-col gap-1 flex-1 min-w-[130px]">
              <label className="text-xs text-ink/50 font-medium">De</label>
              <input type="date" className="input" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1 flex-1 min-w-[130px]">
              <label className="text-xs text-ink/50 font-medium">Até</label>
              <input type="date" className="input" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
            </div>
          </div>
        )}
      </div>

      {/* ── Resumo financeiro do período ── */}
      {!(period === 'custom' && (!customFrom || !customTo)) && (
        <div className="grid grid-cols-3 gap-px bg-wine-100 rounded-2xl overflow-hidden shadow-sm">
          {[
            {
              label: 'Faturado',
              value: summary ? formatCurrency(summary.faturadoCents) : '—',
              cls: 'text-ink',
            },
            {
              label: 'Gastos',
              value: summary ? formatCurrency(summary.gastosCents) : '—',
              cls: 'text-rose-600',
            },
            {
              label: 'Resultado',
              value: summary ? formatCurrency(summary.resultadoCents) : '—',
              cls: summary
                ? summary.resultadoCents >= 0 ? 'text-emerald-600' : 'text-rose-600'
                : 'text-ink',
            },
          ].map((item) => (
            <div key={item.label} className="bg-white px-4 py-4 first:rounded-l-2xl last:rounded-r-2xl">
              <p className="text-xs text-ink/40 uppercase tracking-wide font-medium mb-1">{item.label}</p>
              <p className={`font-display text-xl sm:text-2xl tabular-nums leading-none font-semibold ${item.cls} ${summaryLoading ? 'opacity-40' : ''}`}>
                {item.value}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* ── Resumo por categoria ── */}
      {!(period === 'custom' && (!customFrom || !customTo)) && summary && summary.categorias.length > 0 && (
        <div>
          <p className="text-xs font-medium text-ink/40 uppercase tracking-wide mb-2.5">Por categoria</p>
          <div className="flex flex-wrap gap-2">
            {summary.categorias.map((cat) => {
              const colorCls = CATEGORY_COLORS[cat.category] ?? 'bg-gray-100 text-gray-600';
              const isActive = filterCat === cat.category;
              return (
                <button
                  key={cat.category}
                  onClick={() => setFilterCat(isActive ? '' : cat.category)}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                    isActive
                      ? 'ring-2 ring-wine-500 ring-offset-1 ' + colorCls
                      : colorCls + ' border-transparent hover:ring-1 hover:ring-current'
                  }`}
                >
                  <span>{cat.category}</span>
                  <span className="font-semibold tabular-nums">{formatCurrency(cat.totalCents)}</span>
                  <span className="opacity-60">({cat.count})</span>
                </button>
              );
            })}
            {filterCat && (
              <button
                onClick={() => setFilterCat('')}
                className="px-3 py-1.5 rounded-full text-xs font-medium bg-wine-50 text-wine-700 border border-wine-100 hover:bg-wine-100 transition-colors"
              >
                × Limpar filtro
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Card de total ── */}
      {!(period === 'custom' && (!customFrom || !customTo)) && !loading && filtered.length > 0 && (
        <div className="bg-wine-600 rounded-2xl p-5 text-white flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-widest text-white/60 font-semibold">
              {hasCustomFilter ? `Total — ${filterCat}` : 'Total no período'}
            </p>
            <p className="font-display text-3xl tabular-nums mt-1">{formatCurrency(filteredTotal)}</p>
          </div>
          <p className="text-xs text-white/60 text-right">
            {filtered.length} {filtered.length === 1 ? 'lançamento' : 'lançamentos'}
          </p>
        </div>
      )}

      {/* ── Lista ── */}
      <div className="space-y-3">
        {period === 'custom' && (!customFrom || !customTo) ? (
          <div className="bg-wine-50 border border-wine-100/60 rounded-2xl p-10 flex flex-col items-center gap-3 text-center">
            <svg className="w-8 h-8 text-wine-300" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <rect x="3" y="4" width="18" height="18" rx="2" />
              <path strokeLinecap="round" d="M16 2v4M8 2v4M3 10h18" />
            </svg>
            <div>
              <p className="font-medium text-wine-700">Selecione o intervalo</p>
              <p className="text-sm text-ink/40 mt-1">Preencha as datas &quot;De&quot; e &quot;Até&quot; acima para ver os gastos do período.</p>
            </div>
          </div>
        ) : loading ? (
          <div className="bg-white rounded-2xl border border-wine-100/60 p-10 animate-pulse flex flex-col gap-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="flex-1 h-10 bg-wine-50 rounded-lg" />
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="bg-white rounded-2xl border border-wine-100/60 p-10 text-center">
            <p className="text-ink/40 text-sm">
              {filterCat ? `Nenhum gasto em "${filterCat}" no período` : 'Nenhum gasto no período'}
            </p>
            {!filterCat && (
              <button onClick={openAdd} className="mt-4 btn-secondary">Adicionar gasto</button>
            )}
          </div>
        ) : (
          filtered.map((expense) => {
            const colorCls = CATEGORY_COLORS[expense.category] ?? 'bg-gray-100 text-gray-600';
            return (
              <div key={expense.id} className="bg-white rounded-2xl border border-wine-100/60 p-4 shadow-sm flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-ink truncate">{expense.description}</span>
                    <span className={`text-xs rounded-full px-2 py-0.5 font-medium ${colorCls}`}>
                      {expense.category}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 mt-1">
                    <span className="text-xs text-ink/50">
                      {new Date(expense.expense_date + 'T12:00:00').toLocaleDateString('pt-BR')}
                    </span>
                    {expense.notes && (
                      <span className="text-xs text-ink/40 truncate max-w-[200px]">{expense.notes}</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="font-bold text-wine-700 tabular-nums">{formatCurrency(expense.amount_cents)}</span>
                  <div className="flex gap-1">
                    <button
                      onClick={() => openEdit(expense)}
                      className="p-1.5 rounded-lg hover:bg-wine-50 text-ink/40 hover:text-wine-700 transition-colors"
                      title="Editar"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 3.487a2.25 2.25 0 113.182 3.182L7.5 19.213l-4.5 1.125 1.125-4.5 13.737-13.351z" />
                      </svg>
                    </button>
                    <button
                      onClick={() => setConfirmDelete(expense)}
                      className="p-1.5 rounded-lg hover:bg-red-50 text-ink/40 hover:text-red-500 transition-colors"
                      title="Excluir"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M9 7V4h6v3M3 7h18" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* ── Modal add/edit ── */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-ink/50"
          onClick={() => setModalOpen(false)}
        >
          <div
            className="bg-white rounded-2xl w-full max-w-md shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-wine-50">
              <h2 className="font-display text-xl text-wine-800">{editing ? 'Editar gasto' : 'Novo gasto'}</h2>
              <button
                onClick={() => setModalOpen(false)}
                className="p-1.5 rounded-lg hover:bg-wine-50 text-ink/40 hover:text-ink/70 transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="p-6 space-y-4">
              <label className="block">
                <span className="block text-xs font-medium text-ink/50 uppercase tracking-wide mb-1.5">Descrição *</span>
                <input
                  ref={descRef}
                  className="input"
                  placeholder="Ex: Esmalte base coat"
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  maxLength={200}
                />
              </label>

              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="block text-xs font-medium text-ink/50 uppercase tracking-wide mb-1.5">Categoria</span>
                  <select
                    className="input"
                    value={form.category}
                    onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                  >
                    {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="block text-xs font-medium text-ink/50 uppercase tracking-wide mb-1.5">Valor (R$) *</span>
                  <input
                    className="input"
                    placeholder="0,00"
                    value={form.amount}
                    onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                    inputMode="decimal"
                  />
                </label>
              </div>

              <label className="block">
                <span className="block text-xs font-medium text-ink/50 uppercase tracking-wide mb-1.5">Data *</span>
                <input
                  type="date"
                  className="input"
                  value={form.expense_date}
                  onChange={(e) => setForm((f) => ({ ...f, expense_date: e.target.value }))}
                />
              </label>

              <label className="block">
                <span className="block text-xs font-medium text-ink/50 uppercase tracking-wide mb-1.5">
                  Observações <span className="font-normal normal-case text-ink/30">(opcional)</span>
                </span>
                <input
                  className="input"
                  placeholder="Ex: Nota fiscal 1234"
                  value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                />
              </label>

              <div className="flex gap-3 pt-1">
                <button onClick={() => setModalOpen(false)} className="btn-secondary flex-1">Cancelar</button>
                <button onClick={handleSave} disabled={saving} className="btn-primary flex-1 disabled:opacity-60">
                  {saving ? 'Salvando…' : editing ? 'Salvar' : 'Adicionar'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Confirm delete ── */}
      {confirmDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink/50"
          onClick={() => setConfirmDelete(null)}
        >
          <div
            className="bg-white rounded-2xl w-full max-w-sm p-6 shadow-xl text-center space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-ink font-semibold">Excluir &quot;{confirmDelete.description}&quot;?</p>
            <p className="text-sm text-ink/50">Esta ação não pode ser desfeita.</p>
            <div className="flex gap-3">
              <button onClick={() => setConfirmDelete(null)} className="btn-secondary flex-1">Cancelar</button>
              <button
                onClick={() => handleDelete(confirmDelete)}
                className="flex-1 px-4 py-2 rounded-xl bg-red-600 text-white text-sm font-semibold hover:bg-red-700 transition-colors"
              >
                Excluir
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
