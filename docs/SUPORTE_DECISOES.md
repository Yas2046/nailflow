# Central de Suporte: decisões e limitações da V1

> Registro das decisões tomadas e das pendências. A Central **não está publicada**: depende das migrations 023/024
> (e do `GRANT` de [`_ops/023_grant_app_role.sql`](../backend/db/migrations/_ops/023_grant_app_role.sql)), de
> `SUPPORT_CENTER_ENABLED=true` e de reiniciar o backend. Contratos das rotas: [`ROTAS_E_ENDPOINTS.md`](./ROTAS_E_ENDPOINTS.md).
> Roteiro de publicação e rollback: [`SUPORTE_PUBLICACAO.md`](./SUPORTE_PUBLICACAO.md). Backups:
> [`SUPORTE_BACKUPS_PROPOSTA.md`](./SUPORTE_BACKUPS_PROPOSTA.md).

## Decididas

| Tema | Decisão |
|---|---|
| Limite de solicitações abertas | **10 por profissional**, valendo na **criação e na reabertura** pela profissional (409 `too_many_open`). Criar e reabrir concorrentes são serializados pelo mesmo lock (`pg_advisory_xact_lock` por profissional); a recusa acontece antes de qualquer escrita. A reabertura pela ADM não é limitada. |
| Termos de prioridade | Os da especificação, versionados em `backend/src/utils/supportPriority.js` (termos de "alta" só contam na categoria Técnico, exceto "urgente"). Sem termos novos. |
| "Lido" da ADM | **Compartilhado** entre administradoras (`admin_read_seq` por solicitação): se uma abre, fica lida para todas. Aceito na V1 (há uma ADM). |
| Retenção (aprovada como base em 2026-10-13; detalhes em [`SUPORTE_PRIVACIDADE_RETENCAO.md`](./SUPORTE_PRIVACIDADE_RETENCAO.md)) | **Chamados abertos:** sem expiração automática. **Chamados resolvidos:** 6 meses depois da **última** resolução, depois apagados por inteiro (mensagens e eventos junto) por rotina testada em banco descartável, **ainda não agendada nem ativa em produção**. **Reabertura pela profissional:** 7 dias, como já implementado. **Snapshots de exclusão:** 30 dias (preparado no código; a limpeza por tempo existe como script, ainda não agendada). **Dumps:** 7 dias (cron). **Auditoria:** 12 meses identificável e até 36 meses no total, **implementada mas desligada**: a ativação depende da validação de privacidade. **Logs do PM2:** rotação de 14 dias **preparada, não instalada**. Ao excluir a conta, as conversas vão junto (a exclusão aborta com 409 se houver atividade nova depois do snapshot). Até a publicação, o que está em produção continua sendo a regra antiga (sem rotina de chamados; snapshots de 90 dias podados só a cada nova exclusão). |
| Contas administradoras | Não abrem solicitações (403 em `/support/*`); atendem por `/admin/support`. |

## O que bloqueia a V1

Só duas coisas impedem **ligar** a Central para as profissionais. O restante pode ser decidido depois, com a Central
no ar, sem retrabalho de código.

