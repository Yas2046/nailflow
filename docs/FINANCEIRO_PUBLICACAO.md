# Financeiro — plano de publicação única e política de retenção

**Estado: PLANO. Nada deste documento foi executado.** **Atualização de 2026-10-21 (auditoria de produção somente leitura): a produção já tem as etapas deste plano aplicadas.** Migrations 025–029 aplicadas e `FINANCEIRO_PAGAMENTOS_ENABLED=true` (sem movimentações gravadas até a auditoria). Registro histórico: o texto abaixo continua sendo o plano original (base `ea21c0a`), não o estado atual. A **proposta ainda não publicada** é outra: migrations 030–032 e o pacote da branch `feat/redesign-navegacao` (ver `STATUS_ATUAL.md`). A prova de restauração com o dump **real** (seção 3) continua não realizada. Cada passo marcado 🔒 exige autorização explícita; produção, migrations persistentes, grants, flag, PM2, build de produção, commit/push/merge e qualquer remoção de arquivo estão fora do que foi feito até aqui. Detalhes técnicos de cada etapa: `FINANCEIRO_ETAPA1.md` a `FINANCEIRO_ETAPA5.md`.

## 1. Inventário (branch `feat/financeiro-base`, base `ea21c0a`, sem commit)

- **Migrations** (`backend/db/migrations/`): `025_financeiro_base`, `026_financeiro_pagamentos_metodo`, `027_financeiro_limites_banco`, `028_financeiro_despesas`, `029_financeiro_fechamento_caixa`; rollbacks em `_rollback/`; `_ops/`: `025_grant_app_role`, `028_grant_app_role`, `029_grant_app_role`, `025_audit_app_privileges` (somente leitura), `025_restore_from_archive`.
- **Backend novo**: `routes/financeiro.routes.js`; controllers `financeiroController`, `financeiroDespesasController`, `financeiroCaixaController`, `financeiroRelatoriosController`; utils `financeiroPagamentos`, `financeiroPrecoFinal`, `financeiroDespesas`, `financeiroRelatorios`. **Alterados**: `server.js` (monta a rota), `appointmentsController` (preço final), `expensesController` (guardas, datas `AAAA-MM-DD`, resumo real), `dashboardController` (recebimentos reais), `adminController` (snapshot de exclusão inclui as tabelas financeiras, inclusive 028/029).
- **Dependências novas**: `exceljs@^4.4`, `pdfkit@^0.15` (`backend/package.json` e `package-lock.json`) → na publicação é preciso `npm ci --omit=dev` no backend.
- **Frontend**: `pages/financeiro/*` (Visão geral, Movimentações, A receber, Despesas, Fechamento de caixa, Relatórios, modal do atendimento), `services/financeiro.ts`, `utils/money.ts`; alterados `App.tsx`, `Layout.tsx`, `AppointmentModal.tsx`, `Dashboard.tsx`, `Gastos.tsx`, `services/api.ts`, `types.ts`.
- **Variável nova**: `FINANCEIRO_PAGAMENTOS_ENABLED` (`.env.example`, padrão `false`; só o valor exato `true` liga; lida a cada requisição).
- **Testes**: `backend/tests/financeiro-*.test.js` (11 arquivos + helpers) e `frontend/tests/financeiro-money.test.mjs`.

## 2. Pré-requisitos e decisões a confirmar antes de autorizar

1. Estado real de produção, **somente leitura** 🔒: (a) `git -C /var/www/nailflow log -1`/`status` — o plano parte de `main` em `ea21c0a` e árvore limpa; qualquer diferença **interrompe** o plano; (b) versão do PostgreSQL (≥ 13, por `gen_random_uuid()` nativo; antes disso exigiria `pgcrypto`), migrations 001–024 aplicadas, ausência das tabelas financeiras, espaço em disco e tamanho do banco; (c) `node -v` e `pm2 ls` (o plano usa o processo `nailflow-backend`, id 0, porta 3333); (d) nome da role dona (`postgres`) e da role da aplicação (`nailflow`).
2. Janela de baixa movimentação (cada migration tem `lock_timeout` de 3 s e **aborta** se não conseguir o bloqueio; basta repetir). O backend tem **duas** reinicializações no plano (itens 6(f) e 6(i)), cada uma com ~10 s de indisponibilidade (ver item 5).
3. Autorização para: `npm ci` no servidor, reiniciar o backend no PM2, alterar **uma linha** do `.env`.
4. Decisões ainda abertas: retenção legal/LGPD do schema de arquivo e das exportações (item 8); validação legal dos 90 dias (item 8).

## 3. Backup e prova de recuperação 🔒

