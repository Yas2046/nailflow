import { useEffect, useState } from 'react';
import { usePageTitle } from '../hooks/usePageTitle';
import { useNavigate } from 'react-router-dom';
import { api } from '../services/api';
import type { Appointment, DashboardSummary, Service } from '../types';
import AppointmentModal from '../components/AppointmentModal';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import OnboardingChecklist, { getNextStep, type OnboardingStatus } from '../components/OnboardingChecklist';
import { useFinanceiroAtivo } from '../hooks/useFinanceiroAtivo';
import LoadError from '../components/LoadError';
import { financeiro, type Alerta, type CaixaDay, type ReceivablesResponse } from '../services/financeiro';
import { useToast } from '../context/ToastContext';
import type { ReturnResponse } from './Retorno';
import { todayBR } from '../utils/money';

// ── Pendências financeiras e indicadores do mês (mesmas fontes do Financeiro; nada é recalculado aqui) ──

/** Avisos discretos para conferência (ex.: atendimentos concluídos sem recebimento há mais de 7 dias). Não são dívida automática. */
function PendenciasFinanceiras() {
  const ativo = useFinanceiroAtivo();
  const [alertas, setAlertas] = useState<Alerta[] | null>(null);
  useEffect(() => {
    if (!ativo) return;
    financeiro.alertas().then((r) => setAlertas(r.alertas.slice(0, 3))).catch(() => setAlertas([]));
  }, [ativo]);
  if (!ativo || !alertas?.length) return null;
  return (
    <section aria-label="Para conferir" className="card overflow-hidden">
      <h2 className="px-5 pt-4 pb-1 text-[11px] uppercase tracking-widest font-semibold text-ink/40">Para conferir</h2>
      <ul className="divide-y divide-wine-50">
        {alertas.map((a) => (
          <li key={a.type}>
            <Link to={a.path} className="flex items-center justify-between gap-3 px-5 py-3 min-h-[52px] hover:bg-wine-50/50 transition-colors">
              <span className="text-sm text-ink/80">{a.title}</span>
              <span className="text-xs font-semibold text-wine-700 tabular-nums shrink-0">{a.count}{a.amountCents > 0 ? ` · ${formatMoney(a.amountCents)}` : ''}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function IndicadoresMes({ mes }: { mes: DashboardSummary['mes'] }) {
  const ativo = useFinanceiroAtivo();
  const itens: Array<{ label: string; value: string }> = [
    { label: mes.base === 'recebimentos' ? 'Recebido no mês' : 'Concluído no mês (valor dos serviços)', value: formatMoney(mes.faturamentoRealizadoCents) },
    ...(mes.aReceberCents != null ? [{ label: 'A receber', value: formatMoney(mes.aReceberCents) }] : []),
    ...(mes.despesasPagasCents != null ? [{ label: 'Despesas pagas', value: formatMoney(mes.despesasPagasCents) }] : []),
  ];
  return (
    <section aria-label="Indicadores do mês">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-3">
          <span className="w-0.5 h-4 rounded-full bg-gold-500 shrink-0" aria-hidden="true" />
          <h2 className="font-display text-lg sm:text-xl text-wine-700">Este mês</h2>
        </div>
        <Link to={ativo ? '/financeiro/visao-geral' : '/financeiro/desempenho'} className="text-xs font-semibold text-wine-600 hover:underline">Ver financeiro →</Link>
      </div>
      <div className={`grid gap-3 ${itens.length === 3 ? 'grid-cols-1 sm:grid-cols-3' : 'grid-cols-2'}`}>
        {itens.map((i) => (
          <div key={i.label} className="bg-white rounded-2xl border border-wine-100/80 px-5 py-4 shadow-sm">
            <p className="text-[10px] text-ink/40 uppercase tracking-widest font-medium">{i.label}</p>
            <p className="font-display text-2xl text-wine-700 tabular-nums leading-none mt-1.5">{i.value}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

// ── Utils ────────────────────────────────────────────────────────────────────

function formatMoney(cents: number) {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}
function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Bom dia';
  if (h < 18) return 'Boa tarde';
  return 'Boa noite';
}
function getTodayLabel() {
  return new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
}
function todayRange() {
  const s = new Date(); s.setHours(0, 0, 0, 0);
  const e = new Date(s); e.setDate(e.getDate() + 1);
  return { from: s.toISOString(), to: e.toISOString() };
}
function durationMinutes(startsAt: string, endsAt: string) {
  return Math.round((new Date(endsAt).getTime() - new Date(startsAt).getTime()) / 60000);
}

// ── Status config ─────────────────────────────────────────────────────────────

const statusConfig: Record<string, { label: string; cls: string; dot: string }> = {
  pendente:       { label: 'Aguardando confirmação',      cls: 'bg-amber-50 text-amber-700 border border-amber-200',     dot: 'bg-amber-400' },
  aguardando_pagamento: { label: 'Aguardando pagamento', cls: 'bg-sky-50 text-sky-700 border border-sky-200', dot: 'bg-sky-400' },
  confirmado:     { label: 'Confirmado',      cls: 'bg-emerald-50 text-emerald-700 border border-emerald-200', dot: 'bg-emerald-500' },
  concluido:      { label: 'Concluído',       cls: 'bg-green-50 text-green-700 border border-green-200',     dot: 'bg-green-500' },
  cancelado:      { label: 'Cancelado',       cls: 'bg-rose-50 text-rose-600 border border-rose-200',        dot: 'bg-rose-400' },
  nao_compareceu: { label: 'Não compareceu',  cls: 'bg-gray-100 text-gray-500 border border-gray-200',       dot: 'bg-gray-400' },
};

function StatusBadge({ status, small }: { status: string; small?: boolean }) {
  const cfg = statusConfig[status] ?? { label: status, cls: 'bg-gray-100 text-gray-500 border border-gray-200', dot: 'bg-gray-400' };
  return (
    <span className={`inline-flex items-center gap-1.5 font-medium whitespace-nowrap rounded-full ${
      small ? 'text-[10px] px-2 py-0.5' : 'text-xs px-2.5 py-1'
    } ${cfg.cls}`}>
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${cfg.dot}`} />
      {cfg.label}
    </span>
  );
}

function StatusBadgeHero({ status }: { status: string }) {
  const cfg = statusConfig[status] ?? { label: status, cls: '', dot: 'bg-white/40' };
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold bg-white/12 text-white/90 rounded-full px-2.5 py-1 border border-white/15">
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${cfg.dot}`} />
      {cfg.label}
    </span>
  );
}

// ── Icons ────────────────────────────────────────────────────────────────────

function IconCalendar() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.6} viewBox="0 0 24 24">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path strokeLinecap="round" d="M16 2v4M8 2v4M3 10h18" />
    </svg>
  );
}
function IconArrowRight() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 18l6-6-6-6" />
    </svg>
  );
}
function IconClock() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="9" />
      <path strokeLinecap="round" d="M12 7v5l3 3" />
    </svg>
  );
}

// ── Aguardando ação (pedidos pendentes de confirmação/pagamento) ──────────────

function localDateParam(iso: string) {
  const d = new Date(iso);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}
// Leva à Agenda no dia do agendamento e já abre o detalhe (Confirmar/Recusar/Pagamento recebido).
function agendaLink(item: { id: string; startsAt: string }) {
  return `/agenda?data=${localDateParam(item.startsAt)}&abrir=${item.id}`;
}
function formatWhen(iso: string) {
  const d = new Date(iso);
  const day = d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' });
  return `${day} às ${formatTime(iso)}`;
}
function formatDeadline(iso: string) {
  const min = Math.max(1, Math.round((new Date(iso).getTime() - Date.now()) / 60000));
  if (min < 60) return `em ${min} min`;
  if (min < 24 * 60) return `em ${Math.floor(min / 60)} h`;
  const d = new Date(iso);
  return `${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} às ${formatTime(iso)}`;
}

function AwaitingCard({ data }: { data: DashboardSummary['aguardando'] }) {
  const total = data.confirmacao + data.pagamento;
  if (total === 0) return null;
  const parts: string[] = [];
  if (data.confirmacao > 0) parts.push(`${data.confirmacao} aguardando confirmação`);
  if (data.pagamento > 0) parts.push(`${data.pagamento} aguardando pagamento`);

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-2xl overflow-hidden shadow-sm" role="region" aria-label="Pedidos que precisam da sua ação">
      <div className="px-5 pt-4 pb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-widest font-semibold text-amber-700">Precisa da sua ação</p>
          <p className="font-display text-lg text-wine-800 leading-snug mt-1">{parts.join(' · ')}</p>
          {data.proximoVencimento && (
            <p className="text-xs text-amber-800 mt-1 flex items-center gap-1.5">
              <IconClock />
              Próximo vencimento {formatDeadline(data.proximoVencimento)}
            </p>
          )}
        </div>
        <Link
          to={agendaLink(data.itens[0])}
          className="shrink-0 flex items-center gap-1.5 text-sm font-semibold text-white bg-wine-600 hover:bg-wine-700 transition-colors rounded-xl px-4 py-2"
        >
          Ver na Agenda
          <IconArrowRight />
        </Link>
      </div>
      <ul className="border-t border-amber-200/70 divide-y divide-amber-200/60">
        {data.itens.map((item) => (
          <li key={item.id}>
            <Link to={agendaLink(item)} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-amber-100/50 transition-colors">
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink/80 truncate">{item.clientName}</p>
                <p className="text-xs text-ink/50 truncate">{item.serviceName} · {formatWhen(item.startsAt)}</p>
              </div>
              <div className="flex flex-col items-end gap-1 shrink-0">
                <StatusBadge status={item.status} small />
                <span className="text-[10px] text-amber-800">vence {formatDeadline(item.expiresAt)}</span>
              </div>
            </Link>
          </li>
        ))}
      </ul>
      {total > data.itens.length && (
        <p className="px-5 py-2.5 text-xs text-amber-800 border-t border-amber-200/70">
          e mais {total - data.itens.length} {total - data.itens.length === 1 ? 'pedido' : 'pedidos'} — abra a Agenda para ver todos.
        </p>
      )}
    </div>
  );
}

