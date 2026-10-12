# Development restart — 2026-10-12

This is the dated coordination record for resuming Filmový Kvíz V2 / JustKvíz. It supplements the development workflow; it is not release approval or evidence of the current cloud environment. Historical roadmaps and audits must be checked against an exact commit before assigning implementation work.

## Verified Git baseline

`git fetch origin --no-tags` completed on 2026-10-12. The initial checkout was clean.

| Reference | Commit | Meaning at this inspection |
| --- | --- | --- |
| Initial `chore/v2-staging-environment` | `81a24c8` | Old checkout, 35 commits behind `origin/main`; not the restart baseline. |
| `origin/main` | `0d452d8` | Canonical integrated base, last commit dated 2026-09-10. |
| `codex/admin-clarity` | `8106c4a` | Latest discovered stacked candidate, dated 2026-09-18; contains all of `origin/main` plus 39 commits. |
| `codex/development-coordination` | based on `0d452d8` | Local documentation and coordination branch for this restart. |

The candidate already contains complete quiz authoring, media authoring, JustKvíz branding/dark mode, personal access, event management, historical results, navigation performance, working-copy saving, and editor outline changes. It spans 288 changed files relative to `origin/main`; its latest UI-oriented branch name understates its scope. Existing worktrees and branches have been preserved.

`origin/main` already contains event-bound snapshot live sessions, scoring, referee capabilities, interim/final result publication, registration and organizational email code, and owned media. These must not be assigned again as missing features. Implementation does not establish that cloud prerequisites or delivery are active.

GitHub PR/CI status was not verified: the local `gh` request returned HTTP 401 and the connected GitHub search could not access this repository. Successful Git fetch establishes commit ancestry, not review approval, CI health, or deployed state.

## Team and authority

The lead assigns work, resolves dependencies, reviews changes, and prepares integration and deployment. The owner requested that the highest reasoning setting be reserved for the lead. The first three workers were explicitly started as GPT-6.1 Sol MEDIUM:

| Worker | First assignment | Outcome |
| --- | --- | --- |
| Product | Compare implementation and historical backlog | Corrected the initial old-checkout assessment against `8106c4a`; identified integration and acceptance work rather than missing core features. |
| Security | Read-only review of answer/contact isolation, roles, media, referee, scoring, seed guards | No concrete bypass found in reviewed paths; identified a public-capacity documentation mismatch. This was not a full audit of the candidate's personal-access changes. |
| Quality | Test/CI inventory and ancestry | Established the baseline and test limits; assigned a bounded correction of the documentation index. |

Workers initially had read-only scope. The documentation worker later received ownership of only `README.md` and `docs/README.md`. These limits are task instructions, not separate technical access-control sandboxes. All review and integration decisions remain with the lead.

## Ordered work queue

| Priority | Work package / owner | Acceptance evidence |
| --- | --- | --- |
| Done | Reconcile baseline and status / lead + documentation worker | Exact SHAs, ancestry and existing features recorded; obsolete index claims corrected; initial runtime checks attributed to the tested candidate below. |
| P0 | Review and validate the stacked candidate / lead + QA + security worker | Review personal access, event disposition/deletion, editor working copy and media boundaries; run current candidate CI-equivalent gates; recover verifiable PR/CI status before remote integration. |
| P1 | Integrate accepted work / lead | Reviewable dependency order or explicitly reviewed aggregate PR; no dropped feature commits; regression evidence on the final integrated SHA. No remote merge has been performed by this restart. |
| P1 | Reconcile public capacity contract / security worker + lead | `functions/src/events/model.ts` publishes exact accepted/maximum counts, while `docs/DATA_MODEL.md` says exact capacities are excluded. Compare the implemented Events/Registration contracts before changing public behavior; retain contact and answer isolation. |
| P1 | One complete quiz/event acceptance run / QA + lead | Create/edit/save/reload quiz, prepare immutable event snapshot, register teams, run event/projector, score, reveal/finalize and inspect historical results. Exercise access denial, conflicts, revocation and lost responses. |
| P1 | Prepare V2 staging delivery / lead | Exact candidate/artifacts, required Functions/Rules/Storage/IAM, rollback and smoke checks are ready for owner review. Historical infrastructure notes are not a current cloud inspection. Explicit deployment approval remains required. |
| P2 | Public-launch operations / lead + owner | Decide and implement applicable registration abuse controls, recovery/token policy, contact retention, real email provisioning and monitoring. Synthetic capture tests do not prove email delivery. |
| P2 | Venue acceptance / owner with QA checklist | Verify actual projector/HDMI/audio, external video and recovery over a realistic event. Local automated tests alone cannot establish this. |

Offline sync, hosted video/transcoding, and unrelated product expansion are not automatically added to the completion scope. Ask the owner only for a material unresolved product decision after checking the existing contracts.

## Validation record

Candidate under local validation: `8106c4a` in the existing clean `C:\Projects\filmovy-kviz-v2\.local-data\editor-save-all` worktree. Documentation edits are on the separate coordination branch. Demo/emulator selection is explicit; no cloud deploy or real email is part of these checks.

- `pnpm check`: PASS; typecheck, lint and workspace build. Vite reported a large main bundle (about 981 kB before gzip); this was a warning, not a failed build.
- `pnpm test:unit -- --reporter=dot`: PASS, 48 files / 445 tests.
- `node --test tests/staging-guard.test.mjs`: PASS, 7 tests; no deployment performed.
- `pnpm test:rules`: PASS, 50 tests in the local Firestore emulator for `demo-filmovy-kviz-v2`. The first attempt could not find Java on PATH; rerunning with the already installed JDK 21 and Node 22 succeeded. The emulator shut down after the run.
- Runtime for check/unit: Node `24.19.0`, pnpm `11.25.0`. Rules used Node `22.23.2`, JDK `21.0.12.1`, pnpm `11.25.0`. The repository requests Node 22 / pnpm `11.19.0`; this local evidence is not a substitute for the pinned CI environment.
- Candidate tracked files remained clean after the checks. No browser/callable end-to-end, Storage emulator, full real-data migration or venue acceptance run was performed in this kickoff.
- Coordination documentation: `git diff --check` and documentation-index link existence checks PASS; an independent worker reviewed the restart record for factual consistency.
- Read-only audits are bounded inspection evidence, not a security certification.

Before release, require `pnpm check`, unit tests, staging guard checks, Firestore Rules tests, relevant callable/browser tests and Storage emulator coverage for media on the same candidate. Set browser targets explicitly to loopback; use synthetic fixtures and `demo-*` projects. Significant release or persisted-model changes also require the applicable migration gate from `DEVELOPMENT_WORKFLOW.md`.

This session did not inspect production, establish current staging state, configure background automation, or authorize deployment. Remaining work above is a queue, not a claim that workers continue running after a chat turn ends.
