-- Reverte 032_reminder_attempts.sql. USO MANUAL. Apaga apenas o registro de tentativas de lembrete (nenhum dado de cliente, agendamento ou financeiro).
-- Reverta o código ANTES (os endpoints /bot/reminders/* deixam de funcionar sem a tabela). appointments.reminder_sent não é tocado.
BEGIN;
DROP TABLE IF EXISTS reminder_attempts;
COMMIT;
