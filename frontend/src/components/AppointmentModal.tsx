import { useEffect, useState } from 'react';
import { useToast } from '../context/ToastContext';
import { api, ApiError } from '../services/api';
import { getFriendlyAvailabilityMessage, getSuggestedAlternatives } from '../utils/availabilityErrors';
import NovaClienteModal from './NovaClienteModal';
import ModalA11y from './ModalA11y';
import AtendimentoFinanceiro from '../pages/financeiro/AtendimentoFinanceiro';
import { consultarFinanceiroAtivo } from '../hooks/useFinanceiroAtivo';
import { financeiro, newIdempotencyKey, PAYMENT_METHODS, type PaymentMethod } from '../services/financeiro';
import { centsToInput, formatBRL, methodLabel, parseBRLToCents, todayBR } from '../utils/money';
import type { Appointment, AppointmentStatus, Client, RecurringFrequency, RecurringResult, Service } from '../types';

interface Props {
  initialClientId?: string;
  date: Date;
  time: string | null;
  appointment: Appointment | null;
  onClose: () => void;
  onSaved: () => void;
  /** Abre direto na etapa de concluir (ex.: botão "Concluir e receber" do Início). Só vale para agendamento confirmado. */
  startAt?: 'conclude';
}

interface PayLine { id: number; key: string; method: PaymentMethod; amount: string; done: boolean }

const statusOptions: { value: AppointmentStatus; label: string }[] = [
  { value: 'pendente',        label: 'Aguardando confirmação' },
  { value: 'aguardando_pagamento', label: 'Aguardando pagamento' },
  { value: 'confirmado',      label: 'Confirmado' },
  { value: 'concluido',       label: 'Concluído' },
  { value: 'nao_compareceu',  label: 'Não compareceu' },
  { value: 'cancelado',       label: 'Cancelado' },
];

// Espelha as regras da API para oferecer só o que ela aceita (a API continua sendo a autoridade e repete
// a validação). Concluído e falta só existem para agendamento confirmado e depois do início; uma vez
// registrados, travam cliente, serviço e horário (a observação continua livre).
const ATTENDED: AppointmentStatus[] = ['concluido', 'nao_compareceu'];
const NEXT_STATUS: Record<AppointmentStatus, AppointmentStatus[]> = {
  pendente: ['confirmado', 'cancelado'],
  aguardando_pagamento: ['cancelado'],
  confirmado: ['pendente', 'concluido', 'nao_compareceu', 'cancelado'],
  concluido: ['nao_compareceu', 'pendente'],
  nao_compareceu: ['concluido', 'pendente'],
  cancelado: ['pendente'],
};

function statusRules(appt: Appointment) {
  const started = new Date(appt.startsAt).getTime() <= Date.now();
  const allowed = new Set<AppointmentStatus>([appt.status, ...NEXT_STATUS[appt.status]]);
  let hint: string | null = null;
  if (appt.status === 'pendente') {
    hint = 'Para concluir ou marcar falta, confirme o agendamento primeiro.';
  } else if (appt.status === 'aguardando_pagamento') {
    hint = 'Para concluir ou marcar falta, registre antes o pagamento recebido.';
  } else if (appt.status === 'confirmado' && !started) {
    allowed.delete('concluido');
    allowed.delete('nao_compareceu');
    hint = 'Concluir ou marcar falta só fica disponível a partir do início do atendimento.';
  }
  return { allowed, hint };
}

const frequencyOptions: { value: RecurringFrequency; label: string }[] = [
  { value: 'weekly',   label: 'Semanal (toda semana)' },
  { value: 'biweekly', label: 'A cada 2 semanas' },
];

// Data local (não UTC) no formato do input date: YYYY-MM-DD
function toYmd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Formata ISO para exibição amigável
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' });
}

