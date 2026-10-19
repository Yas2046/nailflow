// Financeiro de UM atendimento: valor, recebido, saldo, movimentações, registrar recebimento e estornar. Tudo calculado e validado pela API.
import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useToast } from '../../context/ToastContext';
import { financeiro, newIdempotencyKey, PAYMENT_METHODS, type AppointmentFinance, type PaymentMethod, type PaymentRow } from '../../services/financeiro';
import { formatBRL, formatDateBR, formatDateTimeBR, methodLabel, parseBRLToCents, centsToInput, todayBR } from '../../utils/money';
import { Badge, ErrorBox, Field, HistoryModal, Loading, Modal, errMsg, useBusy, useLoad } from './ui';

export function agendaLink(appointmentId: string, isoInstant: string | null | undefined, dateInTz: (s: string) => string): string {
  const day = isoInstant ? dateInTz(isoInstant) : '';
  return `/agenda?${day ? `data=${day}&` : ''}abrir=${appointmentId}`;
}

export default function AtendimentoFinanceiro({ appointmentId, startsAt, title, onClose, onChanged }: {
  appointmentId: string; startsAt?: string | null; title: string; onClose: () => void; onChanged: () => void;
}) {
  const { toast } = useToast();
  const { data, error, status, loading, reload } = useLoad(() => financeiro.appointment(appointmentId), [appointmentId]);
  const [summary, setSummary] = useState<AppointmentFinance | null>(null);
  const cur = summary ?? data;
  const [hist, setHist] = useState<string | null>(null);
  const [refunding, setRefunding] = useState<PaymentRow | null>(null);
  const [correcting, setCorrecting] = useState<PaymentRow | null>(null);

  // recebimento
  const key = useRef(newIdempotencyKey());
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('pix');
  const [day, setDay] = useState(todayBR());
  const [notes, setNotes] = useState('');
  const { busy, run } = useBusy();
  const touch = () => { key.current = newIdempotencyKey(); };

  async function receive() {
    const cents = parseBRLToCents(amount);
    if (!cents) { toast('Informe um valor válido.', 'error'); return; }
    await run(async () => {
      try {
        const r = await financeiro.receive(appointmentId, key.current, { amountCents: cents, method, occurredOn: day, notes: notes.trim() || undefined });
        setSummary(r.resumo); setAmount(''); setNotes(''); key.current = newIdempotencyKey();
        toast(r.replayed ? 'Este recebimento já estava registrado.' : 'Recebimento registrado.');
        onChanged();
      } catch (e) { toast(errMsg(e), 'error'); }
    });
  }

  return (
    <Modal title={title} onClose={onClose} wide>
      {loading && !cur ? <Loading /> : error && !cur ? <ErrorBox message={error} status={status} onRetry={reload} /> : cur && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <Info label={cur.valueBasis === 'final' ? 'Valor final' : 'Valor do serviço'} value={formatBRL(cur.valueCents)} />
            <Info label="Recebido (líquido)" value={formatBRL(cur.netReceivedCents)} />
            <Info label="Estornado" value={formatBRL(cur.refundedCents)} />
            <Info label="Saldo" value={formatBRL(cur.balanceCents)} strong />
          </div>
          {cur.status !== 'concluido' && <p className="text-sm text-amber-700 bg-amber-50 rounded-lg p-3">Só é possível registrar recebimento de atendimento concluído.</p>}
          <Link className="text-sm text-wine-700 underline" to={agendaLink(appointmentId, startsAt, (s) => new Date(s).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }))}>Abrir na Agenda</Link>

          {cur.status === 'concluido' && <FinalPrice cur={cur} id={appointmentId} onDone={(r) => { setSummary(r); onChanged(); }} />}

          <div>
            <h3 className="text-xs font-medium text-ink/50 uppercase tracking-wide mb-2">Movimentações</h3>
            {cur.movimentacoes.length === 0 ? <p className="text-sm text-ink/50">Nenhum recebimento registrado. O atendimento concluído não é tratado como pago.</p> : (
              <ul className="divide-y divide-wine-50">
                {cur.movimentacoes.map((m) => (
                  <li key={m.id} className="py-2.5 flex flex-wrap items-center gap-2 justify-between">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">
                        {m.kind === 'recebimento' ? 'Recebimento' : 'Estorno'} · {methodLabel(m.method)} <span className="text-ink/40 font-normal">em {formatDateBR(m.occurredOn)}</span>
                      </p>
                      {m.notes && <p className="text-xs text-ink/50">{m.notes}</p>}
                      {m.kind === 'recebimento' && (m.refundedCents ?? 0) > 0 && <p className="text-xs text-ink/50">Estornado: {formatBRL(m.refundedCents)}</p>}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`tabular-nums font-semibold ${m.kind === 'estorno' ? 'text-rose-600' : 'text-ink'}`}>{m.kind === 'estorno' ? '−' : ''}{formatBRL(m.amountCents)}</span>
                      <button className="btn-ghost" onClick={() => setHist(`/financeiro/historico/payment/${m.id}`)}>Histórico</button>
                      {m.kind === 'recebimento' && (m.remainingCents ?? 0) > 0 && <button className="btn-ghost" onClick={() => setCorrecting(m)}>Corrigir</button>}
                      {m.kind === 'recebimento' && (m.remainingCents ?? 0) > 0 && <button className="btn-ghost text-rose-600" onClick={() => setRefunding(m)}>Estornar</button>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {cur.canReceive && cur.balanceCents > 0 && (
            <div className="border-t border-wine-50 pt-4 space-y-3">
              <h3 className="text-xs font-medium text-ink/50 uppercase tracking-wide">Registrar recebimento</h3>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Valor (R$)" hint={`Saldo: ${formatBRL(cur.balanceCents)}`}>
                  <input className="input" inputMode="decimal" placeholder="0,00" value={amount} onChange={(e) => { setAmount(e.target.value); touch(); }} />
                </Field>
                <Field label="Método">
                  <select className="input" value={method} onChange={(e) => { setMethod(e.target.value as PaymentMethod); touch(); }}>
                    {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{methodLabel(m)}</option>)}
                  </select>
                </Field>
                <Field label="Data do recebimento">
                  <input type="date" className="input" max={todayBR()} value={day} onChange={(e) => { setDay(e.target.value); touch(); }} />
                </Field>
                <Field label="Observação (opcional)">
                  <input className="input" maxLength={300} value={notes} onChange={(e) => { setNotes(e.target.value); touch(); }} />
                </Field>
              </div>
              <div className="flex gap-2">
                <button className="btn-secondary" type="button" onClick={() => { setAmount(centsToInput(cur.balanceCents)); touch(); }}>Usar o saldo</button>
                <button className="btn-primary flex-1" disabled={busy} onClick={receive}>{busy ? 'Registrando…' : 'Registrar recebimento'}</button>
              </div>
            </div>
          )}
        </>
      )}
      {hist && <HistoryModal path={hist} title="Histórico da movimentação" onClose={() => setHist(null)} />}
      {correcting && (
        <CorrectModal payment={correcting} onClose={() => setCorrecting(null)} onDone={(r) => { setSummary(r); setCorrecting(null); onChanged(); }} />
      )}
      {refunding && (
        <RefundModal payment={refunding} onClose={() => setRefunding(null)} onDone={(r) => { setSummary(r); setRefunding(null); onChanged(); }} />
      )}
    </Modal>
  );
}

/** Valor final do atendimento concluído: definir/alterar com justificativa (a API exige quando difere do serviço ou altera um valor já definido). */
function FinalPrice({ cur, id, onDone }: { cur: AppointmentFinance; id: string; onDone: (r: AppointmentFinance) => void }) {
  const { toast } = useToast();
  const { busy, run } = useBusy();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(centsToInput(cur.valueCents));
  const [reason, setReason] = useState('');
  async function submit() {
    const cents = parseBRLToCents(value, { allowZero: true });
    if (cents == null) { toast('Informe um valor válido.', 'error'); return; }
    await run(async () => {
      try {
        const r = await financeiro.setFinalPrice(id, { finalPriceCents: cents, ...(reason.trim() ? { reason: reason.trim() } : {}) });
        toast(r.changed ? 'Valor final registrado.' : 'O valor já era esse.');
        setOpen(false); setReason('');
        onDone(r.resumo);
      } catch (e) { toast(errMsg(e), 'error'); }
    });
  }
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-medium text-ink/50 uppercase tracking-wide">Valor final</h3>
        {!open && <button className="btn-ghost" onClick={() => setOpen(true)}>{cur.finalPriceCents == null ? 'Definir valor final' : 'Alterar valor final'}</button>}
      </div>
      {open && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Valor final (R$)" hint="Nunca abaixo do que já foi recebido (líquido)."><input className="input" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} /></Field>
          <Field label="Justificativa" hint="Obrigatória se diferir do valor do serviço ou alterar um valor final já definido."><input className="input" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
          <div className="sm:col-span-2 flex gap-2"><button className="btn-secondary" onClick={() => setOpen(false)}>Cancelar</button><button className="btn-primary" disabled={busy} onClick={submit}>{busy ? 'Salvando…' : 'Salvar valor final'}</button></div>
        </div>
      )}
      {!!cur.finalPriceHistory?.length && (
        <ul className="text-xs text-ink/60 space-y-0.5">
          {cur.finalPriceHistory.map((h, i) => <li key={i}>{formatDateTimeBR(h.at)}: {h.fromCents == null ? 'definido' : `de ${formatBRL(h.fromCents)}`} {h.toCents != null ? `para ${formatBRL(h.toCents)}` : ''}{h.reason ? ` — ${h.reason}` : ''}</li>)}
        </ul>
      )}
    </div>
  );
}

