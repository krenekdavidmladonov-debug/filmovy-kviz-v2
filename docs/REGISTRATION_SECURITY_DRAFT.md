# Registration security — discovery draft

Status: **SECURITY DESIGN, NOT IMPLEMENTATION (2026-09-02)**.

## Decision labels

- **CONFIRMED REQUIREMENT** — required behavior or privacy invariant.
- **RECOMMENDATION** — proposed control to validate with Rules/emulator tests.
- **HUMAN DECISION** — policy required before implementation or production.
- **FUTURE** — intentionally deferred extension.

## Privacy invariants

- **CONFIRMED REQUIREMENT:** Anonymous clients cannot list or read registrations, email addresses, phone numbers, contact people, notes, cancellation tokens, or complete capacity counters.
- **CONFIRMED REQUIREMENT:** Browser input is untrusted. Registration, update, cancellation, acceptance, waitlist promotion, and capacity changes use Cloud Functions.
- **RECOMMENDATION:** Store PII only in `events/{eventId}/registrations/{registrationId}`. `teams` stores display name, roster/scoring state, seat count, and a private registration reference, but no contact fields.
- **RECOMMENDATION:** `publicEvents` exposes only allowlisted event copy and a coarse capacity/registration state. Public responses never reveal whether a particular email, phone, or team already exists.
- **RECOMMENDATION:** Logs, analytics, error details, rate-limit keys, audit records, email jobs, URLs, and document IDs contain no raw contact values.

## Current repository boundary gaps (documented, not fixed here)

- **RECOMMENDATION:** The current recursive Rules match for `events/{document=**}` allows staff reads and direct admin creates/updates/deletes. It predates this feature. Before any authoritative event, registration, capacity, score, audit, or result data is added, replace direct writes with the narrowly scoped Function boundary and emulator tests described here. Otherwise an admin browser could bypass transaction/state validation.
- **RECOMMENDATION:** The current Rules have no `publicEvents` access and the `/events` route is a placeholder; there is no existing anonymous registration endpoint. This is safe-by-default, not missing production behavior to work around.
- **RECOMMENDATION:** Existing `publicSessions/{sessionId}` permits a single-document get only; its subcollections currently fall through to deny. Leaderboard/results children must receive explicit get-only rules while preserving list/write denial.
- **RECOMMENDATION:** Decide moderator contact-read scope before placing registrations under the recursive event match. Do not inherit broad staff visibility accidentally from the current provisional rule.

## Registration contract

### Accepted input and validation

| Field | Recommended server rule |
|---|---|
| team name | required; trim; Unicode NFC; 2–80 visible characters; reject controls/bidi overrides; preserve Czech diacritics |
| contact person | required; trim; Unicode NFC; 2–80 visible characters; reject controls |
| email | required; trim; lowercase domain; max 254 bytes; conservative syntax validation; do not claim mailbox ownership without verification |
| phone | required initially; trim; max 30 characters; normalize to a canonical dialable form where possible; keep original private display form only if needed |
| member count | required integer; event-configured minimum/maximum; never accept NaN/string coercion |
| note | optional; max 1,000 characters; plain text; normalize line endings; escape on rendering |
| consent | explicit booleans and policy version; server timestamp; no prechecked marketing consent |
| idempotency key | random client key with strict format/length; scoped to event and short retention |

- **RECOMMENDATION:** Reject unknown fields and browser-supplied status, role, accepted/waitlisted state, timestamps, counters, price, event title, or capacity.
- **RECOMMENDATION:** Enforce request/body size before parsing and return stable generic error codes with no echo of contact values.
- **HUMAN DECISION:** Confirm minimum/maximum team size, whether phone is mandatory, allowed registration age/consent wording, and whether email verification is required before acceptance.

### Transactional capacity handling

- **RECOMMENDATION:** The registration Function reads the private event in a Firestore transaction, validates lifecycle/deadline/status, reserves a duplicate key, and creates one registration.
- **RECOMMENDATION:** In automatic mode, if `acceptedTeamCount < teamCapacity`, create `accepted` and increment the count atomically. If full and waitlist is enabled, create `waitlisted`; otherwise reject generically as unavailable.
- **RECOMMENDATION:** In manual mode, create `pending`; the explicit staff approval transaction rechecks capacity before changing it to `accepted` and creating/updating the operational team.
- **RECOMMENDATION:** Never use the possibly stale `publicEvents` capacity bucket to decide acceptance. Concurrent last-slot requests serialize on the authoritative counter.
- **RECOMMENDATION:** Cancellation changes the registration/team state and decrements accepted count in one transaction. Waitlist promotion is a separate explicit or policy-driven transaction with its own email job.
- **HUMAN DECISION:** At capacity, either A) close new submissions or B) accept them onto a waitlist. Also decide whether cancellation automatically promotes the oldest eligible waitlisted team or asks staff first.
- **HUMAN DECISION:** In manual approval mode, decide whether pending registrations reserve capacity. Recommendation: they do not; approval always rechecks available capacity.

