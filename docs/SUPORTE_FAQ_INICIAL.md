# Central de Suporte: FAQ inicial (versão final para revisão)

> **Não publicado e não aprovado para publicação.** Nada deste arquivo foi inserido no banco. A produção tem as 6
> categorias de FAQ e **0 artigos**. A publicação (e a ativação de `SUPPORT_CENTER_ENABLED`) só acontece depois de
> autorização explícita, em etapa separada.
>
> **Fontes:** Guia rápido (`frontend/src/content/guiaRapido.ts`), rótulos reais das telas e regras do backend
> (`bookingRules.js`, `publicController.js`, `appointmentsController.js`). Validação feita por leitura do código; **não
> houve teste visual no navegador nem em celular**.
>
> **Formato do sistema:** título de até 120 caracteres, texto de até 8000, **texto simples** (as quebras de linha são
> mantidas; não há Markdown). Cada artigo entra como `rascunho` e é publicado depois. As seis categorias existentes
> foram mantidas; nenhuma categoria nova foi criada.
>
> **Como inserir (decisão futura, separada):**
> 1. Pela tela de FAQ da ADM (`/admin/suporte/faq`): registra a autoria e a Auditoria (`faq_*`).
> 2. Por SQL como `postgres` (escrita em produção, exige autorização): mais rápido, sem registro na Auditoria.

Em cada artigo, o texto dentro do bloco `text` é exatamente o que será publicado.

## Agenda (`agenda`)

### 1. Por que meu agendamento aparece como “Aguardando confirmação”?

- **Categoria:** Agenda
- **Dúvida da profissional:** Marquei um horário e ele ficou como “Aguardando confirmação”. Isso é normal?
- **Resposta:**

```text
Sim, é normal. Todo agendamento que você cria nasce como “Aguardando confirmação”: o horário só fica fechado depois que você confirma.

Para confirmar, abra o agendamento na Agenda pelo ícone de lápis (Editar) e clique em Confirmar. Só então ele passa a Confirmado. No computador, o lápis aparece quando você passa o mouse sobre o agendamento.

Os pedidos que chegam pela sua página de agendamento seguem a regra que você escolheu em Configurações → Agendamento → “Confirmação do agendamento”:
- Manual: você confirma ou recusa cada pedido na Agenda. Se você não responder em 24 horas, o horário volta a ficar livre.
- Automática: se você não cobra sinal, o horário já fica confirmado assim que a cliente agenda. Você ainda pode cancelar pela Agenda.

Se você cobra sinal, a confirmação não é automática: o agendamento fica “Aguardando pagamento” e só passa a Confirmado quando você clica em “Pagamento recebido”. Veja “Como funciona a cobrança de sinal por Pix?”.
```

- **Fonte:** Guia (etapa 6, aviso; etapa 7, dica; etapa 8); `BookingSettingsPanel.tsx` (modos Manual e Automática); `bookingRules.js`, função `initialBookingState` (modo automático só nasce `confirmado` sem sinal; com sinal nasce `aguardando_pagamento`), 24 h e varredura de expiração a cada minuto.
- **Situação:** **Validado.**

### 2. Como edito ou cancelo um agendamento?

- **Categoria:** Agenda
- **Dúvida da profissional:** Preciso mudar ou cancelar um horário que já está na agenda. Como faço?
- **Resposta:**

```text
Na Agenda, abra o agendamento pelo ícone de lápis (Editar). No computador, o lápis aparece quando você passa o mouse sobre o agendamento.

Ali você vê os detalhes e pode alterar o agendamento. Para cancelar, clique em “Cancelar agendamento”: o horário volta a ficar livre na agenda.
```

- **Fonte:** Guia (etapa 7 e tabela de situações); `AppointmentModal.tsx` (rótulo “Cancelar agendamento”).
- **Situação:** **Validado.**

### 3. Como bloqueio um horário? E o que é “Dia de folga”?