// Soma N dias a uma data e devolve YYYY-MM-DD (mesmo formato que o input date usa).
function addDaysToYmd(base: Date, days: number) {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

const brlCents = (cents: number) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

type Step = 'form' | 'review' | 'conclude' | 'scope-edit' | 'scope-cancel' | 'confirm-cancel' | 'confirm-reject' | 'confirm-paid' | 'result';

interface Change { label: string; from: string; to: string }

const ATENDIMENTO_PASSOS = ['Agendado', 'Em atendimento', 'Concluído'] as const;

export default function AppointmentModal({ date, time, appointment, onClose, onSaved, initialClientId, startAt }: Props) {
  const [clients, setClients]       = useState<Client[]>([]);
  const [services, setServices]     = useState<Service[]>([]);
  const [clientId, setClientId]     = useState(appointment?.clientId || initialClientId || '');
  const [serviceId, setServiceId]   = useState(appointment?.serviceId || '');
  const [timeValue, setTimeValue]   = useState(
    time || (appointment ? new Date(appointment.startsAt).toTimeString().slice(0, 5) : '09:00')
  );
  // Dia do agendamento existente (editável: remarcar). Na criação o dia vem da Agenda (prop `date`).
  const [dateValue, setDateValue]   = useState(appointment ? toYmd(new Date(appointment.startsAt)) : '');
  const [showNewClient, setShowNewClient] = useState(false);
  const [status, setStatus]         = useState<AppointmentStatus>(appointment?.status || 'pendente');
  const [notes, setNotes]           = useState(appointment?.notes || '');
  const [error, setError]           = useState<string | null>(null);
  const [alternatives, setAlternatives] = useState<string[]>([]);
  const { toast } = useToast();
  const [saving, setSaving]         = useState(false);
  // Chegada registrada (check-in): "em atendimento" = confirmado + chegada; não existe status novo.
  const [checkedInAt, setCheckedInAt] = useState<string | null>(appointment?.checkedInAt ?? null);

  // Financeiro (preço final e recebimentos): só quando o servidor o disponibiliza.
  const [finOn, setFinOn]           = useState(false);
  const [finalPrice, setFinalPrice] = useState('');
  const [finalReason, setFinalReason] = useState('');
  const [showFin, setShowFin]       = useState(false);
  // Recebimento junto da conclusão: as linhas usam a MESMA operação do Financeiro (financeiro.receive), cada uma com a sua chave de
  // idempotência; repetir o envio devolve o mesmo resultado em vez de lançar de novo. Concluir e receber continuam independentes no banco.
  const [payOn, setPayOn]           = useState(true);
  const [payLines, setPayLines]     = useState<PayLine[]>([{ id: 1, key: newIdempotencyKey(), method: 'pix', amount: '', done: false }]);
  const [concludedDone, setConcludedDone] = useState(false);
  useEffect(() => {
    if (!appointment) return;
    consultarFinanceiroAtivo().then(setFinOn);
  }, [appointment?.id]);

  // Recorrência (somente na criação)
  const [isRecurring, setIsRecurring] = useState(false);
  const [frequency, setFrequency]     = useState<RecurringFrequency>('weekly');
  const [endMode, setEndMode]         = useState<'date' | 'days'>('date');
  const [endsOn, setEndsOn]           = useState(() => {
    const d = new Date(date);
    d.setMonth(d.getMonth() + 3);
    return d.toISOString().slice(0, 10);
  });
  const [repeatDays, setRepeatDays]   = useState('30');

  // Fluxo de passos
  const [step, setStep]             = useState<Step>(startAt === 'conclude' && appointment?.status === 'confirmado' ? 'conclude' : 'form');
  const [recurringResult, setRecurringResult] = useState<RecurringResult | null>(null);

  const isEditing = !!appointment;
  const isRecurringAppt = isEditing && !!appointment?.recurringGroupId;
  // concluído / com falta: cliente, serviço e horário ficam travados
  const locked = !!appointment && ATTENDED.includes(appointment.status);
  const rules = appointment ? statusRules(appointment) : null;
  // Data ou horário alterados: "Este e os próximos" só atualiza status e observação (limite da API), então a
  // mudança de data/horário vale somente para este agendamento.
  const scheduleChanged = isRecurringAppt && !locked && !!appointment && (
    (dateValue !== '' && dateValue !== toYmd(new Date(appointment.startsAt)))
    || timeValue !== new Date(appointment.startsAt).toTimeString().slice(0, 5)
  );

  useEffect(() => {
    api.get<Client[]>('/clients').then(setClients).catch(() => {});
    api.get<Service[]>('/services').then((s) => setServices(s.filter((x) => x.active))).catch(() => {});
  }, []);

  const selectedService = services.find((s) => s.id === serviceId);

  // Resumo das alterações (edição): antes → depois.
  const changes: Change[] = [];
  if (appointment) {
    const fmt = (d: Date) => d.toLocaleString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    const before = new Date(appointment.startsAt);
    const [hh, mm] = timeValue.split(':').map(Number);
    const after = new Date(dateValue ? `${dateValue}T00:00:00` : appointment.startsAt);
    after.setHours(hh, mm, 0, 0);
    if (clientId !== appointment.clientId) changes.push({ label: 'Cliente', from: appointment.clientName, to: clients.find((c) => c.id === clientId)?.name ?? '—' });
    if (serviceId !== appointment.serviceId) changes.push({ label: 'Serviço', from: appointment.serviceName, to: selectedService?.name ?? '—' });
    if (!locked && after.getTime() !== before.getTime()) changes.push({ label: 'Data e horário', from: fmt(before), to: fmt(after) });
    if (status !== appointment.status) changes.push({ label: 'Status', from: statusOptions.find((o) => o.value === appointment.status)?.label ?? appointment.status, to: statusOptions.find((o) => o.value === status)?.label ?? status });
    if ((notes || '') !== (appointment.notes || '')) changes.push({ label: 'Observação', from: appointment.notes || '(vazia)', to: notes || '(vazia)' });
    if (finOn && status === 'concluido' && appointment.status !== 'concluido' && finalPrice.trim()) changes.push({ label: 'Valor final', from: 'Preço do serviço', to: `R$ ${finalPrice.trim()}` });
  }

  const repeatDaysNum = parseInt(repeatDays, 10);
  const computedEndsOn = endMode === 'days' && repeatDaysNum > 0
    ? addDaysToYmd(date, repeatDaysNum)
    : endsOn;

  function clearError() { setError(null); setAlternatives([]); }

  // Cliente recém-cadastrada na própria agenda: entra na lista e já fica selecionada.
  function handleClientCreated(c: Client) {
    setClients((prev) => [...prev, c].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')));
    setClientId(c.id);
    setShowNewClient(false);
    toast('Cliente cadastrada com sucesso');
  }

  // ── Salvar / criar ─────────────────────────────────────────────────────────

  async function handleSubmit() {
    clearError();
    if (!clientId || !serviceId) { setError('Selecione cliente e serviço.'); return; }

    if (!isEditing && isRecurring && endMode === 'days' && !(repeatDaysNum > 0)) {
      setError('Informe uma quantidade de dias válida (maior que zero).');
      return;
    }

    // Edição: mostra o resumo do que mudou antes de gravar (criação segue direto, para ser rápida)
    if (isEditing) {
      if (changes.length === 0) { setError('Nenhuma alteração para salvar.'); return; }
      setStep('review');
      return;
    }

    await doSave('single');
  }

  // Depois do resumo: série recorrente pede o escopo; senão grava.
  async function confirmReview() {
    if (isRecurringAppt) { setStep('scope-edit'); return; }
    await doSave('single');
  }

  // Check-in: registra a chegada (POST /appointments/:id/check-in). Não muda o status.
  async function doCheckIn() {
    if (!appointment) return;
    clearError();
    setSaving(true);
    try {
      const r = await api.post<Appointment>(`/appointments/${appointment.id}/check-in`);
      setCheckedInAt(r.checkedInAt ?? new Date().toISOString());
      toast('Atendimento iniciado');
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível iniciar o atendimento.');
    } finally {
      setSaving(false);
    }
  }

  async function doSave(scope: 'single' | 'following', statusOverride?: AppointmentStatus, afterSave?: () => Promise<void>) {
    const st = statusOverride ?? status;
    setSaving(true);
    try {
      const [h, m] = timeValue.split(':').map(Number);
      const startsAt = new Date(date);
      if (isEditing && dateValue) {
        const [y, mo, d] = dateValue.split('-').map(Number);
        startsAt.setFullYear(y, mo - 1, d);
      }
      startsAt.setHours(h, m, 0, 0);

      if (isEditing && scope === 'following') {
        // Atualiza este e os próximos (status + notes)
        const r = await api.put<{ updated?: number; skipped?: number } | undefined>(`/appointments/${appointment!.id}/and-following`, { status: st, notes: notes || null });
        if (r?.skipped) {
          toast(`${r.updated ?? 0} agendamento(s) atualizado(s); ${r.skipped} ignorado(s) por já estarem cancelados, concluídos, com falta ou não aceitarem essa mudança`, 'info');
        } else {
          toast('Agendamentos atualizados');
        }
        onSaved();
        return;
      }

      if (isEditing) {
        // Preço final (opcional) ao CONCLUIR: a API valida valor, justificativa e histórico; vazio = vale o preço do serviço.
        let finalFields: { finalPriceCents?: number; finalPriceReason?: string } = {};
        if (finOn && st === 'concluido' && appointment!.status !== 'concluido' && finalPrice.trim()) {
          const fp = parseBRLToCents(finalPrice, { allowZero: true });
          if (fp == null) { setError('Valor final inválido.'); return; }
          finalFields = { finalPriceCents: fp, ...(finalReason.trim() ? { finalPriceReason: finalReason.trim() } : {}) };
        }
        await api.put(`/appointments/${appointment!.id}`, locked
          ? { status: st, notes: notes || null, ...finalFields }
          : { clientId, serviceId, startsAt: startsAt.toISOString(), status: st, notes: notes || null, ...finalFields });
        const moved = !locked && startsAt.getTime() !== new Date(appointment!.startsAt).getTime();
        toast(moved ? 'Agendamento remarcado. A cliente não é avisada automaticamente.' : 'Agendamento atualizado');
        if (afterSave) await afterSave(); else onSaved();
        return;
      }

      if (isRecurring) {
        const result = await api.post<RecurringResult>('/appointments/recurring', {
          clientId, serviceId, startsAt: startsAt.toISOString(),
          frequency, endsOn: computedEndsOn, notes: notes || null,
        });
        setRecurringResult(result);
        setStep('result');
        return;
      }

      await api.post('/appointments', {
        clientId, serviceId, startsAt: startsAt.toISOString(), status, notes: notes || null,
      });
      toast('Agendamento criado com sucesso');
      onSaved();
    } catch (err) {
      setError(getFriendlyAvailabilityMessage(err, 'Não foi possível salvar o agendamento.'));
      setAlternatives(getSuggestedAlternatives(err));
      setStep('form');
    } finally {
      setSaving(false);
    }
  }

  // ── Concluir e receber (fluxo único) ───────────────────────────────────────

  const serviceValueCents = (finalPrice.trim() ? parseBRLToCents(finalPrice, { allowZero: true }) : null) ?? selectedService?.priceCents ?? 0;
  const lineCents = (l: PayLine) => (l.amount.trim() ? parseBRLToCents(l.amount) : null);
  const typedTotal = payLines.reduce((n, l) => n + (lineCents(l) ?? 0), 0);

  // Ao abrir a etapa, sugere o valor do serviço na primeira linha (a profissional pode ajustar).
  useEffect(() => {
    if (step === 'conclude' && serviceValueCents > 0) {
      setPayLines((ls) => (ls.every((l) => !l.amount.trim() && !l.done) ? [{ ...ls[0], amount: centsToInput(serviceValueCents) }] : ls));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  function editLine(id: number, patch: Partial<PayLine>) {
    // qualquer edição troca a chave: é outro pedido; reenviar SEM editar reaproveita a chave
    setPayLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch, key: newIdempotencyKey() } : l)));
  }
  function addLine() {
    const rest = Math.max(serviceValueCents - typedTotal, 0);
    setPayLines((ls) => [...ls, { id: Math.max(...ls.map((l) => l.id)) + 1, key: newIdempotencyKey(), method: 'dinheiro', amount: rest > 0 ? centsToInput(rest) : '', done: false }]);
  }

  async function receivePayments(): Promise<boolean> {
    const day = todayBR();
    for (const l of payLines) {
      if (l.done || !l.amount.trim()) continue;
      const cents = parseBRLToCents(l.amount);
      if (cents == null) { setError('Valor de recebimento inválido.'); return false; }
      try {
        await financeiro.receive(appointment!.id, l.key, { amountCents: cents, method: l.method, occurredOn: day });
        setPayLines((ls) => ls.map((x) => (x.id === l.id ? { ...x, done: true } : x)));
      } catch (err) {
        setError(`O atendimento foi concluído, mas o recebimento de ${formatBRL(cents)} (${methodLabel(l.method)}) não foi registrado: ${err instanceof Error ? err.message : 'erro desconhecido'}. Tente de novo ou registre no Financeiro.`);
        return false;
      }
    }
    return true;
  }

  async function concludeAndReceive() {
    clearError();
    const wantsPay = finOn && payOn && payLines.some((l) => !l.done && l.amount.trim());
    if (wantsPay) {
      for (const l of payLines) {
        if (l.done || !l.amount.trim()) continue;
        const c = lineCents(l);
        if (c == null || c <= 0) { setError('Informe valores de recebimento válidos (maiores que zero).'); return; }
      }
      if (serviceValueCents > 0 && typedTotal > serviceValueCents) { setError('Os recebimentos somam mais que o valor do atendimento. Ajuste os valores.'); return; }
    }
    if (concludedDone) {            // atendimento já concluído nesta janela: só falta o recebimento
      setSaving(true);
      const ok = await receivePayments();
      setSaving(false);
      if (ok) onSaved();
      return;
    }
    setStatus('concluido');
    await doSave('single', 'concluido', async () => {
      setConcludedDone(true);
      if (wantsPay && !(await receivePayments())) return;   // permanece aberto, mostrando o erro e permitindo repetir
      onSaved();
    });
  }

  // Se o atendimento já foi concluído nesta janela, fechar precisa atualizar a Agenda (como se tivesse salvo).
  const close = concludedDone ? onSaved : onClose;

  // ── Cancelar ───────────────────────────────────────────────────────────────

  async function handleCancelClick() {
    if (!appointment) return;
    if (isRecurringAppt) { setStep('scope-cancel'); return; }
    setStep('confirm-cancel');
  }

  async function doCancel(scope: 'single' | 'following') {
    setSaving(true);
    try {
      if (scope === 'following') {
        const r = await api.delete<{ updated?: number; skipped?: number } | undefined>(`/appointments/${appointment!.id}/and-following`);
        if (r?.skipped) {
          toast(`${r.updated ?? 0} cancelado(s); ${r.skipped} mantido(s) porque já foram concluídos ou marcados como falta`, 'info');
          onSaved();
          return;
        }
      } else {
        await api.delete(`/appointments/${appointment!.id}`);
      }
      toast('Agendamento cancelado', 'info');
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao cancelar.');
      setStep('form');
    } finally {
      setSaving(false);
    }
  }

  // ── Confirmar / recusar solicitação (somente status pendente) ──────────────

  async function doConfirm() {
    if (!appointment) return;
    clearError();
    setSaving(true);
    try {
      await api.post(`/appointments/${appointment.id}/confirm`);
      toast('Agendamento confirmado');
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível confirmar o agendamento.');
    } finally {
      setSaving(false);
    }
  }

  async function doReject() {
    if (!appointment) return;
    setSaving(true);
    try {
      await api.post(`/appointments/${appointment.id}/reject`);
      toast('Solicitação recusada', 'info');
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível recusar a solicitação.');
      setStep('form');
    } finally {
      setSaving(false);
    }
  }

  // ── Pagamento recebido (somente status aguardando_pagamento) ───────────────

  async function doMarkPaid() {
    if (!appointment) return;
    setSaving(true);
    try {
      await api.post(`/appointments/${appointment.id}/mark-paid`);
      toast('Pagamento registrado — agendamento confirmado');
      onSaved();
    } catch (err) {
      if (err instanceof ApiError && err.reason === 'hold_expired') {
        // a reserva venceu: o horário já foi liberado, então atualiza a Agenda
        toast(err.message, 'error');
        onSaved();
        return;
      }
      setError(err instanceof Error ? err.message : 'Não foi possível registrar o pagamento.');
      setStep('form');
    } finally {
      setSaving(false);
    }
  }

  // ── Labels ─────────────────────────────────────────────────────────────────

  const dateLabel = date.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <>
    <div
      role="dialog" aria-modal="true" aria-label="Agendamento" className="fixed inset-0 bg-ink/50 flex items-end sm:items-center justify-center sm:p-4 z-50"
      onClick={(e) => { if (e.target === e.currentTarget) close(); }}
    >
      <ModalA11y onClose={() => (step === 'form' || step === 'result' || concludedDone ? close() : setStep('form'))} />
      <div className="bg-white rounded-t-3xl sm:rounded-2xl w-full max-w-md shadow-xl flex flex-col max-h-[92vh] sm:max-h-[90vh]">

        {/* cabeçalho — fixo no topo */}
        <div className="flex items-start justify-between p-6 pb-4 border-b border-wine-50 shrink-0">
          <div>
            <h3 className="font-display text-xl text-wine-700">
              {step === 'result' ? 'Série criada'
                : step === 'scope-edit' ? 'Editar recorrente'
                : step === 'scope-cancel' ? 'Cancelar recorrente'
                : step === 'confirm-cancel' ? 'Cancelar agendamento'
                : step === 'confirm-reject' ? 'Recusar solicitação'
                : step === 'review' ? 'Revisar alterações'
                : step === 'conclude' ? 'Concluir atendimento'
                : step === 'confirm-paid' ? 'Sinal recebido'
                : isEditing ? 'Editar agendamento' : 'Novo agendamento'}
            </h3>
            <p className="text-sm text-ink/50 mt-0.5 sentence-case">{dateLabel}</p>
          </div>
          <button
            onClick={close}
            className="p-1.5 rounded-lg hover:bg-wine-50 text-ink/40 hover:text-ink/70 transition-colors"
            aria-label="Fechar"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* ── step: resultado da série criada ──────────────────────────────── */}
        {step === 'result' && recurringResult && (
          <div className="p-6 space-y-4 overflow-y-auto">
            <div className="rounded-xl bg-green-50 border border-green-200 p-4">
              <p className="text-sm font-semibold text-green-800 mb-1">
                {recurringResult.created.length} agendamento{recurringResult.created.length !== 1 ? 's' : ''} criado{recurringResult.created.length !== 1 ? 's' : ''}
              </p>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {recurringResult.created.map((c) => (
                  <span key={c.startsAt} className="text-xs px-2 py-0.5 bg-green-100 text-green-700 rounded-md">
                    {fmtDate(c.startsAt)}
                  </span>
                ))}
              </div>
            </div>

            {recurringResult.skipped.length > 0 && (
              <div className="rounded-xl bg-amber-50 border border-amber-200 p-4">
                <p className="text-sm font-semibold text-amber-800 mb-1">
                  {recurringResult.skipped.length} data{recurringResult.skipped.length !== 1 ? 's' : ''} pulada{recurringResult.skipped.length !== 1 ? 's' : ''} (conflito)
                </p>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {recurringResult.skipped.map((s) => (
                    <span key={s.startsAt} className="text-xs px-2 py-0.5 bg-amber-100 text-amber-700 rounded-md">
                      {fmtDate(s.startsAt)}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div className="flex justify-end pt-1">
              <button
                onClick={onSaved}
                className="px-5 py-2 text-sm rounded-lg bg-wine-600 text-white hover:bg-wine-700 transition-colors font-medium"
              >
                Fechar
              </button>
            </div>
          </div>
        )}

        {/* ── step: escopo de edição ────────────────────────────────────────── */}
        {step === 'scope-edit' && (
          <div className="p-6 space-y-4 overflow-y-auto">
            <p className="text-sm text-ink/70">Este agendamento faz parte de uma série recorrente. O que deseja alterar?</p>
            <p className="text-xs text-ink/40">Nota: "Este e os próximos" atualiza somente status e observação.</p>
            {scheduleChanged && (
              <p className="text-xs text-wine-700 bg-wine-50 border border-wine-100 rounded-lg px-3 py-2">
                Você alterou a data ou o horário: essa mudança vale somente para este agendamento.
              </p>
            )}
            <div className="flex flex-col gap-2 pt-1">
              <button
                onClick={() => doSave('single')}
                disabled={saving}
                className="w-full px-4 py-3 text-sm rounded-xl border border-wine-200 text-wine-700 hover:bg-wine-50 transition-colors text-left font-medium disabled:opacity-60"
              >
                Somente este agendamento
              </button>
              <button
                onClick={() => doSave('following')}
                disabled={saving || scheduleChanged}
                className="w-full px-4 py-3 text-sm rounded-xl bg-wine-600 text-white hover:bg-wine-700 transition-colors text-left font-medium disabled:opacity-60 disabled:cursor-not-allowed"
              >
                Este e os próximos
              </button>
            </div>
            <div className="flex justify-end pt-1">
              <button onClick={() => setStep('form')} className="text-sm text-ink/50 hover:text-ink/70">
                Voltar
              </button>
            </div>
          </div>
        )}

        {/* ── step: confirmar cancelamento simples ─────────────────────────── */}
        {step === 'confirm-cancel' && (
          <div className="p-6 space-y-4 overflow-y-auto">
            <p className="text-sm text-ink/70">O horário voltará a ficar disponível. Confirma o cancelamento?</p>
            <div className="flex flex-col gap-2 pt-1">
              <button
                onClick={() => doCancel('single')}
                disabled={saving}
                className="w-full px-4 py-3 text-sm rounded-xl border border-rose-200 text-rose-700 hover:bg-rose-50 transition-colors text-left font-medium disabled:opacity-60"
              >
                {saving ? 'Cancelando…' : 'Sim, cancelar agendamento'}
              </button>
            </div>
            <div className="flex justify-end pt-1">
              <button onClick={() => setStep('form')} className="text-sm text-ink/50 hover:text-ink/70">
                Voltar
              </button>
            </div>
          </div>
        )}

        {/* ── step: confirmar recusa da solicitação ────────────────────────── */}
        {step === 'confirm-reject' && (
          <div className="p-6 space-y-4 overflow-y-auto">
            <p className="text-sm text-ink/70">
              A solicitação será cancelada, o horário voltará a ficar disponível e, se ela veio da página pública ou do WhatsApp, a cliente poderá ser avisada. Confirma a recusa?
            </p>
            <div className="flex flex-col gap-2 pt-1">
              <button
                onClick={doReject}
                disabled={saving}
                className="w-full px-4 py-3 text-sm rounded-xl border border-rose-200 text-rose-700 hover:bg-rose-50 transition-colors text-left font-medium disabled:opacity-60"
              >
                {saving ? 'Recusando…' : 'Sim, recusar solicitação'}
              </button>
            </div>
            <div className="flex justify-end pt-1">
              <button onClick={() => setStep('form')} className="text-sm text-ink/50 hover:text-ink/70">
                Voltar
              </button>
            </div>
          </div>
        )}

        {/* ── step: confirmar pagamento recebido ───────────────────────────── */}
        {step === 'confirm-paid' && (
          <div className="p-6 space-y-4 overflow-y-auto">
            <p className="text-sm text-ink/70">
              Confirma que o sinal{appointment?.depositCents != null ? ` de ${brlCents(appointment.depositCents)}` : ''} da reserva foi
              recebido? O agendamento será confirmado e a cliente será avisada. Este é o sinal da reserva: o pagamento do atendimento é lançado depois, no Financeiro.
            </p>
            <div className="flex flex-col gap-2 pt-1">
              <button
                onClick={doMarkPaid}
                disabled={saving}
                className="w-full px-4 py-3 text-sm rounded-xl bg-wine-600 text-white hover:bg-wine-700 transition-colors text-left font-medium disabled:opacity-60"
              >
                {saving ? 'Confirmando…' : 'Sim, sinal recebido'}
              </button>
            </div>
            <div className="flex justify-end pt-1">
              <button onClick={() => setStep('form')} className="text-sm text-ink/50 hover:text-ink/70">
                Voltar
              </button>
            </div>
          </div>
        )}

        {/* ── step: escopo de cancelamento ─────────────────────────────────── */}
        {step === 'scope-cancel' && (
          <div className="p-6 space-y-4 overflow-y-auto">
            <p className="text-sm text-ink/70">Este agendamento faz parte de uma série recorrente. O que deseja cancelar?</p>
            <div className="flex flex-col gap-2 pt-1">
              <button
                onClick={() => doCancel('single')}
                disabled={saving}
                className="w-full px-4 py-3 text-sm rounded-xl border border-wine-200 text-wine-700 hover:bg-wine-50 transition-colors text-left font-medium disabled:opacity-60"
              >
                Somente este agendamento
              </button>
              <button
                onClick={() => doCancel('following')}
                disabled={saving}
                className="w-full px-4 py-3 text-sm rounded-xl border border-rose-200 text-rose-700 hover:bg-rose-50 transition-colors text-left font-medium disabled:opacity-60"
              >
                Este e os próximos
              </button>
            </div>
            <div className="flex justify-end pt-1">
              <button onClick={() => setStep('form')} className="text-sm text-ink/50 hover:text-ink/70">
                Voltar
              </button>
            </div>
          </div>
        )}

        {/* ── step: resumo das alterações (edição) ──────────────────────────── */}
        {step === 'review' && (
          <div className="p-6 space-y-4 overflow-y-auto">
            <p className="text-sm text-ink/70">Confira o que vai mudar antes de salvar.</p>
            <dl className="rounded-xl border border-wine-100 divide-y divide-wine-50 overflow-hidden">
              {changes.map((c) => (
                <div key={c.label} className="px-4 py-3">
                  <dt className="text-[11px] uppercase tracking-widest font-semibold text-ink/40">{c.label}</dt>
                  <dd className="mt-1 text-sm text-ink/50 line-through decoration-ink/20">{c.from}</dd>
                  <dd className="text-sm font-medium text-wine-800">{c.to}</dd>
                </div>
              ))}
            </dl>
            {changes.some((c) => c.label === 'Data e horário') && (
              <p className="text-xs text-ink/50">Remarcar não envia mensagem à cliente. Conflitos com outros agendamentos continuam bloqueados.</p>
            )}
            <div className="flex gap-2 justify-end pt-1">
              <button onClick={() => setStep('form')} className="btn-secondary">Voltar e editar</button>
              <button onClick={confirmReview} disabled={saving} className="btn-primary">{saving ? 'Salvando…' : 'Confirmar e salvar'}</button>
            </div>
          </div>
        )}

        {/* ── step: concluir atendimento ────────────────────────────────────── */}
        {step === 'conclude' && appointment && (
          <div className="p-6 space-y-4 overflow-y-auto">
            <p className="text-sm text-ink/70">
              {appointment.clientName} · {appointment.serviceName}. {finOn
                ? <>Concluir encerra o atendimento; <strong>concluído não significa pago</strong>. O recebimento é registrado à parte (abaixo) e pode ser parcial.</>
                : <>Concluir encerra o atendimento e <strong>não registra pagamento</strong>.</>}
            </p>
            {finOn && (
              <div className="rounded-xl border border-wine-100 bg-wine-50/40 p-3 space-y-2">
                <p className="text-sm font-medium text-ink/70">Valor final (opcional)</p>
                <p className="text-xs text-ink/50">Deixe em branco para valer o preço do serviço.</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input className="input" inputMode="decimal" placeholder="Valor final (R$)" value={finalPrice} onChange={(e) => setFinalPrice(e.target.value)} />
                  <input className="input" maxLength={300} placeholder="Justificativa (se diferir)" value={finalReason} onChange={(e) => setFinalReason(e.target.value)} />
                </div>
              </div>
            )}
            {finOn && (
              <fieldset className="rounded-xl border border-wine-100 p-3 space-y-3" disabled={saving}>
                <legend className="px-1 text-sm font-medium text-ink/70">Recebimento</legend>
                <label className="flex items-center gap-2 text-sm text-ink/75 min-h-[40px]">
                  <input type="checkbox" checked={payOn} onChange={(e) => setPayOn(e.target.checked)} disabled={concludedDone} />
                  Registrar o recebimento agora
                </label>
                {payOn && (
                  <>
                    <p className="text-xs text-ink/60">
                      Valor do atendimento: <strong>{formatBRL(serviceValueCents)}</strong>. Se a cliente pagou menos agora, digite o valor recebido: o restante fica em &quot;A receber&quot;.
                    </p>
                    {payLines.map((l, i) => (
                      <div key={l.id} className="grid grid-cols-[1fr_1fr] sm:grid-cols-[1fr_1fr_auto] gap-2 items-end">
                        <div>
                          <label htmlFor={`pm-${l.id}`} className="block text-xs font-medium text-ink/60 mb-1">Meio {payLines.length > 1 ? i + 1 : ''}</label>
                          <select id={`pm-${l.id}`} className="input" value={l.method} disabled={l.done} onChange={(e) => editLine(l.id, { method: e.target.value as PaymentMethod })}>
                            {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{methodLabel(m)}</option>)}
                          </select>
                        </div>
                        <div>
                          <label htmlFor={`pv-${l.id}`} className="block text-xs font-medium text-ink/60 mb-1">Valor (R$)</label>
                          <input id={`pv-${l.id}`} className="input" inputMode="decimal" value={l.amount} disabled={l.done} onChange={(e) => editLine(l.id, { amount: e.target.value })} />
                        </div>
                        <div className="col-span-2 sm:col-span-1 text-xs min-h-[40px] flex items-center">
                          {l.done
                            ? <span className="text-sage-700 font-medium">✓ registrado</span>
                            : payLines.length > 1 && <button type="button" className="btn-ghost" onClick={() => setPayLines((ls) => ls.filter((x) => x.id !== l.id))}>Remover</button>}
                        </div>
                      </div>
                    ))}
                    <button type="button" className="btn-ghost" onClick={addLine}>+ Dividir em outro meio</button>
                    <p className="text-xs text-ink/60" aria-live="polite">
                      Recebido agora: <strong>{formatBRL(typedTotal)}</strong>
                      {serviceValueCents > 0 && (typedTotal < serviceValueCents ? <> · ficará a receber {formatBRL(serviceValueCents - typedTotal)}</> : typedTotal === serviceValueCents ? ' · quita o atendimento' : ' · acima do valor')}
                    </p>
                  </>
                )}
              </fieldset>
            )}
            {error && <p className="rounded-xl bg-rose-50 border border-rose-200 p-3 text-sm text-rose-700" role="alert">{error}</p>}
            <div className="flex gap-2 justify-end pt-1">
              {concludedDone
                ? <button onClick={close} className="btn-secondary">Fechar sem receber agora</button>
                : <button onClick={() => { clearError(); setStep('form'); }} className="btn-secondary">Voltar</button>}
              <button onClick={concludeAndReceive} disabled={saving} className="btn-primary">
                {saving ? 'Salvando…' : concludedDone ? 'Registrar recebimento' : finOn && payOn ? 'Concluir e registrar recebimento' : 'Concluir atendimento'}
              </button>
            </div>
          </div>
        )}

        {/* ── step: formulário principal ────────────────────────────────────── */}
        {step === 'form' && (
          <div className="p-6 flex flex-col gap-4 overflow-y-auto">

            {/* atendimento: etapas e próxima ação (agendado → em atendimento → concluído; cancelado e falta são resultados à parte) */}
            {isEditing && (appointment!.status === 'confirmado' || appointment!.status === 'concluido') && (() => {
              const concluido = appointment!.status === 'concluido';
              const emAtendimento = !concluido && !!checkedInAt;
              const atual = concluido ? 2 : emAtendimento ? 1 : 0;
              const iniciou = new Date(appointment!.startsAt).getTime() <= Date.now();
              return (
                <section aria-label="Atendimento" className="rounded-xl border border-wine-100 bg-wine-50/40 p-3.5 space-y-3">
                  <ol className="flex items-center gap-1.5 text-xs" aria-label="Etapas do atendimento">
                    {ATENDIMENTO_PASSOS.map((p, i) => (
                      <li key={p} aria-current={i === atual ? 'step' : undefined} className="flex items-center gap-1.5 min-w-0">
                        <span className={`w-5 h-5 rounded-full text-[11px] font-semibold flex items-center justify-center shrink-0 ${i < atual ? 'bg-wine-600 text-white' : i === atual ? 'bg-gold-500 text-wine-800 ring-2 ring-gold-500/30' : 'bg-white border border-wine-200 text-ink/40'}`}>{i < atual ? '✓' : i + 1}</span>
                        <span className={`truncate ${i === atual ? 'font-semibold text-wine-800' : 'text-ink/45'}`}>{p}</span>
                        {i < ATENDIMENTO_PASSOS.length - 1 && <span className="w-3 h-px bg-wine-200 shrink-0" aria-hidden="true" />}
                      </li>
                    ))}
                  </ol>
                  {!concluido && !emAtendimento && (
                    <div className="flex flex-col sm:flex-row gap-2">
                      <button onClick={doCheckIn} disabled={saving} className="btn-primary flex-1">{saving ? 'Iniciando…' : 'Iniciar atendimento'}</button>
                      {iniciou && <button onClick={() => { setStatus('nao_compareceu'); clearError(); setStep('review'); }} className="btn-secondary">Marcar falta</button>}
                    </div>
                  )}
                  {emAtendimento && (
                    <div className="space-y-1.5">
                      <p className="text-xs text-ink/55">Chegada às {new Date(checkedInAt!).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}.</p>
                      <button onClick={() => { clearError(); setStep('conclude'); }} disabled={saving || !iniciou} className="btn-primary w-full">Concluir atendimento</button>
                      {!iniciou && <p className="text-xs text-ink/50">Concluir fica disponível a partir do horário de início.</p>}
                    </div>
                  )}
                  {concluido && (
                    <p className="text-xs text-ink/60">
                      Atendimento concluído. <strong>Concluído não significa recebido:</strong> o pagamento (inclusive parcial) é registrado à parte{finOn ? ', no botão do Financeiro abaixo' : ', no Financeiro'}.
                    </p>
                  )}
                </section>
              );
            })()}

            {/* solicitação aguardando confirmação: confirmar ou recusar */}
            {isEditing && appointment?.status === 'pendente' && (
              <div className="rounded-xl bg-amber-50 border border-amber-200 p-3">
                <p className="text-sm font-medium text-amber-800">Aguardando confirmação</p>
                <div className="flex flex-col sm:flex-row gap-2 mt-2">
                  <button
                    onClick={doConfirm}
                    disabled={saving}
                    className="flex-1 px-4 py-2.5 text-sm rounded-lg bg-wine-600 text-white hover:bg-wine-700 disabled:opacity-60 transition-colors font-medium"
                  >
                    {saving ? 'Confirmando…' : 'Confirmar'}
                  </button>
                  <button
                    onClick={() => { clearError(); setStep('confirm-reject'); }}
                    disabled={saving}
                    className="flex-1 px-4 py-2.5 text-sm rounded-lg border border-rose-200 bg-white text-rose-700 hover:bg-rose-50 disabled:opacity-60 transition-colors font-medium"
                  >
                    Recusar
                  </button>
                </div>
              </div>
            )}

            {/* sinal aguardando pagamento: marcar como recebido */}
            {isEditing && appointment?.status === 'aguardando_pagamento' && (
              <div className="rounded-xl bg-sky-50 border border-sky-200 p-3">
                <p className="text-sm font-medium text-sky-800">Aguardando sinal da reserva</p>
                {(appointment.depositCents != null || appointment.expiresAt) && (
                  <p className="text-xs text-sky-700 mt-0.5">
                    {appointment.depositCents != null && <>Sinal: {brlCents(appointment.depositCents)}</>}
                    {appointment.depositCents != null && appointment.expiresAt && ' · '}
                    {appointment.expiresAt && (
                      <>reserva vale até {new Date(appointment.expiresAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</>
                    )}
                  </p>
                )}
                <div className="mt-2">
                  <button
                    onClick={() => { clearError(); setStep('confirm-paid'); }}
                    disabled={saving}
                    className="w-full px-4 py-2.5 text-sm rounded-lg bg-wine-600 text-white hover:bg-wine-700 disabled:opacity-60 transition-colors font-medium"
                  >
                    Sinal recebido
                  </button>
                </div>
              </div>
            )}

            {/* badge série recorrente */}
            {isRecurringAppt && (
              <div className="flex items-center gap-2 text-xs text-wine-600 bg-wine-50 border border-wine-100 rounded-lg px-3 py-2">
                <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                <span>Agendamento recorrente</span>
              </div>
            )}

            {locked && (
              <div className="rounded-xl bg-wine-50 border border-wine-100 p-3 text-sm text-ink/70">
                Atendimento {appointment!.status === 'concluido' ? 'concluído' : 'com falta'}: cliente, serviço e horário não podem mais ser alterados, e o agendamento não pode ser cancelado.
                Para corrigir, mude o status para "Aguardando confirmação", salve e depois edite.
              </div>
            )}

            {/* cliente */}
            <Field label="Cliente">
              <select className="input" value={clientId} disabled={locked} onChange={(e) => setClientId(e.target.value)}>
                <option value="">Selecione...</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>{c.name} — {c.phone}</option>
                ))}
              </select>
            </Field>
            {!locked && (
              <button
                type="button"
                onClick={() => setShowNewClient(true)}
                className="text-sm font-medium text-wine-600 hover:text-wine-700"
              >
                + Cadastrar nova cliente
              </button>
            )}

            {/* serviço */}
            <Field label="Serviço">
              <select className="input" value={serviceId} disabled={locked} onChange={(e) => setServiceId(e.target.value)}>
                <option value="">Selecione...</option>
                {services.map((s) => (
                  <option key={s.id} value={s.id}>{s.name} ({s.durationMinutes} min)</option>
                ))}
              </select>
              {selectedService && (
                <span className="block text-xs text-ink/40 mt-1">
                  Duração: {selectedService.durationMinutes} min
                  {selectedService.priceCents
                    ? ` · ${(selectedService.priceCents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`
                    : ''}
                </span>
              )}
            </Field>

            {/* data (somente ao editar: remarcar) */}
            {isEditing && (
              <Field label="Data">
                <input
                  className="input"
                  type="date"
                  value={dateValue}
                  disabled={locked}
                  onChange={(e) => setDateValue(e.target.value)}
                />
                {!locked && (
                  <span className="block text-xs text-ink/40 mt-1">
                    Alterar a data ou o horário remarca este agendamento (conflitos com outros agendamentos são conferidos) e não envia mensagem à cliente.
                  </span>
                )}
              </Field>
            )}

            {/* horário */}
            <Field label="Horário">
              <input
                className="input"
                type="time"
                step={60}
                value={timeValue}
                disabled={locked}
                onChange={(e) => setTimeValue(e.target.value)}
              />
              <span className="block text-xs text-ink/40 mt-1">Pode digitar qualquer horário, ex.: 14:15</span>
            </Field>

            {/* status (somente ao editar) */}
            {isEditing && (
              <Field label="Status">
                <select className="input" value={status} onChange={(e) => setStatus(e.target.value as AppointmentStatus)}>
                  {statusOptions.filter((o) => rules?.allowed.has(o.value)).map((s) => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
                {rules?.hint && <span className="block text-xs text-ink/40 mt-1">{rules.hint}</span>}
              </Field>
            )}

            {isEditing && finOn && status === 'concluido' && appointment!.status !== 'concluido' && (
              <div className="rounded-xl border border-wine-100 bg-wine-50/40 p-3 space-y-2">
                <p className="text-sm font-medium text-ink/70">Valor final (opcional)</p>
                <p className="text-xs text-ink/50">Deixe em branco para valer o preço do serviço. Concluir não registra pagamento: o recebimento é lançado à parte, no Financeiro.</p>
                <div className="grid grid-cols-2 gap-2">
                  <input className="input" inputMode="decimal" placeholder="Valor final (R$)" value={finalPrice} onChange={(e) => setFinalPrice(e.target.value)} />
                  <input className="input" maxLength={300} placeholder="Justificativa (se diferir)" value={finalReason} onChange={(e) => setFinalReason(e.target.value)} />
                </div>
              </div>
            )}
            {isEditing && finOn && appointment!.status === 'concluido' && (
              <button type="button" className="btn-secondary w-full" onClick={() => setShowFin(true)}>Financeiro do atendimento (recebimentos e valor final)</button>
            )}

            {/* observação */}
            <Field label="Observação">
              <textarea className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Field>

            {/* ── recorrência (somente criação) ─────────────────────────────── */}
            {!isEditing && (
              <div className="rounded-xl border border-wine-100 bg-wine-50/40 p-4 space-y-3">
                <label className="flex items-center gap-3 cursor-pointer select-none">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={isRecurring}
                    onClick={() => setIsRecurring((v) => !v)}
                    className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-wine-600 ${
                      isRecurring ? 'bg-wine-600' : 'bg-ink/20'
                    }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-sm ring-0 transition-transform ${
                        isRecurring ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                  <span className="text-sm font-medium text-ink/70">Repetir agendamento</span>
                </label>

                {isRecurring && (
                  <div className="space-y-3 pt-1">
                    <Field label="Frequência">
                      <select className="input" value={frequency} onChange={(e) => setFrequency(e.target.value as RecurringFrequency)}>
                        {frequencyOptions.map((f) => (
                          <option key={f.value} value={f.value}>{f.label}</option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Repetir até">
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setEndMode('date')}
                          className={`flex-1 text-sm py-2 rounded-lg border transition-colors ${
                            endMode === 'date' ? 'bg-wine-600 text-white border-wine-600' : 'border-wine-100 text-ink/60 hover:bg-wine-50'
                          }`}
                        >
                          Até uma data
                        </button>
                        <button
                          type="button"
                          onClick={() => setEndMode('days')}
                          className={`flex-1 text-sm py-2 rounded-lg border transition-colors ${
                            endMode === 'days' ? 'bg-wine-600 text-white border-wine-600' : 'border-wine-100 text-ink/60 hover:bg-wine-50'
                          }`}
                        >
                          Por X dias
                        </button>
                      </div>
                    </Field>

                    {endMode === 'date' ? (
                      <Field label="Data final">
                        <input
                          className="input"
                          type="date"
                          value={endsOn}
                          min={date.toISOString().slice(0, 10)}
                          onChange={(e) => setEndsOn(e.target.value)}
                        />
                      </Field>
                    ) : (
                      <Field label="Repetir por (dias)">
                        <input
                          className="input"
                          type="number"
                          min={1}
                          value={repeatDays}
                          onChange={(e) => setRepeatDays(e.target.value)}
                        />
                        <p className="text-xs text-ink/40 mt-1">
                          {repeatDaysNum > 0
                            ? `Término previsto: ${new Date(computedEndsOn + 'T00:00:00').toLocaleDateString('pt-BR')}`
                            : 'Informe uma quantidade de dias válida.'}
                        </p>
                      </Field>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* erro */}
            {error && (
              <div className={`rounded-xl border p-4 text-sm ${alternatives.length > 0 ? 'bg-amber-50 border-amber-200 text-amber-900' : 'bg-rose-50 border-rose-200 text-rose-700'}`} role="alert">
                <p className="font-medium">{error}</p>
                {alternatives.length > 0 && (
                  <div className="mt-3">
                    <p className="text-amber-800/80 text-xs mb-2">Horários livres sugeridos (você escolhe; o que já preencheu foi mantido):</p>
                    <div className="flex flex-wrap gap-2">
                      {alternatives.map((iso) => (
                        <button
                          key={iso}
                          type="button"
                          onClick={() => { setTimeValue(new Date(iso).toTimeString().slice(0, 5)); clearError(); }}
                          className="min-h-[40px] px-3.5 py-1.5 rounded-lg bg-white border border-amber-300 text-amber-900 text-sm font-medium hover:bg-amber-100 transition-colors"
                        >
                          {new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* rodapé */}
            <div className="flex items-center justify-between pt-1">
              <div>
                {isEditing && !locked && (
                  <button
                    onClick={handleCancelClick}
                    disabled={saving}
                    className="text-sm text-rose-600 hover:text-rose-700 hover:underline disabled:opacity-40 transition-colors"
                  >
                    Cancelar agendamento
                  </button>
                )}
              </div>
              <div className="flex gap-2">
                <button onClick={close} className="btn-secondary">Fechar</button>
                <button onClick={handleSubmit} disabled={saving} className="btn-primary">
                  {saving ? 'Salvando…' : isEditing ? 'Revisar e salvar' : 'Salvar'}
                </button>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
    {showFin && appointment && (
      <AtendimentoFinanceiro appointmentId={appointment.id} startsAt={appointment.startsAt} title={`${appointment.clientName} · ${appointment.serviceName}`} onClose={() => setShowFin(false)} onChanged={() => {}} />
    )}
    {showNewClient && (
      <NovaClienteModal onClose={() => setShowNewClient(false)} onCreated={handleClientCreated} />
    )}
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-sm font-medium text-ink/60 mb-1">{label}</span>
      {children}
    </label>
  );
}
