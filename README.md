# JustKvíz

[![CI](https://github.com/krenekdavidmladonov-debug/filmovy-kviz-v2/actions/workflows/ci.yml/badge.svg)](https://github.com/krenekdavidmladonov-debug/filmovy-kviz-v2/actions/workflows/ci.yml)

JustKvíz is the existing V2 application for preparing and running quizzes, replacing the original Filmový Kvíz application. The current foundation includes a React web client, trusted Firebase Functions, emulator-only staff authentication, tested Firestore authorization rules, a live/projector foundation, and a lossless round-first quiz editor for migrated V1 content.

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

The application is available at `http://localhost:5173`. Administrative routes:

- `/admin/login` — email/password sign-in against Authentication Emulator
- `/admin` — protected staff dashboard
- `/admin/quizzes` — read-only quiz library
- `/admin/quizzes/:quizId` — read-only rounds and questions
- `/admin/quizzes/:quizId/edit` — focused round-first editor; admin write and moderator read-only
- `/admin/live/:sessionId` — authenticated moderator live control
- `/admin/no-access` — authenticated account without a staff role
- `/projector/:sessionId` — public read-only sanitized projector
- `/events` — sanitized public event list
- `/admin/events` — trusted event administration and immutable quiz preparation

The seed is idempotent and creates only local Authentication Emulator users:

| Account | Password | Custom claim |
| --- | --- | --- |
| `admin@example.test` | `LocalQuiz123!` | `role: "admin"` |
| `moderator@example.test` | `LocalQuiz123!` | `role: "moderator"` |
| `user@example.test` | `LocalQuiz123!` | none |

The seed script refuses to run unless `FIREBASE_AUTH_EMULATOR_HOST` points to local port `9099` and the project ID starts with `demo-`. The Vite development build also refuses to initialize Firebase unless emulator mode is enabled. Production access is not part of this workflow.

`pnpm seed:quizzes` creates three fixed emulator-only quizzes with rounds and private questions. It refuses non-local Firestore hosts and non-`demo-*` projects. Fixed document IDs and deterministic values make repeated runs safe. With both Auth and Firestore emulators running, `pnpm seed:emulators` runs both seeds.

## Firestore Security Rules tests

Run the rules suite when the full Emulator Suite is stopped, because this command manages its own Firestore Emulator lifecycle:

```bash
pnpm test:rules
pnpm test:unit
```

The tests use `@firebase/rules-unit-testing` against the real local Firestore rules runtime. They verify anonymous users, authenticated users without claims, moderators, admins, and unknown paths.

## Quality checks

GitHub Actions runs on Node.js 22 and Temurin JDK 21 for pushes and pull requests targeting `main`. It installs the frozen pnpm lockfile, typechecks, lints, builds production bundles, runs unit and synthetic migration regression tests, verifies Firestore Rules, and exercises the live flow through local Auth, Firestore, and Functions emulators using only `demo-filmovy-kviz-v2`. The workflow requires no secrets and performs no Firebase deploy.

```bash
pnpm typecheck
pnpm lint
pnpm build
pnpm test:rules
pnpm test:unit
# or all checks:
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

## Important safety boundary

Do not deploy or connect this repository to the existing production Firebase project without explicit authorization. Never add credentials or service-account keys to Git. See [docs/SECURITY.md](docs/SECURITY.md) and [AGENTS.md](AGENTS.md).

Current public branding and release scope: [JustKvíz rebrand](docs/JUSTKVIZ_REBRAND.md). The existing staging URL and technical identifiers remain unchanged.
