# Rollbacks manuais (NÃO fazem parte da instalação)

Esta pasta guarda os scripts para **desfazer** migrations. Eles **não são executados** por nenhum
processo: a instalação segue o padrão do projeto (`psql -f` de cada migration em
`backend/db/migrations/NNN_*.sql`, que não é recursivo). Não use `find`/`for` recursivo sobre
`db/migrations` para aplicar migrations: executaria estes arquivos.

Não existe, no projeto, rollback para as migrations anteriores à 023. Convenção adotada aqui, seguindo a
pasta `_historico/`: subpasta com prefixo `_` + este README; arquivos `NNN_nome.down.sql`.

| Arquivo | Desfaz | Destrutivo? |
|---|---|---|
| `032_reminder_attempts.down.sql` | remove `reminder_attempts` | Apaga só o registro de tentativas de lembrete. Reverta o código antes (as rotas `/bot/reminders/*` dependem da tabela). |
| `031_retorno_vitrine.down.sql` | remove `portfolio_photos` e as colunas `return_interval_days`, `contact_opt_out`, `return_snoozed_until` e `instagram` | **Sim, sem aviso:** apaga as fotos da vitrine e as preferências de contato/intervalos gravados. Faça `pg_dump` antes. |
| `030_password_reset_tokens.down.sql` | remove `password_reset_tokens` | Apaga só links de redefinição (de uso único e curta duração). |
| `027_financeiro_limites_banco.down.sql` | remove os dois gatilhos da 027 (teto de recebimento e piso do valor) e suas funções | Não toca em dados nem na 025/026; idempotente. O rollback da 025 também os remove (dependem das colunas dela) |
| `028_financeiro_despesas.down.sql` | remove `expense_payments`, seus gatilhos/funções, a UNIQUE de `expenses` e devolve as listas de `financial_audit_log` às da 025 | **Aborta** se existir pagamento de despesa ou histórico de pagamento de despesa (append-only); sem uso, idempotente. Deve ser aplicado **antes** do rollback da 025, que aborta com a 028 aplicada |
| `029_financeiro_fechamento_caixa.down.sql` | remove `cash_closing_entries`, o gatilho/função e a UNIQUE de `cash_closings`; restaura `fin_day_is_closed` ao corpo da 025 | **Aborta** se existir lançamento de fechamento por método (append-only). Deve ser aplicado **antes** dos rollbacks da 028 e da 025, que abortam com a 029 aplicada |
| `026_financeiro_pagamentos_metodo.down.sql` | volta `financial_payments_method_check` à lista da 025 (sem `transferencia`) | Não apaga dados: **aborta** se já houver movimentação por `transferencia` (append-only); então deixe a 026 aplicada |
| `025_financeiro_base.down.sql` | remove `financial_payments`, `financial_audit_log`, `cash_closings`, as funções `fin_*` e as colunas novas de `appointments` e `expenses` | **Só sem uso.** Com dados financeiros em uso **aborta**; com a autorização, **arquiva tudo num schema `financeiro_arquivo_*` antes de remover** |
| `024_audit_actions_support.down.sql` | volta o CHECK de `admin_audit_log.action` às 4 ações originais | Não apaga dados, mas **aborta** se já houver auditoria com as ações novas |
| `023_support_center.down.sql` | remove as 5 tabelas `support_*`, as 5 funções e `professionals.support_fab_hidden` | **Sim, irreversível** |

## Ordem de reversão

1. Desligue o código de suporte (flag `SUPPORT_CENTER_ENABLED`, quando existir) e confirme que nada escreve nas tabelas.
2. Faça **backup** do banco (`pg_dump`) e confirme que o arquivo existe e tem tamanho plausível.
3. Reverta **primeiro a 024**, depois a **023**. (As duas são independentes entre si, mas esta ordem desfaz o
   mais novo primeiro e evita que o código de auditoria de suporte tente gravar ações que já não são aceitas.)
   Se a 024 **abortar** por haver auditoria com as ações novas, **pare e siga a seção "Se o rollback 024
   abortar"**; a 023 não depende dela e pode ser revertida separadamente, se for o caso.
4. Reverta o código da API/frontend, se ainda estiver publicado.

## Como executar

Sempre com `ON_ERROR_STOP` e em uma sessão que você conferiu ser a do banco certo
(`SELECT current_database();`).

```bash
# 024: sem dados de suporte na auditoria roda direto
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/_rollback/024_audit_actions_support.down.sql

# 023: com dados de suporte, exige autorização explícita NA MESMA sessão
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -c "SET support.confirm_destructive_rollback = 'DESTRUIR-DADOS-DE-SUPORTE'" \
  -f db/migrations/_rollback/023_support_center.down.sql
```

Sem a autorização e havendo dados, o script de 023 aborta mostrando as contagens (solicitações, mensagens,
eventos, artigos de FAQ e preferências do botão) e **não apaga nada**. A autorização é uma trava contra
acidente, não um controle de acesso.

