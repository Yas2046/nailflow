import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, ApiError } from '../services/api';
import LogoMark from '../components/LogoMark';

interface PublicData {
  businessName: string;
  whatsappLink: string;
  days: Array<{ date: string; slots: string[] }>;
}

type PublicTheme = 'vinho' | 'verde' | 'azul';

interface PublicInfo {
  businessName: string;
  bio: string | null;
  theme: PublicTheme;
  photo: string | null;
}

interface PublicService {
  id: string;
  name: string;
  priceCents: number;
  durationMinutes: number;
}

interface BookingResult {
  id: string;
  startsAt: string;
  endsAt: string;
  serviceName: string;
  status: string;
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatDayLabel(dateStr: string) {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString('pt-BR', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
  });
}

function formatSlotTime(iso: string) {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function formatMoney(cents: number) {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatDuration(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}min`;
}

function formatSlotFull(iso: string) {
  const d = new Date(iso);
  const date = d.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });
  const time = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return `${date} às ${time}`;
}

// ─── ícones ───────────────────────────────────────────────────────────────────

function IconCalendar() {
  return (
    <svg className="w-8 h-8" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path strokeLinecap="round" d="M16 2v4M8 2v4M3 10h18" />
    </svg>
  );
}

function IconWhatsApp() {
  return (
    <svg className="w-5 h-5 shrink-0" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
    </svg>
  );
}

// ─── componentes ─────────────────────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <div className="animate-pulse space-y-4">
      {[4, 5, 3].map((count, i) => (
        <div key={i} className="bg-white border border-wine-100 rounded-xl p-5">
          <div className="h-4 w-44 bg-wine-100 rounded mb-4" />
          <div className="flex flex-wrap gap-2">
            {Array.from({ length: count }, (_, j) => (
              <div key={j} className="h-8 w-14 bg-wine-50 rounded-lg" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function ServicesSkeleton() {
  return (
    <div className="flex flex-col gap-2 animate-pulse">
      {[0, 1, 2].map((i) => (
        <div key={i} className="bg-white border border-wine-100 rounded-xl p-4 h-[60px]" />
      ))}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="bg-white border border-wine-100 rounded-xl p-10 flex flex-col items-center gap-3 text-center">
      <span className="text-ink/20"><IconCalendar /></span>
      <div>
        <p className="text-sm font-medium text-ink/60 mb-1">Sem horários disponíveis</p>
        <p className="text-xs text-ink/40 leading-relaxed max-w-xs mx-auto">
          Nenhum horário disponível nos próximos dias. Fale pelo WhatsApp para verificar outras opções.
        </p>

        <p className="text-center text-[10px] text-ink/20 mt-5">
          Desenvolvido com NailFlow
        </p>

      </div>
    </div>
  );
}

function NotFound() {
  return (
    <div className="min-h-screen bg-cream flex flex-col items-center justify-center px-4 text-center">
      <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-wine-700 text-cream mb-4 shadow-sm">
        <LogoMark className="w-7 h-7" />
      </div>
      <h1 className="font-display text-2xl text-wine-700 mb-2">Profissional não encontrada</h1>
      <p className="text-ink/50 text-sm">O link que você acessou não corresponde a nenhuma profissional cadastrada.</p>
    </div>
  );
}

function LegacyLink() {
  return (
    <div className="min-h-screen bg-cream flex flex-col items-center justify-center px-4 text-center">
      <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-wine-700 text-cream mb-4 shadow-sm">
        <LogoMark className="w-7 h-7" />
      </div>
      <h1 className="font-display text-2xl text-wine-700 mb-2">Link antigo</h1>
      <p className="text-ink/50 text-sm max-w-xs">
        Este link antigo não é mais válido. Peça à sua profissional o link atualizado para agendamento.
      </p>
    </div>
  );
}

// ─── página ───────────────────────────────────────────────────────────────────

export default function PaginaPublica() {
  const { slug } = useParams<{ slug?: string }>();
  const [data, setData] = useState<PublicData | null>(null);
  const [info, setInfo] = useState<PublicInfo | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [services, setServices] = useState<PublicService[] | null>(null);
  const [servicesError, setServicesError] = useState<string | null>(null);
  const [selectedServiceId, setSelectedServiceId] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);

  // Etapa 3 — dados da cliente, revisão e confirmação.
  const [clientName, setClientName] = useState('');
  const [clientPhone, setClientPhone] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [step, setStep] = useState<'form' | 'confirm'>('form');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [bookingResult, setBookingResult] = useState<BookingResult | null>(null);

  const today = todayStr();
  const selectedService = services?.find((s) => s.id === selectedServiceId) ?? null;

  // Disponibilidade: recarrega sempre que o serviço selecionado muda,
  // passando `serviceId` para o backend calcular os slots com a duração
  // certa (sem serviceId, mantém o comportamento padrão de sempre — menor
  // duração entre os serviços públicos). `setData(null)` antes da nova
  // busca evita que a grade antiga (de outra duração) apareça clicável
  // enquanto a resposta nova ainda não chegou. Também reaproveitada depois
  // de um 409 de horário ocupado (ver handleSubmitError).
  const availabilityRequestIdRef = useRef(0);

  function loadAvailability(serviceId: string | null) {
    if (!slug) return;
    const requestId = ++availabilityRequestIdRef.current;
    setData(null);
    const query = serviceId ? `&serviceId=${serviceId}` : '';
    api
      .get<PublicData>(`/public/${slug}/availability?days=6${query}`)
      .then((result) => {
        if (availabilityRequestIdRef.current !== requestId) return; // resposta antiga, ignorar
        setData(result);
      })
      .catch((e) => {
        if (availabilityRequestIdRef.current !== requestId) return; // resposta antiga, ignorar
        if (e.response?.status === 404) {
          setNotFound(true);
        } else {
          setError(e.message);
        }
      });
  }

  // Ao trocar de serviço, a seleção de horário anterior deixa de fazer
  // sentido (pode não caber na nova duração) — limpa antes de qualquer nova
  // resposta chegar, junto com erros que pertenciam à seleção anterior.
  useEffect(() => {
    setSelectedSlot(null);
    setFormError(null);
    setSubmitError(null);
    setStep('form');
  }, [selectedServiceId]);

  useEffect(() => {
    loadAvailability(selectedServiceId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, selectedServiceId]);

  // Cabeçalho da página (nome, bio, foto e cor): buscado uma única vez por
  // slug, independente da disponibilidade, que é recarregada a cada serviço.
  useEffect(() => {
    if (!slug) return;
    api
      .get<PublicInfo>(`/public/${slug}/info`)
      .then(setInfo)
      .catch((e) => {
        if (e.response?.status === 404) setNotFound(true);
      });
  }, [slug]);

  // Lista de serviços disponíveis para agendamento (Etapa 1 do fluxo de
  // agendamento online). Erro tratado com mensagem genérica — nunca expõe
  // detalhe técnico da API para a cliente final.
  useEffect(() => {
    if (!slug) return;

    api
      .get<PublicService[]>(`/public/${slug}/services`)
      .then(setServices)
      .catch(() => {
        setServicesError('Não foi possível carregar os serviços. Tente novamente mais tarde.');
      });
  }, [slug]);

  function selectSlot(slot: string) {
    setSelectedSlot(slot);
    setSubmitError(null);
  }

  function goToConfirm() {
    if (!clientName.trim() || !clientPhone.trim()) {
      setFormError('Preencha nome e telefone para continuar.');
      return;
    }
    setFormError(null);
    setStep('confirm');
  }

  function backToForm() {
    setStep('form');
    setSubmitError(null);
  }

  // Traduz a resposta do POST em mensagens amigáveis, sem nunca expor
  // detalhe técnico (e.message cru) para a cliente final. O backend
  // continua sendo a única autoridade sobre disponibilidade/validação —
  // aqui só decidimos COMO exibir o que ele já decidiu.
  function handleSubmitError(e: unknown) {
    if (e instanceof ApiError) {
      if (e.status === 404) {
        setSubmitError('Não foi possível encontrar esta profissional.');
        return;
      }
      if (e.status === 409) {
        if (e.reason === 'max_future_appointments') {
          setSubmitError('Este número já possui o limite de agendamentos futuros para esta profissional.');
          return;
        }
        // Qualquer outro reason de indisponibilidade (appointment_overlap,
        // outside_working_hours, lunch_break, blocked_time, etc.) ou o
        // conflito genérico de corrida (`reason: "conflict"`): o horário
        // deixou de valer — volta para a seleção e recarrega a grade.
        setSelectedSlot(null);
        setStep('form');
        setSubmitError('Esse horário acabou de ser preenchido. Atualizamos os horários disponíveis para você.');
        loadAvailability(selectedServiceId);
        return;
      }
      if (e.status === 429) {
        setSubmitError('Muitas tentativas. Aguarde alguns minutos antes de tentar novamente.');
        return;
      }
      // 400 (telefone inválido, dados inválidos, serviço inválido) e
      // qualquer outro status: mensagem amigável genérica.
      setSubmitError('Não foi possível concluir o agendamento. Confira os dados e tente novamente.');
      return;
    }
    setSubmitError('Não foi possível concluir o agendamento. Tente novamente em instantes.');
  }

  async function handleConfirm() {
    if (!slug || !selectedServiceId || !selectedSlot || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const result = await api.post<BookingResult>(`/public/${slug}/appointments`, {
        serviceId: selectedServiceId,
        startsAt: selectedSlot,
        clientName: clientName.trim(),
        clientPhone: clientPhone.trim(),
      });
      setBookingResult(result);
    } catch (e) {
      handleSubmitError(e);
    } finally {
      setSubmitting(false);
    }
  }

  if (!slug) return <LegacyLink />;
  if (notFound) return <NotFound />;

  return (
    <div
      data-theme={info?.theme ?? 'vinho'}
      className="min-h-screen bg-cream flex flex-col items-center px-4 py-12"
    >
      <div className="w-full max-w-lg">

        {/* ── cabeçalho ──────────────────────────────────────────────────── */}
        <div className="text-center mb-12">
          {info?.photo ? (
            <img
              src={info.photo}
              alt=""
              className="w-20 h-20 rounded-full object-cover mb-3 mx-auto shadow-sm ring-2 ring-wine-100"
            />
          ) : (
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-wine-700 text-cream mb-3 shadow-sm">
              <LogoMark className="w-7 h-7" />
            </div>
          )}
          <p className="text-[11px] font-semibold text-ink/30 uppercase tracking-[0.25em] mb-5">NailFlow</p>
          <h1 className="font-display text-4xl text-wine-700 leading-tight mb-2 break-words">
            {info?.businessName || data?.businessName || 'Carregando…'}
          </h1>
          {info?.bio && (
            <p className="text-ink/60 text-sm leading-relaxed whitespace-pre-line break-words max-w-sm mx-auto mb-3">
              {info.bio}
            </p>
          )}
          <p className="text-ink/50 text-sm">Horários disponíveis para agendamento</p>
        </div>

        {/* ── sucesso — pedido de agendamento enviado ───────────────────── */}
        {bookingResult && (
          <div className="bg-white border border-emerald-200 rounded-xl p-6 text-center mb-10">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-emerald-100 text-emerald-600 mb-4">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="font-display text-2xl text-wine-700 mb-2">Agendamento solicitado!</h2>
            <p className="text-sm text-ink/60 mb-5">
              Seu pedido foi enviado e está aguardando a confirmação da profissional.
            </p>
            <div className="bg-wine-50 rounded-lg p-4 text-left text-sm text-ink/70 space-y-1.5">
              <p><span className="text-ink/40">Serviço:</span> {bookingResult.serviceName}</p>
              <p><span className="text-ink/40">Data/hora:</span> {formatSlotFull(bookingResult.startsAt)}</p>
              <p><span className="text-ink/40">Nome:</span> {clientName.trim()}</p>
            </div>
          </div>
        )}

        {!bookingResult && (
        <>
        {/* ── seleção de serviço ────────────────────────────────────────── */}
        <div className="mb-10">
          <p className="text-xs font-semibold text-ink/40 uppercase tracking-widest mb-3">Escolha o serviço</p>

          {servicesError && (
            <div className="rounded-xl bg-rose-50 border border-rose-200 px-4 py-3 text-sm text-rose-700 text-center">
              {servicesError}
            </div>
          )}

          {!services && !servicesError && <ServicesSkeleton />}

          {services && services.length === 0 && !servicesError && (
            <div className="bg-white border border-wine-100 rounded-xl p-6 text-center text-sm text-ink/40">
              Nenhum serviço disponível para agendamento no momento.
            </div>
          )}

          {services && services.length > 0 && (
            <div className="flex flex-col gap-2">
              {services.map((service) => {
                const isSelected = service.id === selectedServiceId;
                return (
                  <button
                    key={service.id}
                    type="button"
                    disabled={submitting}
                    onClick={() => setSelectedServiceId(service.id)}
                    className={`flex items-center justify-between gap-3 text-left rounded-xl p-4 border transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${
                      isSelected ? 'border-wine-500 bg-wine-50' : 'border-wine-100 bg-white hover:border-wine-300'
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="font-medium text-wine-700 text-sm truncate">{service.name}</p>
                      <p className="text-xs text-ink/40 mt-0.5">{formatDuration(service.durationMinutes)}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-sm font-semibold text-wine-700">{formatMoney(service.priceCents)}</span>
                      {isSelected && (
                        <span className="w-5 h-5 rounded-full bg-wine-600 flex items-center justify-center shrink-0">
                          <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" strokeWidth={3} viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* ── erro ───────────────────────────────────────────────────────── */}
        {error && (
          <div className="rounded-xl bg-rose-50 border border-rose-200 px-4 py-3 text-sm text-rose-700 mb-8 text-center">
            {error}
          </div>
        )}

        {/* ── skeleton de loading ─────────────────────────────────────────── */}
        {!data && !error && !notFound && (
          <div className="mb-10">
            <LoadingSkeleton />
          </div>
        )}

        {/* ── lista de dias ──────────────────────────────────────────────── */}
        {submitError && !selectedSlot && (
          <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-700 mb-3 text-center">
            {submitError}
          </div>
        )}
        {data && !selectedServiceId && data.days.length > 0 && (
          <p className="text-xs text-ink/40 text-center mb-3">
            Escolha um serviço acima para selecionar um horário.
          </p>
        )}
        {data && (
          <div className="flex flex-col gap-4 mb-10">
            {data.days.length === 0 ? (
              <EmptyState />
            ) : (
              data.days.map((day) => {
                const isToday = day.date === today;
                return (
                  <div
                    key={day.date}
                    className={`bg-white rounded-xl p-5 shadow-sm border ${
                      isToday ? 'border-wine-500' : 'border-wine-100'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3 mb-4">
                      <p className="font-medium text-wine-700 capitalize text-sm leading-tight min-w-0 flex-1 pr-2">
                        {formatDayLabel(day.date)}
                      </p>
                      {isToday && (
                        <span className="shrink-0 text-xs px-2.5 py-1 rounded-full bg-wine-600 text-white font-medium">
                          Hoje
                        </span>
                      )}
                    </div>

                    {day.slots.length === 0 ? (
                      <p className="text-xs text-ink/40 italic">Sem horários neste dia.</p>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {day.slots.map((slot) => {
                          const isSelected = slot === selectedSlot;
                          return (
                            <button
                              key={slot}
                              type="button"
                              disabled={!selectedServiceId || submitting}
                              onClick={() => selectSlot(slot)}
                              className={`text-sm px-3 py-1.5 rounded-lg font-medium border transition-colors ${
                                isSelected
                                  ? 'bg-wine-600 text-white border-wine-600'
                                  : selectedServiceId
                                    ? 'bg-wine-50 text-wine-700 border-wine-100 hover:border-wine-300 hover:bg-wine-100'
                                    : 'bg-wine-50/50 text-wine-700/40 border-wine-100 cursor-not-allowed'
                              }`}
                            >
                              {formatSlotTime(slot)}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* ── dados da cliente / revisão ───────────────────────────────────── */}
        {selectedServiceId && selectedSlot && (
          <div className="mb-10">
            {step === 'form' && (
              <div className="bg-white border border-wine-100 rounded-xl p-5">
                <p className="text-xs font-semibold text-ink/40 uppercase tracking-widest mb-4">Seus dados</p>
                <div className="flex flex-col gap-3">
                  <label className="block">
                    <span className="block text-xs font-medium text-ink/50 mb-1.5">Nome</span>
                    <input
                      className="input"
                      value={clientName}
                      onChange={(e) => { setClientName(e.target.value); setFormError(null); }}
                      placeholder="Seu nome completo"
                    />
                  </label>
                  <label className="block">
                    <span className="block text-xs font-medium text-ink/50 mb-1.5">Telefone (WhatsApp)</span>
                    <input
                      className="input"
                      type="tel"
                      value={clientPhone}
                      onChange={(e) => { setClientPhone(e.target.value); setFormError(null); }}
                      placeholder="(11) 91234-5678"
                    />
                  </label>
                </div>
                {formError && (
                  <p className="text-sm text-rose-600 mt-3">{formError}</p>
                )}
                <button
                  type="button"
                  onClick={goToConfirm}
                  className="mt-4 w-full bg-wine-600 hover:bg-wine-700 text-white rounded-xl py-3 text-sm font-semibold transition-colors"
                >
                  Continuar
                </button>
              </div>
            )}

            {step === 'confirm' && (
              <div className="bg-white border border-wine-100 rounded-xl p-5">
                <p className="text-xs font-semibold text-ink/40 uppercase tracking-widest mb-4">Revise seu agendamento</p>
                <div className="space-y-1.5 text-sm text-ink/70 mb-4">
                  <p><span className="text-ink/40">Serviço:</span> {selectedService?.name}</p>
                  <p><span className="text-ink/40">Data/hora:</span> {formatSlotFull(selectedSlot)}</p>
                  <p><span className="text-ink/40">Nome:</span> {clientName.trim()}</p>
                  <p><span className="text-ink/40">Telefone:</span> {clientPhone.trim()}</p>
                </div>
                {submitError && (
                  <div className="rounded-xl bg-rose-50 border border-rose-200 px-4 py-3 text-sm text-rose-700 mb-3">
                    {submitError}
                  </div>
                )}
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={backToForm}
                    disabled={submitting}
                    className="flex-1 rounded-xl border border-wine-200 text-wine-700 text-sm font-semibold py-3 hover:bg-wine-50 transition-colors disabled:opacity-60"
                  >
                    Editar
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirm}
                    disabled={submitting}
                    className="flex-1 bg-wine-600 hover:bg-wine-700 text-white rounded-xl py-3 text-sm font-semibold transition-colors disabled:opacity-60"
                  >
                    {submitting ? 'Agendando…' : 'Confirmar agendamento'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── botão WhatsApp — só exibido quando o agendamento direto não está
             disponível (sem serviços cadastrados/visíveis ou erro ao carregar);
             quando o fluxo de autoatendimento está ativo, o agendamento é
             confirmado pelo próprio formulário acima, sem precisar do WhatsApp ── */}
        {data && !(services && services.length > 0) && (
          <a
            href={data.whatsappLink}
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-center gap-2.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl py-3.5 px-6 font-semibold text-sm transition-colors shadow-sm"
          >
            <IconWhatsApp />
            Agendar pelo WhatsApp
          </a>
        )}
        </>
        )}

        {/* ── rodapé ─────────────────────────────────────────────────────── */}
        {!bookingResult && !(services && services.length > 0) && (
          <p className="text-center text-xs text-ink/30 mt-8 leading-relaxed">
            Os horários são apenas para consulta.<br />
            O agendamento é confirmado diretamente pelo WhatsApp.
          </p>
        )}

        <p className="text-center text-[10px] text-ink/20 mt-5">
          Desenvolvido com NailFlow
        </p>

      </div>
    </div>
  );
}
