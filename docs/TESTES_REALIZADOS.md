# NailFlow — Testes Realizados

> Testes realizados durante as sessões de desenvolvimento (até 2026-10-03, `main` em `50906f5`).
> Os testes de 2026-09-24/25 estão na seção "V2 — mudanças de produção"; os de 2026-09-27, na seção "Fechamento técnico da V2"; os de 2026-10-02/03 (confirmação, sinal, expiração, página pública e aviso sem instância), na seção "Rodada de 2026-10-02/03 — produção".

**Tipos de validação usados neste documento:**
- 🧪 **Banco descartável** — banco criado só para o teste e apagado ao final; nada toca produção
- 🔍 **Somente leitura em produção** — apenas `SELECT`, `pg_dump -s` ou leitura do banco do n8n; nenhum dado alterado
- 📱 **WhatsApp real** — mensagem real passando pela Evolution. Entre 2026-09-25 e 2026-09-27 nenhum teste deste tipo foi feito (o `chip2` ficou desconectado de propósito); **depois da reconexão do `chip2` (2026-09-30) houve testes reais** — primeira mensagem (2026-09-30), agendamento e cancelamento com cliente real (2026-10-01), confirmação/recusa (2026-10-02) e os E2E de 2026-10-03 (ver "Rodada de 2026-10-02/03 — produção")
- 🌐 **Produção com dados de teste** — fluxo real em produção (backend, banco, n8n, Evolution) usando a profissional de teste e o número de teste da responsável, com limpeza das reservas de teste ao final
- Conferências estáticas (leitura de código, exports ou configuração) são indicadas como tal e não contam como teste executado

---

## Teste 1 — Fluxo WhatsApp completo (end-to-end)

**Data:** 2026-09-18  
**Cenário:** 2 números diferentes enviaram mensagens para o chip2

| Etapa | Resultado esperado | Resultado obtido | Status |
|---|---|---|---|
| Mensagem recebida pelo chip2 | Evolution detecta | ✅ detectou | ✅ |
| Evolution dispara webhook | POST whatsapp-nailflow | ✅ disparou | ✅ |
| n8n executa workflow | "WhatsApp NailFlow — Definitivo" success | ✅ 12+ execuções, todas success | ✅ |
| Bot responde ao número 1 (Maysa) | "Oi, Maysa! 😊 Seja bem-vinda!" | ✅ respondeu com nome | ✅ |
| Bot responde ao número 2 (Bárbara) | "Oi, Bárbara! 😊 Seja bem-vinda!" | ✅ respondeu com nome | ✅ |
| Conversa continua (Bárbara) | Menu + "Não entendi" + "Ok, entendi" | ✅ continuou 3 mensagens | ✅ |
| Abandono de conversa detectado | "NailFlow — Abandono de Conversa" executou | ✅ executou às 19:45 | ✅ |

**Observações:**
- Reconhecimento de nome funcionou (cliente já cadastrada no banco)
- Workflow executou em ~200ms (muito rápido)

---

## Teste 2 — Conexão chip2 (após loop de reconexão)

**Data:** 2026-09-18  
**Cenário:** chip2 estava preso em loop de reconexão por horas

| Etapa | Resultado esperado | Resultado obtido | Status |
|---|---|---|---|
| Esperar 4h sem tentativas | Rate limit do WA desaparece | ✅ desapareceu | ✅ |
| Gerar QR único | QR gerado | ✅ gerado (code field) | ✅ |
| Escanear QR | chip2 conectado | ✅ connectionStatus: open | ✅ |
| Webhook intacto após reconexão | POST whatsapp-nailflow | ✅ manteve | ✅ |
| Histórico de mensagens preservado | Mensagens anteriores no banco | ✅ preservado | ✅ |

---

## Teste 3 — Boas-vindas personalizadas

**Cenário:** cliente conhecida (cadastrada) envia mensagem

