# PostcodeProof

Your Address. Verified. Yours.

PostcodeProof lets people create a digital address credential, check their Nigerian postcode, and share only the details a business needs. Businesses can ask for consent-based verification through a dashboard or an API. The first release covers Nigeria only.

**Status: pre-production.** It builds and its automated tests pass, but it has not had an independent security review and must not be deployed before one. See `docs/security/security-findings-register.md`.

## Tech stack

- Web: React 18, Vite, TypeScript, Tailwind CSS, React Router, TanStack Query
- API: Bun, TypeScript, Zod, PostgreSQL (Bun SQL, parameterised queries)
- Contracts: Solidity 0.8.28, OpenZeppelin, Foundry
- Chain tooling: viem, wagmi (Arc Testnet and Mainnet configuration only; nothing is deployed)
- Tests: Bun test, Foundry, Playwright

## Repository layout

```
src/                 Web app (Vite is configured at the repository root)
apps/api/src/        API server, services, scripts
packages/            address (country modules), crypto, validation, shared
contracts/           CredentialRegistry.sol and Foundry tests
database/            Versioned SQL migrations and rollback scripts
tests/               integration, security, frontend and e2e tests
docs/                architecture, security, privacy, API and operations guides
```

## Development

Prerequisites: Bun 1.3+, Docker (for PostgreSQL) and Foundry (for contracts).

```bash
bun install
docker run -d --name postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=postcodeproof \
  -v pgdata:/var/lib/postgresql -p 5432:5432 postgres:18-alpine
cp .env.example .env     # then replace every CHANGE_ME value (see docs/operations/secret-rotation.md)
bun run db:migrate
bun run dev:api          # API on :3001
bun run dev              # web on :5173, proxies /api to the API
```

### Environment variables

Names and purposes only. Values are never committed. `.env.example` has placeholders.

- `PORT`, `NODE_ENV`: API port and mode.
- `DATABASE_URL`: PostgreSQL connection string.
- `APP_ENCRYPTION_KEY`, `APP_ENCRYPTION_KEYS`, `APP_ENCRYPTION_KEY_VERSION`: encryption keys for address details and credential salts.
- `APP_HASH_PEPPER`: secret used to hash tokens, API keys and IP addresses.
- `ISSUER_PRIVATE_KEY`: credential issuer signing key. `TRUSTED_ISSUER_ADDRESSES` lists earlier issuers still accepted after rotation.
- `ALLOWED_ORIGINS`, `SESSION_COOKIE_MODE`, `APP_BASE_URL`, `TRUST_PROXY`: browser origin, cookie and reverse-proxy settings.
- `MAILER`, `MAIL_WEBHOOK_URL`, `ENABLE_DEV_OUTBOX`: email delivery (development mode writes to `.dev-mail/`).
- `VITE_REGISTRY_ADDRESS`, `ANCHOR_CHAIN_ID`: optional onchain anchoring. Public values only.
- `RPC_PROXY_BASE_URL`, `RPC_PROXY_TOKEN`, `RPC_PROXY_CHAINS`: optional RPC proxy configuration. Public RPC is used when no proxy is configured.

### Commands

```bash
bun run check            # lint (type-aware) and typecheck
bun run test             # API, package, security and frontend component tests
bun run test:web         # frontend component tests only
bun run test:e2e         # Playwright journeys (needs Chromium system libraries and both dev servers)
bun run contracts:test   # all Foundry tests
bun run db:migrate       # apply pending migrations
bun run postcodes:import # load a verified postcode dataset (see docs/architecture/address-module.md)
bun run admin:grant      # operator command to set a role (there is no public admin signup)
bun run keys:rotate      # re-encrypt stored data under the newest key version
bun run notify:expiry    # send credential expiry reminders (run daily)
bun run build            # production web build
bun run start:api        # production API (needs a production environment)
```

## What needs external configuration

- A verified Nigerian postcode dataset. None is bundled, so postcodes are checked for format only until you import one.
- An email service (webhook). Development mode only writes to a local file.
- A key management service for the issuer key and encryption keys in production.
- A deployed registry contract, if you want onchain anchoring. Nothing is deployed by this repository.

## Documentation

Start with `docs/architecture/system-architecture.md`, then `docs/security/threat-model.md` and `docs/api/api-reference.md`.
