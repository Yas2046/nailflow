# NailFlow — Pendências e Auditoria

> Atualizado em 2026-10-09: **ADM V1 publicado** (`main` = `origin/main` = `596d24a`; PID do backend 1511808) — dashboard, gestão de profissionais, auditoria e Central da conta; troca de senha logada e "sair de todos os dispositivos". Validado manualmente em produção, **exceto a foto da administradora (A7)**. Ver A7–A12 abaixo e o bloco do topo de [`STATUS_ATUAL.md`](./STATUS_ATUAL.md).
>
> Atualizado em 2026-10-03 (`main` = `origin/main` = `50906f5`, tudo publicado e em produção): pacote `cb07d38` (confirmação manual/automática, reserva temporária com expiração e sinal Pix manual) validado em 4 cenários E2E; `3bcbb1a` (card "Precisa da sua ação" na Início, atalho para a Agenda e scroll da página pública); `50906f5` (aviso interno `public_created` só com instância própria e telefone da profissional normalizado). Veja as linhas desses commits em "Resolvido" e as pendências M16–M20 (a M21, validação manual do card e do atalho, está concluída).
>
> Atualização anterior, 2026-10-02 (V1 integrado à `main` e publicado; onboarding com etapa "Seu link" e hero de boas-vindas; página pública personalizável — migration 020 aplicada; antecedência mínima de 30 min para clientes; Fase 1A do pré-agendamento — confirmar/recusar solicitações — concluída e validada em produção; código em produção até `47c2886`). Anteriormente, em 2026-10-01: C2/C3 validadas com cliente real, correções de hardening/API, F9 implementada com entrega real ainda pendente.

---

## `chip2` reconectado e validado (2026-09-30)

- `chip2` (Camila) foi reconectado via QR pela responsável e confirmado `state: "open"` na Evolution
- Primeira mensagem real após a reconexão **validada com sucesso**: cliente Simone Teles (`553185108190`) enviou mensagem, processada pelo webhook `whatsapp-nailflow` com `X-NailFlow-Webhook-Secret` (sem 403), workflow **"WhatsApp NailFlow — Definitivo"** executou com `status: success`, e a mensagem foi registrada em `message_history` (`professional_id` correto, sem cross-tenant) — ver C1 em Resolvido
- Envio de teste controlado para a mesma cliente (Simone) também validado, sem erro e sem disparo para qualquer outro contato
- `chip2-teste` segue desconectada; nenhuma alteração feita nela

---

## Recuperação de senha — NÃO publicada (a troca de senha logada foi publicada em 2026-10-08; ver a nota abaixo)

> **Atualização 2026-10-09:** a **troca de senha logada** e a invalidação de sessões foram publicadas no ADM V1 em versão própria (`PUT /auth/password` e `POST /auth/logout-all`, `token_version`, sem migration). **Continuam não publicadas** a recuperação por e-mail ("Esqueci minha senha"), a normalização de e-mail no login e o restante da implementação de `/opt/nailflow-next`.

- Implementação isolada em `/opt/nailflow-next` (fora do Git e fora de produção), validada apenas em ambiente de teste com banco descartável e SMTP simulado
- Inclui: "Esqueci minha senha" por e-mail, troca de senha logada, invalidação de sessões anteriores, normalização de e-mail no login e `NODE_ENV=production` (cookie `Secure`)
- **Bloqueios para publicar:** conta Brevo e remetente configurados; `SMTP_PASS` inserido pela responsável no `.env` do servidor; autorização explícita
- Ordem de publicação exigida: migration → backend (`npm install`) → `.env` → restart → troca `dist` ↔ `dist-next`
- **Não documentar nem divulgar como funcionalidade disponível** até a publicação

---

## Auditoria de pendências

### 🔴 Crítico

~~**C1. Validar a primeira mensagem real após reconectar o `chip2`**~~ — validado em 2026-09-30 (ver "Resolvido")

~~**C2. Testar agendamento completo pelo WhatsApp com uma cliente real**~~ — validado em 2026-10-01 (ver "Resolvido"): agendamento por linguagem natural (serviço + data + horário em uma mensagem), confirmação e criação do agendamento, com cliente real no WhatsApp

~~**C3. Testar cancelamento pelo WhatsApp**~~ — validado em 2026-10-01 (ver "Resolvido"): cancelamento por data + horário, confirmação e cancelamento real, retorno ao menu/início

~~**C4. Integrar V1/V2 ao `main`**~~ — integrado em 2026-10-02 (ver "Resolvido"): merge de `feat/phase5-register` em `main` resolvido a favor da feature (commit divergente `985c1f1` confirmado como superado, sem conteúdo exclusivo real além de 2 arquivos órfãos nunca ativados, preservados no merge); `main` e `origin/main` sincronizados e publicados. Build do frontend e suíte de testes do backend validados pós-merge (ver I14 para as falhas conhecidas). Restart do `nailflow-backend` confirmado em 2026-10-02 (ver "Resolvido", I16).

~~**C5. Revisão final e commit/push das mudanças de 2026-09-27**~~ — feito em 2026-09-28 (commit da rodada de segurança V6–V17). Os 2 exports do n8n regenerados (Abandono/Lembretes) e o restante ainda pendente (Definitivo/Notificações) seguem em I9.

---

### 🟠 Importante

**I1. Publicar a recuperação de senha ("Esqueci minha senha")** — ver seção acima. A troca de senha logada já foi publicada no ADM V1 (2026-10-08).

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

~~**I8. Variável `N8N_API_KEY`**~~ — resolvido em 2026-10-01 (ver "Resolvido"): `N8N_API_KEY` e `N8N_PROFESSIONAL_ID` removidas do `.env` do servidor

**I9. Regenerar os exports do "Definitivo" e do "Notificações"**
- Os exports de Abandono e Lembretes já foram regenerados das versões publicadas (2026-09-27) e podem ser versionados
- Falta gerar, do mesmo jeito e sem credenciais, os do "WhatsApp NailFlow — Definitivo" e do "NailFlow — Notificações"; os arquivos antigos na pasta não refletem as versões publicadas
- **Atualizado em 2026-10-02**: o workflow novo "NailFlow — Solicitação Recusada" **já tem export versionado** em `n8n/workflows/nailflow_solicitacao_recusada.json`. O "Notificações" **não foi alterado** nesta data e continua sem export atualizado
- **Atualizado em 2026-10-01**: o workflow "NailFlow — Notificações" também foi editado manualmente na interface do n8n nesta data (node "Montar mensagem" estendido para a F9) — o export está ainda mais desatualizado em relação à versão publicada agora

