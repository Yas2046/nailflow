# Financeiro — etapa 5: fechamento de caixa

Branch `feat/financeiro-base`, sem commit, **não aplicada em produção**. Mesmo interruptor das etapas anteriores (`FINANCEIRO_PAGAMENTOS_ENABLED`). Sem frontend nem relatórios.

## Regras

- **Esperado por método** (pix, dinheiro, débito, crédito, transferência, outra) no dia = recebimentos − estornos (`financial_payments`, na data em que ocorreram) − despesas **efetivamente pagas** (`expense_payments` e despesas `paga` antigas sem lançamentos, na data do pagamento). Atendimento concluído sem recebimento e despesa pendente/vencida/a revisar **não entram**. Despesa em boleto, ou paga antiga sem método, conta em `outra` (decisão a confirmar; ver pendências).
- **Fechar** (`POST /financeiro/caixa/:date/fechamento`): informa-se o contado de **todos** os métodos (centavos). Diferença ≠ 0 em qualquer método exige `justification` (422 `justification_required`, com a lista de divergências; nada é gravado). Grava os totais em `cash_closings` e uma linha por método em `cash_closing_entries` (esperado, contado, diferença, justificativa só nas linhas divergentes, autor, data). Dia já fechado = 409. Datas: reais, ≥ 2020-01-01, não futuras.
- **Consultar**: `GET /financeiro/caixa?from&to` (fechamentos + última versão), `GET /financeiro/caixa/:date` (prévia do esperado, fechamento e todas as versões), `GET /financeiro/caixa/:date/lancamentos` (movimentações que compõem o dia, com `historicoPath` e links ao atendimento/despesa), `GET /financeiro/historico/:tipo/:id` (histórico automático da 025: payment, expense, expense_payment, cash_closing, appointment).
- **Reabrir** (`POST /financeiro/caixa/:date/reabertura`, `{reason}`): motivo obrigatório (≥ 3) e diferente do da reabertura anterior; registrado em `financial_audit_log` (`cash_reopen`). Fechar de novo cria a **versão** seguinte; as versões anteriores permanecem (append-only).
- **Períodos fechados** (regra da 025, mantida): lançamento com data em dia fechado é recusado (`day_closed`). Um estorno real ocorrido **hoje** sobre recebimento de dia fechado é aceito e entra no dia em que ocorreu; a data nunca é alterada para contornar o fechamento, e o fechamento não altera nem apaga movimentações. Lançar retroativamente em dia fechado exige reabrir com motivo.
- **Concorrência**: fechamento e reabertura tomam o advisory lock exclusivo do dia; toda movimentação toma o compartilhado (`fin_day_is_closed`, migration 029). Assim o total congelado inclui tudo que já foi confirmado, e dois fechamentos simultâneos geram um só.

## Banco — migration 029

`029_financeiro_fechamento_caixa.sql` (+ `_rollback/…down.sql`, `_ops/029_grant_app_role.sql`): UNIQUE `(id, professional_id)` em `cash_closings`; tabela append-only `cash_closing_entries` (por gatilho e por privilégio: só SELECT/INSERT; só entra com o dia fechado e na versão atual; diferença ≠ 0 exige justificativa; FK composta sem cascata); e **uma** função existente alterada, `fin_day_is_closed`, que só ganha o lock compartilhado do dia (mesma regra da 025). Rollback da 029 **aborta** se houver lançamentos de fechamento; os rollbacks da 025 e da 028 abortam enquanto a 029 estiver aplicada. Fechamentos criados antes desta etapa ficam sem linhas por método.

## Interface do Financeiro (etapa 6)

Rotas `/financeiro/:aba` (`visao-geral`, `movimentacoes`, `a-receber`, `despesas`, `caixa`); código em `frontend/src/pages/financeiro/`, cliente tipado em `services/financeiro.ts`, formatação em `utils/money.ts`. O item **Financeiro** do menu só aparece quando `GET /financeiro/caixa` responde (flag ligada e migrations aplicadas); com o módulo desligado a tela mostra "indisponível". Gastos continua existindo; o cadastro de despesas do Financeiro reaproveita `/expenses`.

