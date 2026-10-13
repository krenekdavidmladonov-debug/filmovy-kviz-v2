# Registration transactional email

This slice implements durable registration email intents, Czech templates, a shared delivery worker and organizer status. The Gmail transport/worker foundation includes Secret Manager bindings and a private Firebase task queue, but current cloud registration email is deliberately disabled. **No real OAuth credentials/key values, deployment, mailbox changes or internet email sends have been performed.** See [GMAIL_DELIVERY.md](GMAIL_DELIVERY.md) for setup prerequisites and the real delivery guarantee.

## Domain operations

| Authorized operation | Logical message |
| --- | --- |
| New anonymous online registration | `registration-confirmed` |
| Actual normalized name/count/email self-service change with the management token | `registration-updated` |
| First successful self-service cancellation | `registration-cancelled` |
| No-op, failed operation, identical operation replay | None |
| Admin manual add/edit, with or without email; any admin cancellation | None |

In the guarded local email runtime, the transaction commits registration, name reservation, capacity counters, email intent and safe organizer summary together. Current cloud callables still commit registration changes, while `enqueueRegistrationEmail` returns outside emulator runtime (`functions/src/email/intent.ts`). Recipient is the server-validated email from that completed operation (format validation, **not** proof of mailbox ownership). Templates use an immutable allowlist of event title/date/time zone/public venue, team name and member count from that operation. Admin, quiz, scoring and staff data never enter email content. Changed/cancelled messages go to the email current at the operation. Delivery does not rerun or roll back registration logic.

Text and HTML are generated together in Czech. HTML escapes every untrusted display value; subjects strip CR/LF. Confirmation contains a private “Spravovat přihlášku” CTA using the existing management route. No remote images or branding dependencies are needed. A message describes its completed operation; it is not a live view of subsequent team changes.

## Existing token and smallest persistence extension

The server still issues a random 256-bit management token. Existing authorization compares its SHA-256 verifier timing-safely. The public create response still contains only that team's event/registration IDs, team name, member count, contact email, status and raw token. Management get/update/cancel responses omit the token. Neither staff login nor an email status grants management access. Legacy registrations and manual null-token records retain their behavior.

Previously the raw token existed only at issuance, so a delivery retry could not reconstruct the same CTA. We now seal that **same token**, without issuing a second kind of management capability, into AES-256-GCM ciphertext in `events/{eventId}/emailSecrets/{intentId}`. A fresh 96-bit nonce and the exact intent path as authenticated additional data bind the envelope to its intended event/message. The envelope contains only version, key ID, nonce, ciphertext and authentication tag. It is separate from registration records and email audit and denied to **all** Firestore client roles. Only the trusted vault reconstructs the transient link. Its fragment keeps the token out of HTTP request paths and referrers.

`TokenVault` accepts injected key material. The synthetic fixture remains behind **both** a `demo-*` project and an explicit localhost Firestore endpoint guard. The protected cloud keyring adapter is implemented, but current registration callables choose a vault only in emulator runtime (`functions/src/registrations/callables.ts`): cloud email has no vault, secret binding, persisted raw-token envelope or queued message. Missing/malformed key material fails closed in the configured vault path, with no plaintext or synthetic-key fallback. Retaining old key IDs preserves existing envelopes/receipts. Activating cloud email requires a reviewed coordinated callable/intent/export change plus the documented configuration; adding secrets alone does not enable it.

## Operation idempotence and response loss

New public forms generate a random 256-bit `requestKey` and retain it only in component memory across failure/retry. Treat it as a short-lived retry capability: never log, persist in browser storage or include it in telemetry. Firestore stores only its hash as the create receipt key in the server-only `registrationOperations` collection. The receipt binds the original normalized payload fingerprint, registration and confirmation intent. An identical concurrent/later replay returns the existing registration and decrypts the same token; a changed payload is rejected. It never creates another team or intent, even after a rename or cancellation. The protected envelope remains after sending so a lost create response can still be recovered. Reload loses this in-memory retry key; the delivered management CTA remains the recovery path.

