import { useId, type ChangeEvent, type RefObject } from 'react';
import { IconBan, IconCheckCircle } from '../AdminIcons';
import { initialsOf } from '../admin-account/AccountBlocks';
import type { ProfessionalRow } from '../admin-dashboard/derive';
import { Modal } from './Modal';
import type { ConfirmAction, DeletePreview, EditForm } from './types';

type FocusRef = RefObject<HTMLElement | null>;

const alertBox = 'rounded-xl bg-rose-50 border border-rose-200 p-3 text-sm text-rose-700';
const fieldLabel = 'block text-xs font-medium text-ink/65 uppercase tracking-wide mb-1.5';

// ── confirmação de bloqueio / desbloqueio ───────────────────────────────────

export function ConfirmActionDialog({
  action, acting, error, returnFocusRef, onCancel, onConfirm,
}: {
  action: ConfirmAction; acting: boolean; error: string | null; returnFocusRef: FocusRef;
  onCancel: () => void; onConfirm: () => void;
}) {
  const titleId = useId();
  const block = action.action === 'block';
  return (
    <Modal titleId={titleId} busy={acting} returnFocusRef={returnFocusRef} onClose={onCancel}>
      <span className={`w-11 h-11 rounded-2xl flex items-center justify-center mb-4 ${block ? 'bg-rose-50 text-rose-600' : 'bg-sage-100 text-sage-700'}`}>
        {block ? <IconBan /> : <IconCheckCircle />}
      </span>
      <h3 id={titleId} className="font-display text-xl text-wine-800 mb-2">
        {block ? 'Bloquear profissional?' : 'Desbloquear profissional?'}
      </h3>
      <p className="text-sm text-ink/65 leading-relaxed">
        {block ? (
          <>Isso vai impedir <strong>{action.name}</strong> de acessar o sistema e encerrar a sessão dela imediatamente.</>
        ) : (
          <>Isso vai liberar o acesso de <strong>{action.name}</strong>. Ela precisará fazer login novamente.</>
        )}
      </p>
      {error && <div role="alert" className={`${alertBox} mt-3`}>{error}</div>}
      <div className="flex gap-3 pt-5">
        <button onClick={onCancel} disabled={acting} className="btn-secondary flex-1 disabled:opacity-60">
          Cancelar
        </button>
        <button
          onClick={onConfirm}
          disabled={acting}
          className={`flex-1 text-sm py-2 rounded-lg font-medium transition-colors disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 ${
            block ? 'bg-rose-600 text-white hover:bg-rose-700 focus-visible:ring-rose-400' : 'bg-sage-500 text-white hover:bg-sage-700 focus-visible:ring-sage-500'
          }`}
        >
          {acting ? 'Aguarde…' : block ? 'Bloquear' : 'Desbloquear'}
        </button>
      </div>
    </Modal>
  );
}

// ── edição (duas etapas: formulário → confirmação) ──────────────────────────

