# Central de Suporte: decisões e limitações da V1

> Registro das decisões tomadas e das pendências. A Central **não está publicada**: depende das migrations 023/024, de `SUPPORT_CENTER_ENABLED=true` e de reiniciar o backend. Contratos das rotas: [`ROTAS_E_ENDPOINTS.md`](./ROTAS_E_ENDPOINTS.md).

## Decididas

| Tema | Decisão |
|---|---|
| Limite de solicitações abertas | **10 por profissional**, valendo na **criação e na reabertura** pela profissional (409 `too_many_open`). Criar e reabrir concorrentes são serializados pelo mesmo lock (`pg_advisory_xact_lock` por profissional); a recusa acontece antes de qualquer escrita. A reabertura pela ADM não é limitada. |
| Termos de prioridade | Os da especificação, versionados em `backend/src/utils/supportPriority.js` (termos de "alta" só contam na categoria Técnico, exceto "urgente"). Sem termos novos. |
| "Lido" da ADM | **Compartilhado** entre administradoras (`admin_read_seq` por solicitação): se uma abre, fica lida para todas. Aceito na V1 (há uma ADM). |
| Retenção | **Sem exclusão automática nesta fase.** Nenhuma rotina apaga solicitações resolvidas; elas permanecem enquanto a conta existir. Ao excluir a conta, as conversas vão junto (snapshot de 90 dias incluído; exclusão aborta com 409 se houver atividade nova depois do snapshot). |

## Pendentes (precisam de decisão)

1. **Prazo de retenção** das solicitações resolvidas em contas ativas (proposta: 12 meses, com rotina própria, revisada e aprovada). Sem a rotina, as mensagens ficam indefinidamente.
2. **Política do `admin_audit_log`**: prazo e anonimização do `target_business_name` após a exclusão da conta (hoje indefinido e sem FK). A auditoria não grava texto de mensagem nem assunto.
3. **Poda dos snapshots de exclusão**: hoje só roda quando há nova exclusão; para garantir 90 dias, precisa de rotina por tempo.
4. **Texto de retenção/privacidade** exibido ao usuário: revisão jurídica. Evitar prometer "exclusão definitiva": há cópias em snapshot (90 dias) e dumps (7 dias).
5. **Permissões dos backups** (ver abaixo).

## Permissões do diretório de backups (achado de segurança)

Estado lido em 2026-10-11, **somente leitura**:

- `/var/backups/nailflow` está `777 root:root`; os dumps diários `nailflow_*.dump` são `664 postgres:postgres` (legíveis por qualquer usuário local e graváveis pelo grupo `postgres`); `backup.log` é `644`.
- `deleted-professionals/` (700) e os arquivos `env_*`/`n8n_*`/`manual/*` (600) estão corretos.
- Causa: `/usr/local/bin/nailflow-backup.sh` (cron das 03:00, como root) roda `sudo -u postgres pg_dump -Fc ... -f arquivo`, então o usuário `postgres` precisa gravar no diretório e o `umask` dele gera 664. Só esse script referencia o caminho (nenhuma outra dependência encontrada em cron, `/usr/local/bin`, `/opt` e `/root/*.sh`).
- As mensagens de suporte passam a ir para esses dumps.

**Correção proposta (não executada)**, em duas partes, depois de um backup validado:

1. Diretório: `chown root:postgres /var/backups/nailflow && chmod 770` (o `postgres` continua gravando; o `root` do cron continua lendo/removendo; outros usuários perdem acesso).
2. Dumps: no script, `umask 077` antes do `pg_dump` (arquivos novos 600) e `chmod 600 nailflow_*.dump` nos 9 existentes; `backup.log` para 600.

Impactos: quem não for root nem do grupo `postgres` deixa de ler os dumps (esperado). Restauração por `root` ou `postgres` segue funcionando. Risco principal: se algum processo desconhecido rodar como outro usuário, perde acesso, por isso validar com um ciclo de backup (`nailflow-backup.sh` manual) e conferir `backup.log` antes de considerar concluído. Rollback: `chmod 777`/`664` de volta.
