-- Restauração do arquivo financeiro gerado pelo rollback da 025. USO MANUAL; ver _ops/README.md e docs/FINANCEIRO_ETAPA1.md.
-- NÃO faz parte da instalação por ordem de migrations.
--
-- QUANDO USAR: o rollback autorizado da 025 arquivou os dados financeiros em "financeiro_arquivo_AAAAMMDD_HH24MISS" e
-- a estrutura voltou a existir (a 025 foi REAPLICADA). Este script devolve os dados, COLUNA A COLUNA, às tabelas novas.
-- Serve também para recuperar o arquivo a partir de um BACKUP: restaure o dump em outro banco, confira, e rode este script lá.
--
-- PRÉ-CONDIÇÕES (o script ABORTA, sem alterar nada, se alguma falhar):
--   * executar como SUPERUSUÁRIO (em produção: postgres). Os triggers de guarda e de histórico (que recalculam
--     final_price_set_at/finance_reviewed_at/closed_at, recusam dia fechado e duplicariam o histórico) são
--     desligados só dentro desta transação (session_replication_role = replica). Como as FKs também ficam
--     desligadas, o script confere a integridade referencial ele mesmo, antes de gravar.
--   * a 025 reaplicada e a estrutura PRISTINA: financial_payments, financial_audit_log e cash_closings vazias, e nenhum
--     atendimento/despesa com as colunas novas preenchidas (Gastos reaplicado já gera histórico: restaure ANTES de
--     reabrir a API, ou rode o rollback/reaplicação de novo). O script não mescla com dados novos.
--   * o schema de arquivo existe, tem o manifesto (_manifest) e CADA tabela do arquivo confere com ele (contagem e hash
--     gravados pelo rollback, que os conferiu contra a origem antes de remover). Arquivo adulterado ou incompleto aborta.
--   * toda profissional, atendimento e despesa referenciados ainda existem. POR PADRÃO, se uma conta foi excluída entre o
--     rollback e a restauração, o script ABORTA e informa quantos registros ficariam órfãos.
--
-- CONTAS EXCLUÍDAS DEPOIS DO ROLLBACK (opção explícita, -v skip_deleted_accounts=on):
--   Uma conta excluída depois do rollback NÃO pode ser restaurada (a conta não existe mais, e a exclusão foi uma decisão), e o
--   schema de arquivo continua guardando os dados dela (as cópias não têm FK). Com a opção ligada o script restaura só as linhas
--   das contas que EXISTEM, deixa no arquivo as das contas excluídas (informa quantas, por tabela) e confere a restauração contra
--   o subconjunto correspondente do arquivo. Mesmo assim, atendimento ou despesa ausente de uma conta que existe continua
--   abortando (isso não é exclusão de conta). O arquivo NUNCA é alterado: as linhas das contas excluídas só saem dele com o
--   descarte manual do schema (decisão registrada, conforme a política de retenção).
--
-- O QUE FAZ, numa única transação: insere movimentações, histórico (preservando seq e id) e fechamentos; preenche as
-- colunas novas de appointments e expenses SÓ nas linhas arquivadas (sem tocar updated_at nem as demais colunas);
-- reposiciona a sequência do histórico; e confere de novo contagem e hash de TUDO. Qualquer divergência aborta e desfaz tudo.
-- O schema de arquivo NÃO é apagado (descartá-lo é decisão humana posterior).
--
-- Uso (como postgres; conferir o banco antes: SELECT current_database();):
--   sudo -u postgres psql -d nailflow -X -v ON_ERROR_STOP=1 -v archive_schema=financeiro_arquivo_20261101_030000 \
--        -f backend/db/migrations/_ops/025_restore_from_archive.sql
--   (acrescente -v skip_deleted_accounts=on apenas se contas foram excluídas depois do rollback)
-- Depois de restaurar: rode _ops/025_grant_app_role.sql (os grants não voltam sozinhos com a estrutura reaplicada).

\if :{?archive_schema}
\else
  \echo 'defina o schema de arquivo: -v archive_schema=financeiro_arquivo_AAAAMMDD_HH24MISS'
  \quit
\endif
\if :{?skip_deleted_accounts}
\else
  \set skip_deleted_accounts off
\endif

BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL TimeZone = 'UTC';
SELECT set_config('financeiro.archive_schema', :'archive_schema', true);
SELECT set_config('financeiro.skip_deleted_accounts', :'skip_deleted_accounts', true);

