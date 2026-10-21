// Nova senha a partir de um link de uso único emitido pela administração (/redefinir-senha?token=...).
import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import LogoMark from '../components/LogoMark';
import { usePageTitle } from '../hooks/usePageTitle';
import { api } from '../services/api';

export default function RedefinirSenha() {
  usePageTitle('Nova senha');
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) { setError('A nova senha deve ter ao menos 8 caracteres.'); return; }
    if (password !== confirm) { setError('A confirmação não confere com a nova senha.'); return; }
    setSaving(true);
    try {
      await api.post('/auth/reset-password', { token, newPassword: password, confirmPassword: confirm });
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível redefinir a senha.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="min-h-screen bg-cream flex flex-col items-center justify-center px-6 py-12">
      <div className="flex items-center gap-2.5 text-wine-700 mb-8">
        <LogoMark className="w-5 h-5" />
        <span className="font-display text-2xl tracking-tight">NailFlow</span>
      </div>
      <div className="card w-full max-w-sm p-6">
        <h1 className="font-display text-2xl text-wine-700 leading-tight mb-1">Criar nova senha</h1>
        {done ? (
          <div className="space-y-4">
            <p className="text-sm text-ink/70">Senha alterada. Por segurança, as sessões abertas foram encerradas. Entre com a nova senha.</p>
            <Link to="/login" className="btn-primary w-full">Ir para o login</Link>
          </div>
        ) : !token ? (
          <div className="space-y-4">
            <p role="alert" className="text-sm text-rose-700">Link incompleto. Peça um novo link à administração do NailFlow.</p>
            <Link to="/login" className="btn-secondary w-full">Voltar ao login</Link>
          </div>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-4 mt-4">
            <p className="text-sm text-ink/60 -mt-2">Escolha uma senha com pelo menos 8 caracteres.</p>
            <div>
              <label htmlFor="nova" className="block text-sm font-medium text-ink/70 mb-1.5">Nova senha</label>
              <input id="nova" type="password" className="input" autoComplete="new-password" required minLength={8} maxLength={72} value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <div>
              <label htmlFor="conf" className="block text-sm font-medium text-ink/70 mb-1.5">Repita a nova senha</label>
              <input id="conf" type="password" className="input" autoComplete="new-password" required minLength={8} maxLength={72} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </div>
            {error && <div role="alert" className="rounded-xl bg-rose-50 border border-rose-200 px-4 py-3 text-sm text-rose-700">{error}</div>}
            <button type="submit" disabled={saving} className="btn-primary w-full">{saving ? 'Salvando…' : 'Salvar nova senha'}</button>
          </form>
        )}
      </div>
    </main>
  );
}
