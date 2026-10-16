-- Carga inicial da FAQ da Central de Suporte: 12 artigos. NÃO é executada por nenhum processo (pasta _ops).
--
-- FONTE: docs/SUPORTE_FAQ_INICIAL.md (textos aprovados). Este arquivo foi GERADO dele em 2026-10-16; se o documento mudar,
-- regere os dois scripts (o teste backend/tests/support-faq-seed.test.js falha enquanto o SQL e o documento divergirem).
-- Reversão: support_faq_initial_revert.sql (apaga SÓ os 12 ids abaixo).
--
-- COMO EXECUTAR (produção, como postgres, pelo socket). O usuário postgres não lê /root: o root abre o arquivo e o entrega
-- por entrada padrão. Confira antes o banco: o script imprime current_database().
--   sudo -u postgres psql -d nailflow -X -v ON_ERROR_STOP=1 < backend/db/migrations/_ops/support_faq_initial.sql
-- Opcional: -v artigo_status=rascunho  (entra como rascunho, sem published_at; o padrão é publicado).
--
-- O QUE FAZ
--  * Insere 12 artigos em support_faq_articles, nas 6 categorias que a migration 023 já criou. IDs FIXOS (listados abaixo):
--    é o que torna a carga idempotente (rodar de novo não duplica) e a reversão segura (só esses ids).
--  * Posição: continua depois do maior position já existente na categoria, fora do lote (hoje a tabela está vazia).
--  * Se já existir OUTRO artigo com a mesma categoria e o mesmo título, aquele item do lote é pulado (não duplica).
--  * created_by e updated_by ficam NULOS (a coluna aceita) e NÃO grava em admin_audit_log: é carga por SQL, sem autoria.
--  * Tudo em UMA transação com lock_timeout de 5 s: qualquer erro desfaz tudo. Imprime só contagens.
--  * Não toca em chamados, mensagens, eventos, categorias, contas nem em artigos que não sejam do lote.
--
-- IDs DO LOTE (n, id, categoria):
--      1  df00d914-5ef7-4b07-9a7d-92a6939d38ea  agenda
--      2  8c1d78d4-b229-4c9d-b4c1-0da28a028df0  agenda
--      3  90e98ccb-320e-43ff-affe-e81cb7a4e8a4  agenda
--      4  bb0c2da7-4fa8-4552-b95f-7fb075e73972  agenda
--      5  da37ea08-d1f6-48a5-8026-da5b6098bdec  clientes
--      6  0c1fdf53-7506-4b58-8f0c-07b26b352b43  servicos_config
--      7  2925a07f-6f24-495d-afb9-b768a1bdcc12  servicos_config
--      8  100d6a4e-b426-4f98-b6fc-c260bd6dd096  servicos_config
--      9  72165606-6d30-4ef3-a698-494c6f00533d  perfil_acesso
--     10  2a9aa172-e66d-4f4b-bb4c-6f6903908c00  financeiro
--     11  bd3090f7-8b28-44f5-bcd5-776db5bb5a29  tecnico
--     12  c520c3f8-fa47-4a5c-8619-837da90ef807  tecnico

\set ON_ERROR_STOP on
\encoding UTF8
\if :{?artigo_status}
\else
  \set artigo_status publicado
\endif

BEGIN;
SET LOCAL lock_timeout = '5s';

-- O psql não interpola variáveis dentro de $$...$$: o parâmetro vai para uma configuração da transação.
SELECT set_config('nf_faq.status', :'artigo_status', true) AS p1 \gset _

DO $v$
BEGIN
  IF current_setting('nf_faq.status') NOT IN ('publicado', 'rascunho') THEN
    RAISE EXCEPTION 'artigo_status deve ser publicado ou rascunho; recebido "%"', current_setting('nf_faq.status');
  END IF;
  IF to_regclass('public.support_faq_articles') IS NULL THEN
    RAISE EXCEPTION 'support_faq_articles não existe neste banco (migration 023 não aplicada)';
  END IF;
  IF (SELECT count(*) FROM support_faq_categories WHERE slug IN ('agenda','clientes','servicos_config','perfil_acesso','financeiro','tecnico')) <> 6 THEN
    RAISE EXCEPTION 'as 6 categorias esperadas não existem neste banco; nada foi inserido';
  END IF;
END $v$;