| Etapa | Status | Observação |
|---|---|---|
| Nome da cliente reconhecido | ✅ | Usa `clients.name` do banco |
| Histórico de serviço mencionado | PRECISA VERIFICAR | `getLastCompletedService` implementado, resultado em teste |
| Saudação pela hora do dia | PRECISA VERIFICAR | Pode variar por timezone |

---

## Teste 4 — n8n webhook execução

**Cenário:** verificação pós-conexão do chip2

| Item | Status |
|---|---|
| webhook `whatsapp-nailflow` ativo e respondendo | ✅ |
| Execuções registradas no SQLite | ✅ |
| Status de todas as execuções: success | ✅ |

---

## Testes de API (automatizados)

Executados com `npm test` (`node --test tests/*.test.js`) 🧪 **sempre em banco descartável**, com as URLs do n8n vazias e `EVOLUTION_API_URL` apontando para um endereço inexistente (os testes gravam no banco de `DATABASE_URL`).

**Estado atual (2026-10-03, `main` em `50906f5`): 288 testes — 276 passam, 12 falham** (as **12 falhas conhecidas**: 9 testes antigos que esperam `body.token` no login — `auth-flow` 2, `availability-check` 1, `price-snapshot` 6 — e 3 do bot em `bot-contextual` que dependem do dia da semana; ver I14 em [`PENDENCIAS.md`](./PENDENCIAS.md)). Rodada em banco descartável montado com `schema.sql` → migrations 002, 001, 003–022 → `seed.sql`; nenhuma das 12 é regressão de produção, e nenhuma falha nova apareceu nos arquivos de confirmação, sinal, página pública, dashboard e aviso interno.

**Histórico (2026-09-27): 57 testes — 57 passam, 0 falham**, em dois bancos descartáveis (A e B) montados com `schema.sql` → migrations 002, 001, 003–014 → `seed.sql`, com resultado idêntico teste a teste. Ver Teste 17.

- Arquivos (em 2026-09-27): `health`, `auth-flow`, `availability-check`, `availability-slots`, `price-snapshot`, `rate-limit`, `notify-n8n`, `nullable-fields`, `phone` (novo), `reply-classifier` (novo). Adicionados depois: testes de administração (`admin-*`), página pública (`public-*`), antecedência mínima (`customer-min-notice`), confirmação/recusa (`appointment-confirmation`), regras de reserva e expiração (`booking-rules`), sinal por Pix (`deposit-flow`), bot contextual (`bot-contextual`, `conversation-context`), card da Início (`dashboard-awaiting`, 4 testes) e aviso interno sem instância/telefone normalizado (`public-created-instance`, 5 testes, e 3 testes novos em `phone`)
- Histórico: até a correção de 2026-09-27 a suíte tinha 30 falhas antigas (seed e setups de teste sem `slug`); ver Teste 17

---

## V2 — mudanças de produção (2026-09-24 e 2026-09-25)

### Teste 5 — Antecedência máxima (`booking_horizon_days`)

Via API pública, com valores temporários restaurados para 60 ao final.

| Cenário | Resultado | Status |
|---|---|---|
| Camila com 30 dias → `/public/camila-nails-studio/availability?days=365` | 26 dias com horários (dentro de 30) | ✅ |
| Simone com 90 dias → `/public/studio-simone-teles/availability?days=365` | 64 dias com horários (dentro de 90) | ✅ |
| Cada profissional com sua própria janela | isolado por `professional_id` | ✅ |

Agenda interna (limite de navegação dia/semana/mês): build sem erros; **não testada no navegador**.

### Teste 6 — Fechamentos (`recurring_exceptions`)

Exceções temporárias na conta de teste, removidas ao final.

| Cenário | Resultado | Status |
|---|---|---|
| 3º sábado (17/10/2026) | ausente da disponibilidade pública | ✅ |
| Data específica (15/10/2026) | ausente | ✅ |
| Período 19–25/10 (sexta 23/10 dentro, segunda 26/10 fora) | bloqueado dentro, livre fora | ✅ |
| Segundo período 03–07/11 (sexta 06/11 dentro, segunda 09/11 fora) | bloqueado dentro, livre fora | ✅ |
| Camila (sem exceções) nas mesmas datas | datas disponíveis | ✅ isolamento |
| `days=20` vs `days=60` | exceções respeitadas junto com o horizonte | ✅ |

