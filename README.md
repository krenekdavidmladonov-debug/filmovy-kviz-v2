# Filmový Kvíz V2

Clean replacement for the Filmový Kvíz application. The current foundation includes a React web client, Firebase Functions, emulator-only staff authentication, tested Firestore authorization rules, routing, and architecture documentation. Quiz behavior is intentionally not implemented yet.

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
pnpm dev
```

The application is available at `http://localhost:5173`. Administrative routes:

- `/admin/login` — email/password sign-in against Authentication Emulator
- `/admin` — protected staff dashboard
- `/admin/no-access` — authenticated account without a staff role
- `/projector` — public projector placeholder
- `/events` — public events placeholder

The seed is idempotent and creates only local Authentication Emulator users:

| Account | Password | Custom claim |
| --- | --- | --- |
| `admin@example.test` | `LocalQuiz123!` | `role: "admin"` |
| `moderator@example.test` | `LocalQuiz123!` | `role: "moderator"` |
| `user@example.test` | `LocalQuiz123!` | none |

The seed script refuses to run unless `FIREBASE_AUTH_EMULATOR_HOST` points to local port `9099` and the project ID starts with `demo-`. The Vite development build also refuses to initialize Firebase unless emulator mode is enabled. Production access is not part of this workflow.

## Firestore Security Rules tests

Run the rules suite when the full Emulator Suite is stopped, because this command manages its own Firestore Emulator lifecycle:

```bash
pnpm test:rules
```

The tests use `@firebase/rules-unit-testing` against the real local Firestore rules runtime. They verify anonymous users, authenticated users without claims, moderators, admins, and unknown paths.

## Quality checks

```bash
pnpm typecheck
pnpm lint
pnpm build
pnpm test:rules
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

## Important safety boundary

Do not deploy or connect this repository to the existing production Firebase project without explicit authorization. Never add credentials or service-account keys to Git. See [docs/SECURITY.md](docs/SECURITY.md) and [AGENTS.md](AGENTS.md).
