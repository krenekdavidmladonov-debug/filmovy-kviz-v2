# Initial Firestore data model

This is a first design, not a migration contract. Fields should be introduced only with validation, rules, and indexes required by an implemented feature.

## Private operational data

### `users/{uid}`

Staff profile: `displayName`, `email`, `disabled`, and timestamps. Authorization is based on server-managed custom claims (`admin` or `moderator`), not a browser-writable role field.

### `quizzes/{quizId}`

Quiz metadata: `title`, `description`, `status` (`draft`, `ready`, `archived`), ownership/audit fields, and timestamps.

Current required fields:

- `schemaVersion` for newly created native roots;
- `title`, `description`, `status`;
- `createdAt`, `updatedAt` as Firestore timestamps;
- `createdBy`, `updatedBy` as trusted actor identifiers;
- `slideCount`, `roundCount`, `questionCount` as denormalized list counters maintained by trusted server/editor workflows.
- `revision` as a monotonic non-negative integer maintained by trusted editor workflows. A missing revision on an untouched migrated document is interpreted as `0` and initialized on its first mutation.

The admin-only `createQuiz` workflow creates an empty private root with `schemaVersion: 1`, `description: ''`, `status: draft`, `revision: 0`, and all three counters at `0`; it does not create placeholder rounds, questions, slides, snapshots, or public projections. Its opaque quiz ID is deterministic for the authenticated admin UID plus client `requestId`. New roots also keep an immutable private `creationFingerprint` over the normalized title, allowing an identical retry to return the same root while rejecting reuse of that request ID for different content. Trusted timestamps and actor fields come from the Function.

V1-migrated drafts may additionally contain private `legacy: { source, metadata }`. Version-2 imports retain only explicitly allowlisted compatibility metadata and extend the same legacy object with source project/collection/ID and export/content fingerprints. It is never copied into a public projection. See tools/migration-v1/CLOUD_IMPORT.md.

Quiz readiness is intentionally not stored on this document. `PreflightResult` is derived from the current bounded private quiz model so it cannot become a stale duplicate truth such as `isQuizValid: true`.

### `quizzes/{quizId}/slides/{slideId}`

Private, globally ordered presentation source. It preserves every V1 slide, including non-question intro, agenda, recap, round content, and end slides. Fields include `position`, `kind`, `isQuestion`, title/text, options, classified media, presentation controls, optional `roundId`, moderator-only fields, and private `legacy.raw`. A private `correctAnswer` may be present for question slides. Public and projector clients never read this collection directly.

The separate slide stream is intentionally lossless, presentation-oriented, and authoritative for editor order. The nested rounds/questions remain an operational projection for the library and future scoring logic. The editor derives its round-first facade rather than migrating this stream. Trusted slide, round, and question Functions refresh known derived fields after every structural mutation while merge-preserving private legacy extensions.

Guided preflight repair does not add a persisted readiness flag or a new collection. A Choice repair receives only an option index, reads the authoritative `options`, and updates the private normalized `correctAnswer` on the slide and its derived private question record. A Video repair updates only normalized `clipStartSeconds` and `clipEndSeconds`. Both retain all other slide fields—including `legacy.raw` and unknown extensions—and increment the parent quiz `revision`. The original V1-derived raw value remains preserved under the private legacy payload.

Known editor fields include `title`, `text`, `moderatorNote`, general string `options`, private `correctAnswer`, classified media references, and the known legacy presentation controls `videoStart`, `videoEnd`, `audioTrigger`, `backgroundOverlay`, `answerOverlay`, and `sourceQuestionNumber`. The projector foundation adds normalized `backgroundImage`, `questionImage`, `answerImage`, `mediaSource`, `clipStartSeconds`, `clipEndSeconds`, and top-level `backgroundOverlay`. It also stores derived `roundTitle`, `questionNumber`, and `questionCount` for an explicit within-round display contract. Compatibility mapping uses legacy media/presentation only when normalized fields are absent. An imported presentation range of exactly `videoStart: 0` and `videoEnd: 0`, with top-level start absent or `0` and no top-level end key, is a legacy unset sentinel rather than a playable zero-length clip: the editor maps it to `null/null`, and an unrelated save retains the existing stored timing keys instead of normalizing or deleting them. The editor supports validated legacy URLs and ready quiz-scoped owned image/audio references; upload metadata and immutable generations are documented in MEDIA_STORAGE.md. `backgroundImage` and `backgroundOverlay` are renderable normalized fields, but the current editor has only partial URL/overlay authoring and no owned-background selection/upload workflow. A new round is represented by an explicit round-header slide with its own `roundId`; the user sees round settings rather than that implementation detail. Unknown slide/media values remain locked or fallback-rendered and are retained rather than guessed.