> Domingos aparecem como indisponíveis para ambas as contas por serem folga no expediente — não é efeito das exceções.
> A criação de agendamento dentro de um fechamento é recusada porque `checkSlotAvailability` aplica a mesma regra; isso foi confirmado pela ausência dos dias na disponibilidade, não por uma tentativa real de criar agendamento.

### Teste 7 — Onboarding (`GET /onboarding/status`)

| Conta | Resultado | Status |
|---|---|---|
| Camila | 4/4 → card não aparece | ✅ |
| Teste NailFlow | 3/4 (instância `chip2-teste` sem conexão real) | ✅ |
| Simone | 2/4 (sem telefone e sem WhatsApp) | ✅ |
| Admin | 403 | ✅ |
| Sem sessão | 401 | ✅ |
| Conta temporária: recém-cadastrada → telefone+serviço+só folga → +dia de atendimento e instância inexistente → +cliente | 0/4 → 2/4 → 3/4 → 3/4 (folga não conta; instância sem conexão não conta; cliente é opcional) | ✅ |

Card e aviso da Disponibilidade: presentes no bundle; **não testados visualmente no navegador**.

### Teste 8 — Bot após a correção do `$1`

| Etapa | Resultado | Status |
|---|---|---|
| `/health` | 200 | ✅ |
| Query `SELECT booking_horizon_days … WHERE id = $1` | retornou 60 | ✅ |
| `/bot/process` "oi" → "1" → "1" (telefone de teste) | 200 · menu → serviços → 5 datas | ✅ |
| Estado final | `AGUARDANDO_DATA` | ✅ |

Dados do telefone de teste removidos após o teste.

### Teste 9 — Migrations 007–010 (banco descartável)

| Etapa | Resultado | Status |
|---|---|---|
| Base: `schema.sql`, `002_bot_tables` (hoje obsoleta, ver Teste 12), 001, 003–006 | sem erro | ✅ |
| 007 → 008 → 009 → 010 | sem erro | ✅ |
| Segunda execução (idempotência) | sem erro | ✅ |
| Colunas, restrições e índices de 007–010 comparados com produção | idênticos | ✅ |

> A comparação de 2026-09-25 cobriu só as estruturas de 007–010. A auditoria completa de 2026-09-27 (Teste 12) encontrou outras 51 divergências no restante do schema.
| Banco temporário removido | sim | ✅ |

### Teste 10 — Firewall (UFW)

| Verificação | Resultado | Status |
|---|---|---|
| Nova conexão SSH após ativar | OK | ✅ |
| Backend, n8n e Evolution locais | 200 | ✅ |
| HTTPS do site, `/api/health`, n8n e Evolution | 200 | ✅ |
| Evolution → n8n pela 443 (caminho dos webhooks) | 200 | ✅ |
| `chip2` | `open` | ✅ |
| Externo: 22/80/443 abertas, 3333/5678 fechadas | confirmado | ✅ |

Não houve mensagem real de WhatsApp durante a validação; o caminho foi testado pelas chamadas acima.

### Teste 11 — Recuperação e troca de senha (ambiente isolado, NÃO publicado)

- 53 de 53 verificações de backend em `/opt/nailflow-next`, com banco descartável e SMTP simulado: resposta genérica, token só em hash, expiração, uso único, rate limits, invalidação de sessões, `requireAdmin`, cookie `HttpOnly; Secure; SameSite=Lax`
- Fluxo no navegador contra a API de teste
- **Não houve envio real de e-mail (Brevo não configurado) e nada foi publicado**


---

## Fechamento técnico da V2 (2026-09-27)

### Teste 12 — Migrations × schema de produção 🧪 🔍

