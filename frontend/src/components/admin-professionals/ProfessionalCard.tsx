import { initialsOf } from '../admin-account/AccountBlocks';
import type { ProfessionalRow } from '../admin-dashboard/derive';
import { formatPhoneNational } from '../../utils/format';
import { IconCalendar, IconMail, IconPhone, IconPlug } from './icons';
import { RowMenu, type MenuItem } from './RowMenu';

function formatSince(iso: string) {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }).replace('.', '');
}

function Avatar({ name, blocked }: { name: string; blocked: boolean }) {
  const tone = blocked
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
    <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200 px-2.5 py-1 text-xs font-semibold tracking-wide">
      <span className="w-1.5 h-1.5 rounded-full bg-rose-500" aria-hidden="true" />
      Bloqueada
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-sage-100 text-[#3F5F46] border border-sage-200 px-2.5 py-1 text-xs font-semibold tracking-wide">
      <span className="w-1.5 h-1.5 rounded-full bg-sage-500" aria-hidden="true" />
      Ativa
    </span>
  );
}

/** Cartão de uma conta de profissional (item da lista). */
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
      className={`relative min-w-0 rounded-3xl border p-5 shadow-[0_1px_2px_rgba(61,29,40,0.03),0_16px_40px_-24px_rgba(61,29,40,0.16)] transition-[border-color,box-shadow,transform] duration-300 hover:shadow-[0_1px_2px_rgba(61,29,40,0.04),0_22px_48px_-24px_rgba(61,29,40,0.22)] motion-safe:hover:-translate-y-0.5 sm:p-6 ${
        blocked ? 'border-rose-200/80 bg-rose-50/40' : 'border-wine-100/70 bg-white/85 hover:border-wine-200/80'
      }`}
    >
      <div className="flex items-start gap-4">
        <Avatar name={p.name} blocked={blocked} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="font-semibold text-ink leading-snug truncate" title={p.name}>{p.name}</h3>
              <p className="text-sm text-ink/65 truncate" title={p.business_name}>{p.business_name}</p>
            </div>
            <div className="shrink-0 -mr-1.5 -mt-1">
              <RowMenu label={`Ações para ${p.name}`} items={menuItems} onOpenTrigger={onOpenTrigger} />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
            <StatusChip blocked={blocked} />
          </div>
        </div>
      </div>

      <dl className="mt-5 pt-5 border-t border-wine-100/60 space-y-2.5 text-sm">
        <div className="flex items-center gap-3 min-w-0">
          <dt className="text-ink/60 shrink-0"><span className="sr-only">E-mail</span><IconMail /></dt>
          <dd className="text-ink/70 truncate min-w-0" title={p.email}>{p.email}</dd>
        </div>
        <div className="flex items-center gap-3 min-w-0">
          <dt className="text-ink/60 shrink-0"><span className="sr-only">WhatsApp</span><IconPhone /></dt>
          <dd className="text-ink/70 min-w-0 truncate">
            {p.phone_whatsapp ? formatPhoneNational(p.phone_whatsapp) : <span className="text-ink/60">Não informado</span>}
          </dd>
        </div>
        <div className="flex items-center gap-3 min-w-0">
          <dt className="text-ink/60 shrink-0"><span className="sr-only">Instância do WhatsApp</span><IconPlug /></dt>
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
          <dt className="text-ink/60 shrink-0"><span className="sr-only">Cadastro</span><IconCalendar /></dt>
          <dd className="text-ink/65 text-[13px]">Desde {formatSince(p.created_at)}</dd>
        </div>
      </dl>
    </li>
  );
}
