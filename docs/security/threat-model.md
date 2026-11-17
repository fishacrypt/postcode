# Threat model

Scope: the web app, API, PostgreSQL schema and `CredentialRegistry` contract in this repository. This is the builder's own analysis. It is not an independent audit.

## Assets

1. Holder address details (street, building, GPS) and the salts that unlock claim commitments.
2. Issuer signing key (forged credentials) and encryption keys (database confidentiality).
3. Account credentials, sessions, one-time tokens, business API keys.
4. The integrity of credential status (revocation, expiry).
5. Holder trust: nothing is disclosed without their consent.

## Actors

Anonymous visitor, holder, malicious holder, business (honest or malicious), issuer, administrator, database or backup reader, network attacker, malicious dependency.

## Threats and mitigations

| Threat | Mitigation in this repository | Residual risk |
| --- | --- | --- |
| Account takeover | Argon2id; generic login errors; lockout after 5 failures for 15 minutes; per-IP and per-email limits; email verification; reset tokens hashed, 30 minute lifetime, single use; password reset and change end all sessions; security alert emails | No MFA for any account, including admins (PP-006) |
| Session theft | HttpOnly cookie, only a keyed hash stored server-side, 7-day absolute and 24-hour idle limits, rotation on refresh, session list with remote sign-out, no tokens in localStorage | XSS or a compromised device still steals a live session |
| Credential forgery | Issuer signature over the keccak256 of the canonical document; verifiers check the signature recovers to a trusted issuer; commitments are salted | Issuer key compromise (PP-002) |
| Signature replay | Onchain: EIP-712 domain with chain id and contract address, attestation binds credential id, commitment, holder, expiry and deadline, ids and commitments are single-use. Off-chain: tokens are single-purpose and have optional use limits | Off-chain presentations can be copied by whoever holds them (a bearer property) |
| QR and link token theft | 256-bit random token, hash stored, fragment-only URL, expiry (max 30 days), optional max uses, revocable, minimal disclosure, miss-rate limit | Anyone holding a live link sees its disclosed fields until it expires or is revoked |
| Unauthorised disclosure | Disclosure only through a holder-created link or a holder-approved request; street-level fields need explicit acknowledgement; business sees only approved fields for 24 hours; logs hold field names only | Server holds salts (PP-003) |
| IDOR | Every query is scoped by the session user id; database composite foreign keys refuse cross-user references; public ids are random UUIDs; tests cover cross-user read, change, delete | |
| SQL injection | Parameterised queries only; Zod validation on every body; no dynamic SQL from input | |
| XSS | React escaping, no raw HTML rendering anywhere, strict CSP for production builds (`script-src 'self'`), JSON-only API with `nosniff` | CSP is delivered by meta tag and `public/_headers`; verify your host applies it |
| CSRF | SameSite cookie (Lax in production), required `X-Requested-With` marker, Origin check against `ALLOWED_ORIGINS`, JSON-only content type, API-key routes use bearer tokens | Embedded-frame cookies (`SameSite=None`) are refused in production |
| SSRF | The API makes outbound calls only to the operator-configured email webhook and chain RPC. No user-supplied URL is fetched | Operator misconfiguration |
| API abuse and brute force | Per-IP, per-user and per-key limits on every sensitive route; generic answers for unknown tokens and keys; body size cap (64 KB) | Limiter is in-memory and per process (PP-004). Client IP trust is off unless `TRUST_PROXY=true` |
| Privilege escalation | Role checks on every route; registration cannot create issuer or admin; role changes end the target's sessions; admins cannot demote themselves; no backdoor account | |
| Malicious business | Scopes on API keys, hashed keys, key expiry and revocation, per-key limits, suspension revokes all keys, no address search or lookup endpoint, holder approves each request and each field | A business can still ask for fields and a holder can approve too much; the UI flags street-level fields |
| Issuer key compromise | Signer interface allows a KMS; `TRUSTED_ISSUER_ADDRESSES` supports rotation; contract supports issuer rotation and per-credential revocation by the owner | Local signer keeps the key in process memory (PP-002). No mass-revoke by issuer |
| Encryption key compromise | Versioned keyring and a re-encryption command. New data uses the newest version | Past ciphertext stays readable with the old key until rotated and the old key destroyed |
| Database compromise | Address details and salts are AES-256-GCM encrypted, tokens, keys and sessions stored as hashes, passwords Argon2id, logs hold no values | Plaintext state, LGA, city and postcode are stored; database plus key compromise reveals everything (PP-003) |
| Smart contract access-control failure | Ownable2Step owner separate from issuers, enforced at deployment and later; issuer-only attestations; pause only blocks new registrations; 139 Foundry tests and two reviews with no open findings | Not independently audited. Owner should be a multisig |
| Supply chain | Lockfile, `bun audit` run (see findings), few direct dependencies added | Template dependencies carry open advisories (PP-001) |
| Insecure dependency updates | Pin through the lockfile; review `bun update` diffs; run `bun audit` and the full test suite in CI | No CI configuration ships here |
| Backup exposure | Sensitive columns are ciphertext; keys must be stored separately | Backup procedure is documentation only |
| Logging of personal data | Audit and verification logs hold action names, field names and hashed IPs only; tests assert addresses and tokens never appear; console output avoids request bodies | Operators must keep it that way in their log pipeline |

## Out of scope

Physical security, the user's device, the email provider's security, legal compliance review (NDPR/NDPA), and the correctness of upstream postcode data.
