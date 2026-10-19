# Financeiro — etapa 4: despesas e contas a receber

Branch `feat/financeiro-base`, sem commit, **não aplicada em produção**. Mesma interruptor das etapas anteriores (`FINANCEIRO_PAGAMENTOS_ENABLED`, desligado = 404). Sem frontend, fechamento de caixa ou relatórios.

## Despesas (reaproveitam `expenses` e a tela/rotas de Gastos)

Estado: `a_revisar` → `pendente` (→ `vencida`, derivado: pendente com vencimento anterior a hoje) → `paga`.

- **Nada é presumido.** Despesa antiga continua `a_revisar` até a revisão manual (`POST /financeiro/despesas/:id/revisao`): `{to:'pendente', dueOn?, reason?}` ou `{to:'paga', paidOn, method, reason}` (motivo obrigatório; vira um pagamento do valor inteiro). Revisar de novo = 409 `not_in_review`. Despesa `paga` gravada antes, sem lançamentos, aparece com `legacyPaid: true` e nenhum pagamento é inventado.
- **Pagamentos parciais** (`POST /financeiro/despesas/:id/pagamentos`, `Idempotency-Key` obrigatório): `{amountCents, method, paidOn, notes?}`. Só despesa `pendente`; soma limitada ao valor (409 `exceeds_expense`, com `remainingCents`); ao quitar, a despesa vira `paga` (data e método do último pagamento). Repetição com a mesma chave devolve o mesmo pagamento (200 `replayed`); mesma chave com outro corpo = 409.
- `GET /financeiro/despesas[?situacao=&from=&to=&limit=]` (lista + totais por estado), `GET /financeiro/despesas/:id` (com histórico de pagamentos), `PUT /financeiro/despesas/:id/vencimento` `{dueOn, reason}` (só pendente; histórico com autor e motivo).
- **Gastos (rotas antigas):** `DELETE /expenses/:id` recusa (409) despesa paga ou com pagamentos; `PUT /expenses/:id` não deixa o valor abaixo do já pago (409). Exclusão de despesa sem pagamento continua permitida e deixa histórico (025).
- Datas: reais, ≥ 2020-01-01, pagamento não futuro (fuso do negócio); vencimento até 10 anos à frente. Valores em centavos inteiros, até R$ 100.000,00.

## Contas a receber (somente leitura)

`GET /financeiro/a-receber[?from=&to=&graceDays=7&incluirQuitados=false&limit=]`: atendimentos **concluídos**; valor = preço final (ou preço do serviço), recebido líquido = recebimentos − estornos (Etapa 2/3), saldo = valor − líquido. Totais separados: recebido, saldo pendente e saldo vencido (concluído há mais de `graceDays` dias; o atendimento não tem vencimento próprio). Cada item traz `paymentsPath` (histórico do atendimento) e `sinalLegado` quando há `deposit_cents` antigo: **informativo**, não conta como recebido; só entra por confirmação manual existente (`sinal_pix_confirmado`), sem duplicar. A consulta não grava nada.

## Banco — migration 028

`028_financeiro_despesas.sql` (+ `_rollback/028_financeiro_despesas.down.sql`, `_ops/028_grant_app_role.sql`): tabela `expense_payments` (append-only por gatilho e por privilégio: só SELECT/INSERT), FK composta `(expense_id, professional_id)` sem cascata a partir da despesa, idempotência por `(professional_id, idempotency_key)`; gatilhos `SECURITY DEFINER`: guarda (dia fechado, despesa pendente, soma ≤ valor, trava `fin_exp:<id>`), quitação automática, histórico (`expense_payment_create` em `financial_audit_log`, com autor) e piso (valor da despesa ≥ já pago). Rollback da 028 **aborta** se houver pagamento ou histórico de pagamento de despesa; o rollback da 025 aborta enquanto a 028 estiver aplicada. 025, 026 e 027 não foram alteradas (só a lista de valores aceitos do histórico foi ampliada, pela própria 028).
