// Aviso curto do formulário de nova solicitação da Central de Suporte e contato de privacidade.
//
// Módulo MÍNIMO e SEM IMPORTAÇÕES, de propósito: o componente do aviso (components/support/SupportPrivacyNotice.tsx)
// só pode depender deste arquivo. NÃO importe aqui content/politicaPrivacidade.ts: ele reúne dados da política (nome
// da responsável, textos e pendências) que não devem ir para o bundle público antes de a política ser publicada.
// Os testes em tests/support-notice.test.mjs travam isso.

/** Contato para assuntos de privacidade, informado pela responsável em 2026-10-15. Único lugar a trocar. */
export const PRIVACY_CONTACT: string | null = 'yasminvateles2004@gmail.com';

/**
 * Chave do link do aviso para /privacidade. Mantenha `false` enquanto a página e a rota não estiverem publicadas.
 * Só pode virar `true` quando a política estiver pronta (isPolicyReady), a rota /privacidade registrada e a página
 * existir; o teste de guarda em tests/support-notice.test.mjs falha se isso não for verdade.
 */
export const POLICY_PAGE_PUBLISHED: boolean = false;

export const SUPPORT_NOTICE_TITLE = 'Como tratamos o que você escreve aqui.';
// Sem prazos e sem promessas que o sistema não cumpre. O contato (e, se publicada, o link) são acrescentados pelo componente.
export const SUPPORT_NOTICE_TEXT =
  'O assunto e as mensagens do seu pedido ficam registrados no NailFlow e são usados para atender você. '
  + 'Podem ser lidos pela equipe de suporte e, para manter o sistema funcionando, pela equipe técnica; '
  + 'cópias de segurança podem conter esses registros. '
  + 'Não envie senhas, dados de cartão nem dados de clientes além do necessário. Anexos não são aceitos.';

// Valores que parecem preenchidos mas são marcadores (mesma intenção de isPlaceholder em politicaPrivacidade.ts;
// o teste compara os dois). Cada regra erra para o lado seguro (rejeitar).
const NOT_A_CONTACT: RegExp[] = [
  /\b(todo|tbd|fixme|xxx|lorem ipsum)\b/i,
  /\ba\s+(informar|definir|confirmar|preencher)\b/i,
  /\[\s*(confirmar|definir|informar|preencher|pendente|todo|tbd)[^\]]*\]/i,
  /\[\[|\]\]/,
  /^\s*(pendente|n\/?a|nenhum|vazio|\.{2,}|-+|\?+|_+)\s*$/i,
];

/** Contato mostrado no aviso: só aparece depois de informado (nunca um valor fictício nem um marcador). */
export function noticeContact(contact: string | null | undefined = PRIVACY_CONTACT): string | null {
  if (typeof contact !== 'string') return null;
  const value = contact.trim();
  return value === '' || NOT_A_CONTACT.some((rule) => rule.test(value)) ? null : value;
}
