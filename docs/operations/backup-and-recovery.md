# Backup and recovery

None of this has been exercised against a production system. Run a restore drill before relying on it.

## What to back up

| Item | How | Notes |
| --- | --- | --- |
| PostgreSQL | Daily base backup plus WAL archiving, or `pg_dump -Fc` for small installs | Encrypted at rest, retained per your retention policy |
| Encryption keys (`APP_ENCRYPTION_KEYS`) | Secret manager with versioned history | **Store separately from database backups.** A backup without its key is unreadable, so losing keys loses address details and claim salts permanently |
| Pepper and issuer key | Secret manager | Losing the pepper invalidates sessions and API keys. Losing the issuer key means issuing with a new key and keeping the old address in `TRUSTED_ISSUER_ADDRESSES` |
| Configuration | Version control (without secrets) | `.env.example` documents every variable |

Backups contain ciphertext for address details but plaintext for emails, state, LGA, city and postcode. Treat them as personal data.

## Restore

1. Provision a new PostgreSQL instance and the roles.
2. Restore the backup with the owner role. Run `bun run db:migrate` to apply anything newer.
3. Provide the key versions that were current when the backup was taken (all versions still referenced by `encryption_key_version` columns).
4. Start the API against the restored database. Check `GET /api/v1/admin/health` and open a known address.
5. Sessions in the backup are old. Consider deleting them: `DELETE FROM sessions;` forces everyone to sign in again.

## Recovery targets

Set and test your own RPO and RTO. The design does not constrain them. Credential status checks need the database, so an outage stops verification.

## Account recovery for users

Password reset by email (30-minute single-use token) is the only account recovery. There is no support override and no backdoor.
