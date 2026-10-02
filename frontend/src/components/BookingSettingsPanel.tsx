import { useEffect, useState } from 'react';
import { useToast } from '../context/ToastContext';
import { api } from '../services/api';

type ConfirmationMode = 'manual' | 'automatic';
type DepositType = 'percentage' | 'fixed';

interface BookingSettings {
  confirmation_mode: ConfirmationMode;
  deposit_required: boolean;
  deposit_type: DepositType | null;
  deposit_value: number | null;
  pix_key: string | null;
}

const PERCENTAGES = [30, 50, 100];
const MIN_FIXED_CENTS = 100;
const MAX_FIXED_CENTS = 1_000_000;
const PIX_KEY_RE = /^[A-Za-z0-9@.+_-]{5,77}$/;

const MODES: Array<{ id: ConfirmationMode; title: string; description: string }> = [
  {
    id: 'manual',
    title: 'Manual',
    description:
      'Você confirma cada solicitação na Agenda. A cliente recebe um aviso de que o pedido foi recebido e, se você não responder em 24 horas, o horário volta a ficar livre.',
  },
  {
    id: 'automatic',
    title: 'Automática',
    description:
      'O horário já fica confirmado assim que a cliente agenda, sem você precisar aprovar. Você ainda pode cancelar pela Agenda.',
  },
];

