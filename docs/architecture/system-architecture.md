# System architecture

## Components

| Component | Location | Role |
| --- | --- | --- |
| Web app | `src/` | React single-page app: public site, holder dashboard, business dashboard, issuer and admin pages |
| API | `apps/api/src/` | Bun HTTP server exposing `/api/v1`. Owns authentication, validation, credential issuance and verification |
| Address module | `packages/address` | Country-independent address interface plus the Nigeria module |
| Crypto | `packages/crypto` | Canonical JSON, salted claim commitments (isomorphic) and AES-256-GCM encryption with a versioned keyring (server only) |
| Validation | `packages/validation` | Zod schemas shared by the web app and API |
| Database | `database/migrations` | PostgreSQL schema, least-privilege grants, rollback scripts |
| Registry contract | `contracts/CredentialRegistry.sol` | Optional onchain anchor for credential commitments and revocation. Not deployed by this repository |

Deviation from the suggested layout: the Arc Studio template keeps the Vite app at the repository root, so the web app lives in `src/` instead of `apps/web/`. Shared code is imported through the `@pp/*` aliases (tsconfig and Vite).

## Request flow

1. The browser calls `/api/v1/*` on its own origin. In development Vite proxies `/api` to the API on port 3001.
2. The API router applies security headers, loads the session from the `pp_session` cookie (hashed lookup), checks origin and CSRF marker for state-changing cookie requests, then the route handler validates the body with Zod.
3. Handlers use parameterised SQL through Bun SQL. Sensitive values are encrypted before they reach the database.
4. Responses use one error shape: `{ "error": { "code", "message", "fields?" } }`. Unexpected errors return a generic 500 without stack traces.

## Credential model

- A credential document contains salted commitments to each claim (country, state, LGA, city, district, postcode, street, building number), the assurance level, issue and expiry dates and a random per-credential subject reference. It contains no claim values.
- The issuer signs the keccak256 hash of the canonical document. The same hash is the value that can be anchored onchain.
- Claim values and their salts are stored encrypted. A holder discloses a subset by revealing value and salt for chosen fields. A verifier recomputes the commitment and compares.
- The credential states that proof of residence is **not established**. Assurance levels describe address validation only (see `address-module.md`).

## Verification paths

- Public link: a random 32-byte token is created by the holder. Only its hash is stored. The link is `/verify#<token>` (fragment, so it is not sent in the URL to servers or referrers). The page posts the token in a request body. Limits: expiry, optional maximum uses, revocation, rate limits.
- Presentation file: the holder downloads a JSON presentation. Anyone can submit it to the API to check signature, expiry, revocation and disclosed claims.
- Business request: a business creates a request and receives a one-time code. The holder previews it, chooses which requested fields to share and approves or declines. The business can then fetch only the approved fields, for 24 hours.

## Roles

`user`, `business`, `issuer`, `admin`. Registration only creates `user` or `business`. Other roles are assigned by an admin or by the operator command `bun run admin:grant`. See `docs/security/security-controls.md`.

## Onchain anchoring (optional)

The API signs an EIP-712 attestation for a holder wallet. The holder submits it to the registry, then reports the transaction hash, which the API checks against the chain before recording the anchor. With no registry configured the endpoint returns `registry_not_configured`. No contract is deployed by this repository and no transaction is sent by the API.

## Known architectural limits

- Rate limiting and the dev outbox are in-memory and single-process. A multi-instance deployment needs a shared limiter.
- The issuer key is held in process memory by the local signer. The signer interface exists so a KMS or HSM can replace it, but no such implementation ships.
- The salts that make selective disclosure possible are held by the server on the holder's behalf. A database plus encryption-key compromise therefore exposes claim values (see the threat model).
