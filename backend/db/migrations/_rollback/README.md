# Rollbacks manuais (NÃO fazem parte da instalação)

Esta pasta guarda os scripts para **desfazer** migrations. Eles **não são executados** por nenhum
processo: a instalação segue o padrão do projeto (`psql -f` de cada migration em
`backend/db/migrations/NNN_*.sql`, que não é recursivo). Não use `find`/`for` recursivo sobre
`db/migrations` para aplicar migrations: executaria estes arquivos.

Não existe, no projeto, rollback para as migrations anteriores à 023. Convenção adotada aqui, seguindo a
pasta `_historico/`: subpasta com prefixo `_` + este README; arquivos `NNN_nome.down.sql`.

| Arquivo | Desfaz | Destrutivo? |
|---|---|---|
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
