import { useEffect, useRef, useState } from 'react';
import { useToast } from '../context/ToastContext';
import { usePageTitle } from '../hooks/usePageTitle';
import { formatPhone } from '../utils/format';
import { useNavigate } from 'react-router-dom';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';

interface ProfileData {
  id: string;
  name: string;
  email: string;
  business_name: string;
  phone_whatsapp: string;
  avatar_b64: string | null;
}

// ─── ícones ───────────────────────────────────────────────────────────────────

function IconUser() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
      <circle cx="12" cy="8" r="4" />
      <path strokeLinecap="round" d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
    </svg>
  );
}
function IconMail() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path strokeLinecap="round" d="m2 7 10 7 10-7" />
    </svg>
  );
}
function IconBriefcase() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
      <rect x="2" y="7" width="20" height="14" rx="2" />
      <path strokeLinecap="round" d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2M12 12v4M10 14h4" />
    </svg>
  );
}
function IconPhone() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round"
        d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.15 11.9 19.79 19.79 0 0 1 1.07 3.27 2 2 0 0 1 3.05 1h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.09 8.91A16 16 0 0 0 15.09 17l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
  );
}
function IconCopy() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path strokeLinecap="round" d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}
function IconLogout() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round"
        d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
    </svg>
  );
}
function IconEdit() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round"
        d="M11 5H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-5m-1.414-9.414a2 2 0 1 1 2.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
    </svg>
  );
}
function IconPencil() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536M9 11l6-6 3 3-6 6H9v-3z" />
    </svg>
  );
}
function IconTrash() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M9 7h6m-7 0a1 1 0 011-1h4a1 1 0 011 1m-7 0h8" />
    </svg>
  );
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function avatarInitial(name: string) {
  return (name.trim()[0] ?? '?').toUpperCase();
}

function resizeImageToBase64(file: File, size = 256): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('Canvas não disponível.'));

      // Crop centralizado para quadrado
      const side = Math.min(img.width, img.height);
      const sx = (img.width - side) / 2;
      const sy = (img.height - side) / 2;
      ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
      resolve(canvas.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Imagem inválida.')); };
    img.src = url;
  });
}

// ─── Avatar com edição ────────────────────────────────────────────────────────

interface AvatarEditorProps {
  name: string;
  currentB64: string | null;
  previewB64: string | null;
  onSelect: (b64: string) => void;
  onRemove: () => void;
  processing: boolean;
}

function AvatarEditor({ name, currentB64, previewB64, onSelect, onRemove, processing }: AvatarEditorProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  const displayB64 = previewB64 ?? currentB64;
  const hasPhoto = !!displayB64;

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    setFileError(null);
    const file = e.target.files?.[0];
    if (!e.target) return;
    // Reset so same file can be re-selected
    (e.target as HTMLInputElement).value = '';
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setFileError('Selecione um arquivo de imagem (JPG, PNG, WEBP…).');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setFileError('Arquivo muito grande. Use uma imagem de até 10 MB.');
      return;
    }

    try {
      const b64 = await resizeImageToBase64(file);
      onSelect(b64);
    } catch {
      setFileError('Não foi possível processar a imagem. Tente outra.');
    }
  }

  return (
    <div className="flex items-center gap-5">
      {/* Avatar clicável */}
      <div className="relative shrink-0">
        <div className="w-20 h-20 rounded-full overflow-hidden bg-wine-600 text-cream flex items-center justify-center font-display text-3xl shadow-sm">
          {hasPhoto ? (
            <img src={displayB64!} alt="Foto de perfil" className="w-full h-full object-cover" />
          ) : (
            avatarInitial(name)
          )}
        </div>

        {/* Botão lápis sobre o avatar */}
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={processing}
          title="Alterar foto"
          className="absolute bottom-0 right-0 w-7 h-7 rounded-full bg-wine-600 text-white flex items-center justify-center shadow-md hover:bg-wine-700 transition-colors disabled:opacity-60 border-2 border-white"
        >
          <IconPencil />
        </button>

        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFile}
        />
      </div>

      {/* Info + ações de foto */}
      <div className="min-w-0">
        {previewB64 && (
          <p className="text-xs text-amber-600 font-medium mb-1">Prévia — ainda não salva</p>
        )}
        {!previewB64 && hasPhoto && (
          <p className="text-xs text-ink/40 mb-1">Foto de perfil ativa</p>
        )}
        {!hasPhoto && (
          <p className="text-xs text-ink/40 mb-1">Sem foto de perfil</p>
        )}

        <div className="flex flex-wrap gap-2 mt-1">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={processing}
            className="text-xs font-medium text-wine-600 hover:text-wine-700 underline disabled:opacity-50 transition-colors"
          >
            {hasPhoto ? 'Trocar foto' : 'Adicionar foto'}
          </button>
          {hasPhoto && (
            <button
              type="button"
              onClick={onRemove}
              disabled={processing}
              className="flex items-center gap-1 text-xs font-medium text-rose-500 hover:text-rose-700 underline disabled:opacity-50 transition-colors"
            >
              <IconTrash />
              Remover
            </button>
          )}
        </div>

        {fileError && (
          <p className="text-xs text-rose-600 mt-1.5">{fileError}</p>
        )}
      </div>
    </div>
  );
}

