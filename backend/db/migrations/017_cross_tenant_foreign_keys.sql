-- Fecha a brecha em que o banco permitia (sem nenhum código explorar isso
-- hoje) um agendamento ou mensagem apontar para cliente/serviço/grupo
-- recorrente de OUTRA profissional. As FKs simples de appointments.client_id,
-- appointments.service_id, appointments.recurring_group_id e
-- message_history.client_id viram compostas com professional_id, então só
-- aceitam referência para uma linha que já é da mesma profissional.
-- Idempotente (pode ser re-executada sem efeito colateral) e transacional:
-- se a checagem de inconsistência encontrar algo, aborta sem mudar nada.

BEGIN;

DO $$
DECLARE
  bad_count integer;
BEGIN
  SELECT count(*) INTO bad_count
  FROM appointments a JOIN clients c ON c.id = a.client_id
  WHERE a.professional_id <> c.professional_id;
  IF bad_count > 0 THEN
    RAISE EXCEPTION 'appointments.client_id: % agendamento(s) apontando para cliente de outra profissional', bad_count;
  END IF;

  SELECT count(*) INTO bad_count
  FROM appointments a JOIN services s ON s.id = a.service_id
  WHERE a.professional_id <> s.professional_id;
  IF bad_count > 0 THEN
    RAISE EXCEPTION 'appointments.service_id: % agendamento(s) apontando para serviço de outra profissional', bad_count;
  END IF;

  SELECT count(*) INTO bad_count
  FROM appointments a JOIN recurring_groups g ON g.id = a.recurring_group_id
  WHERE a.professional_id <> g.professional_id;
  IF bad_count > 0 THEN
    RAISE EXCEPTION 'appointments.recurring_group_id: % agendamento(s) apontando para grupo recorrente de outra profissional', bad_count;
  END IF;

  SELECT count(*) INTO bad_count
  FROM message_history m JOIN clients c ON c.id = m.client_id
  WHERE m.professional_id <> c.professional_id;
  IF bad_count > 0 THEN
    RAISE EXCEPTION 'message_history.client_id: % mensagem(ns) apontando para cliente de outra profissional', bad_count;
  END IF;
END;
$$;

-- Alvo das FKs compostas: (id, professional_id) precisa ser único em cada
-- tabela referenciada. id já é PK (já é único sozinho); esta constraint
-- composta é o que o Postgres exige para servir de alvo de uma FK composta.
-- ALTER TABLE ADD CONSTRAINT não aceita IF NOT EXISTS; checamos no catálogo.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'clients_id_professional_id_key') THEN
    ALTER TABLE clients ADD CONSTRAINT clients_id_professional_id_key UNIQUE (id, professional_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'services_id_professional_id_key') THEN
    ALTER TABLE services ADD CONSTRAINT services_id_professional_id_key UNIQUE (id, professional_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'recurring_groups_id_professional_id_key') THEN
    ALTER TABLE recurring_groups ADD CONSTRAINT recurring_groups_id_professional_id_key UNIQUE (id, professional_id);
  END IF;
END;
$$;

-- Remove as FKs simples e cria as compostas, mantendo exatamente a mesma
-- política de ON DELETE que cada uma já tinha.
ALTER TABLE appointments DROP CONSTRAINT IF EXISTS appointments_client_id_fkey;
ALTER TABLE appointments
  ADD CONSTRAINT appointments_client_id_fkey
  FOREIGN KEY (client_id, professional_id) REFERENCES clients (id, professional_id) ON DELETE RESTRICT;

ALTER TABLE appointments DROP CONSTRAINT IF EXISTS appointments_service_id_fkey;
ALTER TABLE appointments
  ADD CONSTRAINT appointments_service_id_fkey
  FOREIGN KEY (service_id, professional_id) REFERENCES services (id, professional_id) ON DELETE RESTRICT;

ALTER TABLE appointments DROP CONSTRAINT IF EXISTS appointments_recurring_group_id_fkey;
ALTER TABLE appointments
  ADD CONSTRAINT appointments_recurring_group_id_fkey
  FOREIGN KEY (recurring_group_id, professional_id) REFERENCES recurring_groups (id, professional_id) ON DELETE SET NULL;

ALTER TABLE message_history DROP CONSTRAINT IF EXISTS message_history_client_id_fkey;
ALTER TABLE message_history
  ADD CONSTRAINT message_history_client_id_fkey
  FOREIGN KEY (client_id, professional_id) REFERENCES clients (id, professional_id) ON DELETE SET NULL;

COMMIT;