### `quizzes/{quizId}/rounds/{roundId}`

Round metadata: `title`, `position`, `type` (`classic`, `picture`, `audio`), `slideCount`, `questionCount`, source slide range, and future optional presentation settings.

V1-migrated rounds may contain private `legacy` source metadata. A generated implicit round is explicitly marked when V1 slides precede the first round header.

### `quizzes/{quizId}/rounds/{roundId}/questions/{questionId}`

Private question source: `prompt`, `type` (`text`, `image`, `audio`, `video`, or migration-only `legacy`), `position`, and the private `correctAnswer`. V1-migrated drafts may also carry `sourceSlidePosition`, `options`, `moderatorNote`, classified external `media`, video ranges, an audio trigger, overlays, and private `legacy.raw`. The legacy representation is the minimum lossless extension for V1 `pl`: the editor now presents its confirmed product meaning as locked **Pravda / Lež**, while its storage shape remains legacy-only and non-creatable. This collection is never readable by public/projector clients. The current admin view model selects only supported type, prompt, and position and does not expose the answer or migration metadata to list/detail components.

The local seed uses stable quiz, round, and question IDs. It is development data only and is never copied from production.

### `events/{eventId}`

Authoritative event record implemented by Events Foundation: `schemaVersion`, title/start/time zone, private venue configuration, separate team/people capacities, accepted team/people counters, per-event team-size bounds, registration window/publication/status, lifecycle status, nullable immutable quiz assignment, fixed-point scoring foundation (`unitScale: 2`, `rankingMode: dense`, server-owned `started`), monotonic revision, and trusted audit fields. Staff may read the root; every client write is denied and mutations use trusted Functions.

### `quizSnapshots/{snapshotId}`

The PDF Print Center reads this existing immutable document tree through a trusted Function. Its registration adapter resolves accepted records server-side into transient `PrintTeam { id, name }` values.

### `events/{eventId}/registrations/{registrationId}`

Private accepted/cancelled registration with normalized team name, member count, contact email, management-token hash, timestamps, and cancellation audit metadata. Staff reads are allowed; all browser writes are denied.

Manual team records use this same collection with server-owned `source: manual`, nullable `contactEmail`, null `managementTokenHash`, actor fields, revision and immutable request fingerprint. The deterministic ID reserves the add request per event/staff UID, even after cancellation. Missing source means legacy online; no migration is needed. See `EVENT_TEAM_TOOLS.md`.

### `events/{eventId}/registrationNames/{nameHash}`

Private, server-only uniqueness reservation keyed by a SHA-256 digest of the event-normalized team name. No client can read or write it.

Immutable, private event quiz source for one exact quiz ID and revision. The root stores source identity/counts and a sanitized preflight summary. Nested `slides` preserve all private presentation fields, correct answers, media, and legacy extensions; nested `rounds` preserve ordered round metadata. Direct client writes are denied. A relock creates a new snapshot rather than modifying the old one.

### `events/{eventId}/registrations/{registrationId}`

Private registration: team name, normalized team name, contact person/email/phone, requested size, status, consent metadata, timestamps, and server audit fields. Public clients cannot list or read it.

### `events/{eventId}/teams/{teamId}`

Reserved conceptual path, not used by internal scoring. The canonical team ID for scoring is the existing registration document ID; no parallel team collection is created.

### `sessions/{sessionId}`

Private live-control state. Required fields are `quizId`, safe display copy `quizTitle`, `slideCount`, `status` (`waiting`, `active`, `ended`), `currentSlidePosition`, optional `currentSlideId`, `answerRevealed`, moderator `mediaCommand`, confirmed `mediaPlaybackState`, monotonic `mediaGeneration`, monotonic `revision`, `createdBy`, `updatedBy`, and lifecycle timestamps. Correct answers and raw slides are not duplicated into this document; trusted Functions load the current private ordered slide server-side. Staff may read sessions for control UI, but all direct client writes are denied.

### `events/{eventId}/scores/{scoreId}`

Implemented internal per-team/per-snapshot-round half-point value and monotonic revision. The stable pair key, append-only history child collection, server-only scoreOperations receipts, null/zero distinction and atomic transaction are specified in EVENT_SCORING.md. All client writes are denied; staff-only reads. Score mutations do not publish totals or rankings; separate staff confirmation is required.

### `quizzes/{quizId}/mediaAssets/{assetId}`

Owned assets are implemented at quizzes/{quizId}/mediaAssets/{assetId}: private quiz/asset identity, kind/MIME/size, actor, request fingerprint, expiry and uploading/ready status; finalization records Storage generation and readyAt. Staff may read metadata; only server writes it. Immutable quiz-asset references remain in event snapshots. Objects have no client overwrite/delete path and no automatic cleanup. See MEDIA_STORAGE.md.

