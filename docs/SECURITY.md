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

The projector reads only one `publicSessions/{sessionId}` document. The trusted `buildPublicSessionState` allowlist builds this projection from private quiz data. Before reveal it copies only explicitly safe title/text/options, prompt/background media, and presentation controls. After an authorized reveal it adds only display-form `revealedAnswer` and an allowed answer image—not the private slide or question. Hiding an answer in React state, CSS, a network response, an error, or an unread UI branch is not acceptable.

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
- quiz writes are denied to both roles while the library is read-only;
- existing event/media policy remains staff-read and admin-write until those flows are revisited;
- staff profiles are self-readable, while all user management is admin-only;
- staff may read private `sessions`, but all client writes are denied;
- anyone may get one known `publicSessions` document, collection listing is denied, and every client write is denied;
- every other path falls through to deny.

Moderator writes are not enabled yet. Each future operational write must be introduced as a narrowly scoped rule and accompanied by emulator tests.

The quiz library and live-control UI query private documents only after staff authentication. Correct answers remain in private slide/question documents and may also be present inside private `legacy.raw`. The library mapper omits them; the moderator live preview may show only the current top-level private answer to staff. Anonymous projector code has no query path to `quizzes` or `sessions`.

Callable Functions independently require an `admin` or `moderator` custom claim. They validate identifiers, positions, quiz/slide existence, session lifecycle, and the caller's `expectedRevision`. Function success responses contain only control metadata; errors and application logs contain no slide, question, answer, note, or raw data.

## Public registration

Registration is a callable/HTTP Function rather than a direct Firestore write. It validates fields/types, normalization/limits, contact format, team-size bounds, event state and capacity transactionally, duplicate/idempotency behavior, and abuse controls before launch. Responses reveal no other teams, contacts, or internal capacity details.

## Firebase configuration and secrets

Firebase web configuration is not a secret, but project selection is safety-critical. Local defaults use a `demo-*` project and emulators. The client requires explicit opt-in for a non-demo project ID. Service-account keys and secrets are forbidden in Git.

The local auth seed uses Admin SDK only after two fail-closed checks: the Authentication Emulator must be on local port `9099`, and the project ID must start with `demo-`. It creates three documented development accounts and never loads credentials.

The quiz seed applies the same fail-closed design to Firestore: it requires local port `8080` and a `demo-*` project. Stable IDs make it safely repeatable. Its Admin SDK access is strictly an emulator-only development tool and does not justify client writes in Rules.

The V1 migration tool follows the same fail-closed principle. Managed export bytes and extracted data stay under the Git-ignored `.local-data/` tree. Extraction and WRITE require an exact local emulator host (`localhost`, `127.0.0.1`, or `[::1]` plus a valid port) and a `demo-*` project ID; no production override exists. WRITE additionally requires a fresh emulator target with no quiz migration documents. Local inventories may contain document IDs and titles for operator reconciliation, while the committed report contains structural counts only. Neither form contains question text, answer values, notes, options, contacts, or raw documents.

## Rules and tests

Firestore Rules tests run through `firebase emulators:exec` and `@firebase/rules-unit-testing`, not mocked SDK calls. The suite covers anonymous/unprivileged denial for private sessions and quiz sources, anonymous single-document public reads, public list/write denial, staff private reads, direct staff write denial, and default denial. The live E2E suite additionally invokes real callable emulators as anonymous, ordinary user, moderator, and admin, and reads the raw public document as an unauthenticated projector.

Storage remains fully deny-all. Before additional Firestore or Storage access is granted, emulator tests must also cover cross-event access, private answers, contact isolation, reveal timing, and media paths/types/sizes as those features are implemented.

## Operational safeguards

- Separate local, staging, and production Firebase projects.
- Use least-privilege CI identities and protected deployment environments.
- Require review for Rules, Functions authorization, and public projection changes.
- Log security-relevant mutations without secrets or unnecessary contact data.
- Define backup, retention, deletion, and incident-response procedures before launch.