/** Correção de um recebimento lançado errado: estorna o saldo dele e registra o recebimento correto numa só operação (API). */
function CorrectModal({ payment, onClose, onDone }: { payment: PaymentRow; onClose: () => void; onDone: (r: AppointmentFinance) => void }) {
  const { toast } = useToast();
  const key = useRef(newIdempotencyKey());
  const touch = () => { key.current = newIdempotencyKey(); };
  const { busy, run } = useBusy();
  const [reason, setReason] = useState('');
  const [refundDay, setRefundDay] = useState(todayBR());
  const [amount, setAmount] = useState(centsToInput(payment.remainingCents ?? payment.amountCents));
  const [method, setMethod] = useState<PaymentMethod>(payment.method as PaymentMethod);
  const [newDay, setNewDay] = useState(todayBR());
  const [notes, setNotes] = useState('');
  async function submit() {
    const cents = parseBRLToCents(amount);
    if (!cents) { toast('Informe o valor correto.', 'error'); return; }
    if (reason.trim().length < 3) { toast('Informe o motivo da correção (mínimo 3 caracteres).', 'error'); return; }
    await run(async () => {
      try {
        const r = await financeiro.correct(payment.id, key.current, { reason: reason.trim(), occurredOn: refundDay, novo: { amountCents: cents, method, occurredOn: newDay, ...(notes.trim() ? { notes: notes.trim() } : {}) } });
        toast(r.replayed ? 'Esta correção já estava registrada.' : 'Correção registrada.');
        onDone(r.resumo);
      } catch (e) { toast(errMsg(e), 'error'); }
    });
  }
  return (
    <Modal title="Corrigir recebimento" onClose={onClose}>
      <p className="text-sm text-ink/60">Recebimento de {formatBRL(payment.amountCents)} ({methodLabel(payment.method)}) em {formatDateBR(payment.occurredOn)}. A correção estorna o saldo dele ({formatBRL(payment.remainingCents ?? payment.amountCents)}) e registra o recebimento correto. Nada é apagado ou alterado: os dois lançamentos entram nas datas informadas e ficam no histórico. Se alguma dessas datas estiver em dia fechado, será preciso reabrir o caixa.</p>
      <Field label="Motivo da correção *"><input className="input" maxLength={300} value={reason} onChange={(e) => { setReason(e.target.value); touch(); }} /></Field>
      <Field label="Data do estorno"><input type="date" className="input" min={payment.occurredOn} max={todayBR()} value={refundDay} onChange={(e) => { setRefundDay(e.target.value); touch(); }} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Valor correto (R$)"><input className="input" inputMode="decimal" value={amount} onChange={(e) => { setAmount(e.target.value); touch(); }} /></Field>
        <Field label="Método correto"><select className="input" value={method} onChange={(e) => { setMethod(e.target.value as PaymentMethod); touch(); }}>{PAYMENT_METHODS.map((m) => <option key={m} value={m}>{methodLabel(m)}</option>)}</select></Field>
      </div>
      <Field label="Data do novo recebimento"><input type="date" className="input" max={todayBR()} value={newDay} onChange={(e) => { setNewDay(e.target.value); touch(); }} /></Field>
      <Field label="Observação (opcional)"><input className="input" maxLength={300} value={notes} onChange={(e) => { setNotes(e.target.value); touch(); }} /></Field>
      <div className="flex gap-3"><button className="btn-secondary flex-1" onClick={onClose}>Cancelar</button><button className="btn-primary flex-1" disabled={busy} onClick={submit}>{busy ? 'Registrando…' : 'Registrar correção'}</button></div>
    </Modal>
  );
}

