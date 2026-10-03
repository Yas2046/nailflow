import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { Navigate } from 'react-router-dom';
import LogoMark from '../components/LogoMark';

interface ProfessionalRow {
  id: string;
  name: string;
  email: string;
  phone_whatsapp: string | null;
  business_name: string;
  wa_instance_name: string | null;
  created_at: string;
  is_admin: boolean;
  blocked_at: string | null;
}

interface ConfirmAction {
  id: string;
  name: string;
  action: 'block' | 'unblock';
}

interface EditForm {
  name: string;
  businessName: string;
  phoneWhatsapp: string;
  email: string;
}

interface DeletePreview {
  clients: number;
  appointments: number;
  services: number;
  recurringGroups: number;
  messages: number;
  expenses: number;
}

// Recorta a imagem em quadrado e reduz para um base64 leve (mesma técnica
// usada em Perfil.tsx para o avatar da própria conta).
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

// ── formatação (somente apresentação; os dados não são alterados) ───────────

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Bom dia';
  if (h < 18) return 'Boa tarde';
  return 'Boa noite';
}

function todayLabel() {
  const s = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function initialsOf(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0][0] ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (first + last).toUpperCase();
}

function formatSince(iso: string) {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }).replace('.', '');
}

// Exibe números brasileiros de forma legível; qualquer outro formato aparece como foi cadastrado.
function formatPhone(raw: string) {
  const d = raw.replace(/\D/g, '');
  const national = d.length >= 12 && d.startsWith('55') ? d.slice(2) : d;
  if (national.length === 11) return `(${national.slice(0, 2)}) ${national.slice(2, 7)}-${national.slice(7)}`;
  if (national.length === 10) return `(${national.slice(0, 2)}) ${national.slice(2, 6)}-${national.slice(6)}`;
  return raw;
}

// ── ícones ──────────────────────────────────────────────────────────────────

const iconProps = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, viewBox: '0 0 24 24', 'aria-hidden': true } as const;

function IconMail({ className = 'w-4 h-4' }: { className?: string }) {
  return <svg className={className} {...iconProps}><path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16v12H4zM4 7l8 6 8-6" /></svg>;
}
function IconPhone({ className = 'w-4 h-4' }: { className?: string }) {
  return <svg className={className} {...iconProps}><path strokeLinecap="round" strokeLinejoin="round" d="M5 4h3l1.5 4-2 1.2a11 11 0 0 0 5.3 5.3L14 12.5l4 1.5v3a2 2 0 0 1-2 2A13 13 0 0 1 3 6a2 2 0 0 1 2-2Z" /></svg>;
}
function IconPlug({ className = 'w-4 h-4' }: { className?: string }) {
  return <svg className={className} {...iconProps}><path strokeLinecap="round" strokeLinejoin="round" d="M9 3v4M15 3v4M7 7h10v4a5 5 0 0 1-10 0V7ZM12 16v5" /></svg>;
}
function IconCalendar({ className = 'w-4 h-4' }: { className?: string }) {
  return <svg className={className} {...iconProps}><rect x="3.5" y="5" width="17" height="15" rx="2" /><path strokeLinecap="round" d="M3.5 10h17M8 3v4M16 3v4" /></svg>;
}
function IconUsers({ className = 'w-5 h-5' }: { className?: string }) {
  return <svg className={className} {...iconProps}><path strokeLinecap="round" strokeLinejoin="round" d="M16 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 18.5V20M10 12a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM20 20v-1.5a3.5 3.5 0 0 0-2.5-3.35M15.5 5.2a3.5 3.5 0 0 1 0 6.6" /></svg>;
}
function IconCheck({ className = 'w-5 h-5' }: { className?: string }) {
  return <svg className={className} {...iconProps}><circle cx="12" cy="12" r="8.5" /><path strokeLinecap="round" strokeLinejoin="round" d="m8.5 12.3 2.4 2.4 4.6-5" /></svg>;
}
function IconBan({ className = 'w-5 h-5' }: { className?: string }) {
  return <svg className={className} {...iconProps}><circle cx="12" cy="12" r="8.5" /><path strokeLinecap="round" d="m6 6 12 12" /></svg>;
}
function IconChat({ className = 'w-5 h-5' }: { className?: string }) {
  return <svg className={className} {...iconProps}><path strokeLinecap="round" strokeLinejoin="round" d="M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-7l-4 3.5V16H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z" /><path strokeLinecap="round" d="M12 9.2v.01M9 9.2v.01M15 9.2v.01" /></svg>;
}
function IconSearch({ className = 'w-4 h-4' }: { className?: string }) {
  return <svg className={className} {...iconProps}><circle cx="11" cy="11" r="6.5" /><path strokeLinecap="round" d="m20 20-4-4" /></svg>;
}
function IconRefresh({ className = 'w-4 h-4' }: { className?: string }) {
  return <svg className={className} {...iconProps}><path strokeLinecap="round" strokeLinejoin="round" d="M20 11a8 8 0 0 0-14.3-4.3L4 8.5M4 4v4.5h4.5M4 13a8 8 0 0 0 14.3 4.3L20 15.5M20 20v-4.5h-4.5" /></svg>;
}
function IconDots() {
  return (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="5" cy="12" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="19" cy="12" r="1.7" />
    </svg>
  );
}

