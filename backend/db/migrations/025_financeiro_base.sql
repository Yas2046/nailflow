-- Financeiro (etapa 1): estrutura de banco e base de auditoria.
-- Aditiva, idempotente e transacional. NÃO migra, converte nem reclassifica nenhum dado existente.
-- Rollback: db/migrations/_rollback/025_financeiro_base.down.sql (ver README: não apaga movimentações sem arquivar).
-- Permissões da role da aplicação: db/migrations/_ops/025_grant_app_role.sql (uso manual, depois desta).
--
-- O QUE CRIA
--  financial_payments   movimentações de recebimento e estorno por atendimento (append-only).
--  financial_audit_log  histórico de alterações financeiras (append-only; antes/depois, motivo e autor).
--  cash_closings        fechamento diário de caixa (um registro por profissional e dia; fechado/aberto).
--  appointments         + checked_in_at, final_price_cents, final_price_set_at, finance_review,
--                         finance_reviewed_at; + UNIQUE (id, professional_id) (alvo da FK composta).
--  expenses             + payment_status ('a_revisar' | 'pendente' | 'paga'), due_on, paid_on, paid_method.
--
-- REGRAS DE NÃO-CLASSIFICAÇÃO (nada é presumido)
--  * Todas as colunas novas de appointments nascem NULL: nenhum atendimento antigo vira "realizado",
--    "com check-in" ou "revisado". O valor final só existe quando alguém o informar.
--  * deposit_cents e paid_at (sinal Pix) NÃO são lidos nem copiados: nenhuma movimentação é criada a partir deles.
--    A confirmação de um sinal antigo é um ato posterior e explícito (financial_payments.source =
--    'sinal_pix_confirmado', no máximo um por atendimento, valor limitado ao sinal registrado).
--  * expenses.payment_status tem DEFAULT 'a_revisar' (valor constante, sem reescrever a tabela): as despesas
--    existentes e as criadas pelo código atual ficam "a revisar". expense_date NÃO é prova de pagamento:
--    'paga' exige paid_on explícito, que é uma coluna diferente.
--
-- ENDURECIMENTO DE search_path (funções SECURITY DEFINER, que rodam com os privilégios de quem aplicou a migration):
--  * todas as funções fin_* usam SET search_path = pg_catalog, pg_temp: o schema public NÃO entra na busca, então uma
--    role não-dona com CREATE em public (é o caso de nailflow em produção) não consegue interceptar uma chamada sem
--    qualificação criando, por exemplo, public.hashtextextended(text, integer) (assinatura exata que vence a
--    conversão implícita de pg_catalog.hashtextextended(text, bigint));
--  * todo objeto do projeto usado nos corpos é qualificado (public.tabela, public.fin_*()).
--    Testes: tests/financeiro-migrations.test.js ("search_path endurecido ...").
--
-- INTEGRIDADE E ISOLAMENTO
--  * Toda tabela nova tem professional_id NOT NULL com FK para professionals ON DELETE CASCADE (a exclusão da
--    conta apaga os dados financeiros dela, como o resto). Referências a atendimento e a pagamento são FKs
--    COMPOSTAS com professional_id: o banco recusa apontar para linha de outra profissional.
--  * financial_payments e financial_audit_log são append-only por trigger: UPDATE e DELETE falham; o único
--    DELETE aceito é o da exclusão em cascata da própria conta (quando a profissional já não existe).
--    TRUNCATE não é bloqueado por trigger: é bloqueado por privilégio (a role da aplicação não o recebe).
--  * A FK financial_payments -> appointments é DEFERRABLE INITIALLY DEFERRED: a exclusão da conta apaga
--    atendimentos e pagamentos no mesmo comando, e a checagem só ocorre no COMMIT, quando ambos já se foram.
--    Fora disso, apagar um atendimento que tem pagamento falha (NO ACTION): não existe cascata de atendimento.
--  * Estorno é uma linha NOVA que referencia o recebimento original (mesmo atendimento, data não anterior,
--    motivo obrigatório); a soma dos estornos de um recebimento nunca passa do valor dele (serializado por
--    advisory lock). O original nunca é alterado.
--  * Idempotência: (professional_id, idempotency_key) único, com request_hash obrigatório junto da chave.
--    A API deve usar INSERT ... ON CONFLICT (professional_id, idempotency_key) WHERE idempotency_key IS NOT NULL
--    DO NOTHING (alvo explícito) e, se não voltar linha, comparar request_hash: igual devolve a existente,
--    diferente é conflito (409).
--  * Dia fechado (cash_closings.status = 'fechado') recusa recebimento/estorno com occurred_on nesse dia e
--    despesa paga com paid_on nesse dia. Correções entram como lançamentos novos num dia aberto, ou reabrindo o
--    dia com motivo (registrado no histórico).
--  * Correções: alterar ou desfazer algo já registrado (valor final, check-in, revisão, despesa paga) exige um
--    motivo informado na sessão: SELECT set_config('nailflow.audit_reason', '...', true) na mesma transação.
--    O autor (opcional) vem de set_config('nailflow.actor_id', '<uuid>', true).
--
-- HISTÓRICO AUTOMÁTICO (triggers AFTER, na mesma transação da alteração)
--  pagamentos (create/refund), fechamentos (close/reopen), despesas (create/update/status/delete) e as colunas
--  novas de appointments (check-in, valor final, revisão). Alterações de outros campos de appointments e de
--  expenses que já existiam não geram registro novo além do descrito.
--
-- LIMITES CONHECIDOS (a API/etapas seguintes devem cobrir)
--  * O banco não compara pagamentos com o valor final do atendimento (recebido <= final): é regra da API.
--  * O banco não impede apagar uma despesa 'paga' (o histórico guarda o registro): decisão da API.
--  * O banco não valida que occurred_on / paid_on / closing_date não estão no futuro: regra da API (fuso do negócio).
--  * Os totais de cash_closings são informados pela API no fechamento e congelados; o banco não os recalcula.
--
-- APLICAÇÃO SEGURA: lock_timeout de 3 s (ALTER TABLE em appointments e expenses toma lock forte, brevíssimo, pois
-- só há colunas com DEFAULT constante/NULL e um UNIQUE em tabela pequena). Se não conseguir, ABORTA: repita em
-- horário calmo. Ao final, um bloco de verificação confere a estrutura e FALHA (revertendo tudo) se divergir.

