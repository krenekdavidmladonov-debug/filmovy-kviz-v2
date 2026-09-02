# Architecture

## Goals

Filmový Kvíz V2 is a small but real application for preparing and running pub quizzes. The architecture favors clear boundaries and operational reliability over unnecessary layers.

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

The live feature now provides that trusted boundary. Staff control `/admin/live/:sessionId`, while anonymous `/projector/:sessionId` subscribes only to one `publicSessions` document. `functions/src/live/publication.ts` is the single allowlist-based PRIVATE → PUBLIC mapper. The dedicated projector route is outside admin layout and renders a responsive 16:9 canvas through the same `SlideRenderer` used by editor draft preview. The projector refuses cached snapshots and clears visible state when the browser goes offline, preventing an old recap answer from lingering after a disconnected slide transition.

Media and recap commands are revisioned trusted mutations with monotonic media-generation tokens. Moderator command intent is separate from confirmed player lifecycle. Normal AUDIO deliberately omits its source from the public projector model and plays from a visible moderator player; its vinyl moves only after confirmed PLAYING. VIDEO mounts one projector player only while preparing/playing and falls back to the question on error. Recap publishes one selected answer at a time. A strictly parsed same-origin `BroadcastChannel` carries only a rebuilt public allowlist as a one-revision latency fast path; unconfirmed channel state rolls back and Firestore remains authoritative. Details are in `PROJECTOR_ARCHITECTURE.md` and `MEDIA_ARCHITECTURE.md`.

The round-first quiz editor lives at `/admin/quizzes/:quizId/edit`. A memoized semantic facade turns the private global slide stream into quiz, introduction, rounds, locally numbered questions, and system recap nodes without rewriting migrated records. Its focused responsive shell provides structure, type-specific form, and local projector-style preview panels. Admins can mutate; moderators receive the same private read model in a disabled read-only UI. Every write calls `functions/src/editor/callables.ts`; Firestore Rules continue to reject all direct quiz writes. The client sends the quiz revision it rendered, and a stale editor receives `aborted` instead of overwriting another save. New-question drafts and form changes remain local until the one explicit Save action; there is no autosave.

Quiz readiness is a derived domain layer over that same bounded semantic model. Shared question validation feeds both editor feedback and the whole-quiz `/admin/quizzes/:quizId/readiness` route; structure and static media checks add typed human issues and semantic fix targets. The result is ephemeral and staff-only. It performs no per-question Firestore reads, writes no validity flag, does not publish to `publicSessions`, and revalidates the saved quiz immediately before the normal practice live-session action.

`functions/src/editor/model.ts` applies known-field patches to an authoritative server snapshot. Unknown top-level values, malformed future values, unedited media records, presentation extensions, and `legacy.raw` remain private and are preserved. Trusted round/question mutations duplicate, move, reorder, or remove semantic groups while normalizing global positions and refreshing the derived round/question projection in the same bounded transaction. The shared `SlideRenderer` renders both public projector state and the editor's private local preview; the editor reaches it through `SlidePreview`, which may receive a correct answer only for an explicit local answer preview and never writes `publicSessions`.

## Firebase services

- Authentication: staff sign-in; role authorization via custom claims.
- Firestore: operational and public projection data.
- Storage: quiz media, with metadata/access controlled by Firestore and Rules.
- Functions: validation, explicit staff authorization, revision-checked live transactions, sanitized publication, and other trusted operations.
- Hosting: Vite static build with SPA rewrites.

## Environments

- Local: Firebase Emulator Suite with `demo-filmovy-kviz-v2`.
- Future staging: a separate non-production Firebase project, added only intentionally.
- Production: never targeted without explicit approval.

No production project identifiers or credentials are stored in this repository.

## Testing strategy

The quality gate includes static checks, production builds, unit/migration tests, Firestore Rules emulator tests, and Auth/Firestore/Functions emulator E2E flows for live control and editor CRUD. Separate local-only migrated-data checks open all 4 offline V1 quizzes and 315 slides through the editor read shape, round-trip one representative of each observed slide kind, and run whole-quiz readiness over all 263 questions without printing private values. The real export is never available to CI.
