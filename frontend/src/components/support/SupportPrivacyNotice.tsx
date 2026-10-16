import { Link } from 'react-router-dom';
import { POLICY_PAGE_PUBLISHED, SUPPORT_NOTICE_TEXT, SUPPORT_NOTICE_TITLE, noticeContact } from '../../content/avisoPrivacidade';

/**
 * Aviso curto do formulário de nova solicitação (informativo: sem caixa de aceite). Sem prazos nem promessas.
 * Depende só de content/avisoPrivacidade.ts: não importa a política completa nem seus dados.
 * O contato de privacidade aparece sempre que informado. O link para a política só aparece quando
 * POLICY_PAGE_PUBLISHED é true (página e rota publicadas); enquanto isso o aviso não remete a um texto que ainda não
 * existe. Quando há link, ele abre em outra aba para não perder o que já foi digitado.
 */
export default function SupportPrivacyNotice() {
  const contact = noticeContact();
  return (
    <>
      <strong className="font-semibold">{SUPPORT_NOTICE_TITLE}</strong> {SUPPORT_NOTICE_TEXT}{' '}
      {POLICY_PAGE_PUBLISHED ? (
        <>
          Saiba mais na{' '}
          <Link to="/privacidade" target="_blank" rel="noopener noreferrer" className="font-medium text-wine-700 underline underline-offset-2">
            Política de Privacidade
          </Link>
          {contact ? <> ou fale com {contact}</> : null}.
        </>
      ) : contact ? (
        <>Dúvidas sobre seus dados: {contact}.</>
      ) : null}
    </>
  );
}
