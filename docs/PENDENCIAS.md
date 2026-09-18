# NailFlow — Pendências e Auditoria

## Problema conhecido: POST `nailflow/notificacoes` → 404

**Onde ocorre:** sempre que o bot confirma ou cancela um agendamento (no arquivo `notifyN8n.js`)

**Workflow relacionado:** "NailFlow — Notificações" (ID: `jgCnaeacHYMH6SRT`)

**Comportamento atual:**
- Bot processa confirmação/cancelamento corretamente no banco
- Tenta notificar n8n via `POST https://nailflow-n8n.duckdns.org/webhook/nailflow/notificacoes`
- n8n responde 404 porque o workflow está **inativo** (webhook não registrado)
- Erro é capturado silenciosamente em `notifyN8n.js` (`.catch` → apenas log de erro)
- **O agendamento é salvo no banco mesmo assim** — o erro não bloqueia o usuário

**Impacto:** n8n não é notificado sobre confirmações/cancelamentos → eventuais ações de automação nesse workflow não disparam

**O que foi investigado:**
- `notifyN8n.js` usa webhook URLs diretas (sem `N8N_API_KEY`)
- `N8N_API_KEY` no `.env` não é usada em nenhum arquivo de código
- Workflow "NailFlow — Notificações" existe mas está inativo

**O que precisa ser feito:**
1. Acessar https://nailflow-n8n.duckdns.org
2. Localizar workflow "NailFlow — Notificações" (ID: jgCnaeacHYMH6SRT)
3. Verificar se o path `nailflow/notificacoes` está correto no workflow
4. Ativar o workflow
5. Testar: confirmar um agendamento pelo bot e verificar se o n8n executa

---

## Auditoria completa de pendências

### 🔴 Crítico / necessário para uso real

**C1. Ativar workflow "NailFlow — Notificações"**
- O que falta: ativar no n8n
- Por quê: notificações de confirmação/cancelamento não chegam ao n8n
- Dependência: nenhuma
- Fazer antes de: qualquer teste de fluxo completo

**C2. Testar agendamento completo pelo WhatsApp**
- O que falta: teste end-to-end do fluxo mais importante
- Cenário: cliente envia mensagem → escolhe serviço → escolhe horário → confirma → agendamento criado no banco
- Por quê: é a funcionalidade central do produto
- Dependência: chip2 conectado (✅), workflow ativo (✅)

**C3. Testar cancelamento pelo WhatsApp**
- O que falta: teste do fluxo de cancelamento
- Por quê: funcionalidade principal

**C4. Verificar lembrete em produção**
- O que falta: criar um agendamento para amanhã, aguardar o cron e verificar se o WhatsApp recebeu o lembrete
- Por quê: workflow ativo mas nunca verificado em produção com a nova instância chip2

**C5. Commitar 4 arquivos pendentes**
- clientsController.js, whatsappController.js, whatsapp.routes.js, Clientes.tsx
- Por quê: alterações existem apenas no VPS, não estão no GitHub

---

### 🟠 Importante

**I1. Testar conexão WhatsApp via painel (QR pelo sistema)**
- O que falta: testar o fluxo completo de `POST /api/whatsapp/connect` com QR renderizado
- Por quê: feature implementada mas nunca testada (chip2 já estava conectado)
- Risco: pode haver bugs no fluxo de renderização do QR no frontend

**I2. Cadastro de nova profissional (fase 5) — teste completo**
- O que falta: testar cadastro via `/auth/register`, vinculação de instância Evolution, separação de dados
- Por quê: fase 5 foi commitada mas não testada end-to-end com instância real

**I3. Modo ATENDIMENTO_HUMANO — teste completo**
- O que falta: testar frase de escape, TTL de 2h, retorno automático para BOT_ATIVO
- Por quê: implementado mas não testado nesta sessão