function brl(cents: number) {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// "25", "25,5", "25.50" → centavos; null se inválido.
function parseReaisToCents(text: string): number | null {
  const t = text.trim().replace(/^R\$\s*/, '');
  if (!/^\d{1,5}([.,]\d{1,2})?$/.test(t)) return null;
  return Math.round(parseFloat(t.replace(',', '.')) * 100);
}

function centsToReaisText(cents: number) {
  return (cents / 100).toFixed(2).replace('.', ',');
}

export default function BookingSettingsPanel() {
  const { toast } = useToast();
  const [saved, setSaved] = useState<BookingSettings | null>(null);
  const [mode, setMode] = useState<ConfirmationMode>('manual');
  const [depositOn, setDepositOn] = useState(false);
  const [depositType, setDepositType] = useState<DepositType>('percentage');
  const [percent, setPercent] = useState(50);
  const [fixedText, setFixedText] = useState('');
  const [pixKey, setPixKey] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);

  function applySaved(s: BookingSettings) {
    setSaved(s);
    setMode(s.confirmation_mode);
    setDepositOn(s.deposit_required);
    setDepositType(s.deposit_type ?? 'percentage');
    setPercent(s.deposit_type === 'percentage' && s.deposit_value && PERCENTAGES.includes(s.deposit_value) ? s.deposit_value : 50);
    setFixedText(s.deposit_type === 'fixed' && s.deposit_value ? centsToReaisText(s.deposit_value) : '');
    setPixKey(s.pix_key ?? '');
  }

  useEffect(() => {
    api
      .get<BookingSettings>('/auth/booking-settings')
      .then(applySaved)
      .catch(() => setLoadError('Não foi possível carregar as configurações. Tente novamente em instantes.'));
  }, []);

  const effectiveMode: ConfirmationMode = depositOn ? 'automatic' : mode;
  const fixedCents = parseReaisToCents(fixedText);
  const pixTrim = pixKey.trim();

  // Validações (espelham as do servidor, que é quem decide de fato).
  const errors: { fixed?: string; pix?: string } = {};
  if (depositOn) {
    if (depositType === 'fixed') {
      if (fixedCents === null) errors.fixed = 'Informe o valor do sinal em reais, por exemplo 25,00.';
      else if (fixedCents < MIN_FIXED_CENTS) errors.fixed = 'O sinal deve ser de pelo menos R$ 1,00.';
      else if (fixedCents > MAX_FIXED_CENTS) errors.fixed = 'O sinal deve ser de no máximo R$ 10.000,00.';
    }
    if (!pixTrim) errors.pix = 'Informe a chave Pix para receber o sinal.';
    else if (!PIX_KEY_RE.test(pixTrim)) errors.pix = 'Chave Pix inválida. Use CPF, CNPJ, e-mail, telefone ou chave aleatória, sem espaços.';
  }

  const currentValue = depositType === 'percentage' ? percent : fixedCents;
  const dirty =
    saved !== null &&
    (effectiveMode !== saved.confirmation_mode ||
      depositOn !== saved.deposit_required ||
      (depositOn &&
        (depositType !== saved.deposit_type || currentValue !== saved.deposit_value || pixTrim !== (saved.pix_key ?? ''))));

  async function handleSave() {
    setShowErrors(true);
    setSaveError(null);
    if (errors.fixed || errors.pix) return;
    setSaving(true);
    try {
      const body = depositOn
        ? {
            confirmation_mode: 'automatic',
            deposit_required: true,
            deposit_type: depositType,
            deposit_value: currentValue,
            pix_key: pixTrim,
          }
        : { confirmation_mode: mode, deposit_required: false };
      const updated = await api.put<BookingSettings>('/auth/booking-settings', body);
      applySaved(updated);
      setShowErrors(false);
      toast('Configuração de agendamento salva');
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Não foi possível salvar.');
    } finally {
      setSaving(false);
    }
  }

  if (loadError) {
    return (
      <div className="rounded-xl bg-rose-50 border border-rose-200 px-4 py-3 text-sm text-rose-700">{loadError}</div>
    );
  }

  if (!saved) {
    return <p className="text-sm text-ink/40">Carregando…</p>;
  }

  const optionClass = (selected: boolean, disabled = false) =>
    `text-left rounded-xl border-2 p-4 transition-all ${
      disabled
        ? 'border-wine-100 bg-wine-50/30 opacity-50 cursor-not-allowed'
        : selected
          ? 'border-wine-500 bg-wine-50/50 shadow-sm'
          : 'border-wine-100 bg-white hover:border-wine-300'
    }`;

  return (
    <div className="space-y-6">
      <p className="text-sm text-ink/50">
        Defina como os novos agendamentos feitos pelas suas clientes (página pública e WhatsApp) são tratados.
        Os horários que você mesma cria na Agenda não mudam.
      </p>

      {/* ── Confirmação ── */}
      <section className="bg-white border border-wine-100 rounded-2xl p-5 space-y-4">
        <div>
          <h2 className="font-display text-lg text-wine-800">Confirmação do agendamento</h2>
          <p className="text-xs text-ink/40 mt-0.5">Como um novo pedido de horário vira um agendamento confirmado.</p>
        </div>

        <div role="radiogroup" aria-label="Confirmação do agendamento" className="grid sm:grid-cols-2 gap-3">
          {MODES.map((m) => {
            const selected = effectiveMode === m.id;
            const disabled = depositOn && m.id === 'manual';
            return (
              <button
                key={m.id}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-disabled={disabled}
                disabled={disabled}
                onClick={() => setMode(m.id)}
                className={optionClass(selected, disabled)}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <p className="text-sm font-semibold text-ink/80">{m.title}</p>
                  <span
                    className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${
                      selected ? 'border-wine-600 bg-wine-600' : 'border-wine-200'
                    }`}
                    aria-hidden="true"
                  >
                    {selected && <span className="w-1.5 h-1.5 rounded-full bg-white" />}
                  </span>
                </div>
                <p className="text-xs text-ink/50 leading-relaxed">{m.description}</p>
              </button>
            );
          })}
        </div>
        {depositOn && (
          <p className="text-xs text-ink/50">Com a cobrança de sinal ativa, a confirmação é automática depois do pagamento.</p>
        )}
      </section>

      {/* ── Sinal ── */}
      <section className="bg-white border border-wine-100 rounded-2xl p-5 space-y-4">
        <div>
          <h2 className="font-display text-lg text-wine-800">Cobrar sinal?</h2>
          <p className="text-xs text-ink/40 mt-0.5">
            Peça um valor adiantado, pago por Pix, para garantir o horário da cliente.
          </p>
        </div>

        <div role="radiogroup" aria-label="Cobrar sinal" className="grid grid-cols-2 gap-3 max-w-xs">
          {[
            { v: false, label: 'Não' },
            { v: true, label: 'Sim' },
          ].map((o) => (
            <button
              key={o.label}
              type="button"
              role="radio"
              aria-checked={depositOn === o.v}
              onClick={() => setDepositOn(o.v)}
              className={`${optionClass(depositOn === o.v)} !p-3 text-center text-sm font-semibold text-ink/80`}
            >
              {o.label}
            </button>
          ))}
        </div>

        {depositOn && (
          <div className="space-y-5 pt-1">
            <div>
              <p className="text-sm font-medium text-ink/60 mb-2">Como calcular o sinal</p>
              <div role="radiogroup" aria-label="Tipo de sinal" className="grid grid-cols-2 gap-3">
                {[
                  { id: 'percentage' as const, label: 'Porcentagem' },
                  { id: 'fixed' as const, label: 'Valor fixo' },
                ].map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    role="radio"
                    aria-checked={depositType === o.id}
                    onClick={() => setDepositType(o.id)}
                    className={`${optionClass(depositType === o.id)} !p-3 text-center text-sm font-semibold text-ink/80`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>

            {depositType === 'percentage' ? (
              <div>
                <p className="text-sm font-medium text-ink/60 mb-2">Quanto do serviço</p>
                <div role="radiogroup" aria-label="Percentual do sinal" className="flex gap-2">
                  {PERCENTAGES.map((p) => (
                    <button
                      key={p}
                      type="button"
                      role="radio"
                      aria-checked={percent === p}
                      onClick={() => setPercent(p)}
                      className={`flex-1 rounded-lg border-2 py-2 text-sm font-semibold transition-colors ${
                        percent === p ? 'border-wine-500 bg-wine-50/50 text-wine-700' : 'border-wine-100 text-ink/60 hover:border-wine-300'
                      }`}
                    >
                      {p}%
                    </button>
                  ))}
                </div>
                <p className="text-xs text-ink/40 mt-2">Exemplo: em um serviço de R$ 100,00, o sinal será {brl(percent * 100)}.</p>
              </div>
            ) : (
              <label className="block">
                <span className="block text-sm font-medium text-ink/60 mb-1">Valor do sinal (R$)</span>
                <input
                  className="input"
                  inputMode="decimal"
                  placeholder="25,00"
                  value={fixedText}
                  onChange={(e) => setFixedText(e.target.value)}
                  aria-invalid={showErrors && !!errors.fixed}
                />
                {showErrors && errors.fixed ? (
                  <span className="block text-xs text-rose-600 mt-1">{errors.fixed}</span>
                ) : (
                  <span className="block text-xs text-ink/40 mt-1">O sinal nunca passa do valor do serviço.</span>
                )}
              </label>
            )}

            <label className="block">
              <span className="block text-sm font-medium text-ink/60 mb-1">Sua chave Pix</span>
              <input
                className="input"
                placeholder="CPF, CNPJ, e-mail, telefone ou chave aleatória"
                value={pixKey}
                onChange={(e) => setPixKey(e.target.value)}
                autoComplete="off"
                aria-invalid={showErrors && !!errors.pix}
              />
              {showErrors && errors.pix ? (
                <span className="block text-xs text-rose-600 mt-1">{errors.pix}</span>
              ) : (
                <span className="block text-xs text-ink/40 mt-1">
                  Só é mostrada à cliente depois que ela reserva o horário.
                </span>
              )}
            </label>

            <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-xs text-amber-800 leading-relaxed">
              O horário fica reservado por <strong>2 horas</strong> para a cliente pagar. Quando o Pix cair na sua conta,
              abra o agendamento na Agenda e toque em <strong>Pagamento recebido</strong> para confirmar. Se o prazo
              passar sem pagamento, a reserva é liberada automaticamente.
            </div>
          </div>
        )}
      </section>

      {saveError && (
        <div className="rounded-xl bg-rose-50 border border-rose-200 px-4 py-3 text-sm text-rose-700">{saveError}</div>
      )}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleSave}
          disabled={!dirty || saving}
          className="px-5 py-2 text-sm rounded-lg bg-wine-600 text-white hover:bg-wine-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors font-medium"
        >
          {saving ? 'Salvando…' : 'Salvar'}
        </button>
      </div>
    </div>
  );
}
