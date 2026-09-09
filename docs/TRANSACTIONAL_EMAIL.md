# Registration transactional email

This slice implements durable registration email intents, Czech templates, a trusted delivery primitive and organizer status. There is **no cloud transport, provider configuration, API key, scheduler, trigger or email callable**. No email is sent outside the local capture process. This is not a deploy-ready email service.

## Domain operations

| Authorized operation | Logical message |
| --- | --- |
| New anonymous online registration | `registration-confirmed` |
| Actual normalized name/count/email self-service change with the management token | `registration-updated` |
| First successful self-service cancellation | `registration-cancelled` |
| No-op, failed operation, identical operation replay | None |
| Admin manual add/edit, with or without email; any admin cancellation | None |

The existing transaction commits registration, name reservation, capacity counters, email intent and safe organizer summary together. Recipient is the server-validated email from that completed operation (format validation, **not** proof of mailbox ownership). Templates use an immutable allowlist of event title/date/time zone/public venue, team name and member count from that operation. Admin, quiz, scoring and staff data never enter email content. Changed/cancelled messages go to the email current at the operation. Delivery does not rerun or roll back registration logic.

Text and HTML are generated together in Czech. HTML escapes every untrusted display value; subjects strip CR/LF. Confirmation contains a private “Spravovat přihlášku” CTA using the existing management route. No remote images or branding dependencies are needed. A message describes its completed operation; it is not a live view of subsequent team changes.

## Existing token and smallest persistence extension

The server still issues a random 256-bit management token. Existing authorization compares its SHA-256 verifier timing-safely. The public create response still contains only that team's event/registration IDs, team name, member count, contact email, status and raw token. Management get/update/cancel responses omit the token. Neither staff login nor an email status grants management access. Legacy registrations and manual null-token records retain their behavior.

Previously the raw token existed only at issuance, so a delivery retry could not reconstruct the same CTA. We now seal that **same token**, without issuing a second kind of management capability, into AES-256-GCM ciphertext in `events/{eventId}/emailSecrets/{intentId}`. A fresh 96-bit nonce and the exact intent path as authenticated additional data bind the envelope to its intended event/message. The envelope contains only version, key ID, nonce, ciphertext and authentication tag. It is separate from registration records and email audit and denied to **all** Firestore client roles. Only the trusted vault reconstructs the transient link. Its fragment keeps the token out of HTTP request paths and referrers.

`TokenVault` accepts injected key material. This PR wires only a clearly synthetic, project-bound emulator fixture, behind **both** a `demo-*` project and an explicit localhost Firestore endpoint guard. That public test fixture is not a cloud encryption key. Cloud create fails closed with a generic precondition until a real key resolver is implemented and explicitly configured. There is no fallback key and no production/staging key provisioning in this PR. A provider outage is independent of this prerequisite: a configured vault lets registration commit pending mail without contacting a transport.

## Operation idempotence and response loss

New public forms generate a random 256-bit `requestKey` and retain it only in component memory across failure/retry. Treat it as a short-lived retry capability: never log, persist in browser storage or include it in telemetry. Firestore stores only its hash as the create receipt key in the server-only `registrationOperations` collection. The receipt binds the original normalized payload fingerprint, registration and confirmation intent. An identical concurrent/later replay returns the existing registration and decrypts the same token; a changed payload is rejected. It never creates another team or intent, even after a rename or cancellation. The protected envelope remains after sending so a lost create response can still be recovered. Reload loses this in-memory retry key; the delivered management CTA remains the recovery path.

New management forms send stable `requestId` values for failed/retried updates. Receipts are bound to event, registration and normalized payload, and every replay **first re-verifies the management token**. A delayed replay returns current registration state without overwriting newer state. A no-op also records a receipt, with no intent. Cancellation's accepted-to-cancelled transition itself is transactionally idempotent.

