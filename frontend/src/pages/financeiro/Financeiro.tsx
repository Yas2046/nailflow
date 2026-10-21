// Financeiro: áreas em abas por rota (/financeiro/:aba). Reúne também as telas que eram destinos próprios:
// "Gastos do período" (antiga /gastos) e "Desempenho" (antigo /dashboard), que seguem com os mesmos dados e regras.
// Quando o servidor não disponibiliza o módulo de pagamentos, só essas duas abas aparecem.
import type { ReactNode } from 'react';
import { NavLink, Navigate, useParams } from 'react-router-dom';
import { usePageTitle } from '../../hooks/usePageTitle';
import { useFinanceiroAtivo } from '../../hooks/useFinanceiroAtivo';
import Dashboard from '../Dashboard';
import Gastos from '../Gastos';
import AReceber from './AReceber';
import Despesas from './Despesas';
import FechamentoCaixa from './FechamentoCaixa';
import Movimentacoes from './Movimentacoes';
import Relatorios from './Relatorios';
import VisaoGeral from './VisaoGeral';

// As páginas legadas trazem o próprio título (h1); aqui o título é "Financeiro", então o primeiro h1 delas fica oculto.
const semTitulo = (el: ReactNode) => <div className="[&_h1:first-of-type]:hidden">{el}</div>;

interface Tab { slug: string; label: string; el: ReactNode; modulo: boolean }
const TABS: Tab[] = [
  { slug: 'visao-geral', label: 'Visão geral', el: <VisaoGeral />, modulo: true },
  { slug: 'movimentacoes', label: 'Movimentações', el: <Movimentacoes />, modulo: true },
  { slug: 'a-receber', label: 'A receber', el: <AReceber />, modulo: true },
  { slug: 'despesas', label: 'Despesas', el: <Despesas />, modulo: true },
  { slug: 'gastos', label: 'Gastos do período', el: semTitulo(<Gastos />), modulo: false },
  { slug: 'caixa', label: 'Fechamento de caixa', el: <FechamentoCaixa />, modulo: true },
  { slug: 'relatorios', label: 'Relatórios', el: <Relatorios />, modulo: true },
  { slug: 'desempenho', label: 'Desempenho', el: semTitulo(<Dashboard />), modulo: false },
];

export default function Financeiro() {
  usePageTitle('Financeiro');
  const { aba } = useParams();
  const moduloAtivo = useFinanceiroAtivo();
  if (moduloAtivo === null) {
    return (
      <div className="space-y-5 pb-10">
        <h1 className="font-display text-3xl sm:text-4xl text-wine-800 leading-tight">Financeiro</h1>
        <div className="h-40 rounded-2xl bg-white/70 animate-pulse" role="status" aria-label="Carregando" />
      </div>
    );
  }
  const tabs = TABS.filter((t) => moduloAtivo || !t.modulo);
  const tab = tabs.find((t) => t.slug === aba);
  if (!tab) return <Navigate to={`/financeiro/${tabs[0].slug}`} replace />;
  return (
    <div className="space-y-5 pb-10">
      <h1 className="font-display text-3xl sm:text-4xl text-wine-800 leading-tight">Financeiro</h1>
      <nav className="flex gap-1.5 overflow-x-auto -mx-1 px-1 pb-1" aria-label="Áreas do Financeiro">
        {tabs.map((t) => (
          <NavLink
            key={t.slug}
            to={`/financeiro/${t.slug}`}
            className={({ isActive }) =>
              `px-3.5 py-2 min-h-[40px] inline-flex items-center rounded-xl text-sm font-medium whitespace-nowrap transition-colors ${isActive ? 'bg-wine-600 text-white shadow-sm' : 'bg-wine-50 text-wine-700 hover:bg-wine-100'}`
            }
          >
            {t.label}
          </NavLink>
        ))}
      </nav>
      <div key={tab.slug}>{tab.el}</div>
    </div>
  );
}
