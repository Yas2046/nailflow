-- Financeiro (etapa 3): limites de recebimento também no BANCO, como defesa em profundidade da API (etapa 2).
--  1) trg_financial_payments_cap: um recebimento não pode fazer o LÍQUIDO (recebimentos - estornos) passar do valor do serviço
--     (valor final quando existe; senão o preço registrado). Vale para qualquer escritor (API, SQL manual, rota futura).
--  2) trg_appointments_fin_value_floor: o valor do atendimento (final_price_cents / price_cents_snapshot) não pode ficar abaixo
--     do líquido já recebido.
-- NÃO substitui nem reescreve nada da 025: são DOIS gatilhos NOVOS e independentes (a função fin_payments_guard e o resto da 025
-- ficam como estão), então o rollback é só remover os dois. Aditiva, idempotente e transacional; depende da 025.
-- Serialização: ambos tomam o MESMO advisory lock por atendimento da API ('fin_pay:'||id), reentrante na transação; assim
-- recebimentos e mudanças de valor simultâneos, mesmo por SQL direto, não se atravessam.
-- SECURITY DEFINER + search_path = pg_catalog, pg_temp + objetos qualificados (mesmo padrão e motivo da 025): o gatilho de
-- appointments roda no fluxo atual da Agenda e não pode depender de grants que ainda não foram aplicados.
-- Compatibilidade: dados já gravados não são revisados (só INSERT de recebimento e UPDATE do valor são checados).
-- Limite conhecido: dois escritores que NÃO passam pela API e trocam a ordem de trava (linha de appointments x advisory lock)
-- podem se travar entre si; o PostgreSQL detecta e aborta um deles (40P01), sem corromper nada.

BEGIN;

SET LOCAL lock_timeout = '3s';

DO $pre$
BEGIN
  IF to_regclass('public.financial_payments') IS NULL OR to_regprocedure('public.fin_payments_guard()') IS NULL THEN
    RAISE EXCEPTION 'migration 027: a migration 025 precisa estar aplicada';
  END IF;
END
$pre$;

CREATE OR REPLACE FUNCTION fin_payments_cap_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $f$
DECLARE
  v_value integer;
  v_net   bigint;
BEGIN
  IF NEW.kind <> 'recebimento' THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('fin_pay:' || NEW.appointment_id::text, 0));
  SELECT COALESCE(final_price_cents, price_cents_snapshot) INTO v_value
    FROM public.appointments WHERE id = NEW.appointment_id AND professional_id = NEW.professional_id;
  IF v_value IS NULL THEN RETURN NEW; END IF;      -- atendimento inexistente: a FK composta (adiada) recusa
  SELECT COALESCE(SUM(CASE WHEN kind = 'recebimento' THEN amount_cents ELSE -amount_cents END), 0) INTO v_net
    FROM public.financial_payments WHERE appointment_id = NEW.appointment_id AND professional_id = NEW.professional_id;
  IF v_net + NEW.amount_cents > v_value THEN
    RAISE EXCEPTION 'financeiro: o total recebido (% + %) excederia o valor do serviço (%)', v_net, NEW.amount_cents, v_value
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$f$;

DROP TRIGGER IF EXISTS trg_financial_payments_cap ON public.financial_payments;
CREATE TRIGGER trg_financial_payments_cap BEFORE INSERT ON public.financial_payments
  FOR EACH ROW EXECUTE FUNCTION fin_payments_cap_guard();

CREATE OR REPLACE FUNCTION fin_appointments_value_floor() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $f$
DECLARE
  v_value integer := COALESCE(NEW.final_price_cents, NEW.price_cents_snapshot);
  v_net   bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('fin_pay:' || NEW.id::text, 0));
  SELECT COALESCE(SUM(CASE WHEN kind = 'recebimento' THEN amount_cents ELSE -amount_cents END), 0) INTO v_net
    FROM public.financial_payments WHERE appointment_id = NEW.id AND professional_id = NEW.professional_id;
  IF v_net > v_value THEN
    RAISE EXCEPTION 'financeiro: o valor do serviço (%) ficaria abaixo do líquido já recebido (%)', v_value, v_net
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$f$;

DROP TRIGGER IF EXISTS trg_appointments_fin_value_floor ON public.appointments;
CREATE TRIGGER trg_appointments_fin_value_floor BEFORE UPDATE OF final_price_cents, price_cents_snapshot ON public.appointments
  FOR EACH ROW
  WHEN (OLD.final_price_cents IS DISTINCT FROM NEW.final_price_cents OR OLD.price_cents_snapshot IS DISTINCT FROM NEW.price_cents_snapshot)
  EXECUTE FUNCTION fin_appointments_value_floor();

DO $verify$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT p.proname FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
            AND p.proname IN ('fin_payments_cap_guard', 'fin_appointments_value_floor')
            AND (NOT p.prosecdef OR NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, '{}')) c WHERE c = 'search_path=pg_catalog, pg_temp')) LOOP
    RAISE EXCEPTION 'migration 027: % deveria ser SECURITY DEFINER com search_path = pg_catalog, pg_temp', r.proname;
  END LOOP;
  IF (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgname IN ('trg_financial_payments_cap', 'trg_appointments_fin_value_floor')) <> 2 THEN
    RAISE EXCEPTION 'migration 027: gatilhos ausentes';
  END IF;
END
$verify$;

COMMIT;