Old callers may omit the new optional retry fields: create retains unique-name protection and update retains equality/no-op protection, but these old requests cannot identify a delayed replay after intervening edits. The updated application uses the explicit retry fields. No historical registration migration or backfill occurs.

## Audit and delivery

`events/{eventId}/emailIntents/{intentId}` is server-only. It holds type, event/registration binding, operation-time recipient/content snapshot, `pending | sent | failed`, attempt count, generic last error, creation/update/sent timestamps and an expiring worker lease. There is **no raw management token, full management URL, provider payload, key or full provider response** in this audit.

The registration's `emailDelivery` contains only the latest intent ID/type/status/server timestamp. Existing staff-only registration reads expose it to the organizer UI; the mapper/UI show status and time. Legacy/manual teams without a message show a dash. No resend/recipient override/relay API exists. All direct client status/intent writes and audit/secret reads are denied, including to admins and moderators.

`deliverRegistrationEmail` is an internal, explicitly injected worker primitive, not an exported Firebase endpoint. It claims a two-minute lease transactionally, increments attempts, reconstructs content in memory, and calls `EmailTransport.send` with a stable intent-path idempotency key. Success records `sent`; any transport/crypto error records only `delivery-unavailable` and `failed`. Provider exception text is never logged or persisted. Expired leases allow crash recovery. Competing workers cannot finalize each other's lease, and finishing an older message cannot overwrite a newer organizer summary. Delivery retry never creates a new intent.

The transport contract **requires durable deduplication of accepted messages**, including acceptance followed by a lost response. Plain SMTP without reconciliation cannot meet it. This is one logical message per intent, not an unconditional claim of exactly-once physical delivery by arbitrary providers. The eventual adapter must prove its deduplication retention window covers all allowed retries, keep the configured link origin stable, and reconcile uncertain acceptance before resending. `sent` means transport acceptance, not inbox delivery, opening or absence of later bounce.

## Local verification

`CaptureEmailTransport` is a development module with no deployment export or endpoint. It keeps recipient/subject/text/HTML in memory only, makes no network request and simulates failure before acceptance or after acceptance with response loss. It requires the same demo/local guard and rejects different payloads for an already accepted idempotency key.

Unit tests cover templates, HTML/header injection, authenticated encryption and emulator guards. Rules tests cover all client roles. The emulator contract suite invokes real callable transactions, tests concurrent/delayed retries, wrong tokens, admin exclusions, delivery failure/retry/leases and scans persisted documents/runtime logs for raw capabilities. The versioned browser scenario registers a synthetic team, captures confirmation, opens its real CTA, edits, captures the update, cancels and captures cancellation. It also verifies organizer pending/failed/sent states.

The standard Quality gate runs both email contracts and browser capture on local Auth/Firestore/Functions emulators. No provider, SMTP, cloud credentials or deploy step is used. Browser trace/video/screenshots are disabled for capability-bearing flows; secret-phase errors are replaced with stage-only diagnostics and captured messages are never attached to reports.

## Separate future staging/provider task

Before any cloud rollout, explicitly authorize and implement:

1. Real protected key provisioning/resolution and key rotation (retain decryption of old pending/receipt envelopes); never use the emulator fixture. The current cloud registration precondition must be replaced with this reviewed integration before deploying create.
2. A provider adapter with acceptance reconciliation/deduplication, verified sender/domain and secrets available only to the trusted worker; a fixed allowlisted V2 link origin.
3. A bounded dispatch schedule, retry/backoff/maximum age, ordering policy for older operation snapshots and monitoring of safe statuses. No automatic worker is active yet.
4. Coordinated retention/deletion of contact snapshots, encrypted capabilities, retry receipts and old keys; do not delete a receipt and accidentally recreate a completed operation on replay.
5. Public registration abuse limits and mailbox/delivery policy, bounce handling, permissions and separately authorized synthetic staging verification.

This task makes no deployment, migration, remote data change or actual email send. The project estimate remains **88%**.
