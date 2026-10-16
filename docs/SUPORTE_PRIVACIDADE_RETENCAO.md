# Central de Suporte: privacidade e retenção de dados

> **Status (2026-10-13): política aprovada como BASE para implementação, com limites. Nada disto foi aplicado em
> produção.** O código e as rotinas existem só neste repositório, testados em banco descartável. Prazos são decisões
> operacionais do projeto, **não obrigações legais confirmadas**: base legal, prazos mínimos ou máximos e direitos
> dos titulares exigem validação de privacidade/jurídico (seção 5). O texto do aviso (seção 4) é um **rascunho**.

## 1. Política (o que foi decidido e o estado de cada item)

| Dado | Regra aprovada | Implementação | Estado |
|---|---|---|---|
| Chamados abertos (e suas mensagens e eventos) | sem expiração automática | nenhuma rotina os toca | em vigor |
| Chamados resolvidos | **6 meses** depois da **última** resolução, depois **apagados por inteiro** (mensagens e eventos em cascata) | `backend/db/migrations/_ops/support_retention.sql` (padrão `tickets_months=6`, mínimo 1) | pronta e testada; **não agendada** |
| Reabertura pela profissional | **7 dias** depois da resolução (a ADM reabre a qualquer momento) | já implementada (`supportStateMachine.js`) | em vigor |
| Depois do prazo | o chamado deixa de existir; a profissional abre um novo | idem rotina de chamados | com a rotina |
| Auditoria administrativa | **12 meses** identificável; depois `actor_email` e `target_business_name` viram `[anonimizado]` (ação, data e ids ficam); **apagada com mais de 36 meses** | mesma rotina, com `-v audit_enabled=on` | implementada e **desligada**: ativar só após validação de privacidade |
| Snapshots de exclusão de conta | **30 dias**, com limpeza por tempo garantida por rotina agendada | `backend/src/utils/snapshotRetention.js` (também usada a cada exclusão) e `backend/scripts/prune-deleted-snapshots.js` | código pronto; **limpeza não agendada**; os 563 snapshots existentes (42 de teste identificados, 521 sem origem verificada) **não foram tocados** |
| Backups do banco | **7 dias** (cron); sem exclusão seletiva; nenhuma restauração nem remoção da guarda sem autorização específica | cron já ativo | em vigor |
| Logs do PM2 | rotação de **14 dias** | `ops/logrotate/nailflow-pm2` | preparada; **não instalada** |
| Logs de erro do backend | sem mensagem, DETAIL nem corpo da requisição; só tipo, códigos e pilha | `backend/src/middleware/errorHandler.js` | pronto (vale após o deploy) |
| FAQ | conteúdo institucional, sem dado pessoal (só ids de autor, `SET NULL`); sem prazo | nenhuma | em vigor |

**Regra após restaurar qualquer backup:** reaplicar as exclusões feitas depois da data do backup (contas excluídas,
chamados vencidos), usando as linhas `delete` da auditoria e as rotinas acima, para não ressuscitar dado apagado. É
um procedimento do runbook de restauração, sem código.

## 2. O que cada categoria contém e quem acessa

| Categoria | Dados pessoais | Acesso |
|---|---|---|
| Chamados, mensagens, eventos | assunto e texto livre (até 120 e 5000 caracteres) podem trazer dados da profissional ou de terceiros; ids de autor | a própria profissional (404 para outras), as administradoras, `postgres`/`nailflow` no banco |
| Auditoria | `actor_email`, `actor_id`, `target_id`, `target_business_name`, ação, data; **sem** texto de mensagem | administradoras (página de auditoria) e acesso ao banco |
| Snapshots | linha da profissional (sem hash de senha), clientes finais, agendamentos, histórico de mensagens e dados de suporte | só `root` (arquivo 600, diretório 700) |
| Dumps diários | o banco inteiro, inclusive hashes de senha | só `root` (diretório 700) |
| Logs | não incluem texto de mensagens do suporte; o nginx guarda IP e URL por 14 dias | `root` |

## 3. Como a retenção funciona e como testar

- **Chamados:** `sudo -u postgres psql -d nailflow -X -v ON_ERROR_STOP=1 -f backend/db/migrations/_ops/support_retention.sql`
  (conferir `SELECT current_database();` antes). Imprime só contagens, roda numa transação com `lock_timeout` de 5 s e
  **valida os parâmetros antes de apagar** (`tickets_months` inteiro ≥ 1; `audit_enabled` só `on/off/true/false/1/0`).
  Chamados abertos, em atendimento ou aguardando nunca são tocados; um chamado reaberto e resolvido de novo conta a
  partir da última resolução. **Rodar como `postgres`** (dono das tabelas em produção): a role da aplicação
  (`nailflow`) não tem `DELETE` nas tabelas de suporte e a rotina falha com `permission denied` **sem alterar nada**
  (verificado em banco descartável com a mesma configuração de donos e `GRANT` de produção).
- **Snapshots:** `node backend/scripts/prune-deleted-snapshots.js` é **simulação** (nada removido, só contagens);
  `--apply` remove; `--list` mostra nomes; `--days` ajusta o prazo. Só toca arquivos com o nome exato
  `professional_<uuid>_<timestamp>.json` (nunca links, subdiretórios ou outros nomes) e respeita
  `<diretório>/.retention-hold` (um nome por linha) para proteger arquivos até verificar a origem.
