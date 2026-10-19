// Financeiro: cinco áreas em abas por rota (/financeiro/:aba). O módulo só aparece quando o servidor o disponibiliza.
import { NavLink, Navigate, useParams } from 'react-router-dom';
import { usePageTitle } from '../../hooks/usePageTitle';
import AReceber from './AReceber';
import Despesas from './Despesas';
import FechamentoCaixa from './FechamentoCaixa';
import Movimentacoes from './Movimentacoes';
import Relatorios from './Relatorios';
import VisaoGeral from './VisaoGeral';

const TABS = [
  { slug: 'visao-geral', label: 'Visão geral', el: <VisaoGeral /> },
  { slug: 'movimentacoes', label: 'Movimentações', el: <Movimentacoes /> },
  { slug: 'a-receber', label: 'A receber', el: <AReceber /> },
  { slug: 'despesas', label: 'Despesas', el: <Despesas /> },
  { slug: 'caixa', label: 'Fechamento de caixa', el: <FechamentoCaixa /> },
  { slug: 'relatorios', label: 'Relatórios', el: <Relatorios /> },
] as const;

export default function Financeiro() {
  usePageTitle('Financeiro');
  const { aba } = useParams();
  const tab = TABS.find((t) => t.slug === aba);
  if (!tab) return <Navigate to="/financeiro/visao-geral" replace />;
  return (
    <div className="space-y-5 pb-10">
      <h1 className="font-display text-3xl sm:text-4xl text-wine-800 leading-tight">Financeiro</h1>
      <nav className="flex gap-1 overflow-x-auto -mx-1 px-1 pb-1" aria-label="Áreas do Financeiro">
        {TABS.map((t) => (
          <NavLink key={t.slug} to={`/financeiro/${t.slug}`} className={({ isActive }) => `px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap ${isActive ? 'bg-wine-600 text-white' : 'bg-wine-50 text-wine-700 hover:bg-wine-100'}`}>{t.label}</NavLink>
        ))}
      </nav>
      <div key={tab.slug}>{tab.el}</div>
    </div>
  );
}
