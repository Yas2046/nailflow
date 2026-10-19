# Financeiro — etapa 3: Agenda, preço final e pagamentos

> **Estado (2026-10-19):** código na branch `feat/financeiro-base`, **sem commit**, **não aplicado em nenhum banco persistente nem em produção**. Continua dependendo das etapas 1 e 2
> ([`FINANCEIRO_ETAPA1.md`](./FINANCEIRO_ETAPA1.md), [`FINANCEIRO_ETAPA2.md`](./FINANCEIRO_ETAPA2.md)); a publicação segue sendo única. Sem frontend, despesas, contas a receber completas ou fechamento de caixa.

## 1. O que a etapa entrega

| Arquivo | Papel |
|---|---|
| `backend/src/utils/financeiroPrecoFinal.js` | Regras do preço final (validação, justificativa, piso) compartilhadas pela rota e pela Agenda |
| `backend/src/controllers/financeiroController.js`, `routes/financeiro.routes.js` | `PUT /financeiro/atendimentos/:id/preco-final`; o resumo passa a trazer `finalPriceCents` e `finalPriceHistory` |
| `backend/src/controllers/appointmentsController.js` | Finalização na Agenda: `PUT /appointments/:id` aceita `finalPriceCents` e `finalPriceReason`; o DTO traz `finalPriceCents` |
| `backend/src/utils/financeiroPagamentos.js` | `FinanceError` compartilhado (movido do controller) |
| `backend/db/migrations/027_financeiro_limites_banco.sql` (+ rollback) | **Nova migration:** teto de recebimento e piso do valor **no banco** (seção 3) |
| `backend/db/migrations/_rollback/025_financeiro_base.down.sql` | Agora remove antes os dois gatilhos da 027 (dependem das colunas da 025); sem isso o rollback da 025 falhava com a 027 aplicada |
| `backend/tests/financeiro-preco-final.test.js` | Testes das regras novas (seção 5) |

A 025 e a 026 **não foram alteradas** (só o script de rollback da 025 ganhou duas linhas de limpeza). Nenhum grant novo.

## 2. Regras

* **Concluir não é pagar.** Concluir na Agenda (com ou sem preço final) **não grava nenhum pagamento**: o resumo mostra recebido 0 e saldo igual ao valor até a profissional registrar recebimentos (etapa 2).
* **Finalização na Agenda:** `PUT /appointments/:id` com `{ status: 'concluido', finalPriceCents, finalPriceReason? }` conclui e define o preço final **na mesma transação**; se o preço for recusado, **nada** é gravado (nem a conclusão nem as observações enviadas junto).
  `finalPriceCents` só vale com o status final `concluido` (`409 not_completed`) e com o Financeiro ligado e aplicado (`409 financeiro_indisponivel`); **sem** `finalPriceCents`, a Agenda funciona exatamente como antes, inclusive com o Financeiro desligado.
* **Preço final** (`PUT /financeiro/atendimentos/:id/preco-final`, `{ finalPriceCents, reason? }`): só de atendimento concluído; centavos inteiros, de 0 a R$ 100.000,00. **Justificativa obrigatória** (3 a 300 caracteres) quando o valor difere do preço do serviço **ou** altera um valor final já definido
  (`400 reason_required`); a primeira definição igual ao preço do serviço dispensa. O mesmo valor de novo não muda nada (`changed: false`, sem histórico).
* **Histórico:** cada definição ou alteração gera `appointment_final_price` (antes, depois, motivo e autor, pelo gatilho da 025); o resumo devolve `finalPriceHistory` (`fromCents`, `toCents`, `reason`, `at`).
* **Piso:** o preço final **nunca fica abaixo do líquido já recebido** (recebimentos − estornos): `409 below_received` com `netReceivedCents`. Igual ao líquido é permitido. Para baixar mais, é preciso antes **estornar ou corrigir** o recebimento (etapa 2), que são os procedimentos financeiros válidos.
  O teto dos recebimentos passa a ser o novo valor final (`exceeds_value`).
* **Concorrência:** receber e alterar o preço final do mesmo atendimento usam a **mesma trava** (`FOR SHARE`/`FOR NO KEY UPDATE` na linha + advisory lock por atendimento); simultâneos nunca deixam líquido > valor (testado: nunca valem os dois).

## 3. Limites também no banco (migration 027)

Dois gatilhos **novos e independentes** (nada da 025 foi reescrito, então não há duplicação de lógica e o rollback é só removê-los):

