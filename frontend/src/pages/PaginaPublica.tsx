import { useEffect, useState } from 'react';
import { api } from '../services/api';

interface PublicData {
  businessName: string;
  whatsappLink: string;
  days: Array<{ date: string; slots: string[] }>;
}

export default function PaginaPublica() {
  const [data, setData] = useState<PublicData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<PublicData>('/public/availability?days=6')
      .then(setData)
      .catch((e) => setError(e.message));
  }, []);

  return (
    <div className="min-h-screen bg-cream flex flex-col items-center px-4 py-12">
      <div className="w-full max-w-lg">
        <div className="text-center mb-10">
          <p className="font-display text-3xl text-wine-700 mb-1">{data?.businessName || 'NailFlow'}</p>
          <p className="text-ink/60 text-sm">Horários disponíveis</p>
        </div>

        {error && <p className="text-center text-red-600">{error}</p>}
        {!data && !error && <p className="text-center text-ink/50">Carregando horários...</p>}

        <div className="flex flex-col gap-4 mb-10">
          {data?.days.length === 0 && (
            <p className="text-center text-ink/60 bg-white border border-wine-100 rounded-xl p-6">
              Nenhum horário disponível nos próximos dias. Fale direto no WhatsApp para verificar outras opções.
            </p>
          )}
          {data?.days.map((day) => (
            <div key={day.date} className="bg-white border border-wine-100 rounded-xl p-5">
              <p className="font-medium text-wine-700 mb-3 capitalize">
                {new Date(`${day.date}T00:00:00`).toLocaleDateString('pt-BR', {
                  weekday: 'long',
                  day: '2-digit',
                  month: '2-digit',
                })}
              </p>
              <div className="flex flex-wrap gap-2">
                {day.slots.map((slot) => (
                  <span key={slot} className="text-sm px-3 py-1.5 rounded-lg bg-wine-50 text-wine-700">
                    {new Date(slot).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>

        {data && (
          <a
            href={data.whatsappLink}
            target="_blank"
            rel="noreferrer"
            className="block text-center bg-sage-500 hover:opacity-90 text-white rounded-full py-3.5 font-medium transition-opacity"
          >
            Falar pelo WhatsApp
          </a>
        )}

        <p className="text-center text-xs text-ink/40 mt-6">
          Os horários acima são apenas para consulta. O agendamento é combinado diretamente pelo WhatsApp.
        </p>
      </div>
    </div>
  );
}