// ─── componentes ─────────────────────────────────────────────────────────────

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      title="Copiar"
      className="p-1.5 rounded-md text-ink/30 hover:text-wine-600 hover:bg-wine-50 transition-colors"
    >
      {copied
        ? <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
        : <IconCopy />
      }
    </button>
  );
}

interface InfoRowProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  formatted?: string;
}
function InfoRow({ icon, label, value, formatted }: InfoRowProps) {
  return (
    <div className="flex items-start gap-4 py-4 border-b border-wine-50 last:border-0">
      <div className="w-9 h-9 rounded-lg bg-wine-50 text-wine-600 flex items-center justify-center shrink-0 mt-0.5">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-ink/40 mb-0.5">{label}</p>
        <p className="text-sm font-medium text-ink break-all">{formatted ?? value}</p>
      </div>
      <CopyButton value={value} />
    </div>
  );
}

interface EditRowProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  last?: boolean;
}
function EditRow({ icon, label, value, onChange, type = 'text', last }: EditRowProps) {
  return (
    <div className={`flex items-start gap-4 py-4 ${last ? '' : 'border-b border-wine-50'}`}>
      <div className="w-9 h-9 rounded-lg bg-wine-50 text-wine-600 flex items-center justify-center shrink-0 mt-0.5">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <label className="text-xs font-medium text-ink/40 mb-1 block">{label}</label>
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full text-sm font-medium text-ink bg-transparent border-b border-wine-200 focus:outline-none focus:border-wine-600 pb-0.5 transition-colors"
        />
      </div>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="animate-pulse space-y-6">
      <div className="flex items-center gap-5">
        <div className="w-20 h-20 rounded-full bg-wine-100" />
        <div className="space-y-2">
          <div className="h-6 w-40 bg-wine-100 rounded" />
          <div className="h-4 w-28 bg-wine-50 rounded" />
        </div>
      </div>
      <div className="bg-white border border-wine-100 rounded-xl p-5 space-y-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-4 py-2">
            <div className="w-9 h-9 bg-wine-50 rounded-lg" />
            <div className="space-y-1.5 flex-1">
              <div className="h-3 w-20 bg-wine-50 rounded" />
              <div className="h-4 w-48 bg-wine-100 rounded" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── página ───────────────────────────────────────────────────────────────────

interface FormState {
  name: string;
  business_name: string;
  phone_whatsapp: string;
  email: string;
}

export default function Perfil() {
  const { logout, updateProfessional } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  usePageTitle('Perfil');

  const [profile, setProfile]       = useState<ProfileData | null>(null);
  const [error, setError]           = useState<string | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);

  const [editing, setEditing]       = useState(false);
  const [form, setForm]             = useState<FormState>({ name: '', business_name: '', phone_whatsapp: '', email: '' });
  const [saving, setSaving]         = useState(false);
  const [saveError, setSaveError]   = useState<string | null>(null);

  // ── Avatar ─────────────────────────────────────────────────────────────
  const [avatarPreview, setAvatarPreview]   = useState<string | null>(null);
  const [avatarPending, setAvatarPending]   = useState<string | null | 'remove'>(undefined as unknown as null);
  const [avatarSaving, setAvatarSaving]     = useState(false);

  useEffect(() => {
    api.get<ProfileData>('/auth/me')
      .then(setProfile)
      .catch(() => setError('Não foi possível carregar os dados do perfil.'));
  }, []);

  function startEditing() {
    if (!profile) return;
    setForm({
      name:           profile.name,
      business_name:  profile.business_name,
      phone_whatsapp: profile.phone_whatsapp,
      email:          profile.email,
    });
    setSaveError(null);
    setEditing(true);
  }

  function cancelEditing() {
    setEditing(false);
    setSaveError(null);
  }

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    try {
      const updated = await api.put<ProfileData>('/auth/me', form);
      setProfile(updated);
      updateProfessional({
        id:           updated.id,
        name:         updated.name,
        email:        updated.email,
        businessName: updated.business_name,
      });
      setEditing(false);
      toast('Perfil atualizado com sucesso');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erro ao salvar. Tente novamente.';
      setSaveError(msg);
    } finally {
      setSaving(false);
    }
  }

  // ── Salvar foto separadamente ──────────────────────────────────────────
  async function handleSaveAvatar(b64: string | null) {
    if (!profile) return;
    setAvatarSaving(true);
    try {
      const updated = await api.put<ProfileData>('/auth/me', {
        name:           profile.name,
        business_name:  profile.business_name,
        phone_whatsapp: profile.phone_whatsapp,
        email:          profile.email,
        avatar_b64:     b64,
      });
      setProfile(updated);
      setAvatarPreview(null);
      setAvatarPending(null as unknown as null);
      toast(b64 ? 'Foto salva com sucesso' : 'Foto removida', 'success');
    } catch {
      toast('Erro ao salvar foto. Tente novamente.', 'error');
    } finally {
      setAvatarSaving(false);
    }
  }

  async function handleLogout() {
    setLoggingOut(true);
    logout();
    navigate('/login', { replace: true });
  }

  if (error)
    return (
      <div className="rounded-xl bg-rose-50 border border-rose-200 p-5 text-rose-600 text-sm">
        {error}
      </div>
    );

  if (!profile) return <LoadingSkeleton />;

  const pendingRemove = avatarPending === 'remove';
  const currentAvatarB64 = pendingRemove ? null : (profile.avatar_b64 ?? null);
  const hasPendingChange = avatarPreview !== null || pendingRemove;

  return (
    <div className="space-y-6 max-w-lg">

      {/* cabeçalho */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl text-wine-700">Perfil</h1>
          <p className="text-sm text-ink/50 mt-1">Dados da sua conta NailFlow.</p>
        </div>
        {!editing && (
          <button
            onClick={startEditing}
            className="shrink-0 flex items-center gap-2 px-4 py-2 rounded-lg border border-wine-200 text-wine-700 text-sm font-medium hover:bg-wine-50 transition-colors mt-1"
          >
            <IconEdit />
            Editar perfil
          </button>
        )}
      </div>

      {/* avatar + nome */}
      <div className="bg-white border border-wine-100 rounded-xl p-5 shadow-sm">
        <AvatarEditor
          name={editing ? form.name : profile.name}
          currentB64={currentAvatarB64}
          previewB64={avatarPreview}
          processing={avatarSaving}
          onSelect={(b64) => {
            setAvatarPreview(b64);
            setAvatarPending(b64);
          }}
          onRemove={() => {
            setAvatarPreview(null);
            setAvatarPending('remove');
          }}
        />

        {/* Nome e negócio abaixo do avatar */}
        <div className="mt-4 pt-4 border-t border-wine-50">
          <p className="font-display text-2xl text-wine-700 leading-tight">
            {editing ? form.name || '…' : profile.name}
          </p>
          <p className="text-sm text-ink/50 mt-0.5">
            {editing ? form.business_name || '…' : profile.business_name}
          </p>
        </div>

        {/* Ações da foto — aparecem quando há mudança pendente */}
        {hasPendingChange && (
          <div className="mt-4 flex gap-2">
            <button
              onClick={() => handleSaveAvatar(pendingRemove ? null : avatarPreview)}
              disabled={avatarSaving}
              className="btn-primary flex-1 disabled:opacity-60"
            >
              {avatarSaving ? 'Salvando…' : pendingRemove ? 'Confirmar remoção' : 'Salvar foto'}
            </button>
            <button
              onClick={() => { setAvatarPreview(null); setAvatarPending(null as unknown as null); }}
              disabled={avatarSaving}
              className="btn-secondary disabled:opacity-60"
            >
              Descartar
            </button>
          </div>
        )}
      </div>

      {/* card de informações */}
      <div className="bg-white border border-wine-100 rounded-xl px-5 shadow-sm">
        {editing ? (
          <>
            <EditRow
              icon={<IconUser />}
              label="Nome"
              value={form.name}
              onChange={(v) => setForm((f) => ({ ...f, name: v }))}
            />
            <EditRow
              icon={<IconBriefcase />}
              label="Nome do negócio"
              value={form.business_name}
              onChange={(v) => setForm((f) => ({ ...f, business_name: v }))}
            />
            <EditRow
              icon={<IconPhone />}
              label="WhatsApp"
              value={form.phone_whatsapp}
              onChange={(v) => setForm((f) => ({ ...f, phone_whatsapp: v }))}
              type="tel"
            />
            <EditRow
              icon={<IconMail />}
              label="E-mail"
              value={form.email}
              onChange={(v) => setForm((f) => ({ ...f, email: v }))}
              type="email"
              last
            />
          </>
        ) : (
          <>
            <InfoRow icon={<IconUser />}      label="Nome"             value={profile.name} />
            <InfoRow icon={<IconBriefcase />} label="Nome do negócio"  value={profile.business_name} />
            <InfoRow icon={<IconPhone />}     label="WhatsApp"         value={profile.phone_whatsapp} formatted={formatPhone(profile.phone_whatsapp)} />
            <InfoRow icon={<IconMail />}      label="E-mail"           value={profile.email} />
          </>
        )}
      </div>

      {/* ações de edição */}
      {editing && (
        <div className="space-y-3">
          {saveError && (
            <p className="text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-4 py-2.5">
              {saveError}
            </p>
          )}
          <div className="flex items-center gap-3">
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex-1 px-5 py-2.5 rounded-lg bg-wine-600 text-white text-sm font-semibold hover:bg-wine-700 transition-colors disabled:opacity-60"
            >
              {saving ? 'Salvando…' : 'Salvar alterações'}
            </button>
            <button
              onClick={cancelEditing}
              disabled={saving}
              className="px-5 py-2.5 rounded-lg border border-wine-200 text-wine-700 text-sm font-medium hover:bg-wine-50 transition-colors disabled:opacity-60"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* botão sair */}
      <div className="pt-2">
        <button
          onClick={handleLogout}
          disabled={loggingOut}
          className="flex items-center gap-2 px-5 py-2.5 rounded-lg border border-wine-200 text-wine-700 text-sm font-medium hover:bg-wine-50 transition-colors disabled:opacity-60"
        >
          <IconLogout />
          {loggingOut ? 'Saindo…' : 'Sair da conta'}
        </button>
      </div>

    </div>
  );
}
