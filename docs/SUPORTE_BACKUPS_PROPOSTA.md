# Backups do NailFlow: análise de segurança e proposta de correção

> **Proposta. Nada aqui foi executado em produção**: nenhuma permissão, script, dump ou snapshot foi alterado.
> A inspeção foi só de leitura (2026-10-11). O script proposto foi testado **somente** em um cluster PostgreSQL
> descartável (127.0.0.1:55432), não em produção. Contexto: as mensagens da Central de Suporte passam a ir para os
> dumps; hoje eles são legíveis por qualquer usuário local.

## 1. Estado encontrado

| Item | Estado |
|---|---|
| `/var/backups/nailflow` | `drwxrwxrwx root:root` (777): qualquer usuário local lê, cria, renomeia e apaga arquivos |
| `nailflow_*.dump` (9 arquivos, ~190–260 KB, 7 dias + 2) | `-rw-rw-r-- postgres:postgres` (664): legíveis por todos, graváveis pelo grupo `postgres` |
| `backup.log` | `644 root` (84 linhas, de 2026-09-14 até hoje) |
| `deleted-professionals/` (563 arquivos) | diretório 700, arquivos 600, `root` (correto) |
| `manual/` | diretório 755; os dois arquivos dentro são 600 (correto) |
| `env_*.bak`, `n8n_database_*.sqlite` | 600 `root` (correto) |
| Script | `/usr/local/bin/nailflow-backup.sh`, `755 root`, chamado pelo cron de `root`: `0 3 * * * /usr/local/bin/nailflow-backup.sh >> /var/backups/nailflow/backup.log 2>&1` |
| Quem usa o diretório | só esse script (nenhuma outra referência em cron, `/usr/local/bin`, `/opt`, `/root/*.sh`); o backend (PM2, usuário `root`) grava os snapshots em `deleted-professionals/` |
| Usuários com shell | `root`, `ubuntu` (grupo `sudo`), `postgres`; o grupo `postgres` não tem outros membros |
| Disco | `/` com 81 GB livres; backups na **mesma máquina** (não há cópia externa) |

**Causa das permissões:** o script roda como root, mas executa `sudo -u postgres pg_dump -Fc nailflow -f ARQUIVO`:
quem cria o arquivo é o `postgres`, com o `umask` dele (002), daí `664`. Para isso o `postgres` precisa gravar no
diretório, e por isso o diretório foi aberto com `777`.

**Gravidade real:** o dump contém o banco inteiro (hashes de senha, dados de clientes e, depois da 023, conversas de
suporte). Como `ubuntu` já é `sudo`, o risco concreto é o de **outro processo ou conta local comprometida** (por
exemplo, um serviço rodando com outro usuário) ler ou **substituir/apagar** dumps. É endurecimento (defesa em
profundidade), não um vazamento ativo; mas a exposição passa a incluir texto de mensagens de suporte.

### `backup.log` pode conter dados sensíveis?

Não no uso normal: as 84 linhas conferidas seguem só três formatos (início, "Backup criado: <caminho> (<tamanho>)",
"Backups mantidos: N"); nenhum dado de cliente, nenhuma credencial. O único risco é o texto de **erro do pg_dump/sudo**,
que o cron também anexa (`2>&1`) quando algo falha: mensagens de erro do PostgreSQL podem citar nome de banco, role
ou, raramente, um trecho do dado no `DETAIL`. Por isso: `600`.

### Defeitos do script atual (além das permissões)

1. `set -e` torna inalcançável o `if [ $? -eq 0 ] … else ERRO`: se o `pg_dump` falhar, **nada** é registrado como
   erro no log (só a saída de erro crua do cron) e um arquivo `.dump` parcial pode ficar e ser mantido por 7 dias.
2. Não verifica o dump (tamanho nem `pg_restore --list`).
3. Sem rotação do `backup.log` (não há entrada em `/etc/logrotate.d`); crescimento desprezível (~3 linhas por dia).
4. O restauro documentado (`docs/INFRAESTRUTURA.md`: `pg_restore -U postgres -d nailflow -Fc …`) restaura **sobre o
   banco em uso** e, com dumps `600 root`, o `postgres` não consegue ler o arquivo (ver o procedimento abaixo).

## 2. Proposta

