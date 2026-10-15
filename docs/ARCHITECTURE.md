# Architecture

## Goals

JustKvíz is a small but real application for preparing and running pub quizzes. The architecture favors clear boundaries and operational reliability over unnecessary layers.

## Repository layout

The repository is a pnpm workspace with two deployable units:

1. `apps/web` — one React/Vite single-page application with three route groups.
2. `functions` — Firebase Cloud Functions forming the trusted server boundary.

Local-only tooling lives outside deployable units. `tools/migration-v1` is a fail-closed V1 library migration pipeline and has no deployment role.

Keeping one web application avoids duplicated infrastructure while route-level modules preserve separation between audiences.

## Web route groups

### `/admin`

Authenticated working area for admins and moderators. Route guards improve UX, but Firestore Rules and Cloud Functions remain the authorization boundary.

### `/projector`

Public, read-only display for the active session. It consumes a deliberately sanitized projection document and never queries private quiz/question documents directly.

### `/events`

Public event list and registration surface. Public event data contains capacity/status information but no team contact details.

## Data flow and trust boundaries

```text
Admin browser ── authenticated requests ──> Firestore / Cloud Functions
                                                  │
                                                  ├─ private quiz data
                                                  ├─ private registrations
                                                  └─ sanitized public projection

Projector browser ── read only ───────────────────> sanitized public projection
Public browser ───── public reads / validated call> public events / Cloud Function
```

Sensitive state transitions—quiz editing, team registration, quiz publication, live-state changes, answer reveal, role management, and result finalization—belong in Functions. The implemented editor and live-session callables use Firestore transactions and explicit optimistic revisions. The server derives authoritative fields such as timestamps, counters, ordering, revisions, derived round/question records, and public projection payloads.

## Frontend modules

- `app`: router and top-level application composition.
- `routes`: route-group screens and future nested routing.
- `services/firebase`: SDK initialization and emulator wiring.
- `styles`: global design tokens and base presentation.

Feature folders may be added when real behavior arrives. A generic repository/service abstraction is not required until repeated use proves it valuable.

The first implemented feature is the read-only admin quiz library. `features/quizzes/quizRepository.ts` is a small query and runtime-mapping boundary. It reads only private `quizzes`, nested `rounds`, and nested `questions`; its UI view model deliberately omits correct answers. V1-migrated quizzes additionally keep a private, globally ordered `slides` source stream so intro, agenda, recap, end, and other presentation records are not forced into question documents. That stream is not a projector API; trusted Functions derive the deliberately sanitized `publicSessions` state from private source data.

The live feature now provides that trusted boundary. Staff control `/admin/live/:sessionId`, while anonymous `/projector/:sessionId` subscribes only to one `publicSessions` document. `functions/src/live/publication.ts` allowlists slide publication; the interim-results boundary independently publishes only a reviewed page of rank/name/total rows. The dedicated projector route is outside admin layout and renders a responsive 16:9 canvas through the same `SlideRenderer` used by editor draft preview. The projector refuses cached snapshots and clears visible state when the browser goes offline, preventing an old recap answer from lingering after a disconnected slide transition.

Media and recap commands are revisioned trusted mutations with monotonic media-generation tokens. Moderator command intent is separate from confirmed player lifecycle. Normal AUDIO deliberately omits its source from the public projector model and plays from a visible moderator player; its vinyl moves only after confirmed PLAYING. VIDEO mounts one projector player only while preparing/playing and falls back to the question on error. Recap publishes one selected answer at a time. The projector accepts presentation state only from Firestore; inbound BroadcastChannel presentation messages are ignored. The channel retains only player lifecycle reporting to the moderator. Details are in `PROJECTOR_ARCHITECTURE.md` and `MEDIA_ARCHITECTURE.md`.

The round-first quiz editor lives at `/admin/quizzes/:quizId/edit`. A memoized semantic facade turns the private global slide stream into quiz, introduction, rounds, locally numbered questions, and system recap nodes without rewriting migrated records. Its focused responsive shell provides structure, type-specific form, and local projector-style preview panels. Admins can mutate; moderators receive the same private read model in a disabled read-only UI. Every write calls `functions/src/editor/callables.ts`; Firestore Rules continue to reject all direct quiz writes. The client sends the quiz revision it rendered, and a stale editor receives `aborted` instead of overwriting another save. New-question drafts and form changes remain local until the one explicit Save action; there is no autosave.

Quiz readiness is a derived domain layer over that same bounded semantic model. Shared question validation feeds both editor feedback and the whole-quiz `/admin/quizzes/:quizId/readiness` route; structure and static media checks add typed human issues and semantic fix targets. The result is ephemeral and staff-only. It performs no per-question Firestore reads, writes no validity flag, does not publish to `publicSessions`, and revalidates the saved quiz immediately before the normal practice live-session action.

