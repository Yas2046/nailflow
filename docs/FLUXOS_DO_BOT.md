# NailFlow — Fluxos do Bot

## Máquina de estados

O estado da conversa é salvo por `(professional_id, phone)` na tabela `conversation_states`.

### Estados disponíveis

| Estado (`bot_state`) | Descrição |
|---|---|
| `INICIO` | Primeiro contato ou retorno após inatividade |
| `MENU` | Menu principal exibido, aguardando opção |
| `AGUARDANDO_SERVICO` | Lista de serviços exibida, aguardando o número do serviço |
| `AGUARDANDO_DATA` | Datas disponíveis exibidas, aguardando a escolha |
| `AGUARDANDO_HORARIO` | Horários do dia exibidos, aguardando a escolha |
| `AGUARDANDO_CONFIRMACAO_AGENDAMENTO` | Cliente escolheu serviço + horário, aguarda confirmação (S/N) |
| `AGUARDANDO_CANCELAMENTO` | Aguardando o cliente informar qual agendamento cancelar |
| `AGUARDANDO_CONFIRMACAO_CANCELAMENTO` | Aguardando confirmação do cancelamento (S/N) |
| `AGUARDANDO_REPETICAO` | Cliente conhecida: oferta de repetir o último serviço (sim/não) |

### Modos

| Modo | Descrição |
|---|---|
| `BOT_ATIVO` | Bot responde automaticamente |
| `ATENDIMENTO_HUMANO` | Bot silencioso, profissional atende manualmente |

---

## Diagrama de fluxo

```
[Mensagem recebida]
        │
        ├── É mensagem da profissional? → ATENDIMENTO_HUMANO (até 4h sem nova mensagem dela)
        │
        ├── Tem frase de escape? (ex: "falar com atendente") → ATENDIMENTO_HUMANO
        │
        ├── Comando "voltar"? → volta 1 nível
        │
        └── Processa por estado:

INICIO
  ├── Cliente novo → cadastra, boas-vindas + pergunta nome OU MENU se já cadastrado
  ├── Cliente existente com agendamento próximo → MENU personalizado
  └── → MENU

MENU  (1 Agendar · 2 Cancelar · 3 Ver meus agendamentos · 4 Falar com a profissional)
  ├── "1" ou agendar → AGUARDANDO_SERVICO → AGUARDANDO_DATA → AGUARDANDO_HORARIO → confirmar → cria agendamento
  ├── "2" ou cancelar → lista agendamentos → confirmar → cancela
  ├── "3" → lista os agendamentos da cliente
  ├── "4" ou falar com a profissional → ATENDIMENTO_HUMANO
  ├── saudação (oi, olá) → re-executa INICIO
  ├── entrada inválida (3x) → ATENDIMENTO_HUMANO automático
  └── → permanece em MENU

AGUARDANDO_CONFIRMACAO_AGENDAMENTO   (classifyReply 'booking')
  ├── sim → cria agendamento → notifica n8n (nailflow/notificacoes) → MENU
  ├── não → MENU
  └── ambíguo/inválido → pede de novo

AGUARDANDO_CANCELAMENTO
  ├── número do agendamento → exibe detalhes → AGUARDANDO_CONFIRMACAO_CANCELAMENTO
  └── "cancelar" / "0" → MENU

AGUARDANDO_CONFIRMACAO_CANCELAMENTO  (classifyReply 'cancel')
  ├── sim → cancela agendamento → notifica n8n (nailflow/notificacoes) → MENU
  ├── não → mantém o agendamento → MENU
  └── ambíguo/inválido → pede de novo

AGUARDANDO_REPETICAO                 (classifyReply 'repeat')
  ├── sim → segue com o último serviço
  ├── não / "voltar" / pedido de outras opções → MENU
  └── ambíguo/inválido → pede de novo
```

---

## Respostas sim/não (`classifyReply`)

Desde 2026-09-27 as três confirmações acima usam `backend/src/utils/replyClassifier.js`, que devolve `yes`, `no` ou `unknown`:

- O texto é normalizado (minúsculas, sem acentos e sem pontuação); **só a primeira palavra inteira decide**, com no máximo 4 palavras
- `sim` só vale se não houver negação na frase; `não` só vale se as palavras seguintes forem neutras ("não, obrigada")
- Palavras aceitas por contexto:
  | Contexto | Sim | Não |
  |---|---|---|
  | `booking` (confirmar agendamento) | s, sim, ss, yes, ok, confirma, confirmo, confirmar, pode, isso, certo, claro, beleza, blz | n, não, nope, negativo; frase "cancela"/"cancelar" |
  | `cancel` (confirmar cancelamento) | s, sim, ss, yes, ok, confirma, confirmo, pode, cancela, cancelar | n, não, nope, negativo; frases "manter", "mantém", "não cancela" |
  | `repeat` (repetir último serviço) | s, sim, ss, yes, ok, quero, pode, bora, vamos, claro, isso; "com certeza" | n, não, nope, negativo; "outro(s)/outra(s)/opções…", "ver opções", "menu" |
- **Motivo:** antes, respostas como "segunda seria melhor" ou "sei lá" podiam ser tomadas como confirmação (começam com "s")
- Testes: ver [`TESTES_REALIZADOS.md`](./TESTES_REALIZADOS.md), Teste 13. Ainda **sem teste real pelo WhatsApp** (instâncias desconectadas)

## Telefone da cliente