DO $restore$
DECLARE
  v_schema   text := current_setting('financeiro.archive_schema');
  v_skip_raw text := current_setting('financeiro.skip_deleted_accounts');
  v_skip     boolean;
  v_super    boolean;
  v_names    text[] := ARRAY['financial_payments', 'financial_audit_log', 'cash_closings', 'appointments_financeiro', 'expenses_financeiro'];
  v_proj     text[] := ARRAY[
    'SELECT * FROM public.financial_payments',
    'SELECT * FROM public.financial_audit_log',
    'SELECT * FROM public.cash_closings',
    'SELECT id, professional_id, checked_in_at, final_price_cents, final_price_set_at, finance_review, finance_reviewed_at FROM public.appointments WHERE checked_in_at IS NOT NULL OR final_price_cents IS NOT NULL OR final_price_set_at IS NOT NULL OR finance_review IS NOT NULL OR finance_reviewed_at IS NOT NULL',
    'SELECT id, professional_id, payment_status, due_on, paid_on, paid_method FROM public.expenses WHERE payment_status <> ''a_revisar'' OR due_on IS NOT NULL OR paid_on IS NOT NULL OR paid_method IS NOT NULL'];
  v_exp_n    bigint[] := ARRAY[0, 0, 0, 0, 0];
  v_exp_h    text[] := ARRAY['', '', '', '', ''];
  i          integer;
  v_exists   boolean;
  v_n        bigint;
  v_h        text;
  v_mn       bigint;
  v_mh       text;
  v_bad      bigint;
  v_orphans  bigint;
  v_left     bigint;
  v_en       bigint;
  v_eh       text;
