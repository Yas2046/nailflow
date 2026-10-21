// Ficha da cliente (/clientes/:id): dados, histórico completo de agendamentos e valores financeiros.
// As ações de cada atendimento abrem o AppointmentModal da Agenda (mesmas operações e regras: nada é duplicado aqui).
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import AppointmentModal from '../components/AppointmentModal';
import { useFinanceiroAtivo } from '../hooks/useFinanceiroAtivo';
import { usePageTitle } from '../hooks/usePageTitle';
import { ApiError, api } from '../services/api';
import { financeiro, type AppointmentFinance } from '../services/financeiro';
import type { Appointment, AppointmentStatus, Client } from '../types';
import { formatPhone } from '../utils/format';
import { formatBRL, formatDateBR, formatDateTimeBR } from '../utils/money';

interface HistoryRow {
  id: string; starts_at: string; ends_at: string; status: AppointmentStatus; service_id: string; service_name: string;
  price_cents_snapshot: number; appointment_notes: string | null; recurring_group_id: string | null;
}
interface Metrics {
  totalConcluidos: number; totalCancelados: number; totalFaltas: number; valorTotalCents: number; ticketMedioCents: number;
  primeiroAtendimento: string | null; ultimoAtendimento: string | null; proximoAtendimento: string | null; servicoFavorito: string | null;
}
interface Ficha { client: Client & { contact_opt_out?: boolean }; metrics: Metrics; history: HistoryRow[] }

