// Retorno de clientes (/retorno): quem está perto da hora da manutenção ou há muito sem agendar, com o motivo e uma mensagem pronta.
// É só uma LISTA de sugestões: nada é enviado pelo sistema. A profissional revisa o texto, copia ou abre o WhatsApp e envia por conta própria.
// Quem pediu para não receber mensagens, quem está em pausa e quem já tem horário marcado não aparecem (regra do servidor).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import LoadError from '../components/LoadError';
import { DEFAULT_TEMPLATES, fillTemplate, type TemplateKey } from '../content/mensagensModelos';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { usePageTitle } from '../hooks/usePageTitle';
import { ApiError, api } from '../services/api';

export interface ReturnItem {
  clientId: string; name: string; phone: string; lastServiceName: string; lastServiceAt: string; daysSince: number;
  reason: 'manutencao' | 'sem_agendar'; intervalDays: number; intervalIsDefault: boolean;
}
export interface ReturnResponse { defaults: { maintenanceDays: number; inactiveDays: number }; inactiveDays: number; items: ReturnItem[] }

const LIMITS = [45, 60, 90];

function readSaved(userId: string): Partial<Record<TemplateKey, string>> {
  try { return JSON.parse(localStorage.getItem(`nailflow_msg_templates_${userId}`) ?? '{}'); } catch { return {}; }
}
const dateBR = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });

export default function Retorno() {
  usePageTitle('Clientes para chamar');
  const { professional } = useAuth();
  const { toast } = useToast();
  const [limit, setLimit] = useState(45);
  const [data, setData] = useState<ReturnResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmOut, setConfirmOut] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    api.get<ReturnResponse>(`/clients/return-suggestions?inactiveDays=${limit}`).then(setData)
      .catch((e: unknown) => setError(e instanceof ApiError && e.status === 503 ? 'Este recurso ainda não está disponível neste ambiente.' : 'Não foi possível carregar as sugestões.'));
  }, [limit]);
  useEffect(load, [load]);

  const saved = useMemo(() => readSaved(professional?.id ?? 'anon'), [professional?.id]);
  function messageFor(i: ReturnItem): string {
    const key: TemplateKey = i.reason === 'manutencao' ? 'manutencao' : 'retorno';
    const text = saved[key] ?? DEFAULT_TEMPLATES.find((t) => t.key === key)!.text;
    return fillTemplate(text, {
      cliente: i.name.trim().split(/\s+/)[0], servico: i.lastServiceName, dias: String(i.daysSince),
      negocio: professional?.businessName ?? '', link: professional?.slug ? `${window.location.origin}/p/${professional.slug}` : '',
    });
  }

  async function copy(i: ReturnItem) {
    try { await navigator.clipboard.writeText(messageFor(i)); toast('Mensagem copiada. Revise antes de enviar.'); } catch { toast('Não foi possível copiar.', 'error'); }
  }
  async function pref(i: ReturnItem, body: { contactOptOut?: boolean; snoozeDays?: number }, ok: string) {
    setBusy(i.clientId);
    try {
      await api.put(`/clients/${i.clientId}/contact-preferences`, body);
      setData((d) => (d ? { ...d, items: d.items.filter((x) => x.clientId !== i.clientId) } : d));
      toast(ok);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Não foi possível salvar.', 'error');
    } finally {
      setBusy(null); setConfirmOut(null);
    }
  }

  return (
    <div className="space-y-6 pb-10 max-w-3xl">
      <header>
        <h1 className="font-display text-3xl sm:text-4xl text-wine-800 leading-tight">Clientes para chamar</h1>
        <p className="text-sm text-ink/60 mt-1.5">
          Sugestões com base no último atendimento de cada cliente. São apenas sugestões: o NailFlow <strong>não envia nada</strong>; você revisa a mensagem e envia pelo seu WhatsApp.
        </p>
      </header>

      <div className="card p-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        <label htmlFor="ret-lim" className="text-sm font-medium text-ink/70">Considerar “sem agendar” a partir de</label>
        <select id="ret-lim" className="input !w-auto" value={limit} onChange={(e) => { setData(null); setLimit(Number(e.target.value)); }}>
          {LIMITS.map((d) => <option key={d} value={d}>{d} dias</option>)}
        </select>
        <p className="text-xs text-ink/55 basis-full">
          O prazo de “manutenção” é {data ? data.defaults.maintenanceDays : 25} dias por padrão e pode ser ajustado em cada serviço (<Link to="/servicos" className="underline underline-offset-2">Serviços</Link>). Os prazos são pontos de partida, não regras.
        </p>
      </div>

      {error ? <LoadError message={error} onRetry={load} /> : !data ? (
        <div className="h-40 rounded-2xl bg-white/70 animate-pulse" role="status" aria-label="Carregando" />
      ) : data.items.length === 0 ? (
        <div className="empty-state">
          <p className="font-display text-lg text-wine-700">Ninguém para chamar agora</p>
          <p>Nenhuma cliente atingiu o prazo de retorno, ou todas já têm horário marcado ou foram pausadas.</p>
        </div>
      ) : (
        <ul className="space-y-3" aria-label="Clientes sugeridas para contato">
          {data.items.map((i) => {
            const text = messageFor(i);
            const digits = i.phone.replace(/\D/g, '');
            return (
              <li key={i.clientId} className="card p-4 space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Link to={`/clientes/${i.clientId}`} className="font-medium text-wine-800 hover:underline">{i.name}</Link>
                    <p className="text-sm text-ink/65 mt-0.5">Último atendimento: <strong>{i.lastServiceName}</strong> em {dateBR(i.lastServiceAt)} ({i.daysSince} dias)</p>
                  </div>
                  <span className={`chip ${i.reason === 'manutencao' ? '' : '!bg-amber-50 !text-amber-800 !border-amber-200'}`}>
                    {i.reason === 'manutencao' ? 'Hora da manutenção' : `${i.daysSince} dias sem agendar`}
                  </span>
                </div>
                <p className="text-xs text-ink/60">
                  {i.reason === 'manutencao'
                    ? `Motivo: ${i.lastServiceName} costuma voltar em ${i.intervalDays} dias${i.intervalIsDefault ? ' (prazo padrão; ajuste no serviço)' : ''}.`
                    : `Motivo: passou de ${data.inactiveDays} dias desde o último atendimento e não há horário marcado.`}
                </p>
                <details className="text-sm">
                  <summary className="cursor-pointer text-wine-700 min-h-[36px] inline-flex items-center">Ver mensagem sugerida</summary>
                  <p className="mt-1 rounded-xl bg-sage-100/50 border border-sage-200 px-4 py-3 text-ink/80 whitespace-pre-wrap">{text}</p>
                  <p className="text-xs text-ink/55 mt-1">Dá para ajustar o texto padrão em <Link to="/mensagens" className="underline underline-offset-2">Modelos de mensagem</Link>.</p>
                </details>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="btn-primary" onClick={() => copy(i)}>Copiar mensagem</button>
                  {digits && <a className="btn-secondary" target="_blank" rel="noreferrer" href={`https://wa.me/${digits}?text=${encodeURIComponent(text)}`}>Abrir no WhatsApp</a>}
                  <button type="button" className="btn-ghost" disabled={busy === i.clientId} onClick={() => pref(i, { snoozeDays: 14 }, 'Pronto: não sugerimos esta cliente por 14 dias.')}>Já chamei</button>
                  <button type="button" className="btn-ghost" disabled={busy === i.clientId} onClick={() => pref(i, { snoozeDays: 30 }, 'Pausada por 30 dias.')}>Pausar 30 dias</button>
                  <button type="button" className="btn-ghost text-rose-700" disabled={busy === i.clientId} onClick={() => setConfirmOut(i.clientId)}>Não enviar mensagens</button>
                </div>
                {confirmOut === i.clientId && (
                  <div role="alertdialog" aria-label={`Confirmar: não enviar mensagens para ${i.name}`} className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 space-y-2">
                    <p>{i.name} não será mais sugerida para retorno e não receberá lembretes automáticos. Você pode desfazer na ficha dela.</p>
                    <div className="flex gap-2">
                      <button type="button" className="btn-danger" disabled={busy === i.clientId} onClick={() => pref(i, { contactOptOut: true }, `${i.name} não receberá mensagens.`)}>Confirmar</button>
                      <button type="button" className="btn-secondary" onClick={() => setConfirmOut(null)}>Cancelar</button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