**I4. 3 tentativas inválidas → ATENDIMENTO_HUMANO**
- O que falta: testar envio de 3 mensagens inválidas consecutivas no MENU
- Por quê: proteção anti-loop implementada mas não validada

**I5. Variável `N8N_API_KEY` — limpar**
- O que falta: remover do `.env` e do `.env.example` (não é usada em nenhum arquivo)
- Por quê: confuso ter variável não utilizada — pode causar dúvidas no futuro
- Ação: `grep -r N8N_API_KEY /var/www/nailflow/backend/src/` retorna zero resultados

**I6. Número de WhatsApp da profissional (campo `phone_whatsapp`)**
- O que falta: garantir que `phone_whatsapp` está preenchido no banco para a profissional principal
- Por quê: campo nullable mas pode ser necessário para funcionalidades futuras

**I7. Testes automatizados (`npm test`)**
- O que falta: executar e verificar se todos passam com o estado atual do código
- Por quê: não foram executados nesta sessão

---

### 🟡 Melhoria

**M1. Bloco 5 CRM — filter "Inativas" + busca por tag**
- O que falta: código pronto (clientsController.js + Clientes.tsx) mas não commitado e não testado na UI
- Por quê: melhora a gestão de clientes pela profissional

**M2. Workflows duplicados no n8n**
- O que falta: remover versões antigas (NailFlow — WhatsApp Principal x2, Lembretes x2, Verificação Meta x4)
- Por quê: confusão visual e risco de ativar o workflow errado por acidente

**M3. Webhook chip2 no n8n: consolidar**
- O que falta: remover `evolution-chip2` e `nailflow/mensagem-recebida` (paths de workflows inativos)
- Por quê: apenas `whatsapp-nailflow` é o ativo e correto

**M4. Documentação do `.env.example` do backend**
- O que falta: atualizar `.env.example` — ainda menciona `N8N_WEBHOOK_URL` (nome antigo) em vez de `N8N_WEBHOOK_CONFIRMED_URL` / `N8N_WEBHOOK_CANCELLED_URL`

**M5. Migração do número real da profissional**
- O que falta: quando a profissional quiser usar o número real (não de teste), precisa:
  1. Criar nova instância Evolution (ex: `chip-real`)
  2. Parear com o número real (⚠️ fazer apenas 1 tentativa de QR, sem loop)
  3. Atualizar `wa_instance_name` no banco
  4. Atualizar webhook na Evolution
- Por quê: chip2 deve ser número de teste; número real da profissional precisa de instância separada
- **NUNCA conectar o número real sem testes e autorização explícita**

---

### 🟢 Futuro

**F1. Multi-tenancy real — múltiplas profissionais**
- O que falta: cadastrar segunda profissional, criar segunda instância Evolution, testar isolamento total
- Por quê: a arquitetura já suporta, mas precisa de teste com usuárias reais

**F2. Campanhas de WhatsApp**
- O que falta: funcionalidade não implementada (envio em massa / reativação de clientes inativas)
- Citado como "Bloco 5 CRM F"

**F3. Monitoramento de produção**
- O que falta: alertas de queda do bot, dashboard de execuções n8n, notificação de erro automática
- Por quê: atualmente o único monitoramento é `pm2 logs`

**F4. Autenticação mais segura**
- O que falta: revisar expiração dos JWT, considerar refresh token, CSRF protection
- Por quê: cookie httpOnly está correto, mas sessão de 7d pode ser longa para produção

**F5. Rate limiting por professional_id no bot**
- O que falta: limitar quantidade de mensagens processadas por número por minuto
- Por quê: spam ou comportamento malicioso poderia sobrecarregar o n8n e o backend

**F6. Export de dados (LGPD)**
- O que falta: endpoint para exportar dados de uma cliente específica
- Por quê: obrigação legal eventual

**F7. Logs estruturados**
- O que falta: substituir `console.log` por logger estruturado (Winston/Pino)
- Por quê: facilita diagnóstico em produção
