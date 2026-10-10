import { useEffect, useRef, type ChangeEvent, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import AccountShell from '../../components/admin-account/AccountShell';
import { Badge, Eyebrow, Panel, Skeleton } from '../../components/admin-account/AccountUi';
import {
  ENTER, Avatar, ErrorState, longDate,
} from '../../components/admin-account/AccountBlocks';
import { useAccountOverview, type AccountOverview } from '../../components/admin-account/useAccountOverview';
import { useProfileEdit } from '../../components/admin-account/useProfileEdit';
import { formatPhoneNational } from '../../utils/format';
import { IconUser } from '../../components/AdminIcons';
import { useAdminShell } from '../../components/adminShell';
import { usePageTitle } from '../../hooks/usePageTitle';

// O que pode ser editado é o que PUT /auth/me realmente aceita para esta conta: nome, e-mail,
// WhatsApp e foto. Não há verificação de e-mail ou telefone no sistema, então nenhum selo de
// "verificado" é exibido. Segurança (senha, 2FA, sessões) continua apenas informativa.

type Edit = ReturnType<typeof useProfileEdit>;

const icon = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, viewBox: '0 0 24 24', 'aria-hidden': true, className: 'h-5 w-5' } as const;

function IconMail() {
  return (
    <svg {...icon}>
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <path strokeLinecap="round" strokeLinejoin="round" d="m4 7.5 8 5.5 8-5.5" />
    </svg>
  );
}
function IconPhone() {
  return (
    <svg {...icon}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 4h3.5l1.5 4-2 1.3a10 10 0 0 0 5.2 5.2L14.5 12.5l4 1.5V17.5A1.5 1.5 0 0 1 17 19 12 12 0 0 1 5 7a1.5 1.5 0 0 1 0-3Z" />
    </svg>
  );
}
function Spinner() {
  return (
    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.3" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

// ── identidade ──────────────────────────────────────────────────────────────

function AvatarControls({ edit, hasPhoto }: { edit: Edit; hasPhoto: boolean }) {
  function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // permite escolher o mesmo arquivo de novo
    if (file) void edit.pickAvatar(file);
  }
  return (
    <div className="mt-6 flex flex-col items-center gap-2">
      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
        <label className={`btn-secondary min-h-[40px] cursor-pointer px-4 text-sm focus-within:ring-2 focus-within:ring-wine-500/40 ${edit.saving ? 'pointer-events-none opacity-50' : ''}`}>
          {hasPhoto ? 'Trocar foto' : 'Adicionar foto'}
          <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={onFile} disabled={edit.saving} />
        </label>
        {hasPhoto && (
          <button
            type="button"
            onClick={edit.removeAvatar}
            disabled={edit.saving}
            className="min-h-[40px] rounded-lg px-2 text-sm text-ink/65 transition-colors hover:text-rose-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-400/50 disabled:opacity-50"
          >
            Remover foto
          </button>
        )}
      </div>
      {edit.avatarError && <p role="alert" className="max-w-[16rem] text-center text-sm text-rose-600">{edit.avatarError}</p>}
    </div>
  );
}

function IdentityCard({ data, edit }: { data: AccountOverview; edit: Edit }) {
  const { me, blockedAt, createdAt } = data;
  const active = blockedAt === null;
  return (
    <section
      aria-labelledby="perfil-nome"
      className={`relative overflow-hidden rounded-2xl border bg-white transition-colors duration-300 ${edit.editing ? 'border-wine-400' : 'border-wine-100'} ${ENTER}`}
    >
      <div aria-hidden="true" className={`absolute inset-y-0 left-0 w-[3px] ${edit.editing ? 'bg-wine-500' : 'bg-wine-100'}`} />
      <div className="flex flex-col gap-6 p-5 sm:flex-row sm:items-start sm:gap-8 sm:p-8">
        <div className="flex shrink-0 flex-col items-start">
          <Avatar name={me.name} src={edit.avatarSrc} size="md" />
          {edit.editing && <AvatarControls edit={edit} hasPhoto={!!edit.avatarSrc} />}
        </div>

        <div className="min-w-0 flex-1">
          <Eyebrow>Identidade</Eyebrow>
          <h2 id="perfil-nome" className="mt-2 break-words font-display text-[1.875rem] font-semibold leading-tight text-wine-800 sm:text-4xl">
            {me.name}
          </h2>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Badge tone="info" dot={false}>Administradora</Badge>
            <Badge tone={active ? 'ok' : 'danger'}>{active ? 'Conta ativa' : 'Conta bloqueada'}</Badge>
          </div>

          {createdAt && <p className="mt-3 font-mono text-xs text-ink/65">administradora desde {longDate(createdAt)}</p>}

          <div className="mt-5 min-h-[44px]">
            {edit.editing ? (
              <p className="inline-flex items-center gap-2.5 text-sm font-medium text-gold-700" aria-live="polite">
                <span aria-hidden="true" className={`h-2 w-2 rounded-full bg-gold-500 ${edit.dirty ? '' : 'opacity-50'}`} />
                {edit.dirty ? 'Editando · alterações pendentes' : 'Editando perfil'}
              </p>
            ) : (
              <button
                type="button"
                onClick={edit.start}
                className="btn-secondary min-h-[44px] px-5"
              >
                Editar perfil
              </button>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

// ── perfil ──────────────────────────────────────────────────────────────────

function Field({ icon: ic, label, value, empty = false }: { icon: ReactNode; label: string; value: string; empty?: boolean }) {
  return (
    <div className="flex items-center gap-4 py-4">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-wine-50 text-wine-600">{ic}</span>
      <div className="min-w-0">
        <dt className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink/60">{label}</dt>
        <dd className={`mt-0.5 break-words text-base ${empty ? 'text-ink/60' : 'text-ink/90'}`}>{value}</dd>
      </div>
    </div>
  );
}

function EditField({
  id, label, hint, error, inputRef, ...input
}: {
  id: string; label: string; hint?: string; error?: string;
  inputRef?: React.Ref<HTMLInputElement>;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'id'>) {
  const describedBy = error ? `${id}-erro` : hint ? `${id}-dica` : undefined;
  return (
    <div className="py-3.5">
      <label htmlFor={id} className="mb-1.5 block font-mono text-[11px] uppercase tracking-[0.14em] text-ink/65">{label}</label>
      <input
        id={id}
        ref={inputRef}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={`input h-12 disabled:opacity-60 ${error ? '!border-rose-400 focus:!ring-rose-300/30' : ''}`}
        {...input}
      />
      {error ? (
        <p id={`${id}-erro`} role="alert" className="mt-1.5 text-sm text-rose-600">{error}</p>
      ) : hint ? (
        <p id={`${id}-dica`} className="mt-1.5 text-sm text-ink/60">{hint}</p>
      ) : null}
    </div>
  );
}

function ProfileCard({ data, edit }: { data: AccountOverview; edit: Edit }) {
  const { me } = data;
  const nameRef = useRef<HTMLInputElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  // ao entrar no modo de edição, leva o foco ao primeiro campo
  useEffect(() => {
    if (!edit.editing) return;
    nameRef.current?.focus({ preventScroll: true });
    cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [edit.editing]);

  return (
    <div ref={cardRef} className="flex">
      <Panel className={`flex w-full flex-col ${ENTER} [animation-delay:90ms] ${edit.editing ? '!border-wine-400' : ''}`}>
        <Eyebrow>Dados</Eyebrow>
        <h3 className="mt-2 font-display text-xl font-semibold leading-tight text-wine-800">Dados pessoais</h3>

        {edit.editing ? (
          <form
            className="mt-4 flex flex-1 flex-col"
            noValidate
            onSubmit={(e) => { e.preventDefault(); void edit.save(); }}
          >
            <div className="grid flex-1 gap-x-8 sm:grid-cols-2">
              <EditField
                id="perfil-nome-input" label="Nome" inputRef={nameRef} autoComplete="name"
                value={edit.draft.name} disabled={edit.saving} error={edit.errorOf('name')}
                onChange={(e) => edit.setField('name', e.target.value)} onBlur={() => edit.touch('name')}
              />
              <EditField
                id="perfil-email-input" label="E-mail" type="email" autoComplete="email" inputMode="email"
                hint="Este e-mail é usado para entrar no NailFlow."
                value={edit.draft.email} disabled={edit.saving} error={edit.errorOf('email')}
                onChange={(e) => edit.setField('email', e.target.value)} onBlur={() => edit.touch('email')}
              />
              <EditField
                id="perfil-whatsapp-input" label="WhatsApp" type="tel" autoComplete="tel" inputMode="tel"
                placeholder="(31) 90000-0000"
                hint={me.phone_whatsapp ? 'Com DDD.' : 'Necessário para salvar alterações de nome e e-mail.'}
                value={edit.draft.phone} disabled={edit.saving} error={edit.errorOf('phone')}
                onChange={(e) => edit.setField('phone', e.target.value)} onBlur={() => edit.touch('phone')}
              />
            </div>

            {edit.saveError && (
              <p role="alert" className="mt-4 rounded-lg border border-rose-200 bg-rose-50/70 px-4 py-3 text-[15px] text-rose-700">
                {edit.saveError}
              </p>
            )}

            <div className="mt-7 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-ink/65" aria-live="polite">
                {edit.dirty ? 'Você tem alterações não salvas.' : 'Nenhuma alteração ainda.'}
              </p>
              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                <button type="button" onClick={edit.discard} disabled={edit.saving} className="btn-secondary min-h-[46px] w-full whitespace-nowrap px-5 disabled:opacity-50 sm:w-auto">
                  Descartar alterações
                </button>
                <button type="submit" disabled={!edit.canSave} className="btn-primary min-h-[46px] w-full whitespace-nowrap px-6 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto">
                  {edit.saving ? <><Spinner />Salvando…</> : 'Salvar alterações'}
                </button>
              </div>
            </div>
          </form>
        ) : (
          <dl className="mt-6 grid flex-1 gap-x-10 sm:grid-cols-2 [&>div]:border-b [&>div]:border-wine-100/60 [&>div:last-child]:border-0">
            <Field icon={<IconUser />} label="Nome" value={me.name} />
            <Field icon={<IconMail />} label="E-mail" value={me.email} />
            <Field
              icon={<IconPhone />}
              label="WhatsApp"
              value={me.phone_whatsapp ? formatPhoneNational(me.phone_whatsapp) : 'Não informado'}
              empty={!me.phone_whatsapp}
            />
          </dl>
        )}
      </Panel>
    </div>
  );
}

// ── estados ─────────────────────────────────────────────────────────────────

function LoadingState() {
  return (
    <div role="status" aria-label="Carregando seu perfil" className="space-y-8">
      <Skeleton className="h-72 rounded-2xl sm:h-60" />
      <Skeleton className="h-96 rounded-2xl" />
    </div>
  );
}

// ── página ──────────────────────────────────────────────────────────────────

function PerfilConteudo({ data, patchMe }: { data: AccountOverview; patchMe: Parameters<typeof useProfileEdit>[1] }) {
  const shell = useAdminShell();
  const edit = useProfileEdit(data.me, (p) => {
    patchMe(p);
    if ('avatar_b64' in p) shell?.setAvatar(p.avatar_b64 ?? null); // a foto salva já aparece no menu
  });
  const [params] = useSearchParams();
  const startEdit = params.get('editar') === '1';
  // vindo de "Editar perfil" na Visão geral: já abre o formulário (uma única vez)
  useEffect(() => {
    if (startEdit) edit.start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="space-y-6">
      <IdentityCard data={data} edit={edit} />
      <ProfileCard data={data} edit={edit} />
    </div>
  );
}

export default function AdminContaPerfil() {
  usePageTitle('Perfil · Central da conta');
  const { state, reload, patchMe } = useAccountOverview();

  return (
    <AccountShell title="Perfil" subtitle="Sua identidade no NailFlow: nome, e-mail, WhatsApp e foto.">
      {state.status === 'loading' && <LoadingState />}
      {state.status === 'error' && <ErrorState message={state.message} onRetry={reload} />}
      {state.status === 'ready' && <PerfilConteudo data={state.data} patchMe={patchMe} />}
    </AccountShell>
  );
}
