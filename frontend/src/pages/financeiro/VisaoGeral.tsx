// Visão geral: indicadores reais do mês, pendências e atalhos. Cada bloco carrega e falha de forma independente.
import { Link } from 'react-router-dom';
import { financeiro } from '../../services/financeiro';
import { formatBRL, formatDateBR, monthBoundsBR, todayBR } from '../../utils/money';
import { Badge, Card, ErrorBox, Loading, Stat, useLoad } from './ui';

export default function VisaoGeral() {
  const month = monthBoundsBR(0);
  const today = todayBR();
  const mov = useLoad(() => financeiro.movimentacoes({ ...month }), [month.from]);
  const rec = useLoad(() => financeiro.receivables({}), []);
  const dep = useLoad(() => financeiro.despesas({}), []);
  const cx = useLoad(() => financeiro.caixaDay(today), [today]);

  const al = useLoad(() => financeiro.alertas(), []);

  return (
    <div className="space-y-6">
      <section>
        <h2 className="text-xs font-medium text-ink/40 uppercase tracking-wide mb-2">Este mês ({formatDateBR(month.from)} a {formatDateBR(month.to)})</h2>
        {mov.loading && !mov.data ? <Loading lines={1} /> : mov.error ? <ErrorBox message={mov.error} status={mov.status} onRetry={mov.reload} /> : mov.data && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Stat label="Recebido" value={formatBRL(mov.data.totais.recebidoCents)} hint="Recebimentos efetivos" />
            <Stat label="Estornado" value={formatBRL(mov.data.totais.estornadoCents)} tone="bad" />
            <Stat label="Despesas pagas" value={formatBRL(mov.data.totais.despesasPagasCents)} tone="bad" />
            <Stat label="Saldo do mês" value={formatBRL(mov.data.totais.saldoCents)} tone={mov.data.totais.saldoCents >= 0 ? 'good' : 'bad'} hint="Recebido − estornos − despesas pagas" />
          </div>
        )}
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-4 space-y-3">
          <div className="flex items-center justify-between"><h3 className="font-display text-lg text-wine-800">A receber</h3><Link className="text-sm text-wine-700 underline" to="/financeiro/a-receber">Ver tudo</Link></div>
          {rec.loading && !rec.data ? <Loading lines={1} /> : rec.error ? <ErrorBox message={rec.error} status={rec.status} onRetry={rec.reload} /> : rec.data && (
            <div className="grid grid-cols-2 gap-3"><Stat label="Pendente" value={formatBRL(rec.data.totais.saldoPendenteCents)} tone="warn" /><Stat label="Vencido" value={formatBRL(rec.data.totais.saldoVencidoCents)} tone="bad" /></div>
          )}
        </Card>
        <Card className="p-4 space-y-3">
          <div className="flex items-center justify-between"><h3 className="font-display text-lg text-wine-800">Despesas</h3><Link className="text-sm text-wine-700 underline" to="/financeiro/despesas">Ver tudo</Link></div>
          {dep.loading && !dep.data ? <Loading lines={1} /> : dep.error ? <ErrorBox message={dep.error} status={dep.status} onRetry={dep.reload} /> : dep.data && (
            <div className="grid grid-cols-2 gap-3"><Stat label="A pagar" value={formatBRL(dep.data.totais.pendente.remainingCents + dep.data.totais.vencida.remainingCents)} tone="warn" hint={`${dep.data.totais.vencida.count} vencida(s)`} /><Stat label="A revisar" value={`${dep.data.totais.a_revisar.count}`} /></div>
          )}
        </Card>
      </section>

      <Card className="p-4 space-y-3">
        <div className="flex items-center justify-between"><h3 className="font-display text-lg text-wine-800">Caixa de hoje</h3><Link className="text-sm text-wine-700 underline" to="/financeiro/caixa">Abrir fechamento</Link></div>
        {cx.loading && !cx.data ? <Loading lines={1} /> : cx.error ? <ErrorBox message={cx.error} status={cx.status} onRetry={cx.reload} /> : cx.data && (
          <p className="text-sm text-ink/70 flex items-center gap-2 flex-wrap">
            <Badge tone={cx.data.fechamento?.status === 'fechado' ? 'good' : 'neutral'}>{cx.data.fechamento?.status === 'fechado' ? 'Fechado' : cx.data.fechamento ? 'Reaberto' : 'Não fechado'}</Badge>
            Esperado: <strong className="tabular-nums">{formatBRL(cx.data.esperado.totais.expectedCents)}</strong>
          </p>
        )}
      </Card>

      <section>
        <h3 className="font-display text-lg text-wine-800 mb-2">Alertas</h3>
        {al.loading && !al.data ? <Loading lines={1} /> : al.error ? <ErrorBox message={al.error} status={al.status} onRetry={al.reload} /> : !al.data?.alertas.length ? <Card className="p-4 text-sm text-ink/50">Nenhum alerta no momento.</Card> : (
          <Card className="divide-y divide-wine-50">
            {al.data.alertas.map((a) => (
              <Link key={a.type} to={a.path} className="p-4 flex items-center justify-between gap-2 hover:bg-wine-50/40">
                <span className="text-sm"><strong>{a.title}</strong> · {a.count} · {formatBRL(a.amountCents)}</span>
                <Badge tone={a.severity === 'alta' ? 'bad' : a.severity === 'media' ? 'warn' : 'neutral'}>Abrir</Badge>
              </Link>
            ))}
          </Card>
        )}
      </section>
      <div className="flex flex-wrap gap-2"><Link className="btn-secondary" to="/financeiro/movimentacoes">Movimentações</Link><Link className="btn-secondary" to="/financeiro/despesas">Nova despesa</Link><Link className="btn-secondary" to="/financeiro/caixa">Fechar o caixa</Link><Link className="btn-secondary" to="/financeiro/relatorios">Relatórios</Link></div>
    </div>
  );
}
