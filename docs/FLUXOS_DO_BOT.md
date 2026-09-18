# NailFlow — Fluxos do Bot

## Máquina de estados

O estado da conversa é salvo por `(professional_id, phone)` na tabela `conversation_states`.

### Estados disponíveis

| Estado (`bot_state`) | Descrição |
|---|---|
| `INICIO` | Primeiro contato ou retorno após inatividade |
| `MENU` | Menu principal exibido, aguardando opção |
| `AGUARDANDO_CONFIRMACAO_AGENDAMENTO` | Cliente escolheu serviço + horário, aguarda confirmação (S/N) |
| `AGUARDANDO_CANCELAMENTO` | Aguardando o cliente informar qual agendamento cancelar |
| `AGUARDANDO_CONFIRMACAO_CANCELAMENTO` | Aguardando confirmação do cancelamento (S/N) |

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
        ├── É mensagem da profissional? → ATENDIMENTO_HUMANO (até 2h de inatividade)
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

MENU
  ├── "1" ou agendar → lista serviços → data/hora → confirmar → cria agendamento
  ├── "2" ou cancelar → lista agendamentos → confirmar → cancela
  ├── "3" ou falar com atendente → ATENDIMENTO_HUMANO
  ├── saudação (oi, olá) → re-executa INICIO
  ├── entrada inválida (3x) → ATENDIMENTO_HUMANO automático
  └── → permanece em MENU

AGUARDANDO_CONFIRMACAO_AGENDAMENTO
  ├── "sim" / "s" / "1" → cria agendamento → notifica n8n (⚠️ quebrado) → MENU
  ├── "não" / "n" / "2" → volta ao menu de horários → MENU
  └── inválido → re-exibe confirmação

AGUARDANDO_CANCELAMENTO
  ├── número do agendamento → exibe detalhes → AGUARDANDO_CONFIRMACAO_CANCELAMENTO
  └── "cancelar" / "0" → MENU

AGUARDANDO_CONFIRMACAO_CANCELAMENTO
  ├── "sim" → cancela agendamento → notifica n8n (⚠️ quebrado) → MENU
  └── "não" → MENU
```

---

## Proteções implementadas

### Anti-loop
- Entrada inválida 3x seguidas no MENU → muda automaticamente para ATENDIMENTO_HUMANO

### Deduplicação de mensagens
- `wa_message_id` salvo em `message_history` com índice UNIQUE por `(professional_id, wa_message_id)`
- Mensagem duplicada (mesmo ID) é ignorada silenciosamente

### TTL do atendimento humano
- Modo `ATENDIMENTO_HUMANO` retorna automaticamente para `BOT_ATIVO` após 2 horas sem mensagem da profissional

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

## Abandono de conversa

O workflow **"NailFlow — Abandono de Conversa"** (cron, schedule):
1. Chama `GET /api/bot/abandoned-conversations`
2. Backend retorna conversas em `BOT_ATIVO` sem mensagem há mais de X minutos (PRECISA VERIFICAR threshold)
3. Workflow envia mensagem de retorno pelo WhatsApp
4. Chama `POST /api/bot/mark-abandonment-notified`

---

## Lembretes de agendamento

O workflow **"NailFlow — Lembretes de Agendamento"** (cron, schedule):
1. Chama `GET /api/bot/appointments-tomorrow`
2. Backend retorna agendamentos de amanhã com `reminder_sent = false`
3. Workflow envia lembrete pelo WhatsApp
4. Chama `POST /api/bot/mark-reminder-sent`
5. Backend atualiza `reminder_sent = true` → previne duplicata