- **Logs:** `ops/logrotate/nailflow-pm2` (instalar só com autorização; simulação: `logrotate -d -s /tmp/lr.state <arquivo>`).
- **Agendamento:** modelo em `ops/cron/support-retention.cron.example` (não instalado).
- **Testes** (banco descartável com marcador; rodar uma suíte de banco por vez): `backend/tests/support-retention.test.js`
  (chamados e auditoria), `backend/tests/snapshot-retention.test.js` (snapshots e script, sem banco) e
  `backend/tests/error-handler-log.test.js` (logs).

## 4. Aviso de privacidade (rascunho; a proposta antiga abaixo foi substituída)

> **Texto atual (na branch de desenvolvimento `feat/suporte-aviso-privacidade`, ainda não publicado em produção; não aprovado
> juridicamente):** o aviso do formulário é o componente
> `SupportPrivacyNotice`, com o texto em `frontend/src/content/avisoPrivacidade.ts` (módulo mínimo, que não leva a política ao
> bundle). Ele mostra o contato de privacidade e **não linka a política** enquanto `POLICY_PAGE_PUBLISHED` for `false`; o link só
> pode ser habilitado quando a página `/privacidade`, a rota e a política estiverem prontas (guarda executável em
> `frontend/tests/support-notice.test.mjs`). Não cita prazos, não pede aceite e só mostra contato quando houver um informado. A
> política de privacidade completa é uma publicação futura e separada, com a sua trava. Registros técnicos (backend e n8n)
> podem conter telefones e mensagens e não têm retenção.
>
> **A proposta a seguir é anterior e está superada.** Os valores entre colchetes (6, 12, 30, 36 meses) são hipóteses, não
> decisões nem rotinas em funcionamento; não podem ser prometidos ao usuário enquanto a rotina correspondente não existir.

> Colchetes = valores ou informações **ainda não confirmados**. Não publicar sem a revisão de privacidade/jurídico, a
> confirmação de que a política referenciada existe e o contato do responsável. O sistema só pode prometer o que as
> rotinas da seção 1 garantirem (chamados e snapshots só depois de agendadas).
>
> **Como usamos o que você envia à Central de Suporte.** Usamos o assunto e as mensagens do seu chamado para atender
> o seu pedido e melhorar a ajuda do sistema. Evite incluir senhas, dados de cartão ou dados pessoais de clientes que
> não sejam necessários.
>
> **Quem acessa.** Você e a equipe de suporte do NailFlow; a equipe técnica pode acessar os dados para manter o sistema.
>
> **Por quanto tempo.** Chamados abertos ficam até serem resolvidos. Chamados resolvidos ficam **[6 meses]** depois
> da resolução e depois são apagados.
>
> **Se você excluir a conta,** os chamados são removidos do sistema, mas cópias de segurança podem conservá-los por até
> **[30 dias]** (recuperação de exclusão) e **7 dias** (backups diários), com acesso restrito.
>
> **Registros da equipe.** Guardamos o registro das ações da equipe de suporte por até **[36 meses]**, sem o texto das
> mensagens; depois de **[12 meses]** o e-mail e o nome do negócio deixam de ser identificáveis.
>
> **Seus direitos e contato.** **[contato do responsável e como pedir acesso ou exclusão: a confirmar]**. Consulte também
> a política de privacidade do NailFlow **[confirmar que existe, o endereço e que este texto é compatível com ela]**.

## 5. O que exige validação de privacidade/jurídico (não decidido aqui)

Base legal e finalidade; adequação dos prazos (inclusive o da auditoria); identificação do controlador e contato;
direitos do titular e o canal para exercê-los; tratamento dos dados de **clientes finais** presentes nos snapshots;
se a localização do servidor (fuso `Europe/Berlin`; não confirmada) implica alguma exigência; e o texto final do aviso.

## 6. O que ainda bloqueia a publicação

1. **Aviso de privacidade definitivo** (contato, política referenciada, base legal): bloqueia **ligar** a Central.
2. **Snapshots:** proteger **todos os 563 existentes** com `.retention-hold` (comando em `ops/README.md`) até a
   origem de cada grupo ser verificada (42 identificados como de teste; 521 sem verificação) e **agendar a limpeza
   por tempo antes do deploy** do código com 30 dias (a poda a cada exclusão passa a usar 30 dias; o mais antigo
   completa 30 dias em 29/10/2026).
3. **Agendamento** (cron do sistema, com autorização): rotina de chamados (antes do primeiro vencimento, 6 meses
   depois de ligar), limpeza de snapshots e, quando aprovada, a da auditoria; rotação de logs do PM2.
4. **Auditoria:** ativação condicionada à validação de privacidade.
5. Itens já registrados em outros documentos: `GRANT` da 023, primeira noite do script de backup, restauração real
   ainda não ensaiada, remoção da guarda (autorização separada) e atualização de `docs/INFRAESTRUTURA.md`.
6. Atualizar na publicação os documentos históricos que ainda descrevem snapshots de 90 dias
   (`docs/PENDENCIAS.md`, `docs/STATUS_ATUAL.md`, `docs/CHECKLIST_PROJETO.md`): descrevem o código em produção hoje.