The guided repair layer lives at `/admin/quizzes/:quizId/readiness/repair`. It consumes the same bounded quiz load and `PreflightResult`, orders current blockers by their semantic references, and supports only two intentionally narrow repairs: an explicit Choice option index and explicit Video START/END seconds. Moderators can inspect the queue but cannot save. Admin saves call `repairQuizPreflightIssue`, which reloads the authoritative slide in a revision-checked transaction, derives the selected answer from the current stored options, or validates the explicit timing pair, and returns only the normal sanitized mutation counters. After every save the browser reloads the whole authoritative quiz and reruns shared preflight before removing an item from the queue. Unsupported blockers retain their severity and deep-link to the full editor.

The first Events Foundation slice adds `/admin/events`, event create/detail/configuration, and immutable quiz preparation. Event mutations are admin-only callable Functions with expected revisions; moderators have operational read-only access. Locking imports the same quiz-domain mapper and preflight engine used by the editor, then atomically copies the exact private slide stream and round metadata into a new `quizSnapshots` document tree and attaches it to the event. Relock creates another snapshot and is allowed only while server-owned scoring state has not started. `publicEvents` is a whole-document allowlist projection with safe aggregate capacities and registration window but no quiz references, team identities, answers, or contacts.

Public registrations use trusted create/get/edit/cancel operations. Capacity and unique names are transactional; records retain only the management-token verifier. Private email intents, encrypted capability envelopes, replay receipts and a safe organizer delivery summary are documented in [TRANSACTIONAL_EMAIL.md](TRANSACTIONAL_EMAIL.md). Gmail delivery uses a private Cloud Tasks worker. Default-off discovery binds no secrets. The separately approved 972ed71 V2 staging activation enabled only new public online registrations from 2026-10-15T15:26:19.550Z; the queue is RUNNING and the owner confirmed all three create/update/cancel messages. The earlier selected-recipient activation in [EMAIL_ACTIVATION_EXECUTION.md](EMAIL_ACTIVATION_EXECUTION.md) is historical evidence. This source revision adds Czech templates, an encrypted management link for new update intents and conservative handling of uncertain provider outcomes; its deployment requires a separate exact release approval. Local verification uses a fake Gmail transport. Internal round scoring uses the scoped saveEventScore callable; see EVENT_SCORING.md.

Event team tools add two admin-only manual-team callables over that same registration ledger (not a parallel team store), plus shared manual-team and public-link/QR UI. See `EVENT_TEAM_TOOLS.md` for idempotency and delivery scope.

The PDF Print Center adds `/admin/events/:eventId/print` and a binary HTTPS Function. The Function resolves the event's immutable snapshot and accepted registration roster, maps them into minimal typed print models, and passes those models to a deterministic Firestore-independent renderer. `PrintTeam` contains only a stable registration ID and display name. Admins can generate all document types; moderators can generate team sheets and score tables but not answer keys. The browser owns only Blob preview/download lifecycle and never supplies answer-bearing content, team contacts, or roster contents.

`functions/src/editor/model.ts` applies known-field patches to an authoritative server snapshot. Unknown top-level values, malformed future values, unedited media records, presentation extensions, and `legacy.raw` remain private and are preserved. Trusted round/question mutations duplicate, move, reorder, or remove semantic groups while normalizing global positions and refreshing the derived round/question projection in the same bounded transaction. The shared `SlideRenderer` renders both public projector state and the editor's private local preview; the editor reaches it through `SlidePreview`, which may receive a correct answer only for an explicit local answer preview and never writes `publicSessions`.

## Firebase services

Whole-evening visual authoring adds bounded quiz/round/slide design inheritance and frozen result/print templates to these same boundaries. The moderator preview consumes the actual public payload; questions, scores and results retain their original authoritative sources. See [WHOLE_EVENING_DESIGN.md](WHOLE_EVENING_DESIGN.md).

- Authentication: staff sign-in; authorization through current server-managed membership, permissions and resource scopes.
- Firestore: operational and public projection data.
- Storage: quiz media, with metadata/access controlled by Firestore and Rules.
- Functions: validation, explicit staff authorization, revision-checked live transactions, sanitized publication, and other trusted operations.
- Hosting: Vite static build with SPA rewrites.

## Environments

- Local: Firebase Emulator Suite with `demo-filmovy-kviz-v2`.
- Staging: isolated `filmovy-kviz-v2-staging`, configured through the guarded staging tools; see `STAGING.md`.
- Production: never targeted without explicit approval.

No production project identifiers or credentials are stored in this repository.

## Testing strategy

The quality gate includes static checks, production builds, unit/migration tests, Firestore Rules emulator tests, and Auth/Firestore/Functions emulator E2E flows for live control, editor CRUD, guided repair, and trusted event/snapshot workflows. Separate local-only migrated-data checks open all 4 offline V1 quizzes and 315 slides through the editor read shape, round-trip one representative of each observed slide kind, and run whole-quiz readiness over all 263 questions without printing private values. The real export is never available to CI. Event-night repair reports and progress live only below Git-ignored `.local-data/tonight-repair/` and contain semantic references/counts, never question copy, options, answers, media URLs, notes, or raw legacy values.

Internal scoring lives at /admin/events/:eventId/scoring, linked from the event detail. It uses the existing registration roster and immutable snapshot round IDs. Revision-checked score changes, append-only history, idempotency receipts, and the first scoring.started transition share one transaction. Current membership and event scope are rechecked on every callable invocation and inside the score transaction. Private subscriptions preserve local drafts; there is no publication or BroadcastChannel path. See EVENT_SCORING.md for the data and lifecycle contract.

