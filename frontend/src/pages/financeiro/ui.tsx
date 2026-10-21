// Peças compartilhadas das telas do Financeiro: estados de carregamento/erro/vazio, modal, selos, histórico e carga assíncrona.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import ModalA11y from '../../components/ModalA11y';
import { ApiError } from '../../services/api';
import { financeiro, type HistoryItem } from '../../services/financeiro';
import { formatDateTimeBR, formatBRL, formatDateBR, methodLabel } from '../../utils/money';

export function errMsg(err: unknown, fallback = 'Não foi possível concluir.'): string {
  if (err instanceof ApiError) return err.message;
  return err instanceof Error && err.message ? err.message : fallback;
}

/** Carrega dados e expõe loading/erro/recarregar. `status` 404/503 = módulo indisponível neste servidor. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  const run = useCallback(async () => {
    const my = ++seq.current;
    setLoading(true);
    setError(null);
    try {
      const d = await fn();
      if (my === seq.current) { setData(d); setStatus(null); }
    } catch (e) {
      if (my === seq.current) { setError(errMsg(e)); setStatus(e instanceof ApiError ? e.status : null); }
    } finally {
      if (my === seq.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { void run(); }, [run]);
  return { data, error, status, loading, reload: run };
}

export function Loading({ lines = 3 }: { lines?: number }) {
  return (
    <div className="bg-white rounded-2xl border border-wine-100/60 p-6 animate-pulse space-y-3" role="status" aria-label="Carregando">
      {Array.from({ length: lines }, (_, i) => <div key={i} className="h-8 bg-wine-50 rounded-lg" />)}
    </div>
  );
}

export function ErrorBox({ message, status, onRetry }: { message: string; status?: number | null; onRetry?: () => void }) {
  const off = status === 404 || status === 503;
  return (
    <div className="bg-rose-50 border border-rose-100 rounded-2xl p-5 text-sm text-rose-700 flex flex-wrap items-center justify-between gap-3" role="alert">
      <span>{off ? 'O módulo Financeiro não está disponível neste ambiente.' : message}</span>
      {onRetry && !off && <button className="btn-secondary" onClick={onRetry}>Tentar de novo</button>}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="bg-white rounded-2xl border border-wine-100/60 p-8 text-center text-sm text-ink/50">{children}</div>;
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`card ${className}`}>{children}</div>;
}

export function Stat({ label, value, tone = 'ink', hint }: { label: string; value: string; tone?: 'ink' | 'good' | 'bad' | 'warn'; hint?: string }) {
  const cls = { ink: 'text-ink', good: 'text-emerald-600', bad: 'text-rose-600', warn: 'text-amber-600' }[tone];
  return (
    <div className="bg-white rounded-2xl border border-wine-100/60 px-4 py-4 shadow-sm min-w-0">
      <p className="text-xs text-ink/40 uppercase tracking-wide font-medium mb-1">{label}</p>
      <p className={`font-display text-xl sm:text-2xl tabular-nums leading-none font-semibold ${cls}`}>{value}</p>
      {hint && <p className="text-xs text-ink/40 mt-1.5">{hint}</p>}
    </div>
  );
}

const BADGE: Record<string, string> = {
  neutral: 'bg-gray-100 text-gray-600', good: 'bg-emerald-100 text-emerald-700', bad: 'bg-rose-100 text-rose-700',
  warn: 'bg-amber-100 text-amber-700', info: 'bg-sky-100 text-sky-700', wine: 'bg-wine-100 text-wine-700',
};
export function Badge({ tone = 'neutral', children }: { tone?: keyof typeof BADGE; children: ReactNode }) {
  return <span className={`text-xs rounded-full px-2 py-0.5 font-medium whitespace-nowrap ${BADGE[tone]}`}>{children}</span>;
}

export function Modal({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-3 bg-ink/50" onClick={onClose} role="dialog" aria-modal="true" aria-label={title}>
      <ModalA11y onClose={onClose} />
      <div className={`bg-white rounded-2xl w-full ${wide ? 'max-w-2xl' : 'max-w-md'} shadow-xl max-h-[92vh] overflow-y-auto`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-wine-50 sticky top-0 bg-white z-10">
          <h2 className="font-display text-xl text-wine-800">{title}</h2>
          <button onClick={onClose} aria-label="Fechar" className="p-1.5 rounded-lg hover:bg-wine-50 text-ink/40 hover:text-ink/70 text-lg leading-none">×</button>
        </div>
        <div className="p-5 space-y-4">{children}</div>
      </div>
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-ink/50 uppercase tracking-wide mb-1.5">{label}</span>
      {children}
      {hint && <span className="block text-xs text-ink/40 mt-1">{hint}</span>}
    </label>
  );
}

const ACTION_LABEL: Record<string, string> = {
  payment_create: 'Recebimento registrado', payment_refund: 'Estorno registrado', expense_create: 'Despesa criada', expense_update: 'Despesa alterada',
  expense_status: 'Situação da despesa alterada', expense_delete: 'Despesa excluída', expense_payment_create: 'Pagamento de despesa registrado',
  appointment_checkin: 'Check-in', appointment_final_price: 'Valor final alterado', appointment_review: 'Revisão do atendimento',
  cash_close: 'Caixa fechado', cash_reopen: 'Caixa reaberto', correction: 'Correção',
};

/** Histórico automático (financial_audit_log) de uma movimentação/entidade. `path` vem pronto da API (historicoPath). */
export function HistoryModal({ path, title, onClose }: { path: string; title: string; onClose: () => void }) {
  const { data, error, loading, status, reload } = useLoad(() => financeiro.history(path), [path]);
  return (
    <Modal title={title} onClose={onClose}>
      {loading ? <Loading lines={2} /> : error ? <ErrorBox message={error} status={status} onRetry={reload} /> : !data?.historico.length ? (
        <p className="text-sm text-ink/50">Sem registros de histórico (movimentação anterior ao histórico automático).</p>
      ) : (
        <ol className="space-y-3">
          {data.historico.map((h: HistoryItem) => (
            <li key={h.seq} className="border-l-2 border-wine-200 pl-3">
              <p className="text-sm font-medium text-ink">{ACTION_LABEL[h.action] ?? h.action}</p>
              <p className="text-xs text-ink/50">{formatDateTimeBR(h.createdAt)}{h.actorId ? ' · por você' : ''}</p>
              {h.reason && <p className="text-sm text-ink/70 mt-1">Motivo: {h.reason}</p>}
              <HistoryValues before={h.before} after={h.after} />
            </li>
          ))}
        </ol>
      )}
    </Modal>
  );
}

