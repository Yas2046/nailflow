// Conteúdo do "Guia rápido do NailFlow".
// Fonte única: usada pela versão web (/ajuda, /ajuda/<etapa>) e pela versão para
// imprimir/salvar em PDF (/ajuda/imprimir). Os nomes de telas, botões e campos abaixo
// seguem exatamente o que aparece hoje no sistema.
//
// Trechos entre **asteriscos** são exibidos em destaque.

/**
 * Endereço do NailFlow citado no guia (etapa 2).
 * É o domínio de produção atual (docs/INFRAESTRUTURA.md). Se o endereço mudar,
 * basta trocar aqui.
 */
export const ENDERECO_NAILFLOW = 'nailflow.duckdns.org';

export interface GuiaImagem {
  /** arquivo dentro de /public/guia */
  arquivo: string;
  alt: string;
  legenda?: string;
  /** capturas de janelas pequenas (retrato): exibidas mais estreitas e centralizadas */
  estreita?: boolean;
}

export interface GuiaPasso {
  slug: string;
  numero: number;
  titulo: string;
  /** frase curta usada nos cartões e no topo da etapa */
  resumo: string;
  /** passo a passo (lista numerada) */
  itens?: string[];
  /** lista simples, sem numeração */
  pontos?: string[];
  /** lista de “o que você já fez” (com marcas de ✓) */
  feito?: string[];
  /** título da lista `pontos` quando há também `feito` */
  tituloPontos?: string;
  /** aviso em destaque, logo depois do passo a passo */
  importante?: { titulo: string; texto: string };
  dica?: string;
  opcional?: { titulo: string; texto: string };
  imagem?: GuiaImagem;
  /** botão que leva à tela do sistema (só aparece para quem já está logada) */
  atalho?: { to: string; label: string };
  /** esquema visual do fluxo (usado no primeiro agendamento) */
  fluxo?: string[];
}

export const GUIA_TITULO = 'Guia rápido do NailFlow';
export const GUIA_SUBTITULO = 'Do cadastro ao primeiro agendamento, em poucos minutos.';

