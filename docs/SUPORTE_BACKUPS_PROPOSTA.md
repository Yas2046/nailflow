# Backups do NailFlow: análise de segurança, proposta de correção e execução

> **Atualização de 2026-10-13: a correção foi executada em produção, com diferenças em relação ao roteiro desta
> proposta.** A seção 0 registra o que foi executado, o que foi validado e o que continua pendente. As seções 1 e 2
> mantêm a análise e a proposta de **2026-10-11** (o "estado encontrado" é o de antes da correção; o roteiro de
> execução e o rollback abaixo são os **originais**, não os que foram usados). O script proposto foi testado em um
> cluster PostgreSQL descartável (127.0.0.1:55432) antes de ir para produção. Contexto: as mensagens da Central de
> Suporte passam a ir para os dumps; antes da correção eles eram legíveis por qualquer usuário local.

## 0. Execução em 2026-10-13 (horários do servidor, `Europe/Berlin`, +0200)

### O que foi executado

A correção foi feita por um procedimento controlado em fases, com scripts em `/root/backup-fix-20261012-234847/`
(fora do repositório): `passos.sh` (fases P, A, B, C, D, E) e `rollback.sh`, ambos com hash conferido antes do uso.
Cada fase só rodou depois de pré-condições de leitura e com `estado` limpo; o procedimento todo foi feito num
mesmo dia, fora da janela do cron das 03:00.

| Fase | Quando | O que fez | Resultado |
|---|---|---|---|
| P | antes de 16:58 | só leitura: pré-condições e evidência do cron do dia | passou (código 0) |
| A | 16:58 | linha de base (9 dumps, 563 snapshots) e cópias de referência do cron e do script original | passou (código 0) |
| B | 19:18 | instalou o script novo em `/usr/local/bin/nailflow-backup.sh` (substituição atômica) | passou (código 0) |
| C | 19:31 | rodou o script novo uma vez (sem retenção) com o diretório ainda 777 e validou o dump | passou (código 0); dump `nailflow_2026-10-13_193153.dump` |
| D | 19:43 | **única fase com `chmod`**: `backup.log` 600, `manual` 700, `/var/backups/nailflow` 700 | passou (código 0) |
| E | 19:45 | rodou o script novo com o diretório já 700, validou o dump e testou o acesso de `nobody` e `postgres` | passou (código 0); dump `nailflow_2026-10-13_194544.dump` |

Não foram executados: rollback, REBASE, limpeza da guarda nem qualquer alteração de cron ou do banco.

### Estado atual (conferido por leitura em 2026-10-13, 19:53–19:54)

| Item | Estado |
|---|---|
| Script instalado | `/usr/local/bin/nailflow-backup.sh`, `755 root:root`, SHA-256 `d450310bf4c4b4c08332aaeff566c13108cfb0ff2a39579b48e38e0d6426a1b9` |
| Script original (preservado) | `/root/backup-fix-20261012-234847/nailflow-backup.sh.orig`, SHA-256 `0cb670240d3130439d5b675f0173e3bcec782c3c8eb85141764db8cfc9a2b5d7` |
| `/var/backups/nailflow` | `700 root:root` |
| `manual/` | `700 root:root` |
| `backup.log` | `600 root:root` |
| `deleted-professionals/` | `700 root:root` (já era assim) |
| Cron | inalterado: `0 3 * * * /usr/local/bin/nailflow-backup.sh >> /var/backups/nailflow/backup.log 2>&1` |
| Dumps | 11: os 9 antigos (05 a 13/10) **continuam `664 postgres:postgres`** (ver abaixo) e os 2 de validação, `600 root:root` |
| `estado` | código 0: T2, permissões finais, lock livre, nenhuma pendência |
| Log | sem nenhuma linha `ERRO`; sem `.partial`, `.new` nem temporários |

### O que foi validado (com evidência)

- Hashes do script instalado, do original, de `passos.sh` e de `rollback.sh` conferidos antes de cada fase e na
  verificação final de leitura.
- C e E: `exit=0`, um único dump novo `600 root:root`, mesma estrutura do dump de referência (12 tabelas com dados,
  109 entradas no TOC), três linhas consecutivas no log ("Iniciando", "Backup criado", "Backups mantidos") e nenhum `ERRO`.
- O script novo rodou **sem terminal e com ambiente mínimo** (`env -i`, `setsid`, `sudo -u postgres pg_dump`, o mesmo
  contexto do cron), primeiro com o diretório 777 (C) e depois com 700 (E). Isso foi feito pelo procedimento, **não
  pelo cron**.
- E: os usuários `nobody` e `postgres` não leem nem atravessam `/var/backups/nailflow`.
- Cópias de guarda: os 10 hashes de `SHA256SUMS` conferem com as cópias e com os dumps atuais.

