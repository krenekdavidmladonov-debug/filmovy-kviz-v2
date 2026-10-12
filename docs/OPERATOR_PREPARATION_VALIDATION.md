# Restart operator preparation — 2026-10-12

The application remains frozen at `ddb862f946a7621e4ff9dbfb30f8976ad8d0e3ac`. These local operator tools are isolated on `codex/restart-rollout-preparation`; they were not pushed into PR #39 or included in its application artifact/CI.

| Local commit | Scope and review |
| --- | --- |
| `4e6ba67` | Lead-authored audited collaboration pause; MEDIUM independent review and re-review. Fixed missing concrete operator attribution and implicit transport retry. |
| `3e5d9ee230a289789e0785dec83dfd40bf14a981` | HIGH-authored update-only 70-Function deployment guard; MEDIUM independent review and lead integration. Real pinned CLI API compatibility checked; optional Legacy Runtime Config read disabled through its supported local configuration branch, with direct/transport legacy reads still denied. |

Verification completed before the commits, with unchanged source-file hashes and Git diff binding the results to those commits:

- 23 targeted Node tests PASS: 12 pause/core/adapter and 11 deployment guard/envelope/planner/request-policy cases.
- Dedicated `demo-pause-collaboration` Firestore emulator PASS: actual atomic updateTime CAS, create-only audit collision rollback, unrelated-field preservation, dry-run/replay, lost response reconciliation and identical audit/control updateTime.
- `pnpm check` PASS: typecheck, lint and demo production build; existing main-bundle size warning remains.
- `pnpm test:rules` PASS: 50 tests on the local demo emulator.

Receipt `.local-data/completion-hardening/operator-tools-validation.json`, SHA-256 **`1cda4615da8fef85b67984da975f1f6ff4bc154137a8e1240f3e76df7721cd33`**, records nine source-file hashes, complete log hashes and exact commits. Logs are `operator-tools-tests.log`, `operator-tools-check.log`, `operator-tools-rules.log`, `pause-emulator-final.log` in the same directory. Node 22.23.2, pnpm 11.19.0, JDK 21.0.12.1; Firebase CLI 15.28.2.

The deployment tests exercise real pinned CLI policy/planner/configuration code with synthetic transport sinks. No deployment, actual cloud mutation or cloud handler invocation was executed. The guard checks reviewed evidence; neither an input JSON nor the tests independently prove human approval or current cloud behavior. Rules and Hosting have separately scoped CLI phases, not the same Functions request allowlist. Commands, approval inputs and stop/recovery conditions are in [STAGING_ROLLOUT_DDB862F.md](STAGING_ROLLOUT_DDB862F.md).

## Fresh read-only staging evidence

The previously approved metadata inspection was repeated in a new ignored directory, preserving all historical evidence:

`.local-data/restart-rollout/20261012T190832342Z-b8521bcc00cb4c5498205bd1bcbfc380/.local-data/restart-preflight-20261012/`

`verified-summary.json` SHA-256 **`27be368e2e94d57e4515302b2108c37158a23328d9de24b5fc92acc20f9b88cb`**; LOW independently checked its five source hashes and summarized fields. It confirms exactly 71 ACTIVE Gen 2 Node 22 endpoints in europe-west1 (70 intended plus health), no Gen 1 there, matching staging runtime project/bucket/service identity, two matching READY indexes and unchanged Storage Rules. Firestore Rules still match historical `8106c4a`, missing the candidate's superseded-snapshot fix. Collaboration remains true at revision 18, updateTime `2026-09-16T06:11:29.023025Z`.

Separate read-only `additional-api-states.json` at `2026-10-12T19:15:05.196Z` confirms Runtime Config, Pub/Sub and Eventarc APIs already ENABLED. No service was enabled or configured. Runtime Config values were not read.

The original scripts contain three known rejected projections (two index queries and one Function map-field query); successful subsequent index and runtime responses supply corrected evidence. The receipt records those failures instead of hiding them. Hosting covers only its latest release, and endpoint inventory covers europe-west1. A runtime environment value is checked in memory after retrieval; the whitelist does not guarantee filtering a concurrent change before transfer. No quiz/contact/registration data or Storage objects were enumerated.

This evidence is **before pause** and deliberately cannot satisfy the deployment guard's required post-pause control state. A future approved operation needs fresh state, the actual atomic pause receipt, identical control updateTime, and a freshly reviewed deployment envelope. The next approval must name the frozen artifact, staging target, pause and exact Functions → Firestore Rules → Hosting scope. Identity provisioning, QA data and cleanup remain a separately prepared [acceptance scope](STAGING_ACCEPTANCE_DDB862F.md).
