-- Rollback da migration 029. NÃO apaga fechamento: se existir qualquer cash_closing_entries (append-only), ABORTA sem alterar nada.
-- Sem uso: remove tabela, gatilhos, função e a UNIQUE de cash_closings, e restaura fin_day_is_closed ao corpo da 025 (sem o lock do dia).
-- Pare a API antes. Idempotente. O rollback da 025 também EXIGE que a 029 já tenha sido revertida.
BEGIN;

SET LOCAL lock_timeout = '3s';

DO $down$
DECLARE
  v_n bigint := 0;
BEGIN
  IF to_regclass('public.cash_closing_entries') IS NOT NULL THEN
    LOCK TABLE public.cash_closing_entries IN ACCESS EXCLUSIVE MODE;
    SELECT count(*) INTO v_n FROM public.cash_closing_entries;
  END IF;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'rollback 029 abortado: há % lançamento(s) de fechamento por método (append-only). Nada foi alterado.', v_n;
  END IF;
END
$down$;

DROP TABLE IF EXISTS public.cash_closing_entries;
DROP FUNCTION IF EXISTS public.fin_cash_closing_entries_guard();
ALTER TABLE public.cash_closings DROP CONSTRAINT IF EXISTS cash_closings_id_professional_id_key;

CREATE OR REPLACE FUNCTION fin_day_is_closed(p_prof uuid, p_day date) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $f$
BEGIN
  RETURN p_day IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.cash_closings WHERE professional_id = p_prof AND closing_date = p_day AND status = 'fechado');
END
$f$;

COMMIT;
