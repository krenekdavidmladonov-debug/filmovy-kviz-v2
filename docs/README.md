# Documentation index

This directory is the source of truth for Filmovy Kviz V2 product, architecture, security, migration, editor, and projector decisions. Documents marked as drafts describe discovery or future work; the remaining documents describe implemented behavior.

## Round-first quiz editor

- [QUIZ_EDITOR.md](QUIZ_EDITOR.md) — canonical product and persistence contract for the implemented editor.
- [ROUND_FIRST_EDITOR_USER_GUIDE.md](ROUND_FIRST_EDITOR_USER_GUIDE.md) — moderator/admin workflow and field-level behavior.
- [ROUND_FIRST_EDITOR_DEVELOPER_GUIDE.md](ROUND_FIRST_EDITOR_DEVELOPER_GUIDE.md) — code map, semantic facade, mutation boundary, lossless behavior, and extension rules.
- [ROUND_FIRST_EDITOR_TESTING.md](ROUND_FIRST_EDITOR_TESTING.md) — local setup, test matrix, migrated-data verification, and release checklist.
- [ROUND_FIRST_EDITOR_IMPLEMENTATION_REPORT.md](ROUND_FIRST_EDITOR_IMPLEMENTATION_REPORT.md) — sanitized implementation and verification evidence for the feature branch.
- [UX_IMPLEMENTATION_FOLLOWUPS.md](UX_IMPLEMENTATION_FOLLOWUPS.md) — intentionally deferred product and technical work.

## Platform foundations

- [ARCHITECTURE.md](ARCHITECTURE.md) — repository shape and trust boundaries.
- [DATA_MODEL.md](DATA_MODEL.md) — private and public Firestore models.
- [SECURITY.md](SECURITY.md) — authorization, answer secrecy, emulator safeguards, and Rules policy.
- [LIVE_SESSION.md](LIVE_SESSION.md) — trusted live-session lifecycle.
- [PROJECTOR_ARCHITECTURE.md](PROJECTOR_ARCHITECTURE.md) — projector renderer and public-state authority.
- [MEDIA_ARCHITECTURE.md](MEDIA_ARCHITECTURE.md) — audio/video commands and player lifecycle.

## V1 migration

- [MIGRATION_V1.md](MIGRATION_V1.md) — operator procedure and migration contract.
- [V1_MIGRATION_REPORT.md](V1_MIGRATION_REPORT.md) — sanitized results from the offline V1 library migration.

The managed export and extracted documents are local-only under `.local-data/` and must never be committed or uploaded.

## Discovery and future decisions

- [ADMIN_UX_SPEC_DRAFT.md](ADMIN_UX_SPEC_DRAFT.md)
- [DESIGN_SYSTEM_DRAFT.md](DESIGN_SYSTEM_DRAFT.md)
- [EDITOR_UX_SPEC_DRAFT.md](EDITOR_UX_SPEC_DRAFT.md)
- [INFORMATION_ARCHITECTURE_DRAFT.md](INFORMATION_ARCHITECTURE_DRAFT.md)
- [QUIZ_BEHAVIOR_SPEC_DRAFT.md](QUIZ_BEHAVIOR_SPEC_DRAFT.md)
- [PRODUCT_DECISIONS_REQUIRED.md](PRODUCT_DECISIONS_REQUIRED.md)
- [UX_PRODUCT_DECISIONS_REQUIRED.md](UX_PRODUCT_DECISIONS_REQUIRED.md)

Draft documents are not authority for behavior that conflicts with implemented code, `QUIZ_EDITOR.md`, `SECURITY.md`, or `DATA_MODEL.md`.
