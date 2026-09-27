# NailFlow — Pendências e Auditoria

> Atualizado em 2026-09-27.

---

## Atenção antes de reconectar o `chip2`

- O webhook `whatsapp-nailflow` passou a exigir o cabeçalho `X-NailFlow-Webhook-Secret` em 2026-09-27 e **ainda não recebeu nenhuma mensagem real** com essa configuração
- Ao reconectar, acompanhar a primeira mensagem: se o n8n responder 403, o bot fica mudo. Rollback em [`N8N.md`](./N8N.md)
- A reconexão é feita pela responsável; `chip2` e `chip2-teste` estão desconectados intencionalmente

---

## Recuperação e troca de senha — NÃO publicadas

- Implementação isolada em `/opt/nailflow-next` (fora do Git e fora de produção), validada apenas em ambiente de teste com banco descartável e SMTP simulado
- Inclui: "Esqueci minha senha" por e-mail, troca de senha logada, invalidação de sessões anteriores, normalização de e-mail no login e `NODE_ENV=production` (cookie `Secure`)
- **Bloqueios para publicar:** conta Brevo e remetente configurados; `SMTP_PASS` inserido pela responsável no `.env` do servidor; autorização explícita
- Ordem de publicação exigida: migration → backend (`npm install`) → `.env` → restart → troca `dist` ↔ `dist-next`
- **Não documentar nem divulgar como funcionalidade disponível** até a publicação

---

## Auditoria de pendências

### 🔴 Crítico

**C1. Validar a primeira mensagem real após reconectar o `chip2`** (webhook com Header Auth, bot, classificador sim/não)

**C2. Testar agendamento completo pelo WhatsApp com uma cliente real**
- O fluxo foi validado via `/bot/process` com telefone de teste após a correção do `$1`; falta um teste ponta a ponta pelo WhatsApp (mensagem → serviço → data → horário → confirmação)

**C3. Testar cancelamento pelo WhatsApp**

**C4. Integrar V1/V2 ao `main`**
- `main` local e `origin/main` estão divergentes e não contêm V1 nem V2; todo o trabalho está em `feat/phase5-register`

**C5. Revisão final e commit/push das mudanças de 2026-09-27** (backend, testes, seed, migrations e docs) — revisar o diff e adicionar arquivos por nome, incluindo os 2 exports regenerados do n8n (`nailflow_abandono_de_conversa.json`, `nailflow_lembretes_de_agendamento.json`)

---

### 🟠 Importante

**I1. Publicar recuperação/troca de senha** — ver seção acima.

**I2. Node "Registrar Mensagem Bot" sem `instance`**
- Retorna 400 com mais de uma profissional cadastrada; as mensagens do bot não são gravadas em `message_history` (o envio à cliente não é afetado)
- Correção: incluir o nome da instância na chamada `POST /bot/record-sent` do workflow (altera workflow — só com autorização)

**I3. SSH aceita login de root com senha**
- `PermitRootLogin yes` e `PasswordAuthentication yes`. Recomendado passar para acesso somente por chave, **depois** de confirmar que o acesso por chave funciona (risco de perder o acesso se feito sem confirmação)

**I4. Painel do n8n público via HTTPS**
- Protegido apenas pelo login do n8n. Usar senha forte e, se possível, 2FA; restringir por Nginx fica para depois

**I5. Conexão WhatsApp via painel (QR pelo sistema) — teste completo** com instância de teste

**I6. Modo ATENDIMENTO_HUMANO — teste completo**: frase de escape, TTL de 4h, retorno automático

**I7. 3 tentativas inválidas → ATENDIMENTO_HUMANO** — validar

**I8. Variável `N8N_API_KEY`** — não é usada no código e já não consta do `.env.example`; falta removê-la do `.env` do servidor (o mesmo vale para `N8N_PROFESSIONAL_ID`, também não lida pelo código)

**I9. Regenerar os exports do "Definitivo" e do "Notificações"**
- Os exports de Abandono e Lembretes já foram regenerados das versões publicadas (2026-09-27) e podem ser versionados
- Falta gerar, do mesmo jeito e sem credenciais, os do "WhatsApp NailFlow — Definitivo" e do "NailFlow — Notificações"; os arquivos antigos na pasta não refletem as versões publicadas

**I10. Validar envio real de lembrete e de abandono** após a correção dos crons (os loops internos ainda não rodaram com itens)

**I11. Notificação de confirmação/cancelamento pelo painel** — validar com o cabeçalho novo

---

### 🟡 Melhoria

**M1. Workflows duplicados no n8n**
- Remover versões antigas (WhatsApp Principal x2, Lembretes duplicado, Verificação Meta x4)

