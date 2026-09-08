# NailFlow

Site privado de agenda para profissionais autônomas de manicure/nail design,
com página pública de consulta de horários e camada de automação via n8n
preparada para integração com WhatsApp.

## Escopo

- Site privado para a profissional (login)
- Agenda (visão dia/semana/mês)
- Cadastro de clientes e histórico de atendimentos
- Cadastro de serviços (preço, duração)
- Disponibilidade semanal (expediente + intervalo)
- Horários bloqueados (folgas, compromissos pontuais)
- Página pública, somente leitura, para a cliente ver horários livres
- Preparação para integração com WhatsApp via n8n (webhooks de novo
  agendamento, consulta de horários, confirmação, lembrete e cancelamento)

## Estrutura do projeto

```
nailflow/
├── backend/           # API Node.js/Express + PostgreSQL
│   ├── src/
│   │   ├── config/db.js
│   │   ├── middleware/ (auth.js, errorHandler.js)
│   │   ├── controllers/
│   │   ├── routes/
│   │   ├── utils/ (cálculo de disponibilidade, notificação ao n8n)
│   │   └── server.js
│   ├── db/ (schema.sql, seed.sql)
│   ├── tests/
│   └── .env.example
├── frontend/          # React + Vite + TypeScript + Tailwind
│   ├── src/
│   │   ├── pages/, components/, context/, services/
│   │   ├── App.tsx, main.tsx, types.ts
│   └── .env.example
├── n8n/
│   ├── workflows/ (5 arquivos .json prontos para importar)
│   └── README.md  (como importar, configurar credenciais e ativar)
└── docker-compose.yml  (Postgres + n8n opcional)
```

## Pré-requisitos

- Node.js 18 ou superior (usa `fetch` nativo e `node --test`)
- PostgreSQL 14+ (ou Docker, veja abaixo)
- npm

## 1. Subir o PostgreSQL

**Opção A — Docker (recomendado):**
```bash
docker compose up -d postgres
```
Isso sobe o Postgres na porta `5432` com usuário/senha `postgres`/`postgres`
e banco `nailflow` (já definidos no `docker-compose.yml`).

**Opção B — Postgres já instalado localmente:**
```bash
createdb nailflow
```

## 2. Configurar e rodar o backend

```bash
cd backend
npm install
cp .env.example .env
```

Abra `.env` e preencha pelo menos:
- `DATABASE_URL` — já vem correta para a Opção A do Docker; ajuste se usar
  outro host/usuário/senha.
- `JWT_SECRET` — troque por uma string aleatória longa.

Crie as tabelas e popule com dados de exemplo:
```bash
npm run db:create
npm run db:seed
```

Rode a API:
```bash
npm run dev
```
A API sobe em `http://localhost:3333`. Teste com:
```bash
curl http://localhost:3333/health
```

**Login de exemplo (criado pelo seed):**
- E-mail: `camila@nailflow.com`
- Senha: `senha123`

> ⚠️ O hash de senha em `db/seed.sql` foi gerado fora deste ambiente (sem
> acesso à internet para reinstalar dependências e reverificar o hash aqui).
> Se o login com `senha123` falhar, gere um hash novo rodando, dentro da
> pasta `backend` (depois do `npm install`):
> ```bash
> node -e "require('bcryptjs').hash('senha123', 10).then(console.log)"
> ```
> e substitua o valor de `password_hash` em `db/seed.sql` antes de rodar
> `npm run db:seed` (ou aplique um `UPDATE` direto no banco).

## 3. Configurar e rodar o frontend

Em outro terminal:
```bash
cd frontend
npm install
cp .env.example .env
npm run dev
```
Acesse `http://localhost:5173`. A página pública de horários fica em
`http://localhost:5173/agenda-publica`.

## 4. Rodar os testes básicos da API

```bash
cd backend
npm test
```
- `tests/health.test.js` roda sempre, sem precisar do banco (healthcheck e
  bloqueio de rotas autenticadas sem token).
- `tests/auth-flow.test.js` testa o fluxo real de login → uso do token →
  página pública. Pula automaticamente (com aviso) se o Postgres configurado
  em `DATABASE_URL` não estiver acessível.

## 5. Automação com n8n (WhatsApp)

Veja o passo a passo completo em [`n8n/README.md`](./n8n/README.md):
importar os 5 workflows, configurar variáveis (`API_URL`, `WHATSAPP_TOKEN`,
`WHATSAPP_PHONE_ID`), criar a credencial usada para chamar a API do NailFlow,
e ativar.

Se quiser subir um n8n local junto com o Postgres:
```bash
docker compose up -d
```
Isso sobe o n8n em `http://localhost:5678`.

## Variáveis de ambiente — resumo

### `backend/.env`
| Variável | Obrigatória | Descrição |
|---|---|---|
| `PORT` | não (default 3333) | Porta da API |
| `DATABASE_URL` | sim | Conexão com o Postgres |
| `JWT_SECRET` | sim | Segredo para assinar o JWT |
| `JWT_EXPIRES_IN` | não (default 7d) | Validade do token de login |
| `FRONTEND_URL` | sim | Origem liberada no CORS |
| `API_URL` | usada pelo n8n | URL pública desta API |
| `WHATSAPP_TOKEN` / `WHATSAPP_PHONE_ID` / `WHATSAPP_VERIFY_TOKEN` | só para integração WhatsApp | Credenciais da Meta (placeholders — preencher ao integrar) |
| `N8N_WEBHOOK_URL` | só para integração n8n | URL do webhook do n8n para receber eventos de confirmação/cancelamento |

### `frontend/.env`
| Variável | Obrigatória | Descrição |
|---|---|---|
| `VITE_API_URL` | sim | URL da API consumida pelo frontend |

## Status conhecido / limitações documentadas

- O hash de senha do seed pode precisar ser regerado localmente (ver seção 2).
- A verificação do webhook do WhatsApp (handshake GET da Meta) não está
  implementada nos workflows — é um passo manual único, documentado em
  `n8n/README.md`.
- O token usado pelo n8n para chamar a API expira conforme `JWT_EXPIRES_IN`;
  para automação de longo prazo, ver a nota em `n8n/README.md`.
- O projeto assume uma única profissional por instalação (multi-tenant não
  faz parte do escopo atual).