Auditoria: catálogo de produção (somente leitura) comparado com bancos descartáveis montados só pelo que está versionado — tabelas, colunas, tipos, nullable, defaults, PK, FK, UNIQUE, CHECK, índices, triggers, funções, extensões e comentários.

| Etapa | Resultado | Status |
|---|---|---|
| Antes (ordem antiga, com `002_bot_tables`) | 51 divergências | ❌ |
| Banco vazio A: `schema.sql` → 002 oficial → 001, 003–014 | 15 arquivos sem erro | ✅ |
| A × produção | 11/11 tabelas, 98/98 colunas, 46/46 restrições, 6/6 triggers, 190/190 funções, 2/2 extensões idênticas; 30 dos 31 índices | ✅ |
| Banco vazio B, mesma sequência | 15 arquivos sem erro; mesmas diferenças | ✅ |
| A × B (reprodutibilidade) | 0 diferenças | ✅ |
| Reaplicar todas as migrations em A (idempotência) | 14 sem erro | ✅ |
| Cópia do schema de produção (`pg_dump -s`) + todas as migrations | sem erro e sem mudança de estrutura | ✅ |
| Bancos descartáveis removidos | sim | ✅ |

Diferenças restantes (justificadas): índice duplicado `message_history_dedup_idx` (só em produção; remoção adiada) e 6 comentários. Na cópia via `pg_dump`, 5 CHECKs aparecem com a expressão reescrita pelo próprio `pg_dump` (mesmo significado; inclui um CHECK que nenhuma migration toca). Produção recebeu apenas `SELECT` e `pg_dump -s`; **nenhuma migration foi executada em produção**.

### Teste 13 — Classificador sim/não e cabeçalho dos webhooks

| Teste | Tipo | Resultado |
|---|---|---|
| Testes automatizados de `classifyReply` e `notifyN8n`, local e no servidor | 🧪 | 14 de 14 ✅ |
| "segunda seria melhor", "sei lá", "sábado dá?", "na verdade sim" | 🧪 | não confirmam (pedem de novo) ✅ |
| "sim", "sim, pode" → confirmam; "não" → nega; "não sei" → pede de novo | 🧪 | ✅ |
| `notifyN8n` com `fetch` simulado, sem rede | 🧪 | cabeçalho enviado quando o segredo existe, ausente quando não existe ✅ |
| Credenciais do n8n e `headers` da Evolution (2 instâncias) × `.env` | conferência | valores conferem ✅ |
| Versões publicadas (export oficial) | conferência | `headerAuth` e credencial certa nos 2 webhooks ✅ |
| Webhooks registrados após reinício do n8n | 🔍 | `whatsapp-nailflow` e `nailflow/notificacoes` ativos ✅ |
| 403 sem cabeçalho | — | **não testado** (por decisão, sem POST externo nos webhooks) |
| Mensagem real passando pelo webhook autenticado | 📱 | **não testado** — instâncias desconectadas |

### Teste 14 — Isolamento de `clientId` nos agendamentos 🧪

13 de 13 verificações, com duas profissionais (A e B):
- A cria e edita agendamento com cliente própria → 201 / 200; edição sem `clientId` → 200
- A usando cliente de B (criar ou editar) → 400 "Cliente inválido."; mesma resposta para ID inexistente; nenhum agendamento extra criado; agendamento editado mantém a cliente original
- B nas mesmas situações → 201 / 400; cada uma lista só os seus agendamentos; B alterando agendamento de A → 404

### Teste 15 — Normalização de telefone 🧪 🔍

