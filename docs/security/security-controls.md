# Security controls (as implemented)

## Authentication

- Registration, login, logout, refresh (token rotation), email verification, password reset, resend verification, session list and remote sign-out, password change, account deletion.
- Passwords: 12 to 128 characters with upper case, lower case and a digit, hashed with Argon2id (19 MiB memory, 2 iterations, via `Bun.password`). There is no breached-password check yet. Unknown emails take the same code path as wrong passwords (a dummy hash is checked) and return the same message.
- Lockout: five failed sign-ins lock the account for 15 minutes.
- Sessions: 32 random bytes, only a keyed hash stored. Absolute lifetime 7 days, idle timeout 24 hours. Cookie `pp_session`: HttpOnly, Path `/`, Secure and SameSite settings from `SESSION_COOKIE_MODE`. Production requires `standard` (SameSite Lax).
- One-time tokens (email verification 24 hours, password reset 30 minutes): random, hashed, single use. Email links carry them in the URL fragment.
- Email must be verified before issuing a credential or creating an API key.

## Authorisation

Roles `user`, `business`, `issuer`, `admin`. Each route declares the roles it accepts. Holder routes filter by the session user id. Business routes resolve the business from the session user or the API key. Issuer routes expose credential metadata (never claim values) and revocation. Admin routes manage users, businesses, audit and health. There is no public way to obtain issuer or admin rights: use the admin API or `bun run admin:grant`.

## Request protection

- Strict Zod validation, 64 KB body limit, `application/json` required.
- State-changing cookie requests need `X-Requested-With: PostcodeProof` and a permitted `Origin`. Requests carrying a Bearer API key skip the cookie checks and are scoped by key.
- Security headers on every API response: `nosniff`, `no-referrer`, `no-store`, `Cross-Origin-Resource-Policy: same-site`, restrictive Permissions-Policy. No CORS headers are sent, so cross-origin browser calls are not enabled.
- Errors: one JSON shape. Unexpected errors log a short message server-side and return a generic 500.
- Rate limits: see `apps/api/src/*/routes.ts` (login, register, forgot password, refresh, postcode lookup, address writes, credential issuance, link creation, public verification, consent code attempts, API keys, business requests, contact).

## Cryptography

- Address details and credential salts: AES-256-GCM with a random 96-bit nonce per message, additional authenticated data binding the record, and a leading key-version byte. Tampering or a wrong key fails closed with a generic error. Tests cover round trips, tampering, wrong key, wrong context and rotation.
- Claim commitments: keccak256 over a domain-separated canonical encoding of field, per-claim random salt and value.
- Signatures: issuer EIP-191 signature over the credential document hash; EIP-712 typed data for onchain attestations.
- Tokens and API keys: 256-bit random values, stored as keyed hashes. API keys show only a prefix after creation.

## Frontend

React escaping everywhere, no raw HTML, no secrets in `VITE_` variables, no tokens in browser storage, no private keys in the browser, strict CSP in production builds, routes guarded by role (server enforces regardless), no sensitive values written to the console.

## Database

Parameterised SQL, ownership foreign keys, check constraints, append-only audit and verification logs for the application role, least-privilege role migration, and encryption key version columns. See `docs/architecture/database-design.md`.

## Smart contract

Ownable2Step with renounce disabled, owner and issuers kept separate, issuer add/remove/rotate, EIP-712 attestations bound to chain, contract, holder, credential, commitment and expiry, single-use ids and commitments, bounded deadlines and validity, pause for registration only, custom errors, no payable functions, no upgradeability (immutable code keeps the trust model small; replace by deploying a new registry).

## Audit logging

`audit_logs` records sign-ins, failures, lockouts, password and role changes, credential issue and revoke, consent decisions, API key events and admin actions, with an actor role (user, business, issuer, admin) and a hashed IP. No passwords, tokens, keys or address values.

## Not implemented

Multi-factor authentication, CAPTCHA, a shared rate-limit store, KMS-backed signing, automated key rotation, and a deployed registry.
