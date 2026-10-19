// Despesas: cadastro, revisão manual de registros antigos, vencimento, pagamentos parciais/quitação e histórico.
// Reaproveita /expenses (Gastos) para cadastrar/editar/excluir e /financeiro/despesas para situação e pagamentos. Estados e saldos vêm da API.
import { useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useToast } from '../../context/ToastContext';
import { EXPENSE_METHODS, financeiro, newIdempotencyKey, type DespesaDetail, type DespesaItem, type ExpenseState } from '../../services/financeiro';
import { centsToInput, formatBRL, formatDateBR, methodLabel, parseBRLToCents, todayBR } from '../../utils/money';
import { Badge, Card, Empty, ErrorBox, Field, HistoryModal, Loading, Modal, Stat, errMsg, useBusy, useLoad } from './ui';

const CATEGORIES = ['Aluguel', 'Materiais', 'Energia', 'Água', 'Internet', 'Telefone', 'Marketing', 'Higiene', 'Equipamento', 'Outros'];
const STATE_LABEL: Record<ExpenseState, string> = { a_revisar: 'A revisar', pendente: 'Pendente', vencida: 'Vencida', paga: 'Paga' };
const STATE_TONE: Record<ExpenseState, 'warn' | 'info' | 'bad' | 'good'> = { a_revisar: 'warn', pendente: 'info', vencida: 'bad', paga: 'good' };

export default function Despesas() {
  const [params] = useSearchParams();
  const fromUrl = params.get('situacao');
  const [filtro, setFiltro] = useState<'' | ExpenseState>(fromUrl && ['a_revisar', 'pendente', 'vencida', 'paga'].includes(fromUrl) ? (fromUrl as ExpenseState) : '');
  const { data, error, status, loading, reload } = useLoad(() => financeiro.despesas({ situacao: filtro }), [filtro]);
  const [form, setForm] = useState<DespesaItem | 'new' | null>(null);
  const [review, setReview] = useState<DespesaItem | null>(null);
  const [pay, setPay] = useState<DespesaItem | null>(null);
  const [due, setDue] = useState<DespesaItem | null>(null);
  const [detail, setDetail] = useState<DespesaItem | null>(null);
  const [del, setDel] = useState<DespesaItem | null>(null);

  const t = data?.totais;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {([['', 'Todas'], ['a_revisar', 'A revisar'], ['pendente', 'Pendentes'], ['vencida', 'Vencidas'], ['paga', 'Pagas']] as const).map(([v, l]) => (
            <button key={v} onClick={() => setFiltro(v)} className={`px-3 py-1.5 rounded-lg text-sm font-medium ${filtro === v ? 'bg-wine-600 text-white' : 'bg-wine-50 text-wine-700 hover:bg-wine-100'}`}>{l}</button>
          ))}
        </div>
        <button className="btn-primary" onClick={() => setForm('new')}>+ Nova despesa</button>
      </div>

      {t && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Stat label="A revisar" value={`${t.a_revisar.count}`} tone="warn" hint={formatBRL(t.a_revisar.amountCents)} />
          <Stat label="Pendentes" value={formatBRL(t.pendente.remainingCents)} hint={`${t.pendente.count} despesa(s) · saldo`} />
          <Stat label="Vencidas" value={formatBRL(t.vencida.remainingCents)} tone="bad" hint={`${t.vencida.count} despesa(s) · saldo`} />
          <Stat label="Pagas" value={formatBRL(t.paga.paidCents)} tone="good" hint={`${t.paga.count} despesa(s)`} />
        </div>
      )}
      {t && t.a_revisar.count > 0 && <p className="text-sm text-amber-700 bg-amber-50 rounded-lg p-3">Despesas antigas ficam <strong>a revisar</strong>: o sistema não presume que foram pagas. Abra cada uma e informe se está pendente ou já foi paga.</p>}

      {loading && !data ? <Loading /> : error ? <ErrorBox message={error} status={status} onRetry={reload} /> : data && (data.despesas.length === 0 ? <Empty>Nenhuma despesa nesta visão.</Empty> : (
        <Card className="divide-y divide-wine-50">
          {data.despesas.map((d) => (
            <div key={d.id} className="p-4 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-ink truncate">{d.description}</span>
                    <Badge tone={STATE_TONE[d.state]}>{STATE_LABEL[d.state]}</Badge>
                    <Badge>{d.category}</Badge>
                    {d.legacyPaid && <Badge tone="warn">Paga (registro antigo, sem lançamentos)</Badge>}
                  </div>
                  <p className="text-xs text-ink/50 mt-0.5">
                    Lançada em {formatDateBR(d.expenseDate)}{d.dueOn ? ` · vence em ${formatDateBR(d.dueOn)}` : ''}{d.paidOn ? ` · paga em ${formatDateBR(d.paidOn)}${d.legacyPaid && !d.paidMethod ? ' (método não informado)' : d.paidMethod ? ` (${methodLabel(d.paidMethod)})` : ''}` : ''}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-bold tabular-nums text-wine-700">{formatBRL(d.amountCents)}</p>
                  {(d.state === 'pendente' || d.state === 'vencida') && d.paidCents > 0 && <p className="text-xs text-ink/50">Pago {formatBRL(d.paidCents)} · resta {formatBRL(d.remainingCents)}</p>}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {d.state === 'a_revisar' && <button className="btn-primary" onClick={() => setReview(d)}>Revisar</button>}
                {(d.state === 'pendente' || d.state === 'vencida') && <>
                  <button className="btn-primary" onClick={() => setPay(d)}>Registrar pagamento</button>
                  <button className="btn-secondary" onClick={() => setDue(d)}>Vencimento</button>
                </>}
                <button className="btn-ghost" onClick={() => setDetail(d)}>Detalhes e histórico</button>
                <button className="btn-ghost" onClick={() => setForm(d)}>Editar</button>
                {d.state !== 'paga' && d.paymentsCount === 0 && <button className="btn-ghost text-rose-600" onClick={() => setDel(d)}>Excluir</button>}
              </div>
            </div>
          ))}
        </Card>
      ))}

      {form && <ExpenseForm expense={form === 'new' ? null : form} onClose={() => setForm(null)} onSaved={() => { setForm(null); reload(); }} />}
      {review && <ReviewModal d={review} onClose={() => setReview(null)} onDone={() => { setReview(null); reload(); }} />}
      {pay && <PayModal d={pay} onClose={() => setPay(null)} onDone={() => { setPay(null); reload(); }} />}
      {due && <DueModal d={due} onClose={() => setDue(null)} onDone={() => { setDue(null); reload(); }} />}
      {detail && <DetailModal id={detail.id} onClose={() => setDetail(null)} />}
      {del && <DeleteModal d={del} onClose={() => setDel(null)} onDone={() => { setDel(null); reload(); }} />}
    </div>
  );
}

