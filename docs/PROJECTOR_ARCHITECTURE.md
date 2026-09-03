# Projector architecture

## Window and rendering boundary

`/projector/:sessionId` is routed outside `AppLayout`. Its first paint, viewport outside the canvas, error state, and fullscreen state are black and contain no admin navigation. The presentation is one centered 16:9 canvas sized by the smaller viewport dimension; it scales as a unit instead of reflowing like a mobile page. Fullscreen is requested only after the user's button click or `F` key press. `Esc` remains the browser default. A rejected or unsupported request leaves the projector functional and displays a small browser-fullscreen fallback message. A blocked popup is reported in the moderator panel rather than silently ignored.

The moderator opens a named browser window from an explicit click. Repeated clicks reuse and focus it. The Window Management API is not required; where multi-screen placement is unavailable, the supported fallback is to drag the dedicated window to the projector and then enter fullscreen.

## Shared renderer

`SlideRenderer` is the only type-aware presentation component. The public projector and editor draft preview use it with different explicit modes. It supports question, recap, editor preview, round intro, agenda, rules, and end. The renderer input has no `correctAnswer` property: editor code must intentionally convert a private answer to `revealedAnswer` only for its local recap-style preview, and the public route receives that field only from the trusted publication allowlist.

The normalized roles are distinct:

- `backgroundImage`: cover background behind a black 0–100 overlay;
- `questionImage`: contained image region with black bars, used by IMAGE;
- `answerImage`: recap answer media;
- `mediaSource`: AUDIO/VIDEO source interpreted by a provider adapter;
- `clipStartSeconds` / `clipEndSeconds`: ordinary question segment bounds.

## Public state and same-device fast path

Firestore `publicSessions/{sessionId}` remains authoritative. A callable transaction replaces the complete document whenever slide, recap selection, media command, intro command, reveal compatibility state, or lifecycle state changes.

`BroadcastChannel` is a same-origin latency optimization only. The moderator subscribes to the public Firestore document and rebuilds an allowlisted channel object from that already-sanitized model. A strict runtime parser validates every key, nested media/presentation value, command/playback pairing, recap selection, and answer semantic; unknown or malformed receiver fields reject the whole message.

The fast path is accepted only after an authoritative Firestore snapshot, only for the same session, and only for exactly the next revision. Equal, stale, and future revisions are rejected. A fast-path state has a 1.5-second confirmation window; if Firestore does not publish that revision, the projector rolls back to its last authoritative state. Any Firestore snapshot or connection failure cancels the speculative state immediately. Firestore therefore remains authoritative after reconnect and cannot be permanently outranked by a channel message.

Projector playback reports are non-sensitive channel events containing only session ID, media generation, and an allowlisted lifecycle value. An authenticated moderator tab validates them against current state and invokes the trusted Function. On different devices, local VIDEO error fallback still protects the audience view, while the moderator retains explicit REPLAY/STOP/next controls.

The moderator serializes command mutations and player-state reports per live session. Each queued mutation advances from the newest server-confirmed revision, so an immediate REPLAY cannot race the preceding error report or erase its user-visible failure.

## Recap security invariant

Entering an authored recap slide creates an explicit recap mode with no answer selected. A selection callable loads exactly one prior question in the same round, verifies its private display answer, and republishes one public snapshot. The projector never queries private quiz, round, question, session, or answer collections. Choosing another recap question replaces the complete public document, so an older answer/image/source cannot remain.

Legacy reveal/hide callables remain only for compatibility. They are absent from the main moderator UX; recap is the normal answer-publication workflow.

## Future modules

Results will need a separate public model for manual last-to-first reveal, explicit tie ranking, configurable winner music, and a final animation. Events/registration, print/PDF, referee tooling, live scoring, digital answering without speed bonus, media upload, and full offline operation are separate future modules and are not implied by this foundation.
