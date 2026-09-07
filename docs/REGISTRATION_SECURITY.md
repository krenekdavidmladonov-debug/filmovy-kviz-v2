# Registration Security

- Browsers cannot write `events`, `registrations`, `registrationNames`, or `publicEvents` directly.
- Anonymous clients can query only the allowlisted `publicEvents` projection. They cannot get or list registrations.
- Admins and moderators can read registration records; ordinary authenticated users cannot. Only admins can invoke configuration or administrative cancellation.
- Public create/edit/cancel/get are trusted callable operations. Create, capacity changes, name reservations, and cancellation counters are Firestore transactions.
- Management tokens contain 256 bits of random entropy. Firestore stores only a SHA-256 verifier; the raw token stays in the URL fragment, token comparison is timing-safe, and invalid event/registration/token combinations return the same non-enumerating error.
- `publicEvents` contains only aggregate capacity, team-size bounds, location, window, and availability. It contains no team identity, email, management verifier, quiz content, or correct answer.
- The server clock is authoritative for `registrationOpensAt` and `registrationClosesAt`.
- Synthetic tests use only `example.test` contacts and `demo-*` emulator projects.

Deferred abuse controls include a production CAPTCHA provider and email confirmation. These are required launch decisions, not silently emulated here.
