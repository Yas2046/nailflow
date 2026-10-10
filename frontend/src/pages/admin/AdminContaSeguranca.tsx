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

function Fact({ ok, label, value }: { ok: boolean; label: string; value: string }) {
  return (
    <div className="min-w-0 px-5 py-4 sm:px-6">
      <dt className="font-mono text-[11px] uppercase tracking-[0.16em] text-[#A0958E]">{label}</dt>
      <dd className="mt-1.5 flex items-center gap-2 text-[15px] font-medium text-white">
        <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${ok ? 'bg-signal' : 'bg-[#7C716B]'}`} />
        {value}
      </dd>
    </div>
  );
}

function SecurityHero() {
  return (
    <Panel tone="night" className={`relative overflow-hidden !p-0 ${ENTER}`}>
      <div aria-hidden="true" className="absolute inset-x-0 top-0 h-px bg-gold-500/70" />
      <div className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:gap-7 sm:p-8">
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-night-800 text-wine-300 [&_svg]:h-7 [&_svg]:w-7"><IconShield /></span>
        <div className="min-w-0 flex-1">
          <Eyebrow tone="night">segurança da conta</Eyebrow>
          <h2 id="seg-hero" className="mt-2 font-display text-[1.625rem] font-semibold leading-tight text-white sm:text-3xl">
            Seu acesso está protegido por senha
          </h2>
          <p className="mt-2 max-w-xl text-[15px] leading-relaxed text-[#BDB3AC]">
            Troque sua senha, encerre sessões em outros dispositivos e veja o que protege sua conta.
          </p>
        </div>
      </div>
      <dl className="grid border-t border-white/10 sm:grid-cols-3 [&>*]:border-white/10 sm:[&>*:not(:last-child)]:border-r [&>*:not(:last-child)]:border-b sm:[&>*:not(:last-child)]:border-b-0">
        <Fact ok label="Senha" value="Definida" />
        <Fact ok label="Sessão" value="Dura até 7 dias" />
        <Fact ok={false} label="Duas etapas" value="Indisponível" />
      </dl>
    </Panel>
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
      <h3 className="mt-2 font-display text-xl font-semibold leading-tight text-wine-800">Autenticação em duas etapas</h3>
      <p className="mt-3 text-[15px] leading-relaxed text-ink/70">Este recurso ainda não está disponível no NailFlow.</p>
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
      <h3 className="mt-2 font-display text-xl font-semibold leading-tight text-wine-800">Sessão atual</h3>

      <div className="mt-5 flex items-center gap-4 rounded-xl border border-sage-200 bg-sage-100/50 px-4 py-4">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-white text-wine-600 ring-1 ring-sage-200"><IconDevice mobile={device.mobile} /></span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-medium text-ink/90">{device.label}</p>
          <p className="mt-0.5 flex items-center gap-2 text-sm text-sage-700"><StatusDot tone="sage" live />Este dispositivo</p>
        </div>
      </div>

      <p className="mt-4 flex items-center gap-2.5 text-[15px] text-ink/70">
        <span className="text-wine-400"><IconClock className="h-4 w-4" /></span>
        As sessões duram até 7 dias.
      </p>

      <div className="mt-6 flex flex-col gap-4 border-t border-wine-100 pt-6 sm:flex-row sm:items-center sm:gap-6">
        <button
          type="button"
          onClick={logout}
          className="btn-secondary min-h-[44px] w-full gap-2.5 px-5 sm:w-auto"
        >
          <IconLogout />
          Sair desta sessão
        </button>
        <p className="text-[15px] text-ink/65">Encerra o acesso neste navegador.</p>
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
      <h3 className="mt-2 font-display text-xl font-semibold leading-tight text-wine-800">O que já protege sua conta</h3>
      <ul className="mt-6 grid gap-x-10 gap-y-6 sm:grid-cols-2">
        {PROTECOES.map((p) => (
          <li key={p.titulo} className="flex gap-4">
            <span aria-hidden="true" className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-sage-100 text-sage-700"><IconTick className="h-3.5 w-3.5" /></span>
            <div className="min-w-0">
              <p className="text-[15px] font-semibold text-ink/90">{p.titulo}</p>
              <p className="mt-1 text-sm leading-relaxed text-ink/70">{p.texto}</p>
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
    <section className={`flex flex-col gap-4 rounded-2xl border border-dashed border-wine-200 bg-white px-6 py-6 sm:flex-row sm:items-center sm:justify-between sm:px-8 ${ENTER} [animation-delay:330ms]`}>
      <div>
        <h3 className="font-display text-xl font-semibold leading-tight text-wine-800">Atividade</h3>
        <p className="mt-1 text-[15px] text-ink/70">Consulte as ações administrativas que você realizou.</p>
      </div>
      <Link to="/admin/conta/atividade" className="btn-secondary min-h-[44px] shrink-0 px-5">
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
      <div className="space-y-6">
        <SecurityHero />
        <div className="grid gap-6 md:grid-cols-2">
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