- **Visão geral**: recebido, estornado, despesas pagas e saldo do mês (`GET /financeiro/movimentacoes`, novo e somente leitura), a receber, despesas, caixa de hoje e pendências com atalhos.
- **Movimentações**: filtros de período, tipo e método; acesso ao histórico (`/financeiro/historico/...`) e ao financeiro do atendimento (registrar recebimento e estornar, com `Idempotency-Key`).
- **A receber**: pendente, vencido e quitado; sinal Pix antigo aparece só como aviso (não conta como recebido); atalho para o atendimento e para a Agenda (`/agenda?data=…&abrir=…`).
- **Despesas**: cadastro/edição/exclusão (só sem pagamento), revisão manual, vencimento com motivo, pagamento parcial/quitação e histórico.
- **Fechamento de caixa**: prévia por método, contado, diferença, justificativa, versões anteriores, lançamentos do dia e reabertura com motivo.
- **Boleto e método não informado**: continuam somados em **Outros** no esperado, mas a API devolve `expensesPaidBoletoCents` e `expensesPaidUnknownMethodCents` na linha "Outros" e a tela os mostra à parte (selos "Boleto" e "Método não informado"); nos lançamentos do dia e nas movimentações o método de registros antigos aparece como "método não informado", nunca inventado.
- Valores em reais, datas `dd/mm/aaaa`, "hoje" e meses no fuso `America/Sao_Paulo`; envios com trava contra duplo clique e chave de idempotência renovada a cada alteração do formulário. A tela só apresenta: valores esperados, saldos, estados e validações vêm da API.

### Fechamento das pendências (etapa 7)

- **Correção de recebimento** e **valor final** pela interface (modal "Financeiro do atendimento", também aberto de dentro do agendamento concluído na Agenda). Na Agenda, ao concluir, há o campo opcional de valor final (+ justificativa); vazio = vale o preço do serviço.
- **Cadastro de despesa atômico**: `POST /financeiro/despesas` cria a despesa e aplica a situação inicial (`a_revisar`, `pendente` com vencimento opcional ou `paga` com data e método) numa só transação; falha em qualquer parte não grava nada (substitui as duas chamadas da etapa 6).

### Pendências abertas antes da publicação única

1. **Relatórios, exportação Excel/PDF e alertas**: o escopo (conteúdo, período, formato, destinatário) não está definido em nenhum documento do projeto; **não implementados**. Hoje existem apenas os indicadores e as pendências da Visão geral. Depende de decisão de negócio.
2. **Retenção do schema de arquivo financeiro** (`financeiro_arquivo_*`) e das exportações `pg_dump -n`: sem prazo e sem rotina de poda (ver `FINANCEIRO_ETAPA1.md`, seção 6); decisão de retenção/LGPD pendente.
3. **Permissões reais do banco**: os scripts `_ops/025_grant_app_role.sql`, `_ops/028_grant_app_role.sql` e `_ops/029_grant_app_role.sql` foram validados só em cluster descartável; conferir em produção a role `nailflow` (sem UPDATE/DELETE/TRUNCATE nas tabelas append-only) **depois** de aplicar as migrations, com autorização.
4. **Ordem de publicação**: migrations 025 → 029 pela dona das tabelas, grants, flag `FINANCEIRO_PAGAMENTOS_ENABLED`, build do frontend com `VITE_API_URL` de produção; nada disso foi executado.
5. **Indicadores antigos** (Dashboard e resumo de Gastos) ainda tratam atendimento concluído como faturado (`price_cents_snapshot`), o que não coincide com o conceito "recebido" do Financeiro. Não foram alterados; decidir se passam a usar recebimentos reais.
6. Sem testes automatizados de componentes (não há ambiente de DOM); a interface foi verificada manualmente no navegador, em banco descartável, nos fluxos: visão geral, a receber → recebimento → correção, valor final pela Agenda, fechamento com divergência e distinção boleto/método não informado.

### Relatórios, alertas e indicadores (etapa 8)

- `GET /financeiro/relatorio?from&to` (JSON), `/relatorio.xlsx` (detalhado: 9 abas) e `/relatorio.pdf` (resumo); até 366 dias; recebido líquido, despesas pagas por método e categoria, pendências, saldo de caixa e fechamentos. Aba **Relatórios** na tela.
- `GET /financeiro/alertas`: despesas vencidas, a receber vencido/pendente, despesas antigas a revisar e divergências de caixa (60 dias), cada um com o caminho da tela (`?situacao=`/`?data=`). Aparecem na Visão geral; sem notificação externa.
- **Dashboard e Gastos** (com o Financeiro ligado): faturamento = recebido líquido, gastos = despesas efetivamente pagas, mesmas consultas do relatório (`utils/financeiroRelatorios.js`); concluído sem recebimento aparece em "A receber". Com a flag desligada valem os indicadores antigos. `GET /expenses` passou a devolver datas `AAAA-MM-DD` (antes vinha timestamp deslocado, a tela mostrava "Invalid Date").
- A exclusão de conta passou a incluir `expense_payments` e `cash_closing_entries` no snapshot e na conferência de concorrência.
- Publicação, retenção de 90 dias (proposta) e rollback: [`FINANCEIRO_PUBLICACAO.md`](./FINANCEIRO_PUBLICACAO.md).
