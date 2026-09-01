# Live quiz session and projector publication

## Boundary

`sessions/{sessionId}` is the private control record. `quizzes/{quizId}/slides/{slideId}` remains the private source, including correct answers, moderator notes, and legacy raw data. Only staff can read those paths, and no client can write them.

`publicSessions/{sessionId}` is a replace-only, server-generated snapshot. The anonymous projector knows one random session ID and can get that document, but cannot list sessions or query private data.

```text
staff callable → transaction → private session
                            └→ allowlist sanitizer → public session → anonymous projector
```

## Lifecycle

| State | Position | Reveal | Allowed transitions |
|---|---:|---|---|
| `waiting` | 0 | false | next/go, end |
| `active` | 1…slideCount | false/true | next, previous, go, reveal/hide when valid, end |
| `ended` | last private position | false | none |

The first successful navigation sets `startedAt`. Navigation always sets `answerRevealed` to false. End sets `endedAt`, clears reveal state, and publishes an ended snapshot without slide payload.

## Callable API

- `createLiveSession({ quizId })`
- `goToSlide({ sessionId, position, expectedRevision })`
- `nextSlide({ sessionId, expectedRevision })`
- `previousSlide({ sessionId, expectedRevision })`
- `revealAnswer({ sessionId, expectedRevision })`
- `hideAnswer({ sessionId, expectedRevision })`
- `endLiveSession({ sessionId, expectedRevision })`

Every callable requires Firebase Auth plus an `admin` or `moderator` custom claim. The server validates all string IDs, slide bounds, authoritative quiz/slide existence, and session state. It never accepts a quiz ID during mutation and never returns a private slide or answer.

## Publication allowlist

Before reveal, the public document can contain only lifecycle metadata and these active-slide fields: `slideKind`, title, text, primitive options, prompt/background media references, and numeric/string presentation controls. Nested objects are reconstructed rather than copied.

After reveal, `revealedAnswer` is a display string derived from the private answer. An answer-role image may be published as `answerImage`. `correct`, `correctAnswer`, `moderatorNote`, `legacy`, `raw`, arbitrary media roles, recap overrides, and whole private objects are never copied.

The Firestore transaction uses a replacing `set`, not merge. Moving or ending therefore removes previously published answer fields. Projector subscriptions reject cache-only snapshots and clear on offline events to avoid showing a stale revealed answer after losing connectivity.

## Concurrency

Each private/public state carries a monotonic `revision`. A client must send the revision it rendered. The transaction rereads the authoritative session; only one concurrent action with that revision can commit. A double-click, second admin panel, or reveal/next race causes one transaction to win and the stale operation to return `aborted`. Firestore retries do not bypass the explicit revision check. Ended sessions reject all further mutations.

## UI workflow

Staff start a quiz from its private detail page and are routed to `/admin/live/:sessionId`. The control subscribes to the private session/current slide, shows the current answer only to staff, and offers previous, next, reveal/hide, end, and a projector link.

`/projector/:sessionId` requires no login and subscribes only to the public document. It renders waiting, active slide, revealed answer, ended, not-found, loading, and connection-safe states. Images have a minimal renderer; audio/video are displayed as sanitized source information or safe links. Full playback and a media ownership subsystem are intentionally deferred.

`pl` remains semantically unresolved and is displayed as “Legacy slide” without publishing its legacy metadata.
