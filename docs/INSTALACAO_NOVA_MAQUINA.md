# NailFlow — Instalação em Nova Máquina

> Este guia é para **desenvolvimento local** em uma nova máquina.
> O VPS (77.237.242.192) continua em produção e NÃO precisa ser reinstalado.

---

## O que NÃO instalar na nova máquina

| Componente | Motivo |
|---|---|
| Evolution API | Roda no VPS via Docker — não precisa localmente |
| n8n (produção) | Roda no VPS via PM2 — não precisa localmente |
| PostgreSQL de produção | Banco vive no VPS — acessa via SSH tunnel se necessário |
| PM2 | Só necessário no VPS |
| Nginx | Só necessário no VPS |

Para desenvolvimento local, o banco de dados pode ser criado localmente via Docker (ver abaixo).

---

## Pré-requisitos

| Ferramenta | Versão mínima | Como instalar |
|---|---|---|
| Node.js | 22.x | https://nodejs.org ou nvm |
| npm | 10.x | vem com Node.js |
| Git | qualquer | https://git-scm.com |
| Docker Desktop | qualquer | https://docker.com (opcional, para DB local) |
| VS Code ou similar | — | recomendado |

### Verificar versões

```bash
node --version   # deve ser v22.x
npm --version    # deve ser 10.x
git --version
```

---

## 1. Clonar o repositório

```bash
git clone https://github.com/Yas2046/nailflow.git
cd nailflow
git checkout feat/phase5-register
```

---

## 2. Backend

### 2.1 Instalar dependências

```bash
cd backend
npm install
```

### 2.2 Configurar variáveis de ambiente

```bash
cp .env.example .env
```

Editar o `.env` com os valores corretos:

| Variável | O que colocar |
|---|---|
| `PORT` | `3333` |
| `DATABASE_URL` | string do banco local (ver seção 4) ou pedir para a Yasmin |
| `JWT_SECRET` | string aleatória longa (ex: `openssl rand -hex 32`) |
| `JWT_EXPIRES_IN` | `7d` |
| `FRONTEND_URL` | `http://localhost:5173` |
| `API_URL` | `http://localhost:3333` |
| `WHATSAPP_TOKEN` | deixar vazio (Meta WABA — não em uso) |
| `WHATSAPP_PHONE_ID` | deixar vazio |
| `WHATSAPP_VERIFY_TOKEN` | deixar vazio |
| `N8N_WEBHOOK_CONFIRMED_URL` | URL do webhook n8n de confirmação |
| `N8N_WEBHOOK_CANCELLED_URL` | URL do webhook n8n de cancelamento |
| `N8N_BOT_WEBHOOK_URL` | URL do webhook `whatsapp-nailflow`, configurada nas instâncias criadas pelo painel |
| `N8N_BOT_WEBHOOK_SECRET` | segredo do cabeçalho `X-NailFlow-Webhook-Secret` enviado pela Evolution ao n8n — gerar localmente (ex: `openssl rand -hex 32`); sem ele a criação de instância pelo painel falha |
| `N8N_NOTIFY_SECRET` | segredo do mesmo cabeçalho enviado pelo backend ao webhook de notificações — gerar localmente |
| `N8N_PROFESSIONAL_ID` | não é lido pelo código atual; existe no `.env` de produção por histórico |
| `EVOLUTION_API_URL` | `http://127.0.0.1:8080` (só acessível no VPS) |
| `EVOLUTION_API_KEY` | chave da Evolution — solicitar à Yasmin |
| `BOT_API_KEY` | chave do bot — solicitar à Yasmin |

> **Nunca commitar o `.env` com valores reais.** Os segredos de produção (`N8N_BOT_WEBHOOK_SECRET`, `N8N_NOTIFY_SECRET` etc.) ficam só no `.env` do servidor e nas credenciais do n8n; para desenvolvimento, gere valores próprios.

### 2.3 Iniciar em modo desenvolvimento

```bash
npm run dev
```

Backend disponível em: http://localhost:3333

---

## 3. Frontend

### 3.1 Instalar dependências

```bash
cd frontend
npm install
```

### 3.2 Configurar variáveis

```bash
cp .env.example .env
```

Editar:
```
VITE_API_URL=http://localhost:3333
```

### 3.3 Iniciar

```bash
npm run dev
```

Frontend disponível em: http://localhost:5173

---

## 4. Banco de dados local (opcional)

Para dev local sem acessar o banco de produção:

### Opção A: Docker (recomendado)

```bash
# Na raiz do projeto
docker-compose up -d postgres
```