**Princípio:** o dump passa a ser gravado pelo próprio `root` (redirecionamento do shell com `umask 077`); o
`postgres` só envia os dados pela saída padrão. Assim o arquivo nasce `600 root:root` e o `postgres` **não precisa
mais gravar** no diretório, que pode ser `700 root:root` (mais restrito do que o `770 root:postgres` cogitado antes).

O script proposto (testado no cluster descartável) é o mesmo do bloco abaixo; o arquivo vai para
`/root/nailflow-backup.new.sh` e só depois de validado substitui o atual.

```bash
#!/bin/bash
# Backup diário do banco nailflow. Retenção: 7 dias.
# O dump é gravado pelo próprio root (umask 077): arquivo 600 root:root; o postgres não grava no diretório.
# Grava em .partial, verifica com pg_restore --list e só então renomeia; qualquer falha apaga o parcial,
# registra ERRO no log e sai com código diferente de zero.
# BACKUP_DIR, DB_NAME e PG_DUMP_OPTS existem só para testar em cluster descartável.
set -euo pipefail
umask 077

BACKUP_DIR="${BACKUP_DIR:-/var/backups/nailflow}"
DB_NAME="${DB_NAME:-nailflow}"
PG_DUMP_OPTS="${PG_DUMP_OPTS:-}"
TIMESTAMP=$(date +%Y-%m-%d_%H%M%S)
ARQUIVO="${BACKUP_DIR}/nailflow_${TIMESTAMP}.dump"
PARCIAL="${ARQUIVO}.partial"
LOG="${BACKUP_DIR}/backup.log"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG"; }

on_exit() {
    rc=$?
    if [ "$rc" -ne 0 ]; then
        rm -f "$PARCIAL"
        log "ERRO: backup falhou (codigo $rc); arquivo parcial removido"
    fi
}
trap on_exit EXIT

log "Iniciando backup..."

# shellcheck disable=SC2086
sudo -u postgres pg_dump -Fc $PG_DUMP_OPTS "$DB_NAME" > "$PARCIAL"
[ -s "$PARCIAL" ]
pg_restore --list "$PARCIAL" > /dev/null
mv "$PARCIAL" "$ARQUIVO"
log "Backup criado: $ARQUIVO ($(du -sh "$ARQUIVO" | cut -f1))"

# Retenção: remove dumps com mais de 7 dias e parciais esquecidos (kill -9) com mais de 1 dia.
find "$BACKUP_DIR" -maxdepth 1 -name 'nailflow_*.dump' -mtime +7 -delete
find "$BACKUP_DIR" -maxdepth 1 -name 'nailflow_*.dump.partial' -mtime +1 -delete
MANTIDOS=$(find "$BACKUP_DIR" -maxdepth 1 -name 'nailflow_*.dump' | wc -l)
log "Backups mantidos: $MANTIDOS"
```

### Execução (em horário calmo, longe das 03:00, depois de ler e aprovar)

```bash
STAMP=$(date +%Y%m%d-%H%M%S)

# 0) Estado de referência (guardar a saída)
stat -c '%a %U:%G %n' /var/backups/nailflow /var/backups/nailflow/manual /var/backups/nailflow/nailflow_*.dump /var/backups/nailflow/backup.log > /root/backup_perms_antes_$STAMP.txt

# 1) Instalar o script novo (guardando o original), SEM mexer ainda nas permissões
cp -p /usr/local/bin/nailflow-backup.sh /root/nailflow-backup.sh.orig-$STAMP
install -m 755 -o root -g root /root/nailflow-backup.new.sh /usr/local/bin/nailflow-backup.sh

# 2) Gerar um backup novo com o script novo (o diretório ainda é 777: aceita)
/usr/local/bin/nailflow-backup.sh; echo "exit=$?"
tail -4 /var/backups/nailflow/backup.log
stat -c '%a %U:%G %n' $(ls -t /var/backups/nailflow/nailflow_*.dump | head -1)     # esperado: 600 root:root

# 3) Só então restringir o que já existe
chmod 700 /var/backups/nailflow /var/backups/nailflow/manual
chown root:root /var/backups/nailflow/nailflow_*.dump
chmod 600 /var/backups/nailflow/nailflow_*.dump /var/backups/nailflow/backup.log
```

**Ordem importa:** o script **antigo** deixa de funcionar com o diretório `700` (o `postgres` não consegue gravar);
por isso o script novo entra antes (passos 1–2) e o diretório só é restringido depois (passo 3). O cron **não muda**
(mesma linha: o script é o mesmo caminho).

### Impacto