### Duplicate and idempotency handling

- **RECOMMENDATION:** Separate harmless retries from likely duplicates. An idempotency key returns the original safe receipt for the same canonical request and rejects a conflicting payload.
- **RECOMMENDATION:** Build a server-only duplicate key from normalized event ID + email + team name using HMAC with a server secret/pepper. Never use a raw email as a document ID. Reserve that key transactionally in `registrationKeys`.
- **RECOMMENDATION:** Default duplicate policy: one active registration per canonical email/team pair per event. Staff may merge/override through an audited Function.
- **RECOMMENDATION:** Public duplicate responses are deliberately indistinguishable from accepted-for-processing responses to prevent email/team enumeration. Send any actionable detail to the already registered address.
- **HUMAN DECISION:** Decide whether the same contact may register multiple differently named teams and whether team-name uniqueness is strict, warning-only, or staff-resolved.

### Update and cancellation

- **RECOMMENDATION:** Confirmation email contains an opaque, high-entropy management token. Store only its hash, scope, expiry, and generation. Prefer a URL fragment followed by a one-time server exchange so the bearer value does not enter ordinary request logs or referrers.
- **RECOMMENDATION:** Public management endpoints return minimal registration state and allow only narrowly defined edits. Team-name/member-count changes re-run duplicate and capacity rules.
- **RECOMMENDATION:** Rotate management tokens after sensitive use, invalidate older generations, and make cancellation idempotent. A cancelled token cannot resurrect or alter a registration.
- **HUMAN DECISION:** Define the self-service edit/cancellation deadline and which changes require staff approval after registration acceptance.

## Abuse protection

- **RECOMMENDATION:** Require Firebase App Check with a production-grade web attestation/reCAPTCHA mechanism for anonymous registration; treat it as one signal, not authorization.
- **RECOMMENDATION:** Apply layered server limits per event, keyed-HMAC network prefix, App Check identity, idempotency key, and normalized contact fingerprint. Use short burst and longer rolling windows with TTL.
- **RECOMMENDATION:** Add a honeypot and minimum form-completion time only as low-confidence signals. Do not block accessibility tools solely on browser behavior.
- **RECOMMENDATION:** For suspicious requests, require an interactive challenge or hold for manual review. Do not reveal which signal triggered.
- **RECOMMENDATION:** Cap total pending/waitlisted registrations, note size, management-token attempts, and email sends per event/contact. Add a server kill switch that pauses registration and campaigns.
- **RECOMMENDATION:** Rate-limit confirmation resend and make its response generic. Never let a caller turn the service into an arbitrary-address mail relay.
- **HUMAN DECISION:** Set operational thresholds only after emulator/load testing and early staging observation; values should be configurable server-side without a client release.

## Referee QR and capability model

### Credential and redemption

- **CONFIRMED REQUIREMENT:** `eventId` in a URL is not authorization, and a referee must not become an admin or moderator merely by scanning a QR code.
- **RECOMMENDATION:** Generate at least 256 random bits for each referee capability. The QR carries a public capability ID plus secret. Store only `SHA-256(secret)` (sufficient for a uniformly random high-entropy secret), event ID, scopes, expiry, generation, and revoke state.
- **RECOMMENDATION:** Put the secret in the URL fragment (`/referee/redeem#...`) and exchange it immediately through a Function, then remove it from browser history. Enforce HTTPS, `Referrer-Policy: no-referrer`, and no third-party resources on the redemption page.
- **RECOMMENDATION:** The phone signs in with Firebase anonymous auth only to obtain a device-bound UID. Successful redemption creates `refereeGrants/{uid}` scoped to one event and capability generation with `scores:read` and `scores:write`, short expiry, and last-used metadata.
- **RECOMMENDATION:** Firestore direct writes remain denied. Score reads/writes use callables that verify the grant, event, scope, expiry, revoke generation, event lifecycle, and App Check. The grant never places `admin`/`moderator` custom claims on the user.
- **RECOMMENDATION:** Referee-safe reads contain event title, current/available rounds, team display names, score values/revisions, and save status only. They exclude contacts, registration notes, organizer secrets, quiz source, and correct answers unless a separate explicitly approved answer-key scope is ever introduced.

### Leakage, replay, and sharing