1. **Aviso de privacidade exibido no formulário** (decisão de 2026-10-16: a Central pode ser ligada **sem** publicar a política
   de privacidade). A tela de nova solicitação passa a mostrar `SupportPrivacyNotice` (texto em
   `frontend/src/content/avisoPrivacidade.ts`): texto curto e factual mais o contato de privacidade, **sem link para a política**
   enquanto ela não estiver publicada (`POLICY_PAGE_PUBLISHED = false`). O aviso antigo ("mantidas conforme a política de
   privacidade do NailFlow") afirmava uma política que não está publicada e **não pode ficar no ar** com a Central ligada; o texto
   novo **não promete exclusão definitiva nem prazo que o sistema não garanta**. A política de privacidade (página `/privacidade`,
   links de rodapé, documentos de LGPD) é outra frente, **futura e separada**: continua em rascunho, com pendências (revisão
   jurídica, vigência, região do servidor, base legal, transferência internacional), e tem a sua própria trava
   (`PRIVACY_RELEASE_CHECK=1`), que **não** bloqueia ligar a Central. O texto proposto antigo em `SUPORTE_PRIVACIDADE_RETENCAO.md`
   está superado. As conversas
   ficam até 6 meses depois da resolução (rotina ainda não ativa), com cópia em snapshot de exclusão (30 dias, quando
   a limpeza por tempo estiver agendada) e em dumps (7 dias).
2. **Aplicar o `GRANT` depois da 023** (obrigação operacional, não decisão). A 023 não concede acesso à role da
   aplicação; em produção ela precisa rodar como `postgres`. Sem o `GRANT`, toda operação falha com
   `permission denied` (reproduzido em banco descartável). Está no checklist de publicação, seção 3.

A correção de permissões dos backups, que era recomendada antes ou logo depois de ligar, **foi executada em
2026-10-13** (detalhes, validações e pendências em [`SUPORTE_BACKUPS_PROPOSTA.md`](./SUPORTE_BACKUPS_PROPOSTA.md),
seção 0): script novo instalado, `/var/backups/nailflow` e `manual/` em `700 root:root` e `backup.log` em
`600 root:root`; só o `root` acessa os backups. Não bloqueia ligar a Central, mas há pendências que continuam
abertas (abaixo, item 4) e um efeito operacional: backups manuais e restaurações passam a seguir o procedimento
compatível com o diretório em 700.

## Pendentes que NÃO bloqueiam (precisam de decisão)

1. **Chamados resolvidos: 6 meses** (decisão tomada em 2026-10-13; substitui a proposta de 12 meses). A rotina
   `backend/db/migrations/_ops/support_retention.sql` está pronta e testada em banco descartável, mas **não está
   agendada**: precisa de autorização para o cron do sistema e deve estar ativa antes do primeiro vencimento (6 meses
   depois de a Central ser ligada). Até lá as mensagens ficam enquanto a conta existir.
2. **`admin_audit_log`:** política aprovada como base (12 meses identificável; `actor_email` e `target_business_name`
   viram `[anonimizado]`; apagada com mais de 36 meses). **Implementada e desligada por padrão**
   (`-v audit_enabled=on`): ligar só depois da validação de privacidade. A auditoria não grava texto de mensagem nem
   assunto. Está ligada ao rollback da 024, que aborta se houver auditoria com as ações novas.
3. **Snapshots de exclusão (30 dias):** o código e o script `backend/scripts/prune-deleted-snapshots.js` estão
   prontos (simulação por padrão), mas **falta agendar a limpeza por tempo** (cron do sistema, com autorização) e
   verificar os snapshots existentes. O diretório real tem **563** (29/09 a 11/10/2026; leitura de 2026-10-13):
   **42** estão listados como de teste em `/root/etapa13_snapshots_para_limpeza.txt` e a origem dos outros **521**
   não foi verificada. **Nenhum foi apagado nem alterado**; a limpeza depende de conferir a origem e que nenhuma
   exclusão real ocorreu nas janelas de teste. Até lá, listar **todos** os nomes existentes em
   `<diretório>/.retention-hold` os protege (comando em `ops/README.md`, testado). **Atenção na publicação:** o
   novo prazo (30 dias) vale também para a poda a cada exclusão de conta, e o snapshot mais antigo completa 30 dias
   em 29/10/2026; sem o `.retention-hold`, a primeira exclusão real depois do deploy removeria os snapshots com mais
   de 30 dias.
4. **Correção dos backups: executada em 2026-10-13; pendências restantes** (ver
   [`SUPORTE_BACKUPS_PROPOSTA.md`](./SUPORTE_BACKUPS_PROPOSTA.md), seção 0):
   - **executado e validado por leitura:** script novo instalado (SHA-256 `d450310b…a1b9`), diretório e `manual/`
     em `700 root:root`, `backup.log` em `600 root:root`, fases B, C, D e E concluídas, verificação final sem
     divergências;
   - **pendente:** primeira execução noturna com retenção normal (cron de 2026-10-14, 03:00); **restauração real
     não ensaiada neste servidor** (só no cluster descartável, em 2026-10-11); atualizar `docs/INFRAESTRUTURA.md`;
     dono e modo dos 9 dumps antigos (seguem `664 postgres:postgres`, dentro do diretório 700);
   - **guarda de cópias de dumps** (`/root/backup-fix-20261012-234847/guarda/`, `700 root:root`, dados pessoais):
     decidido manter por **no máximo 24 horas depois do `T2.ok`** (2026-10-13 19:45:46, ou seja, até 2026-10-14
     19:45); a remoção **não foi feita** e exige autorização separada, com conferência dos hashes.

## Limitações aceitas na V1

- **"Lido" da ADM compartilhado** entre administradoras (decisão acima).
- **Sem exclusão de solicitação, mensagem ou artigo** pela API (despublicar cobre a FAQ); apagar só pela exclusão da
  conta, que gera snapshot.
- **Prioridade sugerida por termos fixos**; a ADM ajusta manualmente e o ajuste manual prevalece. Sem termos novos.
- **Sem notificação externa** (e-mail/WhatsApp) de resposta: a profissional vê o contador ao abrir o sistema
  (atualização a cada 60 s com a aba visível).
- **Sem anexos** e sem edição de mensagens (a tabela é imutável por gatilho).
- **Reabertura pela profissional só em 7 × 24 h**, medidos com o relógio do banco, e respeita o limite de 10 abertas.
- **Limitadores por conta** (criação 5/h; mensagens 30/10 min; ADM 300 leituras e 60 escritas / 5 min).
- Os dados de suporte aparecem nos **dumps diários** (retenção de 7 dias) e nos snapshots de exclusão (30 dias na
  política nova; 90 dias enquanto o código antigo estiver em produção; modo 600).

## Achados da revisão final (2026-10-11)

| Gravidade | Achado | Situação |
|---|---|---|
| Alta (publicação) | A 023 não concede acesso à role da aplicação; em produção as tabelas novas nasceriam do `postgres` e toda a Central falharia com 42501. Não aparecia nos testes porque neles a mesma role cria e usa as tabelas. | Script `_ops/023_grant_app_role.sql` (privilégios mínimos, com verificação final) e etapa obrigatória no checklist. Validado com a divisão de donos de produção reproduzida em banco descartável. |
| Baixa | JSON malformado em qualquer rota (inclusive as de suporte) fazia o `errorHandler` global registrar o erro inteiro, e o body-parser anexa o corpo bruto: texto de mensagem apareceria nos logs do PM2. | Corrigido (`errorHandler` omite o corpo desse erro) com teste de regressão `tests/error-handler-log.test.js`. |
| Informativo | Backups: permissões 777/664, `set -e` tornando o ramo de erro inalcançável, dump parcial possível, sem verificação. | Proposta em `SUPORTE_BACKUPS_PROPOSTA.md`; **executada em 2026-10-13** (seção 0 daquele documento, com as pendências). |
| Informativo | `frontend/src` de produção está desatualizado em relação ao commit base (o `dist` foi construído fora de lá). | Checklist manda construir em pasta temporária. |
| Informativo | 9 testes antigos falham no commit-base e continuam falhando (esperam `token` no corpo do login, que hoje só vai no cookie): `auth-flow` (2), `availability-check` (1), `price-snapshot` (6). Não são regressão desta entrega. | Registrado; fora do escopo. |

Revisão sem achados nas demais áreas percorridas pelo código: autenticação/autorização (`requireAuth`/`requireAdmin`
leem `is_admin` e bloqueio do banco a cada requisição; `/support` exclui administradoras), isolamento (toda consulta
filtra `professional_id` da sessão e o 404 é o mesmo para inexistente e de outra conta), SQL parametrizado (os únicos
valores interpolados são constantes do código), transações e locks (ordem advisory → solicitação, sem ciclo com a
exclusão de conta, que trava solicitações → conta), idempotência (`request_hash` com `ON CONFLICT` de alvo
explícito), cursores de leitura monotônicos, auditoria na mesma transação, e a Central desligada (404 antes da
autenticação, bootstrap `enabled:false`, polling parado).