Depois aplicar o schema e as migrations, **nesta ordem** (a 002 vem antes da 001):
```bash
cd backend
export DATABASE_URL="postgres://postgres:postgres@localhost:5432/nailflow"
npm run db:create      # aplica db/schema.sql

psql $DATABASE_URL -f db/migrations/002_evolution_api_tables.sql
psql $DATABASE_URL -f db/migrations/001_add_price_cents_snapshot.sql
psql $DATABASE_URL -f db/migrations/003_recurring_appointments.sql
psql $DATABASE_URL -f db/migrations/004_reminder_sent.sql
psql $DATABASE_URL -f db/migrations/005_slug_wa_instance.sql
psql $DATABASE_URL -f db/migrations/006_phone_whatsapp_nullable.sql
psql $DATABASE_URL -f db/migrations/007_booking_horizon_days.sql
psql $DATABASE_URL -f db/migrations/008_recurring_exceptions.sql
psql $DATABASE_URL -f db/migrations/009_recurring_exceptions_date_range.sql
psql $DATABASE_URL -f db/migrations/010_is_admin.sql
psql $DATABASE_URL -f db/migrations/011_conversation_bot_columns.sql
psql $DATABASE_URL -f db/migrations/012_clients_tags.sql
psql $DATABASE_URL -f db/migrations/013_professionals_avatar.sql
psql $DATABASE_URL -f db/migrations/014_expenses.sql
```

- A migration 002 oficial é **`db/migrations/002_evolution_api_tables.sql`** (tabelas do bot). **Não execute `db/migrations/_historico/002_bot_tables.sql`**: é uma versão obsoleta, guardada só como histórico, que cria as tabelas do bot num formato incompatível com o código.
- As migrations **007–014 fazem parte da sequência atual**: 007–010 são necessárias para Disponibilidade (antecedência e fechamentos) e para a área administrativa; 011 para o bot; 012 para o CRM (tags); 013 para a foto do Perfil; 014 para Gastos e Dashboard. Detalhes em [`BANCO_DE_DADOS.md`](./BANCO_DE_DADOS.md).
- Não há executor de migrations: aplicar com `psql`, com o dono do banco.
- **Seed (opcional):** depois de todas as migrations, `npm run db:seed` cria a conta de exemplo `camila@nailflow.com` / `senha123` com serviços, expediente e clientes fictícias.

Para ter uma conta de administração local, marque-a no banco: `UPDATE professionals SET is_admin = true WHERE email = '<seu-email-local>';`

### Opção B: Conectar ao banco de produção (via SSH tunnel)

```bash
ssh -L 5433:localhost:5432 root@nailflow.duckdns.org -N &
# Em outro terminal:
export DATABASE_URL="postgres://postgres:SENHA@localhost:5433/nailflow"
```

> A senha do postgres de produção deve ser solicitada à Yasmin.

---

## 5. Executar testes

```bash
cd backend
npm test        # node --test tests/*.test.js
```

> ⚠️ Os testes **gravam no banco** apontado por `DATABASE_URL`: rode-os sempre num banco descartável, nunca no de produção. Deixe vazias as URLs do n8n (`N8N_WEBHOOK_CONFIRMED_URL`, `N8N_WEBHOOK_CANCELLED_URL`) e aponte `EVOLUTION_API_URL` para um endereço inexistente, para nenhuma chamada sair da máquina.
>
> Para rodar a suíte completa, o banco descartável precisa estar montado com `schema.sql` → migrations 002, 001, 003–014 → `seed.sql` (o teste de login usa a conta do seed).
>
> Resultado atual (2026-09-27): **57 testes, 57 passam**, conferido em dois bancos descartáveis.

---

## 6. Como verificar se está funcionando

```bash
# Backend
curl http://localhost:3333/health

# Frontend
# Abrir http://localhost:5173 no browser
# Deve exibir a tela de login
```

---

## 7. Deploy no VPS (quando houver mudança)

Ver `DEPLOY.md` na raiz do projeto para o fluxo completo.

**Resumo:**
```bash
# Compilar frontend
cd frontend && npm run build

# Enviar ao VPS
scp -r src/ root@77.237.242.192:/var/www/nailflow/frontend/src/
scp -r dist/ root@77.237.242.192:/var/www/nailflow/frontend/dist/
scp -r ../backend/src/ root@77.237.242.192:/var/www/nailflow/backend/src/

# Reiniciar backend
ssh root@77.237.242.192 "pm2 restart 0 --update-env"
```

---

## 8. Acesso ao VPS

```bash
ssh root@nailflow.duckdns.org
# ou
ssh root@77.237.242.192
```

---

## 9. O que NÃO fazer

- Nunca commitar `.env`
- Nunca conectar o número real da profissional sem testes e autorização
- Nunca alterar Evolution, chip2 ou n8n sem entender o impacto
- Nunca fazer `git push --force` no branch principal
- Nunca apagar backups de `.bak*` sem verificar se são necessários
- Não editar arquivos diretamente no VPS sem commitar depois
- Não editar código via SSH com strings que contenham `$` (o shell pode remover placeholders como `$1`) — editar localmente e enviar com `scp`
- Não usar `git add .` — adicionar arquivos por nome e revisar `git status` antes do commit
- Não rodar `npm run build` direto em `/var/www/nailflow/frontend` sem querer publicar: essa pasta gera a `dist/` servida em produção
