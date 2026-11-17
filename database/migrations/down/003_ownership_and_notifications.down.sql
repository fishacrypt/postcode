-- Rollback for 003. Drops constraints and two columns. The dropped columns contain only bookkeeping data
-- (actor role labels and notification timestamps); take a backup first anyway.
BEGIN;
DROP INDEX IF EXISTS credentials_expiry_idx;
ALTER TABLE credentials DROP COLUMN IF EXISTS expiry_notified_at;
ALTER TABLE audit_logs DROP COLUMN IF EXISTS actor_role;
ALTER TABLE verification_tokens DROP CONSTRAINT IF EXISTS vt_credential_owner_fk;
ALTER TABLE credentials DROP CONSTRAINT IF EXISTS credentials_address_owner_fk;
ALTER TABLE credentials ADD CONSTRAINT credentials_address_id_fkey FOREIGN KEY (address_id) REFERENCES addresses(id) ON DELETE SET NULL;
ALTER TABLE credentials DROP CONSTRAINT IF EXISTS credentials_id_user_unique;
ALTER TABLE addresses DROP CONSTRAINT IF EXISTS addresses_id_user_unique;
DELETE FROM schema_migrations WHERE name = '003_ownership_and_notifications.sql';
COMMIT;