**I10. Validar envio real de lembrete e de abandono** após a correção dos crons (os loops internos ainda não rodaram com itens). Desde a Fase 1A (2026-10-02) o lembrete de amanhã inclui **somente agendamentos `confirmado`**; solicitações `pendente` não recebem lembrete

**I11. Notificação de confirmação/cancelamento pelo painel** — a **confirmação** foi validada em produção em 2026-10-02 (Agenda → WhatsApp recebido). Resta validar com WhatsApp real o **cancelamento** pelo painel (`appointment.cancelled`)

---

**I12. Migrations 015–017, middleware e rotas da rodada de segurança (2026-09-28) sem commit**
- Unicidade de `wa_instance_name`, bloqueio de conta (`blocked_at`/`token_version`), foreign keys compostas cross-tenant, validação de ownership no bot, rate limiting de rotas sensíveis, CORS do `/bot` restrito — tudo já aplicado e testado em produção, faltando só o commit/push (ver "Resolvido" abaixo)

**I13. PM2 (backend e n8n) rodando como root**
- Auditado em 2026-09-28: sem necessidade técnica (nenhuma porta privilegiada, nenhum acesso a dispositivo) — é assim porque o PM2 foi originalmente configurado como serviço do usuário root (`pm2-root.service`)
- Risco: um RCE futuro em qualquer um dos dois processos dá acesso root ao servidor inteiro, sem contenção
- Migração para usuários dedicados desenhada mas **não implementada** — depende de mover o `database.sqlite` do n8n para fora de `/root` (operação sensível, precisa de janela de manutenção e testes)

**I14. 9 testes antigos esperando `body.token` no login**
- **Atualizado em 2026-10-02**: a suíte (226 de 238 passando; **em 2026-10-03, em `50906f5`: 276 de 288 passando**, as mesmas falhas) tem **12 falhas conhecidas e estáveis**: estas 9 do `body.token` (`auth-flow`, `availability-check`, `price-snapshot`) mais 3 testes do bot (`bot-contextual`) que dependem do dia da semana atual (o teste espera "sexta" como dia futuro). Nenhuma é regressão de produção; não foram corrigidas de propósito
- `auth-flow.test.js`, `price-snapshot.test.js`, `availability-check.test.js` — quebraram quando o `token` foi removido do corpo da resposta de login (a sessão passou a ser só via cookie JWT), mudança já aprovada e aplicada
- Os testes precisam ser atualizados para usar o cookie em vez de `body.token`; não é uma regressão de produção, é a suíte que ficou desatualizada

**I15. React Router mantido em 6.30.6 (decisão registrada, não uma pendência ativa)**
- Auditoria de 2026-09-28 nos dois advisories do `npm audit` (open redirect e SSR hydration) concluiu que **nenhum é explorável no NailFlow hoje**: todo destino de navegação (`<Link>`/`navigate()`) é string fixa no código, e o app usa Declarative Mode sem SSR (o segundo advisory se autoexclui para esse modo)
- Não é necessário corrigir agora; revisar só se uma funcionalidade futura introduzir navegação com destino dinâmico/vindo de URL ou API, ou uso de SSR
- **Reconfirmado em 2026-09-29** (revisão de segurança do audit log/admin): `npm audit` do frontend continua reportando as mesmas 2 vulnerabilidades moderadas em `react-router-dom` (`package.json` fixa `^6.26.0`). Correção via `npm audit fix --force` seria um bump major (breaking change, o próprio npm avisa) — decisão de não aplicar agora se mantém pelo mesmo motivo já registrado acima. Reavaliar só se as condições descritas mudarem.

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

~~**M5. Rate limiting nos endpoints administrativos**~~ — resolvido em 2026-10-01 (ver "Resolvido"): `/admin/professionals/*` agora tem rate limit próprio (100 req/5min por IP)

**M7. Limite de agendamentos futuros por telefone (rota pública) é fixo, não configurável**
- `POST /public/:slug/appointments` limita a 3 agendamentos futuros pendentes/confirmados por telefone+profissional, hardcoded no controller. Considerar se deve virar configuração por profissional no futuro — achado da implementação de 2026-09-30

**M8. Antecedência mínima de 30 min (clientes) é fixa**
- `CUSTOMER_MIN_NOTICE_MINUTES = 30` em `backend/src/utils/availability.js`; vale para página pública, bot e KPI "disponíveis hoje". Se virar configuração por profissional, precisará de coluna/migration — achado da implementação de 2026-10-02

**M9. Página pública de conta bloqueada continua acessível**
- `getProfessionalBySlug` (`publicController.js`) não verifica `blocked_at`. Decisão adiada em 2026-10-02 (fora do escopo da personalização); decidir se a página deve responder 404 para contas bloqueadas

**M10. Perfil: "Salvar foto" falha sem WhatsApp cadastrado**
- O frontend (`handleSaveAvatar` em `Perfil.tsx`) envia a identidade completa, e o `PUT /auth/me` exige `phone_whatsapp` quando recebe qualquer campo de identidade. Desde 2026-10-02 o backend aceita `avatar_b64`, `bio` e `public_theme` sozinhos (bio/tema já usam isso); falta só o frontend enviar apenas `avatar_b64`

**M11. Agendamentos anteriores à migration 021 não avisam a cliente na recusa**
- `appointments.source` é nulo para os agendamentos criados antes de 2026-10-02 21:04; o backend só dispara `appointment.rejected` quando `source` é `public` ou `bot`. Recusar um deles funciona (fica `cancelado`, `cancel_reason='rejected'`), mas sem WhatsApp. É por desenho (nulo = painel/legado); só solicitações novas avisam. Achado no diagnóstico de 2026-10-02

**~~M12. Documentação técnica~~ — resolvida em 2026-10-03**
- A consolidação final (estado de `main` em `50906f5`) atualizou `BANCO_DE_DADOS.md`, `N8N.md`, `ROTAS_E_ENDPOINTS.md`, `FLUXOS_DO_BOT.md`, `ARQUITETURA.md`, `WHATSAPP_EVOLUTION.md`, `INSTALACAO_NOVA_MAQUINA.md`, `STATUS_ATUAL.md`, `TESTES_REALIZADOS.md`, `README.md`, `PROXIMOS_PASSOS.md`, `CHECKLIST_PROJETO.md` e este arquivo
- A dúvida sobre "WhatsApp Principal" e "WhatsApp Teste — oi/olá" estarem ativos **não se confirmou**: o banco do n8n mostra só 6 workflows ativos (Definitivo, Notificações, Solicitação Recusada, Mensagem à Cliente, Abandono e Lembretes); os demais seguem inativos como o `N8N.md` indica

