import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';

interface ProfileData {
  id: string;
  name: string;
  email: string;
  business_name: string;
  phone_whatsapp: string;
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

// ─── helpers ──────────────────────────────────────────────────────────────────

function avatarInitial(name: string) {
  return (name.trim()[0] ?? '?').toUpperCase();
}

function formatPhone(phone: string) {
  const d = phone.replace(/\D/g, '');
  if (d.length === 13) return `+${d.slice(0, 2)} (${d.slice(2, 4)}) ${d.slice(4, 9)}-${d.slice(9)}`;
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  return phone;
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

  const [profile, setProfile]       = useState<ProfileData | null>(null);
  const [error, setError]           = useState<string | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);

  const [editing, setEditing]       = useState(false);
  const [form, setForm]             = useState<FormState>({ name: '', business_name: '', phone_whatsapp: '', email: '' });
  const [saving, setSaving]         = useState(false);
  const [saveError, setSaveError]   = useState<string | null>(null);

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
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erro ao salvar. Tente novamente.';
      setSaveError(msg);
    } finally {
      setSaving(false);
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
      <div className="flex items-center gap-5">
        <div className="w-20 h-20 rounded-full bg-wine-600 text-cream flex items-center justify-center font-display text-3xl shrink-0 shadow-sm">
          {avatarInitial(editing ? form.name : profile.name)}
        </div>
        <div>
          <p className="font-display text-2xl text-wine-700 leading-tight">
            {editing ? form.name || '…' : profile.name}
          </p>
          <p className="text-sm text-ink/50 mt-0.5">
            {editing ? form.business_name || '…' : profile.business_name}
          </p>
        </div>
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
