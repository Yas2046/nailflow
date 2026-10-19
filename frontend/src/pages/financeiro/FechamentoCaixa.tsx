// Fechamento de caixa: prévia por método (esperado calculado pela API), valores contados, divergência, justificativa, histórico e reabertura.
// A diferença mostrada aqui é só apresentação; a API recalcula e recusa fechamento com divergência sem justificativa.
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useToast } from '../../context/ToastContext';
import { ApiError } from '../../services/api';
import { financeiro, PAYMENT_METHODS, type CaixaDay, type CaixaMetodo, type CaixaVersion, type PaymentMethod } from '../../services/financeiro';
import { formatBRL, formatDateBR, formatDateTimeBR, methodLabel, parseBRLToCents, todayBR } from '../../utils/money';
import AtendimentoFinanceiro from './AtendimentoFinanceiro';
import { Badge, Card, Empty, ErrorBox, Field, HistoryModal, Loading, Modal, Stat, errMsg, useBusy, useLoad } from './ui';

const NOTE_OUTROS = 'Em "Outros" entram o método "outra", despesas pagas em boleto e despesas antigas pagas sem método informado (o método de registros antigos nunca é inventado).';

export default function FechamentoCaixa() {
  const { toast } = useToast();
  const [params] = useSearchParams();
  const fromUrl = params.get('data');
  const [date, setDate] = useState(fromUrl && /^\d{4}-\d{2}-\d{2}$/.test(fromUrl) && fromUrl <= todayBR() ? fromUrl : todayBR());
  const day = useLoad<CaixaDay>(() => financeiro.caixaDay(date), [date]);
  const list = useLoad(() => financeiro.caixaList(), []);
  const [counted, setCounted] = useState<Record<string, string>>({});
  const [justification, setJustification] = useState('');
  const [reopen, setReopen] = useState(false);
  const [showMov, setShowMov] = useState(false);
  const { busy, run } = useBusy();
  const [serverDiv, setServerDiv] = useState<string | null>(null);

  const d = day.data;
  const closed = d?.fechamento?.status === 'fechado';
  const parsed = Object.fromEntries(PAYMENT_METHODS.map((m) => [m, parseBRLToCents(counted[m] ?? '', { allowZero: true })])) as Record<PaymentMethod, number | null>;
  const allFilled = PAYMENT_METHODS.every((m) => parsed[m] != null);
  const diffs = d ? d.esperado.metodos.map((m) => (parsed[m.method] == null ? null : (parsed[m.method] as number) - m.expectedCents)) : [];
  const hasDiff = diffs.some((x) => x != null && x !== 0);

  function pick(next: string) { setDate(next); setCounted({}); setJustification(''); setServerDiv(null); setShowMov(false); }

  async function close() {
    if (!d || !allFilled) { toast('Informe o valor contado de todos os métodos (pode ser zero).', 'error'); return; }
    if (hasDiff && justification.trim().length < 3) { toast('Há diferença: informe a justificativa.', 'error'); return; }
    await run(async () => {
      try {
        await financeiro.closeCaixa(date, { counted: parsed as Record<PaymentMethod, number>, ...(justification.trim() ? { justification: justification.trim() } : {}) });
        toast('Caixa fechado.');
        setCounted({}); setJustification(''); setServerDiv(null);
        day.reload(); list.reload();
      } catch (e) {
        if (e instanceof ApiError && e.reason === 'justification_required') setServerDiv(e.message);
        toast(errMsg(e), 'error');
        if (e instanceof ApiError && (e.reason === 'already_closed')) day.reload();
      }
    });
  }

  return (
    <div className="space-y-5">
      <Card className="p-4 flex flex-wrap items-end gap-3">
        <Field label="Dia do caixa"><input type="date" className="input" max={todayBR()} value={date} onChange={(e) => e.target.value && pick(e.target.value)} /></Field>
        <button className="btn-secondary" onClick={() => pick(todayBR())}>Hoje</button>
        {d?.fechamento && <Badge tone={closed ? 'good' : 'warn'}>{closed ? 'Fechado' : 'Reaberto (aguardando novo fechamento)'}</Badge>}
        {!d?.fechamento && d && <Badge tone="neutral">Ainda não fechado</Badge>}
      </Card>

      {day.loading && !d ? <Loading /> : day.error ? <ErrorBox message={day.error} status={day.status} onRetry={day.reload} /> : d && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Stat label="Recebido" value={formatBRL(d.esperado.totais.receivedCents)} />
            <Stat label="Estornado" value={formatBRL(d.esperado.totais.refundedCents)} tone="bad" />
            <Stat label="Despesas pagas" value={formatBRL(d.esperado.totais.expensesPaidCents)} tone="bad" />
            <Stat label="Esperado no dia" value={formatBRL(d.esperado.totais.expectedCents)} tone={d.esperado.totais.expectedCents >= 0 ? 'good' : 'bad'} hint="Recebido − estornos − despesas pagas" />
          </div>

          {closed ? <ClosedView d={d} onReopen={() => setReopen(true)} /> : (
            <Card className="p-4 space-y-4">
              <div>
                <h2 className="font-display text-lg text-wine-800">{d.fechamento ? 'Novo fechamento' : 'Fechar o caixa'} — {formatDateBR(date)}</h2>
                <p className="text-xs text-ink/50">Informe quanto foi contado em cada método. O esperado vem das movimentações efetivas: atendimento concluído sem recebimento e despesa não paga não entram.</p>
              </div>
              {d.fechamento && <p className="text-sm text-amber-700 bg-amber-50 rounded-lg p-3">Caixa reaberto em {formatDateTimeBR(d.fechamento.reopenedAt)}: {d.fechamento.reopenReason}</p>}
              <div className="divide-y divide-wine-50">
                {d.esperado.metodos.map((m, idx) => (
                  <MetodoRow key={m.method} m={m} value={counted[m.method] ?? ''} onChange={(v) => { setCounted((c) => ({ ...c, [m.method]: v })); setServerDiv(null); }} diff={diffs[idx] ?? null} />
                ))}
              </div>
              <p className="text-xs text-ink/50">{NOTE_OUTROS}</p>
              {(hasDiff || serverDiv) && (
                <Field label="Justificativa da divergência *" hint={serverDiv ?? 'Obrigatória quando o contado difere do esperado em qualquer método.'}>
                  <textarea className="input" rows={2} maxLength={500} value={justification} onChange={(e) => setJustification(e.target.value)} />
                </Field>
              )}
              <div className="flex flex-wrap gap-2">
                <button className="btn-primary" disabled={busy || !allFilled} onClick={close}>{busy ? 'Fechando…' : 'Fechar o caixa'}</button>
                <button className="btn-secondary" onClick={() => setShowMov((s) => !s)}>{showMov ? 'Ocultar lançamentos' : 'Ver lançamentos do dia'}</button>
              </div>
              {!allFilled && <p className="text-xs text-ink/40">Preencha todos os métodos (use 0,00 quando não houver valor).</p>}
            </Card>
          )}

          {closed && <button className="btn-secondary" onClick={() => setShowMov((s) => !s)}>{showMov ? 'Ocultar lançamentos' : 'Ver lançamentos do dia'}</button>}
          {showMov && <Movements date={date} />}
          {d.versoes.length > 0 && <Versions versoes={d.versoes} />}
        </>
      )}

      <div>
        <h2 className="font-display text-lg text-wine-800 mb-2">Fechamentos anteriores</h2>
        {list.loading && !list.data ? <Loading lines={2} /> : list.error ? <ErrorBox message={list.error} status={list.status} onRetry={list.reload} /> : !list.data?.fechamentos.length ? <Empty>Nenhum fechamento ainda.</Empty> : (
          <Card className="divide-y divide-wine-50">
            {list.data.fechamentos.map((f) => {
              const divergente = f.ultimaVersao?.metodos.some((x) => x.differenceCents !== 0);
              return (
                <button key={f.id} onClick={() => pick(f.date)} className="w-full text-left p-4 flex flex-wrap items-center justify-between gap-2 hover:bg-wine-50/40">
                  <span className="font-medium">{formatDateBR(f.date)}</span>
                  <span className="flex items-center gap-2 flex-wrap">
                    <Badge tone={f.status === 'fechado' ? 'good' : 'warn'}>{f.status === 'fechado' ? 'Fechado' : 'Reaberto'}</Badge>
                    {divergente && <Badge tone="bad">Com divergência</Badge>}
                    {f.reopenCount > 0 && <Badge>{f.reopenCount} reabertura(s)</Badge>}
                    {!f.ultimaVersao && <Badge>Anterior ao fechamento por método</Badge>}
                    <span className="text-sm tabular-nums text-ink/60">{formatBRL(f.receivedCents - f.refundedCents - f.expensesPaidCents)}</span>
                  </span>
                </button>
              );
            })}
          </Card>
        )}
      </div>

      {reopen && d?.fechamento && <ReopenModal date={date} onClose={() => setReopen(false)} onDone={() => { setReopen(false); day.reload(); list.reload(); }} />}
    </div>
  );
}