// ── LoadingSkeleton ───────────────────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <div className="animate-pulse space-y-8">
      <div className="h-8 w-48 bg-wine-100 rounded-lg" />
      <div className="bg-wine-200/50 rounded-2xl h-48" />
      <div className="bg-white rounded-xl border border-wine-100 h-16" />
      <div className="bg-white rounded-xl border border-wine-100 h-52" />
    </div>
  );
}

// ── Primeira dobra: cliente da vez com a ação certa, decisões pendentes e o dia no caixa ─────────────────────

/** "Em atendimento" não é um status: é confirmado com a chegada registrada (check-in). */
const isInService = (a: Appointment) => a.status === 'confirmado' && !!a.checkedInAt;

function HeroAtendimento({ appt, price, status, busy, error, onStart, onConclude, onDetails }: {
  appt: Appointment; price: number | null; status: string; busy: boolean; error: string | null;
  onStart: () => void; onConclude: () => void; onDetails: () => void;
}) {
  const inService = isInService(appt);
  const canStart = appt.status === 'confirmado' && !appt.checkedInAt;
  const dur = durationMinutes(appt.startsAt, appt.endsAt);
  // A API só aceita concluir a partir do horário de início (chegada antecipada já pode ser registrada).
  const started = new Date(appt.startsAt).getTime() <= Date.now();
  return (
    <section aria-label={inService ? 'Atendimento em andamento' : started ? 'Cliente no horário' : 'Próxima cliente'} className="bg-wine-800 rounded-2xl overflow-hidden shadow-lg shadow-wine-800/20 text-cream">
      <div className="px-5 sm:px-6 pt-5 pb-3 flex items-center justify-between gap-3">
        <p className="text-wine-300 text-[11px] uppercase tracking-widest font-semibold">{inService ? 'Em atendimento agora' : started ? 'Na hora do atendimento' : 'Próxima cliente'}</p>
        <StatusBadgeHero status={inService ? 'confirmado' : status} />
      </div>
      <div className="px-5 sm:px-6 pb-4 flex items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="font-display text-5xl sm:text-6xl tabular-nums leading-none text-cream">{formatTime(appt.startsAt)}</p>
          <p className="font-display text-xl sm:text-2xl text-cream leading-snug mt-2 truncate">{appt.clientName}</p>
          <p className="text-wine-300 text-sm mt-0.5 truncate">
            {appt.serviceName} · {dur} min{price != null ? ` · ${formatMoney(price)}` : ''}
          </p>
        </div>
      </div>
      {error && <p role="alert" className="mx-5 sm:mx-6 mb-3 rounded-lg bg-rose-500/20 border border-rose-300/30 px-3 py-2 text-sm text-rose-100">{error}</p>}
      <div className="border-t border-wine-700/60 px-5 sm:px-6 py-4 flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2.5">
        <button onClick={onDetails} className="min-h-[44px] text-sm font-semibold text-white bg-white/10 hover:bg-white/20 transition-colors rounded-xl px-4 py-2 border border-white/15">
          Ver detalhes
        </button>
        {canStart && (
          <button onClick={onStart} disabled={busy} className="min-h-[48px] sm:min-h-[44px] text-sm font-semibold text-wine-800 bg-cream hover:bg-white transition-colors rounded-xl px-5 py-2 disabled:opacity-60">
            {busy ? 'Iniciando…' : 'Iniciar atendimento'}
          </button>
        )}
        {inService && (
          <button onClick={onConclude} disabled={!started} className="min-h-[48px] sm:min-h-[44px] text-sm font-semibold text-wine-800 bg-cream hover:bg-white transition-colors rounded-xl px-5 py-2 disabled:opacity-60 disabled:cursor-not-allowed">
            Concluir e receber
          </button>
        )}
        {inService && !started && <p className="text-xs text-wine-300 sm:mr-auto sm:self-center">Concluir fica disponível às {formatTime(appt.startsAt)}.</p>}
      </div>
    </section>
  );
}