- **Categoria:** Agenda
- **Dúvida da profissional:** Quero reservar um horário para outra coisa. Como bloqueio? E por que um dia aparece como “Dia de folga”?
- **Resposta:**

```text
Para reservar um horário para outra coisa, abra a Agenda no dia desejado e clique em “Bloquear”, ao lado do horário livre. No computador, os botões do horário aparecem quando você passa o mouse.

“Dia de folga” aparece nos dias em que você não atende. Esses dias vêm dos seus horários de atendimento: para mudar, vá em Configurações → Disponibilidade, ligue o dia, ajuste os horários e clique em “Salvar disponibilidade”.
```

- **Fonte:** Guia (etapa 7); `Agenda.tsx` (“Dia de folga” aparece quando o dia não tem disponibilidade ou não é de trabalho; botão “Bloquear” ao lado de “+ Agendar”).
- **Situação:** **Validado.** A frase sobre telas pequenas foi removida por decisão da responsável: o comportamento do botão em celular não foi validado visualmente (ver pendência P3).

### 4. Como repito um agendamento toda semana?

- **Categoria:** Agenda
- **Dúvida da profissional:** Atendo a mesma cliente toda semana. Preciso criar um agendamento por vez?
- **Resposta:**

```text
Sim! Ao criar o agendamento, ative “Repetir agendamento”, escolha a frequência e até quando repetir, no campo “Repetir até”. O sistema cria os próximos horários para você.
```

- **Fonte:** Guia (etapa 6, dica); `AppointmentModal.tsx` (“Repetir agendamento”, “Frequência” com “Semanal (toda semana)” e “A cada 2 semanas”, “Repetir até”); `appointmentsController.js`, função `createRecurring` (cria a série em um grupo, só nos horários livres).
- **Situação:** **Validado**, com uma observação: o código cria os horários **livres** e pula os indisponíveis (conflito ou bloqueio), com limite de 52 ocorrências, e cada horário nasce como “Aguardando confirmação”. O texto aprovado não menciona isso; frase opcional registrada na pendência P6.

## Clientes (`clientes`)

### 5. Como cadastro uma cliente e como a encontro depois?

- **Categoria:** Clientes
- **Dúvida da profissional:** Como coloco uma cliente no sistema e depois a encontro rápido?
- **Resposta:**

```text
No menu, abra Clientes e clique em “+ Nova cliente”. Preencha o Nome e o Telefone, com código do país + DDD + número, sem espaços (exemplo: 5531912345678), e clique em Cadastrar.

O campo Observações é opcional: anote só o que for necessário para atender a cliente.

Para encontrar uma cliente, use a busca “Buscar por nome ou telefone…” ou os filtros Todas, Novas, Recorrentes e Inativas (sem atendimento há 60 dias ou mais). Ao abrir a ficha da cliente, você vê o histórico de atendimentos e pode marcar etiquetas.
```

- **Fonte:** Guia (etapa 5); rótulos conferidos na tela de Clientes.
- **Situação:** **Validado** (redação neutra mantida por decisão da responsável). A questão do dado de saúde no Guia e na etiqueta “Alergia” está registrada como pendência separada (P1) e **não** foi alterada aqui.

## Serviços e configurações (`servicos_config`)

### 6. Como cadastro um serviço, com preço e duração?

- **Categoria:** Serviços e configurações
- **Dúvida da profissional:** Como coloco meus serviços no NailFlow?
- **Resposta:**

```text
No menu, abra Serviços e clique em “+ Novo serviço”. Escreva o Nome, informe o Preço e a Duração (min) e deixe “Serviço ativo” ligado para ele poder ser agendado. A Descrição é opcional. Clique em Salvar.

“Aparece no WhatsApp” define se o serviço é oferecido às clientes na sua página de agendamento (e no WhatsApp, se você conectá-lo). Desligado, ele fica como “Somente Agenda”: só você consegue agendá-lo.
```

