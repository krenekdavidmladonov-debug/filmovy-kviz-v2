# UX implementation follow-ups

The first UX foundation intentionally preserves current product behavior. The items below need either a product decision or a separate technical slice before the interface can represent them honestly.

## Product decisions

- **Final brand identity:** replace the provisional `QUIZ PLATFORM` / `QP` values only after the product name, visual identity, and tone are approved. The application now has a central configuration and semantic token boundary for that change.
- **Quiz creation flow:** define the minimum new-quiz workflow and ownership defaults before adding a primary `Nový kvíz` action. The current backend has no complete creation flow, so this foundation does not expose a non-functional call to action.
- **Round-first editor:** decide the authoring hierarchy and round management workflow in a dedicated editor project. This slice only humanizes isolated labels and keeps explicit Save/conflict behavior unchanged.
- **Recap viewed state:** decide whether moderators need a persistent “already shown” indicator and whether that state belongs to the live session. The current selected answer remains visually identifiable without adding persistence.

## Technical follow-ups

- **Reliable projector presence:** add an authenticated, bounded heartbeat/acknowledgement protocol before showing “connected”, “unresponsive”, or “disconnected”. Opening/focusing a browser window does not prove that the projector client is healthy.
- **Fullscreen confirmation:** add a projector-to-moderator acknowledgement if fullscreen state must be visible in the moderator shell. The browser window reference cannot reliably inspect a separate projector client.
- **Window reactivation across reloads:** the current tab can focus the window reference it opened. After a moderator reload, browsers do not provide a safe reference to the old window; the UI therefore offers to open it again and does not claim stronger behavior.
- **Theme variants:** add a light theme only after contrast and brand decisions. Semantic tokens support a future variant; phase one deliberately ships one dark admin theme.

## Preserved boundaries

- No media engine, projector publication state machine, BroadcastChannel authority, migration, Firestore model, or persistence behavior was changed by the UX foundation.
- Correct answers remain moderator-private until the existing authoritative reveal path publishes them.
