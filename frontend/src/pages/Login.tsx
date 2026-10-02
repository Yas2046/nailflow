import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import LogoMark from '../components/LogoMark';

export default function Login() {
  const { professional, login, loading } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]       = useState<string | null>(null);

  if (professional) return <Navigate to="/" replace />;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await login(email, password);
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'E-mail ou senha incorretos.');
    }
  }

  return (
    <div className="min-h-screen flex">

      {/* ── painel de marca (desktop) ─────────────────────────────────────── */}
      <div className="hidden lg:flex lg:w-[42%] bg-wine-700 flex-col items-center justify-center p-12 relative overflow-hidden select-none">
        {/* anéis decorativos concêntricos */}
        <div className="absolute w-[30rem] h-[30rem] rounded-full border border-white/[0.04]" />
        <div className="absolute w-80 h-80 rounded-full border border-white/[0.07]" />
        <div className="absolute w-52 h-52 rounded-full border border-white/[0.10]" />

        <div className="relative z-10 flex flex-col items-center text-center gap-5">
          <div className="text-cream/90">
            <LogoMark className="w-14 h-14" />
          </div>
          <div>
            <p className="font-display text-4xl text-cream tracking-tight mb-3">NailFlow</p>
            <p className="text-wine-100/55 text-sm max-w-[200px] leading-relaxed">
              Agenda profissional para quem transforma unhas em arte.
            </p>
          </div>
        </div>
      </div>

      {/* ── painel de formulário ─────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col items-center justify-center bg-cream px-6 py-12 min-h-screen lg:min-h-0">

        {/* logo compacto — somente mobile */}
        <div className="lg:hidden flex items-center gap-2.5 text-wine-700 mb-10">
          <LogoMark className="w-5 h-5" />
          <span className="font-display text-2xl tracking-tight">NailFlow</span>
        </div>

        <div className="w-full max-w-sm">

          {/* cabeçalho */}
          <div className="mb-8">
            <h1 className="font-display text-2xl text-wine-700 leading-tight mb-1">
              Bem-vinda de volta
            </h1>
            <p className="text-sm text-ink/50">Entre com seus dados para acessar o painel.</p>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">

            <div>
              <label className="block text-sm font-medium text-ink/70 mb-1.5" htmlFor="email">
                E-mail
              </label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="input"
                placeholder="voce@exemplo.com"
                autoComplete="email"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-ink/70 mb-1.5" htmlFor="password">
                Senha
              </label>
              <input
                id="password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input"
                placeholder="••••••••"
                autoComplete="current-password"
              />
            </div>

            {error && (
              <div className="rounded-xl bg-rose-50 border border-rose-200 px-4 py-3 text-sm text-rose-700">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="mt-1 w-full bg-wine-600 hover:bg-wine-700 text-white rounded-lg py-2.5 text-sm font-semibold transition-colors disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-wine-500/40"
            >
              {loading ? 'Entrando…' : 'Entrar'}
            </button>

          </form>

          <p className="mt-6 text-center text-sm text-ink/50">
            Ainda não tem uma conta?{' '}
            <Link to="/register" className="text-wine-600 hover:text-wine-700 font-medium">
              Criar conta
            </Link>
          </p>

          <p className="mt-6 text-center text-xs text-ink/30">
            NailFlow · Agenda para profissionais de beleza
          </p>

        </div>
      </div>

    </div>
  );
}
