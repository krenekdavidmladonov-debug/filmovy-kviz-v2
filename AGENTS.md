# AGENTS.md

## Scope

This repository contains Filmový Kvíz V2, a replacement for an existing production application. The existing application and its Firebase project are out of scope.

## Non-negotiable safety rules

- Never deploy to Firebase Hosting, Functions, Firestore, Storage, or any other environment without explicit user approval in the current conversation.
- Never connect to the production Firebase project or copy production credentials/data without explicit approval.
- Never commit secrets, service-account keys, `.env` files, access tokens, or production Firebase configuration.
- Use Firebase Emulator Suite and a `demo-*` project ID for local development.
- Seed scripts must fail closed unless both a local emulator host and a `demo-*` project ID are present.
- A correct answer must never be sent to a public or projector client before it is explicitly revealed.
- Public clients must not read private quiz documents or team contact data.
- Authentication alone is not authorization. Administrative access requires a current active server-managed membership, the concrete permissions for the operation, and scope for the affected resource, enforced by Security Rules and server code. Role labels and legacy Auth claims alone grant no authority.
- Treat all browser input as untrusted. Validate sensitive writes in Cloud Functions.
- Begin Security Rules with least privilege and add access only alongside emulator tests.

## Engineering workflow

### Owner-directed autonomy (2026-10-13)

The owner has instructed the lead to continue development autonomously and coordinate all available worker slots efficiently. Local implementation, corrective changes, isolated synthetic emulator tests, documentation, dedicated branches and local commits are authorized; do not request repeated approval for these routine steps. An earlier completed QA phase does not prohibit new evidence-driven development.

The lead assigns at most three concurrent workers, explicitly using GPT-6.1 Sol with low, medium or high reasoning and disjoint file ownership. Reuse prior passing evidence where source and scope still match; run additional checks for actual changes or missing coverage. The lead reviews and integrates results. Once a concrete external action is authorized in the conversation, carry out necessary implementation details within that scope without asking for the same approval again.

This instruction does not supply missing credentials or physical equipment, expand an expired temporary grant, or authorize unrelated production data, destructive cleanup or real email to unspecified recipients. Prepare concrete remaining external steps and report only the actual missing input. Preserve all security invariants above.

- Read `docs/ARCHITECTURE.md`, `docs/DATA_MODEL.md`, and `docs/SECURITY.md` before changing boundaries, collections, or authorization.
- Create a dedicated branch before a substantial change.
- Keep commits small, logical, and reversible. Preserve unrelated user changes.
- Prefer simple, readable modules over speculative abstractions.
- Run `pnpm check` and `pnpm test:rules` before committing changes to authentication, authorization, collections, or Security Rules.
- Update documentation when architecture, data ownership, or security assumptions change.

## Project layout

- `apps/web`: React/Vite client containing admin, projector, and public surfaces.
- `functions`: trusted Firebase Cloud Functions boundary.
- `docs`: architecture, data model, and security decisions.
- Root Firebase files: emulator/deployment configuration and deny-by-default rules.

## Environment rules

- Copy `apps/web/.env.example` to `apps/web/.env.local` for local work.
- Keep `VITE_FIREBASE_PROJECT_ID` on a `demo-*` project unless the user explicitly authorizes another non-production environment.
- Prefer emulators. Do not run `firebase deploy` as part of routine verification.
