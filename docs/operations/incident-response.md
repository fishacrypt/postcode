# Incident response

A starting runbook. Adapt owners and contact details to your organisation. Notification duties under the Nigeria Data Protection Act 2023 and any contract are yours to confirm with counsel.

## Severity

- **SEV1**: suspected exposure of address data or keys, forged credentials, admin account takeover.
- **SEV2**: service outage, contained abuse by a business, suspicious spike in verification requests.
- **SEV3**: single-account issues, minor bugs.

## First hour

1. Name an incident lead. Start a timeline.
2. Contain, using the controls that exist:
   - Suspend a business: `POST /admin/businesses/:id/status` (revokes all its keys).
   - Suspend a user: `POST /admin/users/:id/status` (ends their sessions).
   - Revoke credentials: issuer or admin revoke endpoints; holders can revoke their own.
   - Force sign-out of everyone: `DELETE FROM sessions;`.
   - Disable issuance: stop the API or remove the issuer key from the environment.
3. Preserve evidence: copy `audit_logs` and `verification_logs` (they hold no address values), application logs, and database snapshots.

## Scenarios

| Scenario | Actions |
| --- | --- |
| Issuer key exposed | Stop issuing. Generate a new key, follow `key-management.md` (compromised path). Re-issue legitimate credentials, ask the registry owner to revoke suspicious anchored ones. Publish a notice |
| Encryption key exposed | Rotate (`bun run keys:rotate`), assess whether a database copy was also exposed. If yes, treat claim values and address details as disclosed and notify per policy |
| Database exposed | Assume emails and plaintext state, LGA, city and postcode are exposed. Rotate the pepper (invalidates sessions and API keys), rotate data keys, force password resets if hashes may be attacked |
| Admin account takeover | Suspend and re-secure the account, review `audit_logs` where `actor_role = 'admin'`, undo role changes and suspensions, rotate any secrets the admin could reach |
| Malicious business | Suspend, review `verification_logs` for its activity, tell affected holders which fields were released |
| Dependency advisory | Run `bun audit`, patch, run the full test suite, redeploy |

## After

Write a post-incident review with root cause, timeline, user impact and fixes. Add a test for the failure where possible and update the findings register.
