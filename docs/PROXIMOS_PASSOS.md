# NailFlow — Próximos Passos

> Atualizado em 2026-09-27. Sequência ordenada por dependência. Não pule etapas.
> Toda mudança em produção, n8n, Evolution ou banco exige autorização explícita.

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
- ✅ Revisão completa de segurança do estado atual (auth, isolamento/IDOR, SQLi/XSS/CSRF/CORS, headers, secrets, rate limiting, dependências, migrations 016–019) — nenhum problema real encontrado (2026-09-29)

---

## Fase 1 — Estabilização

### 1.1 Fechar o repositório da V2 (nesta ordem)
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

### 1.3 Reconectar o `chip2` e teste ponta a ponta pelo WhatsApp (somente com autorização)

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

1. Integrar `feat/phase5-register` ao `main` (resolver a divergência entre `main` local e `origin/main`)
2. Remover `N8N_API_KEY` e `N8N_PROFESSIONAL_ID` do `.env` do servidor (não usadas)
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
