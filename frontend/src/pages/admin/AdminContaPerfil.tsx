import { useEffect, useRef, type ChangeEvent, type ReactNode } from 'react';
import AccountShell from '../../components/admin-account/AccountShell';
import { Eyebrow, Panel, Skeleton, SoonButton, StatusDot } from '../../components/admin-account/AccountUi';
import {
  ENTER, ActivityPanel, Avatar, ErrorState, Pill, longDate,
} from '../../components/admin-account/AccountBlocks';
import { useAccountOverview, type AccountOverview } from '../../components/admin-account/useAccountOverview';
import { useProfileEdit } from '../../components/admin-account/useProfileEdit';
import { formatPhone } from '../../utils/format';

// O que pode ser editado é o que PUT /auth/me realmente aceita para esta conta: nome, e-mail,
// WhatsApp e foto. Não há verificação de e-mail ou telefone no sistema, então nenhum selo de
// "verificado" é exibido. Segurança (senha, 2FA, sessões) continua apenas informativa.

type Edit = ReturnType<typeof useProfileEdit>;

const icon = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, viewBox: '0 0 24 24', 'aria-hidden': true, className: 'h-5 w-5' } as const;

function IconUser() {
  return (
    <svg {...icon}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4.5 20a7.5 7.5 0 0 1 15 0" />
    </svg>
  );
}
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
            className="min-h-[40px] rounded-lg px-2 text-sm text-ink/55 transition-colors hover:text-rose-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-400/50 disabled:opacity-50"
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
      className={`relative overflow-hidden rounded-[2rem] border bg-gradient-to-br from-white via-white to-wine-50/60 shadow-[inset_0_1px_0_rgba(255,255,255,0.95),0_1px_2px_rgba(61,29,40,0.05),0_30px_70px_-38px_rgba(61,29,40,0.3)] transition-colors duration-500 ${edit.editing ? 'border-wine-300/60' : 'border-wine-100/80'} ${ENTER}`}
    >
      <div aria-hidden="true" className="pointer-events-none absolute -right-24 -top-24 h-[24rem] w-[24rem] rounded-full bg-[radial-gradient(closest-side,rgba(199,154,69,0.14),transparent)]" />
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-gold-400/50 to-transparent" />

      <div className="relative flex flex-col items-center gap-8 px-6 py-10 text-center sm:flex-row sm:items-start sm:gap-10 sm:px-10 sm:py-12 sm:text-left">
        <div className="flex shrink-0 flex-col items-center">
          <Avatar name={me.name} src={edit.avatarSrc} size="md" />
          {edit.editing && <AvatarControls edit={edit} hasPhoto={!!edit.avatarSrc} />}
        </div>

        <div className="min-w-0 flex-1 sm:pt-2">
          <Eyebrow tone="gold">Perfil</Eyebrow>
          <h2 id="perfil-nome" className="mt-2 break-words font-display text-4xl font-semibold leading-tight tracking-tight text-wine-800 sm:text-5xl">
            {me.name}
          </h2>

          <div className="mt-5 flex flex-wrap items-center justify-center gap-3 sm:justify-start">
            <span className="inline-flex items-center rounded-full border border-gold-400/50 bg-gold-300/20 px-4 py-1.5 text-sm font-semibold tracking-wide text-gold-600">
              Administradora
            </span>
            <span className="inline-flex items-center gap-3 whitespace-nowrap rounded-full bg-sage-100/70 px-4 py-1.5 text-sm font-medium text-[#3F5F46]">
              <StatusDot tone={active ? 'sage' : 'rose'} />
              {active ? 'Conta ativa' : 'Conta bloqueada'}
            </span>
          </div>

          {createdAt && <p className="mt-4 text-base text-ink/55">Administradora desde {longDate(createdAt)}</p>}

          <div className="mt-6 min-h-[46px]">
            {edit.editing ? (
              <p className="inline-flex items-center gap-3 text-[15px] font-medium text-gold-600" aria-live="polite">
                <span aria-hidden="true" className={`h-2.5 w-2.5 rounded-full bg-gold-500 ${edit.dirty ? 'shadow-[0_0_0_4px_rgba(199,154,69,0.2)]' : 'opacity-50'}`} />
                {edit.dirty ? 'Editando · alterações pendentes' : 'Editando perfil'}
              </p>
            ) : (
              <button
                type="button"
                onClick={edit.start}
                className="btn-secondary min-h-[46px] px-6 focus-visible:ring-2 focus-visible:ring-wine-500/40"
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
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-wine-50/80 text-wine-500">{ic}</span>
      <div className="min-w-0">
        <dt className="text-sm text-ink/45">{label}</dt>
        <dd className={`mt-0.5 break-words text-lg ${empty ? 'text-ink/35' : 'text-ink/85'}`}>{value}</dd>
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
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-ink/60">{label}</label>
      <input
        id={id}
        ref={inputRef}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={`input h-12 text-base disabled:opacity-60 ${error ? '!border-rose-400 focus:!ring-rose-300/30' : ''}`}
        {...input}
      />
      {error ? (
        <p id={`${id}-erro`} role="alert" className="mt-1.5 text-sm text-rose-600">{error}</p>
      ) : hint ? (
        <p id={`${id}-dica`} className="mt-1.5 text-sm text-ink/45">{hint}</p>
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
      <Panel className={`flex w-full flex-col ${ENTER} [animation-delay:90ms] ${edit.editing ? '!border-wine-300/70 ring-2 ring-wine-300/25' : ''}`}>
        <Eyebrow>Identidade</Eyebrow>
        <h3 className="mt-3 font-display text-3xl leading-tight text-wine-800">Perfil</h3>

        {edit.editing ? (
          <form
            className="mt-4 flex flex-1 flex-col"
            noValidate
            onSubmit={(e) => { e.preventDefault(); void edit.save(); }}
          >
            <div className="flex-1 divide-y divide-wine-100/60">
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
              <p role="alert" className="mt-4 rounded-xl border border-rose-200 bg-rose-50/70 px-4 py-3 text-[15px] text-rose-700">
                {edit.saveError}
              </p>
            )}

            <div className="mt-7 flex flex-col gap-4">
              <p className="text-sm text-ink/50" aria-live="polite">
                {edit.dirty ? 'Você tem alterações não salvas.' : 'Nenhuma alteração ainda.'}
              </p>
              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end md:flex-col-reverse lg:flex-row min-[1400px]:flex-col-reverse">
                <button type="button" onClick={edit.discard} disabled={edit.saving} className="btn-secondary min-h-[46px] w-full whitespace-nowrap px-5 disabled:opacity-50 sm:w-auto md:w-full lg:w-auto min-[1400px]:w-full">
                  Descartar alterações
                </button>
                <button type="submit" disabled={!edit.canSave} className="btn-primary min-h-[46px] w-full whitespace-nowrap px-6 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto md:w-full lg:w-auto min-[1400px]:w-full">
                  {edit.saving ? <><Spinner />Salvando…</> : 'Salvar alterações'}
                </button>
              </div>
            </div>
          </form>
        ) : (
          <dl className="mt-6 flex-1 divide-y divide-wine-100/60">
            <Field icon={<IconUser />} label="Nome" value={me.name} />
            <Field icon={<IconMail />} label="E-mail" value={me.email} />
            <Field
              icon={<IconPhone />}
              label="WhatsApp"
              value={me.phone_whatsapp ? formatPhone(me.phone_whatsapp) : 'Não informado'}
              empty={!me.phone_whatsapp}
            />
          </dl>
        )}
      </Panel>
    </div>
  );
}