export const GUIA_PASSOS: GuiaPasso[] = [
  {
    slug: 'o-que-e',
    numero: 1,
    titulo: 'O que é o NailFlow?',
    resumo: 'Sua agenda de atendimentos, suas clientes e seus serviços num só lugar.',
    pontos: [
      '**Organiza sua agenda** por dia, semana ou mês.',
      '**Guarda suas clientes**, com telefone, observações e o histórico de atendimentos.',
      '**Lista seus serviços**, com preço e duração.',
      '**Dá a você um link só seu**: suas clientes escolhem um horário livre e pedem o agendamento, e você confirma.',
    ],
    dica: 'Você não precisa configurar tudo de uma vez. Siga a ordem deste guia e, em poucos minutos, sua agenda estará pronta.',
  },
  {
    slug: 'criando-sua-conta',
    numero: 2,
    titulo: 'Criando sua conta',
    resumo: 'Leva só um minutinho: você precisa de um e-mail e de uma senha.',
    itens: [
      `No celular ou no computador, abra o NailFlow no navegador: **${ENDERECO_NAILFLOW}**. Na tela de entrada, clique em **Criar conta** (logo abaixo do botão Entrar).`,
      'Escreva o **Nome do negócio**, por exemplo: Studio Camila Nails.',
      'Confira o **Link da sua página pública**. Ele é sugerido a partir do nome do negócio; use só letras minúsculas, números e hífens (mínimo de 3 caracteres).',
      'Informe seu **E-mail** e crie uma **Senha** com pelo menos 8 caracteres.',
      'Clique em **Criar conta**. Em seguida você volta para a tela de entrada: digite o mesmo e-mail e a mesma senha e clique em **Entrar**.',
    ],
    dica: 'Escolha um link fácil de lembrar e de digitar: é com ele que suas clientes vão agendar com você.',
    imagem: {
      arquivo: 'criar-conta.png',
      alt: 'Tela Criar conta do NailFlow com os campos Nome do negócio, Link da sua página pública, E-mail e Senha',
      legenda: 'Tela “Criar conta”',
      estreita: true,
    },
  },
  {
    slug: 'configurando-seu-espaco',
    numero: 3,
    titulo: 'Configurando seu espaço',
    resumo: 'Complete seu perfil e abra a agenda definindo os dias e horários em que você atende.',
    itens: [
      'No menu, abra **Configurações**. Na aba **Perfil**, clique em **Editar perfil** e confira seu **Nome**, o **Nome do negócio** e o **WhatsApp** (seu telefone de contato). Depois, clique em **Salvar alterações**.',
      'Abra a aba **Disponibilidade** e deixe ligados os dias em que você atende. Em cada dia, ajuste o horário de **Início** e de **Fim** e, se você faz uma pausa (como o almoço), o **Intervalo**.',
      'Clique em **Salvar disponibilidade**. Enquanto você não salvar, os horários mostrados são só uma sugestão e a agenda não abre para agendamentos.',
      'Volte à aba **Perfil**: em “Seu link de agendamento” estão o botão de copiar, para você enviar o link às clientes, e **Ver página**, para ver como elas enxergam.',
    ],
    opcional: {
      titulo: 'Conectar o WhatsApp (opcional)',
      texto:
        'Na aba **WhatsApp** é possível conectar o seu número ao NailFlow. Isso não é necessário para começar: você já consegue cadastrar serviços, clientes e agendamentos sem conectar. Se quiser conectar, combine com a equipe do NailFlow para fazer isso com acompanhamento.',
    },
    imagem: {
      arquivo: 'disponibilidade.png',
      alt: 'Aba Disponibilidade das Configurações, com os dias da semana e os horários de atendimento',
      legenda: 'Configurações → Disponibilidade',
    },
    atalho: { to: '/configuracoes?tab=disponibilidade', label: 'Abrir Configurações' },
  },
  {
    slug: 'cadastrando-servicos',
    numero: 4,
    titulo: 'Cadastrando seus serviços',
    resumo: 'Cadastre o que você oferece para a agenda saber quanto tempo cada atendimento leva e quanto custa.',
    itens: [
      'No menu, abra **Serviços** e clique em **+ Novo serviço**.',
      'Escreva o **Nome**, por exemplo: Esmaltação em gel, Alongamento em fibra ou Manutenção.',
      'Se quiser, acrescente uma **Descrição** curta.',
      'Informe o **Preço** e a **Duração (min)**. Exemplo: 120 minutos para um alongamento.',
      'Deixe **Serviço ativo** ligado para ele poder ser agendado.',
      '**Aparece no WhatsApp** define se o serviço é oferecido às clientes na sua página de agendamento (e no WhatsApp, se você conectá-lo). Desligado, ele fica como **Somente Agenda**: só você consegue agendá-lo.',
      'Clique em **Salvar**.',
    ],
    dica: 'Comece pelos serviços que você mais faz. Você pode editar ou acrescentar outros quando quiser.',
    imagem: {
      arquivo: 'novo-servico.png',
      alt: 'Janela Novo serviço com Nome, Descrição, Preço e Duração',
      legenda: 'Serviços → + Novo serviço',
      estreita: true,
    },
    atalho: { to: '/servicos', label: 'Abrir Serviços' },
  },
  {
    slug: 'cadastrando-clientes',
    numero: 5,
    titulo: 'Cadastrando clientes',
    resumo: 'Tenha suas clientes à mão, com telefone, observações e o histórico de cada atendimento.',
    itens: [
      'No menu, abra **Clientes** e clique em **+ Nova cliente**.',
      'Preencha o **Nome** e o **Telefone** (código do país + DDD + número, sem espaços). Exemplo: 5531912345678.',
      'Em **Observações** (opcional), anote o que vale lembrar: alergias, preferências de cor, formato das unhas.',
      'Clique em **Cadastrar**.',
      'Para encontrar uma cliente depois, use a busca **Buscar por nome ou telefone…** ou os filtros **Todas**, **Novas**, **Recorrentes** e **Inativas** (sem atendimento há 60 dias ou mais).',
    ],
    dica: 'Ao abrir a ficha de uma cliente você vê o histórico de atendimentos e pode marcar etiquetas, como VIP ou Alergia.',
    imagem: {
      arquivo: 'nova-cliente.png',
      alt: 'Janela Nova cliente com Nome, Telefone e Observações',
      legenda: 'Clientes → + Nova cliente',
      estreita: true,
    },
    atalho: { to: '/clientes', label: 'Abrir Clientes' },
  },
  {
    slug: 'primeiro-agendamento',
    numero: 6,
    titulo: 'Criando seu primeiro agendamento',
    resumo: 'Agora é juntar tudo: o dia e o horário na agenda, a cliente e o serviço.',
    fluxo: ['Horário livre', 'Cliente', 'Serviço', 'Horário', 'Salvar', 'Confirmar'],
    itens: [
      'Abra a **Agenda** e vá até o dia desejado com as setas. O botão **Hoje** volta para o dia atual.',
      'Encontre um horário livre e clique em **+ Agendar**. No computador, o botão aparece quando você passa o mouse sobre o horário.',
      'Escolha a **Cliente** e o **Serviço**. A cliente precisa estar cadastrada antes (etapa 5).',
      'Confira o **Horário**: você pode digitar qualquer hora, como 14:15.',
      'Se quiser, escreva uma **Observação** e clique em **Salvar**.',
      'Pronto: o agendamento aparece na Agenda. Agora falta **confirmar** (veja o aviso abaixo).',
    ],
    importante: {
      titulo: 'Todo agendamento novo começa como “Aguardando confirmação”',
      texto:
        'Mesmo quando é você quem agenda, o horário nasce como **Aguardando confirmação**. Para fechar o horário, abra o agendamento clicando no ícone de lápis (**Editar**), que fica no canto do agendamento (no computador, ele aparece quando você passa o mouse), e depois clique em **Confirmar**. Só então ele passa a **Confirmado**.',
    },
    dica: 'Atende a mesma cliente toda semana? Ao criar o agendamento, ative **Repetir agendamento** e escolha a **Frequência** e até quando repetir.',
    imagem: {
      arquivo: 'novo-agendamento.png',
      alt: 'Janela Novo agendamento com Cliente, Serviço e Horário',
      legenda: 'Agenda → + Agendar',
      estreita: true,
    },
    atalho: { to: '/agenda', label: 'Abrir Agenda' },
  },
  {
    slug: 'entendendo-a-agenda',
    numero: 7,
    titulo: 'Entendendo sua agenda',
    resumo: 'Veja seus horários, entenda cada situação e mude ou cancele o que precisar.',
    pontos: [
      'No topo da Agenda, escolha a visão por **dia**, **semana** ou **mês**. As setas mudam o período e **Hoje** volta para o dia atual.',
      'Cada agendamento aparece no horário marcado, com o nome da cliente, o serviço e a duração. Para ver os detalhes ou **editar**, clique no ícone de lápis (**Editar**) do agendamento.',
      'Para **cancelar**, abra o agendamento pelo lápis e clique em **Cancelar agendamento**.',
      'Dias em que você não atende aparecem como **Dia de folga**. Para reservar um horário para outra coisa, clique em **Bloquear** ao lado do horário livre.',
    ],
    dica: 'Em Configurações → Agendamento você escolhe se confirma cada pedido das clientes manualmente ou se a confirmação é automática.',
    imagem: {
      arquivo: 'agenda.png',
      alt: 'Agenda do dia com horários livres e agendamentos em situações diferentes',
      legenda: 'Agenda do dia',
    },
    atalho: { to: '/agenda', label: 'Abrir Agenda' },
  },
  {
    slug: 'e-agora',
    numero: 8,
    titulo: 'E agora?',
    resumo: 'Pronto! Depois dessas configurações, você já pode usar o NailFlow no seu dia a dia.',
    feito: [
      'Criou sua conta e entrou no NailFlow.',
      'Configurou seu perfil e os horários em que atende.',
      'Cadastrou seus serviços e suas clientes.',
      'Criou um agendamento e aprendeu a confirmá-lo.',
    ],
    tituloPontos: 'No dia a dia',
    pontos: [
      '**Envie seu link de agendamento** para as clientes (Perfil → “Seu link de agendamento”).',
      'Abra o **Início** para ver o que precisa da sua ação e a agenda de hoje.',
      'Pedidos novos chegam como **Aguardando confirmação**: abra o agendamento (lápis) e clique em **Confirmar** ou **Recusar**.',
      'Quando quiser ir além, explore **Dashboard**, **Gastos** e, em Configurações → Agendamento, a cobrança de sinal por Pix.',
    ],
    dica: 'O WhatsApp é opcional. Se tiver interesse, combine com a equipe do NailFlow. E, se surgir alguma dúvida, volte a este guia quando quiser.',
    atalho: { to: '/', label: 'Ir para o Início' },
  },
];