export function EditProfessionalDialog({
  target, step, form, avatarB64, avatarChanged, saving, error, returnFocusRef,
  onChange, onAvatarFile, onClose, onReview, onBack, onSave,
}: {
  target: ProfessionalRow; step: 'form' | 'confirm'; form: EditForm; avatarB64: string | null; avatarChanged: boolean;
  saving: boolean; error: string | null; returnFocusRef: FocusRef;
  onChange: (patch: Partial<EditForm>) => void; onAvatarFile: (e: ChangeEvent<HTMLInputElement>) => void;
  onClose: () => void; onReview: () => void; onBack: () => void; onSave: () => void;
}) {
  const titleId = useId();
  return (
    <Modal titleId={titleId} busy={saving} focusKey={step} returnFocusRef={returnFocusRef} onClose={onClose}>
      <h3 id={titleId} className="font-display text-xl text-wine-800 mb-5">
        {step === 'form' ? 'Editar profissional' : 'Confirmar alterações'}
      </h3>

      {step === 'form' ? (
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl overflow-hidden bg-wine-50 text-wine-700 ring-1 ring-wine-200 flex items-center justify-center font-display text-xl shrink-0">
              {avatarB64 ? <img src={avatarB64} alt="Nova foto" className="w-full h-full object-cover" /> : initialsOf(form.name)}
            </div>
            <div>
              <label className="text-xs font-medium text-wine-600 hover:text-wine-700 underline cursor-pointer rounded focus-within:ring-2 focus-within:ring-wine-400/50">
                Trocar foto
                <input type="file" accept="image/*" className="sr-only" onChange={onAvatarFile} />
              </label>
              {avatarChanged && <p className="text-xs text-gold-700 mt-0.5">Nova foto selecionada — ainda não salva</p>}
            </div>
          </div>

          <label className="block">
            <span className={fieldLabel}>Nome</span>
            <input className="input" data-autofocus value={form.name} onChange={(e) => onChange({ name: e.target.value })} />
          </label>
          <label className="block">
            <span className={fieldLabel}>Negócio</span>
            <input className="input" value={form.businessName} onChange={(e) => onChange({ businessName: e.target.value })} />
          </label>
          <label className="block">
            <span className={fieldLabel}>WhatsApp</span>
            <input className="input" value={form.phoneWhatsapp} onChange={(e) => onChange({ phoneWhatsapp: e.target.value })} />
          </label>
          <label className="block">
            <span className={fieldLabel}>E-mail</span>
            <input className="input" type="email" value={form.email} onChange={(e) => onChange({ email: e.target.value })} />
            <p className="text-xs text-ink/60 mt-1">
              Este e-mail é usado para login. Ao trocar, a profissional só vai conseguir entrar com o novo e-mail.
            </p>
          </label>

          {error && <div role="alert" className={alertBox}>{error}</div>}

          <div className="flex gap-3 pt-1">
            <button onClick={onClose} className="btn-secondary flex-1">Cancelar</button>
            <button onClick={onReview} className="btn-primary flex-1">Revisar alterações</button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-ink/65">
            Confirma salvar as alterações no cadastro de <strong>{target.name}</strong>?
          </p>
          <ul className="text-sm text-ink/65 bg-cream rounded-2xl p-4 space-y-1.5">
            <li><span className="text-ink/60">Nome:</span> {form.name}</li>
            <li><span className="text-ink/60">Negócio:</span> {form.businessName}</li>
            <li><span className="text-ink/60">WhatsApp:</span> {form.phoneWhatsapp || '—'}</li>
            <li><span className="text-ink/60">E-mail:</span> {form.email}</li>
            {avatarChanged && <li><span className="text-ink/60">Foto:</span> nova foto selecionada</li>}
          </ul>
          {form.email !== target.email && (
            <div className="rounded-xl bg-gold-300/25 border border-gold-400/40 p-3 text-xs text-gold-700">
              O e-mail de login vai mudar. A profissional precisará usar o novo e-mail para entrar.
            </div>
          )}
          {error && <div role="alert" className={alertBox}>{error}</div>}
          <div className="flex gap-3 pt-1">
            <button onClick={onBack} disabled={saving} className="btn-secondary flex-1 disabled:opacity-60">Voltar</button>
            <button onClick={onSave} disabled={saving} className="btn-primary flex-1 disabled:opacity-60">
              {saving ? 'Salvando…' : 'Confirmar e salvar'}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ── exclusão definitiva ─────────────────────────────────────────────────────

export function DeleteProfessionalDialog({
  target, preview, previewLoading, confirmText, deleting, error, returnFocusRef,
  onConfirmTextChange, onClose, onDelete,
}: {
  target: ProfessionalRow; preview: DeletePreview | null; previewLoading: boolean; confirmText: string;
  deleting: boolean; error: string | null; returnFocusRef: FocusRef;
  onConfirmTextChange: (v: string) => void; onClose: () => void; onDelete: () => void;
}) {
  const titleId = useId();
  return (
    <Modal titleId={titleId} busy={deleting} returnFocusRef={returnFocusRef} onClose={onClose}>
      <span className="w-11 h-11 rounded-2xl bg-rose-50 text-rose-600 flex items-center justify-center mb-4"><IconBan /></span>
      <h3 id={titleId} className="font-display text-xl text-rose-700 mb-2">Excluir profissional definitivamente?</h3>
      <p className="text-sm text-ink/65 mb-3 leading-relaxed">
        Esta ação é <strong>irreversível</strong>. Todos os dados de <strong>{target.name}</strong> (
        {target.business_name}) serão apagados, incluindo:
      </p>

      {previewLoading ? (
        <p className="text-sm text-ink/60 mb-3" aria-live="polite">Calculando o que será apagado…</p>
      ) : preview ? (
        <ul className="text-sm text-ink/65 bg-rose-50 border border-rose-200 rounded-2xl p-4 space-y-1 mb-4">
          <li>{preview.clients} cliente(s)</li>
          <li>{preview.appointments} agendamento(s)</li>
          <li>{preview.services} serviço(s)</li>
          <li>{preview.recurringGroups} recorrência(s)</li>
          <li>{preview.messages} mensagem(ns) de WhatsApp</li>
          <li>{preview.expenses} despesa(s)</li>
        </ul>
      ) : null}

      <label className="block mb-4">
        <span className={fieldLabel}>
          Digite <strong>{target.business_name}</strong> para confirmar
        </span>
        <input className="input" data-autofocus value={confirmText} onChange={(e) => onConfirmTextChange(e.target.value)} autoComplete="off" />
      </label>

      {error && <div role="alert" className={`${alertBox} mb-3`}>{error}</div>}

      <div className="flex gap-3">
        <button onClick={onClose} disabled={deleting} className="btn-secondary flex-1 disabled:opacity-60">Cancelar</button>
        <button
          onClick={onDelete}
          disabled={deleting || confirmText.trim() !== target.business_name}
          className="flex-1 text-sm py-2 rounded-lg font-medium transition-colors disabled:opacity-40 bg-rose-600 text-white hover:bg-rose-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-400 focus-visible:ring-offset-1"
        >
          {deleting ? 'Excluindo…' : 'Excluir definitivamente'}
        </button>
      </div>
    </Modal>
  );
}