CREATE TEMP TABLE nf_faq_lote (n int PRIMARY KEY, id uuid NOT NULL, category_slug text NOT NULL, title text NOT NULL, body text NOT NULL) ON COMMIT DROP;
INSERT INTO nf_faq_lote (n, id, category_slug, title, body) VALUES
  (1, 'df00d914-5ef7-4b07-9a7d-92a6939d38ea'::uuid, 'agenda', $faq$Por que meu agendamento aparece como “Aguardando confirmação”?$faq$, $faq$Sim, é normal. Todo agendamento que você cria nasce como “Aguardando confirmação”: o horário só fica fechado depois que você confirma.

Para confirmar, abra o agendamento na Agenda pelo ícone de lápis (Editar) e clique em Confirmar. Só então ele passa a Confirmado. No computador, o lápis aparece quando você passa o mouse sobre o agendamento.

Os pedidos que chegam pela sua página de agendamento seguem a regra que você escolheu em Configurações → Agendamento → “Confirmação do agendamento”:
- Manual: você confirma ou recusa cada pedido na Agenda. Se você não responder em 24 horas, o horário volta a ficar livre.
- Automática: se você não cobra sinal, o horário já fica confirmado assim que a cliente agenda. Você ainda pode cancelar pela Agenda.

Se você cobra sinal, a confirmação não é automática: o agendamento fica “Aguardando pagamento” e só passa a Confirmado quando você clica em “Pagamento recebido”. Veja “Como funciona a cobrança de sinal por Pix?”.$faq$),
  (2, '8c1d78d4-b229-4c9d-b4c1-0da28a028df0'::uuid, 'agenda', $faq$Como edito ou cancelo um agendamento?$faq$, $faq$Na Agenda, abra o agendamento pelo ícone de lápis (Editar). No computador, o lápis aparece quando você passa o mouse sobre o agendamento.

Ali você vê os detalhes e pode alterar o agendamento. Para cancelar, clique em “Cancelar agendamento”: o horário volta a ficar livre na agenda.$faq$),
  (3, '90e98ccb-320e-43ff-affe-e81cb7a4e8a4'::uuid, 'agenda', $faq$Como bloqueio um horário? E o que é “Dia de folga”?$faq$, $faq$Para reservar um horário para outra coisa, abra a Agenda no dia desejado e clique em “Bloquear”, ao lado do horário livre. No computador, os botões do horário aparecem quando você passa o mouse.

“Dia de folga” aparece nos dias em que você não atende. Esses dias vêm dos seus horários de atendimento: para mudar, vá em Configurações → Disponibilidade, ligue o dia, ajuste os horários e clique em “Salvar disponibilidade”.$faq$),
  (4, 'bb0c2da7-4fa8-4552-b95f-7fb075e73972'::uuid, 'agenda', $faq$Como repito um agendamento toda semana?$faq$, $faq$Sim! Ao criar o agendamento, ative “Repetir agendamento”, escolha a frequência e até quando repetir, no campo “Repetir até”. O sistema cria os próximos horários para você.$faq$),
  (5, 'da37ea08-d1f6-48a5-8026-da5b6098bdec'::uuid, 'clientes', $faq$Como cadastro uma cliente e como a encontro depois?$faq$, $faq$No menu, abra Clientes e clique em “+ Nova cliente”. Preencha o Nome e o Telefone, com código do país + DDD + número, sem espaços (exemplo: 5531912345678), e clique em Cadastrar.

O campo Observações é opcional: anote só o que for necessário para atender a cliente.

Para encontrar uma cliente, use a busca “Buscar por nome ou telefone…” ou os filtros Todas, Novas, Recorrentes e Inativas (sem atendimento há 60 dias ou mais). Ao abrir a ficha da cliente, você vê o histórico de atendimentos e pode marcar etiquetas.$faq$),
  (6, '0c1fdf53-7506-4b58-8f0c-07b26b352b43'::uuid, 'servicos_config', $faq$Como cadastro um serviço, com preço e duração?$faq$, $faq$No menu, abra Serviços e clique em “+ Novo serviço”. Escreva o Nome, informe o Preço e a Duração (min) e deixe “Serviço ativo” ligado para ele poder ser agendado. A Descrição é opcional. Clique em Salvar.

“Aparece no WhatsApp” define se o serviço é oferecido às clientes na sua página de agendamento (e no WhatsApp, se você conectá-lo). Desligado, ele fica como “Somente Agenda”: só você consegue agendá-lo.$faq$),
  (7, '2925a07f-6f24-495d-afb9-b768a1bdcc12'::uuid, 'servicos_config', $faq$As clientes não conseguem agendar pela minha página. O que verifico?$faq$, $faq$Confira estes pontos:

1) Seus horários. Em Configurações → Disponibilidade, ligue os dias em que você atende e clique em “Salvar disponibilidade”. Enquanto você não salvar, os horários mostrados são só uma sugestão e a agenda não abre para agendamentos.

2) Seus serviços. Em Serviços, o serviço precisa estar com “Serviço ativo” e “Aparece no WhatsApp” ligados. Se estiver como “Somente Agenda”, a cliente não o vê na página.

3) A própria cliente. Se o telefone dela já tem o limite de agendamentos futuros com você, a página avisa e ela não consegue marcar outro horário.

