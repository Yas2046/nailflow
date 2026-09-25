import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';

interface OnboardingStatus {
  perfil: boolean;
  servicos: boolean;
  horarios: boolean;
  whatsapp: boolean;
  clientes: boolean;
  concluidos: number;
  total: number;
}

interface Step {
  key: keyof Omit<OnboardingStatus, 'concluidos' | 'total'>;
  label: string;
  hint: string;
  to: string;
}

const REQUIRED_STEPS: Step[] = [
  { key: 'perfil',   label: 'Perfil',   hint: 'Informe seu telefone de contato',           to: '/configuracoes?tab=perfil' },
  { key: 'servicos', label: 'Serviços', hint: 'Cadastre os serviços que você oferece',     to: '/servicos' },
  { key: 'horarios', label: 'Horários', hint: 'Defina seus dias e horários de atendimento', to: '/configuracoes?tab=disponibilidade' },
  { key: 'whatsapp', label: 'WhatsApp', hint: 'Conecte seu WhatsApp ao NailFlow',          to: '/configuracoes?tab=whatsapp' },
];

const OPTIONAL_STEP: Step = { key: 'clientes', label: 'Clientes', hint: 'Cadastre suas clientes', to: '/clientes' };

function hiddenKey(professionalId: string) {
  return `nailflow_onboarding_hidden_${professionalId}`;
}

function readHidden(professionalId: string) {
  try { return localStorage.getItem(hiddenKey(professionalId)) === '1'; } catch { return false; }
}

function IconCheck() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={3} viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  );
}

function StepRow({ step, done, highlight }: { step: Step; done: boolean; highlight: boolean }) {
  const content = (
    <>
      <span
        className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${
          done ? 'bg-sage-500 text-white' : highlight ? 'border-2 border-gold-500' : 'border-2 border-wine-200'
        }`}
      >
        {done && <IconCheck />}
      </span>
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-medium leading-tight ${done ? 'text-ink/40 line-through decoration-ink/20' : 'text-ink/80'}`}>
          {step.label}
        </p>
        {!done && <p className="text-xs text-ink/45 mt-0.5 truncate">{step.hint}</p>}
      </div>
      {!done && (
        <span className={`shrink-0 text-xs font-semibold ${highlight ? 'text-wine-700' : 'text-ink/35'}`}>
          {highlight ? 'Configurar →' : '→'}
        </span>
      )}
    </>
  );

  if (done) return <li className="flex items-center gap-3 px-3 py-2.5">{content}</li>;

  return (
    <li>
      <Link
        to={step.to}
        className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors ${
          highlight ? 'bg-wine-50/70 hover:bg-wine-50' : 'hover:bg-wine-50/50'
        }`}
      >
        {content}
      </Link>
    </li>
  );
}

export default function OnboardingChecklist() {
  const { professional } = useAuth();
  const [status, setStatus] = useState<OnboardingStatus | null>(null);
  const [hidden, setHidden] = useState(() => (professional ? readHidden(professional.id) : true));

  useEffect(() => {
    if (!professional || professional.isAdmin || hidden) return;
    api.get<OnboardingStatus>('/onboarding/status').then(setStatus).catch(() => {});
  }, [professional, hidden]);

  if (!professional || professional.isAdmin || hidden || !status) return null;
  if (status.concluidos >= status.total) return null;

  function hide() {
    try { localStorage.setItem(hiddenKey(professional!.id), '1'); } catch { /* sem storage: oculta só nesta sessão */ }
    setHidden(true);
  }

  const pct = Math.round((status.concluidos / status.total) * 100);
  const nextKey = REQUIRED_STEPS.find((s) => !status[s.key])?.key;

  return (
    <section className="bg-white rounded-2xl border border-wine-100/80 shadow-sm overflow-hidden">
      <div className="px-5 pt-5 pb-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-lg sm:text-xl text-wine-700 leading-tight">Primeiros passos</h2>
            <p className="text-xs text-ink/45 mt-1">Configure o essencial para começar a receber agendamentos.</p>
          </div>
          <button onClick={hide} className="shrink-0 text-xs text-ink/35 hover:text-wine-700 transition-colors">
            Ocultar por enquanto
          </button>
        </div>

        <div className="mt-4 flex items-center gap-3">
          <div
            className="flex-1 h-1.5 rounded-full bg-wine-50 overflow-hidden"
            role="progressbar"
            aria-valuenow={status.concluidos}
            aria-valuemin={0}
            aria-valuemax={status.total}
          >
            <div className="h-full rounded-full bg-wine-600 transition-all" style={{ width: `${pct}%` }} />
          </div>
          <span className="text-xs font-semibold text-wine-700 tabular-nums shrink-0">
            {status.concluidos} de {status.total}
          </span>
        </div>
      </div>

      <ul className="px-2 pb-2 space-y-0.5">
        {REQUIRED_STEPS.map((s) => (
          <StepRow key={s.key} step={s} done={status[s.key]} highlight={s.key === nextKey} />
        ))}
      </ul>

      <div className="border-t border-wine-50 px-2 pt-2 pb-2">
        <p className="px-3 pt-1 pb-1 text-[10px] text-ink/35 uppercase tracking-widest font-medium">Opcional</p>
        <ul>
          <StepRow step={OPTIONAL_STEP} done={status.clientes} highlight={false} />
        </ul>
      </div>
    </section>
  );
}