**M13. Recusa sem motivo**
- "Recusar" não pede motivo (o texto à cliente é fixo). O aviso de "recebemos sua solicitação" foi entregue no pacote `cb07d38` (`message.send`, tipo `appointment_requested`)

**M14. Cliente não é avisada quando a reserva expira**
- Expirar uma reserva (`cancelado` + `cancel_reason='expired'`) não envia mensagem: validado no cenário 4 e é o comportamento projetado. A cliente que não pagou em 2 h só descobre ao tentar de novo; decidir se vale um aviso de "reserva liberada" (exigiria novo `kind` em `message.send`)

**M15. Respostas do bot a "Arrasou"/"Top de mais" — investigado em 2026-10-03; sem defeito identificado no bot, relação com o cenário 4 não determinada**
- Investigação somente de leitura das execuções #14772 e #14773 do "Definitivo": ambas são `messages.upsert` com `fromMe=false`, remetente `553185108190@s.whatsapp.net`, textos **reais** "Arrasou" (id `2A86C44046FF52B7723A`) e "Top de mais" (id `2AB285020FC09D11CE28`), recebidos às 15:15:37 e 15:15:40 UTC, 3 s de intervalo. Linha do tempo do cenário 4 (UTC): `expires_at` da reserva foi forçado ao passado às 15:15:13, as duas mensagens chegaram às 15:15:37 e 15:15:40 e o sweeper cancelou a reserva às 15:16:05. Não são eventos de entrega/leitura nem duplicata (ids distintos, textos distintos, 1 requisição Nginx cada ao webhook e ao `sendText`; `data.status = DELIVERY_ACK` aparece em todas as mensagens recebidas, inclusive texto real)
- `message_history`: 2 entradas `inbound/client` e 2 `outbound/bot` com os mesmos `wa_message_id`; `conversation_states` (`553185108190`): `BOT_ATIVO`, `MENU`, `{"menuRetries": 1}`, última mensagem 15:15:40
- Causa do comportamento: a 1ª mensagem recebeu a saudação padrão (não foi tratada como "ver"/"cancelar") e a cliente conhecida tinha agendamento futuro (Alongamento, 05/10 13:00) → saudação proativa com o menu (`botController.js`, ramo `existingClient` com `upcoming`); a 2ª, já no estado `MENU`, não casou com 1–4 nem com intenção → "Não entendi" com `menuRetries = 1` (a 3ª tentativa transferiria para a profissional). É coerente com o fluxo existente do bot. As respostas não mencionam a reserva do cenário 4 (citam só o agendamento de 05/10), mas **não é possível determinar se houve ou não relação causal** entre as mensagens e o cenário 4
- **Não determinado:** quem digitou as duas mensagens no telefone de teste. Os textos parecem comentários humanos sobre as mensagens recebidas; o sistema só prova que chegaram da cliente, não quem as enviou
- Observação: o telefone `5531985108190` (com o 9º dígito) tem um `conversation_states` antigo de 2026-09-16 e o fluxo atual usa `553185108190` (normalizado); são dois registros distintos para a mesma cliente. É anterior a este pacote
- Efeito colateral: o `menuRetries = 1` e o estado `MENU` desse número permanecem no banco (nada foi alterado na investigação)

> **Pendências reais registradas em 2026-10-03 (M16–M20; a M21 é uma validação já concluída, mantida como registro).** São limitações conhecidas e pontos a decidir, **não bugs críticos**; nenhuma bloqueia o uso pelas profissionais.

**M16. O bot responde a qualquer mensagem privada recebida na instância conectada**
- O workflow "Definitivo" só ignora mensagens de **grupo** (`@g.us`), figurinhas e reações; qualquer outra mensagem de texto de um contato recebe a resposta do bot (saudação/menu). No perfil de teste isso acontece no WhatsApp pessoal da responsável (`chip2` = Camila, de propósito) — foi o que gerou as respostas a "Arrasou" e "Top de mais" (M15). O mesmo vale para o número de qualquer profissional que conecte a própria instância: contatos pessoais dela também seriam atendidos pelo bot, a menos que ela assuma o atendimento (mensagem dela → `ATENDIMENTO_HUMANO`)
- Decidir antes de conectar números pessoais reais: número dedicado ao atendimento, ou filtro de contatos no n8n/backend (nada disso está implementado)

**M17. O workflow "Notificações" não tem guarda própria para instância nula**
- Em `appointment.confirmed` e `appointment.cancelled` com `waInstance` nulo, o node de envio chama `…/message/sendText/null`, a Evolution responde 404 e a execução fica com erro (nada é enviado e **não há fallback para outra instância**). `public_created` já é barrado no backend desde `50906f5`; os workflows "Mensagem à Cliente" e "Solicitação Recusada" já descartam com `sem_instancia`
- Para corrigir seria preciso publicar uma versão nova do workflow no n8n (não feito)

**M18. `DELETE /appointments/:id` não tem guarda de status**
- Marca `cancelado` e dispara `appointment.cancelled` (mensagem à cliente) mesmo que o agendamento já esteja cancelado, expirado ou concluído; cancelar duas vezes reenvia a mensagem. Existe desde antes do pacote `cb07d38`; confirmar, recusar e "Pagamento recebido" já são atômicos e idempotentes

**M19. Sem aviso interno à profissional para reservas feitas pelo bot**
- O aviso `appointment.public_created` existe só para a página pública. Uma reserva feita pelo bot aparece na Agenda e no card da Início, mas a profissional não recebe mensagem de "novo agendamento"

**M20. O erro 409 da página pública não rola até a mensagem**
- Quando o horário foi ocupado durante o preenchimento (409), a página volta à seleção, recarrega a grade e mostra "Esse horário acabou de ser preenchido…" **acima** da lista de dias, sem rolar até ela (o scroll automático só acontece ao escolher o horário e ao ir para a revisão)

