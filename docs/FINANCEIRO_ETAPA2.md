# Financeiro — etapa 2: pagamentos e recebimentos (backend)

> **Estado (2026-10-19):** código na branch `feat/financeiro-base`, **sem commit**, **não aplicado em nenhum banco persistente nem em produção**. Só backend: **sem frontend**,
> sem despesas, sem contas a receber completas e sem fechamento de caixa funcional. Depende da etapa 1 ([`FINANCEIRO_ETAPA1.md`](./FINANCEIRO_ETAPA1.md)), que **também não está publicada**:
> a publicação será única, com 025, 026, grants e código juntos.

## 1. O que a etapa entrega

| Arquivo | Papel |
|---|---|
| `backend/db/migrations/026_financeiro_pagamentos_metodo.sql` | **Nova migration**: acrescenta a forma `transferencia` à constraint `financial_payments_method_check` (ver seção 2) |
| `backend/db/migrations/_rollback/026_financeiro_pagamentos_metodo.down.sql` | Rollback seguro: recusa-se a rodar se já houver movimentação por transferência |
| `backend/src/utils/financeiroPagamentos.js` | Regras puras: métodos, valores, datas, chave de idempotência, hash do pedido, saldo |
| `backend/src/controllers/financeiroController.js`, `backend/src/routes/financeiro.routes.js` | API de pagamentos (seção 3) |
| `backend/src/server.js` | Registra `/financeiro` |
| `backend/src/controllers/appointmentsController.js` | Proteção: atendimento com recebimento não deixa de estar concluído (seção 5) |
| `backend/tests/financeiro-pagamentos-regras.test.js`, `financeiro-pagamentos.test.js` | Testes (seção 8) |

A migration **025 não foi alterada**. Não foram criados novos grants: a role da aplicação usa só os da 025 (`SELECT, INSERT` em `financial_payments`).

## 2. Migration 026 (por que existe)

A constraint da 025 aceitava `pix`, `dinheiro`, `cartao_debito`, `cartao_credito` e `outra`; a etapa 2 também precisa de **transferência**. A 026 só **amplia** a lista (todo valor aceito antes continua aceito), é
idempotente e transacional, e confere o resultado. Aplicar como a dona das tabelas (em produção, `postgres`), **depois** da 025:

```bash
sudo -u postgres psql -d nailflow -X -v ON_ERROR_STOP=1 -f backend/db/migrations/026_financeiro_pagamentos_metodo.sql
```

* **Rollback** (`_rollback/026_...down.sql`): volta à lista da 025, mas **aborta sem alterar nada** se já houver recebimento ou estorno por `transferencia`, porque `financial_payments` é append-only e o dado não pode ser reescrito.
  Nesse caso o caminho seguro é **deixar a 026 aplicada**. Pare a API antes (a rota aceita `transferencia` enquanto a 026 vale).
* **Interação com o rollback da 025 e a restauração:** o arquivo gerado pelo rollback da 025 pode conter `transferencia`. Para restaurar, **reaplique a 025 e depois a 026**; só então rode `_ops/025_restore_from_archive.sql`
  (sem a 026 a restauração aborta por inteiro na constraint, sem gravar nada).
* A API só funciona com 025 **e** 026 aplicadas: com qualquer uma ausente responde **503** (`structure_missing`), sem gravar.

## 3. API (`/financeiro`)

Tudo exige sessão (cookie) e passa pelo guarda de origem (CSRF). **Interruptor fail-closed:** `FINANCEIRO_PAGAMENTOS_ENABLED` precisa ser exatamente `true` no `.env`; desligado, as rotas **não existem** (404, mesmo autenticado).
O valor é lido a cada requisição, mas o `.env` só é lido na inicialização: mudar exige reiniciar o processo. Valores em **centavos inteiros**; datas `AAAA-MM-DD` (fuso do negócio).

