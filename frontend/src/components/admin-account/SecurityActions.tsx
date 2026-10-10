import { useId, useState, type FormEvent } from 'react';
import { api, ApiError } from '../../services/api';
import { Eyebrow, Panel } from './AccountUi';
import { ENTER, Pill } from './AccountBlocks';
import { IconLogout } from '../AdminIcons';

type Status = { kind: 'idle' } | { kind: 'loading' } | { kind: 'success'; message: string } | { kind: 'error'; message: string };

const alertBox = 'rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700';
const okBox = 'rounded-lg border border-sage-200 bg-sage-100/70 p-3 text-sm text-sage-700';
const fieldLabel = 'mb-1.5 block font-mono text-[11px] uppercase tracking-[0.14em] text-ink/65';

function errorMessage(err: unknown, fallback: string) {
  return err instanceof ApiError || err instanceof Error ? err.message : fallback;
}

/** Valida no navegador as mesmas regras do servidor (o servidor continua sendo a fonte de verdade). */
function validatePassword(current: string, next: string, confirm: string): string | null {
  if (!current) return 'Informe a senha atual.';
  if (next.length < 8) return 'A nova senha deve ter ao menos 8 caracteres.';
  if (next.length > 72) return 'A nova senha deve ter no máximo 72 caracteres.';
  if (next === current) return 'A nova senha deve ser diferente da atual.';
  if (next !== confirm) return 'A confirmação não confere com a nova senha.';
  return null;
}

// ── alterar senha ───────────────────────────────────────────────────────────

export function PasswordCard() {
  const uid = useId();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const loading = status.kind === 'loading';

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (loading) return;
    const problem = validatePassword(current, next, confirm);
    if (problem) return setStatus({ kind: 'error', message: problem });
    setStatus({ kind: 'loading' });
    try {
      await api.put('/auth/password', { currentPassword: current, newPassword: next, confirmPassword: confirm });
      setCurrent(''); setNext(''); setConfirm('');
      setStatus({ kind: 'success', message: 'Senha alterada. Os outros dispositivos foram desconectados; este continua ativo.' });
    } catch (err) {
      setStatus({ kind: 'error', message: errorMessage(err, 'Não foi possível alterar a senha. Tente novamente.') });
    }
  }

  const field = (id: string, label: string, value: string, set: (v: string) => void, autoComplete: string, hint?: string) => (
    <div>
      <label htmlFor={`${uid}-${id}`} className={fieldLabel}>{label}</label>
      <input
        id={`${uid}-${id}`}
        type="password"
        className="input"
        value={value}
        autoComplete={autoComplete}
        disabled={loading}
        onChange={(e) => { set(e.target.value); if (status.kind !== 'idle' && status.kind !== 'loading') setStatus({ kind: 'idle' }); }}
      />
      {hint && <p className="mt-1 text-xs text-ink/60">{hint}</p>}
    </div>
  );

  return (
    <Panel className={`flex flex-col ${ENTER} [animation-delay:90ms]`}>
      <div className="flex items-center justify-between gap-4">
        <Eyebrow>Acesso</Eyebrow>
        <Pill ok>Definida</Pill>
      </div>
      <h3 className="mt-2 font-display text-xl font-semibold leading-tight text-wine-800">Alterar senha</h3>
      <p className="mt-3 text-[15px] leading-relaxed text-ink/70">
        Ao trocar a senha, os outros dispositivos conectados são desconectados. Este continua ativo.
      </p>

      <form onSubmit={submit} noValidate className="mt-6 flex flex-col gap-4">
        {field('atual', 'Senha atual', current, setCurrent, 'current-password')}
        {field('nova', 'Nova senha', next, setNext, 'new-password', 'Mínimo de 8 caracteres.')}
        {field('confirmacao', 'Confirmar nova senha', confirm, setConfirm, 'new-password')}

        <div aria-live="polite">
          {status.kind === 'error' && <div role="alert" className={alertBox}>{status.message}</div>}
          {status.kind === 'success' && <div role="status" className={okBox}>{status.message}</div>}
        </div>

        <button type="submit" disabled={loading} className="btn-primary min-h-[44px] w-full px-6 disabled:opacity-60 sm:w-auto sm:self-start">
          {loading ? 'Salvando…' : 'Alterar senha'}
        </button>
      </form>
    </Panel>
  );
}

// ── sair de todos os dispositivos ───────────────────────────────────────────

export function LogoutAllBlock() {
  const [confirming, setConfirming] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const loading = status.kind === 'loading';

  async function run() {
    if (loading) return;
    setStatus({ kind: 'loading' });
    try {
      await api.post('/auth/logout-all');
      setConfirming(false);
      setStatus({ kind: 'success', message: 'Pronto. Todos os outros dispositivos foram desconectados; este continua ativo.' });
    } catch (err) {
      setStatus({ kind: 'error', message: errorMessage(err, 'Não foi possível encerrar as sessões. Tente novamente.') });
    }
  }

  return (
    <div className="mt-6 border-t border-wine-100 pt-6">
      <h4 className="text-[15px] font-semibold text-ink/90">Sair de todos os dispositivos</h4>
      <p className="mt-1 text-[15px] text-ink/70">
        Desconecta sua conta em todos os outros navegadores e aparelhos. Esta sessão continua ativa.
      </p>

      {confirming ? (
        <div role="group" aria-label="Confirmar saída de todos os dispositivos" className="mt-4 rounded-xl border border-gold-400/50 bg-gold-300/25 p-4">
          <p className="text-sm text-gold-700">
            Quem estiver usando sua conta em outro dispositivo precisará entrar de novo. Deseja continuar?
          </p>
          <div className="mt-3 flex flex-col gap-3 sm:flex-row">
            <button type="button" onClick={run} disabled={loading} className="btn-primary min-h-[44px] px-6 disabled:opacity-60">
              {loading ? 'Encerrando…' : 'Sim, sair de todos'}
            </button>
            <button type="button" onClick={() => setConfirming(false)} disabled={loading} className="btn-secondary min-h-[44px] px-6 disabled:opacity-60">
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => { setStatus({ kind: 'idle' }); setConfirming(true); }}
          className="btn-secondary mt-4 min-h-[44px] w-full gap-2.5 px-5 sm:w-auto"
        >
          <IconLogout />
          Sair de todos os dispositivos
        </button>
      )}

      <div aria-live="polite" className="mt-3">
        {status.kind === 'error' && <div role="alert" className={alertBox}>{status.message}</div>}
        {status.kind === 'success' && <div role="status" className={okBox}>{status.message}</div>}
      </div>
    </div>
  );
}
