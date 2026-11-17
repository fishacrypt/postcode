# API reference

Base path: `/api/v1`. JSON in, JSON out.

**Conventions**

- Browser sessions use the `pp_session` cookie. State-changing browser requests must send `Content-Type: application/json` and `X-Requested-With: PostcodeProof` from an allowed origin.
- Business integrations use `Authorization: Bearer pp_live_...` (scopes below). These skip the cookie checks.
- Errors: `{ "error": { "code": "validation_failed", "message": "...", "fields": { "password": "..." } } }`. Common statuses: 400 bad JSON, 401 unauthenticated, 403 forbidden or email unverified, 404 not found, 409 conflict, 413 too large, 415 wrong content type, 422 validation, 429 rate limited (with `Retry-After`), 500 generic.
- Deviations from the original endpoint sketch: public verification takes the token in a POST body (`/verify/link`) so tokens never appear in URLs or logs; there is no `POST /businesses` because business registration creates the profile; there are no wallet-linking endpoints.

## Authentication

| Method and path | Auth | Notes |
| --- | --- | --- |
| `POST /auth/register` | none | `{ email, password, displayName, role: "user"\|"business", businessName? }`. Sets the session cookie, sends a verification email |
| `POST /auth/login` | none | `{ email, password }`. Same error for unknown email and wrong password. Five failures lock for 15 minutes |
| `POST /auth/logout` | session | Ends the current session |
| `POST /auth/refresh` | session | Rotates the session token and extends the idle window |
| `GET /auth/me` | optional | `{ "user": { id, email, displayName, role, emailVerified } }` or `{ "user": null }` |
| `POST /auth/verify-email` | none | `{ token }` |
| `POST /auth/resend-verification` | session | 3 per hour |
| `POST /auth/forgot-password` | none | `{ email }`. Always answers the same way |
| `POST /auth/reset-password` | none | `{ token, password }`. Ends every session |
| `PUT /account/profile`, `POST /account/password`, `POST /account/delete` | session | Profile, password change, account deletion (password required) |
| `GET /security/sessions`, `DELETE /security/sessions/:id`, `GET /security/events` | session | Session management and the holder's own security events |

## Geography and postcodes (public)

- `GET /geo/NG/states`, `GET /geo/NG/states/:code/lgas`: states with ISO codes and their LGAs.
- `GET /postcodes/dataset`: whether a postcode dataset is loaded and its sources.
- `GET /postcodes/:code?state=&lga=`: layered validation, not an address lookup.

```json
{ "validation": {
  "format": { "valid": true, "normalised": "100001", "format": "legacy_6_digit", "reason": null, "statePrefix": null },
  "dataset": { "status": "dataset_unavailable", "record": null },
  "geographic": { "status": "not_assessable", "detail": "No reference data is available to compare this postcode with the state and LGA." },
  "gps": { "status": "not_provided", "accuracyMeters": null, "capturedAt": null },
  "proofOfResidence": "not_established",
  "assuranceLevel": 1 } }
```

## Addresses (role `user`, own records only)

- `POST /addresses`, `GET /addresses`, `GET /addresses/:id`, `PATCH /addresses/:id`, `DELETE /addresses/:id`
- `POST /addresses/:id/validate`: re-run validation (for example after a dataset import).
- `POST /addresses/:id/gps-confirmation`: `{ gps: { latitude, longitude, accuracyMeters, capturedAt } }`. Send only after the holder chose to share a fix.

Body for create and update: `{ country: "NG", state, lga, city, district?, street, buildingNumber, unit?, postcode, additionalInfo?, gps? }`. Responses include the decrypted details for the owner and the latest `validation`. Deleting an address with an active credential returns 409.

## Credentials (role `user`)

- `POST /credentials`: `{ addressId, consent: { accepted: true, statementVersion: "1" } }`. Requires a verified email, at least format-valid postcode, and no geographic conflict. Returns the credential metadata (no claim values):

```json
{ "credential": { "id": "…", "type": "AddressCredential", "version": 1, "status": "active",
  "issuer": { "name": "PostcodeProof", "address": "0x…" },
  "issuedAt": "…", "expiresAt": "…", "credentialHash": "0x…",
  "assurance": { "level": 1, "gpsFix": false, "formatValid": true, "datasetMatch": false,
                 "postcodeFormat": "legacy_6_digit", "proofOfResidence": "not_established" },
  "renewable": false, "addressChanged": false, "anchor": { "status": "not_anchored" } } }
```

