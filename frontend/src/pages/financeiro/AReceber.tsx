// Contas a receber: atendimentos concluídos com saldo pendente/vencido, vindo da API (nada é presumido pago).
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { financeiro, type ReceivableItem } from '../../services/financeiro';
import { dateInBusinessTz, formatBRL, formatDateTimeBR } from '../../utils/money';
import AtendimentoFinanceiro, { agendaLink } from './AtendimentoFinanceiro';
import { Badge, Card, Empty, ErrorBox, Loading, Stat, useLoad } from './ui';

export default function AReceber() {
  const [quitados, setQuitados] = useState(false);
  const { data, error, status, loading, reload } = useLoad(() => financeiro.receivables({ incluirQuitados: quitados }), [quitados]);
  const [open, setOpen] = useState<ReceivableItem | null>(null);

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox message={error} status={status} onRetry={reload} />;
  if (!data) return null;
  const t = data.totais;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Saldo pendente" value={formatBRL(t.saldoPendenteCents)} tone="warn" hint={`${t.emAberto - t.vencidos} atendimento(s) em dia`} />
        <Stat label="Saldo vencido" value={formatBRL(t.saldoVencidoCents)} tone="bad" hint={`${t.vencidos} atendimento(s), concluídos há mais de ${data.graceDays} dias`} />
        <Stat label="Recebido (líquido)" value={formatBRL(t.recebidoLiquidoCents)} tone="good" hint="Recebimentos − estornos dos atendimentos concluídos" />
        <Stat label="Valor total" value={formatBRL(t.valorCents)} hint={`${t.atendimentos} atendimento(s) concluído(s)`} />
      </div>
      <label className="flex items-center gap-2 text-sm text-ink/70"><input type="checkbox" checked={quitados} onChange={(e) => setQuitados(e.target.checked)} /> Mostrar também os quitados</label>
      {data.itens.length === 0 ? <Empty>Nenhum saldo a receber. Só atendimentos concluídos entram aqui, e nada é considerado pago sem um recebimento registrado.</Empty> : (
        <Card className="divide-y divide-wine-50">
          {data.itens.map((i) => (
            <div key={i.appointmentId} className="p-4 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold text-ink truncate">{i.clientName} <span className="font-normal text-ink/50">· {i.serviceName}</span></p>
                  <p className="text-xs text-ink/50">Concluído em {formatDateTimeBR(i.endsAt)} · há {i.daysSinceService} dia(s) · valor {i.valueBasis === 'final' ? 'final' : 'do serviço'}</p>
                </div>
                <div className="flex items-center gap-2">
                  {i.quitado ? <Badge tone="good">Quitado</Badge> : i.overdue ? <Badge tone="bad">Vencido</Badge> : <Badge tone="warn">Pendente</Badge>}
                  <span className="font-bold tabular-nums text-wine-700">{formatBRL(i.balanceCents)}</span>
                </div>
              </div>
              <p className="text-xs text-ink/50">Valor {formatBRL(i.valueCents)} · recebido {formatBRL(i.receivedCents)}{i.refundedCents > 0 ? ` · estornado ${formatBRL(i.refundedCents)}` : ''}</p>
              {i.sinalLegado && !i.sinalLegado.conferido && (
                <p className="text-xs text-amber-700 bg-amber-50 rounded-lg p-2">Sinal Pix antigo de {formatBRL(i.sinalLegado.depositCents)}: <strong>não contado como recebido</strong>. Confira com o extrato e, se confirmado, registre o recebimento.</p>
              )}
              <div className="flex gap-2">
                <button className="btn-secondary" onClick={() => setOpen(i)}>Financeiro do atendimento</button>
                <Link className="btn-ghost" to={agendaLink(i.appointmentId, i.startsAt, dateInBusinessTz)}>Abrir na Agenda</Link>
              </div>
            </div>
          ))}
        </Card>
      )}
      {open && <AtendimentoFinanceiro appointmentId={open.appointmentId} startsAt={open.startsAt} title={`${open.clientName} · ${open.serviceName}`} onClose={() => setOpen(null)} onChanged={reload} />}
    </div>
  );
}
