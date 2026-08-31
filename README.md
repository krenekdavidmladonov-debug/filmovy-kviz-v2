# Filmový Kvíz V2

Clean replacement for the Filmový Kvíz application. This repository currently contains only the maintainable foundation: a React web client, Firebase Functions, secure baseline rules, routing, and architecture documentation. Quiz behavior is intentionally not implemented yet.

## Requirements

- Node.js 22+
- pnpm 11+
- Firebase CLI (only needed for local emulators)

## Install and run

```bash
pnpm install
cp apps/web/.env.example apps/web/.env.local
pnpm dev
```

The Vite application is available at `http://localhost:5173`. Routes prepared in this phase:

- `/admin` — private administration area placeholder
- `/projector` — public projector placeholder
- `/events` — public events placeholder

For Firebase-backed local development, copy `.firebaserc.example` to `.firebaserc` and start the Emulator Suite in a separate terminal:

```bash
firebase emulators:start --project demo-filmovy-kviz-v2
```

The example web configuration points only to local emulators and uses a `demo-*` project ID. The application refuses non-demo project IDs unless the developer deliberately opts in; production access is not part of this setup.

## Quality checks

```bash
pnpm typecheck
pnpm lint
pnpm build
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