/** O dia no caixa, com as mesmas fontes da Visão geral do Financeiro (caixa do dia e a receber). Sem o módulo, só o previsto. */
function FinanceiroHoje({ previstoCents, refreshKey }: { previstoCents: number; refreshKey: number }) {
  const ativo = useFinanceiroAtivo();
  const [cx, setCx] = useState<CaixaDay | null>(null);
  const [rec, setRec] = useState<ReceivablesResponse | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!ativo) return;
    setFailed(false);
    financeiro.caixaDay(todayBR()).then(setCx).catch(() => setFailed(true));
    financeiro.receivables({}).then(setRec).catch(() => setFailed(true));
  }, [ativo, refreshKey]);

  const t = cx?.esperado.totais;
  return (
    <section aria-label="Resumo financeiro do dia" className="card p-5">
      <div className="flex items-center justify-between gap-3 mb-3">
        <h2 className="font-display text-lg text-wine-700">Hoje no caixa</h2>
        {ativo && <Link to="/financeiro/visao-geral" className="text-xs font-semibold text-wine-600 hover:underline">Financeiro →</Link>}
      </div>
      {ativo === false ? (
        <div>
          <p className="stat-label">Previsto hoje</p>
          <p className="stat-value mt-1.5">{formatMoney(previstoCents)}</p>
          <p className="text-xs text-ink/55 mt-2">Valor dos serviços do dia. O controle de recebimentos não está ativo neste ambiente.</p>
        </div>
      ) : failed ? (
        <p role="alert" className="text-sm text-rose-700">Não foi possível carregar os valores do dia. Abra o Financeiro para conferir.</p>
      ) : !t ? (
        <div className="h-16 rounded-lg bg-wine-50 animate-pulse" role="status" aria-label="Carregando" />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="stat-label">Recebido hoje</p>
              <p className="stat-value mt-1.5">{formatMoney(t.receivedCents - t.refundedCents)}</p>
              {t.refundedCents > 0 && <p className="text-[11px] text-ink/55 mt-1">já descontado estorno de {formatMoney(t.refundedCents)}</p>}
            </div>
            <div>
              <p className="stat-label">A receber (total)</p>
              <p className="stat-value mt-1.5">{formatMoney(rec?.totais.saldoPendenteCents ?? 0)}</p>
              {!!rec?.totais.vencidos && <p className="text-[11px] text-ink/55 mt-1">{rec.totais.vencidos} para conferir</p>}
            </div>
          </div>
          <p className="text-xs text-ink/55 mt-3">
            Previsto pelos serviços do dia: <strong className="tabular-nums">{formatMoney(previstoCents)}</strong>. Caixa {cx?.fechamento?.status === 'fechado' ? 'fechado' : 'ainda aberto'}.
          </p>
        </>
      )}
    </section>
  );
}

