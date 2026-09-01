# Quiz Editor V1

## Scope

The desktop-first editor is available at `/admin/quizzes/:quizId/edit`. It edits quiz metadata and the authoritative private global slide stream. It supports intro, agenda, recap, end, title/info, explicit round headers, text/free/image/audio/video questions, options of arbitrary practical length, moderator notes, private correct answers, URL/reference media, and known presentation controls. The observed `pl` type and future unknown types use a lossless legacy fallback.

Editor V1 deliberately does not provide Storage upload, scoring configuration, bulk editing, drag-and-drop, or a full legacy raw editor.

## Roles and writes

- Admin: private read and callable mutation access.
- Moderator: private read-only editor UI; every form and structural action is disabled.
- Ordinary authenticated user and anonymous client: no private read or write access.

Firestore Rules deny all direct client writes below `quizzes`. Six callable Functions are the only editor mutation boundary: metadata update, slide update, create, duplicate, delete, and move. Each Function rechecks the `admin` custom claim and validates its complete input.

## Concurrency and save behavior

The quiz document owns one monotonic `revision`. Every mutation includes `expectedRevision`, rereads the quiz and slides in a transaction, and aborts a stale writer. Migrated quizzes without the field start at revision zero. The UI has explicit save buttons, visible saved/dirty/saving states, a browser navigation blocker, and no autosave.

The authoritative slide order is always contiguous `1..slideCount`. Structural changes rewrite positions and update quiz counters plus the derived round/question records in the same transaction. A conservative estimated-write guard fails closed before Firestore's transaction write limit.

## Lossless policy

The server begins with the stored slide and overwrites only validated known editor fields. It preserves:

- `legacy.raw` and all other unknown top-level properties;
- unknown or malformed future field values when the UI fallback is unchanged;
- unknown media properties, roles, and kinds;
- unedited media entries and presentation extensions such as recap overrides;
- explicit empty V1 private fields;
- private correct answers, which never appear in callable responses or logs.

Unknown slide kinds are shown as a locked legacy type. Unknown media records that cannot be represented as a string reference are not sent back by the client, so the server retains them untouched.

## Preview boundary

The right panel uses the same `SlidePreview` rendering component as the projector but receives local private editor state. An admin-only toggle can render the private answer in this panel. This is never a live publish or reveal action and does not read or write `publicSessions`.

## Verification

The committed suites use only synthetic values. They cover mapper fallbacks, malformed input, general option counts, mixed media, presentation controls, lossless unknown data, ordering, counters, role denial, direct-write denial, optimistic concurrency, and all structural mutations.

A local-only check additionally migrates the offline V1 library into a fresh `demo-*` Firestore Emulator. It opens 4 quizzes / 315 slides, validates all 10 observed kinds, round-trips one representative of every kind, and then reruns the independent migration verifier. No question, answer, note, or raw record is printed or committed.
