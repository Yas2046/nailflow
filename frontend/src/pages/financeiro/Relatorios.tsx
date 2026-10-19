// Relatório do período: resumo, recebimentos por método, despesas, pendências e saldo de caixa; exportação Excel (detalhada) e PDF (resumo).
// Os números vêm da API (mesmas consultas do Dashboard e de Gastos); a tela só apresenta.
import { useState } from 'react';
import { useToast } from '../../context/ToastContext';
import { downloadRelatorio, financeiro } from '../../services/financeiro';
import { formatBRL, formatDateBR, methodLabel, monthBoundsBR } from '../../utils/money';
import { Badge, Card, Empty, ErrorBox, Loading, Stat, errMsg, useBusy, useLoad } from './ui';

export default function Relatorios() {
  const { toast } = useToast();
  const [period, setPeriod] = useState<'current' | 'previous' | 'custom'>('current');
  const [cFrom, setCFrom] = useState('');
  const [cTo, setCTo] = useState('');
  const range = period === 'current' ? monthBoundsBR(0) : period === 'previous' ? monthBoundsBR(-1) : { from: cFrom, to: cTo };
  const ready = !!range.from && !!range.to && range.from <= range.to;
  const { data, error, status, loading, reload } = useLoad(() => (ready ? financeiro.relatorio(range) : Promise.resolve(null)), [range.from, range.to, ready]);
  const { busy, run } = useBusy();

  async function download(kind: 'xlsx' | 'pdf') {
    await run(async () => {
      try { await downloadRelatorio(kind, range); } catch (e) { toast(errMsg(e, 'Não foi possível gerar o arquivo.'), 'error'); }
    });
  }

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
        <div className="flex flex-wrap items-center gap-2 justify-between">
          {ready && <p className="text-xs text-ink/40">Período: {formatDateBR(range.from)} a {formatDateBR(range.to)} (máximo de 366 dias)</p>}
          <div className="flex gap-2">
            <button className="btn-secondary" disabled={!ready || busy} onClick={() => download('xlsx')}>{busy ? 'Gerando…' : 'Exportar Excel (detalhado)'}</button>
            <button className="btn-secondary" disabled={!ready || busy} onClick={() => download('pdf')}>Exportar PDF (resumo)</button>
          </div>
        </div>
      </Card>

      {!ready ? <Empty>Informe o intervalo de datas para ver o relatório.</Empty> : loading && !data ? <Loading /> : error ? <ErrorBox message={error} status={status} onRetry={reload} /> : data && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Stat label="Recebido líquido" value={formatBRL(data.resumo.netReceivedCents)} tone="good" hint={`Recebido ${formatBRL(data.resumo.receivedCents)} − estornos ${formatBRL(data.resumo.refundedCents)}`} />
            <Stat label="Despesas pagas" value={formatBRL(data.resumo.expensesPaidCents)} tone="bad" />
            <Stat label="Saldo de caixa" value={formatBRL(data.resumo.saldoCents)} tone={data.resumo.saldoCents >= 0 ? 'good' : 'bad'} hint="Recebido líquido − despesas pagas" />
            <Stat label="Caixa fechado" value={`${data.caixa.diasFechados} dia(s)`} tone={data.caixa.comDivergencia ? 'warn' : 'ink'} hint={`${data.caixa.comDivergencia} com divergência`} />
          </div>

          <Card className="p-4 space-y-2">
            <h3 className="font-display text-lg text-wine-800">Recebimentos por método</h3>
            <table className="w-full text-sm">
              <thead><tr className="text-xs text-ink/40 uppercase text-left"><th className="py-1">Método</th><th className="text-right">Recebido</th><th className="text-right">Estornado</th><th className="text-right">Líquido</th></tr></thead>
              <tbody>{data.recebimentosPorMetodo.map((m) => (
                <tr key={m.method} className="border-t border-wine-50"><td className="py-1.5">{methodLabel(m.method)}</td><td className="text-right tabular-nums">{formatBRL(m.receivedCents)}</td><td className="text-right tabular-nums">{formatBRL(m.refundedCents)}</td><td className="text-right tabular-nums font-semibold">{formatBRL(m.netCents)}</td></tr>
              ))}</tbody>
            </table>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card className="p-4 space-y-2">
              <h3 className="font-display text-lg text-wine-800">Despesas pagas por método</h3>
              {!data.despesasPagasPorMetodo.length ? <p className="text-sm text-ink/50">Nenhuma despesa paga no período.</p> : data.despesasPagasPorMetodo.map((m) => (
                <p key={m.method} className="flex justify-between text-sm"><span className="flex items-center gap-2">{methodLabel(m.method)}{m.method === 'boleto' && <Badge tone="info">em Outros no caixa</Badge>}{m.method === 'nao_informado' && <Badge tone="warn">em Outros no caixa</Badge>}</span><span className="tabular-nums font-semibold">{formatBRL(m.paidCents)}</span></p>
              ))}
            </Card>
            <Card className="p-4 space-y-2">
              <h3 className="font-display text-lg text-wine-800">Despesas pagas por categoria</h3>
              {!data.despesasPagasPorCategoria.length ? <p className="text-sm text-ink/50">—</p> : data.despesasPagasPorCategoria.map((c) => (
                <p key={c.category} className="flex justify-between text-sm"><span>{c.category}</span><span className="tabular-nums font-semibold">{formatBRL(c.paidCents)}</span></p>
              ))}
            </Card>
          </div>

          <Card className="p-4 space-y-2">
            <h3 className="font-display text-lg text-wine-800">Pendências (posição de hoje)</h3>
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
              <Stat label="A receber pendente" value={formatBRL(data.pendencias.aReceber.pendenteCents)} tone="warn" />
              <Stat label="A receber vencido" value={formatBRL(data.pendencias.aReceber.vencidoCents)} tone="bad" />
              <Stat label="Despesas pendentes" value={formatBRL(data.pendencias.despesas.pendentes.remainingCents)} />
              <Stat label="Despesas vencidas" value={formatBRL(data.pendencias.despesas.vencidas.remainingCents)} tone="bad" />
              <Stat label="A revisar" value={`${data.pendencias.despesas.aRevisar.count}`} tone="warn" />
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
