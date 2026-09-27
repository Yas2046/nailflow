# Migrations históricas (NÃO executar)

`002_bot_tables.sql` é uma versão antiga e obsoleta das tabelas do bot
(`conversation_states` com `id uuid` + UNIQUE, `message_history` com `id uuid`,
`direction IN ('in','out')`, `message_type`). Ela **não corresponde** ao schema de
produção e **não faz parte da ordem de instalação**.

A definição correta é `../002_evolution_api_tables.sql` (recuperada do commit 985c1f1),
complementada por `../011_conversation_bot_columns.sql`.

Mantida aqui apenas para histórico.
