# NailFlow — Guia de Deploy e Sincronização

## Fonte oficial do código

O repositório oficial é **`https://github.com/Yas2046/nailflow`** (branch `main`).

O código-fonte de referência para qualquer modificação ou deploy é sempre o que está
no GitHub. Nunca use o `src/` do VPS como fonte — ele pode estar desatualizado.

---

## Problema ocorrido em 16/09/2026 (e como evitar)

### O que aconteceu

O `dist/` no VPS havia sido gerado localmente (máquina da Yasmin) e copiado diretamente
para `/var/www/nailflow/frontend/dist/` sem atualizar o `src/` no VPS. Isso criou uma
divergência:

| Local | Conteúdo |
|---|---|
| VPS `/var/www/nailflow/frontend/src/` | versão antiga (sem Layout com ícones, sem Perfil, sem Dashboard V2) |
| VPS `/var/www/nailflow/frontend/dist/` | versão nova compilada localmente |

Quando um novo build foi feito a partir do `src/` desatualizado, o frontend voltou para
a versão antiga (bundle caiu de 262 KB para 205 KB, perdendo Perfil, Dashboard V2,
Layout com ícones etc.).

### Solução aplicada

1. Identificado o `dist` correto em `dist.bak_20260916-pre-whatsapp/` (262 KB).
2. Localizado o `src/` correto em `nailflow (2)/nailflow (2)/nailflow/frontend/src/`
   na máquina local.
3. Arquivos corretos copiados para o VPS via `scp`.
4. Novas funcionalidades (Configurações → WhatsApp) mescladas sobre o src restaurado.
5. Build realizado a partir do src correto → bundle 265 KB.
6. Tudo commitado no GitHub e VPS atualizado.

---

## Como fazer deploy corretamente

### Pré-requisito: nunca editar arquivos direto no VPS `src/`

Edições devem ser feitas localmente, testadas e depois o deploy segue este fluxo:

```
Editar local → commit no Git → push GitHub → deploy no VPS
```

### Fluxo de deploy completo

```bash
# 1. Na máquina local: build do frontend
cd frontend
npm run build

# 2. Enviar src e dist ao VPS
scp -r src/ root@77.237.242.192:/var/www/nailflow/frontend/src/
scp -r dist/ root@77.237.242.192:/var/www/nailflow/frontend/dist/

# 3. Enviar backend atualizado (se houve mudanças)
scp -r backend/src/ root@77.237.242.192:/var/www/nailflow/backend/src/

# 4. Reiniciar backend no VPS
ssh root@77.237.242.192 "pm2 restart 0 --update-env"

# 5. Commit e push no GitHub
git add -A
git commit -m "feat/fix: descrição"
git push origin main
```

### Alternativa: build no VPS (recomendado para garantir consistência)

```bash
# 1. Na máquina local: enviar apenas o src
scp -r frontend/src/ root@77.237.242.192:/var/www/nailflow/frontend/src/
scp -r backend/src/ root@77.237.242.192:/var/www/nailflow/backend/src/

# 2. No VPS: build
ssh root@77.237.242.192 "cd /var/www/nailflow/frontend && npm run build"

# 3. Reiniciar backend
ssh root@77.237.242.192 "pm2 restart 0 --update-env"
```

---

## Estado em produção (16/09/2026)

### Commit de referência

```
300d3bc  feat: integração WhatsApp, Dashboard V2 e melhorias de layout (2026-09-14 a 16)
```

### Frontend (dist no VPS)

| Bundle | Tamanho |
|---|---|
| `index-Brh_NMra.js` | 260 KB |
| `index-Y72aXm50.css` | 29 KB |

### Funcionalidades ativas

- Painel (Dashboard V2): faturamento realizado/previsto/perdido, variação % vs mês
  anterior, top 5 serviços, gráfico de 6 meses
- Agenda: DayView / WeekView / MonthView com agendamentos recorrentes
- Clientes: busca, histórico de atendimentos
- Serviços: CRUD
- Disponibilidade: toggle por dia da semana
- Perfil: página da profissional
- Configurações → WhatsApp: status da conexão (chip2), número conectado, nome do perfil

### Backend (PM2 id 0, porta 3333)

Endpoints ativos:
- `GET /whatsapp/status` — status da instância Evolution API (requireAuth)
- `POST /appointments/recurring` — agendamentos recorrentes
- Todos os endpoints bot (`/bot/*`) com TTL e normalização de telefone

### n8n (PM2 id 4, porta 5678)

- Workflow Lembretes 24h (`crVRWCDoVzCEWSgz`): ativo, cron a cada 30 min
- Workflow Abandono de Conversa (`rQ7S8XcAiiTCgXEr`): ativo, cron a cada 15 min
- Workflow WhatsApp Definitivo (`3yBtUtgMlKsXh3mw`): ativo, webhook MESSAGES_UPSERT
  - Nó "Processar no NailFlow": retry configurado (5 tentativas, 3s de intervalo)

---

## Aviso importante: `pm2 restart` causa janela de indisponibilidade

O comando `pm2 restart 0` reinicia o backend Node.js com ~10 segundos de downtime.
Nesse intervalo, mensagens chegadas via WhatsApp resultam em `ECONNREFUSED` no n8n.

**Mitigações aplicadas:**
- O nó "Processar no NailFlow" agora possui retry automático:
  5 tentativas com 3 segundos de intervalo (cobre até 12s de downtime).
- O botController (`/bot/process`) tem deduplicação por `waMessageId`:
  se o retry reprocessar uma mensagem já gravada, retorna `{reason:'duplicate'}`
  sem enviar resposta duplicada ao cliente.

**Alternativa com menor downtime:**
```bash
pm2 reload 0   # graceful reload — aguarda requisições em andamento antes de reiniciar
```

---

## Backups criados em 16–17/09/2026

| Arquivo | Conteúdo |
|---|---|
| `/root/backup_whatsapp_feature_20260916-213804.tar.gz` | src antes da implementação WhatsApp |
| `/root/backup_broken_state_20260916.tar.gz` | src do estado quebrado (build do src antigo) |
| `/var/www/nailflow/frontend/dist.bak_20260916-pre-whatsapp/` | dist correto pré-implementação |
| `/var/www/nailflow/frontend/dist.bak_20260915-etapa2-login/` | dist de 15/09 |
| `/var/www/nailflow/frontend/dist.bak_20260915-pre-fix-cancel/` | dist antes do fix-cancel |
| `/root/backup_workflow_3yBtUtgMlKsXh3mw_20260917.json` | workflow n8n antes do retry (17/09) |

---

## Pendências

- Verificar execução completa do workflow Abandono de Conversa: confirmar que mensagem
  é enviada via Evolution API e `abandonment_notified` marcado como `true`
  (próxima janela de 30+ min sem interação do número de teste `5511777700001`).
- Futura funcionalidade: `POST /whatsapp/reconnect` para reconexão via QR Code
  a partir da tela Configurações.

---

## Arquitetura resumida

```
Nginx (HTTPS)
  ├── /api/   → Node.js Express (PM2 id 0, :3333)
  ├── /       → React SPA (dist/ servido estático)
  └── /n8n/   → n8n (PM2 id 4, :5678)

Evolution API → Docker, instância chip2, :8080
n8n → webhook → /bot/process → Evolution API → cliente WhatsApp
```
