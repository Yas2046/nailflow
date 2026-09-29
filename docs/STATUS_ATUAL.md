# NailFlow — Status Atual (2026-09-29)

## Git

- **Repositório:** https://github.com/Yas2046/nailflow
- **Branch de trabalho:** `feat/phase5-register`
- **Último commit:** `c49189b` — feat(admin): registrar audit log de bloqueio, desbloqueio, edicao e exclusao
- **Sincronização:** `feat/phase5-register` = `origin/feat/phase5-register`
- **Working tree:** limpo após os commits de 2026-09-29 (recorrência por X dias, badge WhatsApp em Serviços, Agenda sem limite de antecedência, Admin bloquear/editar/excluir, audit log)
- **Atenção — `main`:** o `main` local e o `origin/main` estão divergentes entre si e **não contêm a V1 nem a V2**. A integração ao `main` ainda não foi feita.

### Histórico recente

```
b26d682 chore: version V2 production changes                                  (2026-09-25)
38b3fe7 feat: finalize NailFlow V2                                            (2026-09-24)
d82603c feat: finalize NailFlow V1                                            (2026-09-24)
c516245 feat(notifications): incluir waInstance no payload de notificações WhatsApp
5be11da feat(whatsapp): gestão completa de instâncias Evolution pelo NailFlow
9255bba chore(.gitignore): ignorar backups de sessão e arquivos .bak-*
022a24b chore(n8n): atualizar export do workflow definitivo
ba226de fix(botAuth): adicionar fallback waInstance e remover log de debug
5f740ba fix(ttl): corrigir TTL do ATENDIMENTO_HUMANO ignorando updated_at contaminado por trigger
5308ee3 fix(qr): renderizar QR Code via canvas com qrcode lib
de9448d docs+feat(bloco5+whatsapp): documentação de transição e CRM/WhatsApp
```

---

## Versões do produto

### V1 — `d82603c` (2026-09-24)
- Páginas **Início** e **Gastos** (despesas: `expenses`), Dashboard, Agenda, Clientes, Serviços, Perfil
- Tema/Aparência (`ThemeContext`) e toasts
- Gestão de instâncias WhatsApp pelo NailFlow (criar/remover instância Evolution, QR renderizado via canvas)
- Correções: TTL do atendimento humano, fallback `waInstance` no `botAuth`

### V2 — `38b3fe7` (2026-09-24)
- **Área administrativa**: coluna `is_admin`, middleware `requireAdmin`, rota `GET /admin/professionals`, layout próprio `AdminLayout` (sem a navegação da profissional)
- Ajustes em Agenda, Clientes, Dashboard e Gastos

### V2 — mudanças de produção versionadas em `b26d682` (2026-09-25)
Estas mudanças já estavam em produção antes do commit:
- **Antecedência máxima** por profissional (`booking_horizon_days`) usada por Agenda, página pública e bot
- **Fechamentos da agenda** (`recurring_exceptions`): data específica, dia da semana recorrente (1ª–5ª/última) e período
- **Agenda**: navegação dia/semana/mês limitada pela antecedência; aviso "Agenda aberta até …"
- **Onboarding** "Primeiros passos" na tela Início + `GET /onboarding/status`
- **Disponibilidade**: aviso de horários sugeridos enquanto nenhum dia de atendimento foi salvo
- **Correção do bot**: `getAvailableDaysWithSlots` perdia o parâmetro `$1` na query (ver [`FLUXOS_DO_BOT.md`](./FLUXOS_DO_BOT.md))
- Migrations retroativas **007–010** e `.gitignore` reforçado

