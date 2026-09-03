# V0.3 development workflow

This document defines the normal development workflow after the human merge of PR #8. Until that merge, `integration/v0.3-development` is the reviewed candidate; after it, `main` is the only canonical V2 integration base.

## Branch roles

- **MAIN** — canonical integrated V2 base. Start every new feature from the current `main` after PR #8 is merged by a human.
- **FEATURE** — `feature/<scope>` for production implementation with a bounded product scope.
- **QA** — `qa/<scope>` for temporary audit or validation tooling. Do not treat QA-only output as product code or merge private artifacts.
- **RELEASE** — `release/<version>` only when an actual release is being prepared.
- **RESEARCH** — `research/<scope>` for discovery and architecture work without production implementation.

Keep changes reviewable, preserve unrelated work, and integrate completed features through a PR. Never use branch names as evidence of ancestry or implementation status.

## Test policy

### Level A — Quick

Use for documentation, small fixes, and narrow implementation changes:

- targeted tests;
- typecheck and lint relevant to the change.

### Level B — Feature

Use for normal feature delivery:

- targeted feature tests;
- relevant security tests;
- production build;
- CI.

### Level C — Full release

Use for release preparation or changes to foundational persisted-data contracts:

- complete test suites;
- full migration verification;
- extended browser and projector QA.

Run full migration verification only when at least one of these conditions applies:

- the migration mapper changed;
- the persisted quiz schema changed;
- the legacy-preservation contract changed;
- the shared migration/domain model changed;
- a significant release is being prepared.

Do not run full migration verification for ordinary feature work.

## Codex reasoning policy

- **LOW** — repository housekeeping, documentation, and trivial fixes.
- **MEDIUM** — standard UI and CRUD work.
- **HIGH** — substantial features, trusted Functions, PDF, registration transactions, and scoring.
- **XHIGH** — architecture or security redesign, a serious production incident, or major migration redesign.

XHIGH is not the default. Choose the lowest level appropriate to the risk and ambiguity of the task.

## Worktree convention

Store future isolated worktrees under `C:\Projects\filmovy-kviz-worktrees\`, for example:

- `C:\Projects\filmovy-kviz-worktrees\pdf`
- `C:\Projects\filmovy-kviz-worktrees\registrations`
- `C:\Projects\filmovy-kviz-worktrees\scoring`

Create a worktree only when its task starts. Do not commit local data, credentials, browser profiles, emulator exports, private screenshots, or production configuration.
