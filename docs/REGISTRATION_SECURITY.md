# Registration Security

- Browsers cannot write `events`, `registrations`, `registrationNames`, or `publicEvents` directly.
- Anonymous clients can query only the allowlisted `publicEvents` projection. They cannot get or list registrations.
- Admins and moderators can read registration records; ordinary authenticated users cannot. Only admins can invoke configuration or administrative cancellation.
- Public create remains anonymous-only. Management get/edit/cancel require the registration's bearer token regardless of an anonymous, ordinary authenticated, or staff browser session. A session never substitutes for the token or grants management of another registration. Create, capacity changes, name reservations, and cancellation counters are Firestore transactions.
- Management tokens contain 256 bits of random entropy. Firestore stores only a SHA-256 verifier; the raw token stays in the URL fragment, token comparison is timing-safe, and invalid event/registration/token combinations return the same non-enumerating error.
- `publicEvents` contains only aggregate capacity, team-size bounds, location, window, and availability. It contains no team identity, email, management verifier, quiz content, or correct answer.
- The server clock is authoritative for `registrationOpensAt` and `registrationClosesAt`.
- Synthetic tests use only `example.test` contacts and `demo-*` emulator projects.

Deferred launch prerequisites include management-link recovery and protection of public operations against abuse (including a production CAPTCHA decision). Email delivery, link recovery, and token rotation are not implemented.