// ── cadastro / edição (rotas de Gastos) ────────────────────────────────────
function ExpenseForm({ expense, onClose, onSaved }: { expense: DespesaItem | null; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const { busy, run } = useBusy();
  const [description, setDescription] = useState(expense?.description ?? '');
  const [category, setCategory] = useState(expense?.category ?? 'Outros');
  const [amount, setAmount] = useState(expense ? centsToInput(expense.amountCents) : '');
  const [day, setDay] = useState(expense?.expenseDate ?? todayBR());
  const [notes, setNotes] = useState(expense?.notes ?? '');
  const [situ, setSitu] = useState<'a_revisar' | 'pendente' | 'paga'>('pendente');
  const [dueOn, setDueOn] = useState('');
  const [paidOn, setPaidOn] = useState(todayBR());
  const [method, setMethod] = useState('pix');

  async function save() {
    const cents = parseBRLToCents(amount);
    if (!description.trim()) { toast('Informe a descrição.', 'error'); return; }
    if (!cents) { toast('Informe um valor válido.', 'error'); return; }
    await run(async () => {
      const body = { description: description.trim(), category, amount_cents: cents, expense_date: day, notes: notes.trim() || null };
      try {
        if (expense) { await financeiro.updateExpense(expense.id, body); toast('Despesa atualizada.'); onSaved(); return; }
        // Atômico: a despesa e a situação inicial são gravadas juntas; se algo falhar, nada é criado.
        await financeiro.createDespesa({
          description: body.description, category, amountCents: cents, expenseDate: day, notes: body.notes,
          situacao: situ === 'pendente' ? { to: 'pendente', ...(dueOn ? { dueOn } : {}) } : situ === 'paga' ? { to: 'paga', paidOn, method } : { to: 'a_revisar' },
        });
        toast('Despesa cadastrada.');
        onSaved();
      } catch (e) { toast(errMsg(e), 'error'); }
    });
  }
  return (
    <Modal title={expense ? 'Editar despesa' : 'Nova despesa'} onClose={onClose}>
      <Field label="Descrição *"><input className="input" maxLength={200} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Categoria"><select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></Field>
        <Field label="Valor (R$) *"><input className="input" inputMode="decimal" placeholder="0,00" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
      </div>
      <Field label="Data da despesa *"><input type="date" className="input" value={day} onChange={(e) => setDay(e.target.value)} /></Field>
      <Field label="Observações (opcional)"><input className="input" maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      {expense && <p className="text-xs text-ink/50">Para alterar situação, vencimento ou pagamentos use as ações da despesa. O valor não pode ficar abaixo do já pago.</p>}
      {!expense && (
        <div className="space-y-3 border-t border-wine-50 pt-3">
          <Field label="Situação">
            <select className="input" value={situ} onChange={(e) => setSitu(e.target.value as typeof situ)}>
              <option value="pendente">Pendente (a pagar)</option><option value="paga">Já paga</option><option value="a_revisar">Deixar a revisar</option>
            </select>
          </Field>
          {situ === 'pendente' && <Field label="Vencimento (opcional)"><input type="date" className="input" value={dueOn} onChange={(e) => setDueOn(e.target.value)} /></Field>}
          {situ === 'paga' && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Pago em"><input type="date" className="input" max={todayBR()} value={paidOn} onChange={(e) => setPaidOn(e.target.value)} /></Field>
              <Field label="Método"><select className="input" value={method} onChange={(e) => setMethod(e.target.value)}>{EXPENSE_METHODS.map((m) => <option key={m} value={m}>{methodLabel(m)}</option>)}</select></Field>
            </div>
          )}
        </div>
      )}
      <div className="flex gap-3"><button className="btn-secondary flex-1" onClick={onClose}>Cancelar</button><button className="btn-primary flex-1" disabled={busy} onClick={save}>{busy ? 'Salvando…' : 'Salvar'}</button></div>
    </Modal>
  );
}