BEGIN;

SET LOCAL lock_timeout = '3s';

-- ── Pré-condições ──────────────────────────────────────────────────────────
DO $pre$
BEGIN
  IF to_regclass('public.professionals') IS NULL OR to_regclass('public.appointments') IS NULL
     OR to_regclass('public.expenses') IS NULL THEN
    RAISE EXCEPTION 'migration 025: professionals, appointments e expenses precisam existir (migrations anteriores aplicadas?)';
  END IF;
  IF to_regprocedure('public.set_updated_at()') IS NULL THEN
    RAISE EXCEPTION 'migration 025: função set_updated_at() ausente (db/schema.sql)';
  END IF;
  IF to_regclass('public.financial_payments') IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'financial_payments' AND column_name = 'reverses_payment_id') THEN
    RAISE EXCEPTION 'migration 025: financial_payments já existe com outra estrutura';
  END IF;
END
$pre$;

-- ── Colunas novas em appointments (todas NULL; nenhuma linha é alterada) ───
ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS checked_in_at       timestamptz,
  ADD COLUMN IF NOT EXISTS final_price_cents   integer,
  ADD COLUMN IF NOT EXISTS final_price_set_at  timestamptz,
  ADD COLUMN IF NOT EXISTS finance_review      varchar(20),
  ADD COLUMN IF NOT EXISTS finance_reviewed_at timestamptz;