- `GET /credentials`, `GET /credentials/:id`
- `POST /credentials/:id/renew`: within 30 days of expiry, after expiry, or when the address changed. The old credential is revoked as superseded.
- `POST /credentials/:id/revoke`: `{ reason? }`. Ends every link for it and notifies the holder. If the credential is anchored, the response includes an issuer-signed permit for submitting the onchain revocation.
- `GET /credentials/:id/presentation?fields=state,lga`: downloadable presentation (document, signature, chosen disclosures).
- `POST /credentials/:id/links`: `{ fields, expiresInHours (1-720), label?, maxUses?, acknowledgeSensitive? }`. Returns the token once: `{ link: { id, token, path: "/verify#<token>", expiresAt, fields } }`. `street` and `buildingNumber` need `acknowledgeSensitive: true`.
- `GET /links`, `DELETE /links/:id`: list and revoke links (the token itself is never returned again).
- `POST /credentials/:id/anchor`: `{ holder, txHash? }`. Without `txHash` returns an EIP-712 attestation to submit to the registry. With `txHash` the API verifies the chain receipt before recording the anchor. Returns `503 registry_not_configured` until `VITE_REGISTRY_ADDRESS` is set.

## Verification

| Method and path | Auth | Purpose |
| --- | --- | --- |
| `POST /verify/link` | none, rate limited | `{ token }`. Returns status, assurance, disclosed fields and the residence notice |
| `POST /verify/credential` | none, rate limited | `{ document, signature, disclosures[] }`. Verifies an offline presentation, including revocation if the credential is known |
| `POST /verify/requests/preview` | session | `{ code }`. Shows the business, purpose and requested fields to the holder |
| `POST /verify/consent` | session | `{ code, approve, fields[], credentialId?, acknowledgeSensitive? }`. Holder approves a subset or declines |
| `POST /verify/disclosure` | business session or API key (`verification:read`) | `{ requestId }`. Returns only the approved fields, for 24 hours |

Public verification response (abridged):

```json
{ "status": "valid", "reference": "57311298",
  "assurance": { "level": 2, "label": "Matched to postcode dataset", "proofOfResidence": "not_established" },
  "notice": "This confirms an address credential was issued and is still valid. It does not prove that the holder lives at the address.",
  "disclosed": [ { "field": "state", "label": "State", "value": "Lagos", "sensitive": false } ],
  "onchain": null }
```

`status` is `valid`, `expired`, `revoked` or `invalid_signature`. Unknown, expired or revoked links all answer `404 link_unavailable`.

## Consent

`GET /consents` lists the holder's consent records (who, which fields, purpose, decision). `GET /verification-history` lists verification events for the holder's credentials without values.

## Businesses (role `business`, or API key where noted)

- `GET /businesses/me`, `PATCH /businesses/me`: profile.
- `POST /businesses/api-keys`: `{ name, scopes?, expiresInDays? }`. Requires a verified email. The key (`pp_live_…`) is shown once. Scopes: `verification:create`, `verification:read`, `credential:verify`.
- `GET /businesses/api-keys`, `DELETE /businesses/api-keys/:id`
- `GET /businesses/usage`: calls per key and day. `GET /businesses/history`: verification history.
- `POST /businesses/verification-requests` (session or key with `verification:create`): `{ reference, purpose, requestedFields[], expiresInHours? }`. Returns the one-time holder `code` once.
- `GET /businesses/verification-requests`, `GET /businesses/verification-requests/:id` (session or key with `verification:read`), `DELETE /businesses/verification-requests/:id` (cancel).

Example:

```bash
curl -X POST https://your-host/api/v1/businesses/verification-requests \
  -H "Authorization: Bearer $PP_API_KEY" -H "Content-Type: application/json" \
  -d '{"reference":"order-1001","purpose":"Confirm delivery area","requestedFields":["country","state"]}'
# give the returned code to the customer, who approves it in PostcodeProof
curl -X POST https://your-host/api/v1/verify/disclosure \
  -H "Authorization: Bearer $PP_API_KEY" -H "Content-Type: application/json" \
  -d '{"requestId":"<id from the first response>"}'
```

There is no endpoint to search or look up addresses.

## Issuer and administrator

- `GET /issuer/credentials`, `POST /issuer/credentials/:id/revoke` (roles `issuer`, `admin`): metadata only, never claim values.
- `GET /admin/users`, `POST /admin/users/:id/role`, `POST /admin/users/:id/status`, `GET /admin/businesses`, `POST /admin/businesses/:id/status`, `GET /admin/audit`, `GET /admin/verification-activity`, `GET /admin/health` (role `admin`).

## Other

`GET /health` (liveness and database check), `POST /contact` (rate limited), `GET /dev/outbox` (development only, requires `ENABLE_DEV_OUTBOX=true`, never available in production).