// ── revisão manual ─────────────────────────────────────────────────────────
function ReviewModal({ d, onClose, onDone }: { d: DespesaItem; onClose: () => void; onDone: () => void }) {
  const { toast } = useToast();
  const { busy, run } = useBusy();
  const [to, setTo] = useState<'pendente' | 'paga'>('pendente');
  const [dueOn, setDueOn] = useState('');
  const [paidOn, setPaidOn] = useState(todayBR());
  const [method, setMethod] = useState('pix');
  const [reason, setReason] = useState('');
  async function submit() {
    if (to === 'paga' && reason.trim().length < 3) { toast('Informe como você confirmou o pagamento (motivo, mínimo 3 caracteres).', 'error'); return; }
    await run(async () => {
      try {
        await financeiro.reviewDespesa(d.id, to === 'pendente' ? { to, ...(dueOn ? { dueOn } : {}), ...(reason.trim() ? { reason: reason.trim() } : {}) } : { to, paidOn, method, reason: reason.trim() });
        toast('Despesa revisada.');
        onDone();
      } catch (e) { toast(errMsg(e), 'error'); }
    });
  }
  return (
    <Modal title="Revisar despesa" onClose={onClose}>
      <p className="text-sm text-ink/60"><strong>{d.description}</strong> · {formatBRL(d.amountCents)}. Esta despesa é anterior ao controle de pagamentos e ainda não foi classificada. A revisão é feita uma única vez e fica no histórico.</p>
      <Field label="Situação real">
        <select className="input" value={to} onChange={(e) => setTo(e.target.value as typeof to)}><option value="pendente">Ainda não foi paga (pendente)</option><option value="paga">Já foi paga (valor total)</option></select>
      </Field>
      {to === 'pendente' ? <Field label="Vencimento (opcional)"><input type="date" className="input" value={dueOn} onChange={(e) => setDueOn(e.target.value)} /></Field> : (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Pago em"><input type="date" className="input" max={todayBR()} value={paidOn} onChange={(e) => setPaidOn(e.target.value)} /></Field>
          <Field label="Método"><select className="input" value={method} onChange={(e) => setMethod(e.target.value)}>{EXPENSE_METHODS.map((m) => <option key={m} value={m}>{methodLabel(m)}</option>)}</select></Field>
        </div>
      )}
      <Field label={to === 'paga' ? 'Motivo / como confirmou *' : 'Motivo (opcional)'}><input className="input" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex.: conferi o comprovante" /></Field>
      <div className="flex gap-3"><button className="btn-secondary flex-1" onClick={onClose}>Cancelar</button><button className="btn-primary flex-1" disabled={busy} onClick={submit}>{busy ? 'Salvando…' : 'Confirmar revisão'}</button></div>
    </Modal>
  );
}