| Teste | Tipo | Resultado |
|---|---|---|
| Bot antes × depois da troca para `utils/phone.js`: 123 entradas reais (conversas, clientes e JIDs) + 64 buscas | 🔍 leitura, comparação offline | 0 diferenças ✅ |
| Cadastro: normalizado, com máscara, com +55, formato comum | 🧪 | 201, gravado `55` + DDD + 8 dígitos ✅ |
| Inválidos (`123`, 9 e 15 dígitos, `abc`) | 🧪 | 400 ✅ |
| Duplicado na mesma profissional (4 formatos) e edição para o número de outra cliente | 🧪 | 409 ✅ |
| Mesmo número em duas profissionais; isolamento de leitura e edição | 🧪 | ✅ |
| Fichas antigas inválidas: editar só nome/notas mantém o telefone | 🧪 | ✅ |
| Bot encontra fichas de 12 e 13 dígitos; ficha sem `55` continua não encontrada | 🧪 | ✅ (comportamento preservado) |
| **Total** | | API 26 de 26; unitários 4 de 4 |

Produção: 13 clientes, mesmo hash antes e depois (nenhum dado alterado).

### Teste 16 — Crons de Abandono e Lembretes após a correção 🔍

| Verificação | Resultado |
|---|---|
| Abandono, execução 11225 (13:45 UTC), conferida node a node | 2 instâncias pela saída `loop`, busca uma vez por instância sem erro, fim pela saída `done`, nenhum envio ✅ |
| Execuções de 13:45 a 17:15 UTC (leitura do banco do n8n) | Abandono 15 `success`, Lembretes 7 `success` ✅ |
| Loops internos com itens e envio real de abandono/lembrete | **não validado** (sem itens na execução conferida; instâncias desconectadas) |

### Teste 17 — Seed e suíte automatizada completa 🧪

Sequência de correções (só em `backend/db/seed.sql` e `backend/tests/`; nenhum código da aplicação, schema ou migration alterado):

| Etapa | Correção | Resultado da suíte |
|---|---|---|
| Início | — | 58 testes: 28 passam, 30 falham |
| 1 | `seed.sql`: inclusão de `professionals.slug` (`camila-nails-studio`); ID e login da conta de exemplo mantidos | 35 passam, 23 falham (os 7 de `nullable-fields` passaram a funcionar) |
| 2 | `availability-check`, `availability-slots` e `price-snapshot`: `slug` fictício e fixo no `INSERT INTO professionals` do setup | 57 testes: 51 passam, 6 falham. O total caiu para 57 porque a falha do hook `after` de `availability-check`, contada como item, deixou de existir |
| 3 | `price-snapshot`: telefone válido no setup (`55319` + 8 dígitos de `Date.now()`); o anterior tinha 13 dígitos sem o 9 e era recusado (400) pela validação de telefone, que está correta | **57 passam, 0 falham** |

- Executado em dois bancos descartáveis (A e B), cada um com `schema.sql` → migrations → `seed.sql` → suíte completa; A e B idênticos teste a teste; bancos removidos ao final
- Nenhum teste que passava antes passou a falhar
- Seed conferido em banco limpo: 1 profissional (com `slug`), 5 serviços, 7 dias de expediente, 3 clientes; 0 restrições não validadas
- Execução com as URLs do n8n vazias e `EVOLUTION_API_URL` apontando para endereço inexistente; produção não recebeu escrita

---

## Rodada de 2026-10-02/03 — produção (🌐 dados de teste)

Número de teste da responsável (`553185108190`, cliente "Simone Teles") na profissional de teste `camila-nails-studio`, salvo indicação. A configuração da Camila foi alterada temporariamente em cada cenário e **restaurada** (`manual`, sem sinal, sem Pix, sem tipo/valor); as reservas de teste foram canceladas sem mensagem, e o agendamento antigo da Simone (05/10 13:00) ficou intacto.

