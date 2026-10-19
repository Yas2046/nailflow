-- Financeiro (etapa 4): pagamentos parciais de despesas.
-- POR QUE UMA MIGRATION: expenses guarda um único paid_on/paid_method (025), o que não comporta pagamento parcial com saldo e histórico.
-- Esta migration cria expense_payments (movimentações de pagamento de despesa, append-only) e os gatilhos que mantêm a despesa
-- consistente. A 025/026/027 NÃO são reescritas: só se ACRESCENTA (a) uma UNIQUE (id, professional_id) em expenses, alvo da FK composta
-- (mesmo padrão da 017/025) e (b) um valor a cada lista de financial_audit_log (entity_type e action): superconjuntos compatíveis.
-- NADA é migrado nem reclassificado: despesas existentes continuam 'a_revisar' até revisão manual; nenhum pagamento é criado.
--
-- Modelo: despesa 'pendente' recebe pagamentos (parciais); quando a soma alcança o valor, o gatilho a marca 'paga' (paid_on e
-- paid_method do ÚLTIMO pagamento). Só despesa 'pendente' recebe pagamento (a_revisar exige revisão manual; paga já está quitada).
-- Regras no banco (valem para qualquer escritor): soma dos pagamentos <= valor da despesa; dia fechado no caixa recusa o pagamento;
-- o valor da despesa não cai abaixo do já pago; despesa com pagamento não volta para 'a_revisar'; a despesa com pagamento não pode ser
-- apagada (FK sem cascata; a exclusão da conta apaga tudo em cascata). Histórico: gatilho grava expense_payment_create (025).
-- SECURITY DEFINER + search_path = pg_catalog, pg_temp + objetos qualificados (padrão da 025/027): o fluxo atual de Gastos não depende
-- de grants novos. Aplicar como a dona das tabelas (em produção, postgres), depois da 025. Aditiva, idempotente, transacional.

BEGIN;

SET LOCAL lock_timeout = '3s';

DO $pre$
BEGIN
  IF to_regclass('public.expenses') IS NULL OR to_regclass('public.financial_audit_log') IS NULL
     OR to_regprocedure('public.fin_append_only_guard()') IS NULL OR to_regprocedure('public.fin_day_is_closed(uuid, date)') IS NULL
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'expenses' AND column_name = 'payment_status') THEN
    RAISE EXCEPTION 'migration 028: a migration 025 precisa estar aplicada';
  END IF;
END
$pre$;

DO $c$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'expenses_id_professional_id_key' AND conrelid = 'public.expenses'::regclass) THEN
    ALTER TABLE public.expenses ADD CONSTRAINT expenses_id_professional_id_key UNIQUE (id, professional_id);
  END IF;
END
$c$;

-- Superconjuntos: todo valor aceito antes continua aceito.
ALTER TABLE public.financial_audit_log DROP CONSTRAINT IF EXISTS financial_audit_log_entity_type_check;
ALTER TABLE public.financial_audit_log ADD CONSTRAINT financial_audit_log_entity_type_check
  CHECK (entity_type IN ('payment', 'expense', 'appointment', 'cash_closing', 'expense_payment'));
ALTER TABLE public.financial_audit_log DROP CONSTRAINT IF EXISTS financial_audit_log_action_check;
ALTER TABLE public.financial_audit_log ADD CONSTRAINT financial_audit_log_action_check CHECK (action IN (
  'payment_create', 'payment_refund',
  'expense_create', 'expense_update', 'expense_status', 'expense_delete',
  'appointment_checkin', 'appointment_final_price', 'appointment_review',
  'cash_close', 'cash_reopen', 'correction', 'expense_payment_create'));

