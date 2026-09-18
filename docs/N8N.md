# NailFlow — n8n

## Instalação

| Item | Valor |
|---|---|
| Versão | 2.35.7 Community Edition |
| Gerenciado por | PM2 (id: 4) |
| Porta | 5678 (localhost) |
| URL externa | https://nailflow-n8n.duckdns.org |
| Banco de dados | SQLite em `~/.n8n/database.sqlite` |

---

## Workflows

### Ativos

| Nome | ID | Webhook path | Função |
|---|---|---|---|
| WhatsApp NailFlow — Definitivo | 3yBtUtgMlKsXh3mw | `whatsapp-nailflow` | Processa mensagens recebidas do chip2 |
| NailFlow — Abandono de Conversa | rQ7S8XcAiiTCgXEr | — (Schedule Trigger) | Detecta conversas abandonadas e notifica |
| NailFlow — Lembretes de Agendamento | crVRWCDoVzCEWSgz | — (Schedule Trigger) | Envia lembrete 24h antes do agendamento |

### Inativos (não alterar sem análise)

| Nome | ID | Obs |
|---|---|---|
| NailFlow — Notificações | jgCnaeacHYMH6SRT | **⚠️ precisa ser ativado** — é o webhook `nailflow/notificacoes` |
| NailFlow — Lembretes de Agendamento | uHtykapT7vFNA1Du | duplicata inativa — manter inativo |
| NailFlow — Lembretes | 7Wx8Xul4czlqBx1o | versão antiga — manter inativo |
| NailFlow — WhatsApp Principal | muSSvRqsDtTSKojL / W9PbP87KDnW7YCaN | versões antigas — manter inativas |
| NailFlow — Verificação Meta Webhook | (4 instâncias) | relacionado a Meta/WABA — manter inativo |
| WhatsApp Teste — oi/olá | 2XiXEGDdFLy9OZc6 | workflow de teste — manter inativo |

---

## Webhooks registrados (ativos)

| Path | Método | Workflow |
|---|---|---|
| `whatsapp-nailflow` | POST | WhatsApp NailFlow — Definitivo |
| `nailflow/mensagem-recebida` | POST | NailFlow — WhatsApp Principal (INATIVO) |
| `evolution-chip2` | POST | WhatsApp Teste — oi/olá (INATIVO) |

**URL completa:** `https://nailflow-n8n.duckdns.org/webhook/{path}`

---

## Fluxo "WhatsApp NailFlow — Definitivo"

```
[Webhook Trigger: POST /webhook/whatsapp-nailflow]
        │
        ▼ (recebe payload da Evolution)
[Filtrar: apenas mensagens de texto, ignora grupos/status]
        │
        ▼
[POST /api/bot/process]  ← chama o backend com BOT_API_KEY
        │
        ▼
[Recebe resposta: { reply, professionalId }]
        │
        ├── reply existe?
        │      ▼
        │   [POST Evolution: /message/sendText/{instanceName}]
        │      ▼
        │   [Mensagem enviada ao cliente]
        │
        └── reply null → bot em modo ATENDIMENTO_HUMANO → ignora
```

---

## Variáveis de ambiente no n8n

O n8n tem `N8N_EXPOSE_PROCESS_ENV=true`. Variáveis visíveis aos workflows:

| Variável | Uso |
|---|---|
| `BOT_API_KEY` | Autenticação nas chamadas ao NailFlow backend |
| `N8N_EXPOSE_PROCESS_ENV` | Permite ler `process.env` nos workflows |

---

## API Keys do n8n

A tabela `user_api_keys` está **vazia** (0 rows). O n8n REST API não está habilitado via chave.

A variável `N8N_API_KEY` no `.env` do backend **não é usada** em nenhum arquivo de código. É uma variável residual.

---

## Arquivos de workflows exportados

Localização: `/var/www/nailflow/n8n/workflows/`

| Arquivo | Conteúdo |
|---|---|
| `whatsapp_nailflow_definitivo.json` | Export do workflow principal ativo |
| `WB-lembretes.json` | Export dos lembretes |
| `WA-whatsapp-principal.json` | Versão anterior (não usar) |
| `1-novo-agendamento.json` ... | Versões iniciais do desenvolvimento |

**Para importar no n8n:** acesse https://nailflow-n8n.duckdns.org → Workflows → Import from file.

---

## Problema conhecido

### POST `nailflow/notificacoes` → 404

- **Quando ocorre:** sempre que o bot confirma ou cancela um agendamento
- **Causa:** workflow "NailFlow — Notificações" (ID: jgCnaeacHYMH6SRT) está **inativo**
- **Impacto:** bot continua funcionando, mas n8n não é notificado sobre confirmações/cancelamentos
- **Solução:** ativar o workflow "NailFlow — Notificações" no painel n8n
- **Constraint:** NÃO foi ativado durante a sessão de diagnóstico (aguardando autorização)

Ver [`PENDENCIAS.md`](./PENDENCIAS.md) para detalhes e plano de ação.

---

## Logs e monitoramento

```bash
pm2 logs n8n --lines 100          # logs recentes
pm2 logs n8n --lines 100 --err    # apenas erros

# Execuções recentes no banco SQLite
sqlite3 ~/.n8n/database.sqlite \
  "SELECT e.id, wf.name, e.status, e.startedAt
   FROM execution_entity e
   JOIN workflow_entity wf ON e.workflowId = wf.id
   ORDER BY e.id DESC LIMIT 20;"
```