- **Fonte:** Guia (etapa 4); rótulos conferidos nas telas; `publicController.js` (a página pública só oferece serviços ativos e visíveis).
- **Situação:** **Validado.**

### 7. As clientes não conseguem agendar pela minha página. O que verifico?

- **Categoria:** Serviços e configurações
- **Dúvida da profissional:** Mandei meu link, mas a cliente não consegue marcar horário.
- **Resposta:**

```text
Confira estes pontos:

1) Seus horários. Em Configurações → Disponibilidade, ligue os dias em que você atende e clique em “Salvar disponibilidade”. Enquanto você não salvar, os horários mostrados são só uma sugestão e a agenda não abre para agendamentos.

2) Seus serviços. Em Serviços, o serviço precisa estar com “Serviço ativo” e “Aparece no WhatsApp” ligados. Se estiver como “Somente Agenda”, a cliente não o vê na página.

3) A própria cliente. Se o telefone dela já tem o limite de agendamentos futuros com você, a página avisa e ela não consegue marcar outro horário.

Se nada disso resolver, abra uma solicitação em Ajuda → Abrir uma solicitação, contando o que você já verificou.
```

- **Fonte:** Guia (etapas 3 e 4); `publicController.js` (filtro de serviços ativos e visíveis); `PaginaPublica.tsx` (mensagem do limite de agendamentos futuros); `SuporteHub.tsx` e `Layout.tsx` (caminho Ajuda → Abrir uma solicitação, que só existe com a Central ligada).
- **Situação:** **Validado.**

### 8. Onde encontro e como envio meu link de agendamento?

- **Categoria:** Serviços e configurações
- **Dúvida da profissional:** Como mando para as clientes o endereço da minha agenda?
- **Resposta:**

```text
Em Configurações, na aba Perfil, procure “Seu link de agendamento”. Use o botão de copiar para enviar o link às suas clientes e “Ver página” para ver como elas enxergam. É por esse link que elas escolhem um horário livre e pedem o agendamento.
```

- **Fonte:** Guia (etapas 1, 3 e 8); rótulos “Seu link de agendamento”, “Copiar” e “Ver página” conferidos.
- **Situação:** **Validado.**

## Perfil e acesso (`perfil_acesso`)

### 9. Como altero os dados do meu perfil?

- **Categoria:** Perfil e acesso
- **Dúvida da profissional:** Mudei de telefone ou de nome do negócio. Onde atualizo?
- **Resposta:**

```text
Em Configurações, na aba Perfil, clique em “Editar perfil”. Confira o Nome, o Nome do negócio e o WhatsApp (seu telefone de contato) e clique em “Salvar alterações”.
```

- **Fonte:** Guia (etapa 3); rótulos “Editar perfil” e “Salvar alterações” conferidos.
- **Situação:** **Validado.** A categoria fica com este único artigo, por decisão da responsável.

## Financeiro (`financeiro`)

### 10. Como funciona a cobrança de sinal por Pix?

- **Categoria:** Financeiro
- **Dúvida da profissional:** Posso pedir um valor adiantado para garantir o horário?
- **Resposta:**

```text
Pode. Em Configurações, na aba Agendamento, em “Cobrar sinal?”, escolha Sim. Defina como calcular o sinal (Porcentagem: 30%, 50% ou 100% do serviço, ou Valor fixo) e informe a sua chave Pix. Para cobrar sinal, a confirmação do agendamento precisa estar em “Automática”.

Como funciona, passo a passo:

1) A cliente reserva um horário pela sua página. O agendamento aparece na Agenda como “Aguardando pagamento” e o horário fica reservado por 2 horas.

2) Logo depois de reservar, a cliente vê o valor do sinal e a sua chave Pix. Ela paga por Pix, fora do NailFlow.

3) O NailFlow não confirma o pagamento sozinho. Quando o Pix cair na sua conta, é você quem precisa abrir o agendamento na Agenda e clicar em “Pagamento recebido”. Só então o horário passa a Confirmado.

4) Se as 2 horas passarem sem você marcar o pagamento, a reserva é cancelada automaticamente e o horário volta a ficar livre para qualquer cliente. Depois disso não é mais possível marcar “Pagamento recebido”. Se a cliente já tiver pago, o NailFlow não registra nem devolve o pagamento: combine o acerto diretamente com ela. Para ficar com o horário, ela pode fazer uma nova reserva pela sua página, se ele ainda estiver livre.
```

