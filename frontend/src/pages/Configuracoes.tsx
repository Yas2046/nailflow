import { useEffect, useState } from 'react';
import { api } from '../services/api';
import type { WhatsAppStatus } from '../types';

function formatPhone(phone: string): string {
  // 553187086563 → +55 31 87086-563 (fallback genérico)
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('55') && digits.length === 12) {
    // +55 (DDD) XXXX-XXXX  (fixo)
    return `+55 (${digits.slice(2, 4)}) ${digits.slice(4, 8)}-${digits.slice(8)}`;
  }
  if (digits.startsWith('55') && digits.length === 13) {
    // +55 (DDD) 9XXXX-XXXX (celular)
    return `+55 (${digits.slice(2, 4)}) ${digits.slice(4, 9)}-${digits.slice(9)}`;
  }
  return `+${digits}`;
}

export default function Configuracoes() {
  const [status, setStatus] = useState<WhatsAppStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function fetchStatus() {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<WhatsAppStatus>('/whatsapp/status');
      setStatus(data);
    } catch {
      setError('Não foi possível consultar o status do WhatsApp.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 30_000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="max-w-2xl">
      <h1 className="font-display text-3xl text-ink mb-8">Configurações</h1>

      <section>
        <h2 className="text-lg font-semibold text-ink mb-4">WhatsApp</h2>

        <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
          {loading && !status && (
            <p className="text-sm text-gray-500">Carregando status...</p>
          )}

          {error && (
            <div className="flex items-center gap-3">
              <span className="w-3 h-3 rounded-full bg-red-500 flex-shrink-0" />
              <p className="text-sm text-red-600">{error}</p>
            </div>
          )}

          {status && (
            <div className="space-y-4">
              {/* Status badge */}
              <div className="flex items-center gap-3">
                <span
                  className={`w-3 h-3 rounded-full flex-shrink-0 ${
                    status.connected ? 'bg-green-500' : 'bg-red-500'
                  }`}
                />
                <span
                  className={`text-sm font-medium ${
                    status.connected ? 'text-green-700' : 'text-red-600'
                  }`}
                >
                  {status.connected ? 'Conectado' : 'Desconectado'}
                </span>
              </div>

              {status.connected && (
                <>
                  {status.phone && (
                    <div className="flex gap-2 text-sm">
                      <span className="text-gray-500 min-w-[7rem]">Número:</span>
                      <span className="text-ink font-medium">{formatPhone(status.phone)}</span>
                    </div>
                  )}
                  {status.profileName && (
                    <div className="flex gap-2 text-sm">
                      <span className="text-gray-500 min-w-[7rem]">Perfil:</span>
                      <span className="text-ink">{status.profileName}</span>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          <div className="mt-5 pt-4 border-t border-gray-100 flex items-center justify-between">
            <button
              onClick={fetchStatus}
              disabled={loading}
              className="text-sm text-wine-600 hover:text-wine-700 disabled:opacity-50 focus-ring"
            >
              {loading ? 'Atualizando...' : 'Atualizar'}
            </button>
            <span className="text-xs text-gray-400">Atualiza automaticamente a cada 30s</span>
          </div>
        </div>
      </section>
    </div>
  );
}
