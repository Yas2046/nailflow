import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Login() {
  const { professional, login, loading } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (professional) return <Navigate to="/" replace />;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await login(email, password);
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao entrar.');
    }
  }

  return (
    <div className="min-h-screen bg-wine-700 flex items-center justify-center px-4">
      <div className="bg-cream rounded-2xl shadow-xl w-full max-w-sm p-8">
        <div className="mb-8 text-center">
          <div className="font-display text-3xl text-wine-700 mb-1">NailFlow</div>
          <p className="text-sm text-ink/60">Agenda para profissionais de manicure</p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label className="block text-sm mb-1 text-ink/80" htmlFor="email">
              E-mail
            </label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-wine-100 px-3 py-2 focus-ring bg-white"
              placeholder="voce@exemplo.com"
            />
          </div>
          <div>
            <label className="block text-sm mb-1 text-ink/80" htmlFor="password">
              Senha
            </label>
            <input
              id="password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-wine-100 px-3 py-2 focus-ring bg-white"
              placeholder="••••••••"
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="mt-2 bg-wine-600 hover:bg-wine-700 text-white rounded-lg py-2.5 font-medium transition-colors focus-ring disabled:opacity-60"
          >
            {loading ? 'Entrando...' : 'Entrar'}
          </button>
        </form>
      </div>
    </div>
  );
}