// ── pagamento (parcial ou total) ───────────────────────────────────────────
function PayModal({ d, onClose, onDone }: { d: DespesaItem; onClose: () => void; onDone: () => void }) {
  const { toast } = useToast();
  const { busy, run } = useBusy();
  const key = useRef(newIdempotencyKey());
  const touch = () => { key.current = newIdempotencyKey(); };
  const [amount, setAmount] = useState(centsToInput(d.remainingCents));
  const [method, setMethod] = useState('pix');
  const [day, setDay] = useState(todayBR());
  const [notes, setNotes] = useState('');
  async function submit() {
    const cents = parseBRLToCents(amount);
    if (!cents) { toast('Informe um valor válido.', 'error'); return; }
    await run(async () => {
      try {
        const r = await financeiro.payDespesa(d.id, key.current, { amountCents: cents, method, paidOn: day, notes: notes.trim() || undefined });
        toast(r.replayed ? 'Este pagamento já estava registrado.' : r.despesa.state === 'paga' ? 'Pagamento registrado: despesa quitada.' : 'Pagamento parcial registrado.');
        onDone();
      } catch (e) { toast(errMsg(e), 'error'); }
    });
  }
  return (
    <Modal title="Registrar pagamento" onClose={onClose}>
      <p className="text-sm text-ink/60"><strong>{d.description}</strong> · total {formatBRL(d.amountCents)} · já pago {formatBRL(d.paidCents)} · <strong>saldo {formatBRL(d.remainingCents)}</strong>. Pagamentos não podem ser apagados; pagamento parcial mantém a despesa pendente.</p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Valor pago (R$)"><input className="input" inputMode="decimal" value={amount} onChange={(e) => { setAmount(e.target.value); touch(); }} /></Field>
        <Field label="Método"><select className="input" value={method} onChange={(e) => { setMethod(e.target.value); touch(); }}>{EXPENSE_METHODS.map((m) => <option key={m} value={m}>{methodLabel(m)}</option>)}</select></Field>
      </div>
      <Field label="Data do pagamento"><input type="date" className="input" max={todayBR()} value={day} onChange={(e) => { setDay(e.target.value); touch(); }} /></Field>
      <Field label="Observação (opcional)"><input className="input" maxLength={300} value={notes} onChange={(e) => { setNotes(e.target.value); touch(); }} /></Field>
      <div className="flex gap-3"><button className="btn-secondary flex-1" onClick={onClose}>Cancelar</button><button className="btn-primary flex-1" disabled={busy} onClick={submit}>{busy ? 'Registrando…' : 'Registrar'}</button></div>
    </Modal>
  );
}