function MetodoRow({ m, value, onChange, diff }: { m: CaixaMetodo; value: string; onChange: (v: string) => void; diff: number | null }) {
  return (
    <div className="py-3 grid grid-cols-1 sm:grid-cols-[1fr_auto_9rem] items-center gap-2">
      <div className="min-w-0">
        <p className="font-medium text-ink">{methodLabel(m.method)}</p>
        <p className="text-xs text-ink/50">Recebido {formatBRL(m.receivedCents)} · estornado {formatBRL(m.refundedCents)} · despesas pagas {formatBRL(m.expensesPaidCents)}</p>
        {m.method === 'outra' && (m.expensesPaidBoletoCents || m.expensesPaidUnknownMethodCents) ? (
          <p className="text-xs mt-1 flex flex-wrap gap-1.5">
            {!!m.expensesPaidBoletoCents && <Badge tone="info">Boleto: {formatBRL(m.expensesPaidBoletoCents)}</Badge>}
            {!!m.expensesPaidUnknownMethodCents && <Badge tone="warn">Método não informado: {formatBRL(m.expensesPaidUnknownMethodCents)}</Badge>}
          </p>
        ) : null}
      </div>
      <div className="text-sm sm:text-right"><span className="text-ink/40 text-xs">Esperado </span><span className="tabular-nums font-semibold">{formatBRL(m.expectedCents)}</span></div>
      <div>
        <input className="input" inputMode="decimal" placeholder="Contado" aria-label={`Contado em ${methodLabel(m.method)}`} value={value} onChange={(e) => onChange(e.target.value)} />
        {diff != null && <p className={`text-xs mt-1 tabular-nums ${diff === 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{diff === 0 ? 'Confere' : `Diferença ${diff > 0 ? '+' : '−'}${formatBRL(Math.abs(diff))}`}</p>}
      </div>
    </div>
  );
}

function ClosedView({ d, onReopen }: { d: CaixaDay; onReopen: () => void }) {
  const last = d.versoes[d.versoes.length - 1];
  const f = d.fechamento!;
  return (
    <Card className="p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-lg text-wine-800">Caixa fechado em {formatDateTimeBR(f.closedAt)}</h2>
        <button className="btn-secondary" onClick={onReopen}>Reabrir caixa</button>
      </div>
      {!last ? <p className="text-sm text-ink/50">Fechamento anterior ao registro por método: só os totais foram guardados (recebido {formatBRL(f.receivedCents)}, estornado {formatBRL(f.refundedCents)}, despesas pagas {formatBRL(f.expensesPaidCents)}).</p> : <VersionTable v={last} />}
      <p className="text-xs text-ink/50">Com o caixa fechado, lançamentos com data neste dia são recusados. Um estorno que ocorreu depois entra na data em que ocorreu. Para lançar algo neste dia, reabra o caixa com um motivo.</p>
    </Card>
  );
}

function VersionTable({ v }: { v: CaixaVersion }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead><tr className="text-xs text-ink/40 uppercase text-left"><th className="py-1 pr-3">Método</th><th className="pr-3 text-right">Esperado</th><th className="pr-3 text-right">Contado</th><th className="text-right">Diferença</th></tr></thead>
        <tbody>
          {[...v.metodos].sort((a, b) => PAYMENT_METHODS.indexOf(a.method) - PAYMENT_METHODS.indexOf(b.method)).map((x) => (
            <tr key={x.method} className="border-t border-wine-50">
              <td className="py-1.5 pr-3">{methodLabel(x.method)}{x.justification && <span className="block text-xs text-ink/50">Justificativa: {x.justification}</span>}</td>
              <td className="pr-3 text-right tabular-nums">{formatBRL(x.expectedCents)}</td>
              <td className="pr-3 text-right tabular-nums">{formatBRL(x.countedCents)}</td>
              <td className={`text-right tabular-nums ${x.differenceCents === 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{x.differenceCents === 0 ? '—' : `${x.differenceCents > 0 ? '+' : '−'}${formatBRL(Math.abs(x.differenceCents))}`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Versions({ versoes }: { versoes: CaixaVersion[] }) {
  if (versoes.length < 1) return null;
  return (
    <details className="bg-white rounded-2xl border border-wine-100/60 p-4">
      <summary className="cursor-pointer text-sm font-medium text-wine-700">Histórico de fechamentos deste dia ({versoes.length})</summary>
      <div className="mt-3 space-y-4">
        {[...versoes].reverse().map((v) => (
          <div key={v.version}>
            <p className="text-xs text-ink/50 mb-1">Fechamento {v.version + 1} · {formatDateTimeBR(v.closedAt)}</p>
            <VersionTable v={v} />
          </div>
        ))}
      </div>
    </details>
  );
}

function Movements({ date }: { date: string }) {
  const { data, error, status, loading, reload } = useLoad(() => financeiro.caixaMovements(date), [date]);
  const [hist, setHist] = useState<string | null>(null);
  const [appt, setAppt] = useState<string | null>(null);
  if (loading && !data) return <Loading lines={2} />;
  if (error) return <ErrorBox message={error} status={status} onRetry={reload} />;
  if (!data) return null;
  const empty = !data.recebimentos.length && !data.pagamentosDespesa.length && !data.despesasPagasAntigas.length;
  return (
    <Card className="p-4 space-y-3">
      <h3 className="font-display text-lg text-wine-800">Lançamentos de {formatDateBR(date)}</h3>
      {empty ? <p className="text-sm text-ink/50">Nenhuma movimentação neste dia.</p> : (
        <ul className="divide-y divide-wine-50 text-sm">
          {data.recebimentos.map((r) => (
            <li key={r.id} className="py-2 flex flex-wrap items-center justify-between gap-2">
              <span>{r.kind === 'recebimento' ? 'Recebimento' : 'Estorno'} · {r.clientName} · {methodLabel(r.method)}</span>
              <span className="flex items-center gap-2"><span className={`tabular-nums font-semibold ${r.kind === 'estorno' ? 'text-rose-600' : ''}`}>{r.kind === 'estorno' ? '−' : ''}{formatBRL(r.amountCents)}</span>
                <button className="btn-ghost" onClick={() => setHist(r.historicoPath)}>Histórico</button><button className="btn-ghost" onClick={() => setAppt(r.appointmentId)}>Atendimento</button></span>
            </li>
          ))}
          {data.pagamentosDespesa.map((p) => (
            <li key={p.id} className="py-2 flex flex-wrap items-center justify-between gap-2">
              <span>Despesa paga · {p.description} · {methodLabel(p.method)}{p.method === 'boleto' ? ' (em Outros)' : ''}</span>
              <span className="flex items-center gap-2"><span className="tabular-nums font-semibold text-rose-600">−{formatBRL(p.amountCents)}</span><button className="btn-ghost" onClick={() => setHist(p.historicoPath)}>Histórico</button></span>
            </li>
          ))}
          {data.despesasPagasAntigas.map((p) => (
            <li key={p.expenseId} className="py-2 flex flex-wrap items-center justify-between gap-2">
              <span>Despesa paga (registro antigo) · {p.description} · {p.methodInformed ? methodLabel(p.originalMethod) : 'método não informado'} <Badge tone={p.methodInformed ? 'info' : 'warn'}>{p.methodInformed ? 'em Outros' : 'Outros: método não informado'}</Badge></span>
              <span className="flex items-center gap-2"><span className="tabular-nums font-semibold text-rose-600">−{formatBRL(p.amountCents)}</span><button className="btn-ghost" onClick={() => setHist(p.historicoPath)}>Histórico</button></span>
            </li>
          ))}
        </ul>
      )}
      {hist && <HistoryModal path={hist} title="Histórico da movimentação" onClose={() => setHist(null)} />}
      {appt && <AtendimentoFinanceiro appointmentId={appt} title="Atendimento" onClose={() => setAppt(null)} onChanged={reload} />}
    </Card>
  );
}

function ReopenModal({ date, onClose, onDone }: { date: string; onClose: () => void; onDone: () => void }) {
  const { toast } = useToast();
  const { busy, run } = useBusy();
  const [reason, setReason] = useState('');
  async function submit() {
    if (reason.trim().length < 3) { toast('Informe o motivo (mínimo 3 caracteres).', 'error'); return; }
    await run(async () => {
      try { await financeiro.reopenCaixa(date, reason.trim()); toast('Caixa reaberto.'); onDone(); } catch (e) { toast(errMsg(e), 'error'); }
    });
  }
  return (
    <Modal title="Reabrir caixa" onClose={onClose}>
      <p className="text-sm text-ink/60">Reabrir {formatDateBR(date)} permite lançar movimentações com essa data. O fechamento anterior continua no histórico e será preciso fechar de novo.</p>
      <Field label="Motivo *"><input className="input" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      <div className="flex gap-3"><button className="btn-secondary flex-1" onClick={onClose}>Cancelar</button><button className="btn-primary flex-1" disabled={busy} onClick={submit}>{busy ? 'Reabrindo…' : 'Reabrir caixa'}</button></div>
    </Modal>
  );
}