1. Antes de qualquer alteração: `pg_dump -Fc` manual do banco `nailflow` para `/var/backups/nailflow/manual/` (fora da varredura de 7 dias), mais cópia do `.env` e do diretório do backend atual (`/var/www/nailflow`).
2. **Provar que o backup recupera**: restaurar o dump com `pg_restore --exit-on-error --no-owner --no-privileges` em um banco **descartável de outro cluster** (nunca em produção; o cluster descartável usado nos ensaios, porta 55434, é uma opção) e conferir contagens das tabelas principais (`professionals`, `appointments`, `clients`, `expenses`) contra produção. Só prosseguir com a prova positiva. Observação: o ensaio com o mesmo procedimento já foi feito em banco descartável (`financeiro-dump.test.js`); a prova com o dump **real** só existe depois de executada e **não** foi feita.
3. Registrar tamanho, hash (`sha256sum`) e data do dump no log da publicação.
4. Repetir um dump logo **depois** das migrations e **antes** de ligar a flag (ponto de retorno com a estrutura nova e sem movimentos).

## 4. Migrations e grants (ordem, dependências e verificação) 🔒

Aplicar como a dona das tabelas (`postgres`), na ordem, cada arquivo em sequência com `psql -X -v ON_ERROR_STOP=1 -d nailflow -f …`, **com a API ainda no código atual**:

| # | Arquivo | Depende de | Observação |
|---|---|---|---|
| 1 | `025_financeiro_base.sql` | 001–024 | tabelas de movimentação, histórico, fechamento; colunas novas em `appointments` e `expenses` (aditivas; despesas antigas ficam `a_revisar`, nada é reclassificado) |
| 2 | `026_financeiro_pagamentos_metodo.sql` | 025 | só amplia a lista de métodos |
| 3 | `027_financeiro_limites_banco.sql` | 025 | gatilhos de teto/piso |
| 4 | `028_financeiro_despesas.sql` | 025 | `expense_payments` |
| 5 | `029_financeiro_fechamento_caixa.sql` | 025, 028 | `cash_closing_entries`; ajusta `fin_day_is_closed` (lock do dia) |

Cada uma tem bloco de verificação final que **reverte tudo** se a estrutura divergir. Depois, com `-v app_role=nailflow`: `_ops/025_grant_app_role.sql`, `_ops/028_grant_app_role.sql`, `_ops/029_grant_app_role.sql` (idempotentes; **abortam** se a aplicação ficar com UPDATE/DELETE/TRUNCATE nas tabelas append-only).

**Verificação das permissões da `nailflow` (somente leitura, previamente autorizada) 🔒:**
`sudo -u postgres psql -d nailflow -X -v app_role=nailflow -f backend/db/migrations/_ops/025_audit_app_privileges.sql` — conferir: role não superusuária, sem TRUNCATE/TRIGGER/REFERENCES nem CREATE em `public`, sem UPDATE/DELETE em `financial_payments`, `financial_audit_log`, `expense_payments`, `cash_closing_entries`. Excessos preexistentes (privilégios amplos herdados) são **achados a decidir com você**, não corrigidos automaticamente.

Entre uma migration e os grants a aplicação segue funcionando: as funções de histórico e dos gatilhos são `SECURITY DEFINER` (ensaio “025 aplicada SEM o script de grants” em `financeiro-http`). Os grants não são necessários para o código antigo, apenas para o novo usar as tabelas novas.

Compatibilidade verificada em banco descartável: (a) código **novo** com a flag desligada — Agenda, Gastos e exclusão de conta iguais ao comportamento sem a estrutura (fases de `financeiro-http`; Agenda/Dashboard sem e com a estrutura); (b) código **antigo** (`ea21c0a`, extraído com `git archive` para uma pasta temporária) contra um banco com 025–029 aplicadas: Agenda, remarcação, confirmação, Gastos e Dashboard, **50 de 51** testes (1 ignorado), 0 falhas.

## 5. Flag: só no momento correto

`FINANCEIRO_PAGAMENTOS_ENABLED` permanece **`false`** durante todo o deploy. Ligar somente depois de: migrations e grants conferidos, código novo no ar, build novo servido, smoke com a flag desligada aprovado e o segundo `pg_dump` feito. Com a flag desligada: `/financeiro/*` responde 404, o item “Financeiro” não aparece, Dashboard e Gastos seguem a regra antiga (concluído = faturado) — **por isso Dashboard/Gastos só mudam de critério quando a flag é ligada**. Ativação: editar **somente a linha** `FINANCEIRO_PAGAMENTOS_ENABLED` do `.env` (sem copiar/sobrescrever o arquivo; nunca exibir segredos) e reiniciar com `pm2 restart 0 --update-env` (o `DEPLOY.md` é a referência). O backend roda em modo *fork*, em que `pm2 reload` equivale a reiniciar: **há ~10 s de indisponibilidade** em cada reinício; mensagens do WhatsApp nesse intervalo são cobertas pelo retry do n8n (5 × 3 s) e pela deduplicação do bot, conforme o `DEPLOY.md`. Reiniciar em horário de baixa movimentação.