| Teste | Resultado | O que foi comprovado |
|---|---|---|
| **E2E cenário 1 — automático sem sinal** | ✅ aprovado pela responsável | A mensagem de confirmação chegou ao WhatsApp de teste (confirmado por ela). Demais detalhes não reconferidos na consolidação |
| **E2E cenário 2 — manual** | ✅ aprovado pela responsável | Reserva `pendente` e confirmação pela profissional; o passo de confirmação foi feito chamando a função real do controller, sem login (desvio declarado; a rota autenticada tem testes automatizados). Demais detalhes não reconferidos |
| **E2E cenário 3 — automático + sinal 50%** | ✅ passou | Nasceu `aguardando_pagamento`, `deposit_cents` 1750 de 3500, validade de 2 h; resposta pública só com os campos esperados; 1 mensagem de instruções (Pix fictício) pelo `NfMensagemCliente01`; "Pagamento recebido" pela **interface real** da Agenda (`POST …/mark-paid` → 200 no Nginx) → `confirmado`, `paid_at` preenchido, `expires_at` nulo; exatamente 1 `appointment.confirmed` (#14766) e 1 mensagem de confirmação; repetição idempotente (`changed:false`, sem mensagem — feita chamando a função real do controller, sem passar pela interface) |
| **E2E cenário 4 — expiração** | ✅ passou | `expires_at` forçado ao passado só nessa reserva; o sweeper real cancelou em ~56 s com `cancel_reason='expired'`, `paid_at` nulo; horário liberado; nenhuma mensagem de confirmação ou cancelamento; nenhuma outra reserva afetada |
| Investigação das execuções #14772/#14773 | ✅ conclusão registrada | Mensagens reais recebidas ("Arrasou", "Top de mais"), respondidas pelo fluxo normal do bot; quem as digitou e a relação com o cenário 4 **não foram determinados** (M15 em [`PENDENCIAS.md`](./PENDENCIAS.md)) |
| **Smoke — página pública no celular** (375×812, `camila-nails-studio`) | ✅ passou | Serviço antes do horário; scroll até o formulário (totalmente visível); "Horário escolhido"; revisão; envio → 201; tela de sucesso; sem overflow horizontal; reserva `pendente` com validade de 24 h e mensagem de recebimento enviada |
| **E2E — `public_created` sem instância** (`studio-simone-teles`, `wa_instance_name` nulo) | ✅ passou | Reserva pela página pública → 201, `pendente`, visível na Agenda/Início; **0 execuções** de "Notificações" e nenhuma chamada de envio à Evolution (o evento `message.send` à cliente chegou ao n8n e terminou em `sem_instancia`, sem envio); nenhum outro agendamento afetado. A reserva, a ficha do cliente fictício e o agendamento cancelado foram removidos depois |

**Validação manual da Home e da Agenda (relatada pela responsável, após o deploy de `3bcbb1a`, 2026-10-03):** o card "Precisa da sua ação" apareceu com contadores e validade corretos; "Ver na Agenda" abriu o agendamento correto; os botões do detalhe funcionaram; e o parâmetro `abrir` foi removido da URL depois do uso. Este registro é o **relato da responsável**; ele não vem de observação automatizada. As evidências **independentes** que o corroboram estão separadas: testes automatizados (`dashboard-awaiting`), consulta do card no banco e logs do Nginx de 2026-10-03 (16:03–16:04 UTC: carga da Início, Agenda aberta no dia 08/10, `POST /appointments/:id/confirm` → 200).

**Não validado (não registrar como "passou"):**
- Entrega real do aviso interno à profissional (`public_created`): o telefone cadastrado da Camila é placeholder; a normalização do telefone foi validada **só por testes automatizados**.
- Recebimento real de um lembrete ou aviso de abandono enviados pelos crons.

---

## Admin — Auditoria v1 (2026-10-03, `12dcff7`)

| Teste | Resultado | O que foi comprovado |
|---|---|---|
| **Testes automatizados novos** (`admin-audit-log-list.test.js`, 8) 🧪 | ✅ passaram | 401 sem login e 403 para não admin; ordem do mais recente ao mais antigo e conjunto exato de campos (sem dados sensíveis); paginação; filtro por ação (`all`/vazio sem filtro); filtro de período em dias inteiros de São Paulo; resumo; 400 para parâmetros inválidos; `POST`/`PUT`/`PATCH`/`DELETE` em `/admin/audit-log` → 404 e log inalterado. Rodados em worktree limpo, banco descartável, **sem** o `.env` de produção |
| Suíte completa 🧪 | ✅ sem regressão | 296 testes, 284 passando, 12 falhas conhecidas (as mesmas de antes: 9 de `body.token` + 3 do bot dependentes de data). `tsc` e `vite build` ok; sem overflow horizontal em 375×812, 768 e 1024 px (prévia com API simulada) |
| Prévia visual com dados fictícios (API simulada, só na prévia) | ✅ revisada pela responsável | Estados preenchido, paginação, filtros, detalhe expansível, vazio e erro; prévia encerrada depois |
| Limpeza do `admin_audit_log` 🌐 | ✅ concluída | 104 → 0 registros, todos de `admin_*_test@nailflow.com`; backup CSV+SQL em `/var/backups/nailflow/manual/` verificado (104 linhas cada); demais tabelas idênticas |
| **Deploy e checks em produção** 🌐 | ✅ passaram | Backend saudável; `/admin`, `/admin/auditoria`, `/login` 200; `GET /admin/audit-log` sem login → 401 |
| **Validação manual com login real** 🌐 (relatada pela responsável) | ✅ aprovada | Auditoria validada manualmente; um bloqueio feito pela interface funcionou e apareceu na Auditoria; conferido somente leitura no banco: 1 registro (`block`, `admin@nailflow.internal` → "NailFlow Teste"), o primeiro registro real |

**Incidente (2026-10-03):** a suíte backend foi executada inadvertidamente na árvore de produção. O `.env` de produção continha integrações externas (n8n/Evolution), e a execução gerou cerca de 45 execuções fictícias no n8n. Não houve entrega de mensagem pelo WhatsApp nem alteração no banco de produção (a suíte usou um banco descartável). As validações posteriores foram feitas em cópias isoladas (worktree sem `.env` e banco descartável). As execuções fictícias permanecem no histórico do n8n.

---

## Testes PENDENTES (não realizados)

> Atualizado em 2026-10-03: as quatro primeiras linhas já foram realizadas (indicado na coluna Observação) e ficam aqui como histórico.

| Cenário | Prioridade | Observação |
|---|---|---|
| Primeira mensagem real após reconectar o `chip2` (webhook com Header Auth) | 🔴 Crítico | **Realizado em 2026-09-30** (C1). Se der 403, o bot fica mudo — ver rollback em [`N8N.md`](./N8N.md) |
| Agendamento completo pelo WhatsApp com cliente real | 🔴 Crítico | **Realizado em 2026-10-01** (C2). Antes: validado apenas via `/bot/process` com telefone de teste (2026-09-24) |
| Cancelamento pelo WhatsApp | 🔴 Crítico | **Realizado em 2026-10-01** (C3) |
| Confirmação sim/não pelo WhatsApp com o novo classificador | 🔴 Crítico | Exercitada nos fluxos reais C2/C3 (2026-10-01); o classificador em si tem testes automatizados |
| Lembrete de agendamento enviado | 🟠 Importante | Cron corrigido; envio real ainda não exercitado |
| Mensagem de abandono enviada | 🟠 Importante | Cron corrigido; envio real ainda não exercitado |
| Notificação de confirmação/cancelamento pelo painel com o cabeçalho | 🟠 Importante | |
| Agenda (limite de navegação), card de onboarding e aviso da Disponibilidade no navegador | 🟠 Importante | Só build e API testados |
| Criar agendamento dentro de um fechamento (tentativa real) | 🟠 Importante | |
| Modo atendimento humano → retorno automático após 4h | 🟠 Importante | |
| Frase de escape → ATENDIMENTO_HUMANO | 🟠 Importante | |
| 3 entradas inválidas → ATENDIMENTO_HUMANO | 🟠 Importante | |
| Conexão WhatsApp via painel (QR pelo sistema) | 🟠 Importante | Com instância de teste |
| Envio real de e-mail de recuperação | 🟠 Importante | Depende do Brevo e da publicação |
| Agendamentos recorrentes | 🟡 Melhoria | |
