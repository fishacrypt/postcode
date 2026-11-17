# Key management

## Keys and secrets

| Secret | Variable | Protects | Where it should live in production |
| --- | --- | --- | --- |
| Data encryption keys | `APP_ENCRYPTION_KEYS` (or `APP_ENCRYPTION_KEY`) | Street-level address data and credential salts | Secret manager or KMS-wrapped data keys, never in the database or repository |
| Hash pepper | `APP_HASH_PEPPER` | Session tokens, API keys, request codes, IP hashes | Secret manager |
| Issuer signing key | `ISSUER_PRIVATE_KEY` | Credential signatures and onchain attestations | KMS or HSM behind the `IssuerSigner` interface |
| Registry owner | none (a multisig) | Issuer set, pause, ownership of the registry | Multisig wallet, never the API server |
| Deployer | none | Deploying the registry | A separate, throwaway wallet |
| Database role password | in `DATABASE_URL` | Database access | Secret manager |

The four onchain roles stay separate: owner (multisig), issuer (signing service), deployer (one-off) and the end user. The contract enforces owner and issuer separation.

**All secrets from any earlier PostcodeProof project must be treated as compromised. This repository contains none of them, reads none of them, and generates new values for every environment.** Generate new values with `openssl rand -hex 32` (keys, pepper) and a fresh key pair for the issuer. Never reuse a value between environments.

## Encryption design

- AES-256-GCM, random 96-bit nonce per message, 128-bit tag, additional authenticated data binds each ciphertext to its record (so a blob copied to another row fails to decrypt).
- Blob layout: `[key version (1 byte)] [nonce] [tag] [ciphertext]`. The key version is also stored in `encryption_key_version` columns.
- The keyring (`EnvKeyring`) loads `version:hex` pairs from the environment. The highest version encrypts new data. Every version listed can still decrypt.
- Errors from decryption are a single generic error that carries no key, plaintext or record detail.
- `KeyProvider` and `IssuerSigner` are interfaces. A KMS-backed implementation can replace the environment-based ones without touching callers. None ships yet.

## Rotating the data key

1. Generate a new 32-byte key. Set `APP_ENCRYPTION_KEYS="1:<old>,2:<new>"` and deploy. New writes use version 2.
2. Run `bun run keys:rotate --dry-run`, then `bun run keys:rotate`. Each row is re-encrypted in a transaction.
3. When no rows remain on version 1, remove it from the environment and destroy it.
4. Take a fresh backup after step 3. Older backups still need the old key to be restored.

If a key is suspected compromised, rotate immediately, then treat the data as exposed to anyone who held both a database copy and the old key.

## Rotating the issuer key

1. Generate a new issuer key. Add the **old** address to `TRUSTED_ISSUER_ADDRESSES` and deploy with the new `ISSUER_PRIVATE_KEY`. Old credentials keep verifying, new ones are signed by the new key.
2. If a registry is deployed, the owner multisig calls `rotateIssuer(old, new)`. Existing anchored credentials stay valid.
3. If the old key was **compromised**, do not keep it trusted: remove it from `TRUSTED_ISSUER_ADDRESSES`, re-issue legitimate credentials, and have the owner revoke any suspicious anchored credentials individually. There is no mass-revoke by issuer.

## Rotating the pepper

Changing `APP_HASH_PEPPER` invalidates all sessions, API keys and pending tokens. Plan it as a forced sign-out and re-issue API keys. Do it after a suspected database plus secret exposure.

See `docs/operations/secret-rotation.md` for the operational checklist.
