// Modelos de mensagem (/mensagens): ver, ajustar e copiar. Nada é enviado pelo sistema; as edições ficam só neste aparelho.
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { DEFAULT_TEMPLATES, VARIABLES, fillTemplate, unknownVariables, type TemplateKey } from '../content/mensagensModelos';
import { usePageTitle } from '../hooks/usePageTitle';

type Saved = Partial<Record<TemplateKey, string>>;

function useSaved(key: string): [Saved, (next: Saved) => void] {
  const [saved, setSaved] = useState<Saved>(() => {
    try { return JSON.parse(localStorage.getItem(key) ?? '{}') as Saved; } catch { return {}; }
  });
  function update(next: Saved) {
    setSaved(next);
    try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* sem storage: vale só nesta sessão */ }
  }
  return [saved, update];
}

export default function ModelosMensagem() {
  usePageTitle('Modelos de mensagem');
  const { professional } = useAuth();
  const [saved, setSaved] = useSaved(`nailflow_msg_templates_${professional?.id ?? 'anon'}`);
  const [copied, setCopied] = useState<TemplateKey | null>(null);
  useEffect(() => { if (!copied) return; const t = setTimeout(() => setCopied(null), 2000); return () => clearTimeout(t); }, [copied]);

  const sample = useMemo(() => {
    const values: Record<string, string> = Object.fromEntries(VARIABLES.map((v) => [v.name, v.sample]));
    if (professional?.businessName) values.negocio = professional.businessName;
    if (professional?.slug) values.link = `${window.location.origin}/p/${professional.slug}`;
    return values;
  }, [professional]);

  async function copy(key: TemplateKey, text: string) {
    try { await navigator.clipboard.writeText(text); setCopied(key); } catch { setCopied(null); }
  }

  return (
    <div className="space-y-6 pb-10 max-w-3xl">
      <header>
        <h1 className="font-display text-3xl sm:text-4xl text-wine-800 leading-tight">Modelos de mensagem</h1>
        <p className="text-sm text-ink/60 mt-1.5">
          Textos prontos para você ajustar, copiar e enviar pelo seu WhatsApp. <strong>O NailFlow não envia nada a partir daqui.</strong> Suas alterações ficam só neste aparelho.
        </p>
      </header>

      <aside className="card p-4 text-sm text-ink/70 space-y-1" aria-label="Boas práticas">
        <p>Envie mensagens apenas para quem já é sua cliente ou pediu contato, e atenda rápido quem pedir para não receber mais.</p>
        <p>Variáveis disponíveis: {VARIABLES.map((v) => <code key={v.name} className="mx-0.5 px-1.5 py-0.5 rounded bg-wine-50 text-wine-700 text-xs" title={v.label}>{`{${v.name}}`}</code>)}</p>
      </aside>

      {DEFAULT_TEMPLATES.map((t) => {
        const text = saved[t.key] ?? t.text;
        const edited = saved[t.key] !== undefined && saved[t.key] !== t.text;
        const bad = unknownVariables(text);
        const filled = fillTemplate(text, sample);
        return (
          <section key={t.key} className="card p-5 space-y-3" aria-labelledby={`t-${t.key}`}>
            <div>
              <h2 id={`t-${t.key}`} className="font-display text-lg text-wine-700">{t.title}</h2>
              <p className="text-xs text-ink/60 mt-0.5">{t.when}</p>
            </div>
            <label htmlFor={`txt-${t.key}`} className="sr-only">Texto do modelo {t.title}</label>
            <textarea id={`txt-${t.key}`} className="input" rows={4} maxLength={600} value={text} onChange={(e) => setSaved({ ...saved, [t.key]: e.target.value })} />
            {bad.length > 0 && <p role="alert" className="text-xs text-amber-700">Variável desconhecida: {bad.map((b) => `{${b}}`).join(', ')}. Ela será enviada como está.</p>}
            <div>
              <p className="text-[11px] uppercase tracking-widest text-ink/55 mb-1">Como fica (com exemplos)</p>
              <p className="rounded-xl bg-sage-100/50 border border-sage-200 px-4 py-3 text-sm text-ink/80 whitespace-pre-wrap" data-testid={`preview-${t.key}`}>{filled}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn-primary" onClick={() => copy(t.key, filled)}>{copied === t.key ? 'Copiado ✓' : 'Copiar mensagem'}</button>
              {edited && <button type="button" className="btn-secondary" onClick={() => { const { [t.key]: _drop, ...rest } = saved; setSaved(rest); }}>Voltar ao texto original</button>}
            </div>
            <p className="text-xs text-ink/55">Ao copiar, os exemplos acima são usados. Troque pelo nome, serviço, data e horário reais antes de enviar.</p>
          </section>
        );
      })}
    </div>
  );
}
