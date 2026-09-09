# Registration Security

- Browsers cannot write `events`, `registrations`, `registrationNames`, or `publicEvents` directly.
- Anonymous clients can query only the allowlisted `publicEvents` projection. They cannot get or list registrations.
- Admins and moderators can read registration records; ordinary authenticated users cannot. Only admins can invoke configuration or administrative cancellation.
- Public create remains anonymous-only. Management get/edit/cancel require the registration's bearer token regardless of an anonymous, ordinary authenticated, or staff browser session. A session never substitutes for the token or grants management of another registration. Create, capacity changes, name reservations, and cancellation counters are Firestore transactions.
- Management tokens contain 256 bits of random entropy. Registration records store only a SHA-256 verifier; transactional email keeps the same token in a separate AES-GCM envelope denied to every client role. The transient raw token stays in the URL fragment, token comparison is timing-safe, and invalid event/registration/token combinations return the same non-enumerating error. The new create retry capability is stored only as a hash and never grants access to another registration's management calls.
- `publicEvents` contains only aggregate capacity, team-size bounds, location, window, and availability. It contains no team identity, email, management verifier, quiz content, or correct answer.
- The server clock is authoritative for `registrationOpensAt` and `registrationClosesAt`.
- Synthetic tests use only `example.test` contacts and `demo-*` emulator projects.

The local transactional email domain, capture transport and lost-create-response recovery are implemented; see [TRANSACTIONAL_EMAIL.md](TRANSACTIONAL_EMAIL.md). Real cloud email/key provisioning, arbitrary link recovery, token rotation and protection of public operations against abuse (including a production CAPTCHA decision) remain launch prerequisites. No cloud email service is active.