const Info = ({ label, value, strong }: { label: string; value: string; strong?: boolean }) => (
  <div className="bg-wine-50/60 rounded-xl p-3"><p className="text-xs text-ink/50">{label}</p><p className={`tabular-nums ${strong ? 'font-bold text-wine-700' : 'font-semibold'}`}>{value}</p></div>
);

function RefundModal({ payment, onClose, onDone }: { payment: PaymentRow; onClose: () => void; onDone: (r: AppointmentFinance) => void }) {
  const { toast } = useToast();
  const key = useRef(newIdempotencyKey());
  const [amount, setAmount] = useState(centsToInput(payment.remainingCents ?? payment.amountCents));
  const [day, setDay] = useState(todayBR());
  const [reason, setReason] = useState('');
  const { busy, run } = useBusy();
  const touch = () => { key.current = newIdempotencyKey(); };
  async function submit() {
    const cents = parseBRLToCents(amount);
    if (!cents) { toast('Informe um valor válido.', 'error'); return; }
    if (reason.trim().length < 3) { toast('Informe o motivo (mínimo 3 caracteres).', 'error'); return; }
    await run(async () => {
      try {
        const r = await financeiro.refund(payment.id, key.current, { amountCents: cents, occurredOn: day, reason: reason.trim() });
        toast('Estorno registrado.');
        onDone(r.resumo);
      } catch (e) { toast(errMsg(e), 'error'); }
    });
  }
  return (
    <Modal title="Estornar recebimento" onClose={onClose}>
      <p className="text-sm text-ink/60">Recebimento de {formatBRL(payment.amountCents)} ({methodLabel(payment.method)}) em {formatDateBR(payment.occurredOn)}. O recebimento original não é alterado: o estorno é um novo lançamento, na data em que ocorreu. Se o dia dessa data estiver fechado no caixa, será preciso reabri-lo.</p>
      <Field label="Valor do estorno (R$)" hint={`Ainda estornável: ${formatBRL(payment.remainingCents ?? payment.amountCents)}`}>
        <input className="input" inputMode="decimal" value={amount} onChange={(e) => { setAmount(e.target.value); touch(); }} />
      </Field>
      <Field label="Data em que o estorno ocorreu">
        <input type="date" className="input" min={payment.occurredOn} max={todayBR()} value={day} onChange={(e) => { setDay(e.target.value); touch(); }} />
      </Field>
      <Field label="Motivo *"><input className="input" maxLength={300} value={reason} onChange={(e) => { setReason(e.target.value); touch(); }} /></Field>
      <div className="flex gap-3">
        <button className="btn-secondary flex-1" onClick={onClose}>Cancelar</button>
        <button className="btn-primary flex-1" disabled={busy} onClick={submit}>{busy ? 'Registrando…' : 'Confirmar estorno'}</button>
      </div>
      <Badge tone="warn">Estorno não pode ser desfeito; correções entram como novos lançamentos.</Badge>
    </Modal>
  );
}