const VALUE_KEY: Record<string, string> = {
  amount_cents: 'Valor', method: 'Método', occurred_on: 'Data', paid_on: 'Data do pagamento', payment_status: 'Situação', due_on: 'Vencimento',
  status: 'Situação', received_cents: 'Recebido', refunded_cents: 'Estornado', expenses_paid_cents: 'Despesas pagas', final_price_cents: 'Valor final',
};
const STATUS_LABEL: Record<string, string> = { a_revisar: 'A revisar', pendente: 'Pendente', paga: 'Paga', fechado: 'Fechado', aberto: 'Aberto' };
function histValue(k: string, v: unknown): string {
  if (k.endsWith('_cents')) return formatBRL(Number(v));
  if (/_on$/.test(k) && typeof v === 'string') return formatDateBR(v);
  if (k === 'method') return methodLabel(String(v));
  if ((k === 'payment_status' || k === 'status') && typeof v === 'string') return STATUS_LABEL[v] ?? v;
  return String(v);
}
function HistoryValues({ before, after }: { before: unknown; after: unknown }) {
  const fmt = (o: unknown) => {
    if (!o || typeof o !== 'object') return null;
    const parts = Object.entries(o as Record<string, unknown>).filter(([k, v]) => VALUE_KEY[k] && v != null)
      .map(([k, v]) => `${VALUE_KEY[k]}: ${histValue(k, v)}`);
    return parts.length ? parts.join(' · ') : null;
  };
  const b = fmt(before);
  const a = fmt(after);
  if (!b && !a) return null;
  return (
    <p className="text-xs text-ink/50 mt-1">
      {b && <>Antes: {b}<br /></>}
      {a && <>Depois: {a}</>}
    </p>
  );
}

/** Controla envio único: ignora cliques enquanto uma operação está em andamento. */
export function useBusy() {
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const run = useCallback(async (fn: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try { await fn(); } finally { lock.current = false; setBusy(false); }
  }, []);
  return { busy, run };
}