/** Status exibidos na Agenda, com o que cada um significa. */
export const GUIA_STATUS: { nome: string; cor: 'wine' | 'gold' | 'sky' | 'sage' | 'rose' | 'gray'; significado: string }[] = [
  { nome: 'Aguardando confirmação', cor: 'gold', significado: 'Pedido novo, da cliente ou feito por você. Abra pelo lápis e clique em Confirmar (ou Recusar).' },
  { nome: 'Aguardando pagamento', cor: 'sky', significado: 'Só aparece se você cobra sinal. Quando o Pix cair, clique em Pagamento recebido.' },
  { nome: 'Confirmado', cor: 'wine', significado: 'Horário fechado com a cliente.' },
  { nome: 'Concluído', cor: 'sage', significado: 'Atendimento realizado.' },
  { nome: 'Cancelado', cor: 'rose', significado: 'Horário cancelado e liberado na agenda.' },
  { nome: 'Não compareceu', cor: 'gray', significado: 'A cliente não apareceu.' },
];

/** Quatro cartões de “comece por aqui” (apontam para etapas do guia). */
export const GUIA_COMECO: { slug: string; titulo: string; texto: string }[] = [
  { slug: 'configurando-seu-espaco', titulo: 'Configurar seu espaço', texto: 'Perfil e horários de atendimento.' },
  { slug: 'cadastrando-servicos', titulo: 'Cadastrar serviços', texto: 'Nome, preço e duração.' },
  { slug: 'cadastrando-clientes', titulo: 'Cadastrar clientes', texto: 'Telefone, observações e histórico.' },
  { slug: 'primeiro-agendamento', titulo: 'Criar seu primeiro agendamento', texto: 'Da agenda à confirmação.' },
];

export function getPasso(slug: string | undefined) {
  return GUIA_PASSOS.find((p) => p.slug === slug);
}