| Rota | Faz |
|---|---|
| `GET /financeiro/atendimentos/:id/pagamentos` | Resumo: valor do serviço (e a base: `final` ou `servico`), recebido, estornado, líquido, saldo e as movimentações (cada recebimento com `refundedCents` e `remainingCents`) |
| `POST /financeiro/atendimentos/:id/pagamentos` | Registra um recebimento: `{ amountCents, method, occurredOn, notes? }` |
| `POST /financeiro/pagamentos/:id/estornos` | Estorna (parte de) um recebimento: `{ amountCents, occurredOn, reason }` |
| `POST /financeiro/pagamentos/:id/correcao` | Corrige um recebimento: `{ reason, occurredOn, novo: { amountCents, method, occurredOn?, notes? } }` |

**Não existe** rota para editar ou apagar movimentação (PUT, PATCH e DELETE dão 404), e a role da aplicação não tem `UPDATE`/`DELETE`/`TRUNCATE` na tabela: o histórico original nunca muda.
Os três `POST` exigem o cabeçalho **`Idempotency-Key`** (8 a 50 caracteres: letras, números, `_ . : -`). Campos desconhecidos são **recusados** (por exemplo `professionalId`, `kind`, `source`).

### Respostas e erros

Sucesso: `201` (ou `200` com `replayed: true` quando é o reenvio de um pedido já gravado), com a movimentação e o resumo atualizado.
Erros trazem `{ error, reason }`:

| HTTP | `reason` | Quando |
|---|---|---|
| 400 | `validation` | Valor (zero, negativo, fracionário, texto, acima de R$ 100.000,00), forma de pagamento fora da lista, campo ausente ou desconhecido, motivo curto, identificador malformado |
| 400 | `invalid_date` | Data impossível (`2026-02-30`), formato errado, anterior a 2020-01-01, **futura**, ou (estorno/correção) anterior ao recebimento original |
| 400 | `idempotency_key_required` | Cabeçalho ausente ou fora do formato |
| 401 | — | Sem sessão |
| 404 | `not_found` | Atendimento ou recebimento inexistente **ou de outra profissional** (a mesma resposta nos dois casos); rota desligada |
| 409 | `not_completed` | O atendimento não está `concluido` |
| 409 | `exceeds_value` | O líquido recebido passaria do valor do serviço (`valueCents`, `netReceivedCents`, `balanceCents` na resposta) |
| 409 | `refund_exceeds` | O estorno passaria do que resta do recebimento (`remainingCents`) |
| 409 | `not_a_receipt` | Estornar ou corrigir algo que não é um recebimento (por exemplo um estorno) |
| 409 | `nothing_to_correct` | O recebimento já foi totalmente estornado |
| 409 | `idempotency_conflict` | A mesma chave foi usada com outro pedido (valor, método, data, atendimento…) |
| 409 | `day_closed` | A data da movimentação está num dia **fechado** no caixa |
| 503 | `structure_missing` | 025/026 não aplicadas |

## 4. Regras

