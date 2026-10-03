# NailFlow — Documentação de Transição

> **Abra este arquivo primeiro ao retomar o projeto em uma nova máquina.**
> Última atualização: 2026-10-03 (`main` em `50906f5`)

---

## O que é o NailFlow?

Sistema de agendamento e automação de atendimento via WhatsApp para profissionais autônomas de nail design. Clientes agendam, confirmam e cancelam horários pelo WhatsApp ou pela página pública; cada profissional gerencia tudo por um painel web. Várias profissionais podem usar o mesmo sistema, com dados isolados por `professional_id`.

---

## Versões do produto

| Versão | Commit | Data | Principais entregas |
|---|---|---|---|
| **V1** | `d82603c` | 2026-09-24 | Painel completo (Início, Dashboard, Agenda, Clientes, Serviços, Gastos, Configurações), gestão de instâncias WhatsApp pelo NailFlow (QR via canvas), multi-profissional, correções de TTL do atendimento humano e do `botAuth` |
| **V2** | `38b3fe7` | 2026-09-24 | Área administrativa separada (`is_admin`, `/admin`, listagem de profissionais), ajustes em Agenda, Clientes, Dashboard e Gastos |
| **V2 — mudanças de produção** | `b26d682` | 2026-09-25 | Antecedência máxima por profissional, fechamentos da agenda (data, recorrência mensal e período), limite de navegação na Agenda, onboarding "Primeiros passos", correção do `$1` no bot, migrations 007–010, `.gitignore` reforçado |

**Fechamento técnico da V2 (2026-09-27, em produção, versionado depois):** crons corrigidos, webhooks do n8n autenticados por cabeçalho, classificador sim/não no bot, isolamento de `clientId`, normalização de telefone, migrations reproduzíveis, seed compatível e suíte automatizada em banco descartável.

**Depois da V2 (2026-09-30 a 2026-10-03, em produção):** página pública de agendamento completa (serviços, reserva, perfil personalizável), confirmação manual/automática por profissional, sinal por Pix manual, reservas com validade e expiração automática, card "Precisa da sua ação" na Início com atalho para a Agenda, mensagens à cliente pelo n8n e aviso interno à profissional (só com instância própria). Commits recentes: `cb07d38`, `3bcbb1a`, `50906f5`.

Detalhes por versão: [`STATUS_ATUAL.md`](./STATUS_ATUAL.md).

---

## Estado atual (2026-10-03)

| Componente | Estado |
|---|---|
| Frontend (painel web e página pública) | ✅ em produção (build de `3bcbb1a`) |
| Backend API | ✅ em produção (`50906f5`) |
| WhatsApp | ✅ `chip2` conectado (`open`; WhatsApp pessoal da responsável, usado de propósito pelo perfil de teste Camila); `chip2-teste` `connecting`; a `studio-simone-teles` não tem instância — ver [`WHATSAPP_EVOLUTION.md`](./WHATSAPP_EVOLUTION.md) |
| Bot conversacional | ✅ em produção; agendamento e cancelamento validados com cliente real (2026-10-01); responde a qualquer mensagem privada no número conectado |
| n8n | ✅ 6 workflows ativos (Definitivo, Notificações, Solicitação Recusada, Mensagem à Cliente, Abandono e Lembretes), webhooks com Header Auth |
| Banco de dados | ✅ migrations até a 022 aplicadas; schema reproduzível; seed compatível |
| Testes automatizados | ✅ 276 de 288 passando; as 12 falhas são conhecidas (ver [`PENDENCIAS.md`](./PENDENCIAS.md), I14) |
| Nginx + HTTPS | ✅ ativo |
| Firewall (UFW) | ✅ ativo desde 2026-09-25 — públicas só 22, 80 e 443 |
| Backup automático | ✅ diário às 03h |
| Recuperação / troca de senha | ⏸️ **não publicada** — ver abaixo |

---

## O que já funciona

- Painel web: Início (com "Primeiros passos"), Dashboard, Agenda (dia/semana/mês), Clientes, Serviços, Gastos, Configurações (Perfil, WhatsApp, Disponibilidade, Aparência)
- Cadastro e login de profissionais; área administrativa separada para a conta `is_admin`
- Agendamentos simples e recorrentes
- Disponibilidade: expediente semanal, intervalo, bloqueios pontuais, **antecedência máxima**, **fechamentos** por data específica, dia da semana recorrente (1ª–5ª/última) e período
- Página pública de agendamento por slug (`/p/:slug`): escolha do serviço, depois do horário, dados e revisão; perfil personalizável (apresentação, cor, foto); bloco Pix quando há sinal
- Confirmação por profissional (Configurações → Agendamento): **manual** (a solicitação fica "Aguardando confirmação" por 24 h) ou **automática**, com **sinal por Pix manual** opcional (30/50/100% ou valor fixo; "Pagamento recebido" na Agenda; reserva de 2 h); reservas que vencem são liberadas sozinhas
- Início: card "Precisa da sua ação" com os pedidos aguardando confirmação ou pagamento, e atalho que abre o pedido na Agenda
- Bot WhatsApp: boas-vindas personalizadas, menu, agendamento, cancelamento, consulta, atendimento humano
- Gestão da instância WhatsApp (criação, QR, status) pela tela Configurações
- Multi-profissional: cada profissional tem sua instância Evolution e seus dados isolados