DO $c$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'appointments_final_price_check' AND conrelid = 'appointments'::regclass) THEN
    ALTER TABLE appointments ADD CONSTRAINT appointments_final_price_check
      CHECK (final_price_cents IS NULL OR final_price_cents >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'appointments_final_price_pair_check' AND conrelid = 'appointments'::regclass) THEN
    ALTER TABLE appointments ADD CONSTRAINT appointments_final_price_pair_check
      CHECK ((final_price_cents IS NULL) = (final_price_set_at IS NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'appointments_finance_review_check' AND conrelid = 'appointments'::regclass) THEN
    ALTER TABLE appointments ADD CONSTRAINT appointments_finance_review_check
      CHECK (finance_review IS NULL OR finance_review IN ('realizado', 'nao_compareceu', 'cancelado', 'sem_movimentacao'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'appointments_finance_review_pair_check' AND conrelid = 'appointments'::regclass) THEN
    ALTER TABLE appointments ADD CONSTRAINT appointments_finance_review_pair_check
      CHECK ((finance_review IS NULL) = (finance_reviewed_at IS NULL));
  END IF;
  -- Alvo da FK composta (id, professional_id) de financial_payments (mesmo padrão da migration 017).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'appointments_id_professional_id_key' AND conrelid = 'appointments'::regclass) THEN
    ALTER TABLE appointments ADD CONSTRAINT appointments_id_professional_id_key UNIQUE (id, professional_id);
  END IF;
END
$c$;

-- Lista de atendimentos passados ainda sem classificação (consulta da futura revisão guiada).
CREATE INDEX IF NOT EXISTS idx_appointments_finance_review_pending
  ON appointments (professional_id, starts_at)
  WHERE status IN ('pendente', 'confirmado') AND finance_reviewed_at IS NULL;

-- ── Colunas novas em expenses (DEFAULT constante: nenhuma linha é reescrita ou classificada como paga) ──
ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS payment_status varchar(10) NOT NULL DEFAULT 'a_revisar',
  ADD COLUMN IF NOT EXISTS due_on         date,
  ADD COLUMN IF NOT EXISTS paid_on        date,
  ADD COLUMN IF NOT EXISTS paid_method    varchar(20);

DO $c$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'expenses_payment_status_check' AND conrelid = 'expenses'::regclass) THEN
    ALTER TABLE expenses ADD CONSTRAINT expenses_payment_status_check
      CHECK (payment_status IN ('a_revisar', 'pendente', 'paga'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'expenses_payment_state_check' AND conrelid = 'expenses'::regclass) THEN
    ALTER TABLE expenses ADD CONSTRAINT expenses_payment_state_check
      CHECK ((payment_status = 'paga' AND paid_on IS NOT NULL)
          OR (payment_status <> 'paga' AND paid_on IS NULL AND paid_method IS NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'expenses_paid_method_check' AND conrelid = 'expenses'::regclass) THEN
    ALTER TABLE expenses ADD CONSTRAINT expenses_paid_method_check
      CHECK (paid_method IS NULL OR paid_method IN ('pix', 'dinheiro', 'cartao_debito', 'cartao_credito', 'boleto', 'transferencia', 'outra'));
  END IF;
END
$c$;

CREATE INDEX IF NOT EXISTS idx_expenses_pending
  ON expenses (professional_id, due_on) WHERE payment_status = 'pendente';
CREATE INDEX IF NOT EXISTS idx_expenses_paid_on
  ON expenses (professional_id, paid_on) WHERE payment_status = 'paga';

-- ── Funções auxiliares (search_path fixo; VOLÁTEIS de propósito: veem o estado atual da transação) ──
CREATE OR REPLACE FUNCTION fin_professional_exists(p_id uuid) RETURNS boolean
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $f$
BEGIN
  RETURN EXISTS (SELECT 1 FROM public.professionals WHERE id = p_id);
END
$f$;

CREATE OR REPLACE FUNCTION fin_audit_reason() RETURNS text
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $f$
  SELECT nullif(btrim(current_setting('nailflow.audit_reason', true)), '')
$f$;

CREATE OR REPLACE FUNCTION fin_audit_actor() RETURNS uuid
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $f$
  SELECT CASE WHEN btrim(coalesce(current_setting('nailflow.actor_id', true), ''))
                   ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
              THEN btrim(current_setting('nailflow.actor_id', true))::uuid END
$f$;

-- Exige motivo para corrigir/desfazer algo já registrado.
CREATE OR REPLACE FUNCTION fin_require_reason(p_what text) RETURNS void
LANGUAGE plpgsql STABLE SET search_path = pg_catalog, pg_temp AS $f$
BEGIN
  IF public.fin_audit_reason() IS NULL OR char_length(public.fin_audit_reason()) < 3 THEN
    RAISE EXCEPTION 'financeiro: % exige um motivo (set_config(''nailflow.audit_reason'', ..., true))', p_what
      USING ERRCODE = 'check_violation';
  END IF;
END
$f$;

-- ── Histórico de alterações financeiras ────────────────────────────────────
CREATE TABLE IF NOT EXISTS financial_audit_log (
  seq             bigint       GENERATED ALWAYS AS IDENTITY,
  id              uuid         NOT NULL DEFAULT gen_random_uuid(),
  professional_id uuid         NOT NULL,
  entity_type     varchar(20)  NOT NULL,
  entity_id       uuid         NOT NULL,   -- sem FK de propósito: o registro sobrevive à linha de origem (ex.: despesa apagada)
  action          varchar(30)  NOT NULL,
  actor_id        uuid,                    -- sem FK: guarda quem agiu mesmo que a conta mude depois; NULL = não informado
  reason          text,
  before_data     jsonb,
  after_data      jsonb,
  created_at      timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT financial_audit_log_pkey PRIMARY KEY (id),
  CONSTRAINT financial_audit_log_seq_key UNIQUE (seq),
  CONSTRAINT financial_audit_log_professional_fkey FOREIGN KEY (professional_id)
    REFERENCES professionals(id) ON DELETE CASCADE,
  CONSTRAINT financial_audit_log_entity_type_check
    CHECK (entity_type IN ('payment', 'expense', 'appointment', 'cash_closing')),
  CONSTRAINT financial_audit_log_action_check CHECK (action IN (
    'payment_create', 'payment_refund',
    'expense_create', 'expense_update', 'expense_status', 'expense_delete',
    'appointment_checkin', 'appointment_final_price', 'appointment_review',
    'cash_close', 'cash_reopen', 'correction')),
  CONSTRAINT financial_audit_log_reason_check
    CHECK (reason IS NULL OR char_length(btrim(reason)) BETWEEN 3 AND 500),
  CONSTRAINT financial_audit_log_reason_required_check
    CHECK (action NOT IN ('payment_refund', 'cash_reopen', 'correction') OR reason IS NOT NULL),
  CONSTRAINT financial_audit_log_before_check CHECK (before_data IS NULL OR jsonb_typeof(before_data) = 'object'),
  CONSTRAINT financial_audit_log_after_check  CHECK (after_data  IS NULL OR jsonb_typeof(after_data)  = 'object')
);
CREATE INDEX IF NOT EXISTS idx_financial_audit_professional ON financial_audit_log (professional_id, seq DESC);
CREATE INDEX IF NOT EXISTS idx_financial_audit_entity ON financial_audit_log (entity_type, entity_id, seq);

-- Append-only: UPDATE nunca; DELETE só na exclusão em cascata da própria conta.
CREATE OR REPLACE FUNCTION fin_append_only_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $f$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF public.fin_professional_exists(OLD.professional_id) THEN
      RAISE EXCEPTION '% é append-only: registros não podem ser apagados', TG_TABLE_NAME USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  RAISE EXCEPTION '% é append-only: registros não podem ser alterados', TG_TABLE_NAME USING ERRCODE = 'check_violation';
END
$f$;

DROP TRIGGER IF EXISTS trg_financial_audit_log_append_only ON financial_audit_log;
CREATE TRIGGER trg_financial_audit_log_append_only BEFORE UPDATE OR DELETE ON financial_audit_log
  FOR EACH ROW EXECUTE FUNCTION fin_append_only_guard();

CREATE OR REPLACE FUNCTION fin_audit(p_prof uuid, p_type text, p_entity uuid, p_action text,
                                     p_before jsonb, p_after jsonb, p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $f$
BEGIN
  INSERT INTO public.financial_audit_log (professional_id, entity_type, entity_id, action, actor_id, reason, before_data, after_data)
  VALUES (p_prof, p_type, p_entity, p_action, public.fin_audit_actor(), p_reason, p_before, p_after);
END
$f$;

-- ── Fechamento diário de caixa ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cash_closings (
  id                  uuid         NOT NULL DEFAULT gen_random_uuid(),
  professional_id     uuid         NOT NULL,
  closing_date        date         NOT NULL,
  status              varchar(10)  NOT NULL DEFAULT 'fechado',
  received_cents      integer      NOT NULL DEFAULT 0,
  refunded_cents      integer      NOT NULL DEFAULT 0,
  expenses_paid_cents integer      NOT NULL DEFAULT 0,
  closed_at           timestamptz  NOT NULL DEFAULT now(),
  reopened_at         timestamptz,
  reopen_reason       text,
  reopen_count        integer      NOT NULL DEFAULT 0,
  created_at          timestamptz  NOT NULL DEFAULT now(),
  updated_at          timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT cash_closings_pkey PRIMARY KEY (id),
  CONSTRAINT cash_closings_professional_fkey FOREIGN KEY (professional_id)
    REFERENCES professionals(id) ON DELETE CASCADE,
  CONSTRAINT cash_closings_day_key UNIQUE (professional_id, closing_date),
  CONSTRAINT cash_closings_status_check CHECK (status IN ('fechado', 'aberto')),
  CONSTRAINT cash_closings_totals_check
    CHECK (received_cents >= 0 AND refunded_cents >= 0 AND expenses_paid_cents >= 0),
  CONSTRAINT cash_closings_reopen_count_check CHECK (reopen_count >= 0),
  CONSTRAINT cash_closings_reopen_reason_check
    CHECK (reopen_reason IS NULL OR char_length(btrim(reopen_reason)) BETWEEN 3 AND 500),
  CONSTRAINT cash_closings_reopened_check
    CHECK (status = 'fechado' OR (reopened_at IS NOT NULL AND reopen_reason IS NOT NULL AND reopen_count >= 1))
);

DO $t$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_cash_closings_updated' AND tgrelid = 'cash_closings'::regclass) THEN
    CREATE TRIGGER trg_cash_closings_updated BEFORE UPDATE ON cash_closings
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END
$t$;

CREATE OR REPLACE FUNCTION fin_day_is_closed(p_prof uuid, p_day date) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $f$
BEGIN
  RETURN p_day IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.cash_closings WHERE professional_id = p_prof AND closing_date = p_day AND status = 'fechado');
END
$f$;

-- Guarda do fechamento: novo dia nasce fechado; só as transições fechado -> aberto (reabertura, com motivo)
-- e aberto -> fechado (novo fechamento) são aceitas; identidade imutável; contadores e datas derivados.
CREATE OR REPLACE FUNCTION fin_cash_closings_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $f$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'fechado' THEN
      RAISE EXCEPTION 'cash_closings: um dia novo só pode ser criado fechado' USING ERRCODE = 'check_violation';
    END IF;
    NEW.reopened_at := NULL; NEW.reopen_reason := NULL; NEW.reopen_count := 0; NEW.closed_at := now();
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF public.fin_professional_exists(OLD.professional_id) THEN
      RAISE EXCEPTION 'cash_closings: fechamentos não podem ser apagados (reabra o dia com motivo)' USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.professional_id IS DISTINCT FROM OLD.professional_id
     OR NEW.closing_date IS DISTINCT FROM OLD.closing_date OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'cash_closings: identidade do fechamento é imutável' USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.status = 'fechado' AND NEW.status = 'aberto' THEN
    IF NEW.reopen_reason IS NULL OR char_length(btrim(NEW.reopen_reason)) < 3
       OR NEW.reopen_reason IS NOT DISTINCT FROM OLD.reopen_reason THEN
      RAISE EXCEPTION 'cash_closings: reabrir um dia exige um motivo novo' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.received_cents <> OLD.received_cents OR NEW.refunded_cents <> OLD.refunded_cents
       OR NEW.expenses_paid_cents <> OLD.expenses_paid_cents THEN
      RAISE EXCEPTION 'cash_closings: os totais só mudam ao fechar de novo' USING ERRCODE = 'check_violation';
    END IF;
    NEW.reopen_count := OLD.reopen_count + 1;
    NEW.reopened_at := now();
    NEW.closed_at := OLD.closed_at;
    RETURN NEW;
  END IF;

  IF OLD.status = 'aberto' AND NEW.status = 'fechado' THEN
    NEW.reopen_count := OLD.reopen_count;
    NEW.reopened_at := OLD.reopened_at;
    NEW.reopen_reason := OLD.reopen_reason;
    NEW.closed_at := now();
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'cash_closings: dia %: transição % -> % não permitida (dia fechado só reabre; dia aberto só fecha)',
    OLD.closing_date, OLD.status, NEW.status USING ERRCODE = 'check_violation';
END
$f$;

DROP TRIGGER IF EXISTS trg_cash_closings_guard ON cash_closings;
CREATE TRIGGER trg_cash_closings_guard BEFORE INSERT OR UPDATE OR DELETE ON cash_closings
  FOR EACH ROW EXECUTE FUNCTION fin_cash_closings_guard();

CREATE OR REPLACE FUNCTION fin_cash_closings_audit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $f$
DECLARE
  v_after jsonb := jsonb_build_object('closing_date', NEW.closing_date, 'status', NEW.status,
    'received_cents', NEW.received_cents, 'refunded_cents', NEW.refunded_cents,
    'expenses_paid_cents', NEW.expenses_paid_cents, 'reopen_count', NEW.reopen_count);
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.fin_audit(NEW.professional_id, 'cash_closing', NEW.id, 'cash_close', NULL, v_after, NULL);
  ELSIF OLD.status = 'fechado' AND NEW.status = 'aberto' THEN
    PERFORM public.fin_audit(NEW.professional_id, 'cash_closing', NEW.id, 'cash_reopen',
      jsonb_build_object('status', OLD.status, 'received_cents', OLD.received_cents, 'refunded_cents', OLD.refunded_cents,
                         'expenses_paid_cents', OLD.expenses_paid_cents), v_after, NEW.reopen_reason);
  ELSIF OLD.status = 'aberto' AND NEW.status = 'fechado' THEN
    PERFORM public.fin_audit(NEW.professional_id, 'cash_closing', NEW.id, 'cash_close',
      jsonb_build_object('status', OLD.status, 'received_cents', OLD.received_cents, 'refunded_cents', OLD.refunded_cents,
                         'expenses_paid_cents', OLD.expenses_paid_cents), v_after, NULL);
  END IF;
  RETURN NULL;
END
$f$;

DROP TRIGGER IF EXISTS trg_cash_closings_audit ON cash_closings;
CREATE TRIGGER trg_cash_closings_audit AFTER INSERT OR UPDATE ON cash_closings
  FOR EACH ROW EXECUTE FUNCTION fin_cash_closings_audit();

-- ── Movimentações: recebimentos e estornos ─────────────────────────────────
CREATE TABLE IF NOT EXISTS financial_payments (
  id                  uuid         NOT NULL DEFAULT gen_random_uuid(),
  professional_id     uuid         NOT NULL,
  appointment_id      uuid         NOT NULL,
  kind                varchar(12)  NOT NULL,
  amount_cents        integer      NOT NULL,
  method              varchar(20)  NOT NULL,
  occurred_on         date         NOT NULL,
  source              varchar(24)  NOT NULL DEFAULT 'manual',
  reverses_payment_id uuid,
  notes               text,
  idempotency_key     varchar(64),
  request_hash        char(64),
  created_at          timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT financial_payments_pkey PRIMARY KEY (id),
  CONSTRAINT financial_payments_id_professional_id_key UNIQUE (id, professional_id),
  CONSTRAINT financial_payments_professional_fkey FOREIGN KEY (professional_id)
    REFERENCES professionals(id) ON DELETE CASCADE,
  CONSTRAINT financial_payments_appointment_fkey FOREIGN KEY (appointment_id, professional_id)
    REFERENCES appointments (id, professional_id) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT financial_payments_reverses_fkey FOREIGN KEY (reverses_payment_id, professional_id)
    REFERENCES financial_payments (id, professional_id),
  CONSTRAINT financial_payments_kind_check CHECK (kind IN ('recebimento', 'estorno')),
  CONSTRAINT financial_payments_amount_check CHECK (amount_cents > 0),
  CONSTRAINT financial_payments_method_check
    CHECK (method IN ('pix', 'dinheiro', 'cartao_debito', 'cartao_credito', 'outra')),
  CONSTRAINT financial_payments_source_check CHECK (source IN ('manual', 'sinal_pix_confirmado')),
  CONSTRAINT financial_payments_source_kind_check CHECK (source = 'manual' OR kind = 'recebimento'),
  CONSTRAINT financial_payments_reverses_kind_check CHECK (
    (kind = 'recebimento' AND reverses_payment_id IS NULL) OR (kind = 'estorno' AND reverses_payment_id IS NOT NULL)),
  CONSTRAINT financial_payments_notes_check CHECK (notes IS NULL OR char_length(notes) <= 500),
  CONSTRAINT financial_payments_refund_reason_check
    CHECK (kind <> 'estorno' OR (notes IS NOT NULL AND char_length(btrim(notes)) >= 3)),
  CONSTRAINT financial_payments_idempotency_pair_check CHECK ((idempotency_key IS NULL) = (request_hash IS NULL)),
  CONSTRAINT financial_payments_idempotency_key_check
    CHECK (idempotency_key IS NULL OR char_length(idempotency_key) BETWEEN 8 AND 64),
  CONSTRAINT financial_payments_request_hash_check CHECK (request_hash IS NULL OR request_hash ~ '^[0-9a-f]{64}$')
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_financial_payments_idempotency
  ON financial_payments (professional_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_financial_payments_deposit_once
  ON financial_payments (appointment_id) WHERE source = 'sinal_pix_confirmado';
CREATE INDEX IF NOT EXISTS idx_financial_payments_day ON financial_payments (professional_id, occurred_on);
CREATE INDEX IF NOT EXISTS idx_financial_payments_appointment ON financial_payments (appointment_id);
CREATE INDEX IF NOT EXISTS idx_financial_payments_reverses ON financial_payments (reverses_payment_id)
  WHERE reverses_payment_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_financial_payments_append_only ON financial_payments;
CREATE TRIGGER trg_financial_payments_append_only BEFORE UPDATE OR DELETE ON financial_payments
  FOR EACH ROW EXECUTE FUNCTION fin_append_only_guard();

CREATE OR REPLACE FUNCTION fin_payments_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $f$
DECLARE
  v_orig   public.financial_payments%ROWTYPE;
  v_refund integer;
  v_dep    integer;
BEGIN
  IF public.fin_day_is_closed(NEW.professional_id, NEW.occurred_on) THEN
    RAISE EXCEPTION 'financeiro: o dia % está fechado; reabra o caixa ou lance em um dia aberto', NEW.occurred_on
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.kind = 'estorno' THEN
    -- Serializa estornos do mesmo recebimento (não exige UPDATE na tabela: a role da aplicação não o tem).
    PERFORM pg_advisory_xact_lock(hashtextextended('fin_refund:' || NEW.reverses_payment_id::text, 0));
    SELECT * INTO v_orig FROM public.financial_payments
     WHERE id = NEW.reverses_payment_id AND professional_id = NEW.professional_id;
    IF NOT FOUND OR v_orig.kind <> 'recebimento' THEN
      RAISE EXCEPTION 'financeiro: estorno precisa referenciar um recebimento da mesma profissional' USING ERRCODE = 'check_violation';
    END IF;
    IF v_orig.appointment_id <> NEW.appointment_id THEN
      RAISE EXCEPTION 'financeiro: estorno precisa ser do mesmo atendimento do recebimento' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.occurred_on < v_orig.occurred_on THEN
      RAISE EXCEPTION 'financeiro: a data do estorno não pode ser anterior à do recebimento' USING ERRCODE = 'check_violation';
    END IF;
    SELECT COALESCE(SUM(amount_cents), 0) INTO v_refund FROM public.financial_payments
     WHERE reverses_payment_id = NEW.reverses_payment_id AND professional_id = NEW.professional_id;
    IF v_refund + NEW.amount_cents > v_orig.amount_cents THEN
      RAISE EXCEPTION 'financeiro: estornos (% + %) excederiam o recebimento (%)', v_refund, NEW.amount_cents, v_orig.amount_cents
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF NEW.source = 'sinal_pix_confirmado' THEN
    SELECT deposit_cents INTO v_dep FROM public.appointments WHERE id = NEW.appointment_id AND professional_id = NEW.professional_id;
    IF v_dep IS NULL OR v_dep <= 0 THEN
      RAISE EXCEPTION 'financeiro: o atendimento não tem sinal registrado para confirmar' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.amount_cents > v_dep THEN
      RAISE EXCEPTION 'financeiro: o valor (%) excede o sinal registrado (%)', NEW.amount_cents, v_dep USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$f$;

DROP TRIGGER IF EXISTS trg_financial_payments_guard ON financial_payments;
CREATE TRIGGER trg_financial_payments_guard BEFORE INSERT ON financial_payments
  FOR EACH ROW EXECUTE FUNCTION fin_payments_guard();

CREATE OR REPLACE FUNCTION fin_payments_audit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $f$
BEGIN
  PERFORM public.fin_audit(NEW.professional_id, 'payment', NEW.id,
    CASE NEW.kind WHEN 'estorno' THEN 'payment_refund' ELSE 'payment_create' END, NULL,
    jsonb_build_object('appointment_id', NEW.appointment_id, 'kind', NEW.kind, 'amount_cents', NEW.amount_cents,
                       'method', NEW.method, 'occurred_on', NEW.occurred_on, 'source', NEW.source,
                       'reverses_payment_id', NEW.reverses_payment_id),
    CASE NEW.kind WHEN 'estorno' THEN NEW.notes END);
  RETURN NULL;
END
$f$;

DROP TRIGGER IF EXISTS trg_financial_payments_audit ON financial_payments;
CREATE TRIGGER trg_financial_payments_audit AFTER INSERT ON financial_payments
  FOR EACH ROW EXECUTE FUNCTION fin_payments_audit();

-- ── Despesas: dia fechado, correção com motivo e histórico ─────────────────
CREATE OR REPLACE FUNCTION fin_expenses_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $f$
BEGIN
  IF NEW.payment_status = 'paga' AND public.fin_day_is_closed(NEW.professional_id, NEW.paid_on) THEN
    RAISE EXCEPTION 'financeiro: o dia % está fechado; reabra o caixa para registrar este pagamento', NEW.paid_on
      USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.payment_status = 'paga' THEN
    IF NEW.payment_status IS DISTINCT FROM OLD.payment_status OR NEW.paid_on IS DISTINCT FROM OLD.paid_on
       OR NEW.amount_cents IS DISTINCT FROM OLD.amount_cents OR NEW.paid_method IS DISTINCT FROM OLD.paid_method THEN
      IF public.fin_day_is_closed(OLD.professional_id, OLD.paid_on) THEN
        RAISE EXCEPTION 'financeiro: o dia % está fechado; reabra o caixa para corrigir este pagamento', OLD.paid_on
          USING ERRCODE = 'check_violation';
      END IF;
      PERFORM public.fin_require_reason('corrigir uma despesa paga');
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF OLD.payment_status = 'paga' AND public.fin_professional_exists(OLD.professional_id)
       AND public.fin_day_is_closed(OLD.professional_id, OLD.paid_on) THEN
      RAISE EXCEPTION 'financeiro: o dia % está fechado; reabra o caixa para apagar este pagamento', OLD.paid_on
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  RETURN NEW;
END
$f$;

DROP TRIGGER IF EXISTS trg_expenses_fin_guard ON expenses;
CREATE TRIGGER trg_expenses_fin_guard BEFORE INSERT OR UPDATE OR DELETE ON expenses
  FOR EACH ROW EXECUTE FUNCTION fin_expenses_guard();

CREATE OR REPLACE FUNCTION fin_expense_snapshot(e public.expenses) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $f$
  SELECT jsonb_build_object('description', e.description, 'category', e.category, 'amount_cents', e.amount_cents,
    'expense_date', e.expense_date, 'notes', e.notes, 'payment_status', e.payment_status,
    'due_on', e.due_on, 'paid_on', e.paid_on, 'paid_method', e.paid_method)
$f$;

CREATE OR REPLACE FUNCTION fin_expenses_audit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $f$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.fin_audit(NEW.professional_id, 'expense', NEW.id, 'expense_create', NULL, public.fin_expense_snapshot(NEW), NULL);
  ELSIF TG_OP = 'UPDATE' THEN
    IF public.fin_expense_snapshot(OLD) IS DISTINCT FROM public.fin_expense_snapshot(NEW) THEN
      PERFORM public.fin_audit(NEW.professional_id, 'expense', NEW.id,
        CASE WHEN NEW.payment_status IS DISTINCT FROM OLD.payment_status OR NEW.paid_on IS DISTINCT FROM OLD.paid_on
             THEN 'expense_status' ELSE 'expense_update' END,
        public.fin_expense_snapshot(OLD), public.fin_expense_snapshot(NEW), public.fin_audit_reason());
    END IF;
  ELSIF public.fin_professional_exists(OLD.professional_id) THEN   -- exclusão da conta (cascata) não gera histórico
    PERFORM public.fin_audit(OLD.professional_id, 'expense', OLD.id, 'expense_delete', public.fin_expense_snapshot(OLD), NULL, public.fin_audit_reason());
  END IF;
  RETURN NULL;
END
$f$;

DROP TRIGGER IF EXISTS trg_expenses_fin_audit ON expenses;
CREATE TRIGGER trg_expenses_fin_audit AFTER INSERT OR UPDATE OR DELETE ON expenses
  FOR EACH ROW EXECUTE FUNCTION fin_expenses_audit();

-- ── Atendimentos: check-in, valor final e revisão (só quando essas colunas mudam) ──
CREATE OR REPLACE FUNCTION fin_appointments_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $f$
BEGIN
  IF NEW.final_price_cents IS DISTINCT FROM OLD.final_price_cents THEN
    IF OLD.final_price_cents IS NOT NULL THEN PERFORM public.fin_require_reason('corrigir o valor final'); END IF;
    NEW.final_price_set_at := CASE WHEN NEW.final_price_cents IS NULL THEN NULL ELSE now() END;
  END IF;
  IF NEW.checked_in_at IS DISTINCT FROM OLD.checked_in_at AND OLD.checked_in_at IS NOT NULL THEN
    PERFORM public.fin_require_reason('alterar ou desfazer o check-in');
  END IF;
  IF NEW.finance_review IS DISTINCT FROM OLD.finance_review THEN
    IF OLD.finance_review IS NOT NULL THEN PERFORM public.fin_require_reason('alterar uma revisão já feita'); END IF;
    NEW.finance_reviewed_at := CASE WHEN NEW.finance_review IS NULL THEN NULL ELSE now() END;
  END IF;
  RETURN NEW;
END
$f$;

DROP TRIGGER IF EXISTS trg_appointments_fin_guard ON appointments;
CREATE TRIGGER trg_appointments_fin_guard BEFORE UPDATE OF checked_in_at, final_price_cents, final_price_set_at, finance_review, finance_reviewed_at
  ON appointments FOR EACH ROW
  WHEN (OLD.checked_in_at IS DISTINCT FROM NEW.checked_in_at OR OLD.final_price_cents IS DISTINCT FROM NEW.final_price_cents
        OR OLD.final_price_set_at IS DISTINCT FROM NEW.final_price_set_at
        OR OLD.finance_review IS DISTINCT FROM NEW.finance_review OR OLD.finance_reviewed_at IS DISTINCT FROM NEW.finance_reviewed_at)
  EXECUTE FUNCTION fin_appointments_guard();

CREATE OR REPLACE FUNCTION fin_appointments_audit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $f$
BEGIN
  IF NEW.checked_in_at IS DISTINCT FROM OLD.checked_in_at THEN
    PERFORM public.fin_audit(NEW.professional_id, 'appointment', NEW.id, 'appointment_checkin',
      jsonb_build_object('checked_in_at', OLD.checked_in_at), jsonb_build_object('checked_in_at', NEW.checked_in_at), public.fin_audit_reason());
  END IF;
  IF NEW.final_price_cents IS DISTINCT FROM OLD.final_price_cents THEN
    PERFORM public.fin_audit(NEW.professional_id, 'appointment', NEW.id, 'appointment_final_price',
      jsonb_build_object('final_price_cents', OLD.final_price_cents), jsonb_build_object('final_price_cents', NEW.final_price_cents), public.fin_audit_reason());
  END IF;
  IF NEW.finance_review IS DISTINCT FROM OLD.finance_review THEN
    PERFORM public.fin_audit(NEW.professional_id, 'appointment', NEW.id, 'appointment_review',
      jsonb_build_object('finance_review', OLD.finance_review, 'status', OLD.status),
      jsonb_build_object('finance_review', NEW.finance_review, 'status', NEW.status), public.fin_audit_reason());
  END IF;
  RETURN NULL;
END
$f$;

DROP TRIGGER IF EXISTS trg_appointments_fin_audit ON appointments;
CREATE TRIGGER trg_appointments_fin_audit AFTER UPDATE OF checked_in_at, final_price_cents, final_price_set_at, finance_review, finance_reviewed_at
  ON appointments FOR EACH ROW
  WHEN (OLD.checked_in_at IS DISTINCT FROM NEW.checked_in_at OR OLD.final_price_cents IS DISTINCT FROM NEW.final_price_cents
        OR OLD.finance_review IS DISTINCT FROM NEW.finance_review)
  EXECUTE FUNCTION fin_appointments_audit();

-- SECURITY DEFINER: os triggers de histórico, o guarda de pagamentos e a consulta do fechamento rodam com os privilégios do DONO da função
-- (quem aplicou a migration), para que o fluxo EXISTENTE (criar/alterar/apagar despesa, etc.) NÃO quebre caso o
-- GRANT da role da aplicação (_ops/025_grant_app_role.sql) ainda não tenha sido executado. Por isso a execução direta
-- é fechada ao público: ninguém forja histórico chamando fin_audit() nem espia o fechamento de outra profissional.
REVOKE ALL ON FUNCTION fin_audit(uuid, text, uuid, text, jsonb, jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION fin_day_is_closed(uuid, date) FROM PUBLIC;

-- ── Verificação final: confere a estrutura e FALHA (revertendo tudo) se divergir ──
DO $verify$
DECLARE
  r record;
  n integer;
  cols text[][] := ARRAY[
    ['appointments','checked_in_at','timestamp with time zone','YES'],
    ['appointments','final_price_cents','integer','YES'],
    ['appointments','final_price_set_at','timestamp with time zone','YES'],
    ['appointments','finance_review','character varying','YES'],
    ['appointments','finance_reviewed_at','timestamp with time zone','YES'],
    ['expenses','payment_status','character varying','NO'],
    ['expenses','due_on','date','YES'],
    ['expenses','paid_on','date','YES'],
    ['expenses','paid_method','character varying','YES'],
    ['financial_payments','professional_id','uuid','NO'],
    ['financial_payments','appointment_id','uuid','NO'],
    ['financial_payments','kind','character varying','NO'],
    ['financial_payments','amount_cents','integer','NO'],
    ['financial_payments','method','character varying','NO'],
    ['financial_payments','occurred_on','date','NO'],
    ['financial_payments','reverses_payment_id','uuid','YES'],
    ['financial_payments','idempotency_key','character varying','YES'],
    ['financial_audit_log','professional_id','uuid','NO'],
    ['financial_audit_log','entity_id','uuid','NO'],
    ['financial_audit_log','before_data','jsonb','YES'],
    ['cash_closings','professional_id','uuid','NO'],
    ['cash_closings','closing_date','date','NO'],
    ['cash_closings','status','character varying','NO']
  ];
  cons text[] := ARRAY[
    'appointments_final_price_check','appointments_final_price_pair_check','appointments_finance_review_check',
    'appointments_finance_review_pair_check','appointments_id_professional_id_key',
    'expenses_payment_status_check','expenses_payment_state_check','expenses_paid_method_check',
    'financial_payments_appointment_fkey','financial_payments_reverses_fkey','financial_payments_professional_fkey',
    'financial_payments_id_professional_id_key','financial_payments_reverses_kind_check','financial_payments_refund_reason_check',
    'financial_audit_log_professional_fkey','financial_audit_log_reason_required_check','financial_audit_log_action_check',
    'cash_closings_professional_fkey','cash_closings_day_key','cash_closings_reopened_check'];
  trg text[][] := ARRAY[
    ['financial_payments','trg_financial_payments_append_only'],['financial_payments','trg_financial_payments_guard'],
    ['financial_payments','trg_financial_payments_audit'],['financial_audit_log','trg_financial_audit_log_append_only'],
    ['cash_closings','trg_cash_closings_guard'],['cash_closings','trg_cash_closings_audit'],
    ['expenses','trg_expenses_fin_guard'],['expenses','trg_expenses_fin_audit'],
    ['appointments','trg_appointments_fin_guard'],['appointments','trg_appointments_fin_audit']];
  idx text[] := ARRAY['uq_financial_payments_idempotency','uq_financial_payments_deposit_once','idx_financial_payments_day',
    'idx_financial_audit_entity','idx_expenses_pending','idx_expenses_paid_on','idx_appointments_finance_review_pending'];
  i integer;
BEGIN
  FOR i IN 1 .. array_length(cols, 1) LOOP
    SELECT data_type, is_nullable INTO r FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = cols[i][1] AND column_name = cols[i][2];
    IF NOT FOUND OR r.data_type <> cols[i][3] OR r.is_nullable <> cols[i][4] THEN
      RAISE EXCEPTION 'migration 025: coluna %.% divergente (esperado % / nulável %)', cols[i][1], cols[i][2], cols[i][3], cols[i][4];
    END IF;
  END LOOP;
  FOR i IN 1 .. array_length(cons, 1) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = cons[i] AND convalidated) THEN
      RAISE EXCEPTION 'migration 025: constraint % ausente ou não validada', cons[i];
    END IF;
  END LOOP;
  FOR i IN 1 .. array_length(trg, 1) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = trg[i][2] AND tgrelid = ('public.' || trg[i][1])::regclass AND NOT tgisinternal) THEN
      RAISE EXCEPTION 'migration 025: trigger % ausente em %', trg[i][2], trg[i][1];
    END IF;
  END LOOP;
  FOR i IN 1 .. array_length(idx, 1) LOOP
    IF to_regclass('public.' || idx[i]) IS NULL THEN RAISE EXCEPTION 'migration 025: índice % ausente', idx[i]; END IF;
  END LOOP;
  -- FK de pagamento para atendimento: composta, adiada e sem cascata (NO ACTION).
  SELECT count(*) INTO n FROM pg_constraint
   WHERE conname = 'financial_payments_appointment_fkey' AND condeferrable AND condeferred AND confdeltype = 'a';
  IF n <> 1 THEN RAISE EXCEPTION 'migration 025: financial_payments_appointment_fkey deveria ser DEFERRABLE INITIALLY DEFERRED sem cascata'; END IF;
  -- CASCADE somente nas FKs para professionals.
  SELECT count(*) INTO n FROM pg_constraint
   WHERE conname IN ('financial_payments_professional_fkey','financial_audit_log_professional_fkey','cash_closings_professional_fkey')
     AND confdeltype = 'c';
  IF n <> 3 THEN RAISE EXCEPTION 'migration 025: as FKs para professionals deveriam ser ON DELETE CASCADE'; END IF;
  -- Funções com search_path fixo.
  FOR r IN SELECT p.proname FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
            WHERE ns.nspname = 'public' AND p.proname LIKE 'fin\_%'
              AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, '{}')) c WHERE c = 'search_path=pg_catalog, pg_temp') LOOP
    RAISE EXCEPTION 'migration 025: função % sem search_path = pg_catalog, pg_temp', r.proname;
  END LOOP;
  -- Funções SECURITY DEFINER esperadas e fechadas ao público.
  FOR r IN SELECT p.proname FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
            AND p.proname IN ('fin_audit', 'fin_day_is_closed') AND (NOT p.prosecdef OR has_function_privilege('public', p.oid, 'EXECUTE')) LOOP
    RAISE EXCEPTION 'migration 025: % deveria ser SECURITY DEFINER e sem EXECUTE para o público', r.proname;
  END LOOP;
  -- Nenhuma linha antiga foi classificada: as colunas novas só podem estar preenchidas por uso posterior.
  -- (Conferido de verdade pelos testes com dados legados; aqui só a invariante estrutural do DEFAULT.)
  IF (SELECT column_default FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'expenses' AND column_name = 'payment_status') <> '''a_revisar''::character varying' THEN
    RAISE EXCEPTION 'migration 025: DEFAULT de expenses.payment_status deveria ser a_revisar';
  END IF;
END
$verify$;

COMMIT;
