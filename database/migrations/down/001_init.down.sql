-- Rollback for 001_init.sql.
-- DESTRUCTIVE: drops every PostcodeProof table and all stored data.
-- Take a backup first (pg_dump) and run only after the export has been verified.
-- Never run this in production without a written approval; prefer a forward-fixing migration.
BEGIN;
DROP TABLE IF EXISTS contact_messages, postcode_records, postcode_sources, audit_logs, verification_logs,
  consent_records, verification_tokens, verification_requests, credential_anchors, credential_revocations,
  credentials, api_usage, business_api_keys, businesses, address_validation_records, addresses,
  password_reset_tokens, email_verification_tokens, sessions, user_profiles, users CASCADE;
DROP FUNCTION IF EXISTS set_updated_at();
DELETE FROM schema_migrations WHERE name = '001_init.sql';
COMMIT;
