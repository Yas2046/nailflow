-- Reversão da carga inicial da FAQ (support_faq_initial.sql). NÃO é executada por nenhum processo (pasta _ops).
--
-- COMO EXECUTAR (produção, como postgres, pelo socket; o root entrega o arquivo por entrada padrão):
--   sudo -u postgres psql -d nailflow -X -v ON_ERROR_STOP=1 < backend/db/migrations/_ops/support_faq_initial_revert.sql
-- Opcional: -v forcar_editados=on  (apaga também os artigos do lote que foram EDITADOS depois da carga; padrão: off).
--
-- O QUE FAZ
--  * Apaga SOMENTE as linhas de support_faq_articles cujo id é um dos 12 ids fixos da carga (listados em
--    support_faq_initial.sql). Artigos criados pela tela do ADM ou por outro meio têm outros ids e NUNCA são tocados,
--    mesmo que tenham o mesmo título. Não toca em chamados, mensagens, eventos, categorias, contas nem na auditoria.
--  * PROTEÇÃO CONTRA PERDA DE EDIÇÕES: antes de apagar, compara título+texto+categoria de cada artigo do lote com o
--    original (md5). Se algum foi editado pela tela depois da carga, ABORTA sem apagar nada e informa quantos; só
--    apaga mesmo assim com -v forcar_editados=on. Mudar posição ou publicar/despublicar não conta como edição.
--  * Idempotente: sem artigos do lote no banco, não apaga nada. UMA transação com lock_timeout de 5 s. Só contagens.

\set ON_ERROR_STOP on
\encoding UTF8
\if :{?forcar_editados}
\else
  \set forcar_editados off
\endif

BEGIN;
SET LOCAL lock_timeout = '5s';

SELECT set_config('nf_faq.forcar', :'forcar_editados', true) AS p1 \gset _

CREATE TEMP TABLE nf_faq_lote (id uuid PRIMARY KEY, category_slug text NOT NULL, content_md5 text NOT NULL) ON COMMIT DROP;
INSERT INTO nf_faq_lote (id, category_slug, content_md5) VALUES
  ('df00d914-5ef7-4b07-9a7d-92a6939d38ea'::uuid, 'agenda', '40788d27216e3eaaa80fc417ac7039f3'),
  ('8c1d78d4-b229-4c9d-b4c1-0da28a028df0'::uuid, 'agenda', 'e666c74183ed4949fb4359261906d8ff'),
  ('90e98ccb-320e-43ff-affe-e81cb7a4e8a4'::uuid, 'agenda', '003effe77ae16264c8fce7ccc6746792'),
  ('bb0c2da7-4fa8-4552-b95f-7fb075e73972'::uuid, 'agenda', '24cb528793b74eadac3893b78297802c'),
  ('da37ea08-d1f6-48a5-8026-da5b6098bdec'::uuid, 'clientes', 'ea9b042e9d96d01495f606a618697aa5'),
  ('0c1fdf53-7506-4b58-8f0c-07b26b352b43'::uuid, 'servicos_config', '82ea8404a593e9627ef9ef56c83818a7'),
  ('2925a07f-6f24-495d-afb9-b768a1bdcc12'::uuid, 'servicos_config', '28c192c0e09de261b7d3575faa51516d'),
  ('100d6a4e-b426-4f98-b6fc-c260bd6dd096'::uuid, 'servicos_config', '8a907913c11df4dfba40c5df4152b3c2'),
  ('72165606-6d30-4ef3-a698-494c6f00533d'::uuid, 'perfil_acesso', '39589aa2f7d965daaf2d4985bb5ee8b1'),
  ('2a9aa172-e66d-4f4b-bb4c-6f6903908c00'::uuid, 'financeiro', 'a1219ceaffe10abbb17d14b05d0d22dd'),
  ('bd3090f7-8b28-44f5-bcd5-776db5bb5a29'::uuid, 'tecnico', '5e169e959cd8a9458a2dcf5a684b007c'),
  ('c520c3f8-fa47-4a5c-8619-837da90ef807'::uuid, 'tecnico', '7fb0c86e559a44f8c0c88959d72b5869');

DO $v$
DECLARE
  editados integer;
BEGIN
  IF current_setting('nf_faq.forcar') NOT IN ('on', 'off', 'true', 'false', '1', '0') THEN
    RAISE EXCEPTION 'forcar_editados deve ser on, off, true, false, 1 ou 0; recebido "%"', current_setting('nf_faq.forcar');
  END IF;
  IF to_regclass('public.support_faq_articles') IS NULL THEN
    RAISE EXCEPTION 'support_faq_articles não existe neste banco';
  END IF;
  SELECT count(*) INTO editados
    FROM support_faq_articles a JOIN nf_faq_lote l ON l.id = a.id
   WHERE md5(a.title || chr(10) || a.body) <> l.content_md5 OR a.category_slug <> l.category_slug;
  IF editados > 0 AND current_setting('nf_faq.forcar') IN ('off', 'false', '0') THEN
    RAISE EXCEPTION '% artigo(s) do lote foram editados depois da carga; NADA foi apagado. Para apagar mesmo assim: -v forcar_editados=on', editados;
  END IF;
END $v$;

SELECT current_database() AS banco,
       (SELECT count(*) FROM support_faq_articles) AS artigos_no_banco_antes,
       (SELECT count(*) FROM support_faq_articles a JOIN nf_faq_lote l ON l.id = a.id) AS do_lote_a_apagar,
       (SELECT count(*) FROM support_faq_articles a WHERE a.id NOT IN (SELECT id FROM nf_faq_lote)) AS de_outras_origens_preservados;

WITH apagados AS (
  DELETE FROM support_faq_articles WHERE id IN (SELECT id FROM nf_faq_lote) RETURNING 1
)
SELECT count(*) AS artigos_apagados FROM apagados;

SELECT (SELECT count(*) FROM support_faq_articles) AS artigos_no_banco_agora;

COMMIT;
