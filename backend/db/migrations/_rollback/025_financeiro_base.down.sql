-- Rollback da migration 025 (Financeiro, etapa 1). USO MANUAL; ver db/migrations/_rollback/README.md.
--
-- NÃO APAGA MOVIMENTAÇÃO FINANCEIRA EM SILÊNCIO. Três situações:
--  1. Nada foi usado (tabelas novas vazias, colunas novas NULL, despesas ainda 'a_revisar' sem datas de pagamento):
--     remove a estrutura e termina.
--  2. Há dados financeiros e a sessão NÃO tem a autorização: ABORTA mostrando as contagens, sem alterar nada.
--  3. Há dados financeiros e a sessão tem a autorização, na MESMA sessão:
--         SET financeiro.confirm_destructive_rollback = 'ARQUIVAR-E-REMOVER-DADOS-FINANCEIROS';
--     Antes de remover qualquer coisa, COPIA tudo para um schema novo "financeiro_arquivo_AAAAMMDD_HH24MISS"
--     (financial_payments, financial_audit_log, cash_closings, as colunas novas de appointments e de expenses),
--     confere contagens E hashes da cópia contra a origem, grava o manifesto (<schema>._manifest) e só então remove a
--     estrutura. O schema de arquivo NÃO é apagado por este
--     script: a decisão de descartá-lo é humana e posterior.
-- O arquivo guarda os dados, mas as colunas novas voltam a não existir nas tabelas originais: reaplicar a 025 NÃO
-- reimporta o arquivo (a reimportação, se necessária, é um procedimento manual a partir do schema de arquivo).
--
-- Os dados ANTERIORES à 025 (agendamentos, sinais Pix, despesas, valores, datas) nunca são tocados.
-- A role que executa precisa ser dona das tabelas (em produção: postgres). Pare a API antes: o script trava as
-- tabelas (ACCESS EXCLUSIVE) ANTES de contar, para que nada seja gravado entre a contagem e a remoção; se não
-- conseguir o bloqueio em 3 s, aborta sem alterar nada.
-- Idempotente: sem a estrutura, não faz nada.

BEGIN;

-- A migration 028 depende da 025 (FK composta em expenses, listas de financial_audit_log): reverta a 028 antes.
DO $g028$
BEGIN
  IF to_regclass('public.expense_payments') IS NOT NULL THEN
    RAISE EXCEPTION 'rollback 025 abortado: a migration 028 (expense_payments) ainda esta aplicada; rode antes _rollback/028_financeiro_despesas.down.sql. Nada foi alterado.';
  END IF;
END
$g028$;

-- A migration 029 (cash_closing_entries, fin_day_is_closed com lock do dia) também depende da 025: reverta a 029 antes.
DO $g029$
BEGIN
  IF to_regclass('public.cash_closing_entries') IS NOT NULL THEN
    RAISE EXCEPTION 'rollback 025 abortado: a migration 029 (cash_closing_entries) ainda esta aplicada; rode antes _rollback/029_financeiro_fechamento_caixa.down.sql. Nada foi alterado.';
  END IF;
END
$g029$;

SET LOCAL lock_timeout = '3s';
SET LOCAL TimeZone = 'UTC';   -- hashes do manifesto são comparáveis entre sessões

DO $down$
DECLARE
  v_confirm   text := current_setting('financeiro.confirm_destructive_rollback', true);
  v_ok        boolean;
  c_pay       bigint := 0;
  c_audit     bigint := 0;
  c_close     bigint := 0;
  c_appt      bigint := 0;
  c_exp       bigint := 0;
  v_schema    text;
  has_pay     boolean := to_regclass('public.financial_payments') IS NOT NULL;
  has_audit   boolean := to_regclass('public.financial_audit_log') IS NOT NULL;
  has_close   boolean := to_regclass('public.cash_closings') IS NOT NULL;
  has_appt    boolean := EXISTS (SELECT 1 FROM information_schema.columns
                                  WHERE table_schema = 'public' AND table_name = 'appointments' AND column_name = 'finance_review');
  has_exp     boolean := EXISTS (SELECT 1 FROM information_schema.columns
                                  WHERE table_schema = 'public' AND table_name = 'expenses' AND column_name = 'payment_status');
  a_pay bigint; a_audit bigint; a_close bigint; a_appt bigint; a_exp bigint;
  v_names text[] := '{}'; v_srcq text[] := '{}'; v_h1 text; v_h2 text; v_n bigint; i integer; v_ts timestamptz;
