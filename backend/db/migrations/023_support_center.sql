-- Central de Ajuda e Suporte -- modelo de dados (V1).
-- Aditiva, idempotente e transacional. Só altera professionals (1 coluna com DEFAULT constante,
-- sem reescrever a tabela no PostgreSQL >= 11). Rollback: db/migrations/_rollback/ (ver README).
--
-- APLICAÇÃO SEGURA
--  * SET LOCAL lock_timeout: a migration toma locks fortes em professionals (que o requireAuth lê
--    a cada requisição). Se não conseguir o lock em 3 s, ABORTA em vez de formar fila atrás de uma
--    transação longa. Reexecute em horário calmo.
--  * O ALTER TABLE professionals (ACCESS EXCLUSIVE) é o ÚLTIMO comando, para segurar esse lock o
--    mínimo possível antes do COMMIT.
--  * "IF NOT EXISTS" pula objetos que já existem, mesmo divergentes. Por isso o bloco final
--    "verificação" confere colunas, tipos, constraints, índices, triggers e funções essenciais e
--    FALHA com mensagem clara se o schema não for o esperado (a transação inteira é revertida).
--
-- ESTRATÉGIA DE SEQUÊNCIA E LEITURA (sem timestamps)
-- "Não lida" não é decidida por horário (now() é o início da transação, não o commit) nem por uma
-- sequence global (nextval é atribuído antes do commit: a ordem dos números não é a de visibilidade).
-- A ordem é um contador POR SOLICITAÇÃO, support_tickets.activity_seq, em três passos:
--   1. BEFORE INSERT em support_messages/support_ticket_events: valida a autoria, TRAVA a linha do
--      ticket (FOR NO KEY UPDATE, mantido até o COMMIT) e propõe NEW.seq = activity_seq + 1.
--      NÃO escreve nada: se a linha acabar descartada (INSERT ... ON CONFLICT DO NOTHING), nenhum
--      contador muda.
--   2. AFTER INSERT (só dispara para linhas realmente inseridas): avança activity_seq em 1.
--   3. BEFORE UPDATE em support_tickets: só aceita avançar activity_seq em +1 quando existe a
--      mensagem/evento com esse seq, e DERIVA last_seq/last_actor/last_activity_at dessa linha.
-- O lock do passo 1 serializa as atividades do mesmo ticket: se um leitor enxerga o seq N, N já foi
-- confirmado; atividade concorrente ainda não confirmada só recebe N+1 depois de esperar o lock.
--   activity_seq : contador de TODA atividade registrada (mensagens e eventos)
--   last_seq     : seq da última atividade que notifica a outra parte  (derivado)
--   last_actor   : quem a executou ('professional' | 'admin')           (derivado)
--   prof_read_seq / admin_read_seq : cursores de leitura de cada lado (só crescem)
--   Não lida p/ a profissional: last_actor = 'admin'        AND last_seq > prof_read_seq
--   Não lida p/ o ADM        : last_actor = 'professional'  AND last_seq > admin_read_seq
-- Prioridade e eventos do sistema consomem seq mas NÃO notificam.
--
-- CONTRATO DE INSERÇÃO (a API deve respeitar)
--  * UMA atividade (mensagem OU evento) por comando INSERT, por ticket. Várias linhas no mesmo comando
--    recebem o mesmo seq e colidem. O resultado depende do ON CONFLICT:
--      - INSERT simples, ou ON CONFLICT COM alvo explícito: erro 23505 (em support_messages:
--        support_messages_ticket_seq_key; em support_ticket_events: support_ticket_events_ticket_seq_key).
--      - "ON CONFLICT DO NOTHING" SEM ALVO: a linha que colide é DESCARTADA EM SILÊNCIO, sem erro
--        (a mensagem se perde).
--  * Todo ON CONFLICT deve informar o ALVO explícito, repetindo o predicado do índice parcial:
--      mensagem:  ON CONFLICT (ticket_id, client_message_id) WHERE client_message_id IS NOT NULL DO NOTHING
--      ticket:    ON CONFLICT (professional_id, client_request_id) WHERE client_request_id IS NOT NULL DO NOTHING
--      'created': ON CONFLICT (ticket_id) WHERE type = 'created' DO NOTHING
--    Com alvo, qualquer outra colisão (inclusive de seq) continua sendo erro, e o conflito legítimo
--    (retry com o mesmo identificador) não altera contador, last_actor nem histórico.
--  * Se o comando não devolver linha (conflito), a API deve ler o registro existente e comparar
--    request_hash: igual devolve o existente; diferente é conflito de idempotência (409).
--  * Limitações OBSERVADAS (não são garantias gerais; evidências e lacunas em "COBERTURA" abaixo):
--      - ON CONFLICT DO NOTHING sem alvo com várias linhas num só INSERT: observado descartar linhas em
--        silêncio (demonstrado com VALUES de 2 linhas em support_messages).
--      - Mensagem e evento gravados no mesmo CTE/comando: observado, uma vez, falhar com "sequência de
--        atividade fora de ordem" (SQL manual em transação revertida; sem teste). Use um INSERT por atividade.
--
-- COBERTURA AUTOMATIZADA DESTE CONTRATO (tests/support-migrations.test.js). Os testes só rodam em banco
-- descartável, e a guarda do teste prova isso de forma LÓGICA (opt-in, host de loopback, nome nf_*_test,
-- cluster só com bancos nf_*_test e marcador no banco), NÃO de forma FÍSICA; ver o cabeçalho do teste.
--  COBERTO POR TESTE AUTOMATIZADO:
--    - SOMENTE EM support_messages, VALUES com 2 linhas para o mesmo ticket: com ON CONFLICT DO NOTHING sem
--      alvo grava 1 linha e perde a outra sem erro; com alvo explícito, ou sem ON CONFLICT, dá 23505 e nada
--      é gravado
--      (testes "contrato da API: INSERT com várias linhas + ON CONFLICT DO NOTHING sem alvo..." e
--      "A1: INSERT com várias linhas para o mesmo ticket falha por completo").
--    - Os três alvos acima funcionam e um retry com o mesmo identificador não altera contador, last_actor
--      nem histórico (testes "A1: mensagem duplicada...", "A1: criação de ticket e evento created..." e o
--      item (d) do teste do contrato).
--  NÃO COBERTO POR TESTE AUTOMATIZADO (não há proteção contra regressão):
--    - CTE gravando mensagem e evento no mesmo comando: foi apenas DEMONSTRADO EXPERIMENTALMENTE, uma vez,
--      na auditoria (SQL manual em transação revertida, não versionado): falha com "sequência de atividade
--      fora de ordem".
--    - INSERT ... SELECT com várias linhas: apenas INFERIDO do mesmo mecanismo; nem demonstrado.
--    - VALUES com várias linhas em support_ticket_events (constraint support_ticket_events_ticket_seq_key):
--      mesmo mecanismo das mensagens, mas sem teste; o evento 'created' só tem teste de retry (com e sem alvo).
--    - A comparação de request_hash e o 409: responsabilidade da API; nenhum teste de banco a cobre.
--
-- LIMITES DO BLOCO DE VERIFICAÇÃO FINAL ($verify$, mais abaixo)
-- Ele só confere o que está listado nele (colunas, tipos e nulidade; constraints por existência, tipo, validade
-- e trechos da definição; índices por trecho; triggers; funções com search_path fixo; seed das categorias).
-- NÃO prova que o schema pré-existente seja idêntico ao desta migration: não garante, por exemplo, todos os
-- defaults, as opções ON UPDATE/DEFERRABLE das FKs nem a ausência de triggers extras.
--
-- O QUE O BANCO GARANTE E O QUE NÃO GARANTE
-- Garante, contra bugs ou erros de uso da API com o papel de runtime: isolamento entre profissionais
-- (FKs compostas), contadores que só avançam +1 com uma atividade real, last_* derivados, ticket novo
-- sempre zerado, titularidade/identidade imutáveis, mensagens/eventos imutáveis, autoria coerente
-- com o papel declarado no momento da gravação.
-- NÃO garante: nada disto vale contra uma aplicação comprometida. O papel de runtime é DONO das
-- tabelas e das funções e pode desabilitar triggers (ALTER TABLE ... DISABLE TRIGGER), alterar ou
-- remover constraints. Também NÃO impede, e fica a cargo da API: escopo de leitura por conta,
-- transições de status e janela de 7 dias, limite de solicitações abertas, hash de idempotência
-- (409), e limitar o cursor de leitura ao maior seq efetivamente exibido.