- **RECOMMENDATION:** Raw QR tokens are never logged, stored in analytics, placed in query strings, or returned after exchange. Compare hashes in constant time and rate-limit failed redemption by capability ID and network signal.
- **RECOMMENDATION:** Capability rotation increments a generation and invalidates every grant derived from the prior generation. Admin/moderator can revoke immediately; event completion expires all grants.
- **RECOMMENDATION:** Default to one active device grant per QR. A replacement redemption revokes the old grant or requires an explicit staff reset. This limits screenshot sharing but may slow device handover.
- **RECOMMENDATION:** Show active referee devices and last activity to staff, with a one-click revoke. Keep audit metadata structural; do not collect invasive device fingerprints.
- **HUMAN DECISION:** Choose A) one-device QR, B) multi-device QR with a redemption limit, or C) one-device QR plus a short staff-disclosed PIN. Recommendation: C for production events if operationally acceptable.
- **HUMAN DECISION:** Choose token lifetime and whether referee access starts immediately or only after a moderator activates scoring. Recommendation: expire no later than event end plus a short correction window.

## Threat model

| Threat | Primary mitigation | Residual/operational control |
|---|---|---|
| anonymous registration spam | App Check/challenge, layered limits, caps, server validation | pause switch and manual review |
| scraping contacts | no public registration reads; contacts only in private docs | Rules tests and access audit |
| forged referee token | 256-bit secret, stored hash, constant-time verify | failed-attempt limits and alerts |
| token leakage | fragment exchange, no logs/referrer/analytics, short expiry | rotate/revoke and active-device view |
| replayed QR/token | device-bound grant, generation, one-device policy | optional PIN and staff reset |
| QR screenshot sharing | one active device and short event window | optional second factor; cannot be eliminated for a bearer QR |
| score tampering | scoped callable, event/state validation, integer bounds | immutable audit and correction reason |
| concurrent scoring/lost update | expected per-score revision + transaction | conflict UI reload, never last-write-wins |
| unauthorized leaderboard writes | server-only derivation and complete allowlist replacement | Rules deny all client writes |
| ID enumeration | random IDs; generic responses; deny list on private collections | rate limits; IDs confer no authority |
| Firestore direct access | default deny; narrow role/grant reads; no sensitive direct writes | emulator tests for every role/cross-event case |
| email abuse | allowlisted templates/audiences, outbox, quotas, no arbitrary recipient API | campaign kill switch and delivery audit |
| malicious notes/copy | length/control validation, plain-text storage, contextual escaping | no raw HTML templates |
| stale public state | Function-owned projection, whole-document replacement, revision | projector rejects older/cache-only snapshots |

## Firestore/Functions authorization boundary

| Actor | May read | May request/write | Explicitly denied |
|---|---|---|---|
| anonymous public | safe `publicEvents`; known public session/projection docs | registration and management endpoints with token/App Check | private events, registrations, teams, scores, quiz, answers; every direct write |
| referee grant | referee-safe event/round/team/score view for one event | score create/correct through scoped Function | contacts, notes, answer key, quiz editor/live admin, other events, direct writes |
| moderator | operational events, teams, registrations needed for event operation, scores/audit, private sessions | registration decisions, check-in, scoring, referee revoke/create, leaderboard/results/live commands through Functions | user/role management, unrestricted destructive/admin operations, direct authoritative writes |
| admin | all necessary private administration data | event configuration/lifecycle, staff-authorized operations through Functions | direct writes where a trusted workflow exists; secrets in Firestore/client |
| server worker | only collections required by its service identity/function | validated transactions, projections, outbox/artifacts | broad data exports/logging; production access outside approved environment |

- **RECOMMENDATION:** Moderator access to registration contacts should be a deliberate operational permission, not a side effect of authentication. If moderators do not handle registrations/check-in, remove it.
- **RECOMMENDATION:** Use server-side role and resource checks even when Rules already permit a read. Authenticated does not mean authorized.

## Required emulator tests before enabling access

- **RECOMMENDATION:** Anonymous/unprivileged users cannot get/list private events, registrations, teams, scoring, capabilities, grants, jobs, quiz snapshots, or audit.
- **RECOMMENDATION:** Public event/list queries return only allowlisted documents; public clients cannot write or infer exact contacts/capacity.
- **RECOMMENDATION:** Registration tests cover last-slot concurrency, closed/deadline races, duplicate/idempotent retries, waitlist disabled/enabled, cancellation, and malicious fields.
- **RECOMMENDATION:** Referee tests cover wrong event, expired/revoked/old generation, second device, forged token, direct write attempts, cross-event reads, invalid scores, and correction conflicts.
- **RECOMMENDATION:** Moderator/admin tests cover role distinctions and every sensitive Function independently, not only route guards.
- **RECOMMENDATION:** Projection tests assert forbidden field names/values never appear before reveal and stale fields disappear on replacement.

## Retention and incident response

- **HUMAN DECISION:** Define retention separately for contacts, consent evidence, message delivery metadata, referee grants, score audits, public results, and PDFs before production.
- **RECOMMENDATION:** On expiry, delete or anonymize contact fields and generated PDFs while retaining only the minimum legitimate non-PII event result/audit record.
- **RECOMMENDATION:** Document procedures for leaked QR revocation, abusive registration pause, email campaign cancellation, and accidental public projection. These controls must be usable during an event without a deploy.