- **Fonte:** `publicController.js` (criação do agendamento público, `calculateDepositCents` e `initialBookingState`; a resposta traz o valor e a chave Pix); `bookingRules.js` (`initialBookingState`, `PAYMENT_HOLD_HOURS = 2`, `expireDueHolds`, `startHoldSweeper` a cada minuto); `appointmentsController.js` (`markPaidAppointment`, `confirmFailure`); `authController.js` (regra: sinal só com confirmação “automática”; porcentagens 30, 50 e 100); `BookingSettingsPanel.tsx`; `AppointmentModal.tsx` (“Pagamento recebido”); `PaginaPublica.tsx` (caixa “Pagamento do sinal”).
- **Situação:** **Validado**, reescrito depois de verificar o fluxo no código (evidência abaixo). A versão anterior dizia que a confirmação era “automática depois do pagamento”, o que o código não garante.

  **Evidência no código (somente leitura):**
  1. *Criação e status:* a cliente reserva pela página pública; `initialBookingState` devolve `aguardando_pagamento` com validade de 2 h quando o modo é automático e o sinal calculado é maior que zero (`publicController.js`, `bookingRules.js`). O valor do sinal é gravado em `deposit_cents`.
  2. *Pagamento:* não existe, no backend, nenhuma integração que detecte o Pix (busca por pix, payment e pagamento só encontra a chave, as mensagens e esta transição). O Pix é pago fora do sistema.
  3. *Confirmação:* a única transição `aguardando_pagamento → confirmado` é `POST /appointments/:id/mark-paid` (`markPaidAppointment`), disparada pelo botão “Pagamento recebido”. Ela grava `paid_at` e zera a validade. **Depende da profissional.**
  4. *Quando confirma sozinho:* o modo “Automática” sem sinal já cria o agendamento como `confirmado`. Com sinal, nunca confirma sozinho. O comentário de `authController.js` diz o mesmo: o horário é confirmado quando a profissional marca o pagamento como recebido.
  5. *Fim das 2 horas:* `expireDueHolds` (varredura a cada minuto e também nas operações da Agenda) muda o agendamento para `cancelado` com `cancel_reason = 'expired'`, liberando o horário. Depois disso, marcar o pagamento devolve 409: “A reserva deste horário expirou. Peça para a cliente solicitar novamente.” Uma reserva expirada não conta no limite de agendamentos futuros do telefone (`publicController.js`) e o horário volta a ser oferecido a qualquer cliente (`availability.js`, `expiredHoldSql`). O código não registra nem devolve pagamento (não há integração de pagamento) e não envia aviso na expiração dentro de `expireDueHolds`; os workflows do n8n **não foram verificados**, por isso o artigo não afirma nada sobre avisos à cliente.

## Técnico (`tecnico`)

### 11. Como conecto meu WhatsApp ao NailFlow?

- **Categoria:** Técnico
- **Dúvida da profissional:** Preciso conectar o WhatsApp para usar o sistema?
- **Resposta:**

```text
A conexão do WhatsApp é opcional: você já consegue cadastrar serviços, clientes e agendamentos sem conectar.

Se quiser conectar, combine com a equipe do NailFlow para fazer isso com acompanhamento: abra uma solicitação em Ajuda → Abrir uma solicitação, pedindo a conexão.
```

