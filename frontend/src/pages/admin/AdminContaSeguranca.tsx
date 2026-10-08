import { Link } from 'react-router-dom';
import AccountShell from '../../components/admin-account/AccountShell';
import { Eyebrow, Panel, StatusDot } from '../../components/admin-account/AccountUi';
import { ENTER, IconDevice, IconShield, Pill, describeThisDevice } from '../../components/admin-account/AccountBlocks';
import { IconClock, IconLogout, IconTick } from '../../components/AdminIcons';
import { useAuth } from '../../context/AuthContext';
import { usePageTitle } from '../../hooks/usePageTitle';
import { LogoutAllBlock, PasswordCard } from '../../components/admin-account/SecurityActions';

// Só o que existe hoje: trocar a senha e sair de todos os dispositivos são funcionais. 2FA, recuperação
// de senha e lista de sessões dependem de backend e NÃO aparecem como ações. Sem porcentagens, data de
// troca de senha ou dispositivos além deste navegador.

// ── hero ────────────────────────────────────────────────────────────────────

function SecurityHero() {
  return (
    <section
      aria-labelledby="seg-hero"
      className={`relative overflow-hidden rounded-[2rem] border border-wine-100/80 bg-gradient-to-br from-white via-white to-wine-50/70 shadow-[inset_0_1px_0_rgba(255,255,255,0.95),0_1px_2px_rgba(61,29,40,0.05),0_30px_70px_-38px_rgba(61,29,40,0.3)] ${ENTER}`}
    >
      <div aria-hidden="true" className="pointer-events-none absolute -left-24 -top-24 h-[26rem] w-[26rem] rounded-full bg-[radial-gradient(closest-side,rgba(140,74,94,0.13),rgba(199,154,69,0.06)_60%,transparent)]" />
      <div aria-hidden="true" className="pointer-events-none absolute -bottom-32 -right-24 h-[22rem] w-[22rem] rounded-full bg-[radial-gradient(closest-side,rgba(199,154,69,0.14),transparent)]" />
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-gold-400/55 to-transparent" />

      <div className="relative flex flex-col items-center gap-8 px-6 py-12 text-center sm:flex-row sm:gap-12 sm:px-12 sm:py-14 sm:text-left">
        <div className="relative h-28 w-28 shrink-0 sm:h-32 sm:w-32">
          <span aria-hidden="true" className="absolute -inset-10 rounded-full bg-[radial-gradient(closest-side,rgba(140,74,94,0.22),rgba(199,154,69,0.1)_60%,transparent)] blur-xl" />
          <span aria-hidden="true" className="absolute -inset-3 rounded-full border border-gold-400/40" />
          <span aria-hidden="true" className="absolute -inset-6 rounded-full border border-wine-300/25" />
          <span className="relative flex h-full w-full items-center justify-center rounded-full bg-gradient-to-br from-wine-100 via-white to-gold-300/50 text-wine-600 ring-4 ring-white shadow-[0_22px_44px_-18px_rgba(61,29,40,0.45)]">
            <span className="[&_svg]:h-11 [&_svg]:w-11 [&_svg]:stroke-[1.4]"><IconShield /></span>
          </span>
        </div>

        <div className="min-w-0 flex-1">
          <Eyebrow tone="gold">Segurança da conta</Eyebrow>
          <h2 id="seg-hero" className="mt-3 font-display text-3xl font-semibold leading-tight tracking-tight text-wine-800 sm:text-4xl">
            Seu acesso está protegido por senha
          </h2>
          <p className="mt-3 max-w-xl text-base leading-relaxed text-ink/65">
            Troque sua senha, encerre sessões em outros dispositivos e veja o que protege sua conta.
          </p>
        </div>
      </div>
    </section>
  );
}

// ── senha e duas etapas ─────────────────────────────────────────────────────

function TwoStepCard() {
  return (
    <Panel className={`flex flex-col ${ENTER} [animation-delay:150ms]`}>
      <div className="flex items-center justify-between gap-4">
        <Eyebrow>Verificação</Eyebrow>
        <Pill ok={false}>Não disponível</Pill>
      </div>
      <h3 className="mt-3 font-display text-3xl leading-tight text-wine-800">Autenticação em duas etapas</h3>
      <p className="mt-4 text-base leading-relaxed text-ink/65">Este recurso ainda não está disponível no NailFlow.</p>
    </Panel>
  );
}

// ── sessão atual ────────────────────────────────────────────────────────────

