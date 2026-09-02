# UX implementation follow-ups

The first UX foundation intentionally preserves current product behavior. The items below need either a product decision or a separate technical slice before the interface can represent them honestly.

## Product decisions

- **Final brand identity:** replace the provisional `QUIZ PLATFORM` / `QP` values only after the product name, visual identity, and tone are approved. The application now has a central configuration and semantic token boundary for that change.
- **Quiz creation flow:** define the minimum new-quiz workflow and ownership defaults before adding a primary `Nový kvíz` action. The current backend has no complete creation flow, so this foundation does not expose a non-functional call to action.
- **Recap viewed state:** decide whether moderators need a persistent “already shown” indicator and whether that state belongs to the live session. The current selected answer remains visually identifiable without adding persistence.

## Technical follow-ups

- **Reliable projector presence:** add an authenticated, bounded heartbeat/acknowledgement protocol before showing “connected”, “unresponsive”, or “disconnected”. Opening/focusing a browser window does not prove that the projector client is healthy.
- **Fullscreen confirmation:** add a projector-to-moderator acknowledgement if fullscreen state must be visible in the moderator shell. The browser window reference cannot reliably inspect a separate projector client.
- **Window reactivation across reloads:** the current tab can focus the window reference it opened. After a moderator reload, browsers do not provide a safe reference to the old window; the UI therefore offers to open it again and does not claim stronger behavior.
- **Theme variants:** add a light theme only after contrast and brand decisions. Semantic tokens support a future variant; phase one deliberately ships one dark admin theme.
- **Unsaved-draft projector preview:** design a separate same-device preview route and bounded transport before adding `Otestovat na projektoru`. It must show only the chosen local draft, must keep private answers off unless the moderator explicitly enables them, and must never reuse or write live `publicSessions`.
- **Whole-quiz preflight:** promote the editor's per-question readiness checks into a separate quiz-wide validation workflow when publication requirements are defined.
- **Generated agenda persistence:** the round-first facade generates the agenda from current round order and titles for the editor. Decide whether authored agenda slides should also be synchronized on every structural mutation; this task conservatively preserves their stored legacy payload.
- **Media upload:** the editor continues to accept the configured URL/reference mechanism. Storage upload, ownership, progress, and cleanup need a separate trusted workflow.

## Preserved boundaries

- No media engine, projector publication state machine, BroadcastChannel authority, migration, Firestore model, or persistence behavior was changed by the UX foundation.
- Correct answers remain moderator-private until the existing authoritative reveal path publishes them.
- The round-first editor adds only admin-authorized, revision-checked quiz mutations. It does not alter projector publication, media lifecycle, or BroadcastChannel authority.