**M2. Webhooks antigos no n8n**
- `evolution-chip2` e `nailflow/mensagem-recebida` pertencem a workflows inativos

**M3. Índice duplicado em `message_history`**
- `message_history_dedup_idx` repete `idx_message_history_wa_id`; existe só em produção. Remoção deixada deliberadamente para depois — não é urgente

**M3b. `message_history.client_id`**
- Coluna não usada pelo código (0 linhas preenchidas); decidir se passa a ser gravada ou se é removida

**M4. Numeração das migrations**
- A 002 é aplicada antes da 001 e há dois "003" no histórico. Não causa erro, mas exige seguir a ordem documentada em [`BANCO_DE_DADOS.md`](./BANCO_DE_DADOS.md)

**M6. Migração do número real da profissional**
1. Criar nova instância Evolution
2. Parear com o número real (⚠️ uma tentativa de QR, sem loop)
3. Atualizar `wa_instance_name` no banco
4. Conferir o webhook na Evolution
- **NUNCA conectar o número real sem testes e autorização explícita**

---

### 🟢 Futuro

**F1. Campanhas de WhatsApp** (envio em massa / reativação de clientes inativas) — não implementado
**F2. Monitoramento de produção** — alertas de queda do bot e de falha dos crons (a falha de 2026-09-21 passou dias sem ser percebida; e um cron pode terminar "success" sem trabalhar)
**F3. Autenticação** — revisar expiração do JWT; refresh token; CSRF
**F4. Rate limiting por número no bot**
**F5. Export de dados (LGPD)**
**F6. Logs estruturados** (Winston/Pino)
**F7. Versão pública para portfólio** — repositório separado, com histórico novo e sem infraestrutura/segredos

---

## Resolvido

| Item | Quando | Como |
|---|---|---|
| `POST nailflow/notificacoes` → 404 | até 2026-09-22 | Workflow "Notificações" ativado; webhook registrado |
| Commitar Bloco 5 CRM + rotas WhatsApp | V1 (`d82603c`) | Versionados |
| Bot sem resposta após escolher serviço (`$1` ausente) | 2026-09-24 | Query corrigida; versionada em `b26d682` |
| Backend (3333) e n8n (5678) expostos na internet | 2026-09-25 | UFW ativo; públicas só 22/80/443 |
| Mudanças de produção sem commit e migrations não versionadas | 2026-09-25 | Commit `b26d682` com migrations 007–010 |
| `.gitignore` incompleto (`.env.*`, `dist-*`, dumps, chaves) | 2026-09-25 | Atualizado em `b26d682` |
| Multi-profissional real | até 2026-09-25 | Várias profissionais cadastradas; crons e bot iteram por instância |
| Crons de Abandono e Lembretes falhando desde 2026-09-21 | 2026-09-27 | Loop por instância com saídas corrigidas, Always Output Data e condição de "Tem lembretes?" (ver [`N8N.md`](./N8N.md)) |
| Webhooks do n8n sem autenticação | 2026-09-27 | Header Auth com `X-NailFlow-Webhook-Secret` nos dois webhooks ativos |
| Bot confirmava respostas ambíguas ("segunda seria melhor") | 2026-09-27 | `classifyReply` |
| Agendamento aceitava `clientId` de outra profissional | 2026-09-27 | `assertOwnClient` (400) |
| Telefone de cliente gravado como digitado no painel | 2026-09-27 | Normalização, 400 e 409 (`utils/phone.js`) |
| Migrations não reproduziam produção (51 divergências; 002 obsoleta na ordem) | 2026-09-27 | 002 oficial restaurada, obsoleta em `_historico/`, novas 011–014 |
| `expenses` não documentada | 2026-09-27 | [`BANCO_DE_DADOS.md`](./BANCO_DE_DADOS.md) |
| `.env.example` com nomes antigos | até 2026-09-27 | Usa `N8N_WEBHOOK_CONFIRMED_URL` / `N8N_WEBHOOK_CANCELLED_URL` e os nomes dos novos segredos, sem valores |
| Exemplo de QR com valor real em `WHATSAPP_EVOLUTION.md` | 2026-09-27 | Trocado por placeholder |
| Exports de Abandono e Lembretes errados (saídas do loop trocadas) | 2026-09-27 | Regenerados com `n8n export:workflow --published` das versões `d566c2fe` / `9da88cb4`; sem segredos |
| `seed.sql` quebrado e 30 testes falhando (sem `slug`) | 2026-09-27 | `slug` no seed e nos setups de teste; telefone válido no `price-snapshot`; suíte 57/57 em dois bancos descartáveis |