BEGIN
  IF v_skip_raw NOT IN ('on', 'off') THEN
    RAISE EXCEPTION 'restauração abortada: skip_deleted_accounts deve ser on ou off (recebido: %)', v_skip_raw;
  END IF;
  v_skip := (v_skip_raw = 'on');
  SELECT rolsuper INTO v_super FROM pg_roles WHERE rolname = current_user;
  IF v_super IS NOT TRUE THEN
    RAISE EXCEPTION 'restauração abortada: execute como superusuário (os triggers precisam ser desligados nesta transação)';
  END IF;
  IF v_schema !~ '^financeiro_arquivo_[0-9]{8}_[0-9]{6}$' THEN
    RAISE EXCEPTION 'restauração abortada: nome de schema de arquivo inválido: %', v_schema;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = v_schema) THEN
    RAISE EXCEPTION 'restauração abortada: o schema % não existe', v_schema;
  END IF;
  IF to_regclass(format('%I._manifest', v_schema)) IS NULL THEN
    RAISE EXCEPTION 'restauração abortada: o schema % não tem o manifesto (_manifest); não foi gerado pelo rollback da 025 atual', v_schema;
  END IF;

  -- Estrutura reaplicada e pristina.
  IF to_regclass('public.financial_payments') IS NULL OR to_regclass('public.financial_audit_log') IS NULL
     OR to_regclass('public.cash_closings') IS NULL
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'appointments' AND column_name = 'finance_review')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'expenses' AND column_name = 'payment_status') THEN
    RAISE EXCEPTION 'restauração abortada: reaplique a migration 025 antes (a estrutura não existe)';
  END IF;
  LOCK TABLE public.financial_payments, public.financial_audit_log, public.cash_closings, public.appointments, public.expenses IN ACCESS EXCLUSIVE MODE;
  FOR i IN 1 .. 5 LOOP
    EXECUTE format('SELECT count(*) FROM (%s) t', v_proj[i]) INTO v_n;
    IF v_n <> 0 THEN
      RAISE EXCEPTION 'restauração abortada: o destino não está pristino (% já tem % linha(s)); este script não mescla com dados novos', v_names[i], v_n;
    END IF;
  END LOOP;

  -- O arquivo confere com o manifesto: mesmas tabelas, mesmas contagens, mesmos hashes.
  FOR i IN 1 .. 5 LOOP
    SELECT to_regclass(format('%I.%I', v_schema, v_names[i])) IS NOT NULL INTO v_exists;
    EXECUTE format('SELECT count(*), min(row_count), min(md5) FROM %I._manifest WHERE table_name = $1', v_schema)
      INTO v_n, v_mn, v_mh USING v_names[i];
    IF v_exists <> (v_n = 1) THEN
      RAISE EXCEPTION 'restauração abortada: a tabela % do arquivo e o manifesto não coincidem (arquivo incompleto?)', v_names[i];
    END IF;
    IF v_exists THEN
      EXECUTE format('SELECT count(*), md5(coalesce(string_agg(to_jsonb(t)::text, ''|'' ORDER BY t.id::text), '''')) FROM %I.%I t', v_schema, v_names[i])
        INTO v_n, v_h;
      IF v_n <> v_mn OR v_h <> v_mh THEN
        RAISE EXCEPTION 'restauração abortada: a tabela % do arquivo não confere com o manifesto (contagem % x %, hash %) — arquivo alterado ou corrompido',
          v_names[i], v_n, v_mn, CASE WHEN v_h = v_mh THEN 'igual' ELSE 'diferente' END;
      END IF;
    END IF;
  END LOOP;

  -- Contas que já não existem (excluídas depois do rollback): abortam, a menos que skip_deleted_accounts=on.
  v_orphans := 0;
  FOR i IN 1 .. 5 LOOP
    IF to_regclass(format('%I.%I', v_schema, v_names[i])) IS NOT NULL THEN
      EXECUTE format('SELECT count(*) FROM %I.%I t WHERE NOT EXISTS (SELECT 1 FROM public.professionals x WHERE x.id = t.professional_id)', v_schema, v_names[i]) INTO v_bad;
      v_orphans := v_orphans + v_bad;
    END IF;
  END LOOP;
  IF v_orphans > 0 AND NOT v_skip THEN
    RAISE EXCEPTION 'restauração abortada: % registro(s) do arquivo pertencem a conta(s) excluída(s) e ficariam órfãos (a conta não existe mais). Para restaurar só as contas que existem e deixar o resto no arquivo, repita com -v skip_deleted_accounts=on', v_orphans;
  END IF;

  -- Integridade referencial das linhas que SERÃO restauradas (as FKs ficam desligadas durante a gravação).
  IF to_regclass(format('%I.financial_payments', v_schema)) IS NOT NULL THEN
    EXECUTE format($q$SELECT count(*) FROM %I.financial_payments p
      WHERE EXISTS (SELECT 1 FROM public.professionals x WHERE x.id = p.professional_id)
        AND (NOT EXISTS (SELECT 1 FROM public.appointments a WHERE a.id = p.appointment_id AND a.professional_id = p.professional_id)
         OR (p.reverses_payment_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM %I.financial_payments o WHERE o.id = p.reverses_payment_id AND o.professional_id = p.professional_id)))$q$,
      v_schema, v_schema) INTO v_bad;
    IF v_bad > 0 THEN RAISE EXCEPTION 'restauração abortada: % movimentação(ões) apontam para atendimento ou recebimento original que não existe mais', v_bad; END IF;
  END IF;
  IF to_regclass(format('%I.appointments_financeiro', v_schema)) IS NOT NULL THEN
    EXECUTE format($q$SELECT count(*) FROM %I.appointments_financeiro f
      WHERE EXISTS (SELECT 1 FROM public.professionals x WHERE x.id = f.professional_id)
        AND NOT EXISTS (SELECT 1 FROM public.appointments a WHERE a.id = f.id AND a.professional_id = f.professional_id)$q$, v_schema) INTO v_bad;
    IF v_bad > 0 THEN RAISE EXCEPTION 'restauração abortada: % atendimento(s) arquivado(s) de conta existente não existem mais', v_bad; END IF;
  END IF;
  IF to_regclass(format('%I.expenses_financeiro', v_schema)) IS NOT NULL THEN
    EXECUTE format($q$SELECT count(*) FROM %I.expenses_financeiro f
      WHERE EXISTS (SELECT 1 FROM public.professionals x WHERE x.id = f.professional_id)
        AND NOT EXISTS (SELECT 1 FROM public.expenses e WHERE e.id = f.id AND e.professional_id = f.professional_id)$q$, v_schema) INTO v_bad;
    IF v_bad > 0 THEN RAISE EXCEPTION 'restauração abortada: % despesa(s) arquivada(s) de conta existente não existem mais', v_bad; END IF;
  END IF;

  -- O que se espera depois da gravação: o subconjunto do arquivo das contas que existem (com a opção desligada, é o arquivo todo).
  FOR i IN 1 .. 5 LOOP
    IF to_regclass(format('%I.%I', v_schema, v_names[i])) IS NOT NULL THEN
      EXECUTE format($q$SELECT count(*), md5(coalesce(string_agg(to_jsonb(t)::text, '|' ORDER BY t.id::text), ''))
                          FROM %I.%I t WHERE EXISTS (SELECT 1 FROM public.professionals x WHERE x.id = t.professional_id)$q$, v_schema, v_names[i])
        INTO v_en, v_eh;
      v_exp_n[i] := v_en;
      v_exp_h[i] := v_eh;
    END IF;
  END LOOP;

  -- Gravação com os triggers desligados (só nesta transação).
  PERFORM set_config('session_replication_role', 'replica', true);

  IF to_regclass(format('%I.financial_payments', v_schema)) IS NOT NULL THEN
    EXECUTE format($q$INSERT INTO public.financial_payments
      (id, professional_id, appointment_id, kind, amount_cents, method, occurred_on, source, reverses_payment_id, notes, idempotency_key, request_hash, created_at)
      SELECT id, professional_id, appointment_id, kind, amount_cents, method, occurred_on, source, reverses_payment_id, notes, idempotency_key, request_hash, created_at
        FROM %I.financial_payments t WHERE EXISTS (SELECT 1 FROM public.professionals x WHERE x.id = t.professional_id)$q$, v_schema);
  END IF;
  IF to_regclass(format('%I.financial_audit_log', v_schema)) IS NOT NULL THEN
    EXECUTE format($q$INSERT INTO public.financial_audit_log
      (seq, id, professional_id, entity_type, entity_id, action, actor_id, reason, before_data, after_data, created_at) OVERRIDING SYSTEM VALUE
      SELECT seq, id, professional_id, entity_type, entity_id, action, actor_id, reason, before_data, after_data, created_at
        FROM %I.financial_audit_log t WHERE EXISTS (SELECT 1 FROM public.professionals x WHERE x.id = t.professional_id)$q$, v_schema);
    -- A sequência do histórico continua depois do MAIOR seq do arquivo inteiro (não reutiliza números, mesmo os das contas puladas).
    EXECUTE format($q$SELECT setval(pg_get_serial_sequence('public.financial_audit_log', 'seq'), m) FROM (SELECT max(seq) AS m FROM %I.financial_audit_log) s WHERE m IS NOT NULL$q$, v_schema);
  END IF;
  IF to_regclass(format('%I.cash_closings', v_schema)) IS NOT NULL THEN
    EXECUTE format($q$INSERT INTO public.cash_closings
      (id, professional_id, closing_date, status, received_cents, refunded_cents, expenses_paid_cents, closed_at, reopened_at, reopen_reason, reopen_count, created_at, updated_at)
      SELECT id, professional_id, closing_date, status, received_cents, refunded_cents, expenses_paid_cents, closed_at, reopened_at, reopen_reason, reopen_count, created_at, updated_at
        FROM %I.cash_closings t WHERE EXISTS (SELECT 1 FROM public.professionals x WHERE x.id = t.professional_id)$q$, v_schema);
  END IF;
  IF to_regclass(format('%I.appointments_financeiro', v_schema)) IS NOT NULL THEN
    EXECUTE format($q$UPDATE public.appointments a SET checked_in_at = f.checked_in_at, final_price_cents = f.final_price_cents,
        final_price_set_at = f.final_price_set_at, finance_review = f.finance_review, finance_reviewed_at = f.finance_reviewed_at
      FROM %I.appointments_financeiro f WHERE a.id = f.id AND a.professional_id = f.professional_id$q$, v_schema);
  END IF;
  IF to_regclass(format('%I.expenses_financeiro', v_schema)) IS NOT NULL THEN
    EXECUTE format($q$UPDATE public.expenses e SET payment_status = f.payment_status, due_on = f.due_on, paid_on = f.paid_on, paid_method = f.paid_method
      FROM %I.expenses_financeiro f WHERE e.id = f.id AND e.professional_id = f.professional_id$q$, v_schema);
  END IF;

  PERFORM set_config('session_replication_role', 'origin', true);

  -- Conferência final: contagem e hash do que foi restaurado contra o esperado (e, sem a opção, contra o manifesto).
  FOR i IN 1 .. 5 LOOP
    IF to_regclass(format('%I.%I', v_schema, v_names[i])) IS NOT NULL THEN
      EXECUTE format('SELECT count(*), md5(coalesce(string_agg(to_jsonb(t)::text, ''|'' ORDER BY t.id::text), '''')) FROM (%s) t', v_proj[i]) INTO v_n, v_h;
      IF v_n <> v_exp_n[i] OR v_h <> v_exp_h[i] THEN
        RAISE EXCEPTION 'restauração abortada: após a gravação, % não confere com o arquivo (contagem % x %); tudo foi desfeito', v_names[i], v_n, v_exp_n[i];
      END IF;
      IF NOT v_skip THEN
        EXECUTE format('SELECT row_count, md5 FROM %I._manifest WHERE table_name = $1', v_schema) INTO v_mn, v_mh USING v_names[i];
        IF v_n <> v_mn OR v_h <> v_mh THEN
          RAISE EXCEPTION 'restauração abortada: após a gravação, % não confere com o manifesto (contagem % x %); tudo foi desfeito', v_names[i], v_n, v_mn;
        END IF;
      END IF;
      EXECUTE format('SELECT count(*) FROM %I.%I', v_schema, v_names[i]) INTO v_left;
      RAISE NOTICE 'restauração: % — % restaurada(s) de % no arquivo (% permanecem só no arquivo), hash conferido', v_names[i], v_n, v_left, v_left - v_n;
    END IF;
  END LOOP;
END
$restore$;

COMMIT;
\echo 'ok: restauração concluída e conferida; o schema de arquivo foi mantido. Rode _ops/025_grant_app_role.sql.'
