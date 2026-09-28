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

    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=(), usb=()" always;
    add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'self'; base-uri 'self'; form-action 'self'" always;
    proxy_hide_header X-Powered-By;

    location /api/ {
        proxy_pass http://localhost:3333/;
    }

    location = /api/auth/login    { limit_req zone=zone_auth burst=5 nodelay;   proxy_pass http://localhost:3333/auth/login; }
    location = /api/auth/register { limit_req zone=zone_auth burst=5 nodelay;   proxy_pass http://localhost:3333/auth/register; }
    location ^~ /api/public/      { limit_req zone=zone_public burst=10 nodelay; proxy_pass http://localhost:3333/public/; }
    location = /api/whatsapp/connect { limit_req zone=zone_whatsapp burst=3 nodelay; proxy_pass http://localhost:3333/whatsapp/connect; }

    location / {
        try_files $uri $uri/ /index.html;  # SPA fallback
    }
}
```

CSP validada em modo `Report-Only` antes de aplicar como enforcing (2026-09-28) — zero violações no console com o build atual (sem script/style inline; só `fonts.googleapis.com`/`fonts.gstatic.com` e imagens `data:` do avatar em base64).

Rate limiting de rede (`limit_req`, além do rate limiting já existente na aplicação Express) definido em `/etc/nginx/nginx.conf`:
```nginx
limit_req_zone $binary_remote_addr zone=zone_auth:10m      rate=30r/m;
limit_req_zone $binary_remote_addr zone=zone_public:10m    rate=60r/m;
limit_req_zone $binary_remote_addr zone=zone_whatsapp:10m  rate=30r/m;
limit_req_status 429;
server_tokens off;
```

### nailflow-n8n.duckdns.org (n8n)

```nginx
server {
    listen 443 ssl;
    server_name nailflow-n8n.duckdns.org;

    add_header Strict-Transport-Security "max-age=31536000" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=(), usb=()" always;

    location / {
        proxy_pass http://localhost:5678;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 300s;
    }
}
```

### nailflow-evolution.duckdns.org (Evolution API)

Desde 2026-09-28, o `location /` do vhost da Evolution é restrito por IP (além dos mesmos security headers acima e `proxy_hide_header X-Powered-By`):
```nginx
location / {
    allow 127.0.0.1;
    allow ::1;
    allow 77.237.242.192;  # IP publico da propria VPS — necessario porque backend/n8n chamam
                            # o hostname publico (EVOLUTION_API_URL), e o trafego chega por
                            # hairpin NAT com esse IP, nao 127.0.0.1 (confirmado por teste ao vivo)
    deny all;
}
```

---

## PM2

| ID | Nome | Porta | Status |
|---|---|---|---|
| 0 | nailflow-backend | 3333 | online |
| 4 | n8n | 5678 | online |

O backend é iniciado pelo PM2 com `npm start` (`node src/server.js`) e lê o `backend/.env` via `dotenv`. `NODE_ENV=production` já está definido em produção (cookie de sessão com `Secure`, aplicado em 2026-09-27).

**Pendência conhecida (auditoria de 2026-09-28):** tanto o backend quanto o n8n rodam via PM2 como **root** (serviço `pm2-root.service`, `PM2_HOME=/root/.pm2`) — sem necessidade técnica real (nenhuma porta privilegiada, nenhum acesso a dispositivo). O risco é de amplificação de impacto: um RCE futuro em qualquer um dos dois daria acesso root ao servidor inteiro, não seria contido. Migração para usuários dedicados avaliada e proposta (ver [`PENDENCIAS.md`](./PENDENCIAS.md)), mas **não implementada** — é uma mudança de infraestrutura sensível (principalmente mover o `database.sqlite` do n8n para fora de `/root`), deixada para uma janela de manutenção planejada.

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

Containers: `evolution`, `evolution-db` (PostgreSQL), `redis` — todos rodam como root **dentro do próprio container** (padrão da imagem oficial); isolados pelo namespace do Docker e sem porta publicada em `0.0.0.0` (só `127.0.0.1:8080`), então o risco é bem menor do que um processo root direto no host.

Docker Compose localizado em: `/opt/evolution-api/docker-compose.yml`

Desde 2026-09-28, a imagem é fixada por **digest exato** (em vez da tag `latest`, que é reconstruída com o tempo e pode mudar sem aviso):
```yaml
image: evoapicloud/evolution-api@sha256:966625532d9076a2381e973a271307d107e6f070450de3abeeea8bd18be07252
```
Para atualizar de propósito: escolher a nova tag/digest desejado no Docker Hub, editar essa linha e rodar `docker compose up -d --force-recreate --no-deps evolution` (sempre conferir antes com `--dry-run` que nenhuma dependência será recriada).

Logs também ajustados em 2026-09-28 (estavam em nível `VERBOSE`/`debug`, gerando volume desnecessário e mais dados sensíveis nos logs):
```
LOG_LEVEL=ERROR,WARN
LOG_BAILEYS=error
```
E rotação de log do container adicionada no `docker-compose.yml` (`max-size: 10m`, `max-file: 5`).

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
