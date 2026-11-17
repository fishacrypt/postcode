-- Least-privilege grants for the application role.
-- The API connects as `pp_app`, which can read and write rows but cannot change the schema.
-- Create the login role once, outside migrations, with a password from your secret manager:
--   CREATE ROLE pp_app LOGIN PASSWORD '<from secret manager>' NOSUPERUSER NOCREATEDB NOCREATEROLE;
-- (see docs/operations/database-roles.md). Migrations run as the owner role and skip grants if pp_app is absent.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pp_app') THEN
    GRANT USAGE ON SCHEMA public TO pp_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO pp_app;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO pp_app;
    -- Audit and verification logs are append-only for the application.
    REVOKE UPDATE, DELETE ON audit_logs, verification_logs FROM pp_app;
    -- Migration bookkeeping is owner-only.
    REVOKE ALL ON schema_migrations FROM pp_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO pp_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO pp_app;
  END IF;
END
$$;
