# NailFlow — Próximos Passos

> Atualizado em 2026-10-03 (`main` em `12dcff7`). Sequência ordenada por dependência. Não pule etapas.
> Toda mudança em produção, n8n, Evolution ou banco exige autorização explícita.

## Onde estamos (2026-10-03) e o que vem agora

O V1/V2, a integração ao `main`, a reconexão do `chip2`, a validação real de agendamento e cancelamento pelo WhatsApp, a confirmação/recusa de solicitações, o sinal por Pix manual, a expiração de reservas, o card "Precisa da sua ação" e o aviso interno à profissional **já foram entregues** (ver "Concluído recentemente" e [`STATUS_ATUAL.md`](./STATUS_ATUAL.md)). As fases numeradas abaixo são o plano original de 2026-09-27: onde uma etapa já foi feita, está marcada (✅) e mantida como histórico.

**Próximos passos reais:**
1. **Uso real e congelamento:** as profissionais começam a usar; **congelar funcionalidades novas por ~2 semanas** e observar o uso real (logs do backend e do n8n, reservas que expiram, pedidos pendentes)
2. **Conectar o WhatsApp de cada profissional** (sem instância ela não recebe avisos nem envia mensagens) e decidir o que fazer com números pessoais conectados — o bot responde a qualquer mensagem privada (M16)
3. **Validações que faltam:** entrega real do aviso interno à profissional com um número real (F9); envio real de lembrete/abandono com confirmação de recebimento
4. **Pendências reais após o congelamento** (M16–M20 e demais em [`PENDENCIAS.md`](./PENDENCIAS.md)): guarda de instância nula no workflow "Notificações", guarda de status em `DELETE /appointments/:id`, aviso interno para reservas do bot, scroll até o erro 409 na página pública, aviso à cliente quando a reserva expira (M14)
5. Admin (nada iniciado, ver A1–A6 em [`PENDENCIAS.md`](./PENDENCIAS.md)): busca e filtros reais de profissionais; antes/depois e motivo na auditoria; filtros/exportação da Auditoria; imutabilidade do log no banco; promoção de admin pela UI
6. Backlog (nada disso está em andamento): publicar recuperação/troca de senha (depende do Brevo), PM2 sem root, SSH só por chave, bot em linguagem natural (F10), Pix automático

---

## Concluído recentemente

- ✅ V1 (`d82603c`) e V2 (`38b3fe7`) finalizadas
- ✅ Mudanças de produção versionadas (`b26d682`): antecedência máxima, fechamentos, limite da Agenda, onboarding, correção do `$1`, migrations 007–010
- ✅ `.gitignore` reforçado
- ✅ Firewall UFW ativo (públicas só 22/80/443)
- ✅ Workflow "NailFlow — Notificações" ativo
- ✅ Crons de Abandono e Lembretes corrigidos (2026-09-27)
- ✅ Webhooks do n8n com Header Auth; classificador sim/não; isolamento de `clientId`; normalização de telefone (2026-09-27, sem commit)
- ✅ Migrations reproduzíveis: 002 oficial + 011–014 (2026-09-27, sem commit)
- ✅ Seed compatível e suíte automatizada 57/57 em banco descartável (2026-09-27, sem commit)
- ✅ Documentação atualizada com o fechamento técnico (2026-09-27)
- ✅ Recorrência de agendamento "Por X dias" (além de "Até uma data"), badge WhatsApp/Somente Agenda em Serviços, Agenda sem limite de antecedência (horizonte externo separado, só WhatsApp/página pública) (2026-09-29)
- ✅ Admin: bloquear/desbloquear, editar e excluir profissionais (com snapshot pré-exclusão e exclusão sincronizada da instância Evolution), audit log de todas as ações administrativas, tela Admin responsiva no mobile (2026-09-29)
- ✅ (2026-09-30 a 2026-10-03) Página pública de agendamento completa; integração da `feat/phase5-register` ao `main`; `chip2` reconectado e agendamento/cancelamento validados com cliente real; Fase 1A (confirmar/recusar solicitações); pacote `cb07d38` (confirmação manual/automática, sinal por Pix manual, expiração, `message.send`) com 4 E2E em produção; `3bcbb1a` (card "Precisa da sua ação", atalho para a Agenda, scroll da página pública); `50906f5` (`public_created` sem instância e telefone normalizado); consolidação final da documentação
- ✅ (2026-10-03) Admin: nova composição visual (menu lateral, cards, ações em menu, diálogos acessíveis) e **Auditoria v1** (`GET /admin/audit-log` + `/admin/auditoria`), `12dcff7`, em produção e validada com login real; 104 registros de teste da `admin_audit_log` removidos antes (backup em `/var/backups/nailflow/manual/`)
- ✅ Revisão completa de segurança do estado atual (auth, isolamento/IDOR, SQLi/XSS/CSRF/CORS, headers, secrets, rate limiting, dependências, migrations 016–019) — nenhum problema real encontrado (2026-09-29)

---

## Fase 1 — Estabilização

