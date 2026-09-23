import { useEffect, useState, useRef } from 'react';
import { usePageTitle } from '../hooks/usePageTitle';
import { useToast } from '../context/ToastContext';
import type { Expense } from '../types';

const API = '/api';
const CATEGORIES = [
  'Aluguel', 'Materiais', 'Energia', 'Água', 'Internet',
  'Telefone', 'Marketing', 'Higiene', 'Equipamento', 'Outros',
];

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
  const last = new Date(y, m + 1, 0);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { from: iso(first), to: iso(last) };
}

const PERIODS = [
  { label: 'Este mês', value: 'current' },
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
  description: '',
  category: 'Outros',
  amount: '',
  expense_date: todayIso(),
  notes: '',
});

export default function Gastos() {
  usePageTitle('Gastos');
  const { toast } = useToast();

  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<'current' | 'previous' | 'custom'>('current');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [filterCat, setFilterCat] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Expense | null>(null);
  const descRef = useRef<HTMLInputElement>(null);

  function getRange() {
    if (period === 'current') return monthRange(0);
    if (period === 'previous') return monthRange(-1);
    return { from: customFrom, to: customTo };
  }

  async function fetchExpenses() {
    setLoading(true);
    try {
      const { from, to } = getRange();
      const params = new URLSearchParams();
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      const res = await fetch(`${API}/expenses?${params}`, { credentials: 'include' });
      if (!res.ok) throw new Error();
      const data: Expense[] = await res.json();
      setExpenses(data);
    } catch {
      toast('Erro ao carregar gastos.', 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (period === 'custom' && (!customFrom || !customTo)) return;
    fetchExpenses();
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
      description: e.description,
      category: e.category,
      amount: (e.amount_cents / 100).toFixed(2).replace('.', ','),
      expense_date: e.expense_date,
      notes: e.notes ?? '',
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
    if (!cents) { toast('Informe um valor válido.', 'error'); return; }
    if (!form.expense_date) { toast('Informe a data.', 'error'); return; }
    setSaving(true);
    try {
      const body = {
        description: form.description.trim(),
        category: form.category,
        amount_cents: cents,
        expense_date: form.expense_date,
        notes: form.notes.trim() || null,
      };
      const url = editing ? `${API}/expenses/${editing.id}` : `${API}/expenses`;
      const method = editing ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as {error?: string}).error || 'Erro');
      }
      toast(editing ? 'Gasto atualizado.' : 'Gasto adicionado.', 'success');
      setModalOpen(false);
      fetchExpenses();
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : 'Erro ao salvar.', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(expense: Expense) {
    try {
      const res = await fetch(`${API}/expenses/${expense.id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) throw new Error();
      toast('Gasto excluído.', 'success');
      setConfirmDelete(null);
      fetchExpenses();
    } catch {
      toast('Erro ao excluir.', 'error');
    }
  }

  const filtered = filterCat ? expenses.filter(e => e.category === filterCat) : expenses;
  const total = filtered.reduce((s, e) => s + e.amount_cents, 0);

  return (
    <div className="max-w-2xl mx-auto space-y-6 pb-10">
      {/* Header */}
      <div className="page-header flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-ink">Gastos</h1>
          <p className="text-sm text-ink/50 mt-1">Controle seus custos por período</p>
        </div>
        <button onClick={openAdd} className="btn-primary">
          + Novo gasto
        </button>
      </div>

      {/* Filtros */}
      <div className="bg-white rounded-2xl border border-wine-100/60 p-4 space-y-3 shadow-sm">
        <div className="flex flex-wrap gap-2">
          {PERIODS.map(p => (
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
              <input type="date" className="input" value={customFrom} onChange={e => setCustomFrom(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1 flex-1 min-w-[130px]">
              <label className="text-xs text-ink/50 font-medium">Até</label>
              <input type="date" className="input" value={customTo} onChange={e => setCustomTo(e.target.value)} />
            </div>
          </div>
        )}
        <div className="flex items-center gap-2">
          <label className="text-xs text-ink/50 font-medium whitespace-nowrap">Categoria:</label>
          <select className="input flex-1" value={filterCat} onChange={e => setFilterCat(e.target.value)}>
            <option value="">Todas</option>
            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>

      {/* Total */}
      <div className="bg-wine-600 rounded-2xl p-5 text-white flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-widest text-white/60 font-semibold">Total no período</p>
          <p className="text-3xl font-bold mt-1">{formatCurrency(total)}</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-white/60">{filtered.length} {filtered.length === 1 ? 'lançamento' : 'lançamentos'}</p>
        </div>
      </div>

      {/* Lista */}
      <div className="space-y-3">
        {period === 'custom' && (!customFrom || !customTo) ? (
          <div className="bg-wine-50 border border-wine-100/60 rounded-2xl p-10 flex flex-col items-center gap-3 text-center">
            <svg className="w-8 h-8 text-wine-300" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><path strokeLinecap="round" d="M16 2v4M8 2v4M3 10h18"/></svg>
            <div>
              <p className="font-medium text-wine-700">Selecione o intervalo</p>
              <p className="text-sm text-ink/40 mt-1">Preencha as datas &quot;De&quot; e &quot;Até&quot; acima para ver os gastos do período.</p>
            </div>
          </div>
        ) : loading ? (
          <div className="text-center py-12 text-ink/40 text-sm">Carregando...</div>
        ) : filtered.length === 0 ? (
          <div className="bg-white rounded-2xl border border-wine-100/60 p-10 text-center">
            <p className="text-ink/40 text-sm">Nenhum gasto no período</p>
            <button onClick={openAdd} className="mt-4 btn-secondary">Adicionar gasto</button>
          </div>
        ) : (
          filtered.map(expense => (
            <div key={expense.id} className="bg-white rounded-2xl border border-wine-100/60 p-4 shadow-sm flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-ink truncate">{expense.description}</span>
                  <span className="text-xs bg-wine-50 text-wine-700 rounded-full px-2 py-0.5 font-medium">{expense.category}</span>
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
                <span className="font-bold text-wine-700">{formatCurrency(expense.amount_cents)}</span>
                <div className="flex gap-1">
                  <button
                    onClick={() => openEdit(expense)}
                    className="p-1.5 rounded-lg hover:bg-wine-50 text-ink/40 hover:text-wine-700 transition-colors"
                    title="Editar"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 3.487a2.25 2.25 0 113.182 3.182L7.5 19.213l-4.5 1.125 1.125-4.5 13.737-13.351z" />
                    </svg>
                  </button>
                  <button
                    onClick={() => setConfirmDelete(expense)}
                    className="p-1.5 rounded-lg hover:bg-red-50 text-ink/40 hover:text-red-500 transition-colors"
                    title="Excluir"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M9 7V4h6v3M3 7h18" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Modal add/edit */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4" onClick={() => setModalOpen(false)}>
          <div className="absolute inset-0 bg-black/40" />
          <div
            className="relative bg-white rounded-2xl w-full max-w-md p-6 shadow-xl space-y-4"
            onClick={e => e.stopPropagation()}
          >
            <h2 className="text-lg font-bold text-ink">{editing ? 'Editar gasto' : 'Novo gasto'}</h2>

            <div className="space-y-3">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-ink/60">Descrição *</label>
                <input
                  ref={descRef}
                  className="input"
                  placeholder="Ex: Esmalte base coat"
                  value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  maxLength={200}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-ink/60">Categoria</label>
                  <select
                    className="input"
                    value={form.category}
                    onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                  >
                    {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-ink/60">Valor (R$) *</label>
                  <input
                    className="input"
                    placeholder="0,00"
                    value={form.amount}
                    onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
                    inputMode="decimal"
                  />
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-ink/60">Data *</label>
                <input
                  type="date"
                  className="input"
                  value={form.expense_date}
                  onChange={e => setForm(f => ({ ...f, expense_date: e.target.value }))}
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-ink/60">Observações</label>
                <input
                  className="input"
                  placeholder="Opcional"
                  value={form.notes}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                />
              </div>
            </div>

            <div className="flex gap-3 pt-1">
              <button onClick={() => setModalOpen(false)} className="btn-secondary flex-1">Cancelar</button>
              <button onClick={handleSave} disabled={saving} className="btn-primary flex-1">
                {saving ? 'Salvando…' : editing ? 'Salvar' : 'Adicionar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm delete */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setConfirmDelete(null)}>
          <div className="absolute inset-0 bg-black/40" />
          <div
            className="relative bg-white rounded-2xl w-full max-w-sm p-6 shadow-xl text-center space-y-4"
            onClick={e => e.stopPropagation()}
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