- **Fonte:** Guia (etapa 3, bloco “Conectar o WhatsApp (opcional)”, e etapa 8); `SuporteHub.tsx`.
- **Situação:** **Validado.** O artigo segue a orientação do Guia (“combinar com a equipe”). A aba WhatsApp também tem um fluxo de conexão no código, que o artigo não descreve.

### 12. Uma tela não carrega ou aparece em branco. O que faço?

- **Categoria:** Técnico
- **Dúvida da profissional:** Entrei no sistema e uma tela ficou em branco ou não abre.
- **Resposta:**

```text
Atualize a página e tente de novo. Se continuar, abra uma solicitação em Ajuda → Abrir uma solicitação e conte em qual tela aconteceu e o que você estava fazendo. Não escreva senhas na solicitação.
```

- **Fonte:** orientação genérica; “não envie senhas” vem do aviso do formulário da Central. Não afirma nenhum comportamento do sistema.
- **Situação:** **Validado** (como orientação genérica).

---

## Consistência entre os 12 artigos

- Sem respostas contraditórias nem duplicadas. As repetições são propositais e iguais: “Salvar disponibilidade” (artigos 3 e 7), “Ajuda → Abrir uma solicitação” (7, 11 e 12) e o lápis (Editar) (1 e 2).
- As regras de confirmação do artigo 1 e as do sinal do artigo 10 se encaixam, e o artigo 1 remete ao 10.
- Títulos: o maior tem 67 caracteres (limite 120). Textos: todos bem abaixo de 8000.

## Pendências registradas (fora dos 12 artigos; nenhuma alterada nesta tarefa)

- **P1. Dado de saúde no Guia rápido e na etiqueta “Alergia” (revisão futura).** O Guia (etapa 5) sugere anotar
  “alergias” em Observações e cita a etiqueta “Alergia”. Isso é dado de saúde (ver `LGPD_REVISAO_PRELIMINAR.md`,
  item 9). O artigo 5 foi mantido neutro, sem incentivar esse registro. O Guia e a etiqueta **não foram alterados**:
  decidir depois se mudam.
- **P2. Recuperação de senha (pendência independente).** Não existe recuperação de senha para as profissionais, e
  quem esquece a senha não consegue entrar nem abrir uma solicitação na Central. Não há artigo sobre isso; ver A9 em
  `PENDENCIAS.md`.
- **P3. Teste visual do botão “Bloquear” em celular.** No código, o botão tem a classe `hidden sm:block` e é a única
  entrada para bloquear horários, então pode não aparecer em telas pequenas. Não foi validado visualmente; por isso a
  frase foi retirada do artigo 3. Validar num celular antes de qualquer texto sobre o assunto.
- **P4. Publicação.** Nenhum artigo foi inserido e a Central continua desligada. Antes de ativar: aviso de
  privacidade do formulário (já corrigido localmente, sem commit), commit autorizado, deploy do frontend e flag,
  conforme `SUPORTE_PUBLICACAO.md`.
- **P5. Texto da tela de sinal contradiz o comportamento.** Em Configurações → Agendamento, o painel diz “Com a
  cobrança de sinal ativa, a confirmação é automática depois do pagamento” (`BookingSettingsPanel.tsx`), mas o código
  só confirma quando a profissional clica em “Pagamento recebido”. O artigo 10 segue o código. Corrigir o texto da
  tela é outra tarefa (código); **não foi alterado**.
- **P6. Frase opcional no artigo 4.** O código cria só os horários livres da série (pula os indisponíveis, máximo de
  52) e cada um nasce como “Aguardando confirmação”. Sugestão, **não aplicada** por falta de aprovação: acrescentar
  “Horários que já estiverem ocupados ou bloqueados são pulados, e cada horário criado precisa ser confirmado.”
- **P7. Coerência artigos 1 e 10 (resolvida).** O artigo 1 agora diz que, na confirmação Automática, o horário só
  fica confirmado “se você não cobra sinal”, e que com sinal a confirmação não é automática (depende de “Pagamento
  recebido”), em linha com o artigo 10.