New management forms send stable `requestId` values for failed/retried updates. Receipts are bound to event, registration and normalized payload, and every replay **first re-verifies the management token**. A delayed replay returns current registration state without overwriting newer state. A no-op also records a receipt, with no intent. Cancellation's accepted-to-cancelled transition itself is transactionally idempotent.

Old callers may omit the new optional retry fields: create retains unique-name protection and update retains equality/no-op protection, but these old requests cannot identify a delayed replay after intervening edits. The updated application uses the explicit retry fields. No historical registration migration or backfill occurs.

## Audit and delivery

`events/{eventId}/emailIntents/{intentId}` is server-only. It holds type, event/registration binding, operation-time recipient/content snapshot, `pending | processing | sent | failed`, attempt count, generic last error, creation/update/sent timestamps and an expiring worker lease. There is **no raw management token, full management URL, provider payload, key or full provider response** in this audit.

The registration's `emailDelivery` contains only the latest intent ID/type/status/server timestamp. Existing staff-only registration reads expose it to the organizer UI; the mapper/UI show status and time. Legacy/manual teams without a message show a dash. No public resend/recipient override/relay API exists. All direct client status/intent writes and audit/secret reads are denied, including to admins and moderators.

`deliverRegistrationEmail` remains the one injected worker primitive. A Firestore creation trigger enqueues an ID-only task; the private task function loads the committed intent. The worker claims a two-minute lease, records processing, increments attempts and reconstructs MIME in memory. Gmail acceptance records sent; transient provider/network/Firestore failures return to pending with bounded backoff, while permanent configuration/credentials failures become terminal failed. At most five provider attempts and a 24-hour intent age are allowed. Provider exception text is never logged or persisted. Queue replays cannot resend terminal intents. Expired leases allow recovery; active leases request task retry. Older workers cannot finalize a newer lease or replace the latest organizer summary.

The transport contract is now **one logical intent with bounded submissions**, not provider exactly-once delivery. Gmail has no send idempotency key or reconciliation available under gmail.send. A stable RFC Message-ID aids correlation but does not guarantee deduplication. Lost/malformed send responses, a crash after Gmail acceptance or failed Firestore finalization may cause duplicate physical messages on retry. The fake Gmail explicitly exercises this possibility. Sent means Gmail API acceptance, never inbox delivery, opening or absence of bounce. Operation snapshots may arrive out of order; no new ordering system is introduced.

## Local verification

`CaptureEmailTransport` is a development module with no deployment export or endpoint. It keeps recipient/subject/text/HTML in memory only, makes no network request and simulates failure before acceptance or after acceptance with response loss. It requires the same demo/local guard and rejects different payloads for an already accepted idempotency key.

Unit tests cover templates, HTML/header injection, authenticated encryption and emulator guards. Rules tests cover all client roles. The emulator contract suite invokes real callable transactions, tests concurrent/delayed retries, wrong tokens, admin exclusions, delivery failure/retry/leases and scans persisted documents/runtime logs for raw capabilities. The versioned browser scenario registers a synthetic team, captures confirmation, opens its real CTA, edits, captures the update, cancels and captures cancellation. It also verifies organizer pending/failed/sent states.

The standard Quality gate runs registration contracts, Gmail worker contracts and the browser scenario through a fake Gmail HTTP adapter on local Auth/Firestore/Functions emulators. CaptureEmailTransport remains available for its deterministic local dedup tests, but its extra guarantee is not attributed to Gmail. No internet provider, SMTP, cloud credentials or deploy step is used. Browser trace/video/screenshots are disabled for capability-bearing flows; secret-phase errors are replaced with stage-only diagnostics and captured messages are never attached to reports.

## Separate future staging task

Use the explicit prerequisites in [GMAIL_DELIVERY.md](GMAIL_DELIVERY.md). Real OAuth consent, secret values, private queue/service IAM, sender/domain verification, retention and public abuse controls still require operator decisions and separate authorization. No backfill, migration or historical email enqueue is implemented. Fake-provider/local PASS is not actual delivery evidence. Current measured scope and remaining boundaries are in [COMPLETION_MATRIX.md](COMPLETION_MATRIX.md).