* **Concluído não é pago.** Nada é gravado sozinho: um atendimento `concluido` mostra recebido 0 e saldo igual ao valor até a profissional registrar. Só se recebe de `concluido`; os demais status dão `not_completed`.
* **Sinais Pix antigos não são importados nem presumidos:** `deposit_cents` e `paid_at` não são lidos; um atendimento com sinal registrado aparece com recebido 0. A rota recusa o campo `source`; confirmar um sinal fica para uma etapa própria, explícita.
* **Valor do serviço:** o **valor final** quando existe (`final_price_cents`, definido pela futura etapa de finalização); senão o preço registrado no agendamento. **Teto no servidor:** `recebido - estornado + novo <= valor`, conferido **sob trava por atendimento**.
* **Parciais e métodos:** quantos recebimentos forem precisos, cada um com seu método (`pix`, `dinheiro`, `cartao_debito`, `cartao_credito`, `transferencia`, `outra`) e data, até quitar.
* **Estorno:** linha **nova** (`kind = estorno`) ligada ao recebimento (`reverses_payment_id`), com motivo; o banco garante o mesmo atendimento, data não anterior e soma dos estornos ≤ recebimento. Nunca se estorna um estorno.
* **Correção** (recebimento lançado errado): **na mesma transação**, estorna o **saldo** do recebimento (o que ainda não foi estornado) e registra o recebimento correto; o teto vale para o novo valor. Se qualquer parte falhar (teto, dia fechado, data), **nada** é gravado. Original, estorno e novo ficam no histórico com o motivo.
* **Idempotência:** mesma chave e mesmo pedido devolvem o resultado gravado (`200`, `replayed`), inclusive depois de o saldo acabar; mesma chave com pedido diferente é `409`. A chave é **por profissional**. Na correção a chave gera duas (`:e`, `:n`). O hash do pedido inclui operação, conta e todos os campos de negócio.
* **Datas:** calendário real, não futura (fuso do negócio), não anterior a 2020-01-01; estorno e correção não anteriores ao recebimento original.
* **Dia fechado:** o banco (025) recusa movimentação com `occurred_on` num dia fechado; a API devolve `409 day_closed` e, na correção, desfaz tudo.
* **Auditoria:** cada operação gera o histórico automático da 025 (`payment_create`/`payment_refund`), com o **autor** (a profissional) e, nos estornos e correções, o **motivo**. O reenvio idempotente não gera histórico novo. Tentativas **recusadas** não são registradas (só o que foi gravado).
* **Isolamento:** toda consulta filtra pela profissional da sessão; atendimento ou recebimento de outra conta responde exatamente como inexistente (404). O banco reforça com chaves compostas.

### Concorrência

Cada operação trava o atendimento com `SELECT ... FOR SHARE` e um `pg_advisory_xact_lock` por atendimento; a leitura do saldo e o INSERT acontecem sob essa trava, então pedidos simultâneos são serializados (10 recebimentos de 2.500 num atendimento de 10.000 gravam
exatamente 4). O `FOR SHARE` conflita com o `FOR UPDATE` da Agenda: recebimento e mudança de status do mesmo atendimento não se cruzam. Não há `UPDATE` nem espera circular entre as travas.

## 5. Agenda, exclusão de atendimentos e de profissionais

* **Agenda:** `PUT /appointments/:id` que tira um atendimento de `concluido` (para `pendente` ou `nao_compareceu`) é **recusado (409, `has_payments`)** enquanto houver **recebimento líquido** > 0: esconderia dinheiro recebido. Depois de estornar tudo, a Agenda pode corrigir o status
  (e o Financeiro volta a recusar novos recebimentos). Observações seguem livres; cancelar concluído já era recusado; o lote "este e os próximos" já não altera concluído. Sem a estrutura (ou sem privilégio de leitura), a verificação não gera erro.
* **Exclusão de atendimento:** a aplicação não apaga atendimentos (cancela logicamente), e o banco recusa `DELETE` de atendimento que tenha movimentação (FK sem cascata): provado com a role da aplicação.
* **Exclusão de profissional:** a cascata apaga movimentações e histórico da conta, e só dela; o snapshot, o preview e a trava de concorrência da etapa 1 incluem as tabelas financeiras (ver `FINANCEIRO_ETAPA1.md`, seções 6 e 7).

## 6. Segurança e privilégios

Sem novos grants. O recebimento usa `SELECT ... FOR SHARE` em `appointments`, que exige `UPDATE` na tabela (a role já o tem). O histórico é gravado pelas funções `SECURITY DEFINER` da 025. As recomendações de privilégios da etapa 1 (revogar `TRUNCATE`, `TRIGGER`,
`REFERENCES` e `CREATE` em `public`) continuam valendo e **não** foram aplicadas.

## 7. O que ficou fora (de propósito) e riscos

* **Teto só na API** (resolvido na etapa 3): a migration 027 repete o teto e o piso do valor no banco; ver [`FINANCEIRO_ETAPA3.md`](./FINANCEIRO_ETAPA3.md).
* **Valor final** (resolvido na etapa 3): a rota `PUT /financeiro/atendimentos/:id/preco-final` e a finalização na Agenda o definem, com justificativa, histórico e piso (nunca abaixo do líquido recebido); ver [`FINANCEIRO_ETAPA3.md`](./FINANCEIRO_ETAPA3.md).
* **Sinal Pix** não é confirmável por esta API; **despesas, contas a receber completas e fechamento de caixa funcional** não foram iniciados; **sem frontend**.
* Tentativas recusadas não ficam no histórico; não há limitador de taxa específico (vale o da aplicação).
* O interruptor depende do `.env` e de reinício do PM2; **nada disso foi feito em produção**.