**~~M21. Card "Precisa da sua ação" e atalho `?abrir=` sem confirmação visual~~ — validado manualmente (relato da responsável)**
- **Validação manual relatada pela responsável (após o deploy de `3bcbb1a`, 2026-10-03):** o card "Precisa da sua ação" apareceu com contadores e validade corretos; "Ver na Agenda" abriu o agendamento correto; os botões do detalhe funcionaram; e o parâmetro `abrir` foi removido da URL depois do uso. É um relato da responsável, não uma observação feita pela automação
- Evidências **independentes** que a corroboram, registradas à parte: testes automatizados (`dashboard-awaiting`), a consulta do card no banco e os logs do Nginx de 2026-10-03 (16:03–16:04 UTC: carga da Início, Agenda aberta no dia 08/10, `POST /appointments/:id/confirm` → 200 para a reserva de teste)
- Fica aqui só como registro; não é mais pendência
- Antes desse relato, a validação se apoiava só nos testes, no banco e nos logs; o relato da responsável fecha a conferência visual

**M6. Migração do número real da profissional**
1. Criar nova instância Evolution
2. Parear com o número real (⚠️ uma tentativa de QR, sem loop)
3. Atualizar `wa_instance_name` no banco
4. Conferir o webhook na Evolution
- **NUNCA conectar o número real sem testes e autorização explícita**

---

### 🟡 Admin — melhorias futuras (registradas em 2026-10-03, após `12dcff7`; nada iniciado)

~~**A1. Busca real de profissionais no `/admin`**~~ — resolvido em 2026-10-09 (ADM V1, `/admin/profissionais`). Texto original: a caixa de busca existe só como visual desativado ("Em breve"); não filtra nada.

~~**A2. Filtros reais no painel de profissionais**~~ — resolvido em 2026-10-09 (ADM V1). Texto original: os chips (ativas, bloqueadas, sem WhatsApp etc.) são visuais e desativados.

**A3. Enriquecer o histórico de auditoria** — hoje não guarda valores antes/depois, motivo, IP, nome do administrador (só e-mail) nem falhas/tentativas recusadas (`actor_email` e `target_business_name` são denormalizados de propósito). Exige alterar a gravação (`logAdminAction`) e, provavelmente, migration; os registros já existentes não ganhariam os campos novos.

**A4. Auditoria: busca/filtros/exportação** — sem busca por texto, sem filtro por administrador ou profissional, sem exportação (CSV); paginação por deslocamento (suficiente para o volume atual).

**A5. Imutabilidade do log em nível de banco** — hoje só a API não tem rota de escrita; não há trigger nem restrição de permissão que impeça `UPDATE`/`DELETE` direto via SQL.

**A6. Promover conta a admin pela interface** — hoje só por SQL (já registrado no checklist). Junto: revisar outras robustezas do Admin (ex.: M9 — página pública de conta bloqueada continua acessível).

### 🟡 ADM V1 — pendências e próximos passos (registrados em 2026-10-09)

**A7. Foto da administradora não funciona em produção** — aparece no menu lateral e no Perfil da Central da conta (`/admin/conta/perfil`); a responsável relatou que não está funcionando como esperado. Causa ainda **não diagnosticada** (o salvamento pelo Perfil usa `PUT /auth/me` com `avatar_b64`; ver também M10). Próximo passo: reproduzir em produção só com leitura, identificar se é envio, leitura (`GET /auth/me`) ou exibição, e corrigir.

**A8. Indicadores de agendamentos e clientes da plataforma** — o admin não tem endpoint para isso (`/dashboard`, `/clients` e `/appointments` filtram pela própria conta). Exigiria um endpoint agregado novo (`platform-summary`), somente leitura, atrás de `requireAdmin`. Não iniciado.

**A9. Recuperação de senha, 2FA e sessões individuais** — fora do V1. A recuperação depende de e-mail transacional (ver I1); 2FA e lista de sessões exigem coluna/tabela nova e `jti` no token. Hoje só existe "sair de todos os dispositivos".

**A10. Registrar troca de senha e "sair de todos" na Auditoria** — exige migration para ampliar o CHECK de `action` em `admin_audit_log` (hoje só `block`, `unblock`, `update`, `delete`) e decidir se vale registrar ações de contas não admin.

**A11. Paginação de profissionais no servidor** — hoje a lista carrega tudo e pagina no navegador (12 por vez); revisar quando houver centenas de contas.

**A12. Testes automatizados do ADM e das rotas novas** — não há testes no repositório para `PUT /auth/password`, `POST /auth/logout-all` nem para as telas do ADM; a validação foi feita com scripts temporários fora do Git. Considerar levar os casos para a suíte (e atualizar os 9 testes que ainda esperam `body.token` — I14).


### 🟢 Futuro

**F1. Campanhas de WhatsApp** (envio em massa / reativação de clientes inativas) — não implementado
**F2. Monitoramento de produção** — alertas de queda do bot e de falha dos crons (a falha de 2026-09-21 passou dias sem ser percebida; e um cron pode terminar "success" sem trabalhar)
**F3. Autenticação** — revisar expiração do JWT; refresh token; CSRF
**F4. Rate limiting por número no bot**
**F5. Export de dados (LGPD)**
**F6. Logs estruturados** (Winston/Pino)
**F7. Versão pública para portfólio** — repositório separado, com histórico novo e sem infraestrutura/segredos
~~**F9. Notificação da profissional ao receber agendamento pela página pública**~~ — **implementação concluída em 2026-10-01** (ver "Resolvido" para o detalhe técnico). Resumo do status real:
- [x] Backend dispara o evento `appointment.public_created` via `notifyN8n` após o `COMMIT` do agendamento (fire-and-forget, falha no envio não desfaz o agendamento)
- [x] Workflow "NailFlow — Notificações" do n8n estendido (editado manualmente na interface) para reconhecer o evento e montar a mensagem para a profissional (não para a cliente)
- [x] Fluxo backend → n8n → Evolution **validado em produção**: execução do workflow registrada com sucesso até a chamada à Evolution API, com o payload correto (profissional certa, dados corretos)
- [x] Desde `50906f5` (2026-10-03): o backend **não envia** `public_created` quando a profissional não tem `wa_instance_name` (sem fallback para outra instância; validado em produção na `studio-simone-teles`) e envia o telefone da profissional normalizado (`55` + número). O `chip2` da Camila é usado de propósito pelo perfil de teste
- [ ] **Entrega real da mensagem no WhatsApp NÃO confirmada**: a Evolution rejeitou o envio com `exists: false` porque o `phone_whatsapp` cadastrado da profissional de teste (`camila-nails-studio`) é um número placeholder (`5531999999999`), que não existe no WhatsApp — não é falha de código, é dado de cadastro de teste. **Não tratar F9 como validada de ponta a ponta até um teste com um número de WhatsApp real.**

