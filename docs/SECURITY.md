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

The projector reads only `publicSessions/{sessionId}`. A trusted Function builds this sanitized projection from private quiz data. Before reveal, it copies only the prompt and safe media. After an authorized reveal transition, it may add the answer payload. Hiding an answer in React state, CSS, a network response, or an unread UI branch is not acceptable.

Private answer media must use protected paths or server-controlled delivery; prompt and answer media must not share guessable unrestricted URLs.

## Authorization

- `admin`: full administration, including roles and destructive lifecycle operations.
- `moderator`: event operation, registration/check-in, live control, and scoring within allowed scope.
- public: read explicitly public documents and invoke narrowly defined registration endpoints only.

Custom claims are the staff authorization source. Functions independently verify claims and resource scope; they do not trust client-supplied roles.

## Public registration

Registration is a callable/HTTP Function rather than a direct Firestore write. It validates fields/types, normalization/limits, contact format, team-size bounds, event state and capacity transactionally, duplicate/idempotency behavior, and abuse controls before launch. Responses reveal no other teams, contacts, or internal capacity details.

## Firebase configuration and secrets

Firebase web configuration is not a secret, but project selection is safety-critical. Local defaults use a `demo-*` project and emulators. The client requires explicit opt-in for a non-demo project ID. Service-account keys and secrets are forbidden in Git.

## Rules and tests

Current Firestore and Storage rules deny every operation. Before granting access, emulator tests must cover unauthenticated users, users without roles, moderator/admin boundaries, cross-event access, private answers, contact isolation, reveal timing, and media paths/types/sizes.

## Operational safeguards

- Separate local, staging, and production Firebase projects.
- Use least-privilege CI identities and protected deployment environments.
- Require review for Rules, Functions authorization, and public projection changes.
- Log security-relevant mutations without secrets or unnecessary contact data.
- Define backup, retention, deletion, and incident-response procedures before launch.
