# NailFlow — Testes Realizados

> Testes realizados durante as sessões de desenvolvimento (até 2026-09-18).

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

Executados com `npm test` no backend:

| Arquivo de teste | O que testa | Status |
|---|---|---|
| `health.test.js` | GET / → 200 | PRECISA VERIFICAR |
| `auth-flow.test.js` | Register + Login + Me | PRECISA VERIFICAR |
| `availability-check.test.js` | Verificação de disponibilidade | PRECISA VERIFICAR |
| `availability-slots.test.js` | Slots de horário | PRECISA VERIFICAR |
| `price-snapshot.test.js` | Snapshot de preço | PRECISA VERIFICAR |
| `rate-limit.test.js` | Rate limiting | PRECISA VERIFICAR |
| `notify-n8n.test.js` | Notificação n8n | PRECISA VERIFICAR |
| `nullable-fields.test.js` | Campos nullable | PRECISA VERIFICAR |

> **Nota:** os testes automatizados não foram executados nesta sessão. Devem ser re-executados na nova máquina.

---

## Testes PENDENTES (não realizados)

| Cenário | Prioridade | Observação |
|---|---|---|
| Agendamento completo pelo WhatsApp (escolher serviço + horário + confirmar) | 🔴 Crítico | Fluxo mais importante do produto |
| Cancelamento pelo WhatsApp | 🔴 Crítico | |
| Lembrete de agendamento enviado | 🔴 Crítico | Workflow ativo mas não verificado em produção |
| Notificação de confirmação (nailflow/notificacoes) | 🟠 Importante | Quebrado — aguardando ativar workflow |
| Modo atendimento humano → retorno automático após 2h | 🟠 Importante | |
| Frase de escape → ATENDIMENTO_HUMANO | 🟠 Importante | |
| 3 entradas inválidas → ATENDIMENTO_HUMANO | 🟠 Importante | |
| Conexão WhatsApp via painel (QR pelo sistema) | 🟠 Importante | Implementado mas não testado |
| Cadastro de nova profissional (fase 5) | 🟠 Importante | |
| Bloco 5 CRM (filtro por tag, busca) | 🟡 Melhoria | Código pronto, não commitado |
| Agendamentos recorrentes | 🟡 Melhoria | |