### Fechamento técnico da V2 (2026-09-27, aplicado em produção, sem commit)
- **V1 fechada; V2 funcionalmente fechada; fechamento técnico avançado.** O que resta: revisão final, commit/push e, depois, validação real pelo WhatsApp (ver [`PENDENCIAS.md`](./PENDENCIAS.md))
- **Crons de Abandono e Lembretes corrigidos** (falhavam desde 2026-09-21) — ver [`N8N.md`](./N8N.md)
- **Webhooks do n8n autenticados** por cabeçalho `X-NailFlow-Webhook-Secret` (credenciais Header Auth; segredos `N8N_BOT_WEBHOOK_SECRET` e `N8N_NOTIFY_SECRET` só no `.env` e no n8n)
- **Bot:** classificador de respostas sim/não (`utils/replyClassifier.js`)
- **Agendamentos:** `clientId` de outra profissional recusado (400 "Cliente inválido.")
- **Clientes:** telefone normalizado e validado no painel (400 inválido, 409 duplicado), com a mesma regra do bot (`utils/phone.js`)
- **Migrations reproduzíveis:** 002 oficial restaurada, `002_bot_tables` movida para `_historico/`, novas 011–014; instalação nova idêntica a produção exceto o índice duplicado e comentários. **Nenhuma migration executada em produção** (não é necessário)
- **Seed compatível** com o schema atual (inclusão de `slug`)
- **Suíte automatizada: 57/57 passando**, em dois bancos descartáveis com resultado idêntico (setups de teste corrigidos: `slug` e telefone válido)

---

## Rodada de segurança V6–V17 (2026-09-28)

Auditoria numerada (itens 9–17) seguida de correções implementadas, testadas e commitadas:

- **Isolamento multi-tenant reforçado no banco**: foreign keys compostas `(id, professional_id)` (migration 017) garantem no PostgreSQL, não só na aplicação, que uma profissional nunca alcança dado de outra
- **Bloqueio/revogação de conta**: `blocked_at` + `token_version` (migration 016), checados a cada requisição autenticada direto no banco
- **Unicidade de instância WhatsApp**: índice único parcial em `wa_instance_name` (migration 015)
- **Rotas de instância WhatsApp mais seguras**: `PUT`/`DELETE /whatsapp/instance` removidas (permitiam assumir/orfanar instância sem sincronizar com a Evolution)
- **Bot**: `instance` obrigatório em todas as rotas (sem fallback), cancelamento valida dono do agendamento, CORS `*` removido de `/bot`
- **Dependências**: `qs`/`body-parser`/`express` atualizados via `npm audit fix` (sem `--force`); `react-router-dom` auditado e mantido em 6.30.6 (ver [`PENDENCIAS.md`](./PENDENCIAS.md) — não há exploração possível no uso atual)
- **Rate limiting**: por rota no Express (login, registro, conexão WhatsApp, página pública) e por IP no Nginx (`limit_req`)
- **Security headers e CSP**: HSTS, X-Content-Type-Options, X-Frame-Options, Referrer-Policy, Permissions-Policy e CSP (validada em Report-Only antes de aplicar, zero violações); `server_tokens off`; `X-Powered-By` oculto
- **Evolution API**: exposição pública fechada no Nginx (restrita por IP, confirmado o hairpin NAT do n8n/backend antes de aplicar); logs reduzidos de `VERBOSE`/`debug` para `ERROR,WARN`/`error` com rotação; imagem Docker fixada por digest exato
- **Permissões de arquivo**: `.env` (backend/frontend), `.pgpass` e o sqlite do n8n em `600`
- **Segredos em scripts**: senha do PostgreSQL removida de 5 scripts de teste em `/root/v2close-20260927/`, migrada para `/root/.pgpass`

**Pendente desta rodada** (ver [`PENDENCIAS.md`](./PENDENCIAS.md) para detalhes): PM2 (backend e n8n) ainda roda como root; 9 testes antigos esperando `body.token` no login; exports do n8n "Definitivo"/"Notificações" ainda não regenerados.

---

## Rodada Admin/Auditoria/Segurança (2026-09-29)

Trabalho de hoje, em 6 commits sequenciais em `feat/phase5-register`: `f1eb77a` → `bead346` → `ae4d3fa` → `6bcd398` → `5ae9d72` → `c49189b`.

### Agenda, Clientes e Serviços

- **Recorrência de agendamento "Por X dias"**: além de "Até uma data" (`AppointmentModal.tsx`), calcula `data inicial + X dias`; validado com casos de virada de mês/ano. Não muda o payload enviado ao backend (continua só `endsOn`)
- **Badge visual em Serviços**: "WhatsApp" (verde) ou "Somente Agenda" (neutro) no card, só para serviços ativos — mostra de relance quais serviços o bot/página pública oferece
- **Agenda sem limite de antecedência**: a navegação e criação de agendamentos na Agenda interna deixou de ser limitada por `booking_horizon_days`. Esse campo agora controla só o agendamento externo (WhatsApp + página pública); `Disponibilidade.tsx` foi ajustada para deixar isso explícito no texto

