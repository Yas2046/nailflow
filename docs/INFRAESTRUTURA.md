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
| `nailflow.duckdns.org` | 77.237.242.192 | Frontend + API |
| `nailflow-n8n.duckdns.org` | 77.237.242.192 | n8n (automação) |

Ambos usam DuckDNS. Renovação de HTTPS: automática via Certbot.

---

## Portas ativas

| Porta | Serviço | Visibilidade |
|---|---|---|
| 80 | Nginx (redirect → 443) | público |
| 443 | Nginx (HTTPS) | público |
| 3333 | NailFlow Backend (Express) | localhost only |
| 5432 | PostgreSQL | localhost only |
| 5678 | n8n | localhost only (proxy Nginx) |
| 5679 | n8n interno | localhost only |
| 8080 | Evolution API (Docker) | 127.0.0.1 only |
| 22 | SSH | público |

---

## Nginx

Arquivo: `/etc/nginx/sites-enabled/nailflow`

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

| ID | Nome | Porta | Restart count | Status |
|---|---|---|---|---|
| 0 | nailflow-backend | 3333 | 47 | online |
| 4 | n8n | 5678 | 2 | online |

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
│   ├── db/            # schema.sql, migrations, seeds
│   ├── tests/
│   ├── .env           # ⚠️ NUNCA comitar
│   └── package.json
├── frontend/
│   ├── src/           # código-fonte React
│   ├── dist/          # build atual (servido pelo Nginx)
│   ├── .env           # ⚠️ NUNCA comitar
│   └── package.json
├── n8n/
│   └── workflows/     # exports dos workflows
├── docs/              # esta documentação
├── docker-compose.yml
├── README.md
└── DEPLOY.md

/usr/local/bin/
└── nailflow-backup.sh

/var/backups/nailflow/
└── nailflow_*.dump    # backups diários
```
