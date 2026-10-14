# JustKvíz

[![CI](https://github.com/krenekdavidmladonov-debug/filmovy-kviz-v2/actions/workflows/ci.yml/badge.svg)](https://github.com/krenekdavidmladonov-debug/filmovy-kviz-v2/actions/workflows/ci.yml)

JustKvíz is the V2 application for preparing and running quizzes, replacing the original Filmový Kvíz application. The locally integrated code includes a React client, trusted Firebase Functions, personal accounts with scoped memberships, a lossless round-first editor with private drafts and media, shared in-memory edits and Save all, event lifecycle management, scoring, projector publication and confirmed historical results.

Current validation evidence and remaining work are recorded in [DEVELOPMENT_STATUS.md](docs/DEVELOPMENT_STATUS.md). The [restart release plan](docs/RESTART_RELEASE_PLAN.md) defines the proposed staging scope and approval prerequisites; local integration does not establish current cloud readiness or authorize deployment.

## RYCHLÉ SPUŠTĚNÍ PRO HUMAN QA

Windows:

1. Dvakrát klikněte na `START_LOCAL_QA.cmd` v rootu projektu.
2. Počkejte, až se automaticky otevře `http://localhost:5173/admin/login`.
3. Přihlaste se jako `admin@example.test` s heslem `LocalQuiz123!`.
4. Po testování dvakrát klikněte na `STOP_LOCAL_QA.cmd`.

Launcher sám najde podporovaný Node.js, pnpm a Javu, ověří porty, spustí pouze projekt `demo-filmovy-kviz-v2`, počká na emulátory, provede idempotentní seed a spustí Vite. Nemění uživatelský ani systémový `PATH`. Pokud některý předpoklad nebo bezpečnostní kontrola selže, nic dalšího nespustí a zobrazí lidskou chybu. Podrobnosti a řešení problémů jsou v [lokálním QA návodu](docs/LOCAL_QA.md).

## Requirements

- Node.js 22+
- pnpm 11+
- Java JDK 21+ recommended for the current and upcoming Firestore Emulator releases

## Install and run

```bash
pnpm install
cp apps/web/.env.example apps/web/.env.local
pnpm emulators
```

In a second terminal, seed the emulator-only accounts and start Vite:

```bash
pnpm seed:auth
pnpm seed:quizzes
pnpm dev
```

The application is available at `http://localhost:5173`. Current routes include:

- `/admin/login` — email/password sign-in against Authentication Emulator
- `/admin` — dashboard for an account with current active membership
- `/admin/users` — membership and invitation administration requiring `users.manage`
- `/admin/quizzes` — scoped quiz library
- `/admin/quizzes/new` — quiz creation requiring `quiz.create`
- `/admin/quizzes/:quizId` — read-only rounds and questions
- `/admin/quizzes/:quizId/edit` — round-first editor; writes require current edit permissions and quiz scope
- `/admin/quizzes/:quizId/readiness` — private quiz readiness; `/admin/quizzes/:quizId/readiness/repair` requires edit and answer permissions
- `/admin/live/:sessionId` — live control requiring `event.live` and the applicable resource scope
- `/admin/no-access` — authenticated account without usable application access
- `/account` and `/invite/:inviteId` — personal account setup and invitation acceptance; invitations have a separate activation gate
- `/projector/:sessionId` — public read-only sanitized projector
- `/events` — sanitized public event list
- `/events/:eventId` — public registration; management links open `/events/:eventId/registration/manage`
- `/admin/events` and `/admin/events/new` — scoped event list and permitted event creation
- `/admin/events/:eventId` — event detail, immutable quiz preparation and permitted lifecycle actions
- `/admin/events/:eventId/registrations` — team administration with contact and operation-specific permissions
- `/admin/events/:eventId/scoring` — internal round scoring with current event access and score permissions for writes
- `/admin/events/:eventId/print` — PDF Print Center with export and document-specific permissions
- `/admin/events/:eventId/results` — confirmed final results of a completed event, read-only
- `/referee/:eventId` — minimal event-scoped bearer access for referees

`pnpm seed:auth` prepares only local Authentication Emulator accounts and explicit Firestore memberships. Current access requires an active membership, concrete permissions and resource scope. The seed retains legacy custom claims for compatibility; those claims grant no application authority.

| Account | Password | Seeded membership |
| --- | --- | --- |
| `admin@example.test` | `LocalQuiz123!` | `manager`, all current permissions, all quiz/event scopes |
| `moderator@example.test` | `LocalQuiz123!` | `moderator`, explicit quiz reads and event live/scoring/contact/export permissions, all quiz/event scopes |
| `user@example.test` | `LocalQuiz123!` | No active membership; an existing membership is suspended |

The seed refuses non-local Auth/Firestore emulator hosts and requires a `demo-*` project ID. The standard local launcher uses Auth port `9099` and Firestore port `8080`; the scripts accept explicit valid loopback ports. Keep emulator mode enabled for this workflow. The separate guarded staging configuration is described in the release plan; production access is outside this workflow.

`pnpm seed:quizzes` creates three fixed emulator-only quizzes with rounds and private questions. It refuses non-local Firestore hosts and non-`demo-*` projects. Fixed document IDs and deterministic values make repeated runs safe. With both Auth and Firestore emulators running, `pnpm seed:emulators` runs both seeds.

## Firestore Security Rules tests

Run the rules suite when the full Emulator Suite is stopped, because this command manages its own Firestore Emulator lifecycle:

```bash
pnpm test:rules
pnpm test:unit
```

The tests use `@firebase/rules-unit-testing` against the real local Firestore rules runtime. They verify public/private boundaries, current memberships and scopes, denial for claim-only or inactive accounts, direct-write denial and unknown paths.

## Quality checks

GitHub Actions runs on Node.js 22 and Temurin JDK 21 for pushes and pull requests targeting `main`. It installs the frozen pnpm lockfile, typechecks, lints, builds production bundles, runs unit and synthetic migration regression tests, verifies Firestore Rules, and exercises the live flow through local Auth, Firestore, and Functions emulators using only `demo-filmovy-kviz-v2`. The workflow requires no secrets and performs no Firebase deploy.

```bash
pnpm typecheck
pnpm lint
pnpm build
pnpm test:rules
pnpm test:unit
# Typecheck, lint, and build together (tests run separately):
pnpm check
```

## Repository structure

```text
apps/web/             React + TypeScript + Vite frontend
functions/            Firebase Cloud Functions in TypeScript
docs/                 Architecture, data model, and security notes
firebase.json         Hosting, Functions, rules, and emulator configuration
firestore.rules       Deny-by-default Firestore rules
storage.rules         Deny-by-default Storage rules
```

## Documentation

Start with [docs/README.md](docs/README.md). The round-first editor documentation is split by audience:

- [editor contract](docs/QUIZ_EDITOR.md);
- [user guide](docs/ROUND_FIRST_EDITOR_USER_GUIDE.md);
- [developer guide](docs/ROUND_FIRST_EDITOR_DEVELOPER_GUIDE.md);
- [testing and local operations](docs/ROUND_FIRST_EDITOR_TESTING.md).

Integrated contracts and release context: [complete editor](docs/COMPLETE_EDITOR_RELEASE.md), [shared working copy](docs/EDITOR_WORKING_COPY.md), [outline movement](docs/EDITOR_OUTLINE.md), [personal access](docs/PERSONAL_ACCESS.md), [event management](docs/EVENT_MANAGEMENT.md), [historical results](docs/HISTORICAL_RESULTS.md) and [restart release plan](docs/RESTART_RELEASE_PLAN.md). Release receipts and older staging runbooks remain historical evidence.

## Important safety boundary

Do not deploy or connect this repository to the existing production Firebase project without explicit authorization. Never add credentials or service-account keys to Git. See [docs/SECURITY.md](docs/SECURITY.md) and [AGENTS.md](AGENTS.md).

On 2026-10-12 the owner approved aligning [AGENTS.md](AGENTS.md) with the integrated authorization model: active server-managed membership, concrete permissions and applicable resource scope, enforced by Security Rules and server code. Legacy claims alone grant no authority. The owner also authorized read-only V2 staging preflight; this does not establish cloud readiness or authorize deployment. See [DEVELOPMENT_STATUS.md](docs/DEVELOPMENT_STATUS.md) for the current scope and results.

Current public branding and release scope: [JustKvíz rebrand](docs/JUSTKVIZ_REBRAND.md). The existing staging URL and technical identifiers remain unchanged.
