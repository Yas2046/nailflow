import { useEffect, useState } from 'react';
import { api } from '../services/api';
import type { DashboardSummary } from '../types';

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Bom dia 👋';
  if (hour < 18) return 'Boa tarde 👋';
  return 'Boa noite 👋';
}

function formatMoney(cents: number) {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

const statusLabel: Record<string, string> = {
  pendente: 'Pendente',
  confirmado: 'Confirmado',
  concluido: 'Concluído',
  cancelado: 'Cancelado',
  nao_compareceu: 'Não compareceu',
};

export default function Dashboard() {
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<DashboardSummary>('/dashboard')
      .then(setData)
      .catch((e) => setError(e.message));
  }, []);

  if (error) return <p className="text-red-600">{error}</p>;
  if (!data) return <p className="text-ink/60">Carregando...</p>;

  return (
    <div>
      <h1 className="font-display text-3xl text-wine-700 mb-8">{getGreeting()}</h1>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
        <Card label="Horários disponíveis hoje" value={String(data.horariosDisponiveisHoje)} />
        <Card label="Agendamentos hoje" value={String(data.agendamentosHoje.length)} />
        <Card label="Clientes cadastradas" value={String(data.totalClientes)} />
        <Card label="Faturamento estimado hoje" value={formatMoney(data.faturamentoEstimadoHojeCents)} />
      </div>

      {data.proximoAtendimento && (
        <div className="bg-wine-50 border border-wine-100 rounded-xl p-5 mb-8">
          <p className="text-sm text-wine-700/70 mb-1">Próximo atendimento</p>
          <p className="font-display text-xl text-wine-700">
            {data.proximoAtendimento.clientName} — {data.proximoAtendimento.serviceName} às{' '}
            {formatTime(data.proximoAtendimento.startsAt)}
          </p>
        </div>
      )}

      <h2 className="font-display text-xl text-wine-700 mb-4">Agenda de hoje</h2>
      <div className="bg-white rounded-xl border border-wine-100 divide-y divide-wine-50">
        {data.agendamentosHoje.length === 0 && (
          <p className="p-5 text-ink/60 text-sm">Nenhum agendamento para hoje.</p>
        )}
        {data.agendamentosHoje.map((a) => (
          <div key={a.id} className="flex items-center justify-between p-4">
            <div>
              <p className="font-medium">{formatTime(a.startsAt)} — {a.clientName}</p>
              <p className="text-sm text-ink/60">{a.serviceName}</p>
            </div>
            <span className="text-xs px-2 py-1 rounded-full bg-wine-50 text-wine-700">
              {statusLabel[a.status]}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Card({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white rounded-xl border border-wine-100 p-5">
      <p className="text-xs text-ink/60 mb-2">{label}</p>
      <p className="font-display text-2xl text-wine-700">{value}</p>
    </div>
  );
}