BEGIN
  -- Bloqueia ANTES de contar.
  BEGIN
    IF has_pay   THEN LOCK TABLE financial_payments  IN ACCESS EXCLUSIVE MODE; END IF;
    IF has_audit THEN LOCK TABLE financial_audit_log IN ACCESS EXCLUSIVE MODE; END IF;
    IF has_close THEN LOCK TABLE cash_closings       IN ACCESS EXCLUSIVE MODE; END IF;
    IF has_appt  THEN LOCK TABLE appointments        IN ACCESS EXCLUSIVE MODE; END IF;
    IF has_exp   THEN LOCK TABLE expenses            IN ACCESS EXCLUSIVE MODE; END IF;
  EXCEPTION WHEN lock_not_available OR deadlock_detected THEN
    RAISE EXCEPTION 'rollback 025 abortado: não foi possível bloquear as tabelas financeiras em 3 s; pare a API, espere as transações terminarem e repita. Nada foi alterado.';
  END;

  IF has_pay   THEN SELECT count(*) INTO c_pay   FROM financial_payments;  END IF;
  IF has_audit THEN SELECT count(*) INTO c_audit FROM financial_audit_log; END IF;
  IF has_close THEN SELECT count(*) INTO c_close FROM cash_closings;       END IF;
  IF has_appt THEN
    SELECT count(*) INTO c_appt FROM appointments
     WHERE checked_in_at IS NOT NULL OR final_price_cents IS NOT NULL OR final_price_set_at IS NOT NULL
        OR finance_review IS NOT NULL OR finance_reviewed_at IS NOT NULL;
  END IF;
  IF has_exp THEN
    SELECT count(*) INTO c_exp FROM expenses
     WHERE payment_status <> 'a_revisar' OR due_on IS NOT NULL OR paid_on IS NOT NULL OR paid_method IS NOT NULL;
  END IF;

  IF c_pay + c_audit + c_close + c_appt + c_exp > 0 THEN
    IF v_confirm IS DISTINCT FROM 'ARQUIVAR-E-REMOVER-DADOS-FINANCEIROS' THEN
      RAISE EXCEPTION 'rollback 025 abortado: há dados financeiros em uso (movimentações %, histórico %, fechamentos %, atendimentos com dados novos %, despesas com dados novos %). Nada foi alterado. Para arquivá-los e remover a estrutura, autorize na mesma sessão: SET financeiro.confirm_destructive_rollback = ''ARQUIVAR-E-REMOVER-DADOS-FINANCEIROS'' (ver _rollback/README.md).',
        c_pay, c_audit, c_close, c_appt, c_exp;
    END IF;

    v_ts := clock_timestamp();
    v_schema := 'financeiro_arquivo_' || to_char(v_ts, 'YYYYMMDD_HH24MISS');
    WHILE EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = v_schema) LOOP   -- dois rollbacks no mesmo segundo: nunca reutiliza um arquivo
      v_ts := v_ts + interval '1 second';
      v_schema := 'financeiro_arquivo_' || to_char(v_ts, 'YYYYMMDD_HH24MISS');
    END LOOP;
    EXECUTE format('CREATE SCHEMA %I', v_schema);
    IF has_pay   THEN EXECUTE format('CREATE TABLE %I.financial_payments AS TABLE public.financial_payments', v_schema); END IF;
    IF has_audit THEN EXECUTE format('CREATE TABLE %I.financial_audit_log AS TABLE public.financial_audit_log', v_schema); END IF;
    IF has_close THEN EXECUTE format('CREATE TABLE %I.cash_closings AS TABLE public.cash_closings', v_schema); END IF;
    IF has_appt THEN
      EXECUTE format($q$CREATE TABLE %I.appointments_financeiro AS
        SELECT id, professional_id, checked_in_at, final_price_cents, final_price_set_at, finance_review, finance_reviewed_at
          FROM public.appointments
         WHERE checked_in_at IS NOT NULL OR final_price_cents IS NOT NULL OR final_price_set_at IS NOT NULL
            OR finance_review IS NOT NULL OR finance_reviewed_at IS NOT NULL$q$, v_schema);
    END IF;
    IF has_exp THEN
      EXECUTE format($q$CREATE TABLE %I.expenses_financeiro AS
        SELECT id, professional_id, payment_status, due_on, paid_on, paid_method FROM public.expenses
         WHERE payment_status <> 'a_revisar' OR due_on IS NOT NULL OR paid_on IS NOT NULL OR paid_method IS NOT NULL$q$, v_schema);
    END IF;

    -- Confere a cópia ANTES de remover; qualquer divergência aborta e desfaz tudo. Para cada tabela: contagem e hash
    -- (md5 do JSON de cada linha, ordenado por id, com TimeZone UTC) da ORIGEM e do ARQUIVO têm de coincidir. O resultado
    -- fica no manifesto do arquivo (<schema>._manifest), que o procedimento de restauração usa para detectar
    -- arquivo adulterado ou incompleto (_ops/025_restore_from_archive.sql).
    a_pay := 0; a_audit := 0; a_close := 0; a_appt := 0; a_exp := 0;
    IF has_pay   THEN EXECUTE format('SELECT count(*) FROM %I.financial_payments', v_schema)  INTO a_pay;   END IF;
    IF has_audit THEN EXECUTE format('SELECT count(*) FROM %I.financial_audit_log', v_schema) INTO a_audit; END IF;
    IF has_close THEN EXECUTE format('SELECT count(*) FROM %I.cash_closings', v_schema)       INTO a_close; END IF;
    IF has_appt  THEN EXECUTE format('SELECT count(*) FROM %I.appointments_financeiro', v_schema) INTO a_appt; END IF;
    IF has_exp   THEN EXECUTE format('SELECT count(*) FROM %I.expenses_financeiro', v_schema)     INTO a_exp;  END IF;
    IF (a_pay, a_audit, a_close, a_appt, a_exp) IS DISTINCT FROM (c_pay, c_audit, c_close, c_appt, c_exp) THEN
      RAISE EXCEPTION 'rollback 025 abortado: a cópia de arquivo não confere com a origem; nada foi removido.';
    END IF;

    EXECUTE format('CREATE TABLE %I._manifest (table_name text PRIMARY KEY, row_count bigint NOT NULL, md5 text NOT NULL, created_at timestamptz NOT NULL DEFAULT now())', v_schema);
    IF has_pay   THEN v_names := array_append(v_names, 'financial_payments'::text);  v_srcq := array_append(v_srcq, 'SELECT * FROM public.financial_payments'::text);  END IF;
    IF has_audit THEN v_names := array_append(v_names, 'financial_audit_log'::text); v_srcq := array_append(v_srcq, 'SELECT * FROM public.financial_audit_log'::text); END IF;
    IF has_close THEN v_names := array_append(v_names, 'cash_closings'::text);       v_srcq := array_append(v_srcq, 'SELECT * FROM public.cash_closings'::text);       END IF;
    IF has_appt THEN
      v_names := array_append(v_names, 'appointments_financeiro'::text);
      v_srcq := array_append(v_srcq, 'SELECT id, professional_id, checked_in_at, final_price_cents, final_price_set_at, finance_review, finance_reviewed_at FROM public.appointments WHERE checked_in_at IS NOT NULL OR final_price_cents IS NOT NULL OR final_price_set_at IS NOT NULL OR finance_review IS NOT NULL OR finance_reviewed_at IS NOT NULL'::text);
    END IF;
    IF has_exp THEN
      v_names := array_append(v_names, 'expenses_financeiro'::text);
      v_srcq := array_append(v_srcq, 'SELECT id, professional_id, payment_status, due_on, paid_on, paid_method FROM public.expenses WHERE payment_status <> ''a_revisar'' OR due_on IS NOT NULL OR paid_on IS NOT NULL OR paid_method IS NOT NULL'::text);
    END IF;
    FOR i IN 1 .. COALESCE(array_length(v_names, 1), 0) LOOP
      EXECUTE format('SELECT md5(coalesce(string_agg(to_jsonb(t)::text, ''|'' ORDER BY t.id::text), '''')), count(*) FROM (%s) t', v_srcq[i]) INTO v_h1, v_n;
      EXECUTE format('SELECT md5(coalesce(string_agg(to_jsonb(t)::text, ''|'' ORDER BY t.id::text), '''')) FROM %I.%I t', v_schema, v_names[i]) INTO v_h2;
      IF v_h1 IS DISTINCT FROM v_h2 THEN
        RAISE EXCEPTION 'rollback 025 abortado: o hash da cópia de % não confere com a origem; nada foi removido.', v_names[i];
      END IF;
      EXECUTE format('INSERT INTO %I._manifest (table_name, row_count, md5) VALUES ($1, $2, $3)', v_schema) USING v_names[i], v_n, v_h1;
    END LOOP;
    RAISE NOTICE 'rollback 025: dados financeiros arquivados em %.* (movimentações %, histórico %, fechamentos %, atendimentos %, despesas %)',
      v_schema, c_pay, c_audit, c_close, c_appt, c_exp;
  END IF;
