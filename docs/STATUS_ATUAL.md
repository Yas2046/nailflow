# NailFlow — Status Atual (2026-09-18)

## Git

- **Repositório:** https://github.com/Yas2046/nailflow
- **Branch:** `feat/phase5-register`
- **Último commit:** `e123e70` — fix: renomear migration 003→006 para evitar conflito de numeração

### Histórico recente (10 commits)

```
e123e70 fix: renomear migration 003→006 para evitar conflito de numeração
2f5633e feat(multi-tenancy): fase 5 — cadastro de novas profissionais
0e4405e feat(phase4.1): cron workflows multi-profissional
29f58f8 feat(multi-tenancy): fase 4 — bot multi-profissional via wa_instance_name
6ddfb54 feat(multi-tenancy): fase 3 — página pública por slug de profissional
e7b8773 feat(multi-tenancy): fase 1 — slug e wa_instance_name em professionals
3857908 feat(multi-tenancy): fase 0 — filtros professional_id e rotas cron
072aa70 feat(whatsapp): conexão via QR Code na tela Configurações
3a669f5 fix(n8n): adicionar retry no nó Processar no NailFlow (ECONNREFUSED)
92f2dc7 docs: adicionar DEPLOY.md com guia de sincronização
```

---

## Arquivos modificados (não commitados)

Estes 4 arquivos têm alterações no VPS que ainda NÃO estão no Git:

| Arquivo | Descrição da mudança |
|---|---|
| `backend/src/controllers/clientsController.js` | Bloco 5 CRM: busca por nome/telefone, filtro por tag, paginação |
| `backend/src/controllers/whatsappController.js` | Conexão WhatsApp: status, connect (QR), config instância |
| `backend/src/routes/whatsapp.routes.js` | Rotas /whatsapp: status, connect, instance CRUD |
| `frontend/src/pages/Clientes.tsx` | CRM Bloco 5: UI com filtro por tag + busca aprimorada |

**Ação necessária:** commitar esses 4 arquivos antes de continuar.

```bash
cd /var/www/nailflow
git add backend/src/controllers/clientsController.js
git add backend/src/controllers/whatsappController.js
git add backend/src/routes/whatsapp.routes.js
git add frontend/src/pages/Clientes.tsx
git commit -m "feat(bloco5+whatsapp): CRM com busca/filtro por tag e gestão de instância WhatsApp"
git push origin feat/phase5-register
```

---

## Arquivos não rastreados (fora do Git por design)

Os arquivos abaixo existem no VPS mas NÃO devem ir para o Git:

| Arquivo/Pasta | Motivo |
|---|---|
| `backend/.env` | Contém segredos de produção |
| `frontend/.env` | Contém URLs de produção |
| `backend/backup_*` / `*.bak*` | Backups de dev, cobertos pelo .gitignore |
| `frontend/dist*/` | Builds compilados |
| `backend/db/backup_*.sql` | Backups do banco |

---

## Estado dos serviços (verificado em 2026-09-18)

| Serviço | PID | Uptime | Status |
|---|---|---|---|
| nailflow-backend (PM2 id 0) | 379467 | 18h | online |
| n8n (PM2 id 4) | 302574 | 32h | online |
| Evolution API (Docker) | — | — | running |
| Nginx | 207821 | — | active |
| PostgreSQL | 36620 | — | listening :5432 |

### Instância WhatsApp

- **Nome:** chip2
- **Status:** `open` (conectado)
- **Verificado em:** 2026-09-18 às 19h

---

## Versões

| Componente | Versão |
|---|---|
| Node.js | v22.23.2 |
| npm | 10.9.8 |
| PostgreSQL | 16.15 |
| PM2 | 7.0.4 |
| Evolution API | 2.3.7 |
| n8n | 2.35.7 |
| React | 18.3.1 |
| TypeScript | 5.5.3 |
