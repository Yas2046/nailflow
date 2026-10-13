# Scripts operacionais manuais (NÃO fazem parte da instalação)

Como `_rollback/`, esta pasta **não é executada** por nenhum processo: a instalação segue o padrão do projeto
(`psql -f` de cada migration em `backend/db/migrations/NNN_*.sql`, não recursivo). Não use `find`/`for` recursivo
sobre `db/migrations` para aplicar migrations.

| Arquivo | Quando usar |
|---|---|
| `023_grant_app_role.sql` | **Depois da 023**, quando ela foi aplicada por uma role diferente da que a aplicação usa (em produção: `postgres` aplica, `nailflow` usa). Concede só os privilégios que a Central de Suporte usa e termina conferindo-os. |
| `support_retention.sql` | **Retenção da Central** (não agendado): apaga chamados resolvidos há mais de 6 meses (mensagens e eventos junto); a auditoria só com `-v audit_enabled=on` (desligada por padrão). Rodar como `postgres`: `sudo -u postgres psql -d nailflow -X -v ON_ERROR_STOP=1 -f backend/db/migrations/_ops/support_retention.sql`. Política e testes: `docs/SUPORTE_PRIVACIDADE_RETENCAO.md`. |

```bash
sudo -u postgres psql -d nailflow -v ON_ERROR_STOP=1 -v app_role=nailflow \
     -f backend/db/migrations/_ops/023_grant_app_role.sql
```

Confira antes o banco (`SELECT current_database();`). Sem `-v app_role=...` o script avisa e sai sem alterar nada.