* `trg_financial_payments_cap`: um **recebimento** que faria o líquido passar do valor do serviço (valor final, ou o preço registrado) é recusado (`23514`) para **qualquer** escritor (API, SQL manual, rota futura). Estornos nunca são barrados; sinais confirmados contam.
* `trg_appointments_fin_value_floor`: `final_price_cents` ou `price_cents_snapshot` não pode ficar abaixo do líquido recebido, por nenhuma via (inclusive pela role da aplicação).

Ambos usam o **mesmo advisory lock** da API (reentrante), então simultâneos por SQL direto também são serializados (testado: 8 inserções diretas de 3.000 em 10.000 gravam exatamente 3). São `SECURITY DEFINER` com `search_path = pg_catalog, pg_temp` (mesmo padrão da 025), para o gatilho de `appointments`,
que roda no fluxo atual da Agenda, não depender de grants. Dados já gravados **não são revisados**. A API mantém as próprias checagens (mensagens amigáveis); o banco é a segunda barreira, e as mensagens dele são mapeadas para `exceeds_value` e `below_received`.

* **Aplicar** (como a dona, depois da 025; 026 independente): `sudo -u postgres psql -d nailflow -X -v ON_ERROR_STOP=1 -f backend/db/migrations/027_financeiro_limites_banco.sql`
* **Rollback** (`_rollback/027_...down.sql`): remove os dois gatilhos e as duas funções; não toca em dados; idempotente. O rollback da 025 também os remove.
* **Limite conhecido:** dois escritores **fora da API** que invertam a ordem de trava (linha de `appointments` × advisory lock) podem se travar; o PostgreSQL detecta e aborta um (`40P01`), sem corromper nada.

## 4. Compatibilidade

* A Agenda sem os campos novos **não muda**, com ou sem a estrutura financeira; o DTO ganha só `finalPriceCents` (nulo por padrão).
* A 027 só age em `INSERT` de recebimento e em `UPDATE` do valor do atendimento; não revisa dados antigos e não altera comportamento sem recebimentos.
* As travas da etapa 2 (recebimento × status da Agenda) seguem valendo; o aviso `has_payments` continua.

## 5. Testes (somente os necessários)

`financeiro-preco-final.test.js` (`FINANCEIRO_PRECO_TEST_DB_URL`, banco descartável próprio; API HTTP real com a role não-dona): **10 testes** — concluir não registra pagamento; concluir com preço final (justificativa, tudo ou nada, histórico com autor e motivo);
preço só com concluído e Financeiro desligado; rota do preço final (alterar, mesmo valor, validação, isolamento); piso e estorno liberando; piso pela Agenda sem gravar nada; concorrência receber × baixar o preço; teto e piso **no banco** por SQL direto (inclusive simultâneos); migration 027 (idempotência e rollback).

* **Última execução, só o afetado:** `financeiro-preco-final` **10 de 10**; Financeiro afetado (preço final, pagamentos, regras, migrações/rollback da etapa 1, restauração, exclusão, HTTP) **97 de 97**; Agenda (`appointment-status-characterization`, `-reschedule`, `-confirmation`,
  `dashboard-awaiting`, `client-history-appointment-edit`) **sem falhas, sem e com a estrutura financeira** (63 passam, 1 ignorado, o mesmo nos dois bancos).
* **Suíte completa, uma vez ao final (antes A × depois B da 025 + 026 + 027, role não-dona, Suporte incluído):** idêntica por arquivo, por nome e por mensagem de erro: **667 testes, 564 passam, 10 falham (as 10 conhecidas, nenhuma nova), 93 ignorados** (só os sete arquivos do Financeiro que rodam à parte, nos seus bancos).
  Os 189 testes do Suporte rodam e passam. Detalhes do ambiente: `FINANCEIRO_ETAPA1.md`, seção 10.
* Não foram feitos testes de mutação nem repetições desta etapa (as mutações da etapa 2 continuam registradas em `FINANCEIRO_ETAPA2.md`).

## 6. Pendências

1. **Publicação única** (025, 026, 027, grants, interruptor e código), só com autorização expressa. Nada disto foi aplicado ou ativado em produção.
2. **Ainda fora:** confirmação explícita de sinais Pix antigos, despesas, contas a receber completas, fechamento de caixa funcional e frontend. Check-in na Agenda não faz parte desta etapa.
3. **Limpeza** de temporários, bancos, dumps e worktrees descartáveis: **não feita** (será feita ao concluir e revisar o Financeiro).
4. Decisões abertas das etapas 1 e 2: retenção legal do arquivo financeiro; mitigação dos privilégios de `nailflow`; tentativas recusadas não ficam no histórico.
