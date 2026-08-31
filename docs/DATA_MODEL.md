# Initial Firestore data model

This is a first design, not a migration contract. Fields should be introduced only with validation, rules, and indexes required by an implemented feature.

## Private operational data

### `users/{uid}`

Staff profile: `displayName`, `email`, `disabled`, and timestamps. Authorization is based on server-managed custom claims (`admin` or `moderator`), not a browser-writable role field.

### `quizzes/{quizId}`

Quiz metadata: `title`, `description`, `status` (`draft`, `ready`, `archived`), ownership/audit fields, and timestamps.

### `quizzes/{quizId}/rounds/{roundId}`

Round metadata: `title`, `position`, `type`, and optional presentation settings.

### `quizzes/{quizId}/rounds/{roundId}/questions/{questionId}`

Private question source: prompt, correct answer, accepted alternatives, scoring rules, explanation, media references, and position. This collection is never readable by public/projector clients.

### `events/{eventId}`

Authoritative event record: quiz reference, venue/time, capacity, registration status, lifecycle status, and audit fields. Staff access only.

### `events/{eventId}/registrations/{registrationId}`

Private registration: team name, normalized team name, contact person/email/phone, requested size, status, consent metadata, timestamps, and server audit fields. Public clients cannot list or read it.

### `events/{eventId}/teams/{teamId}`

Operational team: display name, check-in state, seat count, scoring state, and private registration reference. It does not duplicate contact details.

### `events/{eventId}/sessions/{sessionId}`

Trusted live-session state: phase, current round/question references, reveal state, control version, timestamps, and operator identity.

### `events/{eventId}/sessions/{sessionId}/scores/{teamId}`

Per-team totals and round breakdown. Writes are staff/server only; final public rankings are projected separately.

### `media/{mediaId}`

Private metadata: Storage path, content type, size, checksum, owner, processing state, usage references, and timestamps. A raw Storage path does not imply public access.

## Public/sanitized data

### `publicEvents/{eventId}`

Safe listing data: title, venue display name, start time, public capacity state (`open`, `few_left`, `full`, `closed`), deadline, and public description. Contact details are excluded.

### `publicSessions/{sessionId}`

Sanitized projector state: event display data, phase, current slide type, safe prompt/media payload, answer payload only after reveal, and a monotonic version.

### `publicSessions/{sessionId}/leaderboard/{teamId}`

Sanitized team display name, rank, and score when publication is enabled. No registration reference or contact data.

## Server-only registration flow

The public client calls a Function. The Function validates shape and limits, checks event state/capacity transactionally, normalizes data, writes the private registration, updates authoritative counters, and returns only a receipt/status. Browser-supplied timestamps, role, status, price, or capacity values are ignored.

## Retention and audit

Contact data needs an explicit retention policy before launch. Important mutations should record server-derived actor and timestamp fields. Avoid indefinite logs containing contact data.
