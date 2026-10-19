// Movimentações efetivas do período: recebimentos, estornos e pagamentos de despesa, com filtros, totais e acesso ao histórico.
import { useState } from 'react';
import { financeiro, type Movimentacao } from '../../services/financeiro';
import { formatBRL, formatDateBR, methodLabel, monthBoundsBR } from '../../utils/money';
import AtendimentoFinanceiro from './AtendimentoFinanceiro';
import { Badge, Card, Empty, ErrorBox, HistoryModal, Loading, Stat, useLoad } from './ui';

const TIPOS = [['', 'Todos os tipos'], ['recebimento', 'Recebimentos'], ['estorno', 'Estornos'], ['despesa', 'Despesas pagas']] as const;
const METODOS = [['', 'Todos os métodos'], ['pix', 'Pix'], ['dinheiro', 'Dinheiro'], ['cartao_debito', 'Débito'], ['cartao_credito', 'Crédito'], ['transferencia', 'Transferência'], ['outra', 'Outros (método "outra")'], ['boleto', 'Boleto'], ['nao_informado', 'Método não informado']] as const;

export default function Movimentacoes() {
  const [period, setPeriod] = useState<'current' | 'previous' | 'custom'>('current');
  const [cFrom, setCFrom] = useState('');
  const [cTo, setCTo] = useState('');
  const [tipo, setTipo] = useState('');
  const [metodo, setMetodo] = useState('');
  const range = period === 'current' ? monthBoundsBR(0) : period === 'previous' ? monthBoundsBR(-1) : { from: cFrom, to: cTo };
  const ready = !!range.from && !!range.to && range.from <= range.to;
  const { data, error, status, loading, reload } = useLoad(
    () => (ready ? financeiro.movimentacoes({ ...range, tipo, metodo }) : Promise.resolve(null)), [range.from, range.to, tipo, metodo, ready]);
  const [hist, setHist] = useState<Movimentacao | null>(null);
  const [appt, setAppt] = useState<Movimentacao | null>(null);

  return (
    <div className="space-y-5">
      <Card className="p-4 space-y-3">
        <div className="flex flex-wrap gap-2">
          {([['current', 'Este mês'], ['previous', 'Mês passado'], ['custom', 'Personalizado']] as const).map(([v, l]) => (
            <button key={v} onClick={() => setPeriod(v)} className={`px-3 py-1.5 rounded-lg text-sm font-medium ${period === v ? 'bg-wine-600 text-white' : 'bg-wine-50 text-wine-700 hover:bg-wine-100'}`}>{l}</button>
          ))}
        </div>
        {period === 'custom' && (
          <div className="flex gap-3 flex-wrap">
            <label className="flex-1 min-w-[130px] text-xs text-ink/50">De<input type="date" className="input mt-1" value={cFrom} onChange={(e) => setCFrom(e.target.value)} /></label>
            <label className="flex-1 min-w-[130px] text-xs text-ink/50">Até<input type="date" className="input mt-1" value={cTo} onChange={(e) => setCTo(e.target.value)} /></label>
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <select className="input" value={tipo} onChange={(e) => setTipo(e.target.value)} aria-label="Tipo">{TIPOS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          <select className="input" value={metodo} onChange={(e) => setMetodo(e.target.value)} aria-label="Método">{METODOS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        </div>
        {ready && <p className="text-xs text-ink/40">Período: {formatDateBR(range.from)} a {formatDateBR(range.to)}</p>}
      </Card>

      {!ready ? <Empty>Informe o intervalo de datas para ver as movimentações.</Empty> : loading && !data ? <Loading /> : error ? <ErrorBox message={error} status={status} onRetry={reload} /> : data && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Stat label="Recebido" value={formatBRL(data.totais.recebidoCents)} />
            <Stat label="Estornado" value={formatBRL(data.totais.estornadoCents)} tone="bad" />
            <Stat label="Despesas pagas" value={formatBRL(data.totais.despesasPagasCents)} tone="bad" />
            <Stat label="Saldo do período" value={formatBRL(data.totais.saldoCents)} tone={data.totais.saldoCents >= 0 ? 'good' : 'bad'} hint="Recebido − estornos − despesas pagas" />
          </div>
          {data.truncated && <p className="text-sm text-amber-700 bg-amber-50 rounded-lg p-3">Mostrando as {data.itens.length} movimentações mais recentes de {data.totais.quantidade}. Os totais acima consideram todas; refine o período ou os filtros.</p>}
          {data.itens.length === 0 ? <Empty>Nenhuma movimentação no período com esses filtros.</Empty> : (
            <Card className="divide-y divide-wine-50">
              {data.itens.map((m) => (
                <div key={`${m.tipo}-${m.id}`} className="p-4 flex flex-wrap items-center gap-3 justify-between">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-ink truncate">{m.label}</span>
                      <Badge tone={m.tipo === 'recebimento' ? 'good' : m.tipo === 'estorno' ? 'bad' : 'wine'}>{m.tipo === 'recebimento' ? 'Recebimento' : m.tipo === 'estorno' ? 'Estorno' : 'Despesa paga'}</Badge>
                      {m.method === 'boleto' && <Badge tone="info">Boleto</Badge>}
                      {m.tipo === 'despesa' && !m.methodInformed && <Badge tone="warn">Método não informado</Badge>}
                    </div>
                    <p className="text-xs text-ink/50 mt-0.5">{formatDateBR(m.date)} · {m.methodInformed ? methodLabel(m.method) : 'Método não informado'}{m.notes ? ` · ${m.notes}` : ''}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`tabular-nums font-bold ${m.tipo === 'recebimento' ? 'text-emerald-700' : 'text-rose-600'}`}>{m.tipo === 'recebimento' ? '+' : '−'}{formatBRL(m.amountCents)}</span>
                    <button className="btn-ghost" onClick={() => setHist(m)}>Histórico</button>
                    {m.appointmentId && <button className="btn-ghost" onClick={() => setAppt(m)}>Atendimento</button>}
                  </div>
                </div>
              ))}
            </Card>
          )}
        </>
      )}
      {hist && <HistoryModal path={hist.historicoPath} title="Histórico da movimentação" onClose={() => setHist(null)} />}
      {appt?.appointmentId && <AtendimentoFinanceiro appointmentId={appt.appointmentId} startsAt={appt.appointmentStartsAt} title={appt.label} onClose={() => setAppt(null)} onChanged={reload} />}
    </div>
  );
}