const STATUS: Record<AppointmentStatus, { label: string; cls: string }> = {
  pendente: { label: 'Aguardando confirmação', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  aguardando_pagamento: { label: 'Aguardando pagamento', cls: 'bg-sky-50 text-sky-700 border-sky-200' },
  confirmado: { label: 'Confirmado', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  concluido: { label: 'Concluído', cls: 'bg-green-50 text-green-700 border-green-200' },
  cancelado: { label: 'Cancelado', cls: 'bg-rose-50 text-rose-600 border-rose-200' },
  nao_compareceu: { label: 'Não compareceu', cls: 'bg-gray-100 text-gray-500 border-gray-200' },
};

/** Atendimento concluído é uma coisa; recebimento é outra. Texto neutro: sem recebimento não significa dívida confirmada. */
function pagamentoDe(h: HistoryRow, f: AppointmentFinance | undefined): { label: string; cls: string } | null {
  if (h.status !== 'concluido') return null;
  if (!f) return { label: 'Pagamento: —', cls: 'text-ink/40' };
  if (f.balanceCents === 0 && f.netReceivedCents > 0) return { label: 'Recebido', cls: 'text-green-700' };
  if (f.netReceivedCents > 0) return { label: `Recebido em parte · falta ${formatBRL(f.balanceCents)}`, cls: 'text-amber-700' };
  const dias = Math.floor((Date.now() - new Date(h.ends_at).getTime()) / 86_400_000);
  return dias > 7 ? { label: 'Sem recebimento registrado · conferir', cls: 'text-amber-700' } : { label: 'Sem recebimento registrado', cls: 'text-ink/50' };
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="bg-white rounded-2xl border border-wine-100/70 px-4 py-3.5 shadow-sm">
      <p className="text-[10px] uppercase tracking-widest font-medium text-ink/40">{label}</p>
      <p className="font-display text-xl text-wine-700 tabular-nums mt-1 leading-tight">{value}</p>
      {hint && <p className="text-[11px] text-ink/40 mt-0.5">{hint}</p>}
    </div>
  );
}

export default function ClienteFicha() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const moduloFinanceiro = useFinanceiroAtivo();
  const [ficha, setFicha] = useState<Ficha | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [fin, setFin] = useState<Record<string, AppointmentFinance>>({});
  const [aberto, setAberto] = useState<Appointment | null>(null);
  const [novo, setNovo] = useState(false);
  const [optOut, setOptOut] = useState<boolean | null>(null);
  const [prefError, setPrefError] = useState<string | null>(null);
  usePageTitle(ficha?.client.name ?? 'Cliente');

  const carregar = useCallback(() => {
    api.get<Ficha>(`/clients/${id}`).then((d) => { setFicha(d); setOptOut(d.client.contact_opt_out === true); setErro(null); })
      .catch((e: unknown) => setErro(e instanceof ApiError && e.status === 404 ? 'Cliente não encontrada.' : 'Não foi possível carregar a ficha.'));
  }, [id]);
  useEffect(carregar, [carregar]);

  // Valores financeiros: leitura por atendimento concluído (mais recentes primeiro, até 30), pelo mesmo endpoint do Financeiro.
  useEffect(() => {
    if (!ficha || !moduloFinanceiro) return;
    let vivo = true;
    const ids = ficha.history.filter((h) => h.status === 'concluido').slice(0, 30).map((h) => h.id);
    Promise.all(ids.map((i) => financeiro.appointment(i).then((f) => [i, f] as const).catch(() => null))).then((r) => {
      if (vivo) setFin(Object.fromEntries(r.filter((x): x is readonly [string, AppointmentFinance] => x !== null)));
    });
    return () => { vivo = false; };
  }, [ficha, moduloFinanceiro]);

  if (erro) {
    return (
      <div className="space-y-4 max-w-xl">
        <div className="rounded-xl bg-rose-50 border border-rose-200 p-5 text-rose-700 text-sm" role="alert">{erro}</div>
        <Link to="/clientes" className="btn-secondary inline-flex">Voltar para clientes</Link>
      </div>
    );
  }
  if (!ficha) return <div className="h-48 rounded-2xl bg-white/70 animate-pulse max-w-3xl" role="status" aria-label="Carregando" />;

  const { client, metrics, history } = ficha;
  const concluidos = Object.values(fin);
  const recebido = concluidos.reduce((n, f) => n + f.netReceivedCents, 0);
  const emAberto = concluidos.reduce((n, f) => n + f.balanceCents, 0);
  const wa = client.phone.replace(/\D/g, '');

  const abrirAtendimento = (h: HistoryRow) => setAberto({
    id: h.id, clientId: client.id, clientName: client.name, clientPhone: client.phone, serviceId: h.service_id, serviceName: h.service_name,
    startsAt: h.starts_at, endsAt: h.ends_at, status: h.status, notes: h.appointment_notes, recurringGroupId: h.recurring_group_id,
  });

  return (
    <div className="space-y-6 pb-10 max-w-3xl">
      <nav aria-label="Navegação"><Link to="/clientes" className="text-sm text-wine-600 hover:underline">← Clientes</Link></nav>

      <header className="card p-5 flex flex-col sm:flex-row sm:items-center gap-4">
        <div className="w-14 h-14 rounded-full bg-wine-100 text-wine-700 font-display text-2xl flex items-center justify-center shrink-0" aria-hidden="true">{client.name[0]?.toUpperCase()}</div>
        <div className="flex-1 min-w-0">
          <h1 className="font-display text-2xl sm:text-3xl text-wine-800 leading-tight truncate">{client.name}</h1>
          <p className="text-sm text-ink/55 mt-0.5">{formatPhone(client.phone)}</p>
          {!!client.tags?.length && (
            <ul className="flex flex-wrap gap-1.5 mt-2" aria-label="Etiquetas">
              {client.tags.map((t) => <li key={t} className="text-xs px-2 py-0.5 rounded-full bg-wine-50 text-wine-700 border border-wine-100">{t}</li>)}
            </ul>
          )}
          {client.notes && <p className="text-sm text-ink/60 mt-2">{client.notes}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn-primary" onClick={() => setNovo(true)}>Novo agendamento</button>
          {wa && <a className="btn-secondary" href={`https://wa.me/${wa}`} target="_blank" rel="noreferrer">WhatsApp</a>}
          <button className="btn-secondary" onClick={() => navigate(`/clientes?editar=${client.id}`)}>Editar dados</button>
        </div>
      </header>

      <section aria-label="Preferências de contato" className="card p-4 flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="font-medium text-ink/80">Mensagens de retorno e lembretes</p>
          <p className="text-xs text-ink/60 mt-0.5">Desligado: {client.name.split(' ')[0]} não aparece nas sugestões de retorno e não recebe lembretes automáticos.</p>
          {prefError && <p role="alert" className="text-xs text-rose-700 mt-1">{prefError}</p>}
        </div>
        <button
          type="button" role="switch" aria-checked={optOut === false} aria-label="Pode receber mensagens de retorno e lembretes"
          disabled={optOut === null}
          onClick={async () => {
            const next = !optOut;
            setPrefError(null);
            try { await api.put(`/clients/${client.id}/contact-preferences`, { contactOptOut: next }); setOptOut(next); }
            catch (e) { setPrefError(e instanceof Error ? e.message : 'Não foi possível salvar.'); }
          }}
          className={`relative inline-flex h-7 w-12 shrink-0 rounded-full transition-colors ${optOut === false ? 'bg-wine-600' : 'bg-ink/25'}`}
        >
          <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-transform ${optOut === false ? 'translate-x-6' : 'translate-x-1'}`} />
        </button>
      </section>

      <section aria-label="Resumo" className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="Atendimentos concluídos" value={String(metrics.totalConcluidos)} hint={`${metrics.totalCancelados} cancelados · ${metrics.totalFaltas} faltas`} />
        <Stat label="Valor dos serviços concluídos" value={formatBRL(metrics.valorTotalCents)} hint={`Ticket médio ${formatBRL(metrics.ticketMedioCents)}`} />
        {moduloFinanceiro && <Stat label="Recebido" value={formatBRL(recebido)} hint="Recebimentos líquidos de estornos" />}
        {moduloFinanceiro && <Stat label="Saldo a conferir" value={formatBRL(emAberto)} hint="Concluídos sem recebimento total" />}
        {!moduloFinanceiro && <Stat label="Último atendimento" value={metrics.ultimoAtendimento ? formatDateBR(metrics.ultimoAtendimento.slice(0, 10)) : '—'} />}
        {!moduloFinanceiro && <Stat label="Próximo" value={metrics.proximoAtendimento ? formatDateBR(metrics.proximoAtendimento.slice(0, 10)) : '—'} />}
      </section>

      <section aria-label="Histórico de agendamentos">
        <div className="flex items-center gap-3 mb-3">
          <span className="w-0.5 h-4 rounded-full bg-gold-500" aria-hidden="true" />
          <h2 className="font-display text-lg sm:text-xl text-wine-700">Histórico ({history.length})</h2>
        </div>
        {history.length === 0 ? (
          <div className="bg-white rounded-2xl border border-wine-100/70 p-8 text-center text-sm text-ink/50">Nenhum agendamento ainda.</div>
        ) : (
          <ul className="card divide-y divide-wine-50 overflow-hidden">
            {history.map((h) => {
              const st = STATUS[h.status];
              const pg = moduloFinanceiro ? pagamentoDe(h, fin[h.id]) : null;
              return (
                <li key={h.id}>
                  <button onClick={() => abrirAtendimento(h)} className="w-full text-left px-4 py-3.5 min-h-[64px] flex items-center gap-3 hover:bg-wine-50/50 transition-colors">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-ink truncate">{h.service_name}</p>
                      <p className="text-xs text-ink/50">{formatDateTimeBR(h.starts_at)}</p>
                      {pg && <p className={`text-xs mt-0.5 ${pg.cls}`}>{pg.label}</p>}
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <span className="text-sm font-semibold tabular-nums text-ink/70">{formatBRL(h.price_cents_snapshot)}</span>
                      <span className={`text-[11px] px-2 py-0.5 rounded-full border ${st.cls}`}>{st.label}</span>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {history.length > 0 && moduloFinanceiro && Object.keys(fin).length < history.filter((h) => h.status === 'concluido').length && (
          <p className="text-xs text-ink/40 mt-2">Valores recebidos mostrados para os 30 atendimentos concluídos mais recentes.</p>
        )}
      </section>

      {aberto && (
        <AppointmentModal date={new Date(aberto.startsAt)} time={null} appointment={aberto} onClose={() => setAberto(null)}
          onSaved={() => { setAberto(null); setFin({}); carregar(); }} />
      )}
      {novo && (
        <AppointmentModal date={new Date()} time={null} appointment={null} initialClientId={client.id} onClose={() => setNovo(false)}
          onSaved={() => { setNovo(false); carregar(); }} />
      )}
    </div>
  );
}
