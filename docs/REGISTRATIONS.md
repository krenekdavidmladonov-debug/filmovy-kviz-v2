# Event Registrations V1

## Implemented scope

An administrator configures `registrationOpensAt`, `registrationClosesAt`, and publication on an event. Server time decides whether creation, management-link edits, and management-link cancellation are available. There is no waitlist: a transaction rejects any request that would exceed either the team or people capacity.

The public form requires only team name, member count, and email. Team names are NFC-normalized, trimmed, whitespace-collapsed, and compared case-insensitively within the event. A SHA-256 name reservation document makes uniqueness transaction-safe.

Accepted registrations can be edited or soft-cancelled with the unguessable management link while the registration window is open. The raw token is placed in the URL fragment, which is not sent to Hosting or in HTTP referrers. Cancellation releases both counters atomically and is idempotent. Email delivery is intentionally deferred.

Staff use `/admin/events/:eventId/registrations`. Admins configure and cancel; moderators have read-only access. Contacts never enter `publicEvents` or the PDF `PrintTeam` adapter.

## PDF contract

`accepted Registration -> PrintTeam` maps only the registration document ID and display team name. The server resolves one or all accepted teams; cancelled teams and contact fields cannot be supplied by the browser or rendered.