function SessionCard() {
  const { logout } = useAuth();
  const device = describeThisDevice();
  return (
    <Panel className={`${ENTER} [animation-delay:210ms]`}>
      <Eyebrow>Sessão</Eyebrow>
      <h3 className="mt-3 font-display text-3xl leading-tight text-wine-800">Sessão atual</h3>

      <div className="mt-8 flex items-center gap-4 rounded-2xl border border-sage-200/80 bg-gradient-to-br from-sage-100/70 to-white px-5 py-5">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white text-wine-600 shadow-sm"><IconDevice mobile={device.mobile} /></span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-lg font-medium text-ink/85">{device.label}</p>
          <p className="mt-0.5 flex items-center gap-2 text-sm text-[#3F5F46]"><StatusDot tone="sage" />Este dispositivo</p>
        </div>
      </div>

      <p className="mt-5 flex items-center gap-2.5 text-[15px] text-ink/65">
        <span className="text-wine-400"><IconClock className="h-4 w-4" /></span>
        As sessões duram até 7 dias.
      </p>

      <div className="mt-8 flex flex-col gap-4 border-t border-wine-100/70 pt-7 sm:flex-row sm:items-center sm:gap-6">
        <button
          type="button"
          onClick={logout}
          className="btn-secondary min-h-[46px] w-full gap-2.5 px-6 focus-visible:ring-2 focus-visible:ring-wine-500/40 sm:w-auto"
        >
          <IconLogout />
          Sair desta sessão
        </button>
        <p className="text-[15px] text-ink/60">Encerra o acesso neste navegador.</p>
      </div>

      <LogoutAllBlock />
    </Panel>
  );
}

// ── proteções que já existem ────────────────────────────────────────────────

const PROTECOES: Array<{ titulo: string; texto: string }> = [
  { titulo: 'Cookie de sessão protegido', texto: 'Sua sessão fica em um cookie que scripts não conseguem ler e que só trafega por conexão segura.' },
  { titulo: 'Limite de tentativas de login', texto: 'Tentativas repetidas de login a partir do mesmo endereço são bloqueadas por um tempo.' },
  { titulo: 'Controle de acesso administrativo', texto: 'A cada ação, o servidor confere se a sua conta continua ativa e administradora.' },
  { titulo: 'Dados separados por conta', texto: 'O acesso de cada profissional aos dados é limitado à própria conta, e contas bloqueadas perdem o acesso na hora.' },
  { titulo: 'Registro de ações administrativas', texto: 'Bloqueios, desbloqueios, edições e exclusões de contas ficam registrados no histórico.' },
];

function ProtectionsPanel() {
  return (
    <Panel className={`${ENTER} [animation-delay:270ms]`}>
      <Eyebrow>Em funcionamento</Eyebrow>
      <h3 className="mt-3 font-display text-3xl leading-tight text-wine-800">O que já protege sua conta</h3>
      <ul className="mt-8 grid gap-x-12 gap-y-7 sm:grid-cols-2">
        {PROTECOES.map((p) => (
          <li key={p.titulo} className="flex gap-4">
            <span aria-hidden="true" className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-sage-100 text-[#3F5F46]"><IconTick className="h-3.5 w-3.5" /></span>
            <div className="min-w-0">
              <p className="text-base font-medium text-ink/85">{p.titulo}</p>
              <p className="mt-1 text-[15px] leading-relaxed text-ink/65">{p.texto}</p>
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

// ── atividade ───────────────────────────────────────────────────────────────

function ActivityLink() {
  return (
    <section className={`flex flex-col gap-5 rounded-3xl border border-wine-100/70 bg-white/60 px-6 py-7 sm:flex-row sm:items-center sm:justify-between sm:px-8 ${ENTER} [animation-delay:330ms]`}>
      <div>
        <h3 className="font-display text-2xl leading-tight text-wine-800">Atividade</h3>
        <p className="mt-1.5 text-base text-ink/65">Consulte as ações administrativas que você realizou.</p>
      </div>
      <Link to="/admin/conta/atividade" className="btn-secondary min-h-[46px] shrink-0 px-6 focus-visible:ring-2 focus-visible:ring-wine-500/40">
        Ver atividade
      </Link>
    </section>
  );
}

// ── página ──────────────────────────────────────────────────────────────────

export default function AdminContaSeguranca() {
  usePageTitle('Segurança · Central da conta');
  return (
    <AccountShell title="Segurança" subtitle="Veja como o acesso à sua conta é protegido hoje.">
      <div className="space-y-8 sm:space-y-10">
        <SecurityHero />
        <div className="grid gap-6 sm:gap-8 md:grid-cols-2">
          <PasswordCard />
          <TwoStepCard />
        </div>
        <SessionCard />
        <ProtectionsPanel />
        <ActivityLink />
      </div>
    </AccountShell>
  );
}