BEGIN;

SET LOCAL lock_timeout = '3s';

-- ── FAQ ─────────────────────────────────────────────────────────────────────
-- Seis categorias fixas na V1 (o CHECK impede criar categorias fora desta lista).
CREATE TABLE IF NOT EXISTS support_faq_categories (
  slug      text     NOT NULL,
  title     text     NOT NULL,
  position  smallint NOT NULL,
  CONSTRAINT support_faq_categories_pkey PRIMARY KEY (slug),
  CONSTRAINT support_faq_categories_slug_check
    CHECK (slug IN ('agenda', 'clientes', 'servicos_config', 'perfil_acesso', 'financeiro', 'tecnico')),
  CONSTRAINT support_faq_categories_title_check CHECK (char_length(title) <= 80 AND char_length(regexp_replace(title, '^[[:space:]]+|[[:space:]]+$', '', 'g')) >= 1),
  CONSTRAINT support_faq_categories_position_key UNIQUE (position)
);

INSERT INTO support_faq_categories (slug, title, position) VALUES
  ('agenda',          'Agenda',                    1),
  ('clientes',        'Clientes',                  2),
  ('servicos_config', 'Serviços e configurações',  3),
  ('perfil_acesso',   'Perfil e acesso',           4),
  ('financeiro',      'Financeiro',                5),
  ('tecnico',         'Técnico',                   6)
ON CONFLICT (slug) DO NOTHING;

