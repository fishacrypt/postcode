# Consent model

Consent is explicit, specific to a purpose and a recipient, limited in time, and recorded.

## Moments of consent

1. **Credential issuance.** The holder reviews the address and its validation result and ticks the statement that PostcodeProof may issue a credential committing to those details. The API rejects issuance without it. A `consent_records` row stores the statement version and time.
2. **Public link.** Creating a link is the consent. The holder picks fields, a lifetime (1 hour to 30 days) and optionally a maximum number of uses. The link works for anyone who holds it until it expires, is used up or is revoked. Street and building number need a second acknowledgement.
3. **GPS.** The browser is asked for location only after the holder presses the button. Nothing runs in the background. The result is stored with the address, never published.
4. **Business request.** A business creates a request that states its name, a purpose and the fields it wants. It gets a one-time code that it passes to the customer. The holder enters the code, sees who is asking, why, and which fields, and can untick fields or decline. Only approved fields are released, only to that business, for 24 hours after approval. The decision is recorded with the field names and purpose.
5. **Withdrawal.** Holders can revoke any link, revoke the credential, and see every consent and verification event under Privacy and consent and Verification history.

## What a business can and cannot do

Can: request listed fields, read approved fields during the window, see its own history and usage.
Cannot: search or list addresses, read fields the holder withheld, read a result after the window, create requests with a suspended account or revoked key.

## What is recorded

Who (holder id, business id), when, purpose text, field names, decision. Values are never written to consent, verification or audit logs.

## Gaps

There is no per-business standing consent or consent expiry reminder. The consent statement text is a single version (`1`). Have counsel review the wording.
