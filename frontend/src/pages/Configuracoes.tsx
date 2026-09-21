import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../services/api';
import QRCode from 'qrcode';
import type { WhatsAppStatus, WhatsAppConnect } from '../types';

const QR_TTL_MS = 55_000;
const POLL_IDLE_MS = 30_000;
const POLL_CONNECTING_MS = 3_000;

function formatPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('55') && digits.length === 12) {
    return `+55 (${digits.slice(2, 4)}) ${digits.slice(4, 8)}-${digits.slice(8)}`;
  }
  if (digits.startsWith('55') && digits.length === 13) {
    return `+55 (${digits.slice(2, 4)}) ${digits.slice(4, 9)}-${digits.slice(9)}`;
  }
  return `+${digits}`;
}

export default function Configurações() {
  const [status, setStatus] = useState<WhatsAppStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [qrCodeText, setQrCodeText] = useState<string | null>(null);
  const qrCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [qrCount, setQrCount] = useState(0);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [connectLoading, setConnectLoading] = useState(false);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const qrTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearQr = useCallback(() => {
    setQrCode(null)
    setQrCodeText(null);
    setQrCount(0);
    if (qrTimerRef.current) clearTimeout(qrTimerRef.current);
  }, []);

  useEffect(() => {
    if (qrCodeText && qrCanvasRef.current) {
      QRCode.toCanvas(qrCanvasRef.current, qrCodeText, {
        width: 208,
        margin: 2,
        color: { dark: '#000000', light: '#ffffff' },
      }).catch(console.error);
    }
  }, [qrCodeText]);

  const fetchStatus = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError(null);
    try {
      const data = await api.get<WhatsAppStatus>('/whatsapp/status');
      setStatus(data);
      if (data.connected) clearQr();
      return data.connected;
    } catch {
      setError('Não foi possível consultar o status do WhatsApp.');
      return false;
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [clearQr]);

  const startPolling = useCallback((fast: boolean) => {
    if (pollRef.current) clearInterval(pollRef.current);
    const interval = fast ? POLL_CONNECTING_MS : POLL_IDLE_MS;
    pollRef.current = setInterval(() => fetchStatus(true), interval);
  }, [fetchStatus]);

  useEffect(() => {
    fetchStatus();
    startPolling(false);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (qrTimerRef.current) clearTimeout(qrTimerRef.current);
    };
  }, [fetchStatus, startPolling]);

  const scheduleQrExpiry = useCallback(() => {
    if (qrTimerRef.current) clearTimeout(qrTimerRef.current);
    qrTimerRef.current = setTimeout(() => {
      setQrCode(null)
    setQrCodeText(null);
      setConnectError('QR Code expirado. Clique em "Atualizar QR" para gerar um novo.');
      startPolling(false);
    }, QR_TTL_MS);
  }, [startPolling]);

  async function handleConnect() {
    setConnectLoading(true);
    setConnectError(null);
    setQrCode(null)
    setQrCodeText(null);
    try {
      const data = await api.post<WhatsAppConnect>('/whatsapp/connect', {});
      if (data.alreadyConnected) {
        await fetchStatus();
        return;
      }
      if (data.qrCode) {
        setQrCode(data.qrCode);
        setQrCodeText(data.qrCodeText ?? null);
        setQrCount(data.count ?? 1);
        startPolling(true);
        scheduleQrExpiry();
      } else {
        setConnectError('Resposta inesperada ao solicitar QR Code.');
      }
    } catch {
      setConnectError('Erro ao solicitar conexão. Verifique se o serviço está ativo.');
    } finally {
      setConnectLoading(false);
    }
  }

  async function handleRefreshQr() {
    if (qrTimerRef.current) clearTimeout(qrTimerRef.current);
    setConnectError(null);
    await handleConnect();
  }

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
              <div className="flex items-center gap-3">
                <span className={`w-3 h-3 rounded-full flex-shrink-0 ${status.connected ? 'bg-green-500' : 'bg-red-500'}`} />
                <span className={`text-sm font-medium ${status.connected ? 'text-green-700' : 'text-red-600'}`}>
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

              {!status.connected && !qrCode && (
                <div className="pt-2">
                  <button
                    onClick={handleConnect}
                    disabled={connectLoading}
                    className="px-4 py-2 bg-wine-600 hover:bg-wine-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
                  >
                    {connectLoading ? 'Aguarde...' : 'Conectar WhatsApp'}
                  </button>
                </div>
              )}

              {connectError && (
                <div className="flex items-start gap-2 text-sm text-red-600 bg-red-50 rounded-lg p-3">
                  <span className="mt-0.5 flex-shrink-0">&#9888;</span>
                  <div className="flex-1">
                    <span>{connectError}</span>
                    {!status.connected && (
                      <button
                        onClick={handleRefreshQr}
                        disabled={connectLoading}
                        className="block mt-2 text-wine-600 hover:text-wine-700 disabled:opacity-50 underline text-sm"
                      >
                        {connectLoading ? 'Atualizando...' : 'Atualizar QR Code'}
                      </button>
                    )}
                  </div>
                </div>
              )}

              {(qrCode || qrCodeText) && !status.connected && (
                <div className="flex flex-col items-center gap-4 pt-2">
                  <div className="border border-gray-200 rounded-xl p-4 bg-white shadow-sm inline-block">
                    <canvas ref={qrCanvasRef} className="rounded" style={{ width: 208, height: 208 }} />
                  </div>
                  <div className="text-center space-y-1">
                    <p className="text-sm font-medium text-ink">Escaneie pelo WhatsApp</p>
                    <p className="text-xs text-gray-500">
                      Abra o WhatsApp &rarr; Dispositivos conectados &rarr; Conectar dispositivo
                    </p>
                    {qrCount > 1 && <p className="text-xs text-gray-400">QR #{qrCount}</p>}
                  </div>
                  <button
                    onClick={handleRefreshQr}
                    disabled={connectLoading}
                    className="text-sm text-wine-600 hover:text-wine-700 disabled:opacity-50 underline"
                  >
                    {connectLoading ? 'Atualizando...' : 'Atualizar QR Code'}
                  </button>
                </div>
              )}
            </div>
          )}

          <div className="mt-5 pt-4 border-t border-gray-100 flex items-center justify-between">
            <button
              onClick={() => fetchStatus()}
              disabled={loading}
              className="text-sm text-wine-600 hover:text-wine-700 disabled:opacity-50 focus-ring"
            >
              {loading ? 'Atualizando...' : 'Atualizar'}
            </button>
            <span className="text-xs text-gray-400">
              {qrCode ? 'Verificando conexão a cada 3s' : 'Atualiza automaticamente a cada 30s'}
            </span>
          </div>
        </div>
      </section>
    </div>
  );
}