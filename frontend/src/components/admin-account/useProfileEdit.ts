import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import type { AccountMe } from './useAccountOverview';
import { MAX_AVATAR_B64_CHARS, resizeImageToBase64 } from './imageUtils';
import { formatPhone } from '../../utils/format';

/*
 * Contrato real de PUT /auth/me (authController.updateMe), confirmado no código:
 *  - Identidade é "tudo ou nada": se qualquer um de name / business_name / phone_whatsapp /
 *    email for enviado, os quatro são obrigatórios (WhatsApp: 10 a 20 caracteres; e-mail único).
 *  - avatar_b64 (JPEG/PNG/WebP em data URL, até 90.000 caracteres, ou null para remover) pode
 *    ser enviado sozinho, sem os campos de identidade.
 *  - business_name não é editável nesta tela; é reenviado como está.
 *  - A resposta traz id, name, email, business_name, phone_whatsapp, avatar_b64, slug, bio, public_theme.
 */

export interface ProfileDraft {
  name: string;
  email: string;
  phone: string;
}
export type ProfileField = keyof ProfileDraft;
export type FieldErrors = Partial<Record<ProfileField, string>>;

// undefined = foto sem alteração · string = nova foto · null = remover foto
type AvatarDraft = string | null | undefined;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const onlyDigits = (v: string) => v.replace(/\D/g, '');

function draftFrom(me: AccountMe): ProfileDraft {
  return { name: me.name, email: me.email, phone: me.phone_whatsapp ? formatPhone(me.phone_whatsapp) : '' };
}

export function useProfileEdit(me: AccountMe, patchMe: (p: Partial<AccountMe>) => void) {
  const { professional, updateProfessional } = useAuth();
  const { toast } = useToast();

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<ProfileDraft>(() => draftFrom(me));
  const [avatarDraft, setAvatarDraft] = useState<AvatarDraft>(undefined);
  const [touched, setTouched] = useState<Partial<Record<ProfileField, boolean>>>({});
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [avatarError, setAvatarError] = useState<string | null>(null);

  const nameN = draft.name.trim();
  const emailN = draft.email.trim().toLowerCase();
  const phoneDigits = onlyDigits(draft.phone);

  const nameChanged = nameN !== me.name.trim();
  const emailChanged = emailN !== me.email.trim().toLowerCase();
  const phoneChanged = phoneDigits !== onlyDigits(me.phone_whatsapp ?? '');
  const identityChanged = nameChanged || emailChanged || phoneChanged;
  const avatarChanged = avatarDraft !== undefined && avatarDraft !== me.avatar_b64;
  const dirty = identityChanged || avatarChanged;

  const errors: FieldErrors = useMemo(() => {
    const e: FieldErrors = {};
    if (!nameN) e.name = 'Informe o seu nome.';
    else if (nameN.length > 100) e.name = 'Use no máximo 100 caracteres.';
    if (!EMAIL_RE.test(emailN)) e.email = 'Informe um e-mail válido.';
    else if (emailN.length > 200) e.email = 'Use no máximo 200 caracteres.';
    // O backend exige o WhatsApp ao salvar qualquer dado de identidade.
    if (identityChanged) {
      if (phoneDigits.length < 10) e.phone = 'Informe o WhatsApp com DDD (mínimo 10 dígitos).';
      else if (phoneDigits.length > 15) e.phone = 'Número muito longo.';
    }
    return e;
  }, [nameN, emailN, phoneDigits, identityChanged]);

  const hasErrors = Object.keys(errors).length > 0;
  const canSave = editing && dirty && !hasErrors && !saving;
  const visibleError = (f: ProfileField) => (touched[f] || submitted ? errors[f] : undefined);

  // Aviso do navegador ao fechar/recarregar com alterações não salvas.
  useEffect(() => {
    if (!editing || !dirty) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [editing, dirty]);

  const reset = useCallback(() => {
    setDraft(draftFrom(me));
    setAvatarDraft(undefined);
    setTouched({});
    setSubmitted(false);
    setSaveError(null);
    setAvatarError(null);
  }, [me]);

  const start = useCallback(() => { reset(); setEditing(true); }, [reset]);
  const discard = useCallback(() => { reset(); setEditing(false); }, [reset]);

  const setField = useCallback((field: ProfileField, value: string) => {
    setDraft((d) => ({ ...d, [field]: value }));
    setSaveError(null);
  }, []);
  const touch = useCallback((field: ProfileField) => setTouched((t) => ({ ...t, [field]: true })), []);

  const pickAvatar = useCallback(async (file: File) => {
    setAvatarError(null);
    if (!file.type.startsWith('image/')) { setAvatarError('Escolha um arquivo de imagem (JPEG, PNG ou WebP).'); return; }
    try {
      const b64 = await resizeImageToBase64(file);
      if (b64.length > MAX_AVATAR_B64_CHARS) { setAvatarError('Imagem muito grande. Escolha uma foto mais simples.'); return; }
      setAvatarDraft(b64);
    } catch (err) {
      setAvatarError(err instanceof Error ? err.message : 'Não foi possível processar a imagem.');
    }
  }, []);
  const removeAvatar = useCallback(() => { setAvatarError(null); setAvatarDraft(null); }, []);

  const save = useCallback(async () => {
    setSubmitted(true);
    if (!editing || !dirty || hasErrors || saving) return;
    const payload: Record<string, unknown> = {};
    if (identityChanged) {
      payload.name = nameN;
      payload.business_name = me.business_name || 'NailFlow';
      payload.phone_whatsapp = phoneChanged ? phoneDigits : me.phone_whatsapp;
      payload.email = emailN;
    }
    if (avatarChanged) payload.avatar_b64 = avatarDraft;

    setSaving(true);
    setSaveError(null);
    try {
      const updated = await api.put<Partial<AccountMe> & { name: string; email: string }>('/auth/me', payload);
      patchMe({
        name: updated.name,
        email: updated.email,
        business_name: updated.business_name ?? me.business_name,
        phone_whatsapp: updated.phone_whatsapp ?? null,
        avatar_b64: updated.avatar_b64 ?? null,
      });
      // mantém o cache da sessão (menu lateral) em sincronia, preservando isAdmin e demais campos
      if (professional) {
        updateProfessional({ ...professional, name: updated.name, email: updated.email, businessName: updated.business_name ?? professional.businessName });
      }
      setEditing(false);
      setDraft({ name: updated.name, email: updated.email, phone: updated.phone_whatsapp ? formatPhone(updated.phone_whatsapp) : '' });
      setAvatarDraft(undefined);
      setTouched({});
      setSubmitted(false);
      toast('Perfil atualizado com sucesso');
    } catch (err) {
      const friendly = err instanceof ApiError ? err.message : 'Não foi possível salvar. Verifique sua conexão e tente novamente.';
      setSaveError(friendly);
      toast(friendly, 'error');
    } finally {
      setSaving(false);
    }
  }, [editing, dirty, hasErrors, saving, identityChanged, nameN, emailN, phoneChanged, phoneDigits, avatarChanged, avatarDraft, me, patchMe, professional, updateProfessional, toast]);

  return {
    editing, draft, saving, saveError, avatarError, dirty, canSave,
    avatarSrc: avatarDraft !== undefined ? avatarDraft : me.avatar_b64,
    avatarChanged,
    errorOf: visibleError,
    start, discard, setField, touch, pickAvatar, removeAvatar, save,
  };
}