/** Clientes que a profissional pode chamar (sugestões do servidor; nada é enviado). Some quando não há ninguém ou o recurso não está disponível. */
function RetornoCard() {
  const [d, setD] = useState<ReturnResponse | null>(null);
  useEffect(() => { api.get<ReturnResponse>('/clients/return-suggestions').then(setD).catch(() => setD(null)); }, []);
  if (!d || d.items.length === 0) return null;
  return (
    <section aria-label="Clientes para chamar" className="card overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-5 pt-4 pb-2">
        <h2 className="font-display text-lg text-wine-700">Clientes para chamar <span className="text-sm font-sans text-ink/55">({d.items.length})</span></h2>
        <Link to="/retorno" className="text-xs font-semibold text-wine-600 hover:underline">Ver todas →</Link>
      </div>
      <ul className="divide-y divide-wine-50">
        {d.items.slice(0, 3).map((i) => (
          <li key={i.clientId}>
            <Link to="/retorno" className="flex items-center justify-between gap-3 px-5 py-3 min-h-[52px] hover:bg-wine-50/50 transition-colors">
              <span className="text-sm font-medium text-ink/80 truncate">{i.name}</span>
              <span className="text-xs text-ink/60 shrink-0">{i.reason === 'manutencao' ? `manutenção · ${i.lastServiceName}` : `${i.daysSince} dias sem agendar`}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ── Component ────────────────────────────────────────────────────────────────

export default function Inicio() {
  usePageTitle('Início');
  const navigate = useNavigate();
  const { professional } = useAuth();

  const [data, setData]                       = useState<DashboardSummary | null>(null);
  const [error, setError]                     = useState<string | null>(null);
  const [todayAppts, setTodayAppts]           = useState<Appointment[]>([]);
  const [services, setServices]               = useState<Service[]>([]);
  const [selectedAppt, setSelectedAppt]       = useState<Appointment | null>(null);
  const [onboarding, setOnboarding]           = useState<OnboardingStatus | null>(null);
  const [conclude, setConclude]               = useState(false);
  const [refreshKey, setRefreshKey]           = useState(0);   // recarrega o resumo financeiro depois de iniciar/concluir/receber
  const [starting, setStarting]               = useState(false);
  const [startError, setStartError]           = useState<string | null>(null);
  const { toast } = useToast();

  function fetchAll() {
    setRefreshKey((k) => k + 1);
    api.get<DashboardSummary>('/dashboard').then(setData).catch((e: Error) => setError(e.message));
    const { from, to } = todayRange();
    api.get<Appointment[]>(`/appointments?from=${from}&to=${to}`).then(setTodayAppts).catch(() => {});
    api.get<Service[]>('/services').then(setServices).catch(() => {});
  }
  useEffect(() => { fetchAll(); }, []);

  // Iniciar o atendimento a partir do Início usa a MESMA operação da Agenda (POST /appointments/:id/check-in).
  async function iniciar(a: Appointment) {
    setStarting(true); setStartError(null);
    try {
      await api.post(`/appointments/${a.id}/check-in`);
      toast('Atendimento iniciado');
      fetchAll();
    } catch (e) {
      setStartError(e instanceof Error ? e.message : 'Não foi possível iniciar o atendimento.');
    } finally {
      setStarting(false);
    }
  }
  useEffect(() => {
    if (!professional || professional.isAdmin) return;
    api.get<OnboardingStatus>('/onboarding/status').then(setOnboarding).catch(() => {});
  }, [professional]);

  if (error) return <LoadError message={`Não foi possível carregar o resumo do dia (${error}).`} onRetry={() => { setError(null); fetchAll(); }} />;
  if (!data) return <LoadingSkeleton />;

  // Próximo atendimento
  const proximo      = data.proximoAtendimento;
  const proximoFull  = proximo ? todayAppts.find(a => a.id === proximo.id) ?? null : null;
  const proximoSvc   = proximoFull ? services.find(s => s.id === proximoFull.serviceId) ?? null : null;
  const proximoDur   = proximoFull ? durationMinutes(proximoFull.startsAt, proximoFull.endsAt) : null;
  const proximoStatus = data.agendamentosHoje.find(a => a.id === proximo?.id)?.status ?? 'pendente';
  // Quem está sendo atendida agora tem prioridade sobre a próxima da fila.
  const emAtendimento = todayAppts.find(isInService) ?? null;
  // A API só chama de "próximo" o que ainda vai começar. Quem já está no horário (ou atrasada) e ainda não foi iniciada
  // precisa do botão "Iniciar atendimento" agora: tem prioridade sobre a próxima da fila.
  const agoraMs = Date.now();
  const noHorario = todayAppts.find((a) => a.status === 'confirmado' && !a.checkedInAt
    && new Date(a.startsAt).getTime() <= agoraMs && new Date(a.endsAt).getTime() > agoraMs) ?? null;
  const heroAppt = emAtendimento ?? noHorario ?? proximoFull;
  const heroSvc = heroAppt ? services.find((s) => s.id === heroAppt.serviceId) ?? null : null;


  // Agenda do dia — enriquecer com serviço completo
  const agendaHoje = data.agendamentosHoje.map(a => {
    const full = todayAppts.find(t => t.id === a.id);
    const svc  = full ? services.find(s => s.id === full.serviceId) ?? null : null;
    return { ...a, full, svc };
  });

  const isProximoId = proximo?.id;
  const nextOnboardingStep = onboarding && onboarding.concluidos < onboarding.total ? getNextStep(onboarding) : undefined;

  return (
    <>
      <div className="space-y-7 pb-10">

        {/* ── Greeting ── */}
        <div>
          <h1 className="font-display text-3xl sm:text-4xl text-wine-800 leading-tight">{getGreeting()}</h1>
          <p className="text-sm text-ink/40 mt-1.5 sentence-case">{getTodayLabel()}</p>
        </div>

        {!heroAppt && nextOnboardingStep && (
          /* Boas-vindas: onboarding incompleto e sem próximo atendimento */
          <div className="bg-wine-800 rounded-2xl overflow-hidden shadow-lg shadow-wine-800/20 text-cream px-6 py-7">
            <p className="text-wine-300 text-[11px] uppercase tracking-widest font-semibold">
              {onboarding!.concluidos} de {onboarding!.total} passos concluídos
            </p>
            <h2 className="font-display text-2xl sm:text-3xl text-cream leading-snug mt-2">Vamos configurar sua agenda</h2>
            <p className="text-wine-300 text-sm mt-1.5 max-w-md">
              Em poucos passos você já pode receber agendamentos pela sua página pública.
            </p>
            <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-3">
              <Link
                to="/comecar"
                className="inline-flex items-center gap-1.5 text-sm font-semibold text-wine-800 bg-cream hover:bg-white transition-colors rounded-xl px-5 py-2.5"
              >
                Continuar: {nextOnboardingStep.label}
                <IconArrowRight />
              </Link>
              <Link to="/ajuda" className="text-sm font-medium text-cream/85 hover:text-white underline underline-offset-4 decoration-cream/30 transition-colors">
                Ver guia rápido
              </Link>
            </div>
          </div>
        )}

        {/* ── 1. PRIMEIRA DOBRA: cliente da vez, decisões e o dia no caixa ── */}
        {heroAppt ? (
          <HeroAtendimento
            appt={heroAppt}
            price={heroSvc?.priceCents ?? null}
            status={emAtendimento || noHorario ? 'confirmado' : proximoStatus}
            busy={starting}
            error={startError}
            onStart={() => iniciar(heroAppt)}
            onConclude={() => { setConclude(true); setSelectedAppt(heroAppt); }}
            onDetails={() => { setConclude(false); setSelectedAppt(heroAppt); }}
          />
        ) : nextOnboardingStep ? null : (
          <section className="bg-wine-50 border border-wine-100/80 rounded-2xl p-8 flex flex-col items-center text-center gap-3">
            <div className="w-12 h-12 rounded-full bg-wine-100 flex items-center justify-center text-wine-400"><IconCalendar /></div>
            <div>
              <p className="font-display text-lg text-wine-700">Nenhuma cliente na fila agora</p>
              <p className="text-sm text-ink/60 mt-1">Sem atendimentos pendentes para hoje.</p>
            </div>
            <button onClick={() => navigate('/agenda')} className="mt-1 flex items-center gap-1.5 text-sm font-semibold text-wine-700 bg-white border border-wine-200 hover:bg-wine-50 rounded-xl px-4 py-2 min-h-[44px] transition-colors">
              Ver agenda
              <IconArrowRight />
            </button>
          </section>
        )}

        <div className="grid gap-5 items-start lg:grid-cols-2">
          <div className="space-y-5 min-w-0">
            {data.aguardando && <AwaitingCard data={data.aguardando} />}
            <PendenciasFinanceiras />
          </div>
          <FinanceiroHoje previstoCents={data.faturamentoEstimadoHojeCents} refreshKey={refreshKey} />
        </div>

        {/* ── 2. RESUMO DO DIA ── */}
        <div className="bg-white rounded-2xl border border-wine-100/80 px-5 py-4 shadow-sm">
          <div className="flex flex-wrap gap-x-6 gap-y-3">
            <div>
              <p className="text-[10px] text-ink/40 uppercase tracking-widest font-medium">Hoje</p>
              <div className="flex items-baseline gap-1.5 mt-0.5">
                <span className="font-display text-2xl text-wine-700 tabular-nums leading-none">{data.agendamentosHoje.length}</span>
                <span className="text-xs text-ink/40">{data.agendamentosHoje.length === 1 ? 'atendimento' : 'atendimentos'}</span>
              </div>
            </div>
            <div className="w-px bg-wine-100 self-stretch" />
            <div>
              <p className="text-[10px] text-ink/40 uppercase tracking-widest font-medium">Disponíveis</p>
              <div className="flex items-baseline gap-1.5 mt-0.5">
                <span className="font-display text-2xl text-wine-700 tabular-nums leading-none">{data.horariosDisponiveisHoje}</span>
                <span className="text-xs text-ink/40">{data.horariosDisponiveisHoje === 1 ? 'horário' : 'horários'}</span>
              </div>
            </div>
            <div className="w-px bg-wine-100 self-stretch" />
            <div>
              <p className="text-[10px] text-ink/40 uppercase tracking-widest font-medium">Previsto hoje</p>
              <div className="flex items-baseline gap-1.5 mt-0.5">
                <span className="font-display text-2xl text-wine-700 tabular-nums leading-none">{formatMoney(data.faturamentoEstimadoHojeCents)}</span>
              </div>
            </div>
            <div className="w-px bg-wine-100 self-stretch" />
            <Link to="/clientes" aria-label={`Clientes: ${data.totalClientes}. Abrir lista de clientes`} className="group rounded-lg -m-1 p-1 hover:bg-wine-50 transition-colors">
              <p className="text-[10px] text-ink/40 uppercase tracking-widest font-medium">Clientes</p>
              <div className="flex items-baseline gap-1.5 mt-0.5">
                <span className="font-display text-2xl text-wine-700 tabular-nums leading-none">{data.totalClientes}</span>
                <span className="text-xs text-wine-600 group-hover:underline">ver todas →</span>
              </div>
            </Link>
          </div>
        </div>

        <RetornoCard />

        <OnboardingChecklist status={onboarding} />

        {/* ── 3. AGENDA DE HOJE ── */}
        <div>
          <div className="flex items-center gap-3 mb-3">
            <span className="w-0.5 h-4 rounded-full bg-gold-500 shrink-0" aria-hidden="true" />
            <h2 className="font-display text-lg sm:text-xl text-wine-700">Agenda de hoje</h2>
          </div>

          <div className="card overflow-hidden">
            {agendaHoje.length === 0 ? (
              <div className="p-10 flex flex-col items-center gap-2 text-ink/40">
                <IconCalendar />
                <p className="text-sm">Nenhum agendamento para hoje.</p>
                <button
                  onClick={() => navigate('/agenda')}
                  className="mt-2 text-xs font-semibold text-wine-600 hover:underline"
                >
                  Ir para agenda →
                </button>
              </div>
            ) : (
              <ul className="divide-y divide-wine-50">
                {agendaHoje.map((a) => {
                  const isNext = a.id === isProximoId;
                  return (
                    <li key={a.id} className={isNext ? 'border-l-2 border-wine-500' : 'border-l-2 border-transparent'}>
                      <button
                        onClick={() => a.full && setSelectedAppt(a.full)}
                        disabled={!a.full}
                        className={`w-full flex items-center justify-between px-4 py-3.5 gap-3 text-left transition-colors disabled:cursor-default ${
                          isNext
                            ? 'bg-wine-50/70 hover:bg-wine-50'
                            : 'hover:bg-wine-50/40'
                        }`}
                      >
                        {/* Hora */}
                        <span className={`shrink-0 font-bold tabular-nums w-11 text-sm ${isNext ? 'text-wine-700' : 'text-ink/50'}`}>
                          {formatTime(a.startsAt)}
                        </span>

                        {/* Nome + Serviço */}
                        <div className="flex-1 min-w-0">
                          <p className={`font-medium truncate leading-snug ${isNext ? 'text-ink' : 'text-ink/80'}`}>
                            {a.clientName}
                          </p>
                          <p className="text-xs text-ink/45 truncate">{a.serviceName}</p>
                        </div>

                        {/* Valor + Status */}
                        <div className="flex flex-col items-end gap-1 shrink-0">
                          {a.svc && (
                            <span className={`text-sm font-semibold tabular-nums ${isNext ? 'text-wine-700' : 'text-ink/60'}`}>
                              {formatMoney(a.svc.priceCents)}
                            </span>
                          )}
                          <StatusBadge status={a.status} small />
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        {/* ── 4. INDICADORES DO MÊS (vindos do antigo Dashboard) ── */}
        {data.mes && <IndicadoresMes mes={data.mes} />}

      </div>

      {selectedAppt && (
        <AppointmentModal
          date={new Date(selectedAppt.startsAt)}
          time={null}
          appointment={selectedAppt}
          startAt={conclude ? 'conclude' : undefined}
          onClose={() => { setSelectedAppt(null); setConclude(false); }}
          onSaved={() => { fetchAll(); setSelectedAppt(null); setConclude(false); }}
        />
      )}
    </>
  );
}
