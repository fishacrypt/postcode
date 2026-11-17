-- PostcodeProof schema v1. Rollback: database/migrations/down/001_init.down.sql (see docs/operations/migrations.md).
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TABLE users (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email             text NOT NULL UNIQUE CHECK (email = lower(email)),
  password_hash     text NOT NULL,
  role              text NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'business', 'issuer', 'admin')),
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  email_verified_at timestamptz,
  failed_logins     integer NOT NULL DEFAULT 0,
  locked_until      timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE user_profiles (
  user_id      uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  display_name text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   text NOT NULL UNIQUE,
  expires_at   timestamptz NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  user_agent   text
);
CREATE INDEX sessions_user_idx ON sessions(user_id);

CREATE TABLE email_verification_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  text NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX evt_user_idx ON email_verification_tokens(user_id);

CREATE TABLE password_reset_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  text NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX prt_user_idx ON password_reset_tokens(user_id);

CREATE TABLE addresses (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  country                char(2) NOT NULL,
  state                  text NOT NULL,
  state_code             text NOT NULL,
  lga                    text NOT NULL,
  city                   text NOT NULL,
  postcode               text NOT NULL,
  postcode_format        text,
  -- AES-256-GCM blob holding street, building, unit, district, notes and GPS.
  sensitive_blob         bytea NOT NULL,
  encryption_key_version smallint NOT NULL,
  assurance_level        smallint NOT NULL DEFAULT 0 CHECK (assurance_level BETWEEN 0 AND 3),
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX addresses_user_idx ON addresses(user_id);
CREATE TRIGGER addresses_updated BEFORE UPDATE ON addresses FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- One row per validation run. Contains no street-level data.
CREATE TABLE address_validation_records (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  address_id      uuid NOT NULL REFERENCES addresses(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assurance_level smallint NOT NULL CHECK (assurance_level BETWEEN 0 AND 3),
  format_valid    boolean NOT NULL,
  dataset_status  text NOT NULL,
  dataset_source  text,
  geographic      text NOT NULL,
  gps_status      text NOT NULL,
  result          jsonb NOT NULL,
  validated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX avr_address_idx ON address_validation_records(address_id, validated_at DESC);

CREATE TABLE businesses (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id  uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  name           text NOT NULL,
  website        text,
  contact_email  text,
  description    text,
  status         text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER businesses_updated BEFORE UPDATE ON businesses FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE business_api_keys (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id  uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name         text NOT NULL,
  prefix       text NOT NULL,
  key_hash     text NOT NULL UNIQUE,
  scopes       jsonb NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz,
  last_used_at timestamptz,
  revoked_at   timestamptz
);
CREATE INDEX bak_business_idx ON business_api_keys(business_id);

CREATE TABLE api_usage (
  id         bigserial PRIMARY KEY,
  api_key_id uuid NOT NULL REFERENCES business_api_keys(id) ON DELETE CASCADE,
  route      text NOT NULL,
  status     integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX api_usage_key_idx ON api_usage(api_key_id, created_at DESC);

CREATE TABLE credentials (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  address_id             uuid REFERENCES addresses(id) ON DELETE SET NULL,
  credential_version     smallint NOT NULL DEFAULT 1,
  document               jsonb NOT NULL,
  document_hash          text NOT NULL,
  issuer_address         text NOT NULL,
  issuer_signature       text NOT NULL,
  -- Encrypted claim values and salts so the holder can build presentations later. NULL after address deletion.
  claims_blob            bytea,
  encryption_key_version smallint,
  status                 text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  issued_at              timestamptz NOT NULL,
  expires_at             timestamptz NOT NULL,
  renewed_from           uuid REFERENCES credentials(id),
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX credentials_user_idx ON credentials(user_id);
CREATE UNIQUE INDEX credentials_hash_idx ON credentials(document_hash);
CREATE TRIGGER credentials_updated BEFORE UPDATE ON credentials FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE credential_revocations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  credential_id uuid NOT NULL UNIQUE REFERENCES credentials(id) ON DELETE CASCADE,
  revoked_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  source        text NOT NULL CHECK (source IN ('holder', 'issuer', 'admin', 'renewal', 'address_deleted')),
  reason        text,
  onchain_tx    text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE credential_anchors (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  credential_id    uuid NOT NULL REFERENCES credentials(id) ON DELETE CASCADE,
  chain_id         integer NOT NULL,
  registry_address text NOT NULL,
  holder_address   text NOT NULL,
  commitment       text NOT NULL,
  tx_hash          text NOT NULL,
  status           text NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'revoked')),
  anchored_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (chain_id, registry_address, commitment)
);
CREATE INDEX anchors_credential_idx ON credential_anchors(credential_id);

CREATE TABLE verification_requests (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id      uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  reference        text NOT NULL,
  purpose          text NOT NULL,
  requested_fields jsonb NOT NULL,
  code_hash        text NOT NULL UNIQUE,
  code_hint        text NOT NULL,
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'declined', 'cancelled')),
  expires_at       timestamptz NOT NULL,
  decided_at       timestamptz,
  decided_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  api_key_id       uuid REFERENCES business_api_keys(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX vr_business_idx ON verification_requests(business_id, created_at DESC);

-- Opaque verification links. Only the SHA-256 of the token is stored.
CREATE TABLE verification_tokens (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credential_id uuid NOT NULL REFERENCES credentials(id) ON DELETE CASCADE,
  request_id    uuid REFERENCES verification_requests(id) ON DELETE SET NULL,
  token_hash    text NOT NULL UNIQUE,
  fields        jsonb NOT NULL,
  label         text,
  max_uses      integer CHECK (max_uses IS NULL OR max_uses > 0),
  use_count     integer NOT NULL DEFAULT 0,
  expires_at    timestamptz NOT NULL,
  revoked_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX vt_user_idx ON verification_tokens(user_id, created_at DESC);

CREATE TABLE consent_records (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind           text NOT NULL CHECK (kind IN ('credential_issuance', 'disclosure', 'gps')),
  decision       text NOT NULL CHECK (decision IN ('granted', 'declined', 'withdrawn')),
  request_id     uuid REFERENCES verification_requests(id) ON DELETE SET NULL,
  token_id       uuid REFERENCES verification_tokens(id) ON DELETE SET NULL,
  credential_id  uuid REFERENCES credentials(id) ON DELETE SET NULL,
  recipient      text,
  purpose        text,
  fields         jsonb NOT NULL DEFAULT '[]'::jsonb,
  statement_version text NOT NULL DEFAULT '1',
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX consent_user_idx ON consent_records(user_id, created_at DESC);

-- Never contains addresses, claim values or raw tokens.
CREATE TABLE verification_logs (
  id            bigserial PRIMARY KEY,
  credential_id uuid REFERENCES credentials(id) ON DELETE SET NULL,
  token_id      uuid REFERENCES verification_tokens(id) ON DELETE SET NULL,
  business_id   uuid REFERENCES businesses(id) ON DELETE SET NULL,
  channel       text NOT NULL CHECK (channel IN ('public_link', 'presentation', 'business_api', 'business_dashboard')),
  outcome       text NOT NULL,
  fields        jsonb NOT NULL DEFAULT '[]'::jsonb,
  ip_hash       text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX vl_credential_idx ON verification_logs(credential_id, created_at DESC);
CREATE INDEX vl_business_idx ON verification_logs(business_id, created_at DESC);

CREATE TABLE audit_logs (
  id         bigserial PRIMARY KEY,
  user_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  action     text NOT NULL,
  meta       jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip_hash    text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_user_idx ON audit_logs(user_id, created_at DESC);

-- Postcode reference data. Empty until a documented source is imported (docs/architecture/address-data.md).
CREATE TABLE postcode_sources (
  id           text PRIMARY KEY,
  name         text NOT NULL,
  publisher    text NOT NULL,
  url          text,
  coverage     text NOT NULL,
  licence      text,
  retrieved_at date NOT NULL,
  notes        text
);

CREATE TABLE postcode_records (
  id        bigserial PRIMARY KEY,
  country   char(2) NOT NULL,
  postcode  text NOT NULL,
  state     text NOT NULL,
  lga       text,
  area      text,
  source_id text NOT NULL REFERENCES postcode_sources(id) ON DELETE CASCADE
);
CREATE INDEX postcode_lookup_idx ON postcode_records(country, postcode);

CREATE TABLE contact_messages (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  email      text NOT NULL,
  message    text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