O bot usa `backend/src/utils/phone.js` (`cleanPhone`, `normalizeBrPhone`, `findClientByPhone`), a mesma regra do cadastro do painel. A troca, em 2026-09-27, foi feita sem mudar o comportamento: comparação com 123 entradas reais e 64 buscas deu 0 diferenças. Fichas antigas gravadas sem o `55` continuam não sendo encontradas pelo bot (comportamento anterior preservado).

---

## Proteções implementadas

### Anti-loop
- Entrada inválida 3x seguidas no MENU → muda automaticamente para ATENDIMENTO_HUMANO

### Deduplicação de mensagens
- `wa_message_id` salvo em `message_history` com índice UNIQUE por `(professional_id, wa_message_id)`
- Mensagem duplicada (mesmo ID) é ignorada silenciosamente

### TTL do atendimento humano
- Modo `ATENDIMENTO_HUMANO` retorna automaticamente para `BOT_ATIVO` após **4 horas** sem mensagem da profissional (medido pela última mensagem enviada por ela em `message_history`)
- Em `BOT_ATIVO`, 4 horas sem mensagem reiniciam a conversa em `INICIO`

### Frases de escape
- Qualquer mensagem contendo "falar com atendente", "humano", "pessoa real" etc. → ATENDIMENTO_HUMANO imediato

---

## Mensagens enviadas pela profissional

Se a profissional enviar uma mensagem diretamente pelo WhatsApp para uma cliente em `BOT_ATIVO`:
- Bot muda para `ATENDIMENTO_HUMANO`
- n8n registra a mensagem via `POST /bot/record-sent`

---

## Contexto da conversa

O campo `context` (jsonb) em `conversation_states` guarda dados temporários entre estados:

| Chave | Presença | Descrição |
|---|---|---|
| `selectedServiceId` | AGUARDANDO_CONFIRMACAO_AGENDAMENTO | Serviço escolhido |
| `selectedSlot` | AGUARDANDO_CONFIRMACAO_AGENDAMENTO | Horário escolhido |
| `retryCount` | MENU | Contador de entradas inválidas |
| `pendingAppointmentId` | AGUARDANDO_CANCELAMENTO | ID do agendamento para cancelar |
| `lastServiceName` | INICIO | Último serviço realizado (personalização) |

---

## Datas e horários oferecidos pelo bot

- Ao escolher o serviço, o bot chama `getAvailableDaysWithSlots(professionalId, duração)`:
  - lê `booking_horizon_days` da profissional (padrão 60)
  - varre de **amanhã** até o limite, parando ao encontrar **5 dias** com horários
  - cada dia usa `getAvailableSlots`, que já aplica expediente, fechamentos (`recurring_exceptions`), intervalo, bloqueios e agendamentos
- A regra é a mesma da página pública e da Agenda (centralizada em `utils/availability.js`)

### Correção do `$1` em `getAvailableDaysWithSlots` (2026-09-24)

- **Sintoma:** o bot parava de responder logo depois que a cliente escolhia o serviço
- **Causa:** a query `SELECT booking_horizon_days FROM professionals WHERE id = $1` foi gravada sem o `$1` (o placeholder se perdeu numa edição feita via shell), gerando `syntax error at end of input` → HTTP 500 no `/bot/process`
- **Efeito colateral:** o n8n repetia a chamada; como a mensagem já estava gravada, o backend respondia `duplicate` e a cliente ficava sem resposta, com a conversa parada em `AGUARDANDO_SERVICO`
- **Correção:** `$1` restaurado (arquivo editado localmente e enviado via SCP); versionada em `b26d682`
- **Validação:** sequência "oi" → "1" → "1" em `/bot/process` com telefone de teste retornou HTTP 200 e 5 datas; estado avançou para `AGUARDANDO_DATA`
- **Aprendizado:** não editar código via SSH com strings que contenham `$`

---

## Abandono de conversa

O workflow **"NailFlow — Abandono de Conversa"** (cron, a cada 15 min):
1. Chama `GET /bot/abandoned-conversations` (para cada instância de `GET /bot/instances`)
2. Backend retorna conversas em `BOT_ATIVO` sem mensagem há mais de **30 minutos**
3. Workflow envia mensagem de retorno pelo WhatsApp
4. Chama `POST /bot/mark-abandonment-notified`

- O loop percorre todas as instâncias; uma instância sem resultados não interrompe as seguintes (Always Output Data no node de busca)
- **Falhou de 2026-09-21 17:15 UTC até 2026-09-27** (400 e depois `Invalid expression`); **corrigido em 2026-09-27** — saídas do loop, Always Output Data. Detalhes em [`N8N.md`](./N8N.md)
- Validado em execução real sem itens (13:45 UTC); o envio de uma mensagem de abandono ainda não foi exercitado após a correção

---

## Lembretes de agendamento

O workflow **"NailFlow — Lembretes de Agendamento"** (cron, a cada 30 min):
1. Chama `GET /bot/appointments-tomorrow` (para cada instância)
2. Backend retorna agendamentos que começam entre 23h30 e 24h30 a partir de agora, com `reminder_sent = false`
3. Workflow envia lembrete pelo WhatsApp
4. Chama `POST /bot/mark-reminder-sent`
5. Backend atualiza `reminder_sent = true` → previne duplicata

- **Falhou de 2026-09-21 17:30 UTC até 2026-09-27**; **corrigido em 2026-09-27** — saídas do loop, Always Output Data e condição de "Tem lembretes?" (`{{ $json.id }}` não vazio, avaliada item a item). Detalhes em [`N8N.md`](./N8N.md)
- Execuções `success` desde 14:00 UTC de 2026-09-27; **nenhum lembrete real enviado após a correção** (o `chip2` e o `chip2-teste` estão desconectados, então um envio não chegaria a ninguém)
