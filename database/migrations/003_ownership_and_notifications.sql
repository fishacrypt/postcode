-- 003: database-enforced ownership, actor roles in the audit log, expiry notification tracking.
-- Rollback: database/migrations/down/003_ownership_and_notifications.down.sql

-- A credential may only point at an address owned by the same user. A verification token may only point at a
-- credential owned by the same user. These constraints hold even if application code has a bug.
ALTER TABLE addresses ADD CONSTRAINT addresses_id_user_unique UNIQUE (id, user_id);
ALTER TABLE credentials ADD CONSTRAINT credentials_id_user_unique UNIQUE (id, user_id);
ALTER TABLE credentials DROP CONSTRAINT credentials_address_id_fkey;
ALTER TABLE credentials
  ADD CONSTRAINT credentials_address_owner_fk FOREIGN KEY (address_id, user_id)
  REFERENCES addresses (id, user_id) ON DELETE SET NULL (address_id);
ALTER TABLE verification_tokens
  ADD CONSTRAINT vt_credential_owner_fk FOREIGN KEY (credential_id, user_id)
  REFERENCES credentials (id, user_id) ON DELETE CASCADE;

-- Distinguish user, business, issuer and administrator actions in the audit trail.
ALTER TABLE audit_logs ADD COLUMN actor_role text;

ALTER TABLE credentials ADD COLUMN expiry_notified_at timestamptz;
CREATE INDEX credentials_expiry_idx ON credentials (expires_at) WHERE status = 'active' AND expiry_notified_at IS NULL;