### Admin — bloquear, editar e excluir profissionais

Antes de hoje, o Admin só listava profissionais (leitura). Agora:

- **Bloquear/desbloquear** (`POST /admin/professionals/:id/block` e `.../unblock`): usa a infraestrutura que já existia (`blocked_at`, `token_version`, migration 016) — só faltavam os endpoints. Desbloqueio sobe `token_version`, forçando novo login. Impede autobloqueio
- **Editar** (`PUT /admin/professionals/:id`): reaproveita literalmente o mesmo schema/validação de `PUT /auth/me` (nome, negócio, WhatsApp, e-mail, foto); e-mail único; não permite editar a própria conta nem tocar em `slug`, `wa_instance_name`, `is_admin`, `blocked_at`, `token_version` ou senha — cada um desses tem fluxo próprio ou não deveria ser editável por aqui
- **Excluir definitivamente** (`DELETE /admin/professionals/:id`): fluxo em 3 passos — 1) snapshot da profissional e de todos os dados relacionados em `/var/backups/nailflow/deleted-professionals/` (arquivo `600`, diretório `700`, fora de `/var/www`, nunca servido pela aplicação, retenção de 90 dias autopodada a cada nova exclusão); 2) se houver `wa_instance_name`, exclui a instância na Evolution API — **se falhar, aborta e não mexe no banco**; 3) `DELETE FROM professionals` dentro de transação (os `ON DELETE CASCADE` da migration 017 apagam clientes/agendamentos/serviços/etc. na mesma operação). Exige digitar o nome exato do negócio para confirmar; impede autoexclusão e exclusão da última conta admin
- **Tela Admin responsiva**: abaixo de `md`, a tabela é substituída por cards (mesmo padrão visual de `Servicos.tsx`); desktop inalterado

### Audit log

- Nova tabela `admin_audit_log` (migration 019): `actor_id`, `actor_email`, `action` (`block`/`unblock`/`update`/`delete`), `target_id`, `target_business_name`, `created_at`. **Sem FK obrigatória** para `professionals` em nenhum dos dois lados — o registro precisa sobreviver à exclusão do ator ou do alvo
- `actor_email` e `target_business_name` ficam denormalizados de propósito, pelo mesmo motivo
- Função reutilizável `logAdminAction()` (`backend/src/utils/auditLog.js`), chamada nos 4 fluxos acima **só após sucesso confirmado** (no `delete`, só depois do `COMMIT`) — nesta primeira versão, tentativas/falhas não são registradas
- Sem senha, hash, token, `token_version` ou chave de API em nenhum registro
- Ainda **sem tela de auditoria** no Admin (fica para uma etapa futura, se decidido)

### Segurança — revisão completa do estado atual

Revisão dedicada em 2026-09-29, cobrindo autenticação/sessões, isolamento por `professional_id`, IDOR/BOLA, SQL injection, XSS, CSRF, CORS, headers, secrets/arquivos, rate limiting, dependências e as migrations 016–019. **Nenhum problema real encontrado** — nenhuma alteração de código foi necessária. Resumo:

- **Autenticação/sessões**: JWT em cookie `httpOnly`+`secure`+`sameSite=lax`; `blocked_at` e `token_version` checados a cada request autenticada (não só no login)
- **Isolamento/IDOR**: todo update/delete/get-by-id em `appointments`, `services`, `clients`, `expenses` usa `WHERE id = $1 AND professional_id = $2`; nenhuma exceção real encontrada (um `DELETE` sem esse filtro em `recurring_groups` opera só sobre um id gerado na própria request, não é explorável)
- **SQL/XSS/CSRF/CORS**: nenhuma interpolação de input de usuário em SQL (parametrização consistente); nenhum `dangerouslySetInnerHTML`/`eval`; CSRF mitigado pelo cookie `sameSite=lax`; CORS restrito ao domínio de produção com `credentials: true` (não é wildcard)
- **Headers/secrets/rate limiting**: HSTS/CSP/X-Frame-Options/etc. confirmados ao vivo via `curl` em produção; `X-Powered-By` oculto para tráfego externo; porta 3333 do Node bloqueada pelo firewall (UFW `default deny incoming`, só 22/80/443 liberados); `.env` em `600`, fora do Git; rate limit presente em login/registro
- **Dependências**: `npm audit` do backend limpo (0 vulnerabilidades); frontend com 2 vulnerabilidades **moderadas** em `react-router-dom` (não corrigidas agora — exigem bump major/breaking change; ver [`PENDENCIAS.md`](./PENDENCIAS.md), item I15)

