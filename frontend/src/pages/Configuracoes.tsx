import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../services/api';
import QRCode from 'qrcode';
import type { WhatsAppStatus, WhatsAppConnect, WhatsAppInstanceConfig, WhatsAppCreateInstance } from '../types';

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
  // ── Estado da instância ───────────────────────────────────────────────
  const [instanceConfig, setInstanceConfig] = useState<WhatsAppInstanceConfig | null>(null);
  const [configLoading, setConfigLoading] = useState(true);

  // ── Estado de conexão WhatsApp ────────────────────────────────────────
  const [status, setStatus] = useState<WhatsAppStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);

  // ── QR Code ───────────────────────────────────────────────────────────
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [qrCodeText, setQrCodeText] = useState<string | null>(null);
  const qrCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [qrCount, setQrCount] = useState(0);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [connectLoading, setConnectLoading] = useState(false);

  // ── Criação de instância ──────────────────────────────────────────────
  const [creating, setCreating] = useState(false);
  const [instanceNameInput, setInstanceNameInput] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [createLoading, setCreateLoading] = useState(false);

  // ── Exclusão de instância ─────────────────────────────────────────────
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const qrTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Fetch config da instância ─────────────────────────────────────────
  const fetchInstanceConfig = useCallback(async () => {
    setConfigLoading(true);
    try {
      const data = await api.get<WhatsAppInstanceConfig>('/whatsapp/instance');
      setInstanceConfig(data);
    } catch {
      setInstanceConfig({ instanceName: null, configured: false });
    } finally {
      setConfigLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchInstanceConfig();
  }, [fetchInstanceConfig]);

  // ── QR canvas ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (qrCodeText && qrCanvasRef.current) {
      QRCode.toCanvas(qrCanvasRef.current, qrCodeText, {
        width: 208,
        margin: 2,
        color: { dark: '#000000', light: '#ffffff' },
      }).catch(console.error);
    }
  }, [qrCodeText]);

  const clearQr = useCallback(() => {
    setQrCode(null);
    setQrCodeText(null);
    setQrCount(0);
    if (qrTimerRef.current) clearTimeout(qrTimerRef.current);
  }, []);

  // ── Fetch status WhatsApp ─────────────────────────────────────────────
  const fetchStatus = useCallback(async (quiet = false) => {
    if (!quiet) setStatusLoading(true);
    setStatusError(null);
    try {
      const data = await api.get<WhatsAppStatus>('/whatsapp/status');
      setStatus(data);
      if (data.connected) clearQr();
      return data.connected;
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setStatus(null);
      } else {
        setStatusError('Não foi possível consultar o status do WhatsApp.');
      }
      return false;
    } finally {
      if (!quiet) setStatusLoading(false);
    }
  }, [clearQr]);

  const startPolling = useCallback((fast: boolean) => {
    if (pollRef.current) clearInterval(pollRef.current);
    const interval = fast ? POLL_CONNECTING_MS : POLL_IDLE_MS;
    pollRef.current = setInterval(() => fetchStatus(true), interval);
  }, [fetchStatus]);

  useEffect(() => {
    if (instanceConfig?.configured) {
      fetchStatus();
      startPolling(false);
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (qrTimerRef.current) clearTimeout(qrTimerRef.current);
    };
  }, [instanceConfig?.configured, fetchStatus, startPolling]);

  const scheduleQrExpiry = useCallback(() => {
    if (qrTimerRef.current) clearTimeout(qrTimerRef.current);
    qrTimerRef.current = setTimeout(() => {
      setQrCode(null);
      setQrCodeText(null);
      setConnectError('QR Code expirado. Clique em "Atualizar QR" para gerar um novo.');
      startPolling(false);
    }, QR_TTL_MS);
  }, [startPolling]);

  // ── Conectar / QR ─────────────────────────────────────────────────────
  async function handleConnect() {
    setConnectLoading(true);
    setConnectError(null);
    setQrCode(null);
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

  // ── Criar instância ───────────────────────────────────────────────────
  async function handleCreateInstance() {
    setCreateError(null);
    const trimmed = instanceNameInput.trim();
    if (!trimmed) {
      setCreateError('Informe um nome para a instância.');
      return;
    }
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(trimmed) || trimmed.length > 80) {
      setCreateError('Use apenas letras, números, hífens e underscores. Mínimo 1 caractere, máximo 80.');
      return;
    }
    setCreateLoading(true);
    try {
      const data = await api.post<WhatsAppCreateInstance>('/whatsapp/evolution-instance', { instanceName: trimmed });
      setInstanceConfig({ instanceName: data.instanceName, configured: true });
      setCreating(false);
      setInstanceNameInput('');
      await fetchStatus();
      await handleConnect();
    } catch (err) {
      setCreateError(err instanceof ApiError ? err.message : 'Erro ao criar instância. Tente novamente.');
    } finally {
      setCreateLoading(false);
    }
  }

  // ── Excluir instância ─────────────────────────────────────────────────
  async function handleDeleteInstance() {
    setDeleteLoading(true);
    setDeleteError(null);
    try {
      await api.delete('/whatsapp/evolution-instance');
      setInstanceConfig({ instanceName: null, configured: false });
      setStatus(null);
      setConfirmDelete(false);
      clearQr();
      if (pollRef.current) clearInterval(pollRef.current);
    } catch (err) {
      setDeleteError(err instanceof ApiError ? err.message : 'Erro ao excluir instância. Tente novamente.');
      setConfirmDelete(false);
    } finally {
      setDeleteLoading(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div className="max-w-2xl">
      <h1 className="font-display text-3xl text-ink mb-8">Configurações</h1>

      <section>
        <h2 className="text-lg font-semibold text-ink mb-4">WhatsApp</h2>

        <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm space-y-4">

          {configLoading && (
            <p className="text-sm text-gray-500">Carregando configuração...</p>
          )}

          {/* ── SEM INSTÂNCIA CONFIGURADA ── */}
          {!configLoading && !instanceConfig?.configured && !creating && (
            <div className="space-y-3">
              <p className="text-sm text-gray-600">
                Você ainda não possui uma conexão WhatsApp configurada.
              </p>
              <button
                onClick={() => {
                  setCreating(true);
                  setCreateError(null);
                }}
                className="px-4 py-2 bg-wine-600 hover:bg-wine-700 text-white text-sm font-medium rounded-lg transition-colors"
              >
                Criar minha conexão WhatsApp
              </button>
            </div>
          )}

          {/* ── FORMULÁRIO DE CRIAÇÃO ── */}
          {!configLoading && creating && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Nome da instância
                </label>
                <input
                  type="text"
                  value={instanceNameInput}
                  onChange={e => {
                    setInstanceNameInput(e.target.value);
                    setCreateError(null);
                  }}
                  placeholder="ex: minha-manicure"
                  maxLength={80}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-wine-500"
                />
                <p className="mt-1 text-xs text-gray-400">
                  Use letras, números, hífens e underscores. Será o identificador da sua instância.
                </p>
              </div>
              {createError && (
                <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{createError}</p>
              )}
              <div className="flex gap-2">
                <button
                  onClick={handleCreateInstance}
                  disabled={createLoading}
                  className="px-4 py-2 bg-wine-600 hover:bg-wine-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
                >
                  {createLoading ? 'Criando...' : 'Criar conexão'}
                </button>
                <button
                  onClick={() => {
                    setCreating(false);
                    setInstanceNameInput('');
                    setCreateError(null);
                  }}
                  disabled={createLoading}
                  className="px-4 py-2 border border-gray-300 hover:bg-gray-50 disabled:opacity-50 text-gray-700 text-sm font-medium rounded-lg transition-colors"
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}

          {/* ── COM INSTÂNCIA CONFIGURADA ── */}
          {!configLoading && instanceConfig?.configured && (
            <div className="space-y-4">
              <div className="flex gap-2 text-sm">
                <span className="text-gray-500 min-w-[7rem]">Instância:</span>
                <span className="text-ink font-medium font-mono">{instanceConfig.instanceName}</span>
              </div>

              {statusLoading && !status && (
                <p className="text-sm text-gray-500">Verificando status...</p>
              )}

              {statusError && (
                <div className="flex items-center gap-3">
                  <span className="w-3 h-3 rounded-full bg-red-500 flex-shrink-0" />
                  <p className="text-sm text-red-600">{statusError}</p>
                </div>
              )}

              {status && (
                <>
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
                    <div className="pt-1">
                      <button
                        onClick={handleConnect}
                        disabled={connectLoading}
                        className="px-4 py-2 bg-wine-600 hover:bg-wine-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
                      >
                        {connectLoading ? 'Aguarde...' : 'Conectar WhatsApp'}
                      </button>
                    </div>
                  )}
                </>
              )}

              {connectError && (
                <div className="flex items-start gap-2 text-sm text-red-600 bg-red-50 rounded-lg p-3">
                  <span className="mt-0.5 flex-shrink-0">&#9888;</span>
                  <div className="flex-1">
                    <span>{connectError}</span>
                    {status && !status.connected && (
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

              {(qrCode || qrCodeText) && status && !status.connected && (
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

              {/* ── Excluir instância ── */}
              <div className="pt-2 border-t border-gray-100">
                {deleteError && (
                  <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2 mb-3">{deleteError}</p>
                )}
                {!confirmDelete ? (
                  <button
                    onClick={() => setConfirmDelete(true)}
                    disabled={deleteLoading}
                    className="text-sm text-red-500 hover:text-red-700 disabled:opacity-50 underline"
                  >
                    Excluir esta conexão WhatsApp
                  </button>
                ) : (
                  <div className="space-y-2">
                    <p className="text-sm text-red-700 font-medium">
                      Tem certeza? A instância será removida da Evolution e você precisará criar uma nova.
                    </p>
                    <div className="flex gap-2">
                      <button
                        onClick={handleDeleteInstance}
                        disabled={deleteLoading}
                        className="px-3 py-1.5 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
                      >
                        {deleteLoading ? 'Excluindo...' : 'Confirmar exclusão'}
                      </button>
                      <button
                        onClick={() => setConfirmDelete(false)}
                        disabled={deleteLoading}
                        className="px-3 py-1.5 border border-gray-300 hover:bg-gray-50 disabled:opacity-50 text-gray-700 text-sm rounded-lg transition-colors"
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Barra inferior ── */}
          {instanceConfig?.configured && !configLoading && (
            <div className="pt-4 border-t border-gray-100 flex items-center justify-between">
              <button
                onClick={() => fetchStatus()}
                disabled={statusLoading}
                className="text-sm text-wine-600 hover:text-wine-700 disabled:opacity-50 focus-ring"
              >
                {statusLoading ? 'Atualizando...' : 'Atualizar'}
              </button>
              <span className="text-xs text-gray-400">
                {qrCode ? 'Verificando conexão a cada 3s' : 'Atualiza automaticamente a cada 30s'}
              </span>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
