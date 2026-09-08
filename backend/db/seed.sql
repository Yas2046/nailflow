-- Dados de exemplo para desenvolvimento local.
-- Senha de todos os exemplos: "senha123" (hash bcrypt abaixo).
-- Gerado com bcrypt rounds=10.

INSERT INTO professionals (id, name, email, password_hash, phone_whatsapp, business_name)
VALUES (
  '11111111-1111-1111-1111-111111111111',
  'Camila Souza',
  'camila@nailflow.com',
  '$2a$10$KRMyKOorWVVj/j6lwwrkx.RDsQp7D90fLaqLSXpm4eitIMDi7vN66', -- senha123
  '5531999999999',
  'Camila Nails Studio'
);

INSERT INTO services (professional_id, name, description, price_cents, duration_minutes, active) VALUES
('11111111-1111-1111-1111-111111111111','Manicure','Manicure tradicional', 3500, 40, true),
('11111111-1111-1111-1111-111111111111','Pedicure','Pedicure tradicional', 4000, 50, true),
('11111111-1111-1111-1111-111111111111','Manicure + Pedicure','Combo completo', 7000, 80, true),
('11111111-1111-1111-1111-111111111111','Esmaltação em gel','Esmaltação em gel de longa duração', 5500, 60, true),
('11111111-1111-1111-1111-111111111111','Alongamento','Alongamento em fibra de vidro', 12000, 120, true);

INSERT INTO weekly_availability (professional_id, weekday, is_working, start_time, end_time, break_start, break_end) VALUES
('11111111-1111-1111-1111-111111111111', 0, false, NULL, NULL, NULL, NULL), -- domingo
('11111111-1111-1111-1111-111111111111', 1, true, '08:00', '18:00', '12:00', '13:00'),
('11111111-1111-1111-1111-111111111111', 2, true, '08:00', '18:00', '12:00', '13:00'),
('11111111-1111-1111-1111-111111111111', 3, true, '08:00', '18:00', '12:00', '13:00'),
('11111111-1111-1111-1111-111111111111', 4, true, '10:00', '20:00', '13:00', '14:00'),
('11111111-1111-1111-1111-111111111111', 5, true, '08:00', '18:00', '12:00', '13:00'),
('11111111-1111-1111-1111-111111111111', 6, true, '08:00', '14:00', NULL, NULL);

INSERT INTO clients (professional_id, name, phone, notes) VALUES
('11111111-1111-1111-1111-111111111111','Ana Paula','5531988887777','Prefere esmalte vermelho'),
('11111111-1111-1111-1111-111111111111','Julia Ferreira','5531988886666', NULL),
('11111111-1111-1111-1111-111111111111','Maria Clara','5531988885555','Alérgica a acetona comum');
