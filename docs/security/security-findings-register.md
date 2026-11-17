# Security findings register

Prepared by the builder at the end of the implementation. **This is not an independent audit and no independent audit has taken place.** Passing automated tests does not mean the system is secure. Do not deploy until a separate, thorough security review is complete and every Critical and High finding is resolved. Medium findings must be resolved or formally risk-accepted by the owner of the deployment.

Date: 17 November 2026. Evidence sources: `bun audit`, the test suites, the contract reviews, and manual review of the code.

## Open findings

| ID | Severity | Component | Description | Evidence | Impact | Recommended remediation | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| PP-001 | High | Dependencies | `bun audit` reports 37 advisories (16 high, 15 moderate, 6 low), almost all transitive through packages that come with the Arc Studio template (Circle SDKs, wallet connectors, a Firebase-based wallet SDK, Solana libraries, `vite-plugin-node-polyfills`). PostcodeProof's own code imports none of the Circle SDKs. Direct packages added here (`zod` 4.6.7, `qrcode`, `react-router-dom`) are not flagged | `bun audit` output, run during the build | Vulnerable code present in the install and possibly in the browser bundle | Remove unused SDKs from `package.json`, run `bun update`, re-run `bun audit`, add it to CI, review the production bundle for what actually ships | Open. Blocks deployment |
| PP-002 | High | Issuer key | The issuer private key is read from the environment and held in process memory by `LocalKeySigner`. Anyone who can read the process environment can forge credentials | `apps/api/src/security/signer.ts`, `config.ts` | Credential forgery until detected and rotated | Implement an `IssuerSigner` backed by a KMS or HSM, restrict who can read the environment, alert on unusual issuance rates | Open. Blocks deployment |
| PP-003 | Medium | Privacy design | The server keeps each credential's claim values and salts (encrypted) so holders can build presentations later. A reader of the database who also has the encryption key can read claim values. Plaintext state, LGA, city and postcode are also stored | Database design doc, `credentials.claims_blob` | Disclosure of address details after a combined database and key compromise | Keep keys in a KMS separate from the database, rotate on a schedule, consider holder-held salts in a later version | Open. Needs risk acceptance |
| PP-004 | Medium | Rate limiting | The limiter is in-memory and per process. A second instance or a restart resets counters | `security/ratelimit.ts` | Brute-force and abuse limits weaken when scaled out | Use a shared store (for example Redis) and also limit at the edge | Open. Needs risk acceptance if a single instance is run |
| PP-005 | Low | Passwords | No breached-password check; complexity rules only | `packages/validation` | Weak but compliant passwords | Check against a breached-password service or list | Open |
| PP-006 | Medium | Authentication | No multi-factor authentication for any account, including admin and issuer | Code review | Password theft gives administrative access (admins cannot read addresses but can change roles and revoke credentials) | Add TOTP or passkeys, require them for admin and issuer | Open. Needs risk acceptance |
| PP-007 | Medium | Testing | Playwright journeys are written but were **not executed**: the build sandbox lacks Chromium system libraries (`libnspr4`) | Playwright launch error, `tests/e2e` | End-to-end regressions are not covered by a passing run | Run `bun run test:e2e` locally or in CI with `playwright install --with-deps` | Open |
| PP-008 | Medium | Process | No independent review of the application or the contract. The contract had two automated reviews and a 139-test suite | Review reports | Unknown defects | Commission an independent audit of both before any deployment | Open. Blocks deployment |
| PP-009 | Low | Authentication | Registration answers `409 email_in_use`, which reveals whether an email has an account | `auth/routes.ts` | Account enumeration | Return a neutral response and send a mail either way | Open |
| PP-010 | Low | Cookies | Development uses `SameSite=None` cookies so the preview frame works. Production config refuses this mode | `config.ts` | None if the production setting is respected | Keep `SESSION_COOKIE_MODE` unset or `standard` in production | Open |
| PP-011 | Low | Frontend | The CSP is applied to production builds only, allows inline styles (React and the template watermark need them) and `frame-ancestors` cannot be set by a meta tag | `vite.config.ts`, `public/_headers` | Reduced XSS defence in depth in development | Apply the header from the host, remove inline styles later | Open |
| PP-012 | Low | Address data | The LGA list was not reconciled with an official publication | `packages/address` | Wrong or missing LGAs | Reconcile with the National Population Commission or INEC list | Open |
| PP-013 | Medium | Postcode data | No postcode dataset is loaded, so no credential can reach assurance level 2 or 3 until one is imported and the dataset terms are confirmed | `docs/architecture/address-module.md` | Credentials certify format only | Obtain and import a licensed NIPOST dataset | Open (external dependency) |
| PP-014 | Low | Postcode format | The 11-character digital postcode pattern is derived from one published example | NIPOST page, 7 October 2026 | May reject or accept the wrong codes | Update when NIPOST publishes the full specification and state codes | Open |
| PP-015 | Medium | Smart contract | Any issuer and the owner can revoke any credential, and an issuer or owner key can disrupt credentials; there is no per-issuer mass-revoke | `CredentialRegistry.sol` NatSpec, tests | Availability of credential status under key compromise | Multisig owner, KMS issuers, monitoring of `CredentialRevoked` events | Open. Needs risk acceptance |
| PP-016 | Low | Operations | No CI, no automated dependency or secret scanning in this repository | Repository | Regressions and leaked secrets are caught late | Add CI running `bun run check`, `bun run test`, `forge test`, `bun audit` and a secret scanner | Open |

## Resolved during the build

| ID | Severity | Component | Description | Evidence | Resolution |
| --- | --- | --- | --- | --- | --- |
| PP-R1 | High | Registry contract | The owner could later add itself as an issuer, or an issuer could accept ownership, merging the separated roles | Functional review of `CredentialRegistry.sol` | Custom error and checks in `addIssuer`, `rotateIssuer`, `acceptOwnership`. Re-reviewed with no findings. Tests added |
| PP-R2 | Medium | API | `X-Forwarded-For` was trusted unconditionally, so a client could spoof its address and escape per-IP limits | Manual review | Trusted only with `TRUST_PROXY=true` and then only the last entry. Security test added |
| PP-R3 | Medium | Postcode validation | Checking a postcode with a state but no LGA reported a false geographic conflict and lowered assurance | Found by sampling real API output | Compare only the fields provided. Unit test added |
| PP-R4 | Low | Database | Ownership between credentials, addresses and tokens relied on application checks only | Design review | Composite foreign keys in migration 003, tests insert cross-user rows directly |

## Not tested

Load and denial-of-service behaviour, browser XSS fuzzing, penetration testing, backup and restore drills, behaviour behind a real reverse proxy, email provider integration, any deployed contract.