// ── peças visuais ───────────────────────────────────────────────────────────

function Avatar({ name, isAdmin, blocked }: { name: string; isAdmin: boolean; blocked: boolean }) {
  const tone = isAdmin
    ? 'bg-gradient-to-br from-gold-300 to-gold-400 text-wine-800 ring-2 ring-gold-400/50'
    : blocked
      ? 'bg-rose-100 text-rose-700 ring-2 ring-rose-200'
      : 'bg-gradient-to-br from-wine-100 to-wine-200 text-wine-700 ring-2 ring-white';
  return (
    <span aria-hidden="true" className={`w-14 h-14 rounded-2xl shrink-0 flex items-center justify-center font-display text-xl shadow-sm ${tone}`}>
      {initialsOf(name)}
    </span>
  );
}

function StatusChip({ blocked }: { blocked: boolean }) {
  return blocked ? (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200 px-2.5 py-1 text-[11px] font-semibold tracking-wide">
      <span className="w-1.5 h-1.5 rounded-full bg-rose-500" aria-hidden="true" />
      Bloqueada
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-sage-100 text-[#3F5F46] border border-sage-200 px-2.5 py-1 text-[11px] font-semibold tracking-wide">
      <span className="w-1.5 h-1.5 rounded-full bg-sage-500" aria-hidden="true" />
      Ativa
    </span>
  );
}

function StatCard({
  label, value, caption, total, icon, tone, className = '',
}: {
  label: string; value: number; caption: string; total: number; icon: ReactNode;
  tone: 'wine' | 'sage' | 'rose' | 'gold'; className?: string;
}) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  const t = {
    wine: { chip: 'bg-wine-100 text-wine-700', bar: 'bg-wine-500' },
    sage: { chip: 'bg-sage-100 text-[#3F5F46]', bar: 'bg-sage-500' },
    rose: { chip: 'bg-rose-50 text-rose-600', bar: 'bg-rose-400' },
    gold: { chip: 'bg-gold-300/35 text-[#7A5A22]', bar: 'bg-gold-500' },
  }[tone];
  return (
    <div className={`rounded-3xl bg-white border border-wine-100/70 p-5 sm:p-6 shadow-[0_1px_2px_rgba(61,29,40,0.04),0_10px_28px_-14px_rgba(61,29,40,0.14)] ${className}`}>
      <div className="flex items-center justify-between">
        <span className={`w-10 h-10 rounded-2xl flex items-center justify-center ${t.chip}`}>{icon}</span>
        <span className="text-[11px] font-medium text-ink/40 tabular-nums">{pct}%</span>
      </div>
      <p className="font-display text-4xl sm:text-[2.6rem] text-wine-800 tabular-nums leading-none mt-5">{value}</p>
      <p className="text-sm font-medium text-ink/70 mt-2">{label}</p>
      <p className="text-xs text-ink/40 mt-0.5">{caption}</p>
      <div className="mt-4 h-1.5 rounded-full bg-wine-50 overflow-hidden" role="presentation">
        <div className={`h-full rounded-full ${t.bar} transition-[width] duration-500`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function HeroStat({ value, caption }: { value: number; caption: string }) {
  return (
    <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-wine-800 via-wine-700 to-wine-600 text-cream p-5 sm:p-6 shadow-[0_18px_40px_-18px_rgba(61,29,40,0.6)]">
      <LogoMark className="absolute -right-5 -bottom-6 w-32 h-32 text-gold-400/15" />
      <div className="relative flex items-center gap-5 xl:block">
        <span className="w-10 h-10 rounded-2xl bg-white/10 ring-1 ring-gold-400/40 text-gold-300 flex items-center justify-center shrink-0">
          <IconUsers />
        </span>
        <p className="font-display text-5xl sm:text-6xl tabular-nums leading-none xl:mt-5">{value}</p>
        <div className="min-w-0 xl:mt-2">
          <p className="text-sm font-medium text-white/90">Profissionais</p>
          <p className="text-xs text-wine-100/60 mt-0.5">{caption}</p>
        </div>
      </div>
    </div>
  );
}

function SkeletonBlock({ className }: { className: string }) {
  return <div className={`bg-wine-100/60 rounded-lg animate-pulse ${className}`} />;
}

function LoadingState() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Carregando profissionais…</span>
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4 mb-10">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="rounded-3xl bg-white border border-wine-100/70 p-5 sm:p-6 shadow-sm">
            <SkeletonBlock className="h-10 w-10 rounded-2xl" />
            <SkeletonBlock className="h-9 w-14 mt-5" />
            <SkeletonBlock className="h-3 w-24 mt-3" />
            <SkeletonBlock className="h-1.5 w-full mt-5" />
          </div>
        ))}
      </div>
      <div className="grid sm:grid-cols-2 2xl:grid-cols-3 gap-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="rounded-3xl bg-white border border-wine-100/70 p-6 shadow-sm">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-2xl bg-wine-100/60 animate-pulse" />
              <div className="flex-1 space-y-2">
                <SkeletonBlock className="h-4 w-40" />
                <SkeletonBlock className="h-3 w-28" />
              </div>
            </div>
            <div className="mt-6 space-y-3">
              <SkeletonBlock className="h-3 w-full" />
              <SkeletonBlock className="h-3 w-3/4" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="rounded-3xl bg-white border border-rose-200 p-10 text-center shadow-sm">
      <span className="mx-auto w-12 h-12 rounded-2xl bg-rose-50 text-rose-500 flex items-center justify-center"><IconBan /></span>
      <p className="font-display text-xl text-wine-800 mt-4">Não foi possível carregar</p>
      <p className="text-sm text-rose-700 mt-1">{message}</p>
      <button onClick={onRetry} className="btn-primary mt-6">Tentar novamente</button>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-3xl bg-white border border-wine-100/70 p-14 text-center shadow-sm">
      <span className="mx-auto w-14 h-14 rounded-2xl bg-gold-300/30 text-gold-600 flex items-center justify-center"><LogoMark className="w-6 h-6" /></span>
      <p className="font-display text-xl text-wine-800 mt-5">Nenhuma profissional encontrada</p>
      <p className="text-sm text-ink/45 mt-1.5">Quando alguém se cadastrar, a conta aparece aqui.</p>
    </div>
  );
}

