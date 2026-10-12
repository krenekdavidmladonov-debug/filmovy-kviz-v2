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
| `codex/restart-integration` | `8b6245608850c9cad959fb14ab6a754f485e1dad` | Frozen locally integrated application/test candidate. The subsequent documentation-only commit records its evidence; canonical `main` and remote branches remain unchanged. |

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
| Done locally / P0 | Validate the locally integrated candidate / lead + QA + security worker | Bounded access, event deletion and editor reviews completed. Three demonstrated application issues fixed; broad local regressions completed. Final exact-SHA gates passed at 14:13; see RESTART_VALIDATION.md. Remote PR/CI remains unverified. |
| Done locally | Integrate accepted work / lead | Merge `415a8c9` includes `8106c4a` without dropping feature commits. Fixes are separate reversible commits. No remote merge or push performed. |
| Done | Reconcile public capacity contract / security worker + lead | `3f703ad` aligns three documents with the already implemented and tested registration aggregate accepted/maximum counts. No public behavior or contact/answer access was changed. |
| Done locally | One complete quiz/event acceptance run / QA + lead | The new UI-authored event gate creates/edits/reopens a quiz, locks its snapshot, registers two teams, scores, explicitly reveals answers and final placements, ends the event and reloads exact historical results. Access, conflict, revocation and lost-response cases also pass in their dedicated suites. |
| Local scope ready / approval required | Prepare V2 staging delivery / lead + owner | Unified 70-function inventory, exact code candidate, prerequisites, rollback and smoke plan are in RESTART_RELEASE_PLAN.md. Current cloud inventory, compatible artifact preparation and remote CI still require the next approved phase; no deployment is authorized. |
| P2 | Public-launch operations / lead + owner | Decide and implement applicable registration abuse controls, recovery/token policy, contact retention, real email provisioning and monitoring. Synthetic capture tests do not prove email delivery. |
| P2 | Venue acceptance / owner with QA checklist | Verify actual projector/HDMI/audio, external video and recovery over a realistic event. Local automated tests alone cannot establish this. |

Offline sync, hosted video/transcoding, and unrelated product expansion are not automatically added to the completion scope. Ask the owner only for a material unresolved product decision after checking the existing contracts.

## Autonomous continuation — enabled 2026-10-12

The owner requested fully independent coordination and continuation. The active in-chat heartbeat **Samostatné dokončení JustKvíz** (`samostatn-dokon-en-justkv-z`) was created with a 30-minute interval. It resumes this chat and its existing work queue; it does not create a new project or a fresh team for each tick. It must inspect current agents and working copies before assigning work to avoid duplicate activity.

Within an active run the lead proceeds from task assignment through implementation, independent review, tests, and the next ready task without waiting for an owner message. Routine technical decisions and recoverable failures belong to the lead. A worker's claim of completion is accepted only after reviewing its diff and the required evidence on the actual candidate SHA. The highest model settings remain reserved for the lead; worker effort is explicitly LOW, MEDIUM, or HIGH.

The current autonomous phase ends with a reviewed, locally integrated release candidate, resolved demonstrated blockers, relevant passing checks, recorded limitations, and a concrete deployment scope, rollback and smoke plan ready for approval. The heartbeat must then report the outcome and pause itself. If only a missing external access, essential product decision or approval remains and there is no useful authorized work left, it reports the exact need once and pauses instead of repeating unsuccessful attempts.