## 6. Build e implantação 🔒

1. **Pré-condição do código**: o código está sem commit; antes de qualquer build ou cópia ao servidor é preciso **commit/merge/push autorizados** de um commit aprovado, e o build e o deploy partem **desse commit**, não da árvore de trabalho (`DEPLOY.md`). O deploy segue o fluxo documentado (cópia de `backend/src` e `frontend/src`/`dist` ao VPS; o `package.json` e o `package-lock.json` também precisam ir, por causa das dependências novas).
2. Build do frontend **fora** da pasta servida (`/var/www/nailflow/frontend` nunca é o diretório de build), com `VITE_API_URL` de produção explícito, e **validar o bundle** (a URL de produção aparece e `localhost:3333` não) antes de trocar o `dist` — lição já registrada: build sem a variável embute `localhost` e quebra o login. Como o build não publica a política de privacidade, valem as verificações do `DEPLOY.md` para esse caso: `node --test frontend/tests/support-notice.test.mjs` (todos passam), `npx tsc -b` e as contagens no bundle (`/privacidade` e demais textos esperados **0**; contato **1**); qualquer outro resultado = não publicar.
3. Sequência: (a) backup + prova (item 3) → (b) migrations 025–029, com o backend atual no ar → (c) grants + auditoria de privilégios → (d) segundo dump → (e) código novo no servidor + `npm ci --omit=dev` (conferir `node -e "import('exceljs'); import('pdfkit')"`) → (f) `pm2 restart 0 --update-env` com a flag **desligada** → (g) smoke → (h) trocar o `dist` pelo novo, **mantendo o anterior** como `dist.bak_AAAAMMDD-pre-financeiro` → (i) ligar a flag e reiniciar → (j) smoke financeiro. Se o código novo for copiado antes das migrations (não recomendado), ele funciona com a flag desligada, mas a ordem acima é a testada.

## 7. Verificações e critérios

**Smoke com flag desligada:** login; Agenda abre e cria/edita agendamento; Gastos lista e cria; Dashboard carrega; `GET /financeiro/caixa` → 404; log do PM2 sem erros novos.
**Smoke com flag ligada — somente em uma conta de teste dedicada** 🔒 (criar uma conta nova exige sua autorização; **não** usar a conta real da dona nem a conta/dados da Camila): os lançamentos financeiros são append-only e **não podem ser apagados**, e **fechar o caixa do dia numa conta real trancaria um dia real**. Na conta de teste: item Financeiro visível; Visão geral carrega; despesa de teste cadastrada, paga parcialmente e quitada; recebimento em atendimento concluído de teste e estorno; fechamento do dia com contado igual ao esperado; relatório, Excel e PDF baixam; `GET /financeiro/alertas` responde. Os movimentos de teste permanecem no histórico da conta de teste (observação “TESTE”). Na conta real, depois do smoke, apenas **leitura** (Visão geral, Dashboard, Relatórios, A receber, lista de Despesas) — nenhuma gravação até você autorizar o uso. Se não houver conta de teste, o smoke com a flag ligada fica limitado a leituras e a gravação é validada pela própria dona no primeiro uso real.
**Sucesso:** todos os itens acima verdes; `audit_app_privileges` sem achado novo; erros 5xx = 0 nos primeiros 30 min; sem lentidão perceptível nas telas do Financeiro (não há medição de referência: é verificação visual, não uma meta numérica).
**Interrupção (antes da flag):** qualquer falha de migration, divergência do bloco de verificação, grant que aborte, bundle com URL errada → parar e seguir o item 9. **Interrupção (depois da flag):** 5xx recorrente no Financeiro, número divergente entre Dashboard/Relatório/Caixa, erro de permissão do banco → **desligar a flag** (item 9).

## 8. Retenção — proposta (nada será apagado agora)

**Escopo dos 90 dias:** somente *arquivos operacionais temporários* — arquivos de trabalho e saídas descartáveis geradas por rotinas/manutenção (ex.: exportações manuais de conferência, dumps de teste e logs de ensaio guardados em pastas de trabalho explicitamente marcadas). **Não se aplica**, em nenhuma hipótese, a: registros financeiros (movimentações, pagamentos, fechamentos, histórico), `financial_audit_log`, schemas `financeiro_arquivo_*`, backups diários (7 dias, política própria) e manuais, snapshots de exclusão de conta (30 dias, política própria, com `.retention-hold`), nem qualquer recurso necessário à recuperação.
**Desenho tecnicamente seguro (a implementar só com autorização):** (1) **lista de pastas permitidas** (allowlist) com um arquivo marcador `.operational-temp` criado por uma pessoa em cada pasta — fora delas, nada é tocado; (2) apenas arquivos regulares, idade por `mtime` > 90 dias, nunca links simbólicos, nome fora de `.retention-hold`; (3) **simulação por padrão** (lista o que removeria, com tamanho e hash) e `--apply` explícito; (4) `flock`, log append-only e limite de arquivos por execução; (5) o script se recusa a rodar se o caminho resolver para fora da allowlist ou para `/var/backups/nailflow/*.dump`, `deleted-professionals` ou qualquer schema/banco; (6) teste em diretório descartável (como `snapshot-retention.test.js`). **Pendente:** validação legal/LGPD do prazo e da classificação do que é “temporário”; o schema de arquivo e as exportações `pg_dump -n` continuam **sem prazo** até decisão separada.