// ── diálogo acessível ───────────────────────────────────────────────────────

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface ModalProps {
  titleId: string;
  onClose: () => void;
  busy?: boolean;                       // enquanto true, Esc e clique fora não fecham
  focusKey?: string | number;           // muda → o foco volta ao primeiro controle (ex.: troca de etapa)
  returnFocusRef?: RefObject<HTMLElement | null>;
  children: ReactNode;
}

function Modal({ titleId, onClose, busy = false, focusKey, returnFocusRef, children }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const busyRef = useRef(busy);
  const onCloseRef = useRef(onClose);
  busyRef.current = busy;
  onCloseRef.current = onClose;

  // trava a rolagem da página e devolve o foco a quem abriu o diálogo
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const returnTo = returnFocusRef?.current ?? (document.activeElement as HTMLElement | null);
    return () => {
      document.body.style.overflow = previous;
      if (returnTo && returnTo.isConnected) returnTo.focus();
    };
  }, [returnFocusRef]);

  // foco inicial (e a cada troca de etapa)
  useEffect(() => {
    const preferred = panelRef.current?.querySelector<HTMLElement>('[data-autofocus]');
    const first = preferred ?? panelRef.current?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panelRef.current)?.focus();
  }, [focusKey]);

  // Esc fecha; Tab fica preso dentro do diálogo
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (!busyRef.current) { e.stopPropagation(); onCloseRef.current(); }
        return;
      }
      if (e.key !== 'Tab' || !panelRef.current) return;
      const items = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) { e.preventDefault(); return; }
      const firstEl = items[0];
      const lastEl = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === firstEl || !panelRef.current.contains(active))) {
        e.preventDefault(); lastEl.focus();
      } else if (!e.shiftKey && (active === lastEl || !panelRef.current.contains(active))) {
        e.preventDefault(); firstEl.focus();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div
      className="fixed inset-0 bg-wine-800/40 backdrop-blur-[2px] flex items-end sm:items-center justify-center p-4 z-50"
      onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="bg-white rounded-3xl w-full max-w-md shadow-2xl ring-1 ring-wine-100 p-6 sm:p-7 max-h-[90vh] overflow-y-auto focus:outline-none"
      >
        {children}
      </div>
    </div>
  );
}

// ── menu de ações (três pontos) ─────────────────────────────────────────────

interface MenuItem {
  label: string;
  onSelect: () => void;
  tone?: 'default' | 'success' | 'danger';
}