### 1.1 Fechar o repositório da V2 (nesta ordem) — ✅ concluído (as mudanças foram commitadas e publicadas; `main` = `origin/main`)
1. ✅ Documentação atualizada
2. ✅ Exports de Abandono e Lembretes regenerados das versões publicadas (2026-09-27); falta, se desejado, regenerar os do "Definitivo" e do "Notificações"
3. Revisão final do `git status` e do diff
4. Commit, adicionando arquivos por nome
5. Push
6. Só depois, quando autorizado: reconectar o WhatsApp e validar ponta a ponta (1.3)

### 1.2 Executar testes automatizados — sempre em banco descartável

```bash
cd /var/www/nailflow/backend
npm test
```

Banco descartável montado com `schema.sql` → migrations → `seed.sql`, URLs do n8n vazias e `EVOLUTION_API_URL` inválida (ver [`INSTALACAO_NOVA_MAQUINA.md`](./INSTALACAO_NOVA_MAQUINA.md)). Estado atual: 57/57.

### 1.3 Reconectar o `chip2` e teste ponta a ponta pelo WhatsApp (somente com autorização) — ✅ feito em 2026-09-30 (reconexão e primeira mensagem) e 2026-10-01 (agendamento e cancelamento com cliente real); resta só o envio real de lembrete/abandono com recebimento confirmado

- Reconexão feita pela responsável; acompanhar a primeira mensagem (webhook com Header Auth — se der 403, ver rollback em [`N8N.md`](./N8N.md))

- Agendamento: "oi" → menu → serviço → data → horário → confirmar
- Cancelamento: "cancelar" → escolher → confirmar
- Respostas sim/não ambíguas devem pedir de novo
- Verificar execuções do "WhatsApp NailFlow — Definitivo" e do "Notificações"
- Acompanhar o primeiro lembrete e o primeiro aviso de abandono reais (`reminder_sent = true` no banco)

---

## Fase 2 — Publicar recuperação e troca de senha

Pré-requisitos:
- Conta Brevo e remetente verificado (configuração feita pela responsável)
- `SMTP_PASS` inserido pela responsável no `backend/.env` do servidor
- Autorização explícita para publicar

Ordem (a migration precisa vir antes do restart do backend):
1. Backup do banco (`pg_dump`) e dos arquivos atuais
2. Aplicar a migration de senha no banco de produção
3. Copiar os arquivos do backend de `/opt/nailflow-next` e rodar `npm install` (inclui `nodemailer`)
4. No `.env`: `NODE_ENV=production`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `MAIL_FROM`
5. Reiniciar apenas o `nailflow-backend`
6. Trocar `frontend/dist` por `frontend/dist-next` (guardando a `dist` atual como backup)
7. Testar um reset real
8. Versionar no Git: arquivos da implementação, migration renumerada no padrão `backend/db/migrations/0NN_*.sql` e `.env.example` com as variáveis SMTP (sem valores)

---

## Fase 3 — Organização do repositório

1. ✅ Integrar `feat/phase5-register` ao `main` — feito em 2026-10-02
2. ✅ Remover `N8N_API_KEY` e `N8N_PROFESSIONAL_ID` do `.env` do servidor (não usadas) — feito em 2026-10-01
3. Limpar arquivos `.bak*` e dumps antigos (ou mover para um arquivo fora do repositório)

---

## Fase 4 — Segurança

1. SSH somente por chave (depois de confirmar o acesso por chave)
2. Senha forte / 2FA no painel do n8n
3. Corrigir o node "Registrar Mensagem Bot" para enviar a instância

## Melhorias de banco (sem urgência)

- Remover o índice duplicado `message_history_dedup_idx` (migration própria, com autorização)
- Decidir sobre `message_history.client_id` (usar ou remover)

---

## Fase 5 — Conexão WhatsApp pelo sistema (QR Code)

Testar Configurações → WhatsApp → conectar com **instância de teste**:
- QR aparece e é escaneável
- Após o escaneio, o status muda para conectado e o onboarding marca WhatsApp como concluído

**Nunca usar o número real nesse teste.**

---

## Fase 6 — Preparação para número real

**Somente depois das fases 1 e 5 validadas.**

1. Criar nova instância Evolution
2. Configurar o webhook na instância nova
3. Fazer **UMA** tentativa de QR para o número real
4. Vincular no banco (`wa_instance_name`)
5. Monitorar por 24h

**⚠️ Nunca fazer isso sem confirmação explícita da profissional.**

---

## Fase 7 — Monitoramento

- Alertas de queda do bot e de falha dos crons (UptimeRobot ou similar)
- Logs estruturados (Winston/Pino)
- Monitorar espaço em disco (`df -h`)

---

## Fase 8 — Futuro

- Campanhas (envio em massa para reativar clientes inativas)
- Painel de histórico de conversas para a profissional
- Export de dados (LGPD)
- Versão pública do projeto para portfólio (repositório separado, sem infraestrutura nem segredos)
- App mobile (longo prazo)