### Diferenças em relação ao roteiro original (seção 2)

- O script instalado é o candidato de hash `d450310b…`. Além do que está no bloco da seção 2, ele aceita
  `SKIP_RETENTION=1` (usada **só** nas fases C e E, para não apagar dumps durante a validação). Sem essa variável,
  como no cron, a retenção de 7 dias roda normalmente.
- **Os 9 dumps antigos não foram alterados** (nenhum `chown` nem `chmod`): seguem `664 postgres:postgres`, mas dentro
  de um diretório `700 root:root`, de modo que só o `root` chega até eles. Alterar o dono e o modo deles
  (o passo 3 do roteiro original) continua sendo uma decisão pendente; os dumps novos já nascem `600 root:root`.
- O rollback preparado é `/root/backup-fix-20261012-234847/rollback.sh` (SHA-256
  `a892fb22bc0c3dd2941c23306e2d8dcb2e9448cdd08698512cc2749723e70502`), **não executado**. Os comandos de rollback no
  fim deste documento são os do roteiro original.

### Guarda de integridade (cópias de dumps)

Durante C e E o procedimento fez cópias independentes dos dumps existentes, com SHA-256, em
`/root/backup-fix-20261012-234847/guarda/` (`700 root:root`; 10 cópias e `SHA256SUMS`), para provar que nenhum dump
foi sobrescrito durante a validação. **São cópias de dados pessoais** e **continuam presentes**. Decisão registrada:
manter por **no máximo 24 horas depois do `T2.ok` (gravado em 2026-10-13 19:45:46, ou seja, até 2026-10-14 19:45)**,
desde que a validação final esteja limpa. **A remoção ainda não foi feita e exige autorização separada**, com
conferência dos hashes e do estado final.

### Pendente

1. **Primeira execução noturna** do script novo (cron de 2026-10-14, 03:00) com retenção normal e diretório 700:
   ainda não verificada. A conferir depois dela: a linha no log, o dump novo e os dumps removidos pela retenção
   (esperam-se os mais antigos, de 05 e 06/10, mas isso é só previsão a confirmar). Depois dessa noite a linha de
   base do procedimento deixa de valer (um novo REBASE só é necessário se for preciso conferir o estado de novo).
2. **Restauração real não ensaiada neste servidor.** O procedimento por stdin (abaixo) foi testado só no cluster
   descartável em 2026-10-11. Nenhum dump de produção foi restaurado e nenhum comando de restauração foi executado
   contra o banco de produção.
3. **Remoção da guarda** (autorização separada, antes de 2026-10-14 19:45, conforme a decisão acima).
4. **`docs/INFRAESTRUTURA.md`** (restauração por stdin, em banco novo) ainda não foi atualizado: o comando antigo
   (`pg_restore -U postgres -d nailflow -Fc <arquivo>`) deixou de servir com o diretório em 700.
5. Dono e modo dos 9 dumps antigos (acima), `logrotate` do `backup.log` e cópia externa dos dumps (hoje tudo está no
   mesmo disco).
6. Os dois dumps de validação (`…_193153` e `…_194544`) são backups reais adicionais e saem pela retenção normal.

### Como operar com o diretório em 700

- **Só o `root` lê, grava ou lista** `/var/backups/nailflow`; `ubuntu` usa `sudo`. O `postgres` não grava mais lá.
- **Backup manual (por exemplo, antes de uma migration):** o arquivo precisa ser aberto pelo `root`; o `postgres`
  só envia os dados:
  `( umask 077; sudo -u postgres pg_dump -Fc nailflow > /var/backups/nailflow/<nome>.dump )`.
  A forma antiga `pg_dump … -f <arquivo>` (arquivo criado pelo `postgres`) **falha** com o diretório em 700.
- **Restauração:** o `root` abre o arquivo e entrega por entrada padrão (`sudo -u postgres pg_restore … < <dump>`),
  em um banco novo e conferido antes de qualquer decisão; ver o procedimento na seção 2. Não foi ensaiada em
  produção (pendência 2).

## 1. Estado encontrado (2026-10-11, antes da correção)

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

### Roteiro original de execução (**não foi o executado**; ver a seção 0)

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

### Rollback do roteiro original

> O rollback preparado para o procedimento que foi executado é o `rollback.sh` descrito na seção 0 (não
> executado). Os comandos abaixo referem-se ao roteiro original (`/root/nailflow-backup.sh.orig-$STAMP` e
> `/root/backup_perms_antes_$STAMP.txt` **não existem**: foram nomes do roteiro, não do que rodou).

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

- Pendente: atualizar `docs/INFRAESTRUTURA.md` (restauro por stdin, em banco novo); esta seção de backups já foi
  atualizada (seção 0).
- Opcional: `logrotate` para `backup.log` e cópia **externa** dos dumps (hoje tudo está no mesmo disco).