END
$down$;

-- Remoção da estrutura (triggers, funções, índices, constraints, colunas, tabelas).
-- Objetos das migrations 026/027 que dependem da estrutura da 025 (a 026 é só uma constraint e sai com a tabela). Os dois gatilhos da 027
-- (teto de recebimento e piso do valor) não guardam dados; precisam sair antes das colunas e da tabela de que dependem.
DROP TRIGGER IF EXISTS trg_appointments_fin_value_floor ON appointments;
DROP FUNCTION IF EXISTS fin_appointments_value_floor();
DROP TRIGGER IF EXISTS trg_financial_payments_cap ON financial_payments;
DROP FUNCTION IF EXISTS fin_payments_cap_guard();
DROP TRIGGER IF EXISTS trg_appointments_fin_audit ON appointments;
DROP TRIGGER IF EXISTS trg_appointments_fin_guard ON appointments;
DROP TRIGGER IF EXISTS trg_expenses_fin_audit ON expenses;
DROP TRIGGER IF EXISTS trg_expenses_fin_guard ON expenses;

DROP TABLE IF EXISTS financial_payments;
DROP TABLE IF EXISTS cash_closings;
DROP TABLE IF EXISTS financial_audit_log;

DROP FUNCTION IF EXISTS fin_appointments_audit();
DROP FUNCTION IF EXISTS fin_appointments_guard();
DROP FUNCTION IF EXISTS fin_expenses_audit();
DROP FUNCTION IF EXISTS fin_expense_snapshot(expenses);
DROP FUNCTION IF EXISTS fin_expenses_guard();
DROP FUNCTION IF EXISTS fin_payments_audit();
DROP FUNCTION IF EXISTS fin_payments_guard();
DROP FUNCTION IF EXISTS fin_cash_closings_audit();
DROP FUNCTION IF EXISTS fin_cash_closings_guard();
DROP FUNCTION IF EXISTS fin_day_is_closed(uuid, date);
DROP FUNCTION IF EXISTS fin_audit(uuid, text, uuid, text, jsonb, jsonb, text);
DROP FUNCTION IF EXISTS fin_append_only_guard();
DROP FUNCTION IF EXISTS fin_require_reason(text);
DROP FUNCTION IF EXISTS fin_audit_actor();
DROP FUNCTION IF EXISTS fin_audit_reason();
DROP FUNCTION IF EXISTS fin_professional_exists(uuid);

