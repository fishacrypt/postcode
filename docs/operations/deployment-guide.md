# Deployment guide (preparation only)

**Do not deploy until the checklist in `docs/security/security-audit-checklist.md` is complete.** The build and the automated tests passing does not make the system production-ready. Nothing here has been deployed.

## Topology

- Static web build served from a CDN or web server that applies `public/_headers` (or equivalent): `bunx vite build` writes `dist/`. Serve `index.html` for unknown paths (single-page routing).
- API process: `bun run start:api` (listens on `PORT`). Put it behind a reverse proxy that terminates TLS and routes `/api/*` to it on the same origin as the web app (the session cookie is first-party). Set `TRUST_PROXY=true` only if that proxy appends the client address to `X-Forwarded-For`.
- PostgreSQL 15 or later (tested on 18) with the `pp_app` role.
- An email service that accepts a JSON webhook (`MAIL_WEBHOOK_URL`).

## Steps

1. Create a new environment with new secrets (see `secret-rotation.md`). Never copy a `.env` from another environment.
2. Create the database and two roles: an owner role for migrations and `pp_app` for the API (`database-design.md`).
3. Run migrations with the owner role: `DATABASE_URL=<owner url> bun run db:migrate`. Check `schema_migrations`.
4. Set the production environment: `NODE_ENV=production`, `DATABASE_URL` (pp_app), `APP_ENCRYPTION_KEYS`, `APP_HASH_PEPPER`, `ISSUER_PRIVATE_KEY` (or your KMS signer once implemented), `ALLOWED_ORIGINS=https://your-app-origin`, `MAILER=webhook`, `MAIL_WEBHOOK_URL`, `APP_BASE_URL`. The API refuses to start in production with the dev mailer, the embedded cookie mode, or no allowed origins.
5. Start the API and check `GET /api/v1/health` (returns `{ ok: true }` when the database answers).
6. Create the first administrator: register normally, then run `bun run admin:grant <email> admin` on the server. There is no other path to admin.
7. Import a licensed postcode dataset (`address-module.md`).
8. Schedule `bun run notify:expiry` daily.
9. Build and publish the web app. Confirm the CSP and HSTS headers are present on responses.

## Environment validation

`apps/api/src/config.ts` validates the environment at start-up and fails fast with a message that never prints secret values. Tests cover the production refusals.

## Logging

The API writes short operational lines to stdout (start-up, migrations, unexpected errors without request bodies). Collect stdout in your platform's log service. Do not add request-body logging. Audit events are in the `audit_logs` table, not in stdout.

## Onchain (optional, separate decision)

Deploying `CredentialRegistry` is out of scope here. If you choose to: follow `arc-network-configuration.md`, deploy from a throwaway wallet with an owner multisig and a distinct issuer, run the Foundry suite on Arc Foundry, then set `VITE_REGISTRY_ADDRESS` and `ANCHOR_CHAIN_ID`.

## Limitations to remember

Single-process rate limiting (PP-004), no MFA (PP-006), local issuer key (PP-002). See the findings register.