Report meaningful completed steps, newly significant failures, readiness, or required owner action; do not repeat unchanged status. The owner can stop the process in this chat. Local scheduled work requires the computer to remain awake and the desktop app running; scheduling does not bypass account limits, permissions or unavailable services. See the [official scheduled-task documentation](https://learn.chatgpt.com/docs/automations).

This continuation request does not approve Firebase deployment, production access/data, real email sending, or destructive actions. Prepare any required approval against a concrete reviewed result; continue independent authorized work until then.

## Historical kickoff validation record

Initial candidate tested before integration: `8106c4a` in the then-clean `C:\Projects\filmovy-kviz-v2\.local-data\editor-save-all` worktree. Documentation edits were on the separate coordination branch. Demo/emulator selection was explicit; no cloud deploy or real email was part of these checks. This historical evidence is superseded by the final integrated-candidate record below.

- `pnpm check`: PASS; typecheck, lint and workspace build. Vite reported a large main bundle (about 981 kB before gzip); this was a warning, not a failed build.
- `pnpm test:unit -- --reporter=dot`: PASS, 48 files / 445 tests.
- `node --test tests/staging-guard.test.mjs`: PASS, 7 tests; no deployment performed.
- `pnpm test:rules`: PASS, 50 tests in the local Firestore emulator for `demo-filmovy-kviz-v2`. The first attempt could not find Java on PATH; rerunning with the already installed JDK 21 and Node 22 succeeded. The emulator shut down after the run.
- Runtime for check/unit: Node `24.19.0`, pnpm `11.25.0`. Rules used Node `22.23.2`, JDK `21.0.12.1`, pnpm `11.25.0`. The repository requests Node 22 / pnpm `11.19.0`; this local evidence is not a substitute for the pinned CI environment.
- Candidate tracked files remained clean after the checks. No browser/callable end-to-end, Storage emulator, full real-data migration or venue acceptance run was performed in this kickoff.
- Coordination documentation: `git diff --check` and documentation-index link existence checks PASS; an independent worker reviewed the restart record for factual consistency.
- Read-only audits are bounded inspection evidence, not a security certification.

Before release, require `pnpm check`, unit tests, staging guard checks, Firestore Rules tests, relevant callable/browser tests and Storage emulator coverage for media on the same candidate. Set browser targets explicitly to loopback; use synthetic fixtures and `demo-*` projects. Significant release or persisted-model changes also require the applicable migration gate from `DEVELOPMENT_WORKFLOW.md`.

The initial audit did not inspect production or establish current staging state. Scheduled continuation was subsequently enabled at the owner's request as recorded above; no deployment has been authorized or performed.

## Historical integration checkpoint — 2026-10-12, 13:42 Europe/Prague

Fresh Git inspection found no newer accepted base. The original `8106c4a` worktree and other worktrees remain preserved. The lead integrated locally and assigned three bounded workers as GPT-6.1 Sol HIGH (access, event lifecycle) and MEDIUM (editor). All cloud actions remain outside the current authority.

| Commit | Owner/reviewer | Change and evidence |
| --- | --- | --- |
| `415a8c9` | Lead | Local merge of the existing stacked candidate into the coordination branch. |
| `40b6352` | Access worker / lead | Direct snapshot Rules now require the event's current assignment. New Rules regression denies replaced snapshot roots/children/lists and malformed assignments. |
| `00148f1` | Event worker / access worker + lead | Invitation acceptance checks the issuer's current Auth state on each transaction attempt. Disabled/deleted/unverified issuer regressions pass without membership or invitation writes. Auth and Firestore are not one atomic service. |
| `7058637` | Editor worker / lead | Confirmed conflict reload locks editing/save/selection until the authoritative read completes. Delayed-read browser regression passes. |
| `3f703ad` | Lead | Capacity documentation reconciliation. Application code is unchanged by later test/documentation commits at this checkpoint. |
| `476778f` | Access worker / lead | Migration test uses a private per-run synthetic fixture directory; it no longer collides with an existing `.local-data/v1-export/library.json`. Existing export was neither read nor changed. Runtime verification pending. |
| `adf1b77` | Event/editor workers / access worker + lead | Unified 70-function inventory, offline contract and release/rollback plan. Five inventory checks pass on pinned Node 22. Current deployed inventory and artifact discovery are not established. |

On the integrated application code represented by `3f703ad`, Node `22.23.2`, pnpm `11.19.0`, JDK `21.0.12.1`:

- `pnpm check` PASS (typecheck, lint, production demo build); 445 unit tests PASS; 50 Firestore Rules tests PASS; 10 extended access Firestore/Storage tests PASS. These ran before committing the same source changes; later commits above changed only tests/docs/inventory.
- Full personal-access callable suite PASS including the three new issuer cases; personal-access browser 2 PASS; editor save-all browser 6 PASS; event-management browser 2 PASS; media/session revocation contracts 3 PASS. The full emulator chain exited 0 and shut down.
- Staging guards 7 PASS and unified release inventory 5 PASS on Node 22.
- Wider browser checks so far: empty editor 1 PASS, seeded editor 2 PASS, outline 3 PASS; live callable suite PASS; quiz editor callable suite PASS. Remaining groups are in progress.
- Demo-only receipts/logs for the wider run are under ignored `.local-data/restart-verification/`. Initial failures were a sandbox Vite `realpath` restriction and a runner combining mutation-heavy browser/callable fixtures without a fresh emulator. The corrected isolated run passed those gates. The event contract additionally needs its old superseded-snapshot read expectation updated to assert denial while preserving immutability checks.

Independent review found no additional concrete bypass in the bounded event-deletion/media/print/live inspection. This is review evidence, not a certification. A new UI-only end-to-end authored event test is being added because the existing final/history suites use separately prepared fixtures.

Release scope and approval prerequisites: [RESTART_RELEASE_PLAN.md](RESTART_RELEASE_PLAN.md), [unified manifest](../tools/staging/restart-release-manifest.json). `AGENTS.md` literally requires `admin/moderator`, whereas the inherited candidate uses membership/permission/scope roles. The authentication-is-not-authorization invariant holds; literal policy alignment still requires the owner's decision before release. `AGENTS.md` has not been changed.

At that checkpoint the next step was to finish migration and browser groups, review the authored event journey and record the final candidate. That local work is now complete as recorded below.

## Completed local phase — 2026-10-12, 14:13 Europe/Prague

Frozen code/test candidate: **`8b6245608850c9cad959fb14ab6a754f485e1dad`** on `codex/restart-integration`. The documentation-only commit after it records results and reconciles stale role/email/seed descriptions. Git comparison confirms no application/runtime changes after `3f703ad` and no code/test/tool/CI changes during the final run. Existing worktrees and unrelated local artifacts were preserved; no remote push, merge, cloud access, production data or real email action occurred.

| Later commit / owner | Completed work |
| --- | --- |
| `9cb20c3` / access worker + lead | Updated the obsolete event test to deny replaced snapshot reads while independently preserving old snapshot immutability; event contract PASS. |
| `cdb147d` / editor worker + lead | Added and independently reviewed one real UI-authored quiz/event journey through immutable snapshot, registrations, scoring, explicit answer/final reveal and historical reload; included in CI. |
| `8b62456` / editor worker + lead | Fixed a scoring test navigation race and allowed the isolated form config to use the verified local Chromium executable. Both exact-SHA suites pass without weaker assertions or longer timeouts. |
| Documentation / access and event workers, LOW evidence worker + lead | Reconciled current scoped access and cloud-disabled email descriptions, indexed current contracts, and recorded actual SHAs, logs, failures, recovery and limitations. |

Final exact-SHA gates passed with Node `22.23.2`, pnpm `11.19.0`, JDK `21.0.12.1`: `pnpm check`; 445 unit tests; 50 standard Rules and 10 extended access/Storage Rules tests; 12 offline guard/inventory checks; authored event 1; scoring browser 1; isolated event form 6. The orchestration and all seven gates exited 0. The existing approximately 981 kB bundle warning remains. Full commands, receipt paths, prior broader gates and their actual commit states are in [RESTART_VALIDATION.md](RESTART_VALIDATION.md).

Broader local coverage passed for personal access/issuer revocation, save-all/conflict/reload, editor/outline/drafts/performance/dark mode, lifecycle/deletion, registrations, print, referee access, interim/final/history, media and fake email. Seven synthetic migration contracts passed; existing exports were not used. Initial runner fixture collisions, superseded snapshot test expectations and the scoring harness race were resolved. The first isolated form navigation timeout has no proven root cause; the two subsequent full six-case runs passed with the explicit browser configuration.

The local completion condition is satisfied. Outstanding items are external: current cloud inventory/IAM/bucket/Auth, actual staging build artifacts and online smoke, remote GitHub CI/review, owner policy alignment, real-data migration approval, and venue/projector/audio acceptance. They are not represented as passed. The prepared [release plan](RESTART_RELEASE_PLAN.md) names the unified 70-function scope, excluded email paths, artifact prerequisites, deployment sequence, smoke checks and compatible rollback.

### Historical approval boundary after local completion

1. **Owner policy decision:** approve updating the literal `admin/moderator` wording in `AGENTS.md` to require active server-managed membership, concrete permission and resource scope; legacy claims alone remain insufficient. The inherited candidate already implements this model, but the instruction itself has not been changed.
2. **Owner authorization for read-only V2 staging preflight:** exact proposed target `filmovy-kviz-v2-staging`, region `europe-west1`; inspect current release/function inventory, security configuration, bucket/IAM and Auth/membership readiness. No production project, credential copying, content export, writes, new accounts or email. The current heartbeat authorizes demo emulators only.
3. **Lead after authorization:** establish current cloud prerequisites and remote CI access, prepare/verify a unified artifact builder without bypassing the historical branch guards, then present exact checksums and requested writes for a separate deployment approval. Do not deploy from this heartbeat or infer approval from a prior release receipt.

The app tool confirmed heartbeat `samostatn-dokon-en-justkv-z` as **PAUSED** after local completion on 2026-10-12. Its existing prompt and 30-minute schedule were preserved. It will not keep retrying unavailable access or expand product scope; the next phase requires the two specific owner decisions above.

## Approved preflight continuation — 2026-10-12

The owner's reply **„dávám schválení ke všemu.“** approved both specific requests immediately above: alignment of `AGENTS.md` with active membership/permissions/resource scope, and read-only preflight of `filmovy-kviz-v2-staging`. The lead applied the single policy correction and performed only the approved metadata/security reads. This resolves the role wording mismatch. It does not authorize a newly discovered cloud write, IAM/identity change, email or deployment.

The existing candidate/worktrees were reused. GPT-6.1 Sol MEDIUM prepared the offline unified builder; HIGH independently reviewed it and the cloud boundaries; LOW recorded evidence. Independent review caught and resolved a stale ignored domain build risk: both frontend and backend now bind to freshly compiled domain output from the exact candidate. Node 22 passed all 18 staging/inventory/builder tests and `pnpm check`. No application/runtime source changed from `8b62456`, so its completed unit/Rules/browser results remain attributed to that tested source rather than being unnecessarily rerun.

The cloud preflight found 71 active functions (the exact 70-function inventory plus `health`), no excluded email endpoint, the required bucket/permissions/service agent and both ready indexes. Runtime configuration matches the V2 project/bucket without emulator variables. Storage Rules match the candidate; Firestore Rules still match `8106c4a` and lack the reviewed snapshot-revocation fix. Existing collaboration is **enabled**, revision **18**, with an active verified owner and moderator. No owner creation, permission expansion or blanket infrastructure repair is needed. See [RESTART_PREFLIGHT.md](RESTART_PREFLIGHT.md) for exact evidence, limitations and remaining checks.

GitHub remains a separate blocker: both connector and CLI repository API calls return 404; the CLI is authenticated as the repository owner and Git remote HEAD is readable at `0d452d8`. No remote CI result has been established. Do not infer API/PR/CI access from Git transport success or replace the existing credentials with another source.

### Prepared release and external boundary — 2026-10-12, 14:53 Europe/Prague

The lead committed the unified offline builder as `a08771c`, then the corrected current-banner guard and narrowed deployment recipe as **`aafeaa969c5fae018e060b23e8e52491a022a30d`**. MEDIUM implemented the builder/guard, HIGH independently checked packaging and deployment boundaries, LOW prepared the concrete release/QA/rollback runbook, and the lead integrated and executed verification. The failed first artifact remains preserved without a receipt.

The clean `aafeaa9` build and subsequent packaged runtime verification passed on Node `22.23.2`: 118 immutable deployment files, exactly 70 Gen 2 HTTP/callable exports in `europe-west1`, no declared params/secrets/email workers, all four parsed Noto fonts, zero attempts through the blocked common network APIs, and matching hashes before/after import. All 19 guard/inventory/builder tests passed on that exact SHA. Installation of 260 locked packages used isolated npm config with scripts disabled; local link creation required normal Windows filesystem escalation. Independent final review found no packaging blocker and recorded the instrumentation limit. The application and Rules source are unchanged from tested `8b62456`. Exact artifact path, receipt/report checksums, logs and limitations are in [RESTART_PREFLIGHT.md](RESTART_PREFLIGHT.md).

**Next required external action:** restore repository API/CI access for `krenekdavidmladonov-debug/filmovy-kviz-v2`; GitHub currently returns 404 for the authenticated expected owner. Then arrange and verify CI for the frozen `aafeaa9` source, followed by explicit approval of the concrete release proposal: audited invitation pause, the 70 existing Functions, corrected Firestore Rules and Hosting. Storage Rules/indexes already match and are comparison-only. Online synthetic QA/cleanup is a separate scoped proposal. No IAM, account, membership, email, production, cloud write, push or deployment occurred in this continuation.

Heartbeat `samostatn-dokon-en-justkv-z` remains **PAUSED**, confirmed in saved app configuration. There is no active worker assignment or useful authorized local release work left; do not repeat unavailable-access checks or rerun passed suites without a new reason. The frozen artifact SHA remains `aafeaa9` even when a later documentation-only commit records these results.