function DueModal({ d, onClose, onDone }: { d: DespesaItem; onClose: () => void; onDone: () => void }) {
  const { toast } = useToast();
  const { busy, run } = useBusy();
  const [dueOn, setDueOn] = useState(d.dueOn ?? '');
  const [reason, setReason] = useState('');
  async function submit() {
    if (!dueOn) { toast('Informe a nova data.', 'error'); return; }
    if (reason.trim().length < 3) { toast('Informe o motivo (mínimo 3 caracteres).', 'error'); return; }
    await run(async () => {
      try { const r = await financeiro.setVencimento(d.id, { dueOn, reason: reason.trim() }); toast(r.changed ? 'Vencimento alterado.' : 'O vencimento já era esse.'); onDone(); } catch (e) { toast(errMsg(e), 'error'); }
    });
  }
  return (
    <Modal title="Alterar vencimento" onClose={onClose}>
      <p className="text-sm text-ink/60">{d.description} · vencimento atual: {d.dueOn ? formatDateBR(d.dueOn) : 'não definido'}</p>
      <Field label="Novo vencimento"><input type="date" className="input" value={dueOn} onChange={(e) => setDueOn(e.target.value)} /></Field>
      <Field label="Motivo *"><input className="input" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      <div className="flex gap-3"><button className="btn-secondary flex-1" onClick={onClose}>Cancelar</button><button className="btn-primary flex-1" disabled={busy} onClick={submit}>{busy ? 'Salvando…' : 'Salvar'}</button></div>
    </Modal>
  );
}

function DetailModal({ id, onClose }: { id: string; onClose: () => void }) {
  const { data, error, status, loading, reload } = useLoad<DespesaDetail>(() => financeiro.despesa(id), [id]);
  const [hist, setHist] = useState<string | null>(null);
  return (
    <Modal title="Detalhes da despesa" onClose={onClose} wide>
      {loading ? <Loading /> : error ? <ErrorBox message={error} status={status} onRetry={reload} /> : data && (
        <>
          <div className="flex items-center gap-2 flex-wrap"><span className="font-semibold">{data.description}</span><Badge tone={STATE_TONE[data.state]}>{STATE_LABEL[data.state]}</Badge></div>
          <p className="text-sm text-ink/60">Total {formatBRL(data.amountCents)} · pago {formatBRL(data.paidCents)} · saldo {formatBRL(data.remainingCents)}</p>
          {data.legacyPaid && <p className="text-sm text-amber-700 bg-amber-50 rounded-lg p-3">Registro antigo marcado como pago, sem lançamentos de pagamento{data.paidMethod ? '' : ' e sem método informado'}. O sistema não inventa dados que não existem.</p>}
          <h3 className="text-xs font-medium text-ink/50 uppercase tracking-wide">Pagamentos</h3>
          {data.pagamentos.length === 0 ? <p className="text-sm text-ink/50">Nenhum pagamento registrado.</p> : (
            <ul className="divide-y divide-wine-50">
              {data.pagamentos.map((p) => (
                <li key={p.id} className="py-2 flex items-center justify-between gap-2">
                  <span className="text-sm">{formatDateBR(p.paidOn)} · {methodLabel(p.method)}{p.notes ? ` · ${p.notes}` : ''}</span>
                  <span className="flex items-center gap-2"><span className="tabular-nums font-semibold">{formatBRL(p.amountCents)}</span><button className="btn-ghost" onClick={() => setHist(`/financeiro/historico/expense_payment/${p.id}`)}>Histórico</button></span>
                </li>
              ))}
            </ul>
          )}
          <button className="btn-secondary" onClick={() => setHist(`/financeiro/historico/expense/${data.id}`)}>Histórico da despesa</button>
        </>
      )}
      {hist && <HistoryModal path={hist} title="Histórico" onClose={() => setHist(null)} />}
    </Modal>
  );
}

function DeleteModal({ d, onClose, onDone }: { d: DespesaItem; onClose: () => void; onDone: () => void }) {
  const { toast } = useToast();
  const { busy, run } = useBusy();
  return (
    <Modal title="Excluir despesa" onClose={onClose}>
      <p className="text-sm text-ink/70">Excluir <strong>{d.description}</strong> ({formatBRL(d.amountCents)})? Só é possível enquanto não houver pagamento. A exclusão fica registrada no histórico.</p>
      <div className="flex gap-3">
        <button className="btn-secondary flex-1" onClick={onClose}>Cancelar</button>
        <button className="flex-1 px-4 py-2 rounded-lg bg-rose-600 text-white text-sm font-medium hover:bg-rose-700 disabled:opacity-55" disabled={busy}
          onClick={() => run(async () => { try { await financeiro.deleteExpense(d.id); toast('Despesa excluída.'); onDone(); } catch (e) { toast(errMsg(e), 'error'); } })}>{busy ? 'Excluindo…' : 'Excluir'}</button>
      </div>
    </Modal>
  );
}
