# NailFlow — Documentação de Transição

> **Abra este arquivo primeiro ao retomar o projeto em uma nova máquina.**
> Última atualização: 2026-09-27

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

**Fechamento técnico da V2 (2026-09-27, em produção, ainda sem commit):** crons corrigidos, webhooks do n8n autenticados por cabeçalho, classificador sim/não no bot, isolamento de `clientId`, normalização de telefone, migrations reproduzíveis (002 oficial + 011–014), seed compatível e suíte automatizada 57/57 em banco descartável.

Detalhes por versão: [`STATUS_ATUAL.md`](./STATUS_ATUAL.md).

---

## Estado atual (2026-09-27)

| Componente | Estado |
|---|---|
| Frontend (painel web) | ✅ em produção |
| Backend API | ✅ em produção |
| WhatsApp (`chip2`, `chip2-teste`) | ⏸️ **desconectados intencionalmente** — não reconectar sem autorização |
| Bot conversacional | ✅ em produção; sem mensagens enquanto as instâncias estão desconectadas (último fluxo validado via `/bot/process` após a correção do `$1`) |
| n8n — WhatsApp Definitivo e Notificações | ✅ ativos, webhooks com Header Auth (ainda sem mensagem real) |
| n8n — Abandono de Conversa e Lembretes | ✅ corrigidos em 2026-09-27 (falharam de 2026-09-21 a 2026-09-27); envio real ainda não exercitado |
| Banco de dados | ✅ saudável; schema reproduzível pelas migrations; seed compatível |
| Testes automatizados | ✅ 57/57 em banco descartável |
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
- Página pública de agendamento por slug (`/p/:slug`)
- Bot WhatsApp: boas-vindas personalizadas, menu, agendamento, cancelamento, consulta, atendimento humano
- Gestão da instância WhatsApp (criação, QR, status) pela tela Configurações
- Multi-profissional: cada profissional tem sua instância Evolution e seus dados isolados

## O que NÃO está disponível / pendente

- **Recuperação de senha ("Esqueci minha senha") e troca de senha logada: NÃO publicadas.** Existe uma implementação isolada, testada apenas em ambiente de teste, em `/opt/nailflow-next` (fora do repositório e fora de produção). O provedor de e-mail (Brevo) **ainda não está configurado**.
- Validação real pelo WhatsApp depois da reconexão do `chip2` → ver [`PENDENCIAS.md`](./PENDENCIAS.md)
- Exports de Abandono e Lembretes regenerados das versões publicadas (prontos para versionar); exports do "Definitivo" e do "Notificações" ainda antigos; mudanças de 2026-09-27 ainda sem commit

---

## Onde estão os arquivos importantes

| O quê | Onde |
|---|---|
| Código-fonte | `/var/www/nailflow/` (VPS) + `https://github.com/Yas2046/nailflow` |
| Branch atual | `feat/phase5-register` |
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

## Último commit

```
b26d682 chore: version V2 production changes
```

Branch `feat/phase5-register` sincronizada com `origin/feat/phase5-register`. As mudanças de 2026-09-27 estão na working tree, **ainda sem commit**.

---

## Próximo passo recomendado

1. Revisar o diff e fazer commit/push das mudanças de 2026-09-27 (incluindo os 2 exports regenerados do n8n)
2. Quando autorizado, reconectar o `chip2` (pela responsável) e validar a primeira mensagem real
3. Configurar o Brevo e, com autorização, publicar a recuperação/troca de senha
4. Integrar V1/V2 ao `main`

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
