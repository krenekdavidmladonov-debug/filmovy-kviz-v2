# Initial Firestore data model

This is a first design, not a migration contract. Fields should be introduced only with validation, rules, and indexes required by an implemented feature.

## Private operational data

### `users/{uid}`

Staff profile: `displayName`, `email`, `disabled`, and timestamps. Authorization is based on server-managed custom claims (`admin` or `moderator`), not a browser-writable role field.

### `quizzes/{quizId}`

Quiz metadata: `title`, `description`, `status` (`draft`, `ready`, `archived`), ownership/audit fields, and timestamps.

Current required fields:

- `title`, `description`, `status`;
- `createdAt`, `updatedAt` as Firestore timestamps;
- `createdBy`, `updatedBy` as trusted actor identifiers;
- `slideCount`, `roundCount`, `questionCount` as denormalized list counters maintained by trusted server/editor workflows.
- `revision` as a monotonic non-negative integer maintained by trusted editor workflows. A missing revision on an untouched migrated document is interpreted as `0` and initialized on its first mutation.

V1-migrated drafts may additionally contain private `legacy: { source, metadata }`. This field preserves V1 quiz metadata that does not yet have a native V2 field and is never copied into a public projection.

### `quizzes/{quizId}/slides/{slideId}`

Private, globally ordered presentation source. It preserves every V1 slide, including non-question intro, agenda, recap, round content, and end slides. Fields include `position`, `kind`, `isQuestion`, title/text, options, classified media, presentation controls, optional `roundId`, moderator-only fields, and private `legacy.raw`. A private `correctAnswer` may be present for question slides. Public and projector clients never read this collection directly.

The separate slide stream is intentionally lossless, presentation-oriented, and authoritative for editor order. The nested rounds/questions remain an operational projection for the library and future scoring logic. Editor Functions refresh their known derived fields after a slide mutation while merge-preserving private legacy extensions.

Known editor fields include `title`, `text`, `moderatorNote`, general string `options`, private `correctAnswer`, classified media references, and the known presentation controls `videoStart`, `videoEnd`, `audioTrigger`, `backgroundOverlay`, `answerOverlay`, and `sourceQuestionNumber`. Storage upload is intentionally outside Editor V1; media edits accept validated URLs/references only. A new round is represented by an explicit round-header slide with its own `roundId`. Unknown slide/media values remain locked or fallback-rendered and are retained rather than guessed.

### `quizzes/{quizId}/rounds/{roundId}`

Round metadata: `title`, `position`, `type` (`classic`, `picture`, `audio`), `slideCount`, `questionCount`, source slide range, and future optional presentation settings.

V1-migrated rounds may contain private `legacy` source metadata. A generated implicit round is explicitly marked when V1 slides precede the first round header.

### `quizzes/{quizId}/rounds/{roundId}/questions/{questionId}`

Private question source: `prompt`, `type` (`text`, `image`, `audio`, `video`, or migration-only `legacy`), `position`, and the private `correctAnswer`. V1-migrated drafts may also carry `sourceSlidePosition`, `options`, `moderatorNote`, classified external `media`, video ranges, an audio trigger, overlays, and private `legacy.raw`. The legacy representation is the minimum lossless extension for V1 slide types such as the observed but semantically unresolved `pl`. This collection is never readable by public/projector clients. The current admin view model selects only supported type, prompt, and position and does not expose the answer or migration metadata to list/detail components.

The local seed uses stable quiz, round, and question IDs. It is development data only and is never copied from production.

### `events/{eventId}`

Authoritative event record: quiz reference, venue/time, capacity, registration status, lifecycle status, and audit fields. Staff access only.

### `events/{eventId}/registrations/{registrationId}`

Private registration: team name, normalized team name, contact person/email/phone, requested size, status, consent metadata, timestamps, and server audit fields. Public clients cannot list or read it.

### `events/{eventId}/teams/{teamId}`

Operational team: display name, check-in state, seat count, scoring state, and private registration reference. It does not duplicate contact details.

### `sessions/{sessionId}`

Private live-control state. Required fields are `quizId`, safe display copy `quizTitle`, `slideCount`, `status` (`waiting`, `active`, `ended`), `currentSlidePosition`, optional `currentSlideId`, `answerRevealed`, monotonic `revision`, `createdBy`, `updatedBy`, and lifecycle timestamps. Correct answers and raw slides are not duplicated into this document; trusted Functions load the current private ordered slide server-side. Staff may read sessions for control UI, but all direct client writes are denied.

### `events/{eventId}/sessions/{sessionId}/scores/{teamId}`

Per-team totals and round breakdown. Writes are staff/server only; final public rankings are projected separately.

### `media/{mediaId}`

Private metadata: Storage path, content type, size, checksum, owner, processing state, usage references, and timestamps. A raw Storage path does not imply public access.

## Public/sanitized data

### `publicEvents/{eventId}`

Safe listing data: title, venue display name, start time, public capacity state (`open`, `few_left`, `full`, `closed`), deadline, and public description. Contact details are excluded.

### `publicSessions/{sessionId}`

Server-generated projector snapshot: `sessionId`, `status`, `quizTitle`, `slidePosition`, `answerRevealed`, `revision`, and `updatedAt`. An active snapshot may add allowlisted `slideKind`, title, text, primitive options, sanitized prompt/background media, and presentation controls. `revealedAnswer` and optional answer image exist only while `answerRevealed == true`. Correct-answer source fields, moderator notes, `legacy`, `raw`, recap overrides, private references, and complete slide/question objects are forbidden.

Anonymous clients may get one document when they already know its random session ID, but cannot list the collection or write any public state. Every state change replaces the whole public document in the same transaction as the private session update, removing stale reveal fields.

### `publicSessions/{sessionId}/leaderboard/{teamId}`

Sanitized team display name, rank, and score when publication is enabled. No registration reference or contact data.

## Server-only registration flow

The public client calls a Function. The Function validates shape and limits, checks event state/capacity transactionally, normalizes data, writes the private registration, updates authoritative counters, and returns only a receipt/status. Browser-supplied timestamps, role, status, price, or capacity values are ignored.

## Retention and audit

Contact data needs an explicit retention policy before launch. Important mutations should record server-derived actor and timestamp fields. Avoid indefinite logs containing contact data.
