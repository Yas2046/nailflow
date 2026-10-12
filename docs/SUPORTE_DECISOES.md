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
| Retenção | **Sem exclusão automática nesta fase.** Nenhuma rotina apaga solicitações resolvidas; elas permanecem enquanto a conta existir. Não há cron de limpeza. Ao excluir a conta, as conversas vão junto (snapshot de 90 dias incluído; a exclusão aborta com 409 se houver atividade nova depois do snapshot). |
| Contas administradoras | Não abrem solicitações (403 em `/support/*`); atendem por `/admin/support`. |

## O que bloqueia a V1

Só duas coisas impedem **ligar** a Central para as profissionais. O restante pode ser decidido depois, com a Central
no ar, sem retrabalho de código.

1. **Texto de privacidade/retenção exibido ao usuário** (revisão jurídica). A tela de nova solicitação mostra
   `PRIVACY_NOTICE` (`frontend/src/services/support.ts`), que remete à "política de privacidade do NailFlow". É
   preciso confirmar que essa política existe e é a que vale, e **não prometer exclusão definitiva nem prazo**: as
   conversas ficam enquanto a conta existir, há cópia em snapshot de exclusão (90 dias) e em dumps (7 dias).
2. **Aplicar o `GRANT` depois da 023** (obrigação operacional, não decisão). A 023 não concede acesso à role da
   aplicação; em produção ela precisa rodar como `postgres`. Sem o `GRANT`, toda operação falha com
   `permission denied` (reproduzido em banco descartável). Está no checklist de publicação, seção 3.

Recomendado **antes ou logo depois** de ligar (não bloqueia): a correção de permissões dos backups
([proposta](./SUPORTE_BACKUPS_PROPOSTA.md)); os dumps já têm dados pessoais e hash de senha com as mesmas
permissões, e a Central só acrescenta texto de mensagens.

## Pendentes que NÃO bloqueiam (precisam de decisão)

1. **Prazo de retenção** das solicitações resolvidas em contas ativas (proposta: 12 meses, com rotina própria,
   revisada e aprovada). Enquanto não houver, as mensagens ficam indefinidamente (decisão vigente).
2. **Política do `admin_audit_log`**: prazo e anonimização do `target_business_name` após a exclusão da conta (hoje
   indefinido e sem FK). A auditoria não grava texto de mensagem nem assunto. Está ligada ao rollback da 024, que
   aborta se houver auditoria com as ações novas.
3. **Poda dos snapshots de exclusão**: hoje só roda quando há nova exclusão; para garantir 90 dias, precisa de rotina
   por tempo. Os 42 snapshots gerados por testes antigos continuam no diretório real (lista em
   `/root/etapa13_snapshots_para_limpeza.txt` no servidor); **não foram apagados**, e a limpeza depende de conferir
   que nenhuma exclusão real ocorreu nas janelas de teste.
4. **Execução da correção de permissões dos backups** (proposta pronta, sem execução).

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
- Os dados de suporte aparecem nos **dumps diários** (retenção de 7 dias) e nos snapshots de exclusão (90 dias,
  modo 600).

## Achados da revisão final (2026-10-11)

| Gravidade | Achado | Situação |
|---|---|---|
| Alta (publicação) | A 023 não concede acesso à role da aplicação; em produção as tabelas novas nasceriam do `postgres` e toda a Central falharia com 42501. Não aparecia nos testes porque neles a mesma role cria e usa as tabelas. | Script `_ops/023_grant_app_role.sql` (privilégios mínimos, com verificação final) e etapa obrigatória no checklist. Validado com a divisão de donos de produção reproduzida em banco descartável. |
| Baixa | JSON malformado em qualquer rota (inclusive as de suporte) fazia o `errorHandler` global registrar o erro inteiro, e o body-parser anexa o corpo bruto: texto de mensagem apareceria nos logs do PM2. | Corrigido (`errorHandler` omite o corpo desse erro) com teste de regressão `tests/error-handler-log.test.js`. |
| Informativo | Backups: permissões 777/664, `set -e` tornando o ramo de erro inalcançável, dump parcial possível, sem verificação. | Proposta em `SUPORTE_BACKUPS_PROPOSTA.md`; nada executado. |
| Informativo | `frontend/src` de produção está desatualizado em relação ao commit base (o `dist` foi construído fora de lá). | Checklist manda construir em pasta temporária. |
| Informativo | 9 testes antigos falham no commit-base e continuam falhando (esperam `token` no corpo do login, que hoje só vai no cookie): `auth-flow` (2), `availability-check` (1), `price-snapshot` (6). Não são regressão desta entrega. | Registrado; fora do escopo. |

Revisão sem achados nas demais áreas percorridas pelo código: autenticação/autorização (`requireAuth`/`requireAdmin`
leem `is_admin` e bloqueio do banco a cada requisição; `/support` exclui administradoras), isolamento (toda consulta
filtra `professional_id` da sessão e o 404 é o mesmo para inexistente e de outra conta), SQL parametrizado (os únicos
valores interpolados são constantes do código), transações e locks (ordem advisory → solicitação, sem ciclo com a
exclusão de conta, que trava solicitações → conta), idempotência (`request_hash` com `ON CONFLICT` de alvo
explícito), cursores de leitura monotônicos, auditoria na mesma transação, e a Central desligada (404 antes da
autenticação, bootstrap `enabled:false`, polling parado).