// ── segurança (somente informativa) ─────────────────────────────────────────

function SecurityCard({ editing }: { editing: boolean }) {
  const rows: Array<{ label: string; value: string; ok: boolean }> = [
    { label: 'Senha', value: 'Definida', ok: true },
    { label: 'Autenticação em 2 fatores', value: 'Não disponível', ok: false },
    { label: 'Sessões ativas', value: 'Não monitoradas', ok: false },
  ];
  return (
    <Panel className={`flex flex-col ${editing ? 'self-start' : ''} ${ENTER} [animation-delay:150ms]`}>
      <Eyebrow>Acesso</Eyebrow>
      <h3 className="mt-3 font-display text-3xl leading-tight text-wine-800">Segurança</h3>
      <dl className="mt-6 flex-1 divide-y divide-wine-100/60">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between gap-4 py-5">
            <dt className="min-w-0 flex-1 text-[15px] text-ink/75">{r.label}</dt>
            <dd className="shrink-0"><Pill ok={r.ok}>{r.value}</Pill></dd>
          </div>
        ))}
      </dl>
      <div className="mt-8"><SoonButton>Gerenciar segurança</SoonButton></div>
    </Panel>
  );
}

// ── estados ─────────────────────────────────────────────────────────────────

function LoadingState() {
  return (
    <div role="status" aria-label="Carregando seu perfil" className="space-y-8">
      <Skeleton className="h-72 rounded-[2rem] sm:h-60" />
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-1 min-[1400px]:grid-cols-2">
        <Skeleton className="h-80 rounded-3xl" />
        <Skeleton className="h-80 rounded-3xl" />
      </div>
      <Skeleton className="h-64 rounded-3xl" />
    </div>
  );
}

// ── página ──────────────────────────────────────────────────────────────────

function PerfilConteudo({ data, patchMe }: { data: AccountOverview; patchMe: Parameters<typeof useProfileEdit>[1] }) {
  const edit = useProfileEdit(data.me, patchMe);
  return (
    <div className="space-y-8 sm:space-y-10">
      <IdentityCard data={data} edit={edit} />
      <div className="grid gap-6 sm:gap-8 md:grid-cols-2 lg:grid-cols-1 min-[1400px]:grid-cols-2">
        <ProfileCard data={data} edit={edit} />
        <SecurityCard editing={edit.editing} />
      </div>
      <ActivityPanel activity={data.activity} />
    </div>
  );
}

export default function AdminContaPerfil() {
  const { state, reload, patchMe } = useAccountOverview();

  return (
    <AccountShell title="Minha conta" subtitle="Gerencie sua identidade, segurança e atividade no NailFlow.">
      {state.status === 'loading' && <LoadingState />}
      {state.status === 'error' && <ErrorState message={state.message} onRetry={reload} />}
      {state.status === 'ready' && <PerfilConteudo data={state.data} patchMe={patchMe} />}
    </AccountShell>
  );
}