| Área | Efeito |
|---|---|
| Cron | Nenhum: mesma linha, mesmo caminho. Em falha, o log passa a ter `ERRO` e o cron recebe código ≠ 0 |
| PostgreSQL | Nenhuma mudança de configuração ou de papéis. `pg_dump` segue lendo em uma transação de snapshot (só `ACCESS SHARE`: não bloqueia escrita) |
| Usuário `postgres` (SO) | Deixa de precisar de acesso ao diretório de backups |
| Leitura dos dumps | Só `root`. `ubuntu` usa `sudo`. Qualquer outro processo/usuário local perde o acesso (objetivo) |
| Backend (PM2, `root`) | Nenhum: continua gravando `deleted-professionals/` (700 root) |
| Restauração | Muda o comando (abaixo): o `postgres` não lê mais o arquivo; o `root` abre e entrega por stdin |
| Backups já existentes | Só mudam de modo e dono; conteúdo intocado |

### Validação de um backup novo e teste de restauração

1. Passo 2 acima: `exit=0`, log com "Backup criado" e "Backups mantidos", arquivo `600 root:root`,
   `pg_restore --list <arquivo> | head` lista o conteúdo.
2. Falha controlada (opcional, no cluster descartável, não em produção): banco inexistente → `ERRO` no log, sem
   `.partial`, código ≠ 0 (**testado**: ver abaixo).
3. **Restauração** em um banco **descartável**, nunca sobre `nailflow`. Procedimento testado:

```bash
# cluster descartável já existente em /tmp/nf-pg-iso (porta 55432), banco nf_*_test
export PGHOST=127.0.0.1 PGPORT=55432
psql -U postgres -d postgres -c "CREATE DATABASE nf_restore_check_test"
sudo -u postgres pg_restore -h 127.0.0.1 -p 55432 -U postgres -d nf_restore_check_test --no-owner < /var/backups/nailflow/nailflow_AAAA-MM-DD_HHMMSS.dump
psql -U postgres -d nf_restore_check_test -Atc "SELECT count(*) FROM professionals"   # comparar com a produção (só leitura)
psql -U postgres -d postgres -c "DROP DATABASE nf_restore_check_test"
```

   Para restaurar **em produção** de verdade (emergência): restaurar primeiro em banco novo, conferir, e só então
   decidir o que fazer; `pg_restore` direto sobre `nailflow` (como está em `INFRAESTRUTURA.md`) falha em objetos que já
   existem e pode misturar dados. Se for mesmo necessário substituir: parar a API, `--clean --if-exists`, com backup
   novo feito antes.

### Evidência do teste (cluster descartável, 2026-10-11)

- Backup com o script proposto: `exit=0`; diretório `700 root:root`; dump e log `600 root:root`.
- Falha (banco inexistente): `exit=1`, linha `ERRO … arquivo parcial removido`, nenhum `.partial`, o dump anterior intacto.
- Restauração do dump `600 root` via stdin para um banco novo: `pg_restore exit=0`; as 6 categorias de FAQ e o schema
  restaurados (diferenças só de formatação das expressões `CHECK` na reimpressão do `pg_dump -s`, sem mudança de
  significado); com o diretório `700`, o `postgres` não consegue gravar nele (esperado).
- Limite do teste: o banco descartável não tem dados de clientes; o teste valida mecanismo, permissões e restauração,
  não o conteúdo real. A prova com dados reais é o passo 3 acima, feita no cluster descartável.

### Rollback

```bash
install -m 755 -o root -g root /root/nailflow-backup.sh.orig-$STAMP /usr/local/bin/nailflow-backup.sh
chmod 777 /var/backups/nailflow          # só se o script ANTIGO for usado: ele exige o postgres gravando no diretório
chmod 755 /var/backups/nailflow/manual
# os dumps podem continuar 600 root: nada os lê além do root; para voltar exatamente ao estado anterior, ver
# /root/backup_perms_antes_$STAMP.txt (chown postgres:postgres + chmod 664 nos nove dumps antigos)
```

Voltar ao estado anterior **reabre a exposição**; só faz sentido se o script novo falhar de um jeito que o
`ERRO` do log não explique.

### Depois de executar

- Atualizar `docs/INFRAESTRUTURA.md` (restauro por stdin, em banco novo) e a seção de backups deste repositório.
- Opcional: `logrotate` para `backup.log` e cópia **externa** dos dumps (hoje tudo está no mesmo disco).