## 8. Testes

Bancos **descartáveis** de um cluster criado só para isso (PostgreSQL 16, porta própria, só bancos `nf_*_test`), com a **role não-dona** da aplicação e a API HTTP real. Sem a variável `FINANCEIRO_PAGAMENTOS_TEST_DB_URL`, os testes de banco são ignorados.

| Arquivo | Testes | O que prova |
|---|---|---|
| `financeiro-pagamentos-regras.test.js` (sem banco) | 7 | Interruptor, métodos, datas, chave, hash do pedido, valor e saldo, validação dos corpos |
| `financeiro-pagamentos.test.js` (`FINANCEIRO_PAGAMENTOS_TEST_DB_URL`) | 32 | Interruptor, 503 sem a 026, autenticação, CSRF, sucesso, parciais e os seis métodos, concluído ≠ pago, sinal antigo não importado, teto (inclusive com valor final), **concorrência** (recebimentos, mistos, idempotência, estornos, correções), validação, **idempotência**, estornos, correções (atomicidade), **isolamento**, dia fechado, imutabilidade, **Agenda × financeiro**, exclusão, migration 026 |

### Resultados da última execução (2026-10-19)

* **Financeiro (etapas 1 e 2), 7 arquivos em paralelo, cada um no seu banco:** **91 de 91** passam, em **3 execuções seguidas**; ao final os bancos ficam limpos (sem estrutura, contas, arquivos ou roles de teste).
* **Sensibilidade (os testes não são vacuosos).** Quebrando uma regra de cada vez no código, os testes reprovam: sem o teto (7 de 32), sem a trava por atendimento (3 de 32, os de concorrência), sem a proteção da Agenda (2 de 32), sem exigir atendimento concluído (3 de 32) e sem a checagem de idempotência (2 de 32; o reenvio ainda é contido pelo `ON CONFLICT`, que é a segunda barreira). Os arquivos foram restaurados idênticos.
* **Suíte completa do backend antes (A) e depois (B) da 025 + 026**, com a role não-dona e as variáveis do Suporte (mesmo ambiente descrito em `FINANCEIRO_ETAPA1.md`, seção 10):

| | Antes (A) | Depois (B) |
|---|---|---|
| Testes | 657 | 657 |
| Passam | 564 | 564 |
| Falham | 10 | 10 |
| Ignorados | 83 | 83 |

  Resultado **idêntico** por arquivo, por nome de teste e por mensagem de erro. Os 189 testes do Suporte rodam e passam. As 10 falhas são as mesmas da etapa 1 (9 testes antigos desatualizados e 1 que aplica DDL e exige a role dona; ver
  `FINANCEIRO_ETAPA1.md`, seção 8), **nenhuma nova**. Os 83 ignorados são só os seis arquivos do Financeiro que rodam à parte nos seus bancos (26 + 4 + 8 + 9 + 4 + 32). O teste de regras (7) roda nos dois lados e passa.

### O que **não** foi executado

* Nada contra produção ou banco persistente; a role não-dona é uma simulação de `nailflow`.
* Nenhum teste de carga (a concorrência foi testada com 4 a 12 pedidos simultâneos por cenário).
* Frontend, n8n e WhatsApp não fazem parte da etapa.

## 9. Pendências

1. **Publicação única** (025, 026, grants, interruptor e código, nessa ordem de preparo), só com autorização expressa.
2. ~~Etapa de finalização e gatilho de teto no banco~~ — feitos na etapa 3.
3. Confirmação **explícita** de sinais Pix antigos, despesas, contas a receber e fechamento de caixa funcional.
4. Decisões da etapa 1 ainda abertas: retenção legal do arquivo financeiro e mitigação dos privilégios de `nailflow`.
