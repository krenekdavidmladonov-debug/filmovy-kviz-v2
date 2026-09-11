# Security

## Core invariants

1. Correct answers never reach public/projector clients before reveal.
2. Public clients cannot read private quiz sources, registrations, contacts, or staff data.
3. `request.auth != null` is authentication, not administrative authorization.
4. Staff privileges are explicit `admin` or `moderator` custom claims set only by trusted server tooling.
5. Sensitive state changes are validated and authorized server-side.
6. Firestore and Storage start deny-by-default; access is added narrowly and tested in emulators.
7. Production access and deployment require explicit user approval.

## Preventing answer leakage

The projector reads only one `publicSessions/{sessionId}` document. The trusted `buildPublicSessionState` allowlist builds this projection from private quiz data. In ordinary question mode it copies only explicitly safe title/text/options, normalized visual media, and presentation controls; AUDIO source is omitted entirely. In explicit recap mode it adds only the selected question's display-form `revealedAnswer` and allowed answer image—not the private slide or question. Hiding an answer in React state, CSS, a network response, an error, or an unread UI branch is not acceptable.

The projector ignores inbound BroadcastChannel presentation state entirely. Only Firestore may supply a slide or an explicitly reviewed interim-results page. The projector rejects cache-only data, stale revisions and foreign sessions, invalidates old callbacks, and performs a fresh server read on reconnect. Channel player lifecycle reports contain only session ID, generation and an allowlisted state; authenticated staff and the trusted Function still validate them.

Every navigation, reveal, hide, and end operation replaces the entire public document in the same transaction as the private update. Navigation resets `answerRevealed`; therefore old answer fields cannot survive through merge semantics. The projector rejects Firestore cache-only snapshots and clears itself on browser offline events so a disconnected client does not continue showing an old revealed answer.

Private answer media must use protected paths or server-controlled delivery; prompt and answer media must not share guessable unrestricted URLs.

## Authorization

- `admin`: full administration, including roles and destructive lifecycle operations.
- `moderator`: event operation, registration/check-in, live control, and scoring within allowed scope.
- public: read explicitly public documents and invoke narrowly defined registration endpoints only.

Custom claims are the staff authorization source. Functions independently verify claims and resource scope; they do not trust client-supplied roles.

### Current administrative policy

The web `AuthProvider` reads `role` from the verified Firebase ID token and uses it only to select routes and UI. Firestore Rules independently read `request.auth.token.role` and remain the data authorization boundary.

Current Firestore access is intentionally narrow:

- anonymous and ordinary authenticated users cannot read or write private collections;
- moderators and admins can read private `quizzes` and their slide/round/question subcollections;
- every direct client quiz write is denied to both roles; admin editor writes exist only as trusted callable Functions;
- event roots are staff-readable, unknown event subpaths are denied, and every event write is denied to clients; admin-only callable Functions own event mutations;
- immutable quiz snapshots are staff-readable private data and every direct client write is denied;
- `publicEvents` is anonymously readable/queryable sanitized data with every client write denied;
- private event registration records are staff-readable, direct-write denied; uniqueness reservations are server-only;
- existing media policy remains staff-read and admin-write until that flow is revisited;
- staff profiles are self-readable, while all user management is admin-only;
- staff may read private `sessions`, but all client writes are denied;
- anyone may get one known `publicSessions` document, collection listing is denied, and every client write is denied;
- every other path falls through to deny.

Moderator quiz writes are not enabled. The editor route is read-only for moderators, and all editor callables independently require the `admin` claim. Quiz creation accepts only a bounded title and request ID, derives the opaque document ID from the authenticated admin plus that request ID, and creates one private empty draft in a transaction. Its private creation fingerprint makes an identical retry idempotent and rejects reuse for a different title. No client chooses actor fields, timestamps, status, revision, counters, snapshot, or public projection. Each future operational write must be introduced as a narrowly scoped trusted workflow and accompanied by emulator tests.

The quiz library and live-control UI query private documents only after staff authentication. Correct answers remain in private slide/question documents and may also be present inside private `legacy.raw`. The library mapper omits them; the moderator live preview may show only the current top-level private answer to staff. Anonymous projector code has no query path to `quizzes` or `sessions`.

Live callable Functions independently require an `admin` or `moderator` custom claim. Quiz editor callables require `admin` specifically, including quiz creation and the round duplicate/move/remove and question reorder/move operations. Existing-quiz mutations validate identifiers, positions, supported edit shapes, round removal mode/destination, media schemes, quiz/slide existence, transaction size, and the caller's `expectedRevision`; creation instead validates its bounded idempotency request before any document exists. Function success responses contain only IDs, revision, and counters; errors and application logs contain no slide, question, answer, note, or raw data.

