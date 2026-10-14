# Gmail delivery foundation

The registration intent is the durable outbox. A Firestore creation trigger enqueues one deterministic Cloud Tasks ID (SHA-256 of the intent path). Only eventId/intentId enter the task payload. Duplicate enqueue is acknowledged; other enqueue failures request trigger retry. Public registration commits its transaction without waiting for Tasks or Gmail.

The private `deliverEmailTask` invokes the existing `deliverRegistrationEmail`. It uses committed recipient/content snapshots and protected capabilities. There is no arbitrary-recipient relay, public worker, inbox reader, domain-wide delegation, bounce processing or second delivery system.

## Transport

`GmailEmailTransport` refreshes OAuth access with the configured offline refresh token and invokes only `users.messages.send` for `me`. Scope: `https://www.googleapis.com/auth/gmail.send`. No readonly/modify/compose scope is requested. A returned wider scope fails closed; operator setup must grant only send.

MIME is multipart/alternative: UTF-8 text/plain and text/html, CRLF, base64 parts wrapped at 76 characters, encoded-word subject and base64url raw encoding. From/To/optional Reply-To accept a single validated ASCII mailbox, not display names or recipient lists. Subject/header injection is rejected. Czech content is preserved. The existing escaped registration templates remain unchanged.

RFC Message-ID and boundary derive from project + intent path; Date derives from intent creation. A retry has identical MIME while configuration is stable. Keep sender and public origin stable for pending intents.

## Delivery and recovery

- pending → processing → sent / failed; transient errors return to pending.
- Five persisted submission attempts maximum; intent age limit 24 hours.
- Backoff starts at 30 seconds, doubles per attempt and caps at 10 minutes.
- A two-minute lease protects concurrency. Active lease/early retry produces a retry response, not ACK; expiry permits recovery. A finishing worker must still own its exact lease.
- Cloud Tasks allows 20 dispatch attempts, 120–600 second backoff, 24-hour retry duration and at most two concurrent dispatches / one dispatch per second. Queue headroom lets a later dispatch terminalize a crash on the fifth provider attempt. Both OAuth and send have 15-second timeouts; function timeout is 60 seconds.
- 429, retryable quota 403, 5xx, network/timeouts and transient protected-envelope reads retry. Revoked/invalid OAuth grants, permanent permission/configuration errors, missing envelopes/keys and invalid payloads fail permanently.
- Malformed successful send responses or loss after acceptance are unknown outcomes and retry within the same bound. Safe allowlisted error codes are stored; response bodies, bearer tokens, MIME and nested exceptions are not.
- Gmail acceptance followed by process death or failed Firestore finalization can yield duplicate physical messages. **Message-ID is not an exactly-once guarantee.** The logical intent is idempotent; Gmail submissions are bounded and may duplicate. No inbox reconciliation is possible with send-only access.
- Sent means Gmail API accepted the request. It does not mean delivered, read or bounce-free.
- Queue/Firestore infrastructure can exhaust its own retry retention during sustained outages. Monitoring must flag old pending/processing intents; this foundation does not claim guaranteed eventual delivery during indefinite outages and performs no automatic historical backfill.
- Email snapshots can arrive out of order. Old completion cannot replace a newer registration summary.

## Local activation preparation — names only, no values

| Name | Storage / binding |
| --- | --- |
| GMAIL_OAUTH_CLIENT_ID | Secret Manager; Gmail worker only |
| GMAIL_OAUTH_CLIENT_SECRET | Secret Manager; Gmail worker only |
| GMAIL_OAUTH_REFRESH_TOKEN | Secret Manager; Gmail worker only |
| EMAIL_TOKEN_KEYRING | Secret Manager; create/replay callable and Gmail worker only |
| GMAIL_SENDER_EMAIL | Invocation environment: dedicated authorized Gmail sender (consumer or Workspace) |
| GMAIL_REPLY_TO | Optional invocation environment: one mailbox |
| EMAIL_PUBLIC_ORIGIN | Invocation environment: exact V2 staging origin |

EMAIL_TOKEN_KEYRING is a JSON object with activeKeyId and keys, a mapping of key IDs to canonical base64-encoded 32-byte AES keys. Keys are generated and provisioned by an authorized operator later, never committed. Retain old key entries for existing envelopes/receipts; seal new messages with activeKeyId. Rotation cannot delete old keys merely because mail was sent: create-response recovery also depends on them. No plaintext fallback exists.

