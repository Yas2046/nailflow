# NailFlow — Documentação de Transição

> **Abra este arquivo primeiro ao retomar o projeto em uma nova máquina.**
> Última atualização: 2026-09-18

---

## O que é o NailFlow?

Sistema privado de agendamento e automação de atendimento via WhatsApp para profissional autônoma de nail design. Clientes agendam, confirmem e cancelam horários pelo WhatsApp; a profissional gerencia tudo por um painel web.

---

## Estado atual (2026-09-18)

| Componente | Estado |
|---|---|
| Frontend (painel web) | ✅ funcionando em produção |
| Backend API | ✅ funcionando em produção |
| WhatsApp (chip2) | ✅ conectado (open) |
| Bot conversacional | ✅ respondendo a mensagens |
| n8n (automação) | ✅ ativo, executando workflows |
| Banco de dados | ✅ saudável |
| Nginx + HTTPS | ✅ ativo |
| Backup automático | ✅ diário às 03h |
| Notificações de agendamento | ❌ webhook `nailflow/notificacoes` não registrado |

---

## O que já funciona

- Painel web completo (Dashboard, Agenda, Clientes, Serviços, Disponibilidade, Perfil)
- Cadastro e login de profissionais
- Agendamentos simples e recorrentes
- Bot WhatsApp: boas-vindas personalizadas, menu, agendamento, cancelamento
- Reconhecimento de nome da cliente
- Modo atendimento humano (pausa o bot)
- Abandono de conversa (workflow ativo)
- Lembretes de agendamento (workflow ativo)
- Conexão WhatsApp via QR Code pela tela Configurações
- Multi-tenancy: cada profissional tem sua própria instância Evolution

## O que está pendente / quebrado

- `POST nailflow/notificacoes` → 404 (workflow "NailFlow — Notificações" está inativo)
- Conexão WhatsApp via painel web: implementada mas **não testada em produção**
- Bloco 5 CRM (filtro por tag + busca) — código pronto mas **não commitado**
- `N8N_API_KEY` no `.env` não é usada em nenhum arquivo de código

---

## Onde estão os arquivos importantes

| O quê | Onde |
|---|---|
| Código-fonte | `/var/www/nailflow/` (VPS) + `https://github.com/Yas2046/nailflow` |
| Branch atual | `feat/phase5-register` |
| Variáveis de ambiente | `/var/www/nailflow/backend/.env` (nunca comitar) |
| Schema do banco | `/var/www/nailflow/backend/db/schema.sql` |
| Workflows n8n (exportados) | `/var/www/nailflow/n8n/workflows/` |
| Backup do banco | `/var/backups/nailflow/` (daily, 7 dias) |

---

## Como iniciar o projeto (nova máquina)

→ Leia [`INSTALACAO_NOVA_MAQUINA.md`](./INSTALACAO_NOVA_MAQUINA.md)

O frontend e o backend rodam localmente para desenvolvimento. O VPS (77.237.242.192) continua em produção e não precisa ser reinstalado.

---

## Último commit

```
e123e70 fix: renomear migration 003→006 para evitar conflito de numeração
```

**Atenção:** há 4 arquivos modificados mas não commitados (Bloco 5 CRM + WhatsApp). Ver [`STATUS_ATUAL.md`](./STATUS_ATUAL.md).

---

## Próximo passo recomendado

1. Commitar os 4 arquivos pendentes (Bloco 5 CRM + rotas WhatsApp)
2. Ativar workflow "NailFlow — Notificações" no n8n
3. Testar fluxo completo de confirmação de agendamento via WhatsApp

→ Ver [`PROXIMOS_PASSOS.md`](./PROXIMOS_PASSOS.md) para a sequência completa.

---

## Documentação detalhada

| Arquivo | Conteúdo |
|---|---|
| [`STATUS_ATUAL.md`](./STATUS_ATUAL.md) | Estado detalhado, git, arquivos pendentes |
| [`ARQUITETURA.md`](./ARQUITETURA.md) | Como os componentes se comunicam |
| [`INFRAESTRUTURA.md`](./INFRAESTRUTURA.md) | VPS, Nginx, domínios, portas, PM2 |
| [`BANCO_DE_DADOS.md`](./BANCO_DE_DADOS.md) | Schema, tabelas, migrations |
| [`WHATSAPP_EVOLUTION.md`](./WHATSAPP_EVOLUTION.md) | Evolution API, instância chip2 |
| [`N8N.md`](./N8N.md) | Workflows, webhooks, automação |
| [`ROTAS_E_ENDPOINTS.md`](./ROTAS_E_ENDPOINTS.md) | Todos os endpoints da API |
| [`FLUXOS_DO_BOT.md`](./FLUXOS_DO_BOT.md) | Máquina de estados do bot |
| [`TESTES_REALIZADOS.md`](./TESTES_REALIZADOS.md) | Testes e resultados reais |
| [`PENDENCIAS.md`](./PENDENCIAS.md) | Problemas conhecidos + auditoria |
| [`PROXIMOS_PASSOS.md`](./PROXIMOS_PASSOS.md) | Plano de continuidade ordenado |
| [`INSTALACAO_NOVA_MAQUINA.md`](./INSTALACAO_NOVA_MAQUINA.md) | Setup completo da nova máquina |