O script de 023 **bloqueia** as tabelas de suporte e `professionals` (`ACCESS EXCLUSIVE`) **antes** de contar
os dados e segura o bloqueio até o `COMMIT`. Sem isso, um insert concorrente poderia confirmar entre a
contagem e o `DROP` e ser destruído sem passar pela autorização. **Pare a API antes de executar.** Se o
bloqueio não sair em 3 s (ou houver deadlock) o script aborta com `rollback 023 abortado: não foi possível
bloquear as tabelas de suporte ...` e **não apaga nada**, mesmo com a autorização: espere as transações
terminarem e repita. Um insert que ficou esperando o bloqueio falha depois com `relation ... does not exist`.

## Se o rollback 024 abortar

A mensagem `rollback 024 abortado: N registro(s) de auditoria com ações de suporte/FAQ` significa que
`admin_audit_log` já contém registros com `faq_*` ou `support_*`. O script **não apagou nada e não alterou a
constraint**: é a proteção funcionando.

**Não contorne a proteção.** Não apague nem edite linhas de `admin_audit_log` e não derrube nem recrie
`admin_audit_log_action_check` à mão. A auditoria é o registro de responsabilização das ações
administrativas; apagá-la esconde ações reais, e uma constraint recriada manualmente deixa o banco em estado
que a 024 e este rollback já não reconhecem (os dois abortam se a constraint não for a esperada).

Procedimento seguro:

1. **Pergunte se reverter a 024 é realmente necessário.** Ela é aditiva: manter a constraint com as 10 ações
   não quebra nada. O padrão recomendado é **deixá-la aplicada** e reverter só o código e, se preciso, a 023.
2. **A 023 pode ser revertida sozinha.** Não depende da 024, e `admin_audit_log` não tem chave estrangeira
   para as tabelas de suporte (`target_id` é só um `uuid`), então esses registros permanecem como histórico.
3. **Só considere reverter a 024 com todas as condições abaixo atendidas:**
   * backup do banco recente e verificado;
   * código de suporte desligado (nada grava ações novas);
   * levantamento somente leitura do que existe:
     ```sql
     SELECT action, count(*) FROM admin_audit_log
      WHERE action NOT IN ('block', 'unblock', 'update', 'delete')
      GROUP BY action ORDER BY action;
     ```
   * **decisão registrada do responsável** sobre o destino desses registros (preservar/arquivar, anonimizar
     ou excluir), conforme a política de retenção e privacidade da auditoria, que **ainda não está definida**.
4. Se a decisão for alterar ou remover registros de auditoria, isso exige uma migration ou procedimento
   **próprio, revisado e aprovado**, com backup e registro. **Este script não faz isso e não deve ser
   adaptado para fazê-lo.**

Enquanto não houver essa decisão, deixe a 024 aplicada.

## Riscos

* **023 apaga conversas de suporte e artigos de FAQ definitivamente.** Os dados só voltam do backup.
* **024** não consegue reverter enquanto existir auditoria com `faq_*`/`support_*`; não há remoção automática
  desses registros (a auditoria não é apagada pelo rollback).
* Ambos pedem locks fortes (`professionals`, `admin_audit_log`, tabelas de suporte) e usam
  `lock_timeout = 3s`: se houver transação longa em andamento, abortam em vez de formar fila. Repita em
  horário calmo.
* O rollback 023 bloqueia `professionals` (e o `DROP COLUMN` exige lock exclusivo) até o `COMMIT`: durante a
  execução, que é curta, nenhuma requisição autenticada que leia `professionals` é atendida.
* Reaplicar a 023 depois do rollback recria tudo vazio (as 6 categorias voltam pelo seed).

## Rollback da 025 (Financeiro, etapa 1)

A 025 só **adiciona** estrutura; nunca altera linhas existentes. O rollback remove o que ela criou, e **não apaga
movimentação financeira em silêncio**. Visão completa (aplicação, grants, restauração e retenção):
[`docs/FINANCEIRO_ETAPA1.md`](../../../../docs/FINANCEIRO_ETAPA1.md).

| Situação | O que o script faz |
|---|---|
| Nada em uso (tabelas novas vazias, colunas novas NULL, despesas ainda `a_revisar` sem datas) | Remove a estrutura. Não exige autorização e não cria arquivo |
| Há dados financeiros e **não** há autorização | **Aborta** mostrando as contagens (movimentações, histórico, fechamentos, atendimentos e despesas com dados novos). Nada é alterado |
| Há dados financeiros e há autorização na mesma sessão | **Copia tudo** para o schema `financeiro_arquivo_AAAAMMDD_HH24MISS`, confere contagem **e hash** de cada tabela contra a origem, grava o manifesto (`<schema>._manifest`) e só então remove a estrutura |

