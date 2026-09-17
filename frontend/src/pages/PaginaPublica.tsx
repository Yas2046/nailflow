import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../services/api';
import LogoMark from '../components/LogoMark';

interface PublicData {
  businessName: string;
  whatsappLink: string;
  days: Array<{ date: string; slots: string[] }>;
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

function EmptyState() {
  return (
    <div className="bg-white border border-wine-100 rounded-xl p-10 flex flex-col items-center gap-3 text-center">
      <span className="text-ink/20"><IconCalendar /></span>
      <div>
        <p className="text-sm font-medium text-ink/60 mb-1">Sem horários disponíveis</p>
        <p className="text-xs text-ink/40 leading-relaxed max-w-xs mx-auto">
          Nenhum horário disponível nos próximos dias. Fale pelo WhatsApp para verificar outras opções.
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

// ─── página ───────────────────────────────────────────────────────────────────

export default function PaginaPublica() {
  const { slug } = useParams<{ slug?: string }>();
  const [data, setData] = useState<PublicData | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const today = todayStr();

  useEffect(() => {
    const url = slug
      ? `/public/${slug}/availability?days=6`
      : '/public/availability?days=6';

    api
      .get<PublicData>(url)
      .then(setData)
      .catch((e) => {
        if (e.response?.status === 404) {
          setNotFound(true);
        } else {
          setError(e.message);
        }
      });
  }, [slug]);

  if (notFound) return <NotFound />;

  return (
    <div className="min-h-screen bg-cream flex flex-col items-center px-4 py-12">
      <div className="w-full max-w-lg">

        {/* ── cabeçalho ──────────────────────────────────────────────────── */}
        <div className="text-center mb-12">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-wine-700 text-cream mb-3 shadow-sm">
            <LogoMark className="w-7 h-7" />
          </div>
          <p className="text-[11px] font-semibold text-ink/30 uppercase tracking-[0.25em] mb-5">NailFlow</p>
          <h1 className="font-display text-4xl text-wine-700 leading-tight mb-2">
            {data?.businessName || 'Carregando…'}
          </h1>
          <p className="text-ink/50 text-sm">Horários disponíveis para agendamento</p>
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
                        {day.slots.map((slot) => (
                          <span
                            key={slot}
                            className="text-sm px-3 py-1.5 rounded-lg bg-wine-50 text-wine-700 font-medium border border-wine-100"
                          >
                            {formatSlotTime(slot)}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* ── botão WhatsApp ─────────────────────────────────────────────── */}
        {data && (
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

        {/* ── rodapé ─────────────────────────────────────────────────────── */}
        <p className="text-center text-xs text-ink/30 mt-8 leading-relaxed">
          Os horários são apenas para consulta.<br />
          O agendamento é confirmado diretamente pelo WhatsApp.
        </p>

        <p className="text-center text-[10px] text-ink/20 mt-5">
          Desenvolvido com NailFlow
        </p>

      </div>
    </div>
  );
}
