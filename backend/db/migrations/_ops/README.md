# Scripts operacionais manuais (NÃO fazem parte da instalação)

Como `_rollback/`, esta pasta **não é executada** por nenhum processo: a instalação segue o padrão do projeto
(`psql -f` de cada migration em `backend/db/migrations/NNN_*.sql`, não recursivo). Não use `find`/`for` recursivo
sobre `db/migrations` para aplicar migrations.

| Arquivo | Quando usar |
|---|---|
| `023_grant_app_role.sql` | **Depois da 023**, quando ela foi aplicada por uma role diferente da que a aplicação usa (em produção: `postgres` aplica, `nailflow` usa). Concede só os privilégios que a Central de Suporte usa e termina conferindo-os. |
| `025_grant_app_role.sql` | **Depois da 025**, quando ela foi aplicada por uma role diferente da que a aplicação usa (em produção: `postgres` aplica, `nailflow` usa). Concede `SELECT, INSERT` em `financial_payments` e `financial_audit_log` e `SELECT, INSERT, UPDATE` em `cash_closings`, e **confere que a aplicação não tem UPDATE/DELETE/TRUNCATE** nas tabelas append-only. |
| `028_grant_app_role.sql` | **Depois da 028**, pela mesma razão do 025: concede `SELECT, INSERT` em `expense_payments` (append-only) e confere que a aplicação não tem UPDATE/DELETE/TRUNCATE. Uso: `-v app_role=nailflow`. |
| `029_grant_app_role.sql` | **Depois da 029**: concede `SELECT, INSERT` em `cash_closing_entries` (append-only) e confere que a aplicação não tem UPDATE/DELETE/TRUNCATE. Uso: `-v app_role=nailflow`. |
| `025_restore_from_archive.sql` | **Depois de um rollback autorizado da 025 e da reaplicação da 025** (ou num banco restaurado de um backup): devolve ao banco, coluna a coluna, o arquivo `financeiro_arquivo_*` gerado pelo rollback. Só como superusuário, só em estrutura pristina; valida o arquivo contra o manifesto (contagem e hash) antes e depois, confere a integridade referencial e desfaz tudo se algo divergir. Se uma conta foi excluída depois do rollback, **aborta** (padrão) ou, com `-v skip_deleted_accounts=on`, restaura só as contas que existem e deixa o resto no arquivo. |
| `025_audit_app_privileges.sql` | **Somente leitura**: audita os privilégios efetivos da role da aplicação (superusuária? `CREATE` em `public`? dona de tabelas? `TRUNCATE`/`TRIGGER`/`REFERENCES` excessivos? grants da 025 corretos? `EXECUTE` nas funções internas?). Pode ser rodado em produção por quem tiver autorização; não altera nada. |
| `support_faq_initial.sql` | **Carga inicial da FAQ da Central** (12 artigos de `docs/SUPORTE_FAQ_INICIAL.md`): ids fixos, idempotente, uma transação; não grava na Auditoria. Entra publicado (`-v artigo_status=rascunho` para rascunho). |
| `support_faq_initial_revert.sql` | **Reverte a carga acima**: apaga só os 12 ids; aborta se algum foi editado depois (`-v forcar_editados=on` para forçar). |
| `support_retention.sql` | **Retenção da Central** (não agendado): apaga chamados resolvidos há mais de 6 meses (mensagens e eventos junto); a auditoria só com `-v audit_enabled=on` (desligada por padrão). Rodar como `postgres`: `sudo -u postgres psql -d nailflow -X -v ON_ERROR_STOP=1 -f backend/db/migrations/_ops/support_retention.sql`. Política e testes: `docs/SUPORTE_PRIVACIDADE_RETENCAO.md`. |

```bash
sudo -u postgres psql -d nailflow -v ON_ERROR_STOP=1 -v app_role=nailflow \
     -f backend/db/migrations/_ops/023_grant_app_role.sql
```

Confira antes o banco (`SELECT current_database();`). Sem `-v app_role=...` o script avisa e sai sem alterar nada.

```bash
sudo -u postgres psql -d nailflow -v ON_ERROR_STOP=1 -v app_role=nailflow \
     -f backend/db/migrations/_ops/025_grant_app_role.sql
```

```bash
# restauração do arquivo financeiro (como postgres; 025 reaplicada e API parada; ver docs/FINANCEIRO_ETAPA1.md)
sudo -u postgres psql -d nailflow -X -v ON_ERROR_STOP=1 -v archive_schema=financeiro_arquivo_AAAAMMDD_HH24MISS \
     -f backend/db/migrations/_ops/025_restore_from_archive.sql
sudo -u postgres psql -d nailflow -v ON_ERROR_STOP=1 -v app_role=nailflow -f backend/db/migrations/_ops/025_grant_app_role.sql
```

```bash
# auditoria somente leitura dos privilégios da role da aplicação (não altera nada)
sudo -u postgres psql -d nailflow -X -v app_role=nailflow -f backend/db/migrations/_ops/025_audit_app_privileges.sql
# restauração quando contas foram excluídas depois do rollback (opção explícita)
sudo -u postgres psql -d nailflow -X -v ON_ERROR_STOP=1 -v archive_schema=financeiro_arquivo_AAAAMMDD_HH24MISS -v skip_deleted_accounts=on \
     -f backend/db/migrations/_ops/025_restore_from_archive.sql
```
