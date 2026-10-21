// Configuração guiada (/comecar): negócio, serviços, horários e link público, um passo por vez.
// Reaproveita endpoints e telas que já existem (GET/PUT /auth/me, GET/POST /services, a tela de Disponibilidade, /onboarding/status).
// O progresso vem do que já está salvo no servidor, então dá para sair a qualquer momento e continuar depois, e contas que já usam o
// sistema aparecem como concluídas (nada é recriado nem sobrescrito sem o clique da profissional).
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import Disponibilidade from './Disponibilidade';
import LoadError from '../components/LoadError';
import type { OnboardingStatus } from '../components/OnboardingChecklist';
import { useAuth } from '../context/AuthContext';
import { usePageTitle } from '../hooks/usePageTitle';
import { api } from '../services/api';
import type { Service } from '../types';
import { formatBRL, parseBRLToCents } from '../utils/money';

const STEPS = [
  { key: 'perfil', title: 'Seu negócio', hint: 'Como suas clientes vão ver você.' },
  { key: 'servicos', title: 'Serviços', hint: 'O que você oferece, com preço e duração.' },
  { key: 'horarios', title: 'Horários', hint: 'Dias e horas em que você atende.' },
  { key: 'link', title: 'Seu link', hint: 'A página para suas clientes agendarem.' },
] as const;
type StepKey = (typeof STEPS)[number]['key'];

const SUGGESTIONS: Array<{ name: string; minutes: number }> = [
  { name: 'Manicure', minutes: 45 },
  { name: 'Pedicure', minutes: 60 },
  { name: 'Esmaltação em gel', minutes: 60 },
  { name: 'Alongamento em fibra', minutes: 120 },
  { name: 'Manutenção de alongamento', minutes: 90 },
];

interface Me { id: string; name: string; email: string; business_name: string; phone_whatsapp: string | null; slug: string }

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-ink/70 mb-1.5">{label}</label>
      {children}
      {hint && <p className="text-xs text-ink/55 mt-1">{hint}</p>}
    </div>
  );
}

// ── passo 1: negócio ─────────────────────────────────────────────────────────
function StepNegocio({ onSaved }: { onSaved: () => void }) {
  const { updateProfessional } = useAuth();
  const [me, setMe] = useState<Me | null>(null);
  const [name, setName] = useState('');
  const [business, setBusiness] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(() => {
    setLoadError(false);
    api.get<Me>('/auth/me').then((d) => { setMe(d); setName(d.name ?? ''); setBusiness(d.business_name ?? ''); setPhone(d.phone_whatsapp ?? ''); }).catch(() => setLoadError(true));
  }, []);
  useEffect(load, [load]);

  if (loadError) return <LoadError message="Não foi possível carregar seus dados." onRetry={load} />;
  if (!me) return <div className="h-40 rounded-2xl bg-white/70 animate-pulse" role="status" aria-label="Carregando" />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null); setSaved(false);
    const digits = phone.replace(/\D/g, '');
    if (!name.trim() || !business.trim()) return setError('Preencha seu nome e o nome do negócio.');
    if (digits.length < 10) return setError('Informe o WhatsApp com DDD (mínimo 10 dígitos).');
    setSaving(true);
    try {
      const updated = await api.put<Me & { business_name: string }>('/auth/me', { name: name.trim(), business_name: business.trim(), phone_whatsapp: digits, email: me!.email });
      updateProfessional({ id: updated.id, name: updated.name, email: updated.email, businessName: updated.business_name, slug: updated.slug });
      setSaved(true);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível salvar.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4 max-w-md">
      <Field id="c-nome" label="Seu nome"><input id="c-nome" className="input" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} autoComplete="name" /></Field>
      <Field id="c-neg" label="Nome do negócio" hint="Aparece na sua página de agendamento."><input id="c-neg" className="input" value={business} maxLength={100} onChange={(e) => setBusiness(e.target.value)} /></Field>
      <Field id="c-tel" label="WhatsApp (com DDD)" hint="Usado para o contato com suas clientes."><input id="c-tel" className="input" inputMode="tel" value={phone} maxLength={20} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" /></Field>
      {error && <p role="alert" className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-4 py-3">{error}</p>}
      {saved && <p role="status" className="text-sm text-sage-700 bg-sage-100/70 border border-sage-200 rounded-xl px-4 py-3">Salvo.</p>}
      <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Salvando…' : 'Salvar'}</button>
    </form>
  );
}

