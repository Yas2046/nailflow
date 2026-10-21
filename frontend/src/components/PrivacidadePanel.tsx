// Configurações → Segurança e dados: trocar a senha, encerrar sessões, baixar os próprios dados e falar sobre privacidade.
// Só usa endpoints que já existem (PUT /auth/password, POST /auth/logout-all, GET /auth/export). Não afirma nada que a política
// (ainda não publicada) não confirme: o contato vem de content/avisoPrivacidade.ts e o status da política é lido de lá.
import { useState, type FormEvent, type ReactNode } from 'react';
import { PRIVACY_CONTACT, POLICY_PAGE_PUBLISHED, noticeContact } from '../content/avisoPrivacidade';
import { api, downloadMyData } from '../services/api';

type Status = { kind: 'idle' } | { kind: 'loading' } | { kind: 'ok'; message: string } | { kind: 'error'; message: string };
const msg = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

function Feedback({ s }: { s: Status }) {
  if (s.kind === 'ok') return <p role="status" className="text-sm text-sage-700 bg-sage-100/70 border border-sage-200 rounded-xl px-4 py-3">{s.message}</p>;
  if (s.kind === 'error') return <p role="alert" className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-4 py-3">{s.message}</p>;
  return null;
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="card p-5 space-y-4">
      <div>
        <h2 className="font-display text-lg text-wine-700">{title}</h2>
        {hint && <p className="text-sm text-ink/60 mt-0.5">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function PasswordForm() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [s, setS] = useState<Status>({ kind: 'idle' });

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (s.kind === 'loading') return;
    if (!current) return setS({ kind: 'error', message: 'Informe a senha atual.' });
    if (next.length < 8) return setS({ kind: 'error', message: 'A nova senha deve ter ao menos 8 caracteres.' });
    if (next === current) return setS({ kind: 'error', message: 'A nova senha deve ser diferente da atual.' });
    if (next !== confirm) return setS({ kind: 'error', message: 'A confirmação não confere com a nova senha.' });
    setS({ kind: 'loading' });
    try {
      await api.put('/auth/password', { currentPassword: current, newPassword: next, confirmPassword: confirm });
      setCurrent(''); setNext(''); setConfirm('');
      setS({ kind: 'ok', message: 'Senha alterada. Os outros aparelhos conectados foram desconectados.' });
    } catch (err) {
      setS({ kind: 'error', message: msg(err, 'Não foi possível alterar a senha.') });
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3 max-w-sm">
      <div>
        <label htmlFor="pw-atual" className="block text-sm font-medium text-ink/70 mb-1.5">Senha atual</label>
        <input id="pw-atual" type="password" className="input" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
      </div>
      <div>
        <label htmlFor="pw-nova" className="block text-sm font-medium text-ink/70 mb-1.5">Nova senha</label>
        <input id="pw-nova" type="password" className="input" autoComplete="new-password" maxLength={72} value={next} onChange={(e) => setNext(e.target.value)} />
      </div>
      <div>
        <label htmlFor="pw-conf" className="block text-sm font-medium text-ink/70 mb-1.5">Repita a nova senha</label>
        <input id="pw-conf" type="password" className="input" autoComplete="new-password" maxLength={72} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      </div>
      <Feedback s={s} />
      <button type="submit" className="btn-primary" disabled={s.kind === 'loading'}>{s.kind === 'loading' ? 'Salvando…' : 'Alterar senha'}</button>
    </form>
  );
}

export default function PrivacidadePanel() {
  const [sessions, setSessions] = useState<Status>({ kind: 'idle' });
  const [exp, setExp] = useState<Status>({ kind: 'idle' });
  const contact = noticeContact(PRIVACY_CONTACT);

  async function logoutAll() {
    setSessions({ kind: 'loading' });
    try {
      await api.post('/auth/logout-all');
      setSessions({ kind: 'ok', message: 'Pronto: os outros aparelhos foram desconectados. Esta sessão continua ativa.' });
    } catch (err) {
      setSessions({ kind: 'error', message: msg(err, 'Não foi possível encerrar as sessões.') });
    }
  }
  async function exportData() {
    setExp({ kind: 'loading' });
    try {
      await downloadMyData();
      setExp({ kind: 'ok', message: 'Arquivo gerado. Guarde-o em local seguro: ele contém dados pessoais das suas clientes.' });
    } catch (err) {
      setExp({ kind: 'error', message: msg(err, 'Não foi possível gerar o arquivo.') });
    }
  }

  return (
    <div className="space-y-5">
      <Section title="Senha" hint="Use pelo menos 8 caracteres. Ao trocar, os outros aparelhos são desconectados.">
        <PasswordForm />
      </Section>

      <Section title="Sessões" hint="Se você entrou em um aparelho que não é seu, encerre as outras sessões.">
        <Feedback s={sessions} />
        <button type="button" className="btn-secondary" onClick={logoutAll} disabled={sessions.kind === 'loading'}>
          {sessions.kind === 'loading' ? 'Encerrando…' : 'Sair dos outros aparelhos'}
        </button>
      </Section>

      <Section title="Seus dados" hint="Baixe uma cópia do que está guardado na sua conta: perfil, serviços, clientes, agendamentos, gastos e, se você usa, o Financeiro.">
        <Feedback s={exp} />
        <button type="button" className="btn-secondary" onClick={exportData} disabled={exp.kind === 'loading'}>
          {exp.kind === 'loading' ? 'Gerando…' : 'Baixar meus dados (JSON)'}
        </button>
        <p className="text-xs text-ink/55">O arquivo não inclui sua senha. Ele contém nomes e telefones das suas clientes: trate-o como informação pessoal.</p>
      </Section>

      <Section title="Privacidade">
        <p className="text-sm text-ink/70 leading-relaxed">
          {POLICY_PAGE_PUBLISHED
            ? 'A política de privacidade do NailFlow está disponível no site.'
            : 'A política de privacidade completa do NailFlow ainda não foi publicada.'}{' '}
          {contact
            ? <>Para dúvidas, correção ou exclusão de dados, fale com <a className="text-wine-700 underline underline-offset-2" href={`mailto:${contact}`}>{contact}</a>.</>
            : 'O canal de contato para assuntos de privacidade ainda não foi informado.'}
        </p>
        <p className="text-sm text-ink/70 leading-relaxed">
          Para excluir a sua conta e os dados dela, faça o pedido pelo contato acima: a exclusão é feita pela administração. Cópias de segurança do
          sistema podem manter os dados por um período limitado depois disso.
        </p>
        <p className="text-sm text-ink/70 leading-relaxed">
          Você é a responsável pelos dados das suas clientes. Cadastre só o necessário para atendê-las e combine com cada uma como prefere ser contatada.
        </p>
      </Section>
    </div>
  );
}
