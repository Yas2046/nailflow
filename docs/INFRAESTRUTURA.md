# NailFlow — Infraestrutura

## VPS

| Item | Valor |
|---|---|
| Provedor | Contabo |
| IP | 77.237.242.192 |
| OS | Ubuntu 24.04.5 LTS |
| Kernel | 6.8.0-139-generic |
| Acesso | `ssh root@nailflow.duckdns.org` |

---

## Domínios

| Domínio | Aponta para | Finalidade |
|---|---|---|
| `nailflow.duckdns.org` | VPS | Frontend + API |
| `nailflow-n8n.duckdns.org` | VPS | n8n (automação e webhooks) |
| `nailflow-evolution.duckdns.org` | VPS | Evolution API (usada pelo n8n para enviar mensagens) |

Todos usam DuckDNS. Renovação de HTTPS: automática via Certbot.

---

## Firewall (UFW)

Ativo desde **2026-09-25** e habilitado no boot.

```
Status: active
Default: deny (incoming), allow (outgoing), deny (routed)
22/tcp   ALLOW IN  Anywhere  # SSH
80/tcp   ALLOW IN  Anywhere  # HTTP Nginx
443/tcp  ALLOW IN  Anywhere  # HTTPS Nginx
(as mesmas regras também em IPv6)
```

- Somente **22, 80 e 443** aceitam conexões externas
- **3333 (backend) e 5678 (n8n) ficam acessíveis apenas localmente**; de fora, o acesso passa pelo Nginx
- Tráfego local (Nginx → backend, n8n → backend, containers → 443) não é afetado
- Com o acesso direto à 3333 fechado, os rate limits do backend passam a contar o IP real repassado pelo Nginx (`X-Forwarded-For` + `trust proxy 1`)
- O UFW **não filtra portas publicadas pelo Docker**; hoje a única publicada é `127.0.0.1:8080` (local). Se algum container for publicado em `0.0.0.0` no futuro, ele não será protegido pelo UFW
- Rollback de emergência: `ufw disable` (as regras ficam gravadas)

Validação feita na ativação (2026-09-25): SSH novo, backend/n8n/Evolution locais, HTTPS do site/API/n8n/Evolution, Evolution → n8n pela 443, `chip2` `open` (na época), PM2 e Docker sem reinício; teste externo com 22/80/443 abertas e 3333/5678 fechadas. Em 2026-09-27 o UFW continua ativo com as mesmas regras.

Os webhooks do n8n expostos pela 443 exigem, desde 2026-09-27, o cabeçalho `X-NailFlow-Webhook-Secret` (ver [`N8N.md`](./N8N.md)).

---

## Portas

| Porta | Serviço | Escuta em | Acesso externo |
|---|---|---|---|
| 22 | SSH | todas | ✅ liberada no UFW |
| 80 | Nginx (redirect → 443) | todas | ✅ liberada no UFW |
| 443 | Nginx (HTTPS) | todas | ✅ liberada no UFW |
| 3333 | NailFlow Backend (Express) | todas | ❌ bloqueada pelo UFW (use `/api` via Nginx) |
| 5678 | n8n | todas | ❌ bloqueada pelo UFW (use o domínio via Nginx) |
| 5679 | n8n interno | 127.0.0.1 | ❌ |
| 5432 | PostgreSQL | 127.0.0.1 / ::1 | ❌ |
| 8080 | Evolution API (Docker) | 127.0.0.1 | ❌ |
| 6379 | Redis (Docker) | rede interna do Docker | ❌ |

> O backend e o n8n escutam em todas as interfaces; a restrição é feita pelo firewall. Não trocar o backend para escutar só em `127.0.0.1` sem revisar: o Node resolve `localhost` primeiro para `::1`, e o Nginx e os workflows chamam `localhost:3333`.

---

## Nginx

Arquivos: `/etc/nginx/sites-enabled/nailflow` (site + n8n) e `/etc/nginx/sites-enabled/evolution` (Evolution → `127.0.0.1:8080`)