// ── passo 2: serviços ────────────────────────────────────────────────────────
function StepServicos({ onSaved }: { onSaved: () => void }) {
  const [services, setServices] = useState<Service[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [minutes, setMinutes] = useState('60');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    setLoadError(false);
    api.get<Service[]>('/services').then(setServices).catch(() => setLoadError(true));
  }, []);
  useEffect(load, [load]);

  if (loadError) return <LoadError message="Não foi possível carregar seus serviços." onRetry={load} />;
  if (!services) return <div className="h-40 rounded-2xl bg-white/70 animate-pulse" role="status" aria-label="Carregando" />;

  const taken = (n: string) => services.some((s) => s.name.trim().toLowerCase() === n.trim().toLowerCase());

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const priceCents = parseBRLToCents(price);
    const dur = parseInt(minutes, 10);
    if (!name.trim()) return setError('Dê um nome ao serviço.');
    if (taken(name)) return setError('Você já tem um serviço com esse nome.');
    if (priceCents == null) return setError('Informe o preço (ex.: 45,00).');
    if (!dur || dur <= 0) return setError('Informe a duração em minutos.');
    setSaving(true);
    try {
      await api.post('/services', { name: name.trim(), description: null, priceCents, durationMinutes: dur, active: true, availableOnWhatsapp: true });
      setName(''); setPrice('');
      load();
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível salvar o serviço.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      {services.length > 0 && (
        <ul className="card divide-y divide-wine-50" aria-label="Serviços cadastrados">
          {services.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
              <span className="font-medium text-ink/80 truncate">{s.name}</span>
              <span className="text-ink/60 tabular-nums shrink-0">{formatBRL(s.priceCents)} · {s.durationMinutes} min</span>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={submit} className="space-y-4 max-w-md">
        <p className="text-sm text-ink/60">{services.length === 0 ? 'Cadastre o primeiro serviço. Toque em uma sugestão para preencher o nome.' : 'Quer adicionar outro?'}</p>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Sugestões de serviço">
          {SUGGESTIONS.filter((s) => !taken(s.name)).map((s) => (
            <button key={s.name} type="button" className="chip hover:bg-wine-100 min-h-[36px]" onClick={() => { setName(s.name); setMinutes(String(s.minutes)); }}>{s.name}</button>
          ))}
        </div>
        <Field id="s-nome" label="Nome do serviço"><input id="s-nome" className="input" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field id="s-preco" label="Preço (R$)"><input id="s-preco" className="input" inputMode="decimal" placeholder="45,00" value={price} onChange={(e) => setPrice(e.target.value)} /></Field>
          <Field id="s-min" label="Duração (min)"><input id="s-min" className="input" inputMode="numeric" value={minutes} onChange={(e) => setMinutes(e.target.value)} /></Field>
        </div>
        {error && <p role="alert" className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-4 py-3">{error}</p>}
        <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Salvando…' : 'Adicionar serviço'}</button>
      </form>
    </div>
  );
}

// ── passo 4: link ────────────────────────────────────────────────────────────
function StepLink() {
  const { professional } = useAuth();
  const [copied, setCopied] = useState(false);
  const [slug, setSlug] = useState<string | undefined>(professional?.slug);
  const [loaded, setLoaded] = useState(Boolean(professional?.slug));
  useEffect(() => {
    if (slug) return;
    api.get<Me>('/auth/me').then((d) => setSlug(d.slug)).catch(() => {}).finally(() => setLoaded(true));
  }, [slug]);
  const url = slug ? `${window.location.origin}/p/${slug}` : null;
  if (!loaded) return <div className="h-24 rounded-2xl bg-white/70 animate-pulse" role="status" aria-label="Carregando" />;
  if (!url) return <p className="text-sm text-ink/60">Sua página ainda não tem um endereço. Defina em Configurações.</p>;
  async function copy() {
    try { await navigator.clipboard.writeText(url!); setCopied(true); } catch { setCopied(false); }
  }
  return (
    <div className="space-y-4 max-w-md">
      <p className="text-sm text-ink/70">Compartilhe este endereço com suas clientes (Instagram, WhatsApp, cartão). Elas escolhem serviço e horário sozinhas.</p>
      <div className="card p-4 space-y-3">
        <p className="font-mono text-xs break-all text-wine-800" data-testid="public-url">{url}</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-primary" onClick={copy}>{copied ? 'Copiado ✓' : 'Copiar link'}</button>
          <a className="btn-secondary" href={url} target="_blank" rel="noreferrer">Ver minha página</a>
        </div>
      </div>
      <p className="text-xs text-ink/55">
        O WhatsApp é opcional agora: você pode conectá-lo depois em <Link className="underline underline-offset-2" to="/configuracoes?tab=whatsapp">Configurações → WhatsApp</Link>.
      </p>
    </div>
  );
}

// ── página ───────────────────────────────────────────────────────────────────
export default function Comecar() {
  usePageTitle('Primeiros passos');
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [status, setStatus] = useState<OnboardingStatus | null>(null);
  const [statusError, setStatusError] = useState(false);

  const refresh = useCallback(() => {
    setStatusError(false);
    api.get<OnboardingStatus>('/onboarding/status').then(setStatus).catch(() => setStatusError(true));
  }, []);
  useEffect(refresh, [refresh]);

  const done = useMemo(() => (status ? STEPS.map((s) => Boolean(status[s.key as keyof OnboardingStatus])) : STEPS.map(() => false)), [status]);
  // O passo inicial é o primeiro pendente NA CHEGADA; depois fica fixo. Sem isso, salvar um serviço pularia sozinho para o passo
  // seguinte e a profissional não conseguiria cadastrar o segundo serviço.
  const initialStep = useRef<number | null>(null);
  if (status && initialStep.current === null) initialStep.current = Math.max(done.findIndex((d) => !d), 0);
  const fromUrl = Number(params.get('passo'));
  const index = Number.isInteger(fromUrl) && fromUrl >= 1 && fromUrl <= STEPS.length ? fromUrl - 1 : (initialStep.current ?? 0);
  const step = STEPS[index];
  const completed = done.filter(Boolean).length;
  const allDone = status !== null && completed === STEPS.length;

  function go(i: number) { refresh(); setParams({ passo: String(i + 1) }, { replace: false }); }

  if (statusError) return <div className="max-w-2xl"><LoadError message="Não foi possível carregar seu progresso." onRetry={refresh} /></div>;
  if (!status) return <div className="h-48 rounded-2xl bg-white/70 animate-pulse max-w-2xl" role="status" aria-label="Carregando" />;

  return (
    <div className="max-w-2xl space-y-6 pb-10">
      <header>
        <h1 className="font-display text-3xl sm:text-4xl text-wine-800 leading-tight">{allDone ? 'Tudo pronto' : 'Vamos configurar sua agenda'}</h1>
        <p className="text-sm text-ink/60 mt-1.5">
          {allDone ? 'O essencial está configurado. Você pode revisar qualquer passo quando quiser.' : 'Um passo de cada vez. Dá para sair e continuar depois: o que você salvar fica guardado.'}
        </p>
      </header>

      <nav aria-label="Progresso">
        <p className="text-xs font-semibold text-ink/60 mb-2" aria-live="polite">{completed} de {STEPS.length} passos concluídos</p>
        <div className="h-1.5 rounded-full bg-wine-100 overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={STEPS.length} aria-valuenow={completed}>
          <div className="h-full bg-wine-600 rounded-full transition-all" style={{ width: `${(completed / STEPS.length) * 100}%` }} />
        </div>
        <ol className="grid grid-cols-4 gap-1.5 mt-3">
          {STEPS.map((s, i) => (
            <li key={s.key}>
              <button type="button" onClick={() => go(i)} aria-current={i === index ? 'step' : undefined}
                className={`w-full min-h-[44px] rounded-xl px-1.5 py-2 text-xs font-medium text-center transition-colors ${i === index ? 'bg-wine-600 text-white' : done[i] ? 'bg-sage-100 text-sage-700' : 'bg-white text-ink/70 border border-wine-100'}`}>
                <span aria-hidden="true">{done[i] ? '✓ ' : `${i + 1}. `}</span>{s.title}
              </button>
            </li>
          ))}
        </ol>
      </nav>

      <section className="space-y-4" aria-labelledby="passo-titulo">
        <div>
          <h2 id="passo-titulo" className="section-title">{step.title}</h2>
          <p className="text-sm text-ink/60 mt-1">{step.hint}</p>
        </div>
        {step.key === 'perfil' && <StepNegocio onSaved={refresh} />}
        {step.key === 'servicos' && <StepServicos onSaved={refresh} />}
        {step.key === 'horarios' && <div className="[&_h1:first-of-type]:hidden"><Disponibilidade /></div>}
        {step.key === 'link' && <StepLink />}
      </section>

      <footer className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-wine-100/70">
        <Link to="/" className="text-sm text-ink/60 hover:text-wine-700 underline underline-offset-2 min-h-[44px] inline-flex items-center">Continuar depois</Link>
        <div className="flex gap-2">
          {index > 0 && <button type="button" className="btn-secondary" onClick={() => go(index - 1)}>Voltar</button>}
          {index < STEPS.length - 1
            ? <button type="button" className="btn-primary" onClick={() => go(index + 1)}>{done[index] ? 'Próximo' : 'Pular por agora'}</button>
            : <button type="button" className="btn-primary" onClick={() => navigate(allDone ? '/agenda' : '/')}>{allDone ? 'Ir para a agenda' : 'Concluir'}</button>}
        </div>
      </footer>
    </div>
  );
}