## Public/sanitized data

### `publicEvents/{eventId}`

Implemented safe listing data: title, venue display/public location, start time/time zone, coarse registration/availability state, team-size range, revision, and updated timestamp. Exact team/people capacities, quiz assignment/snapshot data, answers, organizer details, and contacts are excluded. Anonymous clients may read/query; all writes are server-only.

### `publicSessions/{sessionId}`

Server-generated projector snapshot: `sessionId`, `status`, `quizTitle`, `slidePosition`, `presentationMode`, `renderMode`, moderator `mediaCommand`, confirmed `mediaPlaybackState`, monotonic `mediaGeneration`, `introGeneration`, `answerRevealed`, `revision`, and `updatedAt`. An active snapshot may add allowlisted `slideKind`, title, text, primitive options, normalized media roles, question numbering, overlay, and clip controls. A selected recap also publishes its non-sensitive `recapQuestionPosition` so transport validation can prove the answer belongs to an explicit selection. In normal AUDIO mode its source is deliberately omitted. `revealedAnswer` and optional answer image exist only for the single selected recap question or the retained compatibility reveal operation. Correct-answer source fields, moderator notes, `legacy`, `raw`, recap overrides, private references, and complete slide/question objects are forbidden.

Anonymous clients may get one document when they already know its random session ID, but cannot list the collection or write any public state. Every state change replaces the whole public document in the same transaction as the private session update, removing stale reveal fields.

### Confirmed interim results

Event-bound sessions add private eventId/snapshotId and an interimResults version/page pointer. Private session child collections interimVersions and interimOperations hold immutable reviewed totals and idempotent audit receipts. The existing public session document contains only the currently published page of at most eight rank/teamName/halfPoints rows plus version/scope/page metadata. There is no public leaderboard subcollection. Hide/end/cancel/archive remove this payload. See [INTERIM_RESULTS.md](INTERIM_RESULTS.md).

## Server-only registration flow

The public client calls a Function. The Function validates shape and limits, checks event state/capacity transactionally, normalizes data, writes the private registration, updates authoritative counters, and returns only a receipt/status. Browser-supplied timestamps, role, status, price, or capacity values are ignored.

## Retention and audit

Transactional registration email adds server-only event child collections `emailIntents` (operation snapshot and safe delivery audit), `emailSecrets` (authenticated ciphertext envelope only) and `registrationOperations` (payload fingerprints and replay receipts). The existing staff-readable registration contains a safe `emailDelivery` summary. Delivery progresses through `pending → processing → sent/failed`, with transient retries returning to pending. Intents store an expiring lease, at most five submission attempts, a nullable next-attempt timestamp and allowlisted error codes; terminal intents are never resent by queue replay. Neither a raw capability nor a secret URL enters those documents. Retention must coordinate encrypted token envelopes, creation receipts and decryption keys before cloud rollout. See [TRANSACTIONAL_EMAIL.md](TRANSACTIONAL_EMAIL.md).

Contact data needs an explicit retention policy before launch. Important mutations should record server-derived actor and timestamp fields. Avoid indefinite logs containing contact data.

## Referee access extension

events/{eventId}/refereeAccess/{accessId} holds server-only label, expiry, version, revoked status, verifier, issuance fingerprint and organizer audit. refereeRateLimits holds server-only hashed-address request windows. Shared scores/history retain staff actorUid compatibility; referee writes use actorAccessId plus actorLabel, with the same scoreOperations receipts. No parallel scores collection or migration is introduced. See [REFEREE_ACCESS.md](REFEREE_ACCESS.md).


Final reveal extends the same event-bound live session with private immutable finalVersions, revisioned finalOperations and an explicitly revealed public page. Staff confirmation, corrections, closure and moderator-only synthetic sound are documented in [FINAL_REVEAL.md](FINAL_REVEAL.md). No Rules, indexes or cloud data change is required by this implementation.

## Event organizational email

Admin-only preview/confirmation creates an immutable emailCampaigns record and recipient snapshots in the existing emailIntents outbox. The shared task worker delivers plain-text organizational messages without management capabilities or changes to registration confirmation status. All client campaign/intent access remains denied; safe history and status are exposed only through fresh-admin callables. Atomic recipient limits, snapshot/idempotence contracts and offline tests: [EVENT_TEAM_EMAIL.md](EVENT_TEAM_EMAIL.md).

## Private migration import journals

`migrationV1Imports/{quizId}` records a staging intent for a multi-batch library import. Its `state/complete` child is created atomically with the final `quizzes/{quizId}` root. Missing completion blocks re-import; the absent quiz root prevents library visibility while private children are staged. All journal client access is denied by existing default-deny Rules. No runtime application changes or synchronization are introduced.