### WhatsApp — pendência de validação prática (não mudou hoje)

Nada do trabalho de hoje envolveu WhatsApp/n8n/Evolution além da chamada de exclusão de instância já descrita acima (que só executa quando o Admin efetivamente exclui uma profissional com `wa_instance_name` configurado — não foi exercida contra nenhuma conta real). As pendências já registradas continuam de pé: ver [`PENDENCIAS.md`](./PENDENCIAS.md), itens **C1–C3** (validar mensagem real após reconectar, agendamento e cancelamento ponta a ponta pelo WhatsApp).

### 🟡 Pendências registradas hoje (não bloqueantes)

- Rate limiting nos endpoints `/admin/professionals/*` (bloquear/editar/excluir) — hoje protegidos só por JWT + `is_admin` (ver [`PENDENCIAS.md`](./PENDENCIAS.md), item M5)
- `react-router-dom`: 2 advisories moderados reconfirmados, decisão de não corrigir agora mantida (item I15)
- Tela de histórico/auditoria no Admin — o log já é gravado, mas não há UI para consultá-lo ainda

### Próximos passos sugeridos

1. Validação prática do WhatsApp (C1–C3 em [`PENDENCIAS.md`](./PENDENCIAS.md)) — segue dependendo de autorização e reconexão do `chip2`
2. Decidir se/quando construir uma tela de consulta do `admin_audit_log`
3. Avaliar o upgrade major do `react-router-dom` como tarefa própria, com sua rodada de testes

---

## O que NÃO está publicado

| Item | Situação |
|---|---|
| Recuperação de senha ("Esqueci minha senha") | ❌ não publicada |
| Troca de senha logada | ❌ não publicada |
| Invalidação de sessões após troca de senha | ❌ não publicada |
| Normalização de e-mail no login | ❌ não publicada |

A recuperação de senha **continua isolada e não publicada**. (`NODE_ENV=production` já está aplicado em produção desde 2026-09-27, fora do escopo do `nailflow-next` — cookie de sessão já sai com `Secure`.)

Existe uma **implementação isolada** desses itens em `/opt/nailflow-next` (fora do repositório e fora de produção), validada somente em ambiente de teste com banco descartável. **O Brevo (SMTP) ainda não está configurado.** Nada disso deve ser tratado como funcionalidade disponível até a publicação autorizada.

Também existe `frontend/dist-next/` (build candidato dessa implementação), ignorado pelo Git e **não servido** pelo Nginx.

---

## Arquivos fora do Git (por design)

| Arquivo/Pasta | Motivo |
|---|---|
| `backend/.env`, `frontend/.env`, `.env.*` | Segredos e configuração de produção |
| `backend/backup_*/`, `**/backup_*.sql`, `*.bak*` | Backups de dev e dumps |
| `frontend/dist/`, `frontend/dist-*/`, `dist.bak*` | Builds compilados |
| `*.pem`, `*.key`, `*.sqlite`, `*.pid`, `*.eml`, `mail-out/`, `coverage/` | Chaves, bancos locais e artefatos de teste |

Regras definidas no `.gitignore` (atualizado em `b26d682`). Sempre adicionar arquivos ao Git **por nome** — nunca `git add .`.

---

## Estado dos serviços (verificado em 2026-09-25; n8n e Evolution conferidos em 2026-09-27)

| Serviço | Status |
|---|---|
| nailflow-backend (PM2 id 0) | online |
| n8n (PM2 id 4) | online |
| Evolution API (Docker: `evolution`, `evolution-db`, `redis`) | running |
| Nginx | active |
| PostgreSQL 16 | listening em localhost |
| UFW | active (22, 80, 443) |
| n8n — 4 workflows ativos | Definitivo, Notificações, Abandono e Lembretes; crons com execuções `success` em 2026-09-27 |

### Instâncias WhatsApp

- `chip2` — **desconectado intencionalmente** desde 2026-09-27 (estava `open` em 2026-09-25)
- `chip2-teste` — instância da conta de teste; **desconectada intencionalmente**
- Não reconectar sem autorização. Nenhuma mensagem real nem teste real de webhook depois da desconexão

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