## 9. Rollback compatível com dados financeiros

**Princípio: depois que existir um único recebimento, estorno, pagamento de despesa ou fechamento reais, as migrations 025–029 NÃO são revertidas.** Os `.down.sql` abortam sozinhos se houver dados (e a 025 só arquiva com confirmação explícita); reverter nesse cenário não é um procedimento de recuperação.
- **Problema no código/tela:** desligar a flag (linha do `.env` + `pm2 restart 0 --update-env`) — as rotas somem, Dashboard/Gastos voltam à regra antiga, **os dados e a estrutura ficam intactos**; se necessário, voltar o código anterior (`ea21c0a`; verificado em banco descartável com 025–029: Agenda, Gastos e Dashboard passam, ver item 4) e o `dist` anterior guardado. Reativar depois de corrigir. **Limitações do código antigo com dados financeiros reais** (efeito das proteções do banco, não perda de dado): excluir um atendimento que tenha recebimento, ou uma despesa que tenha pagamento, falha (erro 500 na tela antiga) em vez de apagar; e a tela antiga não enxerga os movimentos financeiros — por isso preferir desligar a flag a voltar o código.
- **Problema na migration, antes da flag e sem dados:** os rollbacks em ordem inversa (029 → 028 → 027 → 026 → 025), cada um aborta se houver dados; ou restaurar o dump do item 3.4 **somente enquanto nenhum dado novo tiver sido gravado desde o dump** (restaurar por cima de um banco que já recebeu movimentos perderia esses movimentos — nunca fazer isso depois de ligar a flag).
- **Corrupção/erro grave com dados:** não reverter; restaurar **em banco paralelo** a partir do dump e comparar; qualquer reconciliação é feita com novos lançamentos (estorno/correção/reabertura), nunca por edição ou exclusão. Decisão sua.
- Arquivos de rollback e dumps **não são apagados** em nenhum cenário.

## 10. Riscos

| Risco | Mitigação |
|---|---|
| Lock de tabela na migration (`appointments`, `expenses`) | `lock_timeout` 3 s, aborta sem efeito; repetir em horário calmo |
| Role `nailflow` com privilégios acima do necessário | auditoria somente leitura; decidir correção com você, nunca automática |
| Bundle com `localhost` embutido | validação do bundle antes de publicar (item 6) |
| Dois reinícios do backend (~10 s cada, modo fork) | horário de baixa movimentação; retry do n8n e deduplicação do bot cobrem o intervalo (`DEPLOY.md`) |
| Dependências novas (`exceljs`, `pdfkit`) ausentes no servidor | `npm ci --omit=dev` e verificação `node -e "import('exceljs')"` antes do reload |
| Indicadores mudam de critério ao ligar a flag (faturamento passa a recebido) | comunicar à usuária; ver nota abaixo |
| Despesas antigas ficam “a revisar” | esperado; alerta interno leva à revisão manual (nada é presumido) |
| Fuso/data | datas civis `AAAA-MM-DD`, “hoje” em `America/Sao_Paulo`; testado |
| Validação só em banco descartável e navegador local | smoke pós-publicação (item 7) |

**Limitações não validadas:** nada foi executado contra o banco/servidor de produção (versão do PostgreSQL, privilégios reais, volume); sem testes automatizados de componentes (interface verificada manualmente); exportações validadas por leitura do arquivo gerado, não por abertura em Excel/leitor de PDF; carga e concorrência real em produção não medidas.
**Nota de comportamento:** “Serviços mais realizados” no Dashboard ainda mostra a soma dos valores dos atendimentos concluídos (ranking de serviços, não receita); não foi alterado.

## 11. Ações que exigem sua autorização explícita

Leitura do estado do banco de produção; dump e prova de restauração; aplicação das migrations e dos grants; auditoria de privilégios; `npm ci`/instalação no servidor; build de produção; troca do `dist`; `pm2 reload`; edição do `.env`/ligar a flag; commit/push/merge do código; qualquer rotina de retenção ou remoção; decisão legal dos 90 dias.