### nailflow.duckdns.org (Frontend + API)

```nginx
server {
    listen 443 ssl;
    server_name nailflow.duckdns.org;

    root /var/www/nailflow/frontend/dist;
    index index.html;

    location /api/ {
        proxy_pass http://localhost:3333/;
    }

    location / {
        try_files $uri $uri/ /index.html;  # SPA fallback
    }
}
```

### nailflow-n8n.duckdns.org (n8n)

```nginx
server {
    listen 443 ssl;
    server_name nailflow-n8n.duckdns.org;

    location / {
        proxy_pass http://localhost:5678;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 300s;
    }
}
```

---

## PM2

| ID | Nome | Porta | Status |
|---|---|---|---|
| 0 | nailflow-backend | 3333 | online |
| 4 | n8n | 5678 | online |

O backend é iniciado pelo PM2 com `npm start` (`node src/server.js`) e lê o `backend/.env` via `dotenv`. `NODE_ENV` **não** está definido em produção (o cookie de sessão ainda sai sem a flag `Secure`) — a correção faz parte da publicação pendente da recuperação de senha.

### Comandos PM2

```bash
pm2 list                          # listar processos
pm2 logs nailflow-backend --lines 50  # logs backend
pm2 logs n8n --lines 50           # logs n8n
pm2 restart 0                     # reiniciar backend
pm2 restart 4                     # reiniciar n8n
pm2 save                          # salvar configuração
pm2 startup                       # registrar autostart
```

---

## Docker (Evolution API)

```bash
docker ps                         # containers ativos
docker logs evolution --tail 50   # logs da Evolution
docker logs evolution-db --tail 20 # logs do PostgreSQL da Evolution
```

Containers: `evolution`, `evolution-db` (PostgreSQL), `redis`

Docker Compose localizado em: `/evolution/docker-compose.yml` (PRECISA VERIFICAR)

---

## HTTPS / Certbot

Certificados:
- `/etc/letsencrypt/live/nailflow.duckdns.org/`
- `/etc/letsencrypt/live/nailflow-n8n.duckdns.org/`

Renovação automática via Certbot (timer systemd). Verificar com:
```bash
certbot renew --dry-run
```

---

## Backup automático

Cron do root:
```
0 3 * * * /usr/local/bin/nailflow-backup.sh >> /var/backups/nailflow/backup.log 2>&1
```

- **Executa:** diariamente às 03:00
- **Script:** `/usr/local/bin/nailflow-backup.sh`
- **Destino:** `/var/backups/nailflow/nailflow_YYYY-MM-DD_HHMMSS.dump`
- **Retenção:** 7 dias
- **Formato:** pg_dump -Fc (binário comprimido)

Restauração:
```bash
pg_restore -U postgres -d nailflow -Fc /var/backups/nailflow/nailflow_YYYY-MM-DD_HHMMSS.dump
```

---

## Estrutura de arquivos no VPS

```
/var/www/nailflow/
├── backend/
│   ├── src/           # código-fonte backend
│   ├── db/            # schema.sql, migrations (002, 001, 003–014), _historico/, seed
│   ├── tests/
│   ├── .env           # ⚠️ NUNCA comitar
│   └── package.json
├── frontend/
│   ├── src/           # código-fonte React
│   ├── dist/          # build atual (servido pelo Nginx)
│   ├── dist-next/     # build candidato da recuperação de senha — NÃO servido, ignorado pelo Git
│   ├── .env           # ⚠️ NUNCA comitar
│   └── package.json
├── n8n/
│   └── workflows/     # exports dos workflows
├── docs/              # esta documentação
├── docker-compose.yml
├── README.md
└── DEPLOY.md

/opt/nailflow-next/  # cópia isolada da recuperação de senha (não publicada, fora do Git)

/usr/local/bin/
└── nailflow-backup.sh

/var/backups/nailflow/
└── nailflow_*.dump    # backups diários
```
