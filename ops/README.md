# Operação (arquivos NÃO instalados)

Nada nesta pasta é lido ou executado pela aplicação nem pela instalação. São modelos para a retenção de dados
(ver [`docs/SUPORTE_PRIVACIDADE_RETENCAO.md`](../docs/SUPORTE_PRIVACIDADE_RETENCAO.md)). Instalar qualquer um deles
em produção exige autorização explícita.

| Arquivo | O que faz | Como testar sem instalar |
|---|---|---|
| `logrotate/nailflow-pm2` | rotação de 14 dias dos logs do PM2 e do log das rotinas de retenção | `logrotate -d -s /tmp/lr.state ops/logrotate/nailflow-pm2` (simulação; não rotaciona) |
| `cron/support-retention.cron.example` | agendamento (formato `/etc/cron.d`) das rotinas de retenção: chamados e snapshots; auditoria desligada | as linhas foram executadas em ambiente isolado (caminhos absolutos, `flock`, `runuser`, log e mensagem de falha) |
| `../backend/db/migrations/_ops/support_retention.sql` | apaga chamados resolvidos vencidos; auditoria só com `-v audit_enabled=on`. Rodar como `postgres` (a role da aplicação não tem `DELETE` e a rotina falha sem alterar nada) | `backend/tests/support-retention.test.js` (banco descartável) |
| `../backend/scripts/prune-deleted-snapshots.js` | limpa snapshots de exclusão por idade; simulação por padrão (`--apply` remove) | `backend/tests/snapshot-retention.test.js` |

Instalação do logrotate (quando autorizada): `install -m 644 -o root -g root ops/logrotate/nailflow-pm2
/etc/logrotate.d/nailflow-pm2` e, depois de uma semana, conferir `ls -la /root/.pm2/logs`.

## Proteger os snapshots existentes (antes de agendar ou de publicar o código de 30 dias)

O diretório `/var/backups/nailflow/deleted-professionals` tem **563 snapshots** (29/09 a 11/10/2026); só **42** estão
listados como de teste em `/root/etapa13_snapshots_para_limpeza.txt`, e a origem dos outros 521 **não foi verificada**.
O mais antigo completa 30 dias em 29/10/2026. Para que nada seja removido antes da verificação, gerar o
`.retention-hold` com **todos** os nomes existentes na hora da publicação (comando de ESCRITA em produção: só com
autorização; não apaga nem altera nenhum snapshot):

```bash
( umask 077; cd /var/backups/nailflow/deleted-professionals \
  && ls -1 | grep -E '^professional_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}_[0-9T-]+Z\.json$' > .retention-hold )
```

Conferir depois com `wc -l .retention-hold` (igual ao número de snapshots) e com a simulação
`node scripts/prune-deleted-snapshots.js` (deve mostrar vencidos: 0). À medida que a origem de cada grupo for
verificada, remover os nomes do `.retention-hold` (ou apagar o arquivo quando todos forem liberados). O script e a
exclusão de conta nunca removem os nomes listados nesse arquivo; snapshots novos, que não estão na lista, seguem a
retenção normal de 30 dias.