## O que NÃO está disponível / pendente

- **Recuperação de senha ("Esqueci minha senha") e troca de senha logada: NÃO publicadas.** Existe uma implementação isolada, testada apenas em ambiente de teste, em `/opt/nailflow-next` (fora do repositório e fora de produção). O provedor de e-mail (Brevo) **ainda não está configurado**.
- Pendências reais e limitações conhecidas (bot responde a mensagens privadas no número conectado, entrega real do aviso interno à profissional ainda sem validação, guardas do workflow "Notificações" e de `DELETE /appointments/:id` etc.) → ver [`PENDENCIAS.md`](./PENDENCIAS.md)
- Exports do n8n: Abandono, Lembretes, Solicitação Recusada e Mensagem à Cliente estão versionados; os do "Definitivo" e do "Notificações" ainda são antigos (não refletem as versões publicadas)

---

## Onde estão os arquivos importantes

| O quê | Onde |
|---|---|
| Código-fonte | `/var/www/nailflow/` (VPS) + `https://github.com/Yas2046/nailflow` |
| Branch atual | `main` (= `origin/main`) |
| Variáveis de ambiente | `/var/www/nailflow/backend/.env` e `frontend/.env` (nunca comitar) |
| Schema do banco | `/var/www/nailflow/backend/db/schema.sql` + `backend/db/migrations/` |
| Workflows n8n (exportados) | `/var/www/nailflow/n8n/workflows/` |
| Backup do banco | `/var/backups/nailflow/` (diário, 7 dias) |
| Implementação isolada de senha (não publicada) | `/opt/nailflow-next/` |

---

## Como iniciar o projeto (nova máquina)

→ Leia [`INSTALACAO_NOVA_MAQUINA.md`](./INSTALACAO_NOVA_MAQUINA.md)

O frontend e o backend rodam localmente para desenvolvimento. O VPS continua em produção e não precisa ser reinstalado.

---

## Último commit de código

```
50906f5 fix(notify): skip public_created without WhatsApp instance and normalize phone
3bcbb1a feat(home): show pending requests and scroll to booking form
cb07d38 feat(appointments): add confirmation and manual deposit flow
```

Branch `main` = `origin/main`, em produção (a `feat/phase5-register` foi integrada em 2026-10-02 e é só histórico).

---

## Próximo passo recomendado

Depois do início do uso real pelas profissionais, **congelar funcionalidades novas por ~2 semanas** e observar o uso. Pontos a acompanhar:

1. Conectar o WhatsApp de cada profissional (ou aceitar que, sem instância, ela só vê os pedidos na Agenda e na Início) e decidir o que fazer com números pessoais conectados (o bot responde a mensagens privadas)
2. Validar a entrega real do aviso interno à profissional com um número real
3. Pendências M16–M20 e demais itens em [`PENDENCIAS.md`](./PENDENCIAS.md); recuperação/troca de senha segue **não publicada** (depende do Brevo)

→ Ver [`PROXIMOS_PASSOS.md`](./PROXIMOS_PASSOS.md) para a sequência completa.

---

## Documentação detalhada

| Arquivo | Conteúdo |
|---|---|
| [`STATUS_ATUAL.md`](./STATUS_ATUAL.md) | Git, versões, serviços, o que está e o que não está publicado |
| [`ARQUITETURA.md`](./ARQUITETURA.md) | Como os componentes se comunicam, regras de disponibilidade, admin, onboarding |
| [`INFRAESTRUTURA.md`](./INFRAESTRUTURA.md) | VPS, Nginx, firewall, portas, PM2 |
| [`BANCO_DE_DADOS.md`](./BANCO_DE_DADOS.md) | Schema, tabelas, migrations |
| [`WHATSAPP_EVOLUTION.md`](./WHATSAPP_EVOLUTION.md) | Evolution API, instâncias |
| [`N8N.md`](./N8N.md) | Workflows, webhooks, automação |
| [`ROTAS_E_ENDPOINTS.md`](./ROTAS_E_ENDPOINTS.md) | Endpoints da API |
| [`FLUXOS_DO_BOT.md`](./FLUXOS_DO_BOT.md) | Máquina de estados do bot |
| [`TESTES_REALIZADOS.md`](./TESTES_REALIZADOS.md) | Testes e resultados reais |
| [`PENDENCIAS.md`](./PENDENCIAS.md) | Problemas conhecidos + auditoria |
| [`PROXIMOS_PASSOS.md`](./PROXIMOS_PASSOS.md) | Plano de continuidade ordenado |
| [`INSTALACAO_NOVA_MAQUINA.md`](./INSTALACAO_NOVA_MAQUINA.md) | Setup completo da nova máquina |
