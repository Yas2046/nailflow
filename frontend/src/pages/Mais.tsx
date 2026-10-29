// "Mais": recursos secundários (Serviços, Configurações, Ajuda e suporte) e sair da conta.
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useSupport } from '../context/SupportContext';
import { UnreadBadge } from '../components/support/SupportUi';
import { usePageTitle } from '../hooks/usePageTitle';

function Ico({ children }: { children: ReactNode }) {
  return (
    <span className="w-10 h-10 shrink-0 rounded-xl bg-wine-50 text-wine-600 flex items-center justify-center">
      <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden="true">{children}</svg>
    </span>
  );
}

function Item({ to, icon, title, hint, badge }: { to: string; icon: ReactNode; title: string; hint: string; badge?: ReactNode }) {
  return (
    <Link to={to} className="flex items-center gap-4 px-4 py-3.5 min-h-[64px] hover:bg-wine-50/60 transition-colors">
      <Ico>{icon}</Ico>
      <span className="flex-1 min-w-0">
        <span className="block font-medium text-ink">{title}</span>
        <span className="block text-xs text-ink/50 truncate">{hint}</span>
      </span>
      {badge}
      <svg className="w-4 h-4 text-ink/30 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
    </Link>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title}>
      <h2 className="text-[11px] uppercase tracking-widest font-semibold text-ink/40 mb-2 px-1">{title}</h2>
      <div className="card divide-y divide-wine-50 overflow-hidden">{children}</div>
    </section>
  );
}

export default function Mais() {
  usePageTitle('Mais');
  const { professional, logout } = useAuth();
  const { enabled, unreadTickets } = useSupport();
  return (
    <div className="space-y-6 pb-10 max-w-2xl">
      <div>
        <h1 className="font-display text-3xl sm:text-4xl text-wine-800 leading-tight">Mais</h1>
        <p className="text-sm text-ink/45 mt-1.5">{professional?.businessName}</p>
      </div>

      <Group title="Seu negócio">
        <Item to="/comecar" title="Primeiros passos" hint="Configuração guiada: negócio, serviços, horários e link"
          icon={<path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />} />
        <Item to="/clientes" title="Clientes" hint="Lista, fichas e importação de clientes"
          icon={<><circle cx="9" cy="8" r="3.5" /><path strokeLinecap="round" d="M2.5 20v-1a5.5 5.5 0 0 1 5.5-5.5h2a5.5 5.5 0 0 1 5.5 5.5v1M16 4.6a3.5 3.5 0 0 1 0 6.8M21.5 20v-1a5.5 5.5 0 0 0-4-5.3" /></>} />
        <Item to="/servicos" title="Serviços" hint="Preços, duração e disponibilidade no WhatsApp"
          icon={<><circle cx="6" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path strokeLinecap="round" d="M20 4 8.12 15.88M14.47 14.48 20 20M8.12 8.12 12 12" /></>} />
        <Item to="/configuracoes?tab=perfil" title="Perfil e link de agendamento" hint="Dados do negócio e página pública"
          icon={<><circle cx="12" cy="8" r="4" /><path strokeLinecap="round" d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1" /></>} />
        <Item to="/configuracoes?tab=disponibilidade" title="Horários de atendimento" hint="Dias, expediente e intervalos"
          icon={<><circle cx="12" cy="12" r="9" /><path strokeLinecap="round" d="M12 7v5l3 2" /></>} />
        <Item to="/configuracoes?tab=agendamento" title="Regras de agendamento" hint="Confirmação, antecedência e sinal"
          icon={<><rect x="3" y="4" width="18" height="18" rx="2" /><path strokeLinecap="round" d="M16 2v4M8 2v4M3 10h18" /></>} />
        <Item to="/retorno" title="Clientes para chamar" hint="Quem está na hora da manutenção ou há tempo sem agendar"
          icon={<path strokeLinecap="round" strokeLinejoin="round" d="M4 12a8 8 0 0 1 14-5.3M20 12a8 8 0 0 1-14 5.3M18 3v4h-4M6 21v-4h4" />} />
        <Item to="/mensagens" title="Modelos de mensagem" hint="Confirmação, lembrete e convite para voltar (copiar e enviar)"
          icon={<path strokeLinecap="round" strokeLinejoin="round" d="M4 5h16v11H8l-4 4V5z" />} />
        <Item to="/configuracoes?tab=whatsapp" title="WhatsApp" hint="Conexão e mensagens automáticas"
          icon={<path strokeLinecap="round" strokeLinejoin="round" d="M21 12a8 8 0 0 1-11.9 7L3 21l2-5.9A8 8 0 1 1 21 12z" />} />
        <Item to="/configuracoes?tab=aparencia" title="Aparência" hint="Tema de cores do sistema"
          icon={<><circle cx="12" cy="12" r="9" /><path d="M12 3a9 9 0 0 0 0 18z" fill="currentColor" /></>} />
        <Item to="/configuracoes?tab=seguranca" title="Segurança e dados" hint="Senha, sessões, exportar seus dados e privacidade"
          icon={<path strokeLinecap="round" strokeLinejoin="round" d="M12 3l8 3v6c0 4.5-3.2 8.2-8 9-4.8-.8-8-4.5-8-9V6l8-3z" />} />
      </Group>

      <Group title="Ajuda">
        <Item to={enabled ? '/suporte' : '/ajuda'} title={enabled ? 'Ajuda e suporte' : 'Guia rápido'} hint={enabled ? 'Fale com a equipe e veja respostas' : 'Passo a passo para começar'}
          badge={enabled ? <UnreadBadge count={unreadTickets} /> : undefined}
          icon={<><circle cx="12" cy="12" r="9" /><path strokeLinecap="round" d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7M12 17h.01" /></>} />
        {enabled && (
          <Item to="/ajuda" title="Guia rápido" hint="Passo a passo para começar"
            icon={<path strokeLinecap="round" strokeLinejoin="round" d="M4 5a2 2 0 0 1 2-2h12v18H6a2 2 0 0 1-2-2zM8 7h6M8 11h6" />} />
        )}
      </Group>

      <button onClick={logout} className="w-full min-h-[48px] rounded-2xl border border-wine-200 bg-white text-wine-700 font-medium hover:bg-wine-50 transition-colors">
        Sair da conta
      </button>
    </div>
  );
}
