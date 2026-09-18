# NailFlow — Próximos Passos

Sequência ordenada por dependência. Não pule etapas.

---

## Fase 1 — Estabilização (fazer antes de qualquer nova feature)

### 1.1 Commitar arquivos pendentes

```bash
cd /var/www/nailflow
git add backend/src/controllers/clientsController.js
git add backend/src/controllers/whatsappController.js
git add backend/src/routes/whatsapp.routes.js
git add frontend/src/pages/Clientes.tsx
git commit -m "feat(bloco5+whatsapp): CRM com busca/filtro por tag e gestão de instância WhatsApp"
git push origin feat/phase5-register
```

### 1.2 Ativar workflow "NailFlow — Notificações"

1. Acessar https://nailflow-n8n.duckdns.org
2. Localizar "NailFlow — Notificações" (ID: jgCnaeacHYMH6SRT)
3. Verificar se o nó Webhook tem path `nailflow/notificacoes` (confirmar)
4. Ativar
5. Testar: enviar confirmação de agendamento pelo bot → verificar se execução aparece no n8n

### 1.3 Executar testes automatizados

```bash
cd /var/www/nailflow/backend
npm test
```

Verificar se todos passam. Se algum falhar, corrigir antes de continuar.

---

## Fase 2 — Validação dos fluxos críticos do bot

### 2.1 Testar agendamento completo pelo WhatsApp

Cenário: cliente envia "oi" → recebe menu → escolhe serviço → escolhe horário → confirma

Verificar:
- Agendamento criado no banco (`SELECT * FROM appointments ORDER BY created_at DESC LIMIT 1`)
- n8n "WhatsApp NailFlow — Definitivo" executou (success)
- n8n "NailFlow — Notificações" executou (após ativar em 1.2)
- `reminder_sent = false` no agendamento criado

### 2.2 Testar cancelamento pelo WhatsApp

Cenário: cliente envia "cancelar" → lista agendamentos → confirma cancelamento

Verificar:
- `status = 'cancelado'` no banco
- n8n "NailFlow — Notificações" executou

### 2.3 Testar lembrete de agendamento

1. Criar agendamento para amanhã
2. Aguardar o cron do workflow "NailFlow — Lembretes de Agendamento"
3. Verificar WhatsApp recebeu lembrete
4. Verificar `reminder_sent = true` no banco

### 2.4 Testar modo atendimento humano

- Enviar frase de escape ("falar com atendente")
- Verificar que bot silencia
- Aguardar 2h → verificar que bot volta automaticamente

---

## Fase 3 — Conexão WhatsApp pelo sistema (QR Code)

### 3.1 Testar `POST /api/whatsapp/connect`

Cenário: profissional acessa Configurações → WhatsApp → clicar "Conectar"

Verificar:
- QR Code aparece na tela
- QR é escaneável (preto/branco puro)
- Após escaneio, status muda para "conectado"

**Nota:** testar APENAS com instância de teste. Não usar número real.

---

## Fase 4 — CRM e interface

### 4.1 Testar Bloco 5 CRM

Verificar:
- Busca por nome funciona
- Busca por telefone funciona
- Filtro por tag funciona
- Filtro "Inativas" funciona

---

## Fase 5 — Multi-tenancy (nova profissional)

### 5.1 Testar cadastro de segunda profissional

1. Registrar segunda profissional via `/auth/register` ou pela UI
2. Criar instância no Evolution (ex: `chip-pro2`)
3. Configurar `wa_instance_name` para `chip-pro2`
4. Verificar que dados ficam isolados (agendamentos, clientes, serviços)

---

## Fase 6 — Preparação para número real

**Fazer APENAS quando as fases 2 e 3 estiverem validadas.**

1. Criar nova instância Evolution (ex: `chip-real` ou nome definitivo)
2. Configurar webhook na instância nova
3. Fazer **UMA** tentativa de QR para o número real
4. Vincular no banco (`wa_instance_name`)
5. Monitorar por 24h

**⚠️ Nunca fazer isso sem confirmação explícita da profissional.**

---

## Fase 7 — Limpeza e organização

- Remover workflows duplicados/inativos do n8n
- Remover `N8N_API_KEY` do `.env` e `.env.example`
- Atualizar `.env.example` com variáveis atuais
- Limpar arquivos `.bak*` do VPS (ou mover para `archive/`)

---

## Fase 8 — Monitoramento

- Configurar alertas de queda do bot (UptimeRobot ou similar)
- Considerar logs estruturados (Winston/Pino)
- Monitorar espaço em disco (`df -h` — backup cresce ~X MB/dia)

---

## Fase 9 — Features futuras

- Campanhas (envio em massa para reativar clientes inativas)
- Painel de histórico de conversas para a profissional
- Export de dados (LGPD)
- App mobile (longo prazo)
