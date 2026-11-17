# Database design

PostgreSQL 18. Migrations are plain SQL in `database/migrations`, applied in filename order by `bun run db:migrate` (each in its own transaction, recorded in `schema_migrations`). Every query in the API uses parameterised Bun SQL; no SQL is built from user input.

## Tables

| Table | Purpose | Notes |
| --- | --- | --- |
| `users` | Accounts | Lower-case unique email, Argon2id hash, role check (`user`, `business`, `issuer`, `admin`), status, lockout counters, `email_verified_at` |
| `user_profiles` | Display name, locale | One row per user, cascade delete |
| `sessions` | Server-side sessions | Only a keyed hash of the token is stored |
| `email_verification_tokens`, `password_reset_tokens` | One-time tokens | Hashed, expiring, single use |
| `addresses` | Holder addresses | Postal fields needed for lookups are plain (state, LGA, city, postcode). Street, building, unit, district, notes and GPS are one AES-256-GCM blob with `encryption_key_version` |
| `address_validation_records` | History of validation outcomes | Format, dataset, geographic, GPS status and assurance level per validation |
| `credentials` | Issued credentials | Document (commitments only), document hash (unique), issuer signature, encrypted claim values and salts with `encryption_key_version`, status, expiry, renewal link, notification marker |
| `credential_revocations` | Why, when and by whom a credential was revoked | Source is holder, issuer, admin, renewal or address deletion |
| `credential_anchors` | Onchain anchor records | Chain, registry, holder wallet, transaction hash. No personal data |
| `verification_tokens` | Public verification links | Hash only, disclosed field names, expiry, use count and limit, revocation |
| `verification_requests` | Business requests to holders | Hashed one-time code, requested fields, status, expiry |
| `consent_records` | What a holder agreed to, with whom, for what | Field names, purpose, decision, timestamps. No values |
| `businesses`, `business_api_keys`, `api_usage` | Business profiles, hashed API keys with scopes, per-call usage | Key prefix stored for display, never the key |
| `verification_logs` | Public, API and consent verification events | Channel, outcome, disclosed field names, hashed IP. Never claim values |
| `audit_logs` | Security and administrative events | Action, actor role, metadata without personal data. Append-only for the app role |
| `postcode_sources`, `postcode_records` | Imported postcode dataset and provenance | Empty until you import a dataset |
| `contact_messages` | Contact form submissions | Rate limited |

## Integrity and ownership

- Foreign keys everywhere, with cascades only where deleting the owner should delete the data (user deletion removes addresses, credentials, sessions and so on).
- Migration 003 adds composite foreign keys so the database itself refuses a credential that points at another user's address, or a verification token that points at another user's credential. Tests insert such rows directly with SQL and expect failure.
- Check constraints on roles, statuses and assurance level. Unique constraints on email, document hash, token hashes and key hashes.
- `updated_at` is maintained by a trigger.
- Deleting an address wipes encrypted claim values from any non-active credential that was issued from it. Active credentials block address deletion until revoked.

## Least privilege

Migration 002 grants the `pp_app` role read and write on tables but removes update and delete on `audit_logs` and `verification_logs`, and all access to `schema_migrations`. The role must be created once outside migrations (`CREATE ROLE pp_app LOGIN PASSWORD '...' NOSUPERUSER NOCREATEDB NOCREATEROLE;`). Run the API as `pp_app` and run migrations as a separate owner role. A test verifies that `pp_app` cannot alter the schema or edit the logs.

## Migrations and rollback

- Forward: `bun run db:migrate`. Add a new numbered file; never edit an applied one.
- Rollback: `database/migrations/down/<name>.down.sql`. Down scripts exist for 001 and 003. The 001 down script drops every table and deletes data. Take a backup first and treat it as disaster tooling. Rolling back 003 only drops constraints and two bookkeeping columns, and a test exercises it. Migration 002 only adds grants and has no down script.
- Schema changes that rename or remove columns holding user data must copy data in a forward migration first. Do not discard data silently.
