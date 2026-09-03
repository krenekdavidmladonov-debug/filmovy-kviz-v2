# Documentation index

This directory is the source of truth for Filmovy Kviz V2 product, architecture, security, migration, editor, projector, and Events Foundation decisions. Every document below is classified as **IMPLEMENTED**, **RESEARCH**, or **HISTORICAL**. Research and historical documents are not development contracts when they conflict with implemented code or the implemented documents listed here.

## IMPLEMENTED

### Development baseline

- [DEVELOPMENT_WORKFLOW.md](DEVELOPMENT_WORKFLOW.md) — canonical branch roles, test levels, reasoning policy, and worktree convention.
- [ROADMAP_V03.md](ROADMAP_V03.md) — implemented baseline, ordered next work, and explicitly deferred scope.

### Core, security, and V1 migration

- [ARCHITECTURE.md](ARCHITECTURE.md) — repository shape and trust boundaries.
- [DATA_MODEL.md](DATA_MODEL.md) — private and public Firestore models.
- [SECURITY.md](SECURITY.md) — authorization, answer secrecy, emulator safeguards, and Rules policy.
- [MIGRATION_V1.md](MIGRATION_V1.md) — fail-closed local V1 migration procedure and invariants.
- [V1_MIGRATION_REPORT.md](V1_MIGRATION_REPORT.md) — sanitized verification evidence for the lossless offline migration.

Managed exports and extracted documents are local-only under Git-ignored `.local-data/`. They are never CI fixtures or deployable assets.

### Editor and UX foundation

- [QUIZ_EDITOR.md](QUIZ_EDITOR.md) — canonical product and persistence contract for the implemented editor.
- [ROUND_FIRST_EDITOR_USER_GUIDE.md](ROUND_FIRST_EDITOR_USER_GUIDE.md) — moderator/admin workflow and field behavior.
- [ROUND_FIRST_EDITOR_DEVELOPER_GUIDE.md](ROUND_FIRST_EDITOR_DEVELOPER_GUIDE.md) — semantic model, mutation boundary, and lossless extension rules.
- [ROUND_FIRST_EDITOR_TESTING.md](ROUND_FIRST_EDITOR_TESTING.md) — local setup and verification matrix.
- [ROUND_FIRST_EDITOR_IMPLEMENTATION_REPORT.md](ROUND_FIRST_EDITOR_IMPLEMENTATION_REPORT.md) — sanitized implementation evidence.
- [UX_IMPLEMENTATION_FOLLOWUPS.md](UX_IMPLEMENTATION_FOLLOWUPS.md) — explicitly deferred follow-ups around the implemented UX foundation.

### Projector and media

- [LIVE_SESSION.md](LIVE_SESSION.md) — trusted live-session lifecycle.
- [PROJECTOR_ARCHITECTURE.md](PROJECTOR_ARCHITECTURE.md) — projector renderer, recap, and public-state authority.
- [MEDIA_ARCHITECTURE.md](MEDIA_ARCHITECTURE.md) — audio/video commands and player lifecycle.

### Preflight and guided repair

- [QUIZ_PREFLIGHT.md](QUIZ_PREFLIGHT.md) — canonical readiness, blocker/warning, editor/live, media, and security contract.
- [QUIZ_PREFLIGHT_IMPLEMENTATION_REPORT.md](QUIZ_PREFLIGHT_IMPLEMENTATION_REPORT.md) — sanitized implementation and verification evidence.

### Events Foundation

- [EVENTS_ARCHITECTURE.md](EVENTS_ARCHITECTURE.md) — event CRUD/lifecycle, capacity configuration, immutable snapshots, preflight lock/relock, and public projection contract.
- [EVENTS_SECURITY.md](EVENTS_SECURITY.md) — event, snapshot, `publicEvents`, Rules, and trusted Function boundary.
- [EVENTS_FOUNDATION_IMPLEMENTATION_REPORT.md](EVENTS_FOUNDATION_IMPLEMENTATION_REPORT.md) — sanitized implementation and verification evidence.

Registration and scoring are deliberately absent from the implemented Events Foundation.

### Local QA and event-night tooling

- [LOCAL_QA.md](LOCAL_QA.md) — one-click Windows QA launcher, tool discovery, localhost ports, and identity-checked process handling.
- [EVENT_NIGHT_LOCAL.md](EVENT_NIGHT_LOCAL.md) — reusable production-build localhost preview, persistence, backup, stop, and recovery tooling.

`OPEN_V1_FALLBACK.cmd` remains a manual-only link to the untouched V1 fallback. Automated tests must not open it or contact V1. Candidate manifests, repair progress, emulator snapshots, real-question screenshots, and media audit data remain under `.local-data/` or on historical branches.

## RESEARCH — NOT IMPLEMENTED

The following areas are discovery work only and must not be treated as shipped behavior or an authorization contract:

- registration, capacity enforcement for teams/people, and transactional signup;
- scoring, referee workflow, half-points, dense ranking, leaderboard, and announcement;
- PDF Print Center, answer keys, team sheets, and event-team binding;
- emailing;
- offline operation;
- Storage and media ownership/lifecycle.

Supporting product and UX discovery documents:

- [ADMIN_UX_SPEC_DRAFT.md](ADMIN_UX_SPEC_DRAFT.md)
- [DESIGN_SYSTEM_DRAFT.md](DESIGN_SYSTEM_DRAFT.md)
- [EDITOR_UX_SPEC_DRAFT.md](EDITOR_UX_SPEC_DRAFT.md)
- [INFORMATION_ARCHITECTURE_DRAFT.md](INFORMATION_ARCHITECTURE_DRAFT.md)
- [QUIZ_BEHAVIOR_SPEC_DRAFT.md](QUIZ_BEHAVIOR_SPEC_DRAFT.md)
- [PRODUCT_DECISIONS_REQUIRED.md](PRODUCT_DECISIONS_REQUIRED.md)
- [UX_PRODUCT_DECISIONS_REQUIRED.md](UX_PRODUCT_DECISIONS_REQUIRED.md)

The separate research branches are intentionally not part of `integration/v0.3-development`.

## HISTORICAL — NOT THE CURRENT DEVELOPMENT CONTRACT

These records preserve useful release and operational evidence from the cancelled tomorrow/event-night attempt. They do not authorize deployment and do not override current implemented documentation:

- [TOMORROW_RELEASE_CHECKLIST.md](TOMORROW_RELEASE_CHECKLIST.md)
- [TOMORROW_RELEASE_AUDIT.md](TOMORROW_RELEASE_AUDIT.md)
- [TOMORROW_5_MINUTE_GO_NO_GO.md](TOMORROW_5_MINUTE_GO_NO_GO.md)
- [TOMORROW_MANUAL_ACTIONS.md](TOMORROW_MANUAL_ACTIONS.md)
- [TOMORROW_FALLBACK_PLAN.md](TOMORROW_FALLBACK_PLAN.md)
- [EVENT_NIGHT_5_MINUTE_CHECK.md](EVENT_NIGHT_5_MINUTE_CHECK.md)
- [EVENT_NIGHT_FAILURE_CARD.md](EVENT_NIGHT_FAILURE_CARD.md)
- [RELEASE_CANDIDATE_AUDIT.md](RELEASE_CANDIDATE_AUDIT.md)

V1 remains the production fallback. No V2 deployment is implied by any historical document.