function RowMenu({
  label, items, onOpenTrigger,
}: {
  label: string;
  items: MenuItem[];
  onOpenTrigger: (el: HTMLElement | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) buttonRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    wrapRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    function onPointerDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.stopPropagation(); close(true); return; }
      if (e.key === 'Tab') { setOpen(false); return; }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      const els = Array.from(wrapRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
      if (els.length === 0) return;
      e.preventDefault();
      const idx = els.indexOf(document.activeElement as HTMLElement);
      const next = e.key === 'ArrowDown' ? (idx + 1) % els.length : (idx - 1 + els.length) % els.length;
      els[next].focus();
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);

  const toneClass = (tone: MenuItem['tone']) =>
    tone === 'danger'
      ? 'text-rose-700 hover:bg-rose-50 focus:bg-rose-50'
      : tone === 'success'
        ? 'text-[#3F5F46] hover:bg-sage-100 focus:bg-sage-100'
        : 'text-ink/80 hover:bg-wine-50 focus:bg-wine-50';

  return (
    <div ref={wrapRef} className={`relative inline-block text-left ${open ? 'z-40' : ''}`}>
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={label}
        onClick={() => setOpen((o) => !o)}
        className="w-9 h-9 rounded-xl flex items-center justify-center text-ink/40 hover:text-wine-700 hover:bg-wine-50 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-wine-400/50"
      >
        <IconDots />
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label={label}
          className="absolute right-0 top-full mt-1 z-40 w-48 rounded-2xl bg-white border border-wine-100 shadow-xl py-1.5"
        >
          {items.map((item, i) => (
            <div key={item.label}>
              {item.tone === 'danger' && i > 0 && <div className="my-1 border-t border-wine-100/70" role="separator" />}
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  onOpenTrigger(buttonRef.current);
                  setOpen(false);
                  item.onSelect();
                }}
                className={`w-full text-left px-4 py-2 text-sm font-medium focus:outline-none transition-colors ${toneClass(item.tone)}`}
              >
                {item.label}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── página ──────────────────────────────────────────────────────────────────

export default function Admin() {
  const { professional } = useAuth();
  const [rows, setRows] = useState<ProfessionalRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [acting, setActing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // ── Edição de profissional ──
  const [editTarget, setEditTarget] = useState<ProfessionalRow | null>(null);
  const [editStep, setEditStep] = useState<'form' | 'confirm'>('form');
  const [editForm, setEditForm] = useState<EditForm>({ name: '', businessName: '', phoneWhatsapp: '', email: '' });
  const [editAvatarB64, setEditAvatarB64] = useState<string | null>(null);
  const [editAvatarChanged, setEditAvatarChanged] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // ── Exclusão definitiva de profissional ──
  const [deleteTarget, setDeleteTarget] = useState<ProfessionalRow | null>(null);
  const [deletePreview, setDeletePreview] = useState<DeletePreview | null>(null);
  const [deletePreviewLoading, setDeletePreviewLoading] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // quem abriu o diálogo (para devolver o foco ao fechar)
  const triggerRef = useRef<HTMLElement | null>(null);
  const confirmTitleId = useId();
  const editTitleId = useId();
  const deleteTitleId = useId();
  const listTitleId = useId();

  // `silent` = recarrega depois de uma ação sem voltar ao esqueleto de carregamento
  function reload(silent = true) {
    if (!silent) { setLoading(true); setError(null); }
    api.get<ProfessionalRow[]>('/admin/professionals')
      .then((data) => { setRows(data); setError(null); })
      .catch(() => setError('Erro ao carregar profissionais.'))
      .finally(() => setLoading(false));
  }

  useEffect(() => { reload(true); }, []);

  // AdminLayout já protege a rota; este guard é só camada extra
  if (!professional) return <Navigate to="/login" replace />;
  if (!professional.isAdmin) return <Navigate to="/login" replace />;

  async function handleConfirm() {
    if (!confirmAction) return;
    setActing(true);
    setActionError(null);
    try {
      await api.post(`/admin/professionals/${confirmAction.id}/${confirmAction.action}`);
      setConfirmAction(null);
      reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Erro ao atualizar profissional.');
    } finally {
      setActing(false);
    }
  }

  function openEdit(p: ProfessionalRow) {
    setEditTarget(p);
    setEditStep('form');
    setEditForm({
      name: p.name,
      businessName: p.business_name,
      phoneWhatsapp: p.phone_whatsapp ?? '',
      email: p.email,
    });
    setEditAvatarB64(null);
    setEditAvatarChanged(false);
    setEditError(null);
  }

  function closeEdit() {
    setEditTarget(null);
    setEditError(null);
  }

  async function handleAvatarFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) { setEditError('Selecione um arquivo de imagem (JPG, PNG, WEBP…).'); return; }
    if (file.size > 10 * 1024 * 1024) { setEditError('Arquivo muito grande. Use uma imagem de até 10 MB.'); return; }
    try {
      const b64 = await resizeImageToBase64(file);
      setEditAvatarB64(b64);
      setEditAvatarChanged(true);
      setEditError(null);
    } catch {
      setEditError('Não foi possível processar a imagem. Tente outra.');
    }
  }

  function goToConfirmEdit() {
    if (!editForm.name.trim() || !editForm.businessName.trim() || !editForm.email.trim()) {
      setEditError('Preencha nome, negócio e e-mail.');
      return;
    }
    setEditError(null);
    setEditStep('confirm');
  }

  async function handleSaveEdit() {
    if (!editTarget) return;
    setEditSaving(true);
    setEditError(null);
    try {
      const payload: Record<string, unknown> = {
        name: editForm.name.trim(),
        business_name: editForm.businessName.trim(),
        phone_whatsapp: editForm.phoneWhatsapp.trim(),
        email: editForm.email.trim(),
      };
      if (editAvatarChanged) payload.avatar_b64 = editAvatarB64;
      await api.put(`/admin/professionals/${editTarget.id}`, payload);
      setEditTarget(null);
      reload();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Erro ao salvar profissional.');
    } finally {
      setEditSaving(false);
    }
  }

  function openDelete(p: ProfessionalRow) {
    setDeleteTarget(p);
    setDeletePreview(null);
    setDeleteConfirmText('');
    setDeleteError(null);
    setDeletePreviewLoading(true);
    api.get<DeletePreview>(`/admin/professionals/${p.id}/delete-preview`)
      .then(setDeletePreview)
      .catch(() => setDeleteError('Erro ao carregar os dados que seriam apagados.'))
      .finally(() => setDeletePreviewLoading(false));
  }

  function closeDelete() {
    setDeleteTarget(null);
    setDeleteError(null);
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await api.delete(`/admin/professionals/${deleteTarget.id}`, { businessNameConfirmation: deleteConfirmText });
      setDeleteTarget(null);
      reload();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Erro ao excluir profissional.');
    } finally {
      setDeleting(false);
    }
  }

  // ── resumo (calculado a partir da lista já carregada; contas admin ficam de fora) ──
  const professionals = rows.filter((r) => !r.is_admin);
  const adminCount = rows.length - professionals.length;
  const activeCount = professionals.filter((r) => r.blocked_at === null).length;
  const blockedCount = professionals.length - activeCount;
  const noWhatsappCount = professionals.filter((r) => !r.wa_instance_name).length;
  const firstName = professional.name?.trim().split(/\s+/)[0] ?? '';

  function menuItemsFor(p: ProfessionalRow): MenuItem[] {
    const isBlocked = p.blocked_at !== null;
    return [
      { label: 'Editar', onSelect: () => openEdit(p) },
      isBlocked
        ? { label: 'Desbloquear', tone: 'success' as const, onSelect: () => setConfirmAction({ id: p.id, name: p.name, action: 'unblock' }) }
        : { label: 'Bloquear', onSelect: () => setConfirmAction({ id: p.id, name: p.name, action: 'block' }) },
      { label: 'Excluir…', tone: 'danger' as const, onSelect: () => openDelete(p) },
    ];
  }

  const showList = !loading && !error;

  return (
    <div className="max-w-[78rem] mx-auto">

      {/* ── saudação ─────────────────────────────────────────────────────── */}
      <header className="flex flex-wrap items-end justify-between gap-4 mb-8 sm:mb-10">
        <div>
          <p className="text-[11px] uppercase tracking-[0.22em] font-semibold text-gold-600">{todayLabel()}</p>
          <h1 className="font-display text-3xl sm:text-4xl lg:text-[2.6rem] font-semibold text-wine-800 leading-tight mt-2">
            {getGreeting()}{firstName ? `, ${firstName}` : ''}
          </h1>
          <p className="text-sm sm:text-base text-ink/50 mt-1.5 max-w-xl">
            Acompanhe as profissionais do NailFlow e gerencie o acesso de cada conta.
          </p>
        </div>
      </header>

      {loading && <LoadingState />}

      {error && !loading && <ErrorState message={error} onRetry={() => reload(false)} />}

      {showList && (
        <>
          {/* ── indicadores ──────────────────────────────────────────────── */}
          <section aria-label="Resumo" className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4 mb-10 sm:mb-12">
            <div className="col-span-2 sm:col-span-3 xl:col-span-1">
              <HeroStat
                value={professionals.length}
                caption={adminCount > 0 ? `sem contar ${adminCount} ${adminCount === 1 ? 'conta admin' : 'contas admin'}` : 'contas cadastradas'}
              />
            </div>
            <StatCard label="Ativas" value={activeCount} caption="com acesso liberado" total={professionals.length} tone="sage" icon={<IconCheck />} />
            <StatCard label="Bloqueadas" value={blockedCount} caption="sem acesso ao sistema" total={professionals.length} tone="rose" icon={<IconBan />} />
            <StatCard label="Sem WhatsApp" value={noWhatsappCount} caption="sem instância configurada" total={professionals.length} tone="gold" icon={<IconChat />} className="col-span-2 sm:col-span-1" />
          </section>

          {/* ── profissionais ────────────────────────────────────────────── */}
          <section aria-labelledby={listTitleId}>
            <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
              <div className="flex items-baseline gap-3">
                <h2 id={listTitleId} className="font-display text-2xl sm:text-[1.7rem] font-semibold text-wine-800">Profissionais</h2>
                <span className="text-sm text-ink/40 tabular-nums">{rows.length} {rows.length === 1 ? 'conta' : 'contas'}</span>
              </div>
              <button onClick={() => reload(false)} className="btn-secondary !rounded-xl">
                <IconRefresh />
                Atualizar
              </button>
            </div>

            {/* Busca e filtros: apresentação (ainda sem funcionalidade) */}
            <div className="rounded-2xl bg-white/70 border border-wine-100/70 p-3 sm:p-3.5 mb-6 flex flex-col xl:flex-row xl:items-center gap-3">
              <div className="relative flex-1 min-w-0" title="Busca em breve">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink/30" aria-hidden="true"><IconSearch /></span>
                <input
                  type="search"
                  disabled
                  aria-label="Buscar profissional (em breve)"
                  placeholder="Buscar por nome, negócio ou e-mail"
                  className="input !pl-10 !bg-cream/60 disabled:cursor-not-allowed disabled:opacity-70"
                />
              </div>
              <div className="flex items-center gap-2 overflow-x-auto -mx-1 px-1 pb-0.5 xl:pb-0" role="group" aria-label="Filtros (em breve)">
                <span className="shrink-0 inline-flex items-center rounded-full bg-wine-700 text-white px-3.5 py-1.5 text-xs font-medium">Todas</span>
                {['Ativas', 'Bloqueadas', 'Sem WhatsApp'].map((f) => (
                  <span
                    key={f}
                    aria-disabled="true"
                    title="Em breve"
                    className="shrink-0 inline-flex items-center rounded-full border border-wine-100 bg-white text-ink/40 px-3.5 py-1.5 text-xs font-medium cursor-not-allowed"
                  >
                    {f}
                  </span>
                ))}
                <span className="shrink-0 ml-1 text-[10px] uppercase tracking-widest text-gold-600 font-semibold">Em breve</span>
              </div>
            </div>

            {rows.length === 0 ? (
              <EmptyState />
            ) : (
              <ul className="grid sm:grid-cols-2 2xl:grid-cols-3 gap-4">
                {rows.map((p) => {
                  const isSelf = p.id === professional.id;
                  const blocked = p.blocked_at !== null;
                  return (
                    <li
                      key={p.id}
                      className={`relative min-w-0 rounded-3xl border p-5 sm:p-6 transition-shadow hover:shadow-[0_2px_4px_rgba(61,29,40,0.05),0_18px_36px_-16px_rgba(61,29,40,0.22)] shadow-[0_1px_2px_rgba(61,29,40,0.04),0_10px_28px_-14px_rgba(61,29,40,0.14)] ${
                        blocked ? 'bg-rose-50/40 border-rose-200/80' : 'bg-white border-wine-100/70'
                      }`}
                    >
                      <div className="flex items-start gap-4">
                        <Avatar name={p.name} isAdmin={p.is_admin} blocked={blocked} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <h3 className="font-semibold text-ink leading-snug truncate" title={p.name}>{p.name}</h3>
                              <p className="text-sm text-ink/50 truncate" title={p.business_name}>{p.business_name}</p>
                            </div>
                            {isSelf ? (
                              <span className="shrink-0 text-[11px] text-ink/40 italic pt-1 whitespace-nowrap">Sua conta</span>
                            ) : (
                              <div className="shrink-0 -mr-1.5 -mt-1">
                                <RowMenu
                                  label={`Ações para ${p.name}`}
                                  items={menuItemsFor(p)}
                                  onOpenTrigger={(el) => { triggerRef.current = el; }}
                                />
                              </div>
                            )}
                          </div>
                          <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
                            <StatusChip blocked={blocked} />
                            {p.is_admin && (
                              <span className="inline-flex items-center rounded-full bg-gold-300/40 text-[#7A5A22] border border-gold-400/40 px-2.5 py-1 text-[11px] font-semibold tracking-wide">
                                Admin
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      <dl className="mt-5 pt-5 border-t border-wine-100/60 space-y-2.5 text-sm">
                        <div className="flex items-center gap-3 min-w-0">
                          <dt className="text-ink/35 shrink-0"><span className="sr-only">E-mail</span><IconMail /></dt>
                          <dd className="text-ink/70 truncate min-w-0" title={p.email}>{p.email}</dd>
                        </div>
                        <div className="flex items-center gap-3 min-w-0">
                          <dt className="text-ink/35 shrink-0"><span className="sr-only">WhatsApp</span><IconPhone /></dt>
                          <dd className="text-ink/70 min-w-0 truncate">
                            {p.phone_whatsapp ? formatPhone(p.phone_whatsapp) : <span className="text-ink/30">Não informado</span>}
                          </dd>
                        </div>
                        <div className="flex items-center gap-3 min-w-0">
                          <dt className="text-ink/35 shrink-0"><span className="sr-only">Instância do WhatsApp</span><IconPlug /></dt>
                          <dd className="min-w-0">
                            {p.wa_instance_name ? (
                              <span className="inline-block max-w-full truncate align-middle font-mono text-xs text-ink/65 bg-cream rounded-lg px-2.5 py-1 ring-1 ring-wine-100/70" title={p.wa_instance_name}>
                                {p.wa_instance_name}
                              </span>
                            ) : (
                              <span className="inline-flex items-center rounded-full bg-gold-300/30 text-[#7A5A22] px-2.5 py-1 text-xs font-medium">Sem instância</span>
                            )}
                          </dd>
                        </div>
                        <div className="flex items-center gap-3 min-w-0">
                          <dt className="text-ink/35 shrink-0"><span className="sr-only">Cadastro</span><IconCalendar /></dt>
                          <dd className="text-ink/50 text-[13px]">Desde {formatSince(p.created_at)}</dd>
                        </div>
                      </dl>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </>
      )}

      {/* Confirmação de bloqueio/desbloqueio */}
      {confirmAction && (
        <Modal
          titleId={confirmTitleId}
          busy={acting}
          returnFocusRef={triggerRef}
          onClose={() => { setConfirmAction(null); setActionError(null); }}
        >
          <span className={`w-11 h-11 rounded-2xl flex items-center justify-center mb-4 ${confirmAction.action === 'block' ? 'bg-rose-50 text-rose-600' : 'bg-sage-100 text-[#3F5F46]'}`}>
            {confirmAction.action === 'block' ? <IconBan /> : <IconCheck />}
          </span>
          <h3 id={confirmTitleId} className="font-display text-xl text-wine-800 mb-2">
            {confirmAction.action === 'block' ? 'Bloquear profissional?' : 'Desbloquear profissional?'}
          </h3>
          <p className="text-sm text-ink/65 leading-relaxed">
            {confirmAction.action === 'block' ? (
              <>Isso vai impedir <strong>{confirmAction.name}</strong> de acessar o sistema e encerrar a sessão dela imediatamente.</>
            ) : (
              <>Isso vai liberar o acesso de <strong>{confirmAction.name}</strong>. Ela precisará fazer login novamente.</>
            )}
          </p>
          {actionError && (
            <div role="alert" className="rounded-xl bg-rose-50 border border-rose-200 p-3 text-sm text-rose-700 mt-3">{actionError}</div>
          )}
          <div className="flex gap-3 pt-5">
            <button
              onClick={() => { setConfirmAction(null); setActionError(null); }}
              disabled={acting}
              className="btn-secondary flex-1 disabled:opacity-60"
            >
              Cancelar
            </button>
            <button
              onClick={handleConfirm}
              disabled={acting}
              className={`flex-1 text-sm py-2 rounded-lg font-medium transition-colors disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 ${
                confirmAction.action === 'block'
                  ? 'bg-rose-600 text-white hover:bg-rose-700 focus-visible:ring-rose-400'
                  : 'bg-sage-500 text-white hover:bg-[#5C7B61] focus-visible:ring-sage-500'
              }`}
            >
              {acting ? 'Aguarde…' : confirmAction.action === 'block' ? 'Bloquear' : 'Desbloquear'}
            </button>
          </div>
        </Modal>
      )}

      {/* Edição de profissional */}
      {editTarget && (
        <Modal
          titleId={editTitleId}
          busy={editSaving}
          focusKey={editStep}
          returnFocusRef={triggerRef}
          onClose={closeEdit}
        >
          <h3 id={editTitleId} className="font-display text-xl text-wine-800 mb-5">
            {editStep === 'form' ? 'Editar profissional' : 'Confirmar alterações'}
          </h3>

          {editStep === 'form' ? (
            <div className="flex flex-col gap-4">
              {/* Avatar */}
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 rounded-2xl overflow-hidden bg-gradient-to-br from-wine-100 to-wine-200 text-wine-700 flex items-center justify-center font-display text-xl shrink-0">
                  {editAvatarB64 ? (
                    <img src={editAvatarB64} alt="Nova foto" className="w-full h-full object-cover" />
                  ) : (
                    initialsOf(editForm.name)
                  )}
                </div>
                <div>
                  <label className="text-xs font-medium text-wine-600 hover:text-wine-700 underline cursor-pointer rounded focus-within:ring-2 focus-within:ring-wine-400/50">
                    Trocar foto
                    <input type="file" accept="image/*" className="sr-only" onChange={handleAvatarFile} />
                  </label>
                  {editAvatarChanged && (
                    <p className="text-xs text-[#7A5A22] mt-0.5">Nova foto selecionada — ainda não salva</p>
                  )}
                </div>
              </div>

              <label className="block">
                <span className="block text-xs font-medium text-ink/50 uppercase tracking-wide mb-1.5">Nome</span>
                <input
                  className="input"
                  data-autofocus
                  value={editForm.name}
                  onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                />
              </label>

              <label className="block">
                <span className="block text-xs font-medium text-ink/50 uppercase tracking-wide mb-1.5">Negócio</span>
                <input
                  className="input"
                  value={editForm.businessName}
                  onChange={(e) => setEditForm((f) => ({ ...f, businessName: e.target.value }))}
                />
              </label>

              <label className="block">
                <span className="block text-xs font-medium text-ink/50 uppercase tracking-wide mb-1.5">WhatsApp</span>
                <input
                  className="input"
                  value={editForm.phoneWhatsapp}
                  onChange={(e) => setEditForm((f) => ({ ...f, phoneWhatsapp: e.target.value }))}
                />
              </label>

              <label className="block">
                <span className="block text-xs font-medium text-ink/50 uppercase tracking-wide mb-1.5">E-mail</span>
                <input
                  className="input"
                  type="email"
                  value={editForm.email}
                  onChange={(e) => setEditForm((f) => ({ ...f, email: e.target.value }))}
                />
                <p className="text-xs text-ink/40 mt-1">
                  Este e-mail é usado para login. Ao trocar, a profissional só vai conseguir entrar com o novo e-mail.
                </p>
              </label>

              {editError && (
                <div role="alert" className="rounded-xl bg-rose-50 border border-rose-200 p-3 text-sm text-rose-700">{editError}</div>
              )}

              <div className="flex gap-3 pt-1">
                <button onClick={closeEdit} className="btn-secondary flex-1">Cancelar</button>
                <button onClick={goToConfirmEdit} className="btn-primary flex-1">Revisar alterações</button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <p className="text-sm text-ink/65">
                Confirma salvar as alterações no cadastro de <strong>{editTarget.name}</strong>?
              </p>
              <ul className="text-sm text-ink/65 bg-cream rounded-2xl p-4 space-y-1.5">
                <li><span className="text-ink/40">Nome:</span> {editForm.name}</li>
                <li><span className="text-ink/40">Negócio:</span> {editForm.businessName}</li>
                <li><span className="text-ink/40">WhatsApp:</span> {editForm.phoneWhatsapp || '—'}</li>
                <li><span className="text-ink/40">E-mail:</span> {editForm.email}</li>
                {editAvatarChanged && <li><span className="text-ink/40">Foto:</span> nova foto selecionada</li>}
              </ul>
              {editForm.email !== editTarget.email && (
                <div className="rounded-xl bg-gold-300/25 border border-gold-400/40 p-3 text-xs text-[#7A5A22]">
                  O e-mail de login vai mudar. A profissional precisará usar o novo e-mail para entrar.
                </div>
              )}
              {editError && (
                <div role="alert" className="rounded-xl bg-rose-50 border border-rose-200 p-3 text-sm text-rose-700">{editError}</div>
              )}
              <div className="flex gap-3 pt-1">
                <button onClick={() => setEditStep('form')} disabled={editSaving} className="btn-secondary flex-1 disabled:opacity-60">
                  Voltar
                </button>
                <button onClick={handleSaveEdit} disabled={editSaving} className="btn-primary flex-1 disabled:opacity-60">
                  {editSaving ? 'Salvando…' : 'Confirmar e salvar'}
                </button>
              </div>
            </div>
          )}
        </Modal>
      )}

      {/* Exclusão definitiva de profissional */}
      {deleteTarget && (
        <Modal
          titleId={deleteTitleId}
          busy={deleting}
          returnFocusRef={triggerRef}
          onClose={closeDelete}
        >
          <span className="w-11 h-11 rounded-2xl bg-rose-50 text-rose-600 flex items-center justify-center mb-4"><IconBan /></span>
          <h3 id={deleteTitleId} className="font-display text-xl text-rose-700 mb-2">Excluir profissional definitivamente?</h3>
          <p className="text-sm text-ink/65 mb-3 leading-relaxed">
            Esta ação é <strong>irreversível</strong>. Todos os dados de <strong>{deleteTarget.name}</strong> (
            {deleteTarget.business_name}) serão apagados, incluindo:
          </p>

          {deletePreviewLoading ? (
            <p className="text-sm text-ink/40 mb-3" aria-live="polite">Calculando o que será apagado…</p>
          ) : deletePreview ? (
            <ul className="text-sm text-ink/65 bg-rose-50 border border-rose-200 rounded-2xl p-4 space-y-1 mb-4">
              <li>{deletePreview.clients} cliente(s)</li>
              <li>{deletePreview.appointments} agendamento(s)</li>
              <li>{deletePreview.services} serviço(s)</li>
              <li>{deletePreview.recurringGroups} recorrência(s)</li>
              <li>{deletePreview.messages} mensagem(ns) de WhatsApp</li>
              <li>{deletePreview.expenses} despesa(s)</li>
            </ul>
          ) : null}

          <label className="block mb-4">
            <span className="block text-xs font-medium text-ink/50 uppercase tracking-wide mb-1.5">
              Digite <strong>{deleteTarget.business_name}</strong> para confirmar
            </span>
            <input
              className="input"
              data-autofocus
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              autoComplete="off"
            />
          </label>

          {deleteError && (
            <div role="alert" className="rounded-xl bg-rose-50 border border-rose-200 p-3 text-sm text-rose-700 mb-3">{deleteError}</div>
          )}

          <div className="flex gap-3">
            <button onClick={closeDelete} disabled={deleting} className="btn-secondary flex-1 disabled:opacity-60">
              Cancelar
            </button>
            <button
              onClick={handleDelete}
              disabled={deleting || deleteConfirmText.trim() !== deleteTarget.business_name}
              className="flex-1 text-sm py-2 rounded-lg font-medium transition-colors disabled:opacity-40 bg-rose-600 text-white hover:bg-rose-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-400 focus-visible:ring-offset-1"
            >
              {deleting ? 'Excluindo…' : 'Excluir definitivamente'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
