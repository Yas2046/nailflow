-- Financeiro (etapa 5): fechamento de caixa com valores esperados/contados por método.
-- POR QUE UMA MIGRATION: cash_closings (025) guarda só três totais do dia. O fechamento pedido precisa, por método de pagamento, do valor
-- esperado, do contado, da diferença e da justificativa, preservados a cada fechamento (inclusive depois de reabrir e fechar de novo).
-- Esta migration NÃO reescreve a 025..028: acrescenta (a) UNIQUE (id, professional_id) em cash_closings (alvo da FK composta, padrão 017/025/028),
-- (b) a tabela append-only cash_closing_entries (uma linha por método e por fechamento; "version" = reopen_count do dia no fechamento) e
-- (c) um ÚNICO ajuste de função existente: fin_day_is_closed passa a tomar um advisory lock COMPARTILHADO do dia ('fin_day:<prof>:<dia>').
-- O fechamento toma o mesmo lock em modo EXCLUSIVO: espera as movimentações em curso do dia terminarem, calcula os totais e fecha; quem tenta
-- lançar depois enxerga o dia fechado. Sem isso, um recebimento concorrente poderia ficar fora dos totais congelados. O corpo da função (a regra de
-- "dia fechado") é idêntico ao da 025; o rollback restaura a função original.
-- Regras no banco: o lançamento só entra com o dia FECHADO e na versão atual; diferença diferente de zero exige justificativa; métodos fixos.
-- Os valores esperados NÃO são recalculados pelo banco (como já era nos totais da 025): vêm da API, calculados sob o lock do dia.
-- Nada é migrado: fechamentos existentes ficam sem entradas por método (anteriores a esta etapa). Aplicar como a dona das tabelas, depois da 028.
BEGIN;

SET LOCAL lock_timeout = '3s';

DO $pre$
BEGIN
  IF to_regclass('public.cash_closings') IS NULL OR to_regclass('public.expense_payments') IS NULL
     OR to_regprocedure('public.fin_append_only_guard()') IS NULL OR to_regprocedure('public.fin_day_is_closed(uuid, date)') IS NULL THEN
    RAISE EXCEPTION 'migration 029: as migrations 025 e 028 precisam estar aplicadas';
  END IF;
END
$pre$;

DO $c$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cash_closings_id_professional_id_key' AND conrelid = 'public.cash_closings'::regclass) THEN
    ALTER TABLE public.cash_closings ADD CONSTRAINT cash_closings_id_professional_id_key UNIQUE (id, professional_id);
  END IF;
END
$c$;

CREATE TABLE IF NOT EXISTS public.cash_closing_entries (
  id               uuid         NOT NULL DEFAULT gen_random_uuid(),
  professional_id  uuid         NOT NULL,
  closing_id       uuid         NOT NULL,
  version          integer      NOT NULL,
  method           varchar(20)  NOT NULL,
  expected_cents   integer      NOT NULL,
  counted_cents    integer      NOT NULL,
  difference_cents integer      NOT NULL,
  justification    text,
  closed_by        uuid,
  created_at       timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT cash_closing_entries_pkey PRIMARY KEY (id),
  CONSTRAINT cash_closing_entries_professional_fkey FOREIGN KEY (professional_id) REFERENCES public.professionals(id) ON DELETE CASCADE,
  CONSTRAINT cash_closing_entries_closing_fkey FOREIGN KEY (closing_id, professional_id)
    REFERENCES public.cash_closings (id, professional_id) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT cash_closing_entries_version_key UNIQUE (closing_id, version, method),
  CONSTRAINT cash_closing_entries_version_check CHECK (version >= 0),
  CONSTRAINT cash_closing_entries_method_check CHECK (method IN ('pix', 'dinheiro', 'cartao_debito', 'cartao_credito', 'transferencia', 'outra')),
  CONSTRAINT cash_closing_entries_counted_check CHECK (counted_cents >= 0),
  CONSTRAINT cash_closing_entries_difference_check CHECK (difference_cents = counted_cents - expected_cents),
  CONSTRAINT cash_closing_entries_justification_check CHECK (
    (justification IS NULL OR char_length(btrim(justification)) BETWEEN 3 AND 500)
    AND (difference_cents = 0 OR justification IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_cash_closing_entries_closing ON public.cash_closing_entries (closing_id, version);

DROP TRIGGER IF EXISTS trg_cash_closing_entries_append_only ON public.cash_closing_entries;
CREATE TRIGGER trg_cash_closing_entries_append_only BEFORE UPDATE OR DELETE ON public.cash_closing_entries
  FOR EACH ROW EXECUTE FUNCTION fin_append_only_guard();

-- Só entra lançamento de um dia FECHADO, na versão do fechamento atual (reopen_count): o histórico de versões anteriores é preservado.
CREATE OR REPLACE FUNCTION fin_cash_closing_entries_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $f$
DECLARE
  v public.cash_closings%ROWTYPE;
BEGIN
  SELECT * INTO v FROM public.cash_closings WHERE id = NEW.closing_id AND professional_id = NEW.professional_id;
  IF NOT FOUND OR v.status <> 'fechado' OR v.reopen_count <> NEW.version THEN
    RAISE EXCEPTION 'cash_closing_entries: o fechamento precisa estar fechado e na versão %', NEW.version USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$f$;
DROP TRIGGER IF EXISTS trg_cash_closing_entries_guard ON public.cash_closing_entries;
CREATE TRIGGER trg_cash_closing_entries_guard BEFORE INSERT ON public.cash_closing_entries
  FOR EACH ROW EXECUTE FUNCTION fin_cash_closing_entries_guard();

-- Única função existente alterada: mesmo resultado da 025, mais o lock compartilhado do dia.
CREATE OR REPLACE FUNCTION fin_day_is_closed(p_prof uuid, p_day date) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $f$
BEGIN
  IF p_day IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock_shared(hashtextextended('fin_day:' || p_prof::text || ':' || p_day::text, 0));
  END IF;
  RETURN p_day IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.cash_closings WHERE professional_id = p_prof AND closing_date = p_day AND status = 'fechado');
END
$f$;

DO $verify$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.proname = 'fin_cash_closing_entries_guard' AND p.prosecdef
       AND EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, '{}')) c WHERE c = 'search_path=pg_catalog, pg_temp')) THEN
    RAISE EXCEPTION 'migration 029: fin_cash_closing_entries_guard deveria ser SECURITY DEFINER com search_path fixo';
  END IF;
  IF (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgname IN ('trg_cash_closing_entries_append_only', 'trg_cash_closing_entries_guard')) <> 2 THEN
    RAISE EXCEPTION 'migration 029: gatilhos ausentes';
  END IF;
  IF has_function_privilege('public', 'public.fin_day_is_closed(uuid, date)', 'EXECUTE') THEN
    RAISE EXCEPTION 'migration 029: fin_day_is_closed não deve ser executável por PUBLIC';
  END IF;
END
$verify$;

COMMIT;