Deployed staging remains email-disabled. The local activation candidate is default-off: no parameter declarations or secret bindings when off. Exact V2 staging activation requires `REGISTRATION_EMAIL_MODE=staging`, canonical UTC `REGISTRATION_EMAIL_ACTIVATED_AT` and one `REGISTRATION_EMAIL_ALLOWED_RECIPIENT`; mismatched projects/emulator signals fail closed. On mode binds the create callable keyring and four private-worker secrets by string names; values are resolved only at invocation. Other recipients create no email intents/envelopes. The worker rejects old/pre-cutoff, other-recipient and team-message intents before lease claim or secret/provider resolution. Historical team-message intents may exist while workers were excluded: there is no backfill, queue sweep or authorization to send them. Actual fixture use additionally requires demo project plus explicit local Firestore host. A cloud project with an emulator host still fails the fixture guard. The real Gmail/Tasks path refuses emulator execution; local tests explicitly inject a fake HTTP provider.

## OAuth and staging deployment checklist — future authorized task only

1. Confirm the dedicated authorized Gmail sender mailbox (consumer or Workspace), optional Reply-To, sender name policy, send-only consent and retention/abuse controls. No new account is created by this code.
2. Configure an appropriate OAuth 2.0 client and exact controlled redirect URI in the existing authorized project. Enable Gmail API. Use the dedicated mailbox with offline access and only gmail.send; retain the refresh token securely. OAuth consent/login is an operator step, not an application admin flow or CI job.
3. Provision the four named secrets and the documented invocation environment, including activation cutoff/single recipient; never paste values into Git, logs, PRs or this report. Confirm keyring rotation/backup and preserve old keys/receipts.
4. Review required Functions/Cloud Tasks/Eventarc APIs and existing billing/quota readiness. No service was purchased/enabled in this task. Confirm least-privilege per-resource task enqueue, service-account act-as, private worker invocation and secret access. The endpoint must remain non-public; no public/allUsers invoker is configured. No IAM change is made here.
5. Verify the exact reviewed merge SHA and green post-merge CI. Obtain separate explicit deployment authorization, then select only the V2 targets required by this implementation. The create callable and worker need coordinated key configuration.
6. Confirm the trigger enqueues successfully, the queue invokes the private worker, and an explicitly authorized synthetic staging registration goes pending → processing → sent. Actual Gmail sending and staging data writes require separate authorization. Verify receipt replay, transient recovery and safe admin status without exposing capabilities.
7. Configure safe monitoring for terminal errors, queue failures and old pending/processing intents, with an operator recovery process after outages. Review quotas before expanding beyond low volume.
8. Plan SPF/DKIM/DMARC and sender-domain checks with the domain administrator. DNS changes, bounce processing, contact/envelope/receipt retention and live abuse policy are future administrative decisions.

No deploy, real OAuth login, actual credentials, Gmail send, DNS/IAM mutation, cloud data change, migration or V1 access occurs during development or CI.

## Offline verification

Unit tests cover MIME/diacritics/raw encoding, headers, scope, success, 429/5xx/quota/invalid_grant, timeout, network and malformed responses, keyring rotation, fail-closed configuration, queue dedup and bounded backoff. Emulator contracts cover registration/update/cancel, leases and concurrency, early retries, maximum attempts, terminal failures, unknown outcomes with visible duplicate submissions, isolated simultaneous intents and secret audit boundaries. The existing browser flow uses the shared task wrapper with fake Gmail and verifies organizer status and the real management CTA.

Official references: [Gmail MIME sending](https://developers.google.com/workspace/gmail/api/guides/sending), [users.messages.send](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/send), [OAuth offline access](https://developers.google.com/identity/protocols/oauth2/web-server#offline), [Firebase task functions](https://firebase.google.com/docs/functions/task-functions).

Current evidence and limits are in [COMPLETION_MATRIX.md](COMPLETION_MATRIX.md). The local activation preparation passed the checks in [EMAIL_ACTIVATION_VALIDATION.md](EMAIL_ACTIVATION_VALIDATION.md); it is not deployed and real OAuth and actual sending remain unperformed. See [EMAIL_ACTIVATION_PLAN.md](EMAIL_ACTIVATION_PLAN.md). External OAuth apps in Testing commonly have seven-day refresh-token expiry for this scope; plan an appropriate consent status before relying on ongoing delivery. [OAuth web-server flow](https://developers.google.com/identity/protocols/oauth2/web-server), [OAuth overview](https://developers.google.com/identity/protocols/oauth2), [Functions environment configuration](https://firebase.google.com/docs/functions/config-env).
