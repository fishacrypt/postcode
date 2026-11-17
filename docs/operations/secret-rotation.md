# Secret rotation and first-time generation

## Rule zero

Any secret that ever existed in an earlier PostcodeProof project (keys, `.env` files, RPC tokens, database passwords, issuer wallets) is compromised. Do not read, copy, import or reuse it. Generate everything new. A historical-data migration, if ever wanted, needs its own reviewed migration and re-encryption plan; nothing is imported automatically.

## Generate new values

```bash
openssl rand -hex 32          # APP_ENCRYPTION_KEY (and each new key version)
openssl rand -hex 32          # APP_HASH_PEPPER
cast wallet new               # issuer key pair (or create the key in your KMS). Keep the private key out of shell history
openssl rand -base64 24       # database role passwords
```

Put them in your secret manager and inject them as environment variables. `.env` is for local development only and is ignored by Git. `.env.example` holds placeholders (`CHANGE_ME_...`) that the API refuses to start with.

## Rotation schedule (suggested)

| Secret | Routine | Immediately when |
| --- | --- | --- |
| Data encryption key | Yearly | Suspected exposure, staff change with access |
| Pepper | Rarely (forces sign-out and new API keys) | Database and pepper both exposed |
| Issuer key | Yearly | Suspected exposure |
| Database passwords | Quarterly | Suspected exposure |
| Mail webhook secret | Per provider guidance | Suspected exposure |
| Registry owner multisig signers | Per governance policy | Signer device lost |

## Procedures

- Data key: `key-management.md`, "Rotating the data key".
- Issuer key: `key-management.md`, "Rotating the issuer key".
- Pepper: change `APP_HASH_PEPPER`, restart, tell business users to create new API keys. All sessions end.
- Database role password: change in PostgreSQL, update the secret, rolling restart.

## Verify after rotation

Sign in, issue a test credential, open a verification link, create and use a test API key, send a reset email, then check `GET /api/v1/admin/health` for the expected key version and issuer address.