---

### 🔵 Requisitos futuros — nova direção do WhatsApp (registrados em 2026-09-30)

> Decisões de produto/arquitetura ainda **não definidas**. Nada abaixo deve ser implementado sem uma definição prévia de escopo e arquitetura. Não confundir com a seção 🟢 Futuro acima (itens mais pontuais); estes são mudanças estruturais na forma como o bot conversa.

**F10. Atendimento mais natural / contextual (substituir o fluxo de menus)**
- Objetivo: o bot entender, dentro do contexto da conversa, intenção do cliente, serviço desejado, data, período/horário, alterações de preferência, dúvidas, cancelamento, reagendamento e continuidade de uma conversa anterior — sem reiniciar o fluxo a cada mensagem
- Exemplos de comportamento esperado (fornecidos pela responsável): "Quero fazer unha sexta depois das 18h" (serviço + data + período), "Não consigo sexta, tem sábado?" (troca de preferência sem reiniciar), "Pode ser qualquer horário à tarde" (período), "Quero fazer escova e unha" (múltiplos serviços)
- **Decisão ainda não definida**: arquitetura (regras vs. LLM/NLU), escopo exato, como isso convive com a máquina de estados atual (`FLUXOS_DO_BOT.md`)

**F11. Consulta de datas fora da semana exibida**
- O bot deve aceitar uma data específica fora das opções inicialmente mostradas e consultar a disponibilidade real (API/site do NailFlow) para aquela data
- Restrição explícita da responsável: **não inventar horários nem manter disponibilidade só com base em dados anteriores da conversa**

**F12. Perfil/tom de atendimento configurável**
- Permitir configurar, por profissional, características do público/atendimento para adequar o tom das mensagens do bot
- **Decisão ainda não definida**: quais opções de configuração existirão

**F13. Lembretes relacionados a agendamentos**
- Registrado como requisito futuro pela responsável em 2026-09-30, comportamento exato ainda a definir
- **Atualizado em 2026-10-02**: o lembrete de amanhã agora só considera agendamentos `confirmado`
- ⚠️ **Possível sobreposição a verificar**: já existe um workflow n8n "Lembretes"/"Lembretes de Agendamento" com os crons corrigidos em 2026-09-27 (ver I10), mas **nenhum envio real de lembrete foi validado até hoje**. Antes de desenhar algo novo, confirmar com a responsável se F13 é uma evolução desse recurso já existente (não validado) ou um conceito diferente

**F14. Pré-agendamento via WhatsApp**
- Fluxo proposto: cliente solicita serviço/data/horário → bot consulta disponibilidade → sistema cria uma solicitação/pré-agendamento → profissional recebe a solicitação → profissional confirma ou recusa no NailFlow → cliente recebe a confirmação ou uma alternativa
- **Atualizado em 2026-10-02 — Fase 1A concluída**: decidido e implementado que o pré-agendamento reutiliza o status `pendente` (exibido como "Aguardando confirmação"); a profissional confirma ou recusa pela Agenda e a cliente recebe WhatsApp de confirmação ou de recusa (validado em produção). Origem registrada em `appointments.source` (`public`/`bot`)
- **Ainda pendente**: o fluxo equivalente iniciado *pelo bot* só foi coberto na parte de texto e de origem (`source='bot'`); falta a mensagem de "recebemos sua solicitação", modos de confirmação, expiração da reserva e sinal Pix — ver seção 14.9 do `CHECKLIST_PROJETO.md`

---

## Resolvido