Se nada disso resolver, abra uma solicitação em Ajuda → Abrir uma solicitação, contando o que você já verificou.$faq$),
  (8, '100d6a4e-b426-4f98-b6fc-c260bd6dd096'::uuid, 'servicos_config', $faq$Onde encontro e como envio meu link de agendamento?$faq$, $faq$Em Configurações, na aba Perfil, procure “Seu link de agendamento”. Use o botão de copiar para enviar o link às suas clientes e “Ver página” para ver como elas enxergam. É por esse link que elas escolhem um horário livre e pedem o agendamento.$faq$),
  (9, '72165606-6d30-4ef3-a698-494c6f00533d'::uuid, 'perfil_acesso', $faq$Como altero os dados do meu perfil?$faq$, $faq$Em Configurações, na aba Perfil, clique em “Editar perfil”. Confira o Nome, o Nome do negócio e o WhatsApp (seu telefone de contato) e clique em “Salvar alterações”.$faq$),
  (10, '2a9aa172-e66d-4f4b-bb4c-6f6903908c00'::uuid, 'financeiro', $faq$Como funciona a cobrança de sinal por Pix?$faq$, $faq$Pode. Em Configurações, na aba Agendamento, em “Cobrar sinal?”, escolha Sim. Defina como calcular o sinal (Porcentagem: 30%, 50% ou 100% do serviço, ou Valor fixo) e informe a sua chave Pix. Para cobrar sinal, a confirmação do agendamento precisa estar em “Automática”.

Como funciona, passo a passo:

1) A cliente reserva um horário pela sua página. O agendamento aparece na Agenda como “Aguardando pagamento” e o horário fica reservado por 2 horas.

2) Logo depois de reservar, a cliente vê o valor do sinal e a sua chave Pix. Ela paga por Pix, fora do NailFlow.

3) O NailFlow não confirma o pagamento sozinho. Quando o Pix cair na sua conta, é você quem precisa abrir o agendamento na Agenda e clicar em “Pagamento recebido”. Só então o horário passa a Confirmado.

4) Se as 2 horas passarem sem você marcar o pagamento, a reserva é cancelada automaticamente e o horário volta a ficar livre para qualquer cliente. Depois disso não é mais possível marcar “Pagamento recebido”. Se a cliente já tiver pago, o NailFlow não registra nem devolve o pagamento: combine o acerto diretamente com ela. Para ficar com o horário, ela pode fazer uma nova reserva pela sua página, se ele ainda estiver livre.$faq$),
  (11, 'bd3090f7-8b28-44f5-bcd5-776db5bb5a29'::uuid, 'tecnico', $faq$Como conecto meu WhatsApp ao NailFlow?$faq$, $faq$A conexão do WhatsApp é opcional: você já consegue cadastrar serviços, clientes e agendamentos sem conectar.

Se quiser conectar, combine com a equipe do NailFlow para fazer isso com acompanhamento: abra uma solicitação em Ajuda → Abrir uma solicitação, pedindo a conexão.$faq$),
  (12, 'c520c3f8-fa47-4a5c-8619-837da90ef807'::uuid, 'tecnico', $faq$Uma tela não carrega ou aparece em branco. O que faço?$faq$, $faq$Atualize a página e tente de novo. Se continuar, abra uma solicitação em Ajuda → Abrir uma solicitação e conte em qual tela aconteceu e o que você estava fazendo. Não escreva senhas na solicitação.$faq$);

SELECT current_database() AS banco, :'artigo_status' AS status_dos_artigos,
       (SELECT count(*) FROM support_faq_articles) AS artigos_no_banco_antes,
       (SELECT count(*) FROM support_faq_articles a JOIN nf_faq_lote l ON l.id = a.id) AS do_lote_ja_presentes,
       (SELECT count(*) FROM nf_faq_lote l WHERE NOT EXISTS (SELECT 1 FROM support_faq_articles a WHERE a.id = l.id)
          AND EXISTS (SELECT 1 FROM support_faq_articles a WHERE a.category_slug = l.category_slug AND a.title = l.title)) AS pulados_titulo_ja_existente;

WITH base AS (
  SELECT category_slug, max(position) AS mx
    FROM support_faq_articles
   WHERE id NOT IN (SELECT id FROM nf_faq_lote)
   GROUP BY category_slug
), novos AS (
  INSERT INTO support_faq_articles (id, category_slug, title, body, position, status, published_at)
  SELECT l.id, l.category_slug, l.title, l.body,
         COALESCE(b.mx, 0) + row_number() OVER (PARTITION BY l.category_slug ORDER BY l.n),
         current_setting('nf_faq.status'),
         CASE WHEN current_setting('nf_faq.status') = 'publicado' THEN now() END
    FROM nf_faq_lote l
    LEFT JOIN base b ON b.category_slug = l.category_slug
   WHERE NOT EXISTS (SELECT 1 FROM support_faq_articles a WHERE a.id = l.id)
     AND NOT EXISTS (SELECT 1 FROM support_faq_articles a WHERE a.category_slug = l.category_slug AND a.title = l.title)
  ON CONFLICT (id) DO NOTHING
  RETURNING id
)
SELECT count(*) AS artigos_inseridos FROM novos;

SELECT (SELECT count(*) FROM support_faq_articles a JOIN nf_faq_lote l ON l.id = a.id) AS do_lote_no_banco_agora,
       (SELECT count(*) FROM support_faq_articles) AS artigos_no_banco_agora;

COMMIT;