Editor preview is not a publication operation. It renders the current unsaved, already-authorized private draft inside the admin route and may optionally show the answer there, but it never creates or mutates `publicSessions`. The anonymous projector still receives only the live allowlist projection. Unknown fields and `legacy.raw` never enter the editor mutation response or projector model. A separate projector window for unsaved drafts is intentionally absent until an isolated non-live transport is designed.

Quiz preflight is also a private staff-only read operation. Its result contains codes, Czech human messages, aggregate counts, and semantic references, but never embeds correct-answer values, question copy, media URLs, moderator notes, or `legacy.raw`. Running readiness in the editor is local and running it before live start does not write `publicSessions`; only the existing explicit live-session callable may publish its independently sanitized allowlist. The preflight feature changes neither Rules nor projector/BroadcastChannel authority.

Guided repair keeps the same route guard but does not treat it as write authorization. The `repairQuizPreflightIssue` callable requires an `admin` claim, an exact current quiz revision, an existing authoritative question, and one strict discriminated request shape. Choice requests carry only `optionIndex`; the server verifies that the current option exists and uniquely identifies one stored value before assigning it privately. Video requests carry only finite numeric START/END values satisfying `0 <= START < END <= 86400` and are accepted only for a current Video question with a source. Unknown request fields are rejected. Moderator and ordinary-user writes fail, direct Firestore writes remain denied, success responses contain no private value, and the callable never touches `publicSessions` or BroadcastChannel code. The browser removes a repair issue only after a fresh private reload proves that shared preflight no longer reports it.

Event lock uses that same shared quiz-domain/preflight implementation inside an admin-only transaction. It rereads the expected event and quiz revisions, rejects blockers, requires explicit warning acknowledgement, creates a complete private immutable snapshot, derives `ready`, and replaces the safe public event projection atomically. Browsers cannot submit readiness, assignment, snapshot data, scoring state, revisions, actors, timestamps, or public fields. Snapshot answers stay private and never enter `publicEvents`; existing `publicSessions` answer authority is unchanged.

The PDF endpoint verifies an ID token, resolves the snapshot from the private event, accepts only allowlisted document settings, and returns a bounded `no-store` PDF. Admins may generate all PDFs. Moderators may generate answer-free team sheets and score tables but are denied the answer key. Anonymous, ordinary authenticated, and projector clients are denied. Questions, answers, options, contacts, media sources, notes, and legacy data are excluded from logs.

## Public registration

Manual team add/edit is admin-only and shares transactional capacity and name reservations with online registrations. Its nullable token verifier never authorizes public access; manual records have no public management capability. Public requests cannot choose manual origin or bypass their email/window requirements. See `EVENT_TEAM_TOOLS.md`.

Registration uses callable Functions rather than direct Firestore writes. It validates fields/types, normalization/limits, contact format, team-size bounds, server-time window, unique names, and both capacities transactionally. Management tokens are random bearer capabilities; registration records store only SHA-256 verifiers and invalid combinations are non-enumerating. Transactional email retains the same token only in a separate authenticated ciphertext envelope, denied to every client role. Email intents/receipts remain server-only; staff receive only safe delivery status through the registration. No public email relay exists. A private task endpoint accepts only event/intent IDs, and the worker derives recipients/content from server-only intents. Only the worker binds Gmail OAuth secrets; create/replay and the worker bind the protected encryption keyring. Local vault/fake-provider access requires both a demo project and a localhost emulator, and the real Gmail adapter refuses emulator execution. Actual cloud key/OAuth values, IAM setup and deployment remain unconfigured. Responses reveal no other teams or contacts. Production abuse controls remain a launch prerequisite. See [TRANSACTIONAL_EMAIL.md](TRANSACTIONAL_EMAIL.md).

## Firebase configuration and secrets

Firebase web configuration is not a secret, but project selection is safety-critical. Local defaults use a `demo-*` project and emulators. Cloud access additionally requires explicit staging mode and the exact allowlisted V2 staging project/app/domain. Other cloud and production builds are rejected. Service-account keys and secrets are forbidden in Git. The isolated staging bootstrap uses only operator CLI OAuth in memory and synthetic data; its generated passwords/tokens remain under ignored `.local-data/staging`. See `STAGING.md`.

The local auth seed uses Admin SDK only after two fail-closed checks: the Authentication Emulator must be on local port `9099`, and the project ID must start with `demo-`. It creates three documented development accounts and never loads credentials.

The quiz seed applies the same fail-closed design to Firestore: it requires local port `8080` and a `demo-*` project. Stable IDs make it safely repeatable. Its Admin SDK access is strictly an emulator-only development tool and does not justify client writes in Rules.

