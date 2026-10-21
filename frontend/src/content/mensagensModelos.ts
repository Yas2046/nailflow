// Modelos de mensagem para a profissional copiar e enviar por conta própria. O sistema NÃO envia nada a partir daqui.
// Variáveis: {cliente} {servico} {data} {hora} {negocio} {link}. Textos curtos, sem pressão e com saída fácil na mensagem de retorno.

export type TemplateKey = 'confirmacao' | 'lembrete' | 'manutencao' | 'retorno';

export interface Template { key: TemplateKey; title: string; when: string; text: string }

export const VARIABLES: Array<{ name: string; label: string; sample: string }> = [
  { name: 'cliente', label: 'Nome da cliente', sample: 'Maria' },
  { name: 'servico', label: 'Serviço', sample: 'Manicure em gel' },
  { name: 'data', label: 'Data', sample: 'quinta-feira, 22/10' },
  { name: 'hora', label: 'Horário', sample: '14:30' },
  { name: 'dias', label: 'Dias desde o último atendimento', sample: '25' },
  { name: 'negocio', label: 'Nome do seu negócio', sample: 'Studio Aline' },
  { name: 'link', label: 'Link da sua página de agendamento', sample: 'https://exemplo.com/p/studio-aline' },
];

export const DEFAULT_TEMPLATES: Template[] = [
  {
    key: 'confirmacao',
    title: 'Confirmação de agendamento',
    when: 'Logo depois de confirmar um horário.',
    text: 'Oi, {cliente}! Seu horário de {servico} está confirmado para {data} às {hora}. Qualquer imprevisto, é só me avisar por aqui. Até lá! — {negocio}',
  },
  {
    key: 'lembrete',
    title: 'Lembrete (véspera)',
    when: 'No dia anterior ao atendimento.',
    text: 'Oi, {cliente}! Passando para lembrar do seu horário amanhã, {data}, às {hora} ({servico}). Pode confirmar que vai conseguir vir? Se precisar remarcar, me avise. — {negocio}',
  },
  {
    key: 'manutencao',
    title: 'Hora da manutenção',
    when: 'Para quem fez um serviço que costuma pedir manutenção e ainda não voltou.',
    text: 'Oi, {cliente}! Já faz {dias} dias do seu último atendimento ({servico}). Está na época da manutenção: se quiser, escolha um horário aqui: {link} — {negocio}. Se preferir não receber mais mensagens, é só me avisar.',
  },
  {
    key: 'retorno',
    title: 'Convite para voltar',
    when: 'Para clientes que não agendam há algumas semanas e aceitam receber mensagens.',
    text: 'Oi, {cliente}! Faz um tempinho que não nos vemos. Se quiser marcar um novo horário, é só escolher aqui: {link} — {negocio}. Se preferir não receber mais mensagens, é só me avisar.',
  },
];

/** Substitui {variavel} pelo valor; variável desconhecida ou sem valor permanece como está (nunca vira "undefined"). */
export function fillTemplate(text: string, values: Partial<Record<string, string>>): string {
  return text.replace(/\{([a-z]+)\}/g, (whole, name: string) => {
    const v = values[name];
    return v === undefined || v === '' ? whole : v;
  });
}

/** Variáveis usadas no texto que não existem na lista (erro de digitação na edição). */
export function unknownVariables(text: string): string[] {
  const known = new Set(VARIABLES.map((v) => v.name));
  return [...new Set([...text.matchAll(/\{([a-z]+)\}/g)].map((m) => m[1]))].filter((n) => !known.has(n));
}
