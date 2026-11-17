# PostcodeProof

> Built with Arc Studio - money-powered apps in minutes

Project memory for future agents and developers.

## What this app does

PostcodeProof is a privacy-first digital address credential platform. Holders add a Nigerian address, validate its postcode, and receive a signed credential that commits to the address without revealing it. They share chosen fields through links, QR codes or consent-based business requests. Businesses use a dashboard or an API. The credential never claims proof of residence.

## Status

Pre-production. Not deployed anywhere. No contract deployed, no transaction sent. See `docs/security/security-findings-register.md` for open findings (two High findings block deployment).

## Layout (deviation from the brief)

The Arc Studio template keeps Vite at the repo root, so the web app is `src/`, not `apps/web`. API is `apps/api/src`. Shared code: `packages/{address,crypto,validation,shared}` imported via `@pp/*` aliases (tsconfig and vite.config.ts). Contracts in `contracts/`, SQL in `database/migrations`, docs in `docs/`.

## Tech stack

React 18, Vite, TypeScript, Tailwind, React Router, TanStack Query, wagmi/viem (anchoring UI only), Bun API with Bun SQL and PostgreSQL 18, Zod, Solidity 0.8.28 with OpenZeppelin 5.6.1 and Foundry.

## Key decisions

- Public verification tokens go in the URL fragment (`/verify#token`) and are posted in a body. Only hashes are stored.
- Credentials hold salted claim commitments only. Claim values and salts are encrypted (AES-256-GCM, versioned keys) in the database.
- Postcode validation is layered (format, dataset, geography, GPS, residence). No dataset is bundled; never fabricate postcode data.
- Digital postcode format (11 characters, e.g. `FC 02 A09 DB 09`) is provisional from one NIPOST example. Only the `FC` prefix is treated as known.
- Native Arc gas is 18-decimal USDC and the ERC-20 is 6 decimals. The registry has no payable functions. Use `@/onchain-money` if value is ever added.
- Postgres jsonb inserts must use `${JSON.stringify(x)}::text::jsonb` (Bun SQL double-encodes a bare `::jsonb` cast).
- Client IP is only trusted from `X-Forwarded-For` when `TRUST_PROXY=true`.

## Running

Postgres container named `postgres` (database `postcodeproof`, test database `postcodeproof_test`). `bun run db:migrate`, `bun run dev:api` (3001), `bun run dev` (5173, proxies `/api`).
Tests: `bun run test` (API, packages, security, frontend), `bun run contracts:test`, `bun run check`. Playwright specs exist but need Chromium system libraries (they did not run in the Studio sandbox).

## Deployed contracts

None.

## Share links

- Use `buildShareLink()` from `src/lib/share.ts` for every link a user copies; keep `installShareSync()` in `src/main.tsx`.
- Bearer secrets belong in the `#fragment` only.
