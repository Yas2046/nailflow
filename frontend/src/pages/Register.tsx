import { useState, type FormEvent, useEffect } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import LogoMark from '../components/LogoMark';

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 50);
}

export default function Register() {
  const { professional, register, loading } = useAuth();
  const navigate = useNavigate();

  const [businessName, setBusinessName] = useState('');
  const [email, setEmail]               = useState('');
  const [password, setPassword]         = useState('');
  const [slug, setSlug]                 = useState('');
  const [slugEdited, setSlugEdited]     = useState(false);
  const [error, setError]               = useState<string | null>(null);
  const [success, setSuccess]           = useState(false);

  if (professional) return <Navigate to="/" replace />;

  // Sugerir slug automaticamente enquanto o usuário edita o nome
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    if (!slugEdited) {
      setSlug(slugify(businessName));
    }
  }, [businessName, slugEdited]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await register({ email, password, businessName, slug });
      setSuccess(true);
      setTimeout(() => navigate('/login'), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao realizar cadastro.');
    }
  }

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-cream px-6">
        <div className="text-center">
          <div className="w-14 h-14 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-4">
            <svg className="w-7 h-7 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <p className="font-display text-xl text-wine-700 mb-2">Cadastro realizado!</p>
          <p className="text-sm text-ink/50">Redirecionando para o login…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex">

      {/* painel de marca (desktop) */}
      <div className="hidden lg:flex lg:w-[42%] bg-wine-700 flex-col items-center justify-center p-12 relative overflow-hidden select-none">
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

      {/* painel de formulário */}
      <div className="flex-1 flex flex-col items-center justify-center bg-cream px-6 py-12 min-h-screen lg:min-h-0">

        <div className="lg:hidden flex items-center gap-2.5 text-wine-700 mb-10">
          <LogoMark className="w-5 h-5" />
          <span className="font-display text-2xl tracking-tight">NailFlow</span>
        </div>

        <div className="w-full max-w-sm">

          <div className="mb-8">
            <h1 className="font-display text-2xl text-wine-700 leading-tight mb-1">
              Criar conta
            </h1>
            <p className="text-sm text-ink/50">Preencha os dados para começar a usar o NailFlow.</p>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">

            <div>
              <label className="block text-sm font-medium text-ink/70 mb-1.5" htmlFor="businessName">
                Nome do negócio
              </label>
              <input
                id="businessName"
                type="text"
                required
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                className="input"
                placeholder="Ex: Studio Camila Nails"
                autoComplete="organization"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-ink/70 mb-1.5" htmlFor="slug">
                Link da sua página pública
              </label>
              <div className="flex items-center rounded-xl border border-ink/15 bg-white overflow-hidden focus-within:ring-2 focus-within:ring-wine-500/30 focus-within:border-wine-400 transition-all">
                <span className="pl-3 pr-1 text-sm text-ink/35 select-none whitespace-nowrap">/p/</span>
                <input
                  id="slug"
                  type="text"
                  required
                  value={slug}
                  onChange={(e) => {
                    setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''));
                    setSlugEdited(true);
                  }}
                  className="flex-1 py-2.5 pr-3 text-sm bg-transparent outline-none text-ink placeholder:text-ink/30"
                  placeholder="studio-camila-nails"
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
              <p className="mt-1 text-xs text-ink/35">
                Letras minúsculas, números e hífens. Mínimo 3 caracteres.
              </p>
            </div>

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
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input"
                placeholder="Mínimo 8 caracteres"
                autoComplete="new-password"
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
              {loading ? 'Criando conta…' : 'Criar conta'}
            </button>

          </form>

          <p className="mt-6 text-center text-sm text-ink/50">
            Já tem uma conta?{' '}
            <Link to="/login" className="text-wine-600 hover:text-wine-700 font-medium">
              Entrar
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
