# Data protection

This describes what the software does. It is not legal advice. Have counsel review it against the Nigeria Data Protection Act 2023 and any other law that applies before launch.

## What is collected and where it lives

| Data | Why | Storage |
| --- | --- | --- |
| Email, display name | Account, security notices | Plain in `users` and `user_profiles` |
| Password | Sign-in | Argon2id hash only |
| State, LGA, city, postcode | Validation, credential metadata | Plain columns in `addresses` |
| Street, building, unit, district, notes | Address details the holder enters | Encrypted blob (AES-256-GCM, versioned key) |
| GPS fix (only if the holder chooses) | Optional confirmation | Inside the encrypted blob |
| Claim values and salts | Lets the holder build presentations | Encrypted blob on the credential |
| Session, token and API key secrets | Authentication | Keyed hashes only |
| Audit and verification events | Security and accountability | Action names, field names, hashed IP, no values |
| Business profile and API key metadata | Business accounts | Plain, key hashes only |

## Never onchain

Full address, phone number, email, GPS, claim values, credentials in plaintext, passwords or identity data. The registry stores only: credential id, a hash commitment, the holder wallet address, issuer address, expiry and issue timestamps and a revoked flag. A wallet address is public and can be linked to its holder by anyone who knows the wallet. Tell users that before they anchor.

## Minimal disclosure

Public verification and business results contain only fields the holder chose. Street and building number need an extra acknowledgement. A scan of a QR code returns the fields chosen for that link and nothing else, and no endpoint searches addresses. Links expire, can be limited to a number of uses, and can be revoked.

## Retention and deletion

- Deleting an address wipes encrypted claim values from non-active credentials issued from it. Active credentials block the deletion until revoked.
- Deleting an account removes the user's addresses, credentials, sessions, tokens and profile by cascade. Audit rows keep the action name with a null user.
- Revoked and expired credential documents (commitments only, no values) remain so that verification can report "revoked" or "expired".
- There is no automatic retention schedule or data export endpoint yet. Define retention periods and add export before launch.

## Honest limits

- A credential proves that an address was validated to the stated assurance level and that PostcodeProof issued the credential. It does not prove residence. Screens, emails and verification responses say so.
- Without an imported postcode dataset, validation is format-only.
- The server holds encrypted claim values. See finding PP-003.

## Processors and transfers

The app itself uses PostgreSQL and an email service you configure through a webhook. No analytics or advertising trackers are included. Web fonts are loaded from Google Fonts in the browser, which discloses visitor IP addresses to that provider. Self-host the fonts if that is not acceptable.