-- title <= 120: o título vira admin_audit_log.target_business_name (varchar(120)) nas ações faq_*.
CREATE TABLE IF NOT EXISTS support_faq_articles (
  id            uuid        NOT NULL DEFAULT gen_random_uuid(),
  category_slug text        NOT NULL,
  title         text        NOT NULL,
  body          text        NOT NULL,
  position      integer     NOT NULL DEFAULT 0,
  status        text        NOT NULL DEFAULT 'rascunho',
  published_at  timestamptz,
  created_by    uuid,
  updated_by    uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT support_faq_articles_pkey PRIMARY KEY (id),
  CONSTRAINT support_faq_articles_category_fkey FOREIGN KEY (category_slug) REFERENCES support_faq_categories (slug),
  CONSTRAINT support_faq_articles_created_by_fkey FOREIGN KEY (created_by) REFERENCES professionals (id) ON DELETE SET NULL,
  CONSTRAINT support_faq_articles_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES professionals (id) ON DELETE SET NULL,
  CONSTRAINT support_faq_articles_title_check CHECK (char_length(title) <= 120 AND char_length(regexp_replace(title, '^[[:space:]]+|[[:space:]]+$', '', 'g')) >= 3),
  CONSTRAINT support_faq_articles_body_check CHECK (char_length(body) <= 8000 AND body ~ '[^[:space:]]'),
  CONSTRAINT support_faq_articles_status_check CHECK (status IN ('rascunho', 'publicado')),
  CONSTRAINT support_faq_articles_published_at_check CHECK ((status = 'publicado') = (published_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_support_faq_articles_list
  ON support_faq_articles (status, category_slug, position);

-- ── Solicitações ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS support_tickets (
  id                 uuid        NOT NULL DEFAULT gen_random_uuid(),
  ticket_number      bigint      GENERATED ALWAYS AS IDENTITY,   -- exibição (#0142); pode ter lacunas
  professional_id    uuid        NOT NULL,
  category           text        NOT NULL,
  subject            text        NOT NULL,
  status             text        NOT NULL DEFAULT 'aberta',
  priority           text        NOT NULL DEFAULT 'media',
  priority_source    text        NOT NULL DEFAULT 'auto',
  related_ticket_id  uuid,                                       -- "citar solicitação anterior" (mesma profissional)
  -- Idempotência da criação: mesmo client_request_id + mesmo request_hash = mesma solicitação;
  -- mesmo id com hash diferente é conflito (a aplicação responde 409).
  client_request_id  uuid,
  request_hash       text,
  -- Atividade e leitura (ver o cabeçalho). activity_seq/last_* são controlados pelos triggers.
  activity_seq       bigint      NOT NULL DEFAULT 0,
  last_seq           bigint      NOT NULL DEFAULT 0,
  last_actor         text        NOT NULL DEFAULT 'professional',
  prof_read_seq      bigint      NOT NULL DEFAULT 0,
  admin_read_seq     bigint      NOT NULL DEFAULT 0,
  last_activity_at   timestamptz NOT NULL DEFAULT now(),        -- só para ordenar listas (derivado)
  resolved_at        timestamptz,
  resolved_by        uuid,
  reopen_count       integer     NOT NULL DEFAULT 0,             -- reaberturas pela profissional
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT support_tickets_pkey PRIMARY KEY (id),
  CONSTRAINT support_tickets_ticket_number_key UNIQUE (ticket_number),
  -- Alvo das FKs compostas (mensagens, eventos, solicitação relacionada).
  CONSTRAINT support_tickets_id_professional_id_key UNIQUE (id, professional_id),
  CONSTRAINT support_tickets_professional_fkey FOREIGN KEY (professional_id) REFERENCES professionals (id) ON DELETE CASCADE,
  CONSTRAINT support_tickets_category_fkey FOREIGN KEY (category) REFERENCES support_faq_categories (slug),
  CONSTRAINT support_tickets_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES professionals (id) ON DELETE SET NULL,
  -- Só a coluna da solicitação relacionada vira NULL (professional_id é NOT NULL e fica). Requer PG >= 15.
  CONSTRAINT support_tickets_related_fkey FOREIGN KEY (related_ticket_id, professional_id)
    REFERENCES support_tickets (id, professional_id) ON DELETE SET NULL (related_ticket_id),
  CONSTRAINT support_tickets_related_not_self_check CHECK (related_ticket_id IS NULL OR related_ticket_id <> id),
  CONSTRAINT support_tickets_subject_check CHECK (char_length(subject) <= 120 AND char_length(regexp_replace(subject, '^[[:space:]]+|[[:space:]]+$', '', 'g')) >= 3),
  CONSTRAINT support_tickets_status_check
    CHECK (status IN ('aberta', 'em_atendimento', 'aguardando_profissional', 'resolvida')),
  CONSTRAINT support_tickets_priority_check CHECK (priority IN ('alta', 'media', 'baixa')),
  CONSTRAINT support_tickets_priority_source_check CHECK (priority_source IN ('auto', 'manual')),
  CONSTRAINT support_tickets_last_actor_check CHECK (last_actor IN ('professional', 'admin')),
  -- Resolvida <=> resolved_at preenchido. Toda saída de 'resolvida' (reabertura da
  -- profissional dentro de 7x24 h, ou do ADM a qualquer momento) precisa zerar
  -- resolved_at e resolved_by no mesmo UPDATE. A janela de 7 dias NÃO é constraint
  -- (depende de now()); fica no domínio transacional, sob SELECT ... FOR UPDATE.
  CONSTRAINT support_tickets_resolved_at_check CHECK ((status = 'resolvida') = (resolved_at IS NOT NULL)),
  CONSTRAINT support_tickets_resolved_by_check CHECK (resolved_by IS NULL OR resolved_at IS NOT NULL),
  CONSTRAINT support_tickets_idempotency_check
    CHECK ((client_request_id IS NULL) = (request_hash IS NULL)
           AND (request_hash IS NULL OR request_hash ~ '^[0-9a-f]{64}$')),
  CONSTRAINT support_tickets_seq_check
    CHECK (activity_seq >= 0 AND last_seq >= 0 AND prof_read_seq >= 0 AND admin_read_seq >= 0
           AND last_seq <= activity_seq AND prof_read_seq <= activity_seq AND admin_read_seq <= activity_seq),
  CONSTRAINT support_tickets_reopen_count_check CHECK (reopen_count >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_support_tickets_request
  ON support_tickets (professional_id, client_request_id) WHERE client_request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_support_tickets_prof_list
  ON support_tickets (professional_id, last_activity_at DESC, id);
-- Limite de solicitações abertas por profissional (contagem rápida).
CREATE INDEX IF NOT EXISTS idx_support_tickets_prof_open
  ON support_tickets (professional_id) WHERE status <> 'resolvida';
-- Fila do ADM.
CREATE INDEX IF NOT EXISTS idx_support_tickets_queue ON support_tickets (status, last_activity_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_tickets_category ON support_tickets (category, last_activity_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_tickets_priority ON support_tickets (priority, last_activity_at DESC);
-- Contadores de não lidas (cada lado enxerga só o seu índice parcial).
CREATE INDEX IF NOT EXISTS idx_support_tickets_unread_prof
  ON support_tickets (professional_id) WHERE last_actor = 'admin' AND last_seq > prof_read_seq;
CREATE INDEX IF NOT EXISTS idx_support_tickets_unread_admin
  ON support_tickets (last_activity_at DESC) WHERE last_actor = 'professional' AND last_seq > admin_read_seq;
-- Suporta o ON DELETE SET NULL da solicitação relacionada.
CREATE INDEX IF NOT EXISTS idx_support_tickets_related
  ON support_tickets (related_ticket_id) WHERE related_ticket_id IS NOT NULL;

-- ── Mensagens ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS support_messages (
  id                 uuid        NOT NULL DEFAULT gen_random_uuid(),
  ticket_id          uuid        NOT NULL,
  professional_id    uuid        NOT NULL,                       -- titular do chamado (FK composta)
  seq                bigint      NOT NULL,                       -- atribuído pelo trigger
  author_role        text        NOT NULL,
  author_id          uuid,                                       -- obrigatório ao gravar; NULL só depois que a conta do autor é excluída
  body               text        NOT NULL,
  client_message_id  uuid,
  request_hash       text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT support_messages_pkey PRIMARY KEY (id),
  CONSTRAINT support_messages_ticket_fkey FOREIGN KEY (ticket_id, professional_id)
    REFERENCES support_tickets (id, professional_id) ON DELETE CASCADE,
  CONSTRAINT support_messages_author_fkey FOREIGN KEY (author_id) REFERENCES professionals (id) ON DELETE SET NULL,
  CONSTRAINT support_messages_ticket_seq_key UNIQUE (ticket_id, seq),
  CONSTRAINT support_messages_author_role_check CHECK (author_role IN ('professional', 'admin')),
  CONSTRAINT support_messages_body_check CHECK (char_length(body) BETWEEN 1 AND 5000 AND body ~ '[^[:space:]]'),
  CONSTRAINT support_messages_seq_check CHECK (seq > 0),
  CONSTRAINT support_messages_idempotency_check
    CHECK ((client_message_id IS NULL) = (request_hash IS NULL)
           AND (request_hash IS NULL OR request_hash ~ '^[0-9a-f]{64}$'))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_support_messages_client_id
  ON support_messages (ticket_id, client_message_id) WHERE client_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_support_messages_author ON support_messages (author_id) WHERE author_id IS NOT NULL;

-- ── Eventos (histórico) ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS support_ticket_events (
  id               uuid        NOT NULL DEFAULT gen_random_uuid(),
  ticket_id        uuid        NOT NULL,
  professional_id  uuid        NOT NULL,
  seq              bigint      NOT NULL,
  type             text        NOT NULL,
  from_value       text,
  to_value         text,
  actor_role       text        NOT NULL,
  actor_id         uuid,                                          -- obrigatório p/ professional/admin ao gravar; NULL em 'system' ou após exclusão da conta
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT support_ticket_events_pkey PRIMARY KEY (id),
  CONSTRAINT support_ticket_events_ticket_fkey FOREIGN KEY (ticket_id, professional_id)
    REFERENCES support_tickets (id, professional_id) ON DELETE CASCADE,
  CONSTRAINT support_ticket_events_actor_fkey FOREIGN KEY (actor_id) REFERENCES professionals (id) ON DELETE SET NULL,
  CONSTRAINT support_ticket_events_ticket_seq_key UNIQUE (ticket_id, seq),
  CONSTRAINT support_ticket_events_type_check
    CHECK (type IN ('created', 'status_changed', 'priority_changed', 'reopened')),
  CONSTRAINT support_ticket_events_actor_role_check CHECK (actor_role IN ('professional', 'admin', 'system')),
  CONSTRAINT support_ticket_events_seq_check CHECK (seq > 0),
  CONSTRAINT support_ticket_events_values_check CHECK (
    -- COALESCE: um CHECK que avalia NULL é aprovado; to_value nulo precisa falhar nestes tipos.
    COALESCE(CASE type
      WHEN 'status_changed'   THEN to_value IN ('aberta', 'em_atendimento', 'aguardando_profissional', 'resolvida')
      WHEN 'reopened'         THEN to_value IN ('aberta', 'em_atendimento')
      WHEN 'priority_changed' THEN to_value IN ('alta', 'media', 'baixa')
      ELSE true
    END, false))
);
CREATE INDEX IF NOT EXISTS idx_support_ticket_events_actor ON support_ticket_events (actor_id) WHERE actor_id IS NOT NULL;
-- Só um evento 'created' por solicitação: um retry de criação não duplica o histórico.
CREATE UNIQUE INDEX IF NOT EXISTS uq_support_ticket_events_created
  ON support_ticket_events (ticket_id) WHERE type = 'created';

-- ── Triggers ────────────────────────────────────────────────────────────────

-- Passo 1 (BEFORE INSERT em mensagens e eventos): autoria coerente, lock do ticket e seq proposto.
-- Não escreve em nenhuma tabela: o que for descartado por ON CONFLICT DO NOTHING não deixa rastro.
CREATE OR REPLACE FUNCTION support_assign_activity_seq() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_role  text;
  v_actor uuid;
  v_cur   bigint;
BEGIN
  IF TG_TABLE_NAME = 'support_messages' THEN
    v_role := NEW.author_role;  v_actor := NEW.author_id;
  ELSE
    v_role := NEW.actor_role;   v_actor := NEW.actor_id;
  END IF;

  -- Papel inválido cai nos CHECK da própria linha; aqui só se confere a identidade do autor.
  IF v_role = 'professional' THEN
    IF v_actor IS DISTINCT FROM NEW.professional_id THEN
      RAISE EXCEPTION 'support: autor com papel professional deve ser a titular do ticket'
        USING ERRCODE = 'check_violation';
    END IF;
  ELSIF v_role = 'admin' THEN
    IF v_actor IS NULL OR NOT EXISTS (SELECT 1 FROM professionals WHERE id = v_actor AND is_admin) THEN
      RAISE EXCEPTION 'support: autor com papel admin deve ser uma conta administradora'
        USING ERRCODE = 'check_violation';
    END IF;
  ELSIF v_role = 'system' THEN
    IF v_actor IS NOT NULL THEN
      RAISE EXCEPTION 'support: evento do sistema não tem autor' USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- FOR NO KEY UPDATE serializa os escritores do ticket e não conflita com FOR KEY SHARE (FKs).
  SELECT activity_seq INTO v_cur
    FROM support_tickets
   WHERE id = NEW.ticket_id AND professional_id = NEW.professional_id
     FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'support: ticket % não pertence à profissional %', NEW.ticket_id, NEW.professional_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  NEW.seq := v_cur + 1;   -- qualquer seq enviado pelo chamador é descartado
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_support_messages_seq ON support_messages;
CREATE TRIGGER trg_support_messages_seq BEFORE INSERT ON support_messages
  FOR EACH ROW EXECUTE FUNCTION support_assign_activity_seq();
DROP TRIGGER IF EXISTS trg_support_ticket_events_seq ON support_ticket_events;
CREATE TRIGGER trg_support_ticket_events_seq BEFORE INSERT ON support_ticket_events
  FOR EACH ROW EXECUTE FUNCTION support_assign_activity_seq();

-- Passo 2 (AFTER INSERT, só para linhas realmente inseridas): avança o contador do ticket.
-- last_seq/last_actor/last_activity_at são derivados pelo guard do passo 3.
CREATE OR REPLACE FUNCTION support_apply_activity() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE support_tickets
     SET activity_seq = NEW.seq
   WHERE id = NEW.ticket_id AND professional_id = NEW.professional_id
     AND activity_seq = NEW.seq - 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'support: sequência de atividade fora de ordem no ticket %', NEW.ticket_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_support_messages_apply ON support_messages;
CREATE TRIGGER trg_support_messages_apply AFTER INSERT ON support_messages
  FOR EACH ROW EXECUTE FUNCTION support_apply_activity();
DROP TRIGGER IF EXISTS trg_support_ticket_events_apply ON support_ticket_events;
CREATE TRIGGER trg_support_ticket_events_apply AFTER INSERT ON support_ticket_events
  FOR EACH ROW EXECUTE FUNCTION support_apply_activity();

-- Ticket novo nasce zerado: sem contadores, cursores, autor de atividade ou estado forjados.
CREATE OR REPLACE FUNCTION support_tickets_insert_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.activity_seq <> 0 OR NEW.last_seq <> 0 OR NEW.prof_read_seq <> 0 OR NEW.admin_read_seq <> 0
     OR NEW.last_actor <> 'professional' OR NEW.status <> 'aberta' OR NEW.reopen_count <> 0 THEN
    RAISE EXCEPTION 'support: solicitação nova deve nascer aberta e com contadores e cursores zerados'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_support_tickets_insert_guard ON support_tickets;
CREATE TRIGGER trg_support_tickets_insert_guard BEFORE INSERT ON support_tickets
  FOR EACH ROW EXECUTE FUNCTION support_tickets_insert_guard();

-- Passo 3 (BEFORE UPDATE em support_tickets): identidade imutável, contador só avança +1 com uma
-- atividade real, last_* derivados dessa atividade, cursores só crescem, resolved_by é administradora.
CREATE OR REPLACE FUNCTION support_tickets_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_role     text;
  v_notifies boolean;
BEGIN
  IF NEW.id <> OLD.id OR NEW.professional_id <> OLD.professional_id
     OR NEW.ticket_number <> OLD.ticket_number OR NEW.created_at <> OLD.created_at
     OR NEW.client_request_id IS DISTINCT FROM OLD.client_request_id
     OR NEW.request_hash IS DISTINCT FROM OLD.request_hash THEN
    RAISE EXCEPTION 'support: identidade e titularidade da solicitação são imutáveis'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.activity_seq <> OLD.activity_seq THEN
    IF NEW.activity_seq <> OLD.activity_seq + 1 THEN
      RAISE EXCEPTION 'support: activity_seq só pode avançar de 1 em 1' USING ERRCODE = 'check_violation';
    END IF;
    SELECT x.role, x.notifies INTO v_role, v_notifies FROM (
      SELECT author_role AS role, true AS notifies
        FROM support_messages WHERE ticket_id = NEW.id AND seq = NEW.activity_seq
      UNION ALL
      SELECT actor_role, (type <> 'priority_changed' AND actor_role <> 'system')
        FROM support_ticket_events WHERE ticket_id = NEW.id AND seq = NEW.activity_seq
    ) x;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'support: não existe atividade registrada com seq %', NEW.activity_seq
        USING ERRCODE = 'check_violation';
    END IF;
    IF v_notifies THEN
      NEW.last_seq := NEW.activity_seq;
      NEW.last_actor := v_role;
      NEW.last_activity_at := clock_timestamp();
    ELSE
      NEW.last_seq := OLD.last_seq;
      NEW.last_actor := OLD.last_actor;
      NEW.last_activity_at := OLD.last_activity_at;
    END IF;
  ELSIF NEW.last_seq <> OLD.last_seq OR NEW.last_actor <> OLD.last_actor
        OR NEW.last_activity_at <> OLD.last_activity_at THEN
    RAISE EXCEPTION 'support: last_seq, last_actor e last_activity_at são derivados da atividade registrada'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.prof_read_seq < OLD.prof_read_seq OR NEW.admin_read_seq < OLD.admin_read_seq THEN
    RAISE EXCEPTION 'support: cursores de leitura não podem retroceder' USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.resolved_by IS NOT NULL AND NEW.resolved_by IS DISTINCT FROM OLD.resolved_by
     AND NOT EXISTS (SELECT 1 FROM professionals WHERE id = NEW.resolved_by AND is_admin) THEN
    RAISE EXCEPTION 'support: resolved_by deve ser uma conta administradora' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_support_tickets_guard ON support_tickets;
CREATE TRIGGER trg_support_tickets_guard BEFORE UPDATE ON support_tickets
  FOR EACH ROW EXECUTE FUNCTION support_tickets_guard();

-- Mensagens e eventos são imutáveis. Única alteração permitida: a referência ao autor/ator
-- virar NULL, e só quando a conta dele já não existe (efeito do ON DELETE SET NULL na exclusão da
-- conta); anonimizar o autor de uma conta existente é recusado. DELETE continua
-- permitido (cascade da exclusão de conta e a futura rotina de retenção).
CREATE OR REPLACE FUNCTION support_append_only_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_TABLE_NAME = 'support_messages' THEN
    IF (NEW.id, NEW.ticket_id, NEW.professional_id, NEW.seq, NEW.author_role, NEW.body,
        NEW.client_message_id, NEW.request_hash, NEW.created_at)
       IS DISTINCT FROM
       (OLD.id, OLD.ticket_id, OLD.professional_id, OLD.seq, OLD.author_role, OLD.body,
        OLD.client_message_id, OLD.request_hash, OLD.created_at)
       OR (NEW.author_id IS DISTINCT FROM OLD.author_id
           AND (NEW.author_id IS NOT NULL OR EXISTS (SELECT 1 FROM professionals WHERE id = OLD.author_id))) THEN
      RAISE EXCEPTION 'support_messages é imutável' USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    IF (NEW.id, NEW.ticket_id, NEW.professional_id, NEW.seq, NEW.type, NEW.from_value,
        NEW.to_value, NEW.actor_role, NEW.created_at)
       IS DISTINCT FROM
       (OLD.id, OLD.ticket_id, OLD.professional_id, OLD.seq, OLD.type, OLD.from_value,
        OLD.to_value, OLD.actor_role, OLD.created_at)
       OR (NEW.actor_id IS DISTINCT FROM OLD.actor_id
           AND (NEW.actor_id IS NOT NULL OR EXISTS (SELECT 1 FROM professionals WHERE id = OLD.actor_id))) THEN
      RAISE EXCEPTION 'support_ticket_events é imutável' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_support_messages_immutable ON support_messages;
CREATE TRIGGER trg_support_messages_immutable BEFORE UPDATE ON support_messages
  FOR EACH ROW EXECUTE FUNCTION support_append_only_guard();
DROP TRIGGER IF EXISTS trg_support_ticket_events_immutable ON support_ticket_events;
CREATE TRIGGER trg_support_ticket_events_immutable BEFORE UPDATE ON support_ticket_events
  FOR EACH ROW EXECUTE FUNCTION support_append_only_guard();

-- updated_at (função já existente em schema.sql).
DROP TRIGGER IF EXISTS trg_support_tickets_updated ON support_tickets;
CREATE TRIGGER trg_support_tickets_updated BEFORE UPDATE ON support_tickets
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_support_faq_articles_updated ON support_faq_articles;
CREATE TRIGGER trg_support_faq_articles_updated BEFORE UPDATE ON support_faq_articles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Preferência do botão de ajuda (registrada na conta). Por último: ACCESS EXCLUSIVE em professionals
-- pelo menor tempo possível antes do COMMIT.
ALTER TABLE professionals ADD COLUMN IF NOT EXISTS support_fab_hidden boolean NOT NULL DEFAULT false;

-- ── Verificação (falha com mensagem clara se o schema não for o esperado) ───
-- "IF NOT EXISTS" não garante que o que já existia é o que esta migration define. Tudo abaixo é conferido
-- no catálogo; qualquer divergência aborta a transação inteira, listando TODOS os problemas.
DO $verify$
DECLARE
  problems text[] := ARRAY[]::text[];
  r        record;
BEGIN
  -- Colunas: nome, tipo e nulidade.
  FOR r IN
    SELECT e.t, e.c, e.ty, e.nn
      FROM (VALUES
        ('support_faq_categories', 'slug', 'text', true),
        ('support_faq_categories', 'title', 'text', true),
        ('support_faq_categories', 'position', 'smallint', true),
        ('support_faq_articles', 'id', 'uuid', true),
        ('support_faq_articles', 'category_slug', 'text', true),
        ('support_faq_articles', 'title', 'text', true),
        ('support_faq_articles', 'body', 'text', true),
        ('support_faq_articles', 'position', 'integer', true),
        ('support_faq_articles', 'status', 'text', true),
        ('support_faq_articles', 'published_at', 'timestamp with time zone', false),
        ('support_faq_articles', 'created_by', 'uuid', false),
        ('support_faq_articles', 'updated_by', 'uuid', false),
        ('support_faq_articles', 'created_at', 'timestamp with time zone', true),
        ('support_faq_articles', 'updated_at', 'timestamp with time zone', true),
        ('support_tickets', 'id', 'uuid', true),
        ('support_tickets', 'ticket_number', 'bigint', true),
        ('support_tickets', 'professional_id', 'uuid', true),
        ('support_tickets', 'category', 'text', true),
        ('support_tickets', 'subject', 'text', true),
        ('support_tickets', 'status', 'text', true),
        ('support_tickets', 'priority', 'text', true),
        ('support_tickets', 'priority_source', 'text', true),
        ('support_tickets', 'related_ticket_id', 'uuid', false),
        ('support_tickets', 'client_request_id', 'uuid', false),
        ('support_tickets', 'request_hash', 'text', false),
        ('support_tickets', 'activity_seq', 'bigint', true),
        ('support_tickets', 'last_seq', 'bigint', true),
        ('support_tickets', 'last_actor', 'text', true),
        ('support_tickets', 'prof_read_seq', 'bigint', true),
        ('support_tickets', 'admin_read_seq', 'bigint', true),
        ('support_tickets', 'last_activity_at', 'timestamp with time zone', true),
        ('support_tickets', 'resolved_at', 'timestamp with time zone', false),
        ('support_tickets', 'resolved_by', 'uuid', false),
        ('support_tickets', 'reopen_count', 'integer', true),
        ('support_tickets', 'created_at', 'timestamp with time zone', true),
        ('support_tickets', 'updated_at', 'timestamp with time zone', true),
        ('support_messages', 'id', 'uuid', true),
        ('support_messages', 'ticket_id', 'uuid', true),
        ('support_messages', 'professional_id', 'uuid', true),
        ('support_messages', 'seq', 'bigint', true),
        ('support_messages', 'author_role', 'text', true),
        ('support_messages', 'author_id', 'uuid', false),
        ('support_messages', 'body', 'text', true),
        ('support_messages', 'client_message_id', 'uuid', false),
        ('support_messages', 'request_hash', 'text', false),
        ('support_messages', 'created_at', 'timestamp with time zone', true),
        ('support_ticket_events', 'id', 'uuid', true),
        ('support_ticket_events', 'ticket_id', 'uuid', true),
        ('support_ticket_events', 'professional_id', 'uuid', true),
        ('support_ticket_events', 'seq', 'bigint', true),
        ('support_ticket_events', 'type', 'text', true),
        ('support_ticket_events', 'from_value', 'text', false),
        ('support_ticket_events', 'to_value', 'text', false),
        ('support_ticket_events', 'actor_role', 'text', true),
        ('support_ticket_events', 'actor_id', 'uuid', false),
        ('support_ticket_events', 'created_at', 'timestamp with time zone', true),
        ('professionals', 'support_fab_hidden', 'boolean', true)
      ) AS e(t, c, ty, nn)
     WHERE NOT EXISTS (
       SELECT 1 FROM pg_attribute a
         JOIN pg_class k ON k.oid = a.attrelid
         JOIN pg_namespace n ON n.oid = k.relnamespace
        WHERE n.nspname = 'public' AND k.relname = e.t AND a.attname = e.c
          AND a.attnum > 0 AND NOT a.attisdropped
          AND format_type(a.atttypid, a.atttypmod) = e.ty AND a.attnotnull = e.nn)
  LOOP
    problems := problems || format('coluna %s.%s ausente ou diferente (esperado %s%s)',
                                   r.t, r.c, r.ty, CASE WHEN r.nn THEN ' NOT NULL' ELSE '' END);
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = to_regclass('public.support_tickets')
                    AND a.attname = 'ticket_number' AND a.attidentity = 'a') THEN
    problems := problems || 'support_tickets.ticket_number deve ser GENERATED ALWAYS AS IDENTITY';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
                  WHERE d.adrelid = to_regclass('public.professionals') AND a.attname = 'support_fab_hidden'
                    AND pg_get_expr(d.adbin, d.adrelid) = 'false') THEN
    problems := problems || 'professionals.support_fab_hidden deve ter DEFAULT false';
  END IF;

  -- Constraints: existência, tipo, validada e trechos essenciais da definição.
  FOR r IN
    SELECT e.t, e.n, e.k, e.frag
      FROM (VALUES
        ('support_faq_categories', 'support_faq_categories_pkey', 'p', NULL::text),
        ('support_faq_categories', 'support_faq_categories_position_key', 'u', NULL),
        ('support_faq_categories', 'support_faq_categories_slug_check', 'c', 'tecnico'),
        ('support_faq_categories', 'support_faq_categories_title_check', 'c', '<= 80'),
        ('support_faq_articles', 'support_faq_articles_pkey', 'p', NULL),
        ('support_faq_articles', 'support_faq_articles_category_fkey', 'f', 'REFERENCES support_faq_categories(slug)'),
        ('support_faq_articles', 'support_faq_articles_created_by_fkey', 'f', 'ON DELETE SET NULL'),
        ('support_faq_articles', 'support_faq_articles_updated_by_fkey', 'f', 'ON DELETE SET NULL'),
        ('support_faq_articles', 'support_faq_articles_title_check', 'c', '<= 120'),
        ('support_faq_articles', 'support_faq_articles_body_check', 'c', '<= 8000'),
        ('support_faq_articles', 'support_faq_articles_status_check', 'c', 'publicado'),
        ('support_faq_articles', 'support_faq_articles_published_at_check', 'c', 'published_at IS NOT NULL'),
        ('support_tickets', 'support_tickets_pkey', 'p', NULL),
        ('support_tickets', 'support_tickets_ticket_number_key', 'u', NULL),
        ('support_tickets', 'support_tickets_id_professional_id_key', 'u', 'id, professional_id'),
        ('support_tickets', 'support_tickets_professional_fkey', 'f', 'ON DELETE CASCADE'),
        ('support_tickets', 'support_tickets_category_fkey', 'f', 'REFERENCES support_faq_categories(slug)'),
        ('support_tickets', 'support_tickets_resolved_by_fkey', 'f', 'ON DELETE SET NULL'),
        ('support_tickets', 'support_tickets_related_fkey', 'f', 'ON DELETE SET NULL (related_ticket_id)'),
        ('support_tickets', 'support_tickets_related_not_self_check', 'c', 'related_ticket_id <> id'),
        ('support_tickets', 'support_tickets_subject_check', 'c', '<= 120'),
        ('support_tickets', 'support_tickets_status_check', 'c', 'aguardando_profissional'),
        ('support_tickets', 'support_tickets_priority_check', 'c', 'baixa'),
        ('support_tickets', 'support_tickets_priority_source_check', 'c', 'manual'),
        ('support_tickets', 'support_tickets_last_actor_check', 'c', 'admin'),
        ('support_tickets', 'support_tickets_resolved_at_check', 'c', 'resolved_at IS NOT NULL'),
        ('support_tickets', 'support_tickets_resolved_by_check', 'c', 'resolved_at IS NOT NULL'),
        ('support_tickets', 'support_tickets_idempotency_check', 'c', '[0-9a-f]{64}'),
        ('support_tickets', 'support_tickets_seq_check', 'c', 'prof_read_seq <= activity_seq'),
        ('support_tickets', 'support_tickets_reopen_count_check', 'c', '>= 0'),
        ('support_messages', 'support_messages_pkey', 'p', NULL),
        ('support_messages', 'support_messages_ticket_fkey', 'f', 'ON DELETE CASCADE'),
        ('support_messages', 'support_messages_author_fkey', 'f', 'ON DELETE SET NULL'),
        ('support_messages', 'support_messages_ticket_seq_key', 'u', 'ticket_id, seq'),
        ('support_messages', 'support_messages_author_role_check', 'c', 'admin'),
        ('support_messages', 'support_messages_body_check', 'c', '<= 5000'),
        ('support_messages', 'support_messages_seq_check', 'c', 'seq > 0'),
        ('support_messages', 'support_messages_idempotency_check', 'c', '[0-9a-f]{64}'),
        ('support_ticket_events', 'support_ticket_events_pkey', 'p', NULL),
        ('support_ticket_events', 'support_ticket_events_ticket_fkey', 'f', 'ON DELETE CASCADE'),
        ('support_ticket_events', 'support_ticket_events_actor_fkey', 'f', 'ON DELETE SET NULL'),
        ('support_ticket_events', 'support_ticket_events_ticket_seq_key', 'u', 'ticket_id, seq'),
        ('support_ticket_events', 'support_ticket_events_type_check', 'c', 'priority_changed'),
        ('support_ticket_events', 'support_ticket_events_actor_role_check', 'c', 'system'),
        ('support_ticket_events', 'support_ticket_events_seq_check', 'c', 'seq > 0'),
        ('support_ticket_events', 'support_ticket_events_values_check', 'c', 'COALESCE')
      ) AS e(t, n, k, frag)
     WHERE NOT EXISTS (
       SELECT 1 FROM pg_constraint c
        WHERE c.conrelid = to_regclass('public.' || e.t) AND c.conname = e.n
          AND c.contype = e.k::"char" AND c.convalidated
          AND (e.frag IS NULL OR position(e.frag IN pg_get_constraintdef(c.oid)) > 0))
  LOOP
    problems := problems || format('constraint %s.%s ausente, não validada ou com definição diferente (esperado tipo %s%s)',
                                   r.t, r.n, r.k, COALESCE(' contendo ' || quote_literal(r.frag), ''));
  END LOOP;

  -- Índices (inclui os únicos parciais que sustentam a idempotência).
  FOR r IN
    SELECT e.t, e.n, e.frag
      FROM (VALUES
        ('support_tickets', 'uq_support_tickets_request', 'UNIQUE INDEX'),
        ('support_tickets', 'uq_support_tickets_request', 'WHERE (client_request_id IS NOT NULL)'),
        ('support_tickets', 'idx_support_tickets_prof_list', 'professional_id, last_activity_at DESC'),
        ('support_tickets', 'idx_support_tickets_prof_open', 'WHERE (status <> ''resolvida''::text)'),
        ('support_tickets', 'idx_support_tickets_queue', 'status, last_activity_at DESC'),
        ('support_tickets', 'idx_support_tickets_category', 'category, last_activity_at DESC'),
        ('support_tickets', 'idx_support_tickets_priority', 'priority, last_activity_at DESC'),
        ('support_tickets', 'idx_support_tickets_unread_prof', 'last_seq > prof_read_seq'),
        ('support_tickets', 'idx_support_tickets_unread_admin', 'last_seq > admin_read_seq'),
        ('support_tickets', 'idx_support_tickets_related', 'WHERE (related_ticket_id IS NOT NULL)'),
        ('support_messages', 'uq_support_messages_client_id', 'UNIQUE INDEX'),
        ('support_messages', 'uq_support_messages_client_id', 'WHERE (client_message_id IS NOT NULL)'),
        ('support_messages', 'idx_support_messages_author', 'WHERE (author_id IS NOT NULL)'),
        ('support_ticket_events', 'idx_support_ticket_events_actor', 'WHERE (actor_id IS NOT NULL)'),
        ('support_ticket_events', 'uq_support_ticket_events_created', 'UNIQUE INDEX'),
        ('support_ticket_events', 'uq_support_ticket_events_created', '''created''::text'),
        ('support_faq_articles', 'idx_support_faq_articles_list', 'status, category_slug, "position"')
      ) AS e(t, n, frag)
     WHERE NOT EXISTS (
       SELECT 1 FROM pg_indexes i
        WHERE i.schemaname = 'public' AND i.tablename = e.t AND i.indexname = e.n
          AND position(e.frag IN i.indexdef) > 0)
  LOOP
    problems := problems || format('índice %s (%s) ausente ou diferente (esperado conter %s)', r.n, r.t, quote_literal(r.frag));
  END LOOP;

  -- Triggers: função, momento/evento/linha (tgtype) e habilitado.
  FOR r IN
    SELECT e.t, e.n, e.fn, e.tt
      FROM (VALUES
        ('support_messages', 'trg_support_messages_seq', 'support_assign_activity_seq', 7),
        ('support_messages', 'trg_support_messages_apply', 'support_apply_activity', 5),
        ('support_messages', 'trg_support_messages_immutable', 'support_append_only_guard', 19),
        ('support_ticket_events', 'trg_support_ticket_events_seq', 'support_assign_activity_seq', 7),
        ('support_ticket_events', 'trg_support_ticket_events_apply', 'support_apply_activity', 5),
        ('support_ticket_events', 'trg_support_ticket_events_immutable', 'support_append_only_guard', 19),
        ('support_tickets', 'trg_support_tickets_insert_guard', 'support_tickets_insert_guard', 7),
        ('support_tickets', 'trg_support_tickets_guard', 'support_tickets_guard', 19),
        ('support_tickets', 'trg_support_tickets_updated', 'set_updated_at', 19),
        ('support_faq_articles', 'trg_support_faq_articles_updated', 'set_updated_at', 19)
      ) AS e(t, n, fn, tt)
     WHERE NOT EXISTS (
       SELECT 1 FROM pg_trigger g JOIN pg_proc p ON p.oid = g.tgfoid
        WHERE g.tgrelid = to_regclass('public.' || e.t) AND g.tgname = e.n AND p.proname = e.fn
          AND NOT g.tgisinternal AND g.tgenabled = 'O' AND g.tgtype = e.tt::smallint)
  LOOP
    problems := problems || format('trigger %s em %s ausente, desabilitado ou diferente (função %s, tgtype %s)', r.n, r.t, r.fn, r.tt);
  END LOOP;

  -- Funções com search_path fixo.
  FOR r IN
    SELECT f FROM unnest(ARRAY['support_assign_activity_seq', 'support_apply_activity', 'support_tickets_insert_guard',
                               'support_tickets_guard', 'support_append_only_guard']) AS f
     WHERE NOT EXISTS (
       SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = f AND position('search_path=public, pg_temp' IN p.proconfig::text) > 0)
  LOOP
    problems := problems || format('função %s ausente ou sem search_path fixo', r.f);
  END LOOP;

  -- Seed das categorias fixas.
  IF (SELECT string_agg(slug || ':' || position, ',' ORDER BY position) FROM support_faq_categories)
     IS DISTINCT FROM 'agenda:1,clientes:2,servicos_config:3,perfil_acesso:4,financeiro:5,tecnico:6' THEN
    problems := problems || 'support_faq_categories deve conter exatamente as 6 categorias fixas, nas posições 1 a 6';
  END IF;

  IF array_length(problems, 1) > 0 THEN
    RAISE EXCEPTION 'migration 023: schema de suporte divergente do esperado -- %', array_to_string(problems, '; ')
      USING HINT = 'Nada foi alterado (transação revertida). Se as tabelas support_* vieram de uma tentativa anterior, revise-as antes de reaplicar.';
  END IF;
END
$verify$;

COMMIT;