| Item | Quando | Como |
|---|---|---|
| Sem tela para consultar o `admin_audit_log` | 2026-10-03 | Auditoria v1 (`12dcff7`): `GET /admin/audit-log` somente leitura + `/admin/auditoria` (filtros, paginação, detalhe); validada em produção com login real; 104 registros de teste antigos removidos antes, após backup |
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
| `wa_instance_name` sem unicidade (duas profissionais podiam assumir a mesma instância) | 2026-09-28 | Índice único parcial (migration 015) |
| `PUT`/`DELETE /whatsapp/instance` permitiam assumir/orfanar instância sem sincronizar com a Evolution | 2026-09-28 | Rotas removidas; só `/evolution-instance` configura/remove, sincronizando com a Evolution |
| Sem forma de bloquear/revogar sessão de uma profissional | 2026-09-28 | `blocked_at` + `token_version` (migration 016), checados a cada `requireAuth`/`requireAdmin`/`botAuth` direto no banco |
| Isolamento entre profissionais garantido só na aplicação, não no banco | 2026-09-28 | Foreign keys compostas `(id, professional_id)` em clients/services/recurring_groups → appointments/message_history (migration 017) |
| `/bot/record-sent` sem `waInstance` obrigatório | 2026-09-28 | `instance` agora obrigatório (400 se ausente), sem fallback |
| Cancelamento pelo bot sem checar dono do agendamento | 2026-09-28 | `findClientByPhone` + `client_id` exigido no `WHERE` do SELECT e do UPDATE |
| CORS `*` nas rotas `/bot` | 2026-09-28 | Removido; `/bot` herda o CORS restritivo global |
| `qs` — vulnerabilidade do `npm audit` (Item 17) | 2026-09-28 | `npm audit fix` (sem `--force`): `qs` 6.15.3→6.16.0, `body-parser`, `express` — patch dentro do range já fixado no `package.json` |
| Sem rate limit em rotas sensíveis (login, registro, conexão WhatsApp, página pública) | 2026-09-28 | Rate limit por rota no Express (`express-rate-limit`) + `limit_req` no Nginx |
| Sem security headers / CSP | 2026-09-28 | HSTS, X-Content-Type-Options, X-Frame-Options, Referrer-Policy, Permissions-Policy e CSP (validada em Report-Only antes de aplicar); `server_tokens off`; `X-Powered-By` ocultado |
| Evolution API exposta publicamente pelo Nginx | 2026-09-28 | `location /` restrito por IP (loopback + IP público da própria VPS, confirmado por teste ao vivo do hairpin NAT do n8n/backend) |
| Evolution com logs em `VERBOSE`/`debug` (volume alto, dados sensíveis) | 2026-09-28 | `LOG_LEVEL=ERROR,WARN`, `LOG_BAILEYS=error`, rotação de log do container |
| Imagem Docker da Evolution na tag `latest` (pode mudar sem aviso) | 2026-09-28 | Fixada por digest exato (`@sha256:...`) |
| `.env`, `.pgpass`, sqlite do n8n com permissão `644` | 2026-09-28 | `600` (conteúdo verificado inalterado) |
| Senha do PostgreSQL em texto puro em 5 scripts (`/root/v2close-20260927/`) | 2026-09-28 | Migrados para `/root/.pgpass` (`600`); `PGPASSWORD`/`DATABASE_URL` com credencial removidos dos 5 scripts; validado com `psql`/`pg_dump`/`node` sem regressão |
| Admin não tinha como bloquear/desbloquear uma profissional (só via SQL manual) | 2026-09-29 | `POST /admin/professionals/:id/block` e `.../unblock` (migrations 016 já existiam; endpoints novos), com confirmação na UI e impedimento de autobloqueio |
| Admin não tinha como editar cadastro de outra profissional | 2026-09-29 | `PUT /admin/professionals/:id`, reaproveitando o schema/regras de `PUT /auth/me`; não permite editar `slug`/`wa_instance_name`/`is_admin`/`blocked_at`/`token_version`/senha |
| Admin não tinha como excluir uma profissional | 2026-09-29 | `DELETE /admin/professionals/:id`: snapshot em disco (permissão 600/700, fora de `/var/www`, retenção de 90 dias) → exclui instância na Evolution se houver (aborta sem tocar no banco se falhar) → exclusão em transação; exige digitar o nome do negócio; impede autoexclusão e exclusão do último admin |
| Nenhuma ação administrativa (bloquear/editar/excluir) deixava rastro de quem fez o quê | 2026-09-29 | Tabela `admin_audit_log` (migration 019) + `logAdminAction()`, chamada nos 4 fluxos só em caso de sucesso; `actor_email`/`target_business_name` denormalizados para sobreviver à exclusão de qualquer uma das contas |
| Tela Admin ilegível/espremida no celular (única página do app com `<table>` crua) | 2026-09-29 | Tabela mantida em `md:` e acima; abaixo disso, cards responsivos (mesmo padrão visual de `Servicos.tsx`) |
| Revisão completa de segurança (auth, isolamento/IDOR, SQLi/XSS/CSRF/CORS, headers, secrets, rate limiting, dependências, migrations 016–019) | 2026-09-29 | Nenhum problema real encontrado; ver [`STATUS_ATUAL.md`](./STATUS_ATUAL.md) para o resumo e os 🟡 acima (M5, I15) para o que ficou registrado como pendência não bloqueante |
| `/public/info` e `/public/availability` (sem slug) sem rate limit | 2026-09-30 | `publicRateLimit` aplicado às duas rotas legadas |
| `/public/info` e `/public/availability` (sem slug) devolviam sempre a "primeira profissional cadastrada" — vazamento entre contas | 2026-09-30 | Rotas removidas; `PaginaPublica.tsx` exige `:slug`; `/agenda-publica` (sem slug) mostra mensagem de link antigo em vez de qualquer dado |
| Página pública não tinha como listar os serviços de uma profissional | 2026-09-30 | `GET /public/:slug/services` — só `active=true AND available_on_whatsapp=true`, isolado por slug |
| Não existia forma de criar agendamento sem autenticação (fluxo público) | 2026-09-30 | `POST /public/:slug/appointments` — status sempre `pendente`, limite de 3 futuros por telefone, rate limit dedicado (IP e telefone+slug), transação com rollback em `23P01`/`23505`, `EXCLUDE` constraint do Postgres como garantia final de concorrência (15 testes novos, incluindo teste de corrida real) |
| Frontend do agendamento online pela página pública (antigo F8) | 2026-09-30 | `PaginaPublica.tsx`: seleção de serviço, horário clicável, formulário de nome/telefone, revisão e confirmação, tela de sucesso deixando claro que é um pedido pendente; todos os `409`/`429`/`400`/`404`/erro de rede tratados com mensagens amigáveis (`9f88257`) |
| Disponibilidade da página pública sempre calculada pela menor duração entre os serviços, mesmo com um serviço específico já escolhido | 2026-09-30 | `GET /public/:slug/availability` ganhou `serviceId` opcional; sem ele, comportamento inalterado; com ele, valida o serviço contra a profissional do slug e usa a duração real dele (`adf5164`, 8 testes novos) |
| Corridas de estado no frontend do agendamento público (troca de serviço/horário durante um `POST` em andamento; resposta antiga de disponibilidade sobrescrevendo a atual) | 2026-09-30 | Botões de serviço/horário desabilitados durante `submitting`; `loadAvailability()` usa contador de requisição (`useRef`) para descartar respostas fora de ordem (incluído no commit `9f88257`) |
| Auditoria de segurança do fluxo de criação de agendamento público (`serviço → horário → dados → criação`) | 2026-09-30 | Isolamento por `slug`/`professional_id` confirmado por teste real (serviço de outro profissional rejeitado com 400); backend não confia em preço/duração/`professionalId`/`clientId`/`status` enviados pelo cliente (schema Zod não os declara); horário sempre revalidado (`checkSlotAvailability`); double-booking protegido em duas camadas (pré-checagem + `EXCLUDE` constraint do Postgres); concorrência e rollback já cobertos por teste automatizado — nenhuma vulnerabilidade confirmada |
| C1 — primeira mensagem real após reconectar o `chip2` (webhook com `X-NailFlow-Webhook-Secret`) | 2026-09-30 | Mensagem da cliente Simone Teles (`553185108190`) processada sem erro pelo workflow "WhatsApp NailFlow — Definitivo" (execuções `11720`/`11721`, `status: success`) e registrada em `message_history` (`id 2256`), sem 403 e sem cross-tenant |
| Envio de mensagem de teste controlado para validar o `chip2` reconectado | 2026-09-30 | Mensagem enviada exclusivamente para a cliente Simone Teles, com `client_id`/telefone/`professional_id` confirmados no banco antes do envio; Evolution confirmou `remoteJid` correto, sem erro |
| Atalhos naturais de entrada para "ver agendamentos"/"cancelar", troca de intenção em meio de fluxo, saída global de desistência ("desisto" etc.) | 2026-10-01 | Commit `dcd5316`: casamento de pista por data/dia da semana/serviço, fallback para menu numerado em ambiguidade real, preserva toda a lógica de serviço+data+horário já existente |
| Bug real: regex de "agendar" do estado `MENU` sem `\b` interpretava "desmarcar" como "agendar", travando a conversa em `AGUARDANDO_SERVICO` sem saída | 2026-10-01 | Commit `dcd5316`: regex corrigido com limite de palavra; "desmarcar"/"desmarca" reconhecidos como sinônimos de cancelar em todos os pontos (incl. `extractActionIntent` e regex inline do `MENU`); reprodução do bug real coberta por teste automatizado |
| `createBlockedTime` aceitava `endsAt <= startsAt` (bloqueio invertido/vazio corrompendo o cálculo de disponibilidade) | 2026-10-01 | Commit `5fea86c`: `.refine()` no schema Zod rejeitando `endsAt <= startsAt` com 400 |
| `deleteService` retornava erro genérico de FK (23503) ao excluir serviço com agendamentos vinculados | 2026-10-01 | Commit `5fea86c`: captura `23503` e retorna 409 com mensagem orientando a desativar o serviço em vez de excluir |
| C2/C3 — agendamento e cancelamento completos pelo WhatsApp com cliente real | 2026-10-01 | Validados no WhatsApp real: agendamento por linguagem natural (serviço + data + horário em uma mensagem), confirmação e criação do agendamento, cancelamento por data + horário, confirmação e cancelamento real, retorno ao menu/início após o cancelamento |
| F9 — notificação da profissional ao receber agendamento pela página pública (implementação) | 2026-10-01 | Commit `2d17659` (backend) + workflow "NailFlow — Notificações" do n8n estendido manualmente na interface: evento `appointment.public_created` reconhecido, mensagem montada para a profissional (`payload.professionalPhone`), reaproveitando o mesmo webhook/credencial/node de envio Evolution já usados por `appointment.confirmed`/`appointment.cancelled`. Fluxo backend→n8n→Evolution validado em produção (execução com sucesso até a chamada à Evolution); entrega real da mensagem não confirmada por número de teste placeholder — ver F9 acima |
| I8 — `N8N_API_KEY`/`N8N_PROFESSIONAL_ID` não usadas no `.env` | 2026-10-01 | Removidas do `.env` do servidor (commit de código não aplicável, `.env` não é versionado; backup do arquivo feito antes da alteração) |
| M5 — rate limiting ausente em `/admin/professionals/*` | 2026-10-01 | Commit `26ae97f`: `express-rate-limit` aplicado a todas as rotas de `/admin/professionals/*` (100 req/5min por IP), mesmo padrão já usado em `/auth/login`/`register` |
| `createAppointment`: SELECT pós-criação não filtrava por `professional_id` (único ponto do arquivo nesse padrão, não explorável mas inconsistente) | 2026-10-01 | Commit `26ae97f`: filtro adicionado por defesa em profundidade, sem mudança de comportamento |
| ~23 arquivos `.bak*`/temporários acumulados em `backend/src/controllers`, `backend/src/routes`, `backend/src/server.js` e `frontend/src` | 2026-10-01 | Removidos do disco (já estavam no `.gitignore`, não rastreados, não referenciados por nenhum import) |
| 3 bloqueadores visuais de UX encontrados em auditoria de produção (página pública com mensagem contraditória do WhatsApp durante o fluxo novo; "R$" sobreposto no Dashboard; pluralização errada em Clientes) | 2026-10-01 | Commit `3f039dd` — ver detalhe na seção 9 do [`CHECKLIST_PROJETO.md`](./CHECKLIST_PROJETO.md) |
| C4 — integração de `feat/phase5-register` (V1) ao `main` | 2026-10-02 | `main` mesclado com a feature (commit divergente `985c1f1` resolvido a favor da feature, superado), `origin/main` incluído para permitir push, histórico publicado (`1f0216a`); build frontend e suíte de testes backend validados pós-merge sem regressão nova (ver I14/I16) |
| I16 — confirmar que o `nailflow-backend` roda exatamente o commit publicado pós-merge do V1 | 2026-10-02 | `pm2 restart nailflow-backend` executado com autorização explícita; novo pid, uptime zerado, `/health` 200, rota pública real 200, rota `/admin` 401 (protegida), sem erros novos nos logs pós-restart |
| Onboarding: etapa "Seu link" e hero de boas-vindas | 2026-10-02 | Commits `63a7a58` e `7a2a14e`: `GET /auth/me` devolve `slug`; Perfil mostra "Seu link de agendamento" (copiar e "Ver página"); `OnboardingChecklist` com 5ª etapa (sempre concluída, `slug` é `NOT NULL`); hero "Vamos configurar sua agenda" na Início quando o onboarding está incompleto e não há próximo atendimento. O status do onboarding é buscado uma única vez em `Inicio.tsx` e repassado ao checklist. Validado em desktop e 375px; publicado em produção |
| Personalização da página pública (foto, apresentação, cor) | 2026-10-02 | Commits `c7cacaa` e `cc1b3ce`. Migration 020 (`bio` varchar 280, `public_theme` com CHECK vinho/verde/azul) aplicada em produção após backup `/var/backups/nailflow/nailflow_pre-migration-020_2026-10-02_191104.dump` (como `postgres`, dono da tabela; os dados das 4 contas ficaram íntegros). `GET /public/:slug/info` expõe só `businessName`, `whatsappLink`, `bio`, `theme`, `photo`; `PUT /auth/me` valida bio (trim, máx. 280), tema e foto (data URL jpeg/png/webp, máx. 90.000 caracteres, abaixo do limite de corpo de 100KB) e aceita bio/tema/foto sem os dados de identidade (não exige WhatsApp). A página busca `/info` uma vez e aplica o tema próprio, independente do `localStorage` do painel. Backend reiniciado e frontend publicado; `dist` anterior preservado em `frontend/dist.bak_20261002-pre-public-profile`. Nenhuma profissional usou ainda |
| Horários já passados de hoje eram oferecidos pela página pública (e podiam ser aceitos) | 2026-10-02 | Commit `6122abc`: `getAvailableSlots`/`checkSlotAvailability` ganharam `notBefore` opcional e `customerNotBefore()` (agora + 30 min, comparação por instante em `America/Sao_Paulo`), aplicados à página pública (`availability` e `POST`), ao bot e ao KPI "disponíveis hoje"; novo motivo `past_time`. A Agenda interna, `/availability/slots` e `/availability/check` não mudaram (retroativo continua permitido). 16 testes novos (`customer-min-notice.test.js`); em produção desde o restart do `nailflow-backend` (PID 1198013, 2026-10-02 18:08 UTC). Mensagem do bot ajustada para `past_time` ("não está mais disponível para reserva neste momento") |
| Fase 1A — pré-agendamento e confirmação/recusa manual de solicitações | 2026-10-02 | Commits `a36626b` (backend, bot, rótulos, testes) e `47c2886` (botões Confirmar/Recusar na Agenda), enviados com push (`6122abc..47c2886`). Migration 021 (`cancel_reason`, `source`) aplicada em produção após backup `/var/backups/nailflow/nailflow_pre-migration-021_2026-10-02_210443.dump`; `N8N_WEBHOOK_REJECTED_URL` configurada e backend reiniciado; workflow n8n "NailFlow — Solicitação Recusada" (`NfSolRecusada0001`, webhook `nailflow/solicitacao-recusada`) publicado após backup do banco do n8n (`/var/backups/nailflow/n8n_database_pre-solicitacao-recusada_*.sqlite`); frontend publicado (`dist` anterior em `frontend/dist.bak_20261002-pre-fase1a`). Testes: 10 novos, suíte 236/248 com as 12 falhas conhecidas (I14 e 3 do bot). Testes sintéticos do webhook (403 sem segredo; 200 sem envio para evento errado ou sem telefone; Evolution recusa instância inexistente) e **validação real com WhatsApp**: confirmação, nova solicitação pública como "Aguardando confirmação" e recusa com mensagem recebida. Um primeiro teste de recusa não avisou a cliente por ser agendamento anterior à migration (`source` nulo) — comportamento esperado, ver M11 |
| Pacote `cb07d38` — confirmação manual/automática, reserva temporária com expiração e sinal Pix manual (fases 1B + 2 + sinal) | 2026-10-02/03 | Commit `cb07d38` (`feat(appointments): add confirmation and manual deposit flow`), publicado em `origin/main` junto com `501cd55` (docs). Deploy controlado em produção em 2026-10-02: backup `/var/backups/nailflow/nailflow_pre-migration-022_2026-10-02_222934.dump` → migration 022 → `N8N_WEBHOOK_MESSAGE_URL` no `.env` → backup do banco do n8n (`n8n_database_pre-mensagem-cliente_20261002-222954.sqlite`) → import e publicação do workflow `NfMensagemCliente01` → restart do n8n e do backend → frontend publicado (`dist` anterior em `frontend/dist.bak_20261002-pre-cb07d38`). Suítes novas: `booking-rules`, `deposit-flow` e acréscimos em `bot-contextual`. **E2E real em 2026-10-03, número de teste `553185108190`, os 4 cenários aprovados:** (1) automático sem sinal e (2) manual com confirmação pela profissional, ambos aprovados pela responsável (detalhes por mensagem não reconferidos na revisão da documentação); (3) automático + sinal 50% → `aguardando_pagamento`, `deposit_cents` 1750 de 3500, `expires_at` +2 h, 1 mensagem com Pix, "Pagamento recebido" pela Agenda real (`POST …/mark-paid` 200, Nginx) → `confirmado`, `paid_at` preenchido, `expires_at` nulo, 1 único `appointment.confirmed` (#14766) e 1 mensagem; repetição idempotente (`changed:false`, sem mensagem); (4) expiração: `expires_at` forçado ao passado só nessa reserva, o sweeper real cancelou em ~56 s com `cancel_reason='expired'`, `paid_at` nulo, horário liberado, nenhuma mensagem e nenhuma outra reserva afetada. Reservas de teste dos cenários 1–3 canceladas por SQL sem mensagem; a do cenário 4 foi cancelada pelo sweeper por expiração (`cancel_reason='expired'`); agendamento antigo da Simone (05/10 13:00) intacto; configuração da Camila restaurada para `manual`, sem sinal, sem Pix, sem tipo/valor. Desvios declarados: a repetição de "Pagamento recebido" (idempotência) no cenário 3 foi feita chamando a função real do controller, sem passar pelo login; alguns passos dos cenários 1 e 2 também foram feitos sem a interface (detalhe não reconferido aqui); a rota autenticada tem cobertura nos testes automatizados. Falhas conhecidas não bloqueantes: aviso interno à profissional falha por telefone placeholder (ver F9) e a Evolution não expõe o status de entrega (o recebimento foi confirmado manualmente pela responsável) |
| Início com pendências, atalho para a Agenda e scroll da página pública | 2026-10-03 | Commit `3bcbb1a` (push `501cd55..3bcbb1a`), em produção: bloco `aguardando` em `GET /dashboard` e card "Precisa da sua ação" na Início (reservas `pendente`/`aguardando_pagamento` com validade em curso, próximo vencimento, até 5 pedidos), atalho `/agenda?data=…&abrir=<id>` (o `id` só é procurado na lista da própria profissional; consumido uma vez), scroll até o formulário e "Horário escolhido" na página pública. Backup `frontend/dist.bak_20261003-pre-home-ux`; backend reiniciado. 4 testes novos (`dashboard-awaiting`). **Validado em produção:** página pública no celular (375×812) de ponta a ponta (201, sem overflow). **Validação manual da Home e da Agenda, relatada pela responsável:** card com contadores e validade corretos, "Ver na Agenda" abriu o agendamento certo, botões funcionaram e o `abrir` saiu da URL — ver M21 |
| `public_created` sem instância e telefone da profissional normalizado | 2026-10-03 | Commit `50906f5` (push `3bcbb1a..50906f5`), em produção (só o `nailflow-backend` reiniciado; PID 1249130 → 1253738): o aviso interno só é enviado com `wa_instance_name` próprio (sem fallback) e o telefone vai como `55` + número (`whatsappNumberForSending`), sem alterar o banco; 8 testes novos. **E2E em produção** na `studio-simone-teles` (sem instância): 201, `pendente`, visível na Agenda/Início; nenhuma execução de "Notificações" e nenhuma chamada de envio à Evolution (a execução de "Mensagem à Cliente" terminou com `sem_instancia`, sem envio). A reserva de teste, a ficha do cliente fictício e o agendamento cancelado foram removidos depois (cópia das linhas em `/root/e2e_test_rows_20261003.json`) |
| Consolidação final da documentação | 2026-10-03 | 13 documentos atualizados para o estado de `main` em `50906f5` (ver M12) |
| ADM V1 — dashboard, gestão de profissionais, auditoria, Central da conta, troca de senha e "sair de todos" | 2026-10-08 | Commits `93ba884`…`596d24a` (`main` em `596d24a`), em produção; `dist` anterior em `dist.bak_20261008-pre-adm-v1`; só o `nailflow-backend` reiniciado (PID 1274349 → 1511808); sem migrations. Validado manualmente, exceto a foto da administradora (A7) |
