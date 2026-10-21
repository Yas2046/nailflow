-- Reverte 030_password_reset_tokens.sql. USO MANUAL. Apaga apenas links de redefinição (nenhum dado de cliente ou financeiro).
BEGIN;
DROP TABLE IF EXISTS password_reset_tokens;
COMMIT;
