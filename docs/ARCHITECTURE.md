# Architecture

## Goals

Filmový Kvíz V2 is a small but real application for preparing and running pub quizzes. The architecture favors clear boundaries and operational reliability over unnecessary layers.

## Repository layout

The repository is a pnpm workspace with two deployable units:

1. `apps/web` — one React/Vite single-page application with three route groups.
2. `functions` — Firebase Cloud Functions forming the trusted server boundary.

Keeping one web application avoids duplicated infrastructure while route-level modules preserve separation between audiences.

## Web route groups

### `/admin`

Authenticated working area for admins and moderators. Route guards improve UX, but Firestore Rules and Cloud Functions remain the authorization boundary.

### `/projector`

Public, read-only display for the active session. It consumes a deliberately sanitized projection document and never queries private quiz/question documents directly.

### `/events`

Public event list and registration surface. Public event data contains capacity/status information but no team contact details.

## Data flow and trust boundaries

```text
Admin browser ── authenticated requests ──> Firestore / Cloud Functions
                                                  │
                                                  ├─ private quiz data
                                                  ├─ private registrations
                                                  └─ sanitized public projection

Projector browser ── read only ───────────────────> sanitized public projection
Public browser ───── public reads / validated call> public events / Cloud Function
```

Sensitive state transitions—team registration, quiz publication, live-state changes, answer reveal, role management, and result finalization—belong in Functions. The server derives authoritative fields such as timestamps, capacity counters, and public projection payloads.

## Frontend modules

- `app`: router and top-level application composition.
- `routes`: route-group screens and future nested routing.
- `services/firebase`: SDK initialization and emulator wiring.
- `styles`: global design tokens and base presentation.

Feature folders may be added when real behavior arrives. A generic repository/service abstraction is not required until repeated use proves it valuable.

## Firebase services

- Authentication: staff sign-in; role authorization via custom claims.
- Firestore: operational and public projection data.
- Storage: quiz media, with metadata/access controlled by Firestore and Rules.
- Functions: validation, authorization, transactions, sanitized publication, and other trusted operations.
- Hosting: Vite static build with SPA rewrites.

## Environments

- Local: Firebase Emulator Suite with `demo-filmovy-kviz-v2`.
- Future staging: a separate non-production Firebase project, added only intentionally.
- Production: never targeted without explicit approval.

No production project identifiers or credentials are stored in this repository.

## Testing strategy

The current foundation uses static checks and production builds. As features arrive, add unit tests, emulator Rules tests, Functions integration tests, focused component tests, and a small end-to-end smoke suite.
