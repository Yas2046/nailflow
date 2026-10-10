import { initialsOf } from '../admin-account/AccountBlocks';
import { Badge } from '../admin-account/AccountUi';
import type { ProfessionalRow } from '../admin-dashboard/derive';
import { formatPhoneNational } from '../../utils/format';
import { IconMail, IconPhone } from './icons';
import { RowMenu, type MenuItem } from './RowMenu';

// Uma linha da lista de contas. No celular vira um bloco empilhado; a partir de `lg` as colunas
// se alinham como numa tabela (o mesmo elemento, sem duplicar o menu de ações).

const COLS = 'lg:grid-cols-[minmax(0,2.2fr)_8.5rem_minmax(0,2fr)_minmax(0,1.1fr)_6.5rem_2.5rem]';

function formatSince(iso: string) {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

/** Cabeçalho das colunas (só aparece em telas largas; a lista é a mesma para leitores de tela). */
export function ProfessionalsTableHead() {
  return (
    <div
      aria-hidden="true"
      className={`hidden border-b border-wine-100 bg-wine-50/60 px-6 py-2.5 font-mono text-[11px] uppercase tracking-[0.14em] text-ink/60 lg:grid ${COLS} lg:gap-x-5`}
    >
      <span>Conta</span><span>Situação</span><span>Contato</span><span>Instância</span><span className="text-right">Cadastro</span><span />
    </div>
  );
}

function Avatar({ name, blocked }: { name: string; blocked: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg font-display text-sm font-semibold ${
        blocked ? 'bg-rose-100 text-rose-700' : 'bg-wine-50 text-wine-700'
      }`}
    >
      {initialsOf(name)}
    </span>
  );
}

/** Linha de uma conta de profissional (item da lista). */
export default function ProfessionalCard({
  p, menuItems, onOpenTrigger,
}: {
  p: ProfessionalRow;
  menuItems: MenuItem[];
  onOpenTrigger: (el: HTMLElement | null) => void;
}) {
  const blocked = p.blocked_at !== null;
  return (
    <li
      className={`relative grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-5 gap-y-3 px-5 py-4 transition-colors sm:px-6 ${COLS} ${
        blocked ? 'bg-rose-50/40' : 'hover:bg-wine-50/40'
      }`}
    >
      {blocked && <span aria-hidden="true" className="absolute inset-y-0 left-0 w-[3px] bg-rose-500" />}

      {/* conta */}
      <div className="flex min-w-0 items-center gap-3.5">
        <Avatar name={p.name} blocked={blocked} />
        <div className="min-w-0">
          <p className="truncate text-[15px] font-semibold leading-snug text-ink/95" title={p.name}>{p.name}</p>
          <p className="truncate text-sm text-ink/65" title={p.business_name}>{p.business_name}</p>
        </div>
      </div>

      {/* menu (no celular fica ao lado do nome) */}
      <div className="col-start-2 row-start-1 -mr-2 lg:order-last lg:col-auto lg:row-auto lg:mr-0 lg:justify-self-end">
        <RowMenu label={`Ações para ${p.name}`} items={menuItems} onOpenTrigger={onOpenTrigger} />
      </div>

      {/* situação */}
      <div className="col-span-2 lg:col-span-1">
        {blocked ? <Badge tone="danger">Bloqueada</Badge> : <Badge tone="ok">Ativa</Badge>}
      </div>

      {/* contato */}
      <dl className="col-span-2 min-w-0 space-y-1 text-sm lg:col-span-1">
        <div className="flex min-w-0 items-center gap-2.5">
          <dt className="shrink-0 text-ink/50"><span className="sr-only">E-mail</span><IconMail /></dt>
          <dd className="min-w-0 truncate text-ink/80" title={p.email}>{p.email}</dd>
        </div>
        <div className="flex min-w-0 items-center gap-2.5">
          <dt className="shrink-0 text-ink/50"><span className="sr-only">WhatsApp</span><IconPhone /></dt>
          <dd className="min-w-0 truncate text-ink/80">
            {p.phone_whatsapp ? formatPhoneNational(p.phone_whatsapp) : <span className="text-ink/55">Número não informado</span>}
          </dd>
        </div>
      </dl>

      {/* instância */}
      <div className="col-span-2 min-w-0 lg:col-span-1">
        <p className="mb-1 font-mono text-[11px] uppercase tracking-wider text-ink/55 lg:hidden">Instância WhatsApp</p>
        {p.wa_instance_name ? (
          <span className="inline-block max-w-full truncate rounded-md bg-night-900 px-2 py-1 align-middle font-mono text-xs text-wine-200" title={p.wa_instance_name}>
            {p.wa_instance_name}
          </span>
        ) : (
          <Badge tone="warn">Sem instância</Badge>
        )}
      </div>

      {/* cadastro */}
      <p className="col-span-2 whitespace-nowrap font-mono text-xs text-ink/65 lg:col-span-1 lg:text-right">
        <span className="lg:sr-only">Cadastro em </span>
        {formatSince(p.created_at)}
      </p>
    </li>
  );
}