## Referee access

The separate /referee/:eventId surface uses event-scoped bearer grants and minimal callable read models. It shares the staff scoring transaction and never receives private snapshots or registration contacts. See [REFEREE_ACCESS.md](REFEREE_ACCESS.md) for the authorization, lifecycle and deployment contract.


Event-bound moderation and explicitly reviewed cumulative result versions use the existing live/projector routes. See [INTERIM_RESULTS.md](INTERIM_RESULTS.md) for binding, transactional confirmation, pagination, closure and deployment dependencies.


Final reveal extends the same event-bound live session with private immutable finalVersions, revisioned finalOperations and an explicitly revealed public page. Staff confirmation, corrections, closure and moderator-only synthetic sound are documented in [FINAL_REVEAL.md](FINAL_REVEAL.md). No Rules, indexes or cloud data change is required by this implementation.

Show Mode extends these same confirmed-result transactions and public session
allowlist; it does not create another score or ranking source. New show versions
use six-row server pages, while missing historical pagination metadata continues
to mean classic eight-row pages. Interim entry captures a private return intent
and publishes an answer-free static slide backdrop; hide reconstructs the previous
explicit answer/recap from the same authoritative snapshot only with current
answer permission, always with media stopped and a new generation. Final lower-rank
bulk reveal and separately paged revealed history contain only explicitly released
groups. Server cue metadata authorizes visual presentation, never future rows or
client-driven navigation. Event-scoped show preferences/audio bindings and a narrow
authenticated media gateway let moderators play linked owned MP3/WAV locally.
The integrated moderator queue serializes live and result commands. Details and
verification are in [SHOW_MODE_IMPLEMENTATION.md](SHOW_MODE_IMPLEMENTATION.md);
the deployment inventory is a local plan, not deployment authorization.

## Event organizational email

Registration email has a backward-compatible, explicit recipient policy in the
trusted runtime. Missing `REGISTRATION_EMAIL_RECIPIENT_POLICY` means `selected`,
preserving the existing single-recipient staging activation. The opt-in
`future-public-registration` policy admits only the three transactional
registration message types for canonical online registrations created at or after
one shared activation cutoff. The server records the registration creation time
and policy on each new intent; dispatch and every delivery claim reject unmarked
backlog and pre-cutoff registrations before queueing/lease/provider access. Public
create/update/cancel receipts and management capabilities retain their existing
contract. No email is added for no-op/replay/manual staff operations.

The approved 972ed71 activation and a fresh read on 2026-10-15 confirm this policy
with a RUNNING queue and the cutoff above. Organizational campaigns and automatic
organizer notifications remain outside the activated dispatch policy. No historical
outbox replay, public worker access or production activation is implied.

Admin-only preview/confirmation creates an immutable emailCampaigns record and recipient snapshots in the existing emailIntents outbox. The shared task worker delivers plain-text organizational messages without management capabilities or changes to registration confirmation status. All client campaign/intent access remains denied; safe history and status are exposed only through fresh-admin callables. Atomic recipient limits, snapshot/idempotence contracts and offline tests: [EVENT_TEAM_EMAIL.md](EVENT_TEAM_EMAIL.md).

## Owned media foundation

Quiz-scoped image/audio uploads use private asset metadata, create-only Storage grants and a current-role/current-publication HTTP read gateway. Immutable event snapshots keep stable asset references and generations; no cleanup runs. The existing MediaPlayer lifecycle selects YouTube or native audio while retaining the one-player budget. See [MEDIA_STORAGE.md](MEDIA_STORAGE.md) for boundaries and future deployment checks.

Media authoring extends the shared picker/gateway/renderer to question, private answer and background roles. Explicit empty fields detach without deleting legacy data or snapshot assets. See MEDIA_AUTHORING_RELEASE.md for the complete contract and deployment scope.


Complete editor extends the same private ordered stream with explicit draft/ready authoring, independent answer mode, default appearance, atomic round/recap creation and private in-memory rehearsal. Drafts block preflight, snapshot lock and live publication. See [COMPLETE_EDITOR_RELEASE.md](COMPLETE_EDITOR_RELEASE.md) for field compatibility, authorization, verification and the integrated deployment manifest.

## Current personal access boundary

[PERSONAL_ACCESS.md](PERSONAL_ACCESS.md) supersedes the historical admin/moderator descriptions above. Private repositories use scoped server views; raw data is available only with all sensitive permissions. Every existing staff callable and gateway enforces current membership independently. Preset labels do not authorize access. AuthProvider watches its own server membership and remounts private views on identity/version changes. See the release document for the explicit deployment inventory and invitation activation gate.

## Event management extension

See [EVENT_MANAGEMENT.md](EVENT_MANAGEMENT.md) for the independent disposition overlay, scoped permission mapping, shared transactional guards, capability revocation and exact server-side deletion ownership/allowlist. No content backfill or Storage cleanup is introduced. Cloud team email remains disabled.