The V1 migration tool follows the same fail-closed principle. Managed export bytes and extracted data stay under the Git-ignored `.local-data/` tree. Extraction and WRITE require an exact local emulator host (`localhost`, `127.0.0.1`, or `[::1]` plus a valid port) and a `demo-*` project ID; the emulator writer has no production override. The separately guarded staging-only cloud path is documented in tools/migration-v1/CLOUD_IMPORT.md, including read-only source IAM requirements and private root-last import journals. Emulator WRITE additionally requires a fresh emulator target with no quiz migration documents. Local inventories may contain document IDs and titles for operator reconciliation, while the committed report contains structural counts only. Neither form contains question text, answer values, notes, options, contacts, or raw documents.

## Rules and tests

Firestore Rules tests run through `firebase emulators:exec` and `@firebase/rules-unit-testing`, not mocked SDK calls. The suite covers anonymous/unprivileged denial for private sessions and quiz sources, anonymous single-document public reads, public list/write denial, staff private reads, direct staff write denial, and default denial. Emulator E2E additionally invokes real callable emulators as anonymous, ordinary user, moderator, and admin. Editor coverage verifies admin-only idempotent creation of one empty private draft, admin CRUD, moderator read-only behavior, direct-write denial, stale/concurrent saves, exact legacy round-trip (including the imported `0/0` timing sentinel), contiguous ordering, guided Choice/Video repairs, invalid indices/timing rejection, sanitized repair responses, and that editor activity leaves sentinel public/session snapshot state unchanged.

Storage now allows only admin create under an exact server-issued quiz media upload grant. All direct get/list/update/delete remain denied. The authenticated/current-publication read gateway, MIME/size/signature checks and immutable generation binding are covered by local Storage contracts and browser tests; see MEDIA_STORAGE.md. Further access still requires explicit boundary tests.

## Operational safeguards

- Separate local, staging, and production Firebase projects.
- Use least-privilege CI identities and protected deployment environments.
- Require review for Rules, Functions authorization, and public projection changes.
- Log security-relevant mutations without secrets or unnecessary contact data.
- Define backup, retention, deletion, and incident-response procedures before launch.

### Internal event scoring
The saveEventScore callable rechecks the current Auth user's admin/moderator claim and disabled flag on every invocation, including retries. The existing global staff scope is preserved. New writes require the event's current immutable snapshot, an existing snapshot round, an accepted canonical registration, an operational lifecycle, a safe half-point integer (or null), an exact score revision, and a reason for corrections/clearing. Score, history and actor/event-bound idempotency receipt commit atomically. Rules grant only staff score/history reads and deny all client writes; scoreOperations is server-only. Management tokens grant no scoring authority. Nothing is published and contact access is unchanged. Full contract and emulator tests: EVENT_SCORING.md.

## Referee capabilities

Referee access is a separate per-event bearer capability, not a staff role or Firestore claim. Grants and rate-limit counters remain server-only. Every protected transaction checks current grant validity and event state; revocation conflicts with in-flight score transactions. See [REFEREE_ACCESS.md](REFEREE_ACCESS.md) for delivery limits, payload allowlists, expiry and tests.


Interim result publication rechecks the current Auth role on every transaction attempt, event/session/snapshot binding, accepted roster, included scores and source fingerprint. Public output is a fresh allowlist of only the reviewed current page; private versions/audit and scores retain staff-only reads and deny every client write. Referee and registration management capabilities confer no publication access. See [INTERIM_RESULTS.md](INTERIM_RESULTS.md).


Final reveal extends the same event-bound live session with private immutable finalVersions, revisioned finalOperations and an explicitly revealed public page. Staff confirmation, corrections, closure and moderator-only synthetic sound are documented in [FINAL_REVEAL.md](FINAL_REVEAL.md). No Rules, indexes or cloud data change is required by this implementation.

## Event organizational email

Admin-only preview/confirmation creates an immutable emailCampaigns record and recipient snapshots in the existing emailIntents outbox. The shared task worker delivers plain-text organizational messages without management capabilities or changes to registration confirmation status. All client campaign/intent access remains denied; safe history and status are exposed only through fresh-admin callables. Atomic recipient limits, snapshot/idempotence contracts and offline tests: [EVENT_TEAM_EMAIL.md](EVENT_TEAM_EMAIL.md).

Media authoring extends the shared picker/gateway/renderer to question, private answer and background roles. Explicit empty fields detach without deleting legacy data or snapshot assets. See MEDIA_AUTHORING_RELEASE.md for the complete contract and deployment scope.