```bash
# 1. Pare a API. 2. Backup (pg_dump) e confirmação do arquivo. 3. Confira o banco: SELECT current_database();
# Sem uso financeiro:
sudo -u postgres psql -d nailflow -X -v ON_ERROR_STOP=1 -f backend/db/migrations/_rollback/025_financeiro_base.down.sql

# Com dados financeiros em uso (arquiva antes de remover):
sudo -u postgres psql -d nailflow -X -v ON_ERROR_STOP=1 \
  -c "SET financeiro.confirm_destructive_rollback = 'ARQUIVAR-E-REMOVER-DADOS-FINANCEIROS'" \
  -f backend/db/migrations/_rollback/025_financeiro_base.down.sql
```

**O que o arquivo contém:** `financial_payments`, `financial_audit_log` e `cash_closings` inteiras; `appointments_financeiro`
(id e as 5 colunas novas, só das linhas que tinham dados) e `expenses_financeiro` (id e as 4 colunas novas, só das linhas que
saíram do estado padrão); e `_manifest` (contagem e md5 do JSON de cada linha, em UTC, por tabela). Os dados **anteriores** à
025 (agendamentos, sinais Pix, despesas, valores e datas) nunca são tocados.

**Recuperação:** reaplique a 025 e rode `_ops/025_restore_from_archive.sql`
([`_ops/README.md`](../_ops/README.md)): ele valida o arquivo contra o manifesto, devolve **todas as colunas** e confere os hashes
de novo antes de confirmar. Reaplicar a 025 sozinho **não** reimporta o arquivo. Depois, rode `_ops/025_grant_app_role.sql`
(os grants somem com as tabelas removidas).

**Exclusão de conta × schema de arquivo** (medido em teste, `financeiro-delete.test.js` e `financeiro-restore.test.js`):

* A exclusão de uma profissional **não apaga** os dados dela no schema de arquivo (as cópias não têm chave estrangeira). Eles permanecem, em
  todas as cinco tabelas, até o descarte manual do schema.
* O snapshot administrativo da exclusão **não contém** dados financeiros se, naquele momento, a estrutura não existe (depois do rollback): só o
  arquivo e os backups os guardam.
* A restauração **padrão aborta** se há dados de conta excluída no arquivo (nada é gravado). Para restaurar as contas que existem e deixar o
  resto no arquivo, use `-v skip_deleted_accounts=on`; o arquivo nunca é alterado e a conta excluída não volta.
* Apagar só as linhas de uma conta dentro do arquivo **não é suportado** (invalidaria o manifesto): o descarte é do schema inteiro, depois de
  restaurar ou exportar o que for preciso e conforme a política de retenção.

**Limites e cuidados**

* O schema de arquivo **não é apagado** pelo script: descartá-lo é decisão humana posterior. Ele **não** é podado por nenhuma
  rotina, **não** depende do snapshot administrativo de 30 dias e **não** é apagado pela exclusão de uma conta (as cópias não têm
  chave estrangeira). Os **backups diários guardam só 7 dias**: para guardar o arquivo por mais tempo, exporte-o (ver
  [`docs/FINANCEIRO_ETAPA1.md`](../../../../docs/FINANCEIRO_ETAPA1.md), "Retenção").
* No schema de arquivo as cópias são tabelas comuns (sem chaves, índices, triggers nem grants; só o dono lê): perdem a proteção
  append-only.
* Dois rollbacks no mesmo segundo **não** reutilizam o mesmo schema (o segundo ganha o segundo seguinte).
* Trava as tabelas financeiras, `appointments` e `expenses` (`ACCESS EXCLUSIVE`) **antes** de contar e segura o bloqueio até o
  `COMMIT`; `lock_timeout = 3s`. **Pare a API antes de executar.** Sem o bloqueio, uma gravação concorrente poderia confirmar
  entre a contagem e a remoção.
* Se o código do Financeiro já estiver publicado, reverta **antes** o código (a API passaria a falhar sem as tabelas). Depois que
  houver uso real, o caminho seguro é **não** reverter a 025: corrigir para frente.
* Depois que o Gastos for usado em produção, o histórico (`financial_audit_log`) já terá linhas: o rollback "sem uso" deixa de ser
  possível e o caminho será sempre o do arquivamento, com a autorização.
* O rollback derruba `appointments_id_professional_id_key` (criada pela 025); ela só existe por causa da 025.
* Aplique e reverta como a **dona** das tabelas (em produção, `postgres`). Aplicada por outra role, as proteções por privilégio
  deixam de valer (o dono tem tudo) e o script de grants aborta.

**026 e o arquivo da 025:** o arquivo pode conter `transferencia`; para restaurar, reaplique a **025 e a 026** antes de rodar `_ops/025_restore_from_archive.sql` (sem a 026 a restauração aborta por inteiro). Ver [`docs/FINANCEIRO_ETAPA2.md`](../../../../docs/FINANCEIRO_ETAPA2.md).
