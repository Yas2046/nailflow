import { useCallback, useEffect, useRef, useState } from 'react';
import { useTheme } from '../context/ThemeContext';
import type { Theme } from '../context/ThemeContext';
import { usePageTitle } from '../hooks/usePageTitle';
import { useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../services/api';
import QRCode from 'qrcode';
import type { WhatsAppStatus, WhatsAppConnect, WhatsAppInstanceConfig, WhatsAppCreateInstance } from '../types';
import Perfil from './Perfil';
import Disponibilidade from './Disponibilidade';


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

// ── Icons ─────────────────────────────────────────────────────────────────────

function IconWhatsApp() {
  return (
    <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
      <path d="M12 0C5.373 0 0 5.373 0 12c0 2.127.558 4.122 1.532 5.849L.057 23.57a.5.5 0 0 0 .614.614l5.701-1.462A11.945 11.945 0 0 0 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22a9.945 9.945 0 0 1-5.117-1.415l-.367-.214-3.804.975.993-3.72-.237-.382A9.945 9.945 0 0 1 2 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z"/>
    </svg>
  );
}

function IconCheck() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  );
}

function IconWarning() {
  return (
    <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
    </svg>
  );
}

// ── PainelWhatsApp ─────────────────────────────────────────────────────────────

function PainelWhatsApp() {
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
  if (configLoading) {
    return (
      <div className="animate-pulse space-y-3">
        <div className="h-24 bg-wine-50 rounded-2xl" />
        <div className="h-16 bg-wine-50/60 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-4">

      {/* ── SEM INSTÂNCIA CONFIGURADA ── */}
      {!instanceConfig?.configured && !creating && (
        <div className="bg-white border border-wine-100/80 rounded-2xl p-8 flex flex-col items-center text-center gap-4 shadow-sm">
          <div className="w-14 h-14 rounded-full bg-wine-50 flex items-center justify-center text-wine-300">
            <IconWhatsApp />
          </div>
          <div>
            <p className="font-display text-lg text-wine-700">WhatsApp não configurado</p>
            <p className="text-sm text-ink/40 mt-1 max-w-xs">
              Conecte seu número para receber e enviar mensagens automáticas de agendamento.
            </p>
          </div>
          <button
            onClick={() => { setCreating(true); setCreateError(null); }}
            className="btn-primary"
          >
            Configurar WhatsApp
          </button>
        </div>
      )}

      {/* ── FORMULÁRIO DE CRIAÇÃO ── */}
      {creating && (
        <div className="bg-white border border-wine-100/80 rounded-2xl p-6 shadow-sm space-y-5">
          <div>
            <h3 className="font-display text-lg text-wine-800 mb-0.5">Nova instância WhatsApp</h3>
            <p className="text-sm text-ink/40">Escolha um identificador único para sua conexão.</p>
          </div>

          <label className="block">
            <span className="block text-xs font-medium text-ink/50 uppercase tracking-wide mb-1.5">Nome da instância</span>
            <input
              type="text"
              value={instanceNameInput}
              onChange={e => { setInstanceNameInput(e.target.value); setCreateError(null); }}
              placeholder="ex: minha-manicure"
              maxLength={80}
              className="input"
              autoFocus
            />
            <p className="mt-1.5 text-xs text-ink/35">
              Use letras, números, hífens e underscores.
            </p>
          </label>

          {createError && (
            <div className="flex items-start gap-2 rounded-xl bg-rose-50 border border-rose-200 p-3 text-sm text-rose-700">
              <IconWarning />
              <span>{createError}</span>
            </div>
          )}

          <div className="flex gap-3">
            <button
              onClick={() => { setCreating(false); setInstanceNameInput(''); setCreateError(null); }}
              disabled={createLoading}
              className="btn-secondary flex-1"
            >
              Cancelar
            </button>
            <button
              onClick={handleCreateInstance}
              disabled={createLoading}
              className="btn-primary flex-1 disabled:opacity-60"
            >
              {createLoading ? 'Criando…' : 'Criar conexão'}
            </button>
          </div>
        </div>
      )}

      {/* ── COM INSTÂNCIA CONFIGURADA ── */}
      {instanceConfig?.configured && (
        <div className="bg-white border border-wine-100/80 rounded-2xl shadow-sm overflow-hidden">

          {/* Cabeçalho da instância */}
          <div className="px-6 py-4 border-b border-wine-50 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                statusLoading && !status ? 'bg-amber-400 animate-pulse' :
                status?.connected ? 'bg-emerald-500' : 'bg-red-400'
              }`} />
              <div>
                <p className="text-xs text-ink/40 uppercase tracking-wide font-medium">Instância</p>
                <p className="text-sm font-medium text-ink font-mono leading-tight">{instanceConfig.instanceName}</p>
              </div>
            </div>
            {status?.connected && (
              <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                <IconCheck />
                Conectado
              </span>
            )}
            {status && !status.connected && !qrCode && (
              <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-rose-50 text-rose-600 border border-rose-200">
                Desconectado
              </span>
            )}
          </div>

          <div className="p-6 space-y-4">

            {/* Erro de status */}
            {statusError && (
              <div className="flex items-start gap-2 rounded-xl bg-rose-50 border border-rose-200 p-3 text-sm text-rose-700">
                <IconWarning />
                <span>{statusError}</span>
              </div>
            )}

            {/* Dados do número conectado */}
            {status?.connected && (
              <div className="grid grid-cols-2 gap-3">
                {status.phone && (
                  <div className="bg-wine-50/50 rounded-xl p-3">
                    <p className="text-[10px] text-ink/40 uppercase tracking-wide font-medium mb-1">Número</p>
                    <p className="text-sm font-medium text-ink">{formatPhone(status.phone)}</p>
                  </div>
                )}
                {status.profileName && (
                  <div className="bg-wine-50/50 rounded-xl p-3">
                    <p className="text-[10px] text-ink/40 uppercase tracking-wide font-medium mb-1">Perfil</p>
                    <p className="text-sm text-ink truncate">{status.profileName}</p>
                  </div>
                )}
              </div>
            )}

            {/* Botão conectar */}
            {status && !status.connected && !qrCode && (
              <button
                onClick={handleConnect}
                disabled={connectLoading}
                className="btn-primary w-full disabled:opacity-60"
              >
                {connectLoading ? 'Aguarde…' : 'Conectar WhatsApp'}
              </button>
            )}

            {/* Erro de conexão */}
            {connectError && (
              <div className="flex items-start gap-2 rounded-xl bg-rose-50 border border-rose-200 p-3 text-sm text-rose-700">
                <IconWarning />
                <div className="flex-1">
                  <p>{connectError}</p>
                  {status && !status.connected && (
                    <button
                      onClick={handleRefreshQr}
                      disabled={connectLoading}
                      className="mt-2 text-wine-600 hover:text-wine-700 disabled:opacity-50 underline text-sm font-medium"
                    >
                      {connectLoading ? 'Atualizando…' : 'Atualizar QR Code'}
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* QR Code */}
            {(qrCode || qrCodeText) && status && !status.connected && (
              <div className="flex flex-col items-center gap-5 py-2">
                <div className="border-2 border-wine-100 rounded-2xl p-4 bg-white shadow-md inline-block">
                  <canvas ref={qrCanvasRef} className="rounded-lg block" style={{ width: 208, height: 208 }} />
                </div>
                <div className="text-center space-y-1">
                  <p className="text-sm font-semibold text-ink">Escaneie pelo WhatsApp</p>
                  <p className="text-xs text-ink/40">
                    WhatsApp → Dispositivos conectados → Conectar dispositivo
                  </p>
                  {qrCount > 1 && <p className="text-xs text-ink/30">QR #{qrCount}</p>}
                </div>
                <button
                  onClick={handleRefreshQr}
                  disabled={connectLoading}
                  className="btn-secondary disabled:opacity-50"
                >
                  {connectLoading ? 'Atualizando…' : 'Atualizar QR Code'}
                </button>
              </div>
            )}

            {/* Zona de perigo — excluir instância */}
            <div className="pt-2 border-t border-wine-50">
              {deleteError && (
                <div className="flex items-start gap-2 rounded-xl bg-rose-50 border border-rose-200 p-3 text-sm text-rose-700 mb-3">
                  <IconWarning />
                  <span>{deleteError}</span>
                </div>
              )}
              {!confirmDelete ? (
                <button
                  onClick={() => setConfirmDelete(true)}
                  disabled={deleteLoading}
                  className="text-sm text-rose-500 hover:text-rose-700 disabled:opacity-50 font-medium transition-colors"
                >
                  Excluir esta conexão
                </button>
              ) : (
                <div className="bg-rose-50 border border-rose-200 rounded-xl p-4 space-y-3">
                  <p className="text-sm text-rose-700 font-medium">
                    Tem certeza? A instância será removida e você precisará criar uma nova.
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setConfirmDelete(false)}
                      disabled={deleteLoading}
                      className="btn-secondary flex-1 disabled:opacity-50"
                    >
                      Cancelar
                    </button>
                    <button
                      onClick={handleDeleteInstance}
                      disabled={deleteLoading}
                      className="flex-1 px-4 py-2.5 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white text-sm font-semibold rounded-xl transition-colors"
                    >
                      {deleteLoading ? 'Excluindo…' : 'Confirmar exclusão'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Footer de atualização */}
          <div className="px-6 py-3 border-t border-wine-50 flex items-center justify-between bg-wine-50/30">
            <button
              onClick={() => fetchStatus()}
              disabled={statusLoading}
              className="text-xs text-wine-600 hover:text-wine-700 disabled:opacity-50 font-medium transition-colors"
            >
              {statusLoading ? 'Verificando…' : 'Atualizar status'}
            </button>
            <span className="text-xs text-ink/30">
              {qrCode ? 'Verificando a cada 3s' : 'Atualiza a cada 30s'}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}


// ─── Painel de Aparência ──────────────────────────────────────────────────────

const THEMES: Array<{
  id: Theme;
  label: string;
  description: string;
  preview: { bg: string; sidebar: string; accent: string; text: string };
}> = [
  {
    id: 'vinho',
    label: 'Vinho & Creme',
    description: 'Elegante e feminino. O visual padrão do NailFlow.',
    preview: { bg: '#FBF6F1', sidebar: '#5A2C3A', accent: '#733A4C', text: '#EBD9DE' },
  },
  {
    id: 'verde',
    label: 'Verde & Creme',
    description: 'Natural e sereno. Ideal para um clima mais orgânico.',
    preview: { bg: '#F5FAF5', sidebar: '#36503C', accent: '#345E3E', text: '#D1E8D4' },
  },
  {
    id: 'azul',
    label: 'Azul & Neutro',
    description: 'Moderno e confiável. Transmite sofisticação discreta.',
    preview: { bg: '#F2F6FA', sidebar: '#185A87', accent: '#265A87', text: '#D2E1F0' },
  },
];

function ThemePreview({ preview }: { preview: typeof THEMES[0]['preview'] }) {
  return (
    <svg viewBox="0 0 80 56" className="w-full rounded-lg overflow-hidden" aria-hidden="true">
      <rect width="80" height="56" fill={preview.bg} />
      <rect width="18" height="56" fill={preview.sidebar} />
      <rect x="3" y="10" width="12" height="2.5" rx="1.25" fill={preview.text} opacity="0.5" />
      <rect x="3" y="16" width="12" height="2.5" rx="1.25" fill={preview.text} opacity="0.5" />
      <rect x="3" y="22" width="12" height="2.5" rx="1.25" fill={preview.text} opacity="0.8" />
      <rect x="2" y="20" width="14" height="6" rx="1.5" fill="white" opacity="0.15" />
      <rect x="2" y="21.5" width="1.5" height="3" rx="0.75" fill="#C79A45" />
      <rect x="22" y="8" width="30" height="5" rx="2" fill={preview.sidebar} opacity="0.15" />
      <rect x="22" y="18" width="50" height="14" rx="2.5" fill={preview.accent} opacity="0.9" />
      <rect x="25" y="21" width="18" height="2" rx="1" fill="white" opacity="0.7" />
      <rect x="25" y="25" width="12" height="1.5" rx="0.75" fill="white" opacity="0.45" />
      <rect x="22" y="36" width="22" height="10" rx="2" fill="white" />
      <rect x="48" y="36" width="22" height="10" rx="2" fill="white" />
      <rect x="25" y="39" width="10" height="1.5" rx="0.75" fill={preview.sidebar} opacity="0.3" />
      <rect x="51" y="39" width="10" height="1.5" rx="0.75" fill={preview.sidebar} opacity="0.3" />
      <rect x="25" y="42.5" width="7" height="2" rx="1" fill={preview.sidebar} opacity="0.7" />
      <rect x="51" y="42.5" width="7" height="2" rx="1" fill={preview.sidebar} opacity="0.7" />
    </svg>
  );
}

function PainelAparencia({ theme, setTheme }: { theme: Theme; setTheme: (t: Theme) => void }) {
  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-ink/50">Escolha o tema de cores do sistema. A preferência fica salva neste dispositivo.</p>
      </div>
      <div className="grid sm:grid-cols-3 gap-4">
        {THEMES.map((t) => {
          const isSelected = theme === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTheme(t.id)}
              className={`group text-left rounded-2xl border-2 p-4 transition-all ${
                isSelected
                  ? 'border-wine-500 bg-wine-50/50 shadow-md'
                  : 'border-wine-100 bg-white hover:border-wine-300 hover:shadow-sm'
              }`}
            >
              <div className="mb-3">
                <ThemePreview preview={t.preview} />
              </div>
              <div className="flex items-center justify-between mb-1">
                <p className="text-sm font-semibold text-ink/80">{t.label}</p>
                {isSelected && (
                  <span className="w-4 h-4 rounded-full bg-wine-600 flex items-center justify-center shrink-0">
                    <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" strokeWidth={3} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  </span>
                )}
              </div>
              <p className="text-xs text-ink/40 leading-snug">{t.description}</p>
            </button>
          );
        })}
      </div>
      {theme !== 'vinho' && (
        <p className="text-xs text-ink/40 flex items-center gap-1.5">
          <svg className="w-3.5 h-3.5 text-wine-500 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="9" /><path strokeLinecap="round" d="M12 8v4m0 4h.01" />
          </svg>
          O tema é aplicado imediatamente. Para voltar ao padrão, selecione Vinho &amp; Creme.
        </p>
      )}
    </div>
  );
}


// ─── Configuracoes ────────────────────────────────────────────────────────────

type Tab = 'perfil' | 'whatsapp' | 'disponibilidade' | 'aparencia';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'perfil', label: 'Perfil' },
  { id: 'whatsapp', label: 'WhatsApp' },
  { id: 'disponibilidade', label: 'Disponibilidade' },
  { id: 'aparencia', label: 'Aparência' },
];

const TAB_TITLES: Record<Tab, string> = {
  perfil: 'Perfil',
  whatsapp: 'WhatsApp',
  disponibilidade: 'Disponibilidade',
  aparencia: 'Aparência',
};

export default function Configuracoes() {
  usePageTitle('Configurações');
  const [searchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const [tab, setTab] = useState<Tab>(
    tabParam === 'perfil' || tabParam === 'disponibilidade' || tabParam === 'whatsapp' ? tabParam : 'perfil'
  );

  useEffect(() => {
    if (tabParam === 'perfil' || tabParam === 'disponibilidade' || tabParam === 'whatsapp') setTab(tabParam);
  }, [tabParam]);
  const { theme, setTheme } = useTheme();

  return (
    <div className="max-w-2xl mx-auto space-y-6">

      {/* ── Cabeçalho ── */}
      <div>
        <h1 className="font-display text-3xl sm:text-4xl text-wine-800 leading-tight">Configurações</h1>
        <p className="text-sm text-ink/40 mt-1">{TAB_TITLES[tab]}</p>
      </div>

      {/* ── Tab switcher ── */}
      <div className="flex gap-1 bg-wine-50 rounded-xl p-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex-1 py-2.5 px-2 sm:px-3 rounded-lg text-xs sm:text-sm font-medium transition-colors ${
              tab === t.id
                ? 'bg-white text-wine-700 shadow-sm'
                : 'text-ink/50 hover:text-ink/70'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Painel ativo ── */}
      {tab === 'perfil' && (
        <div className="[&_h1:first-of-type]:hidden">
          <Perfil />
        </div>
      )}
      {tab === 'whatsapp' && <PainelWhatsApp />}
      {tab === 'disponibilidade' && (
        <div className="[&_h1:first-of-type]:hidden">
          <Disponibilidade />
        </div>
      )}
      {tab === 'aparencia' && <PainelAparencia theme={theme} setTheme={setTheme} />}
    </div>
  );
}