CREATE TABLE IF NOT EXISTS public.expense_payments (
  id              uuid         NOT NULL DEFAULT gen_random_uuid(),
  professional_id uuid         NOT NULL,
  expense_id      uuid         NOT NULL,
  amount_cents    integer      NOT NULL,
  method          varchar(20)  NOT NULL,
  paid_on         date         NOT NULL,
  notes           text,
  idempotency_key varchar(64),
  request_hash    char(64),
  created_at      timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT expense_payments_pkey PRIMARY KEY (id),
  CONSTRAINT expense_payments_professional_fkey FOREIGN KEY (professional_id) REFERENCES public.professionals(id) ON DELETE CASCADE,
  CONSTRAINT expense_payments_expense_fkey FOREIGN KEY (expense_id, professional_id)
    REFERENCES public.expenses (id, professional_id) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT expense_payments_amount_check CHECK (amount_cents > 0),
  CONSTRAINT expense_payments_method_check CHECK (method IN ('pix', 'dinheiro', 'cartao_debito', 'cartao_credito', 'boleto', 'transferencia', 'outra')),
  CONSTRAINT expense_payments_notes_check CHECK (notes IS NULL OR char_length(notes) <= 500),
  CONSTRAINT expense_payments_idempotency_pair_check CHECK ((idempotency_key IS NULL) = (request_hash IS NULL)),
  CONSTRAINT expense_payments_idempotency_key_check CHECK (idempotency_key IS NULL OR char_length(idempotency_key) BETWEEN 8 AND 64),
  CONSTRAINT expense_payments_request_hash_check CHECK (request_hash IS NULL OR request_hash ~ '^[0-9a-f]{64}$')
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_expense_payments_idempotency
  ON public.expense_payments (professional_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_expense_payments_expense ON public.expense_payments (expense_id);
CREATE INDEX IF NOT EXISTS idx_expense_payments_day ON public.expense_payments (professional_id, paid_on);

DROP TRIGGER IF EXISTS trg_expense_payments_append_only ON public.expense_payments;
CREATE TRIGGER trg_expense_payments_append_only BEFORE UPDATE OR DELETE ON public.expense_payments
  FOR EACH ROW EXECUTE FUNCTION fin_append_only_guard();

CREATE OR REPLACE FUNCTION fin_expense_payments_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $f$
DECLARE
  v_status text;
  v_amount integer;
  v_paid   bigint;
BEGIN
  IF public.fin_day_is_closed(NEW.professional_id, NEW.paid_on) THEN
    RAISE EXCEPTION 'financeiro: o dia % está fechado; reabra o caixa ou use outra data', NEW.paid_on USING ERRCODE = 'check_violation';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('fin_exp:' || NEW.expense_id::text, 0));
  SELECT payment_status, amount_cents INTO v_status, v_amount
    FROM public.expenses WHERE id = NEW.expense_id AND professional_id = NEW.professional_id;
  IF NOT FOUND THEN RETURN NEW; END IF;                      -- despesa inexistente: a FK composta (adiada) recusa
  IF v_status <> 'pendente' THEN
    RAISE EXCEPTION 'financeiro: só despesa pendente recebe pagamento (estado atual: %)', v_status USING ERRCODE = 'check_violation';
  END IF;
  SELECT COALESCE(SUM(amount_cents), 0) INTO v_paid
    FROM public.expense_payments WHERE expense_id = NEW.expense_id AND professional_id = NEW.professional_id;
  IF v_paid + NEW.amount_cents > v_amount THEN
    RAISE EXCEPTION 'financeiro: os pagamentos (% + %) ultrapassariam o valor da despesa (%)', v_paid, NEW.amount_cents, v_amount USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$f$;

DROP TRIGGER IF EXISTS trg_expense_payments_guard ON public.expense_payments;
CREATE TRIGGER trg_expense_payments_guard BEFORE INSERT ON public.expense_payments
  FOR EACH ROW EXECUTE FUNCTION fin_expense_payments_guard();

-- Quitou: marca a despesa como paga (data e método do último pagamento). O UPDATE passa pelos gatilhos de despesas da 025
-- (dia fechado e histórico expense_status, com o autor/motivo da sessão).
CREATE OR REPLACE FUNCTION fin_expense_payments_sync() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $f$
DECLARE
  v_amount integer;
  v_paid   bigint;
BEGIN
  SELECT amount_cents INTO v_amount FROM public.expenses WHERE id = NEW.expense_id AND professional_id = NEW.professional_id;
  SELECT COALESCE(SUM(amount_cents), 0) INTO v_paid
    FROM public.expense_payments WHERE expense_id = NEW.expense_id AND professional_id = NEW.professional_id;
  IF v_paid >= v_amount THEN
    UPDATE public.expenses SET payment_status = 'paga', paid_on = NEW.paid_on, paid_method = NEW.method
     WHERE id = NEW.expense_id AND professional_id = NEW.professional_id AND payment_status = 'pendente';
  END IF;
  RETURN NULL;
END
$f$;

DROP TRIGGER IF EXISTS trg_expense_payments_sync ON public.expense_payments;
CREATE TRIGGER trg_expense_payments_sync AFTER INSERT ON public.expense_payments
  FOR EACH ROW EXECUTE FUNCTION fin_expense_payments_sync();

CREATE OR REPLACE FUNCTION fin_expense_payments_audit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $f$
BEGIN
  PERFORM public.fin_audit(NEW.professional_id, 'expense_payment', NEW.id, 'expense_payment_create', NULL,
    jsonb_build_object('expense_id', NEW.expense_id, 'amount_cents', NEW.amount_cents, 'method', NEW.method, 'paid_on', NEW.paid_on), NULL);
  RETURN NULL;
END
$f$;

DROP TRIGGER IF EXISTS trg_expense_payments_audit ON public.expense_payments;
CREATE TRIGGER trg_expense_payments_audit AFTER INSERT ON public.expense_payments
  FOR EACH ROW EXECUTE FUNCTION fin_expense_payments_audit();

-- O valor da despesa não cai abaixo do já pago; despesa com pagamento não volta para a revisar.
CREATE OR REPLACE FUNCTION fin_expenses_paid_floor() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $f$
DECLARE
  v_paid bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('fin_exp:' || NEW.id::text, 0));
  SELECT COALESCE(SUM(amount_cents), 0) INTO v_paid
    FROM public.expense_payments WHERE expense_id = NEW.id AND professional_id = NEW.professional_id;
  IF NEW.amount_cents < v_paid THEN
    RAISE EXCEPTION 'financeiro: o valor da despesa (%) ficaria abaixo do já pago (%)', NEW.amount_cents, v_paid USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.payment_status = 'a_revisar' AND v_paid > 0 THEN
    RAISE EXCEPTION 'financeiro: despesa com pagamentos registrados não volta para a revisar' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$f$;

