# Pre-deployment security checklist

Tick each item with evidence (a link, command output or ticket). Unchecked means not done.

## Gate

- [ ] Independent security review of the application and the registry contract completed; report stored.
- [ ] No open Critical or High finding in `security-findings-register.md`. Every Medium finding resolved or risk-accepted in writing by the deployment owner.

## Secrets and keys

- [ ] All secrets generated fresh for this environment. No value reused from any earlier project or environment.
- [ ] `.env` is not in version control; secret scanning runs in CI.
- [ ] Issuer key lives in a KMS or HSM (PP-002). Encryption keys live in a secret manager.
- [ ] Rotation drill performed for the data key, the issuer key and the pepper.
- [ ] Registry owner is a multisig; deployer is a throwaway wallet; owner and issuer are different addresses.

## Application

- [ ] `NODE_ENV=production`, `SESSION_COOKIE_MODE` unset or `standard`, `ALLOWED_ORIGINS` set, `MAILER=webhook`, `ENABLE_DEV_OUTBOX` unset.
- [ ] `TRUST_PROXY=true` only if a proxy you control appends the client address.
- [ ] HTTPS everywhere, HSTS, and `public/_headers` (or equivalent) applied by the host, including `frame-ancestors`.
- [ ] Rate limiting backed by a shared store or edge limits (PP-004).
- [ ] MFA for admin and issuer accounts (PP-006).
- [ ] Admin and issuer accounts created with `bun run admin:grant` only for named people.
- [ ] Email provider configured, SPF, DKIM and DMARC set, reset and verification mails tested.

## Data

- [ ] A licensed postcode dataset imported with its provenance (PP-013), LGA list reconciled (PP-012).
- [ ] API runs as `pp_app`; migrations run as a separate owner role. Role test passes.
- [ ] Encrypted backups, key storage separated from backups, a restore drill completed.
- [ ] Log pipeline checked: no request bodies, no tokens, no address values.
- [ ] Privacy notice and terms reviewed by counsel for the Nigeria Data Protection Act 2023.

## Verification

- [ ] `bun run check`, `bun run test`, `bun run contracts:test` pass on the release commit.
- [ ] `bun run test:e2e` passes in an environment with a browser (PP-007).
- [ ] `bun audit` clean of Critical and High (PP-001).
- [ ] Production bundle reviewed for unexpected dependencies and for any secret.