DROP INDEX IF EXISTS idx_appointments_finance_review_pending;
DROP INDEX IF EXISTS idx_expenses_pending;
DROP INDEX IF EXISTS idx_expenses_paid_on;

ALTER TABLE appointments
  DROP CONSTRAINT IF EXISTS appointments_final_price_check,
  DROP CONSTRAINT IF EXISTS appointments_final_price_pair_check,
  DROP CONSTRAINT IF EXISTS appointments_finance_review_check,
  DROP CONSTRAINT IF EXISTS appointments_finance_review_pair_check,
  DROP CONSTRAINT IF EXISTS appointments_id_professional_id_key,
  DROP COLUMN IF EXISTS checked_in_at,
  DROP COLUMN IF EXISTS final_price_cents,
  DROP COLUMN IF EXISTS final_price_set_at,
  DROP COLUMN IF EXISTS finance_review,
  DROP COLUMN IF EXISTS finance_reviewed_at;

ALTER TABLE expenses
  DROP CONSTRAINT IF EXISTS expenses_payment_status_check,
  DROP CONSTRAINT IF EXISTS expenses_payment_state_check,
  DROP CONSTRAINT IF EXISTS expenses_paid_method_check,
  DROP COLUMN IF EXISTS payment_status,
  DROP COLUMN IF EXISTS due_on,
  DROP COLUMN IF EXISTS paid_on,
  DROP COLUMN IF EXISTS paid_method;

COMMIT;