DROP TRIGGER IF EXISTS trg_expenses_fin_paid_floor ON public.expenses;
CREATE TRIGGER trg_expenses_fin_paid_floor BEFORE UPDATE OF amount_cents, payment_status ON public.expenses
  FOR EACH ROW
  WHEN (OLD.amount_cents IS DISTINCT FROM NEW.amount_cents OR OLD.payment_status IS DISTINCT FROM NEW.payment_status)
  EXECUTE FUNCTION fin_expenses_paid_floor();

DO $verify$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT p.proname FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
            AND p.proname IN ('fin_expense_payments_guard', 'fin_expense_payments_sync', 'fin_expense_payments_audit', 'fin_expenses_paid_floor')
            AND (NOT p.prosecdef OR NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, '{}')) c WHERE c = 'search_path=pg_catalog, pg_temp')) LOOP
    RAISE EXCEPTION 'migration 028: % deveria ser SECURITY DEFINER com search_path = pg_catalog, pg_temp', r.proname;
  END LOOP;
  IF (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgname IN
      ('trg_expense_payments_append_only', 'trg_expense_payments_guard', 'trg_expense_payments_sync', 'trg_expense_payments_audit', 'trg_expenses_fin_paid_floor')) <> 5 THEN
    RAISE EXCEPTION 'migration 028: gatilhos ausentes';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'financial_audit_log_action_check' AND pg_get_constraintdef(oid) LIKE '%expense_payment_create%') THEN
    RAISE EXCEPTION 'migration 028: lista de ações do histórico não foi ampliada';
  END IF;
END
$verify$;

COMMIT;
