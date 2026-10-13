# Successor publication and CI scope

Prepared from inspection base `e418eab0b774027e866f4989c9929c0cb787aa9e` on `codex/activation-execution-readiness`, compared with the previously published PR head `ddb862f946a7621e4ff9dbfb30f8976ad8d0e3ac`. Local ancestry inspection confirms the old head is an ancestor of this base. This document is a publication proposal, not a push, CI result, merge or deployment receipt. Freeze the final committed candidate after integrating the current bounded work; use its complete SHA in the publication commands and evidence below.

## Existing PR and normal fast-forward

Preserve [draft PR #39](https://github.com/krenekdavidmladonov-debug/filmovy-kviz-v2/pull/39), its head branch `codex/restart-release-aafeaa9`, and base `main`. The lead's fresh reads on 2026-10-13 confirmed OPEN/DRAFT, remote head `ddb862f946a7621e4ff9dbfb30f8976ad8d0e3ac`, base `0d452d8efe4cce9eb003fcce713d3b63c15bb0a4`, and the same head/base repository `krenekdavidmladonov-debug/filmovy-kviz-v2`. Normal read-only CLI cache access resolved the sandbox's misleading 401; no credential replacement is required. Do not update a different PR or create a duplicate.

Before an authorized publication, verify a clean committed source, the final full SHA, current PR OPEN/DRAFT state, head/base repository and branch identity, fresh remote head/base SHAs, and that the fresh remote head is an ancestor of the candidate. Stop on unexpected changes and reconcile them; do not force push. The intended single-ref push is:

```text
git push origin FINAL_FULL_40_HEX_SHA:refs/heads/codex/restart-release-aafeaa9
```

Use a regular push with no force option and no additional refs. Afterwards read back PR #39's exact head SHA and base, update only its title/body with the reviewed text below, retain draft state, and collect the newly triggered runs. A push to this head branch does not match either workflow's push branch filter; synchronization of this existing PR targeting `main` triggers CI through `pull_request`.

## Workflow triggers and security boundary

Only two workflow files exist at this inspection:

| Workflow | Relevant triggers | Execution scope |
| --- | --- | --- |
| `ci.yml` | `push` to `main`; `pull_request` to the listed base branches, including `main`, with no path filter | Ubuntu quality gate and bounded five-minute Windows email tool job. Draft PRs are not excluded. |
| `owner-takeover.yml` | `push` to `codex/owner-takeover` or `main` with matching paths; `pull_request` with paths under `tools/access/**`, `tools/staging/**`, owner-takeover tests, or that workflow | Ubuntu operator-security checks. The successor diff includes matching tools/access and tools/staging paths. |

Both workflows grant only `contents: read`, use pinned action commit SHAs, and declare no GitHub secret inputs, cloud credentials, `pull_request_target`, deployment, publication, mail delivery or infrastructure provisioning step. Firebase executions are explicitly local emulator commands using `demo-*` IDs and synthetic fixtures; browser email tests use fake transport. Dependency downloads are ordinary CI setup, not a cloud mutation. The source contains separately approved operator tools; adding their synthetic tests must not invoke their real apply/deploy entry points. No merge is part of this publication proposal.

## Coverage review and concrete CI gap

Existing CI covers the changed email runtime through `pnpm check`, `tests/emailActivation.test.ts` in `pnpm test:unit`, registration/email/Gmail emulator contracts, and the new activation transaction emulator. The Save-all browser invocation now covers the failed authoritative reload regression. Owned-media emulator coverage imports and runs the exact Storage read-budget adapter, including the allowed own-scope upload regression; it is not an uninvoked standalone script.

OAuth and offline five-target packaging suites run on both Ubuntu and Windows under Node 22. Windows exercises actual CurrentUser DPAPI/ACL and the actual no-import child environment regression; Ubuntu results cannot certify Windows behavior.

At the inspection base, five new synthetic Node suites were absent from both workflow commands and Vitest's explicit include list. The reviewed successor CI delta now adds all five to the existing Ubuntu guard invocation:

```text
tests/restart-deploy-guard.test.mjs
tests/restart-qa.test.mjs
tests/access/pause-collaboration.test.mjs
tools/email/activation-plan.test.mjs
tools/event-night/restart-acceptance.test.mjs
```

They reuse the installed pinned Firebase CLI and require no new job, dependency setup or cloud inputs. One targeted Node 22.23.2 run passed all **70 tests with no skips**. Its complete log is `.local-data/successor-publication-qa-969dc373-f0b1-48da-a117-0592029cc60a/targeted-tests.log`. The first sandbox run retained 68 PASS / two junction-creation EPERM failures in `.local-data/successor-publication-qa-398488f4-da22-44b3-b2df-b14f5ebfdcc8`; normal local filesystem permission resolved those fixture failures, without changing tests. YAML/structure and targeted diff checks accompany the final workflow. This is local evidence, not a remote run.

The targeted log SHA256 is `565e071fa4e4e572380e5196fc6e8bb2c6fa84b8a50e6b65c30ac9a1572c122f`; `verification.json` in the passing QA directory is `837ce3a61881081583d40e51937bc33f498245348cc8a97fbe91e602afd80704`. That receipt binds the five suite files, their primary operator sources, frozen release manifest, workflow, Node version and complete passing log. The publication document is not part of those tested-code bindings.

The actual `tests/access/pause-collaboration-emulator.mjs` transaction proof additionally requires its exact dedicated `demo-pause-collaboration` Firestore emulator; it is not covered by the offline adapter test or owner-takeover emulator. Its retained local evidence remains attributable to the tested source; no new CAS emulator job is added by this correction. Full event-night process restart acceptance and compiled email SDK discovery are retained local evidence, not current remote workflow gates.

## Proposed PR title

JustKvíz V2: secure quiz operations and bounded staging email preparation

## Proposed PR body

This replacement application provides scoped administration, quiz authoring, event registration, scoring, protected projector/media and private print workflows. Administrative authority comes from current active membership, concrete permissions and resource scope; public/projector clients receive only the intended public projections and explicitly revealed answers.

The successor fixes own-scope media uploads to remain within Storage's two-document cross-service budget and preserves registration management retries for receipts created before email activation. Optional staging registration email remains default-off. Its opt-in boundary restricts new intents and delivery to a canonical activation cutoff and one selected recipient, excludes organizational messages, and requires private worker invocation. Existing registration management continues without email for ineligible recipients.

Operator preparation adds bounded deployment/QA guards, audited collaboration pause, synthetic restart acceptance, protected send-only OAuth setup with fixed-value diagnostics, and a separate immutable five-Function activation package. The package binds clean source and locked compiler/dependencies, excludes deployment configuration and secret values, and isolates compiler children from inherited credentials and Windows bootstrap values. CI adds Save-all reload, activation transaction and cross-platform operator-tool contracts.

Validation is source-bound rather than a blanket final-SHA rerun claim: the registration activation record covers 82 targeted unit tests, 50 demo Firestore Rules tests and 23 email emulator groups; the Save-all browser suite passed seven cases; the final compiler bootstrap correction passed 14 package tests without skips and actual clean-source compilation. The corrected 44-file activation artifact from `f19c54dab8afaaf88a4d2b5a44d066174fe8165e` passed off/on SDK metadata discovery for exactly five endpoints, matching hashes and zero handler invocations. The newly added five operator guard suites passed 70 targeted Node 22 tests without skips. [Email follow-up validation](docs/EMAIL_FOLLOWUP_VALIDATION.md), [activation validation](docs/EMAIL_ACTIVATION_VALIDATION.md), [functional acceptance](docs/FINAL_FUNCTIONAL_ACCEPTANCE.md), and [Storage budget record](docs/STAGING_STORAGE_READ_BUDGET.md) retain commands, bindings and limitations. New remote CI must be verified against this PR's published head and actual checked-out merge tree; earlier green runs do not certify the successor.

This remains a draft for review. No usable Gmail grant, secret/API/queue/private-IAM provisioning, email activation deployment, real send, migration/production cutover, physical venue acceptance or public-launch decision is established by this PR. Historical staging execution is separately recorded; publication does not authorize new cloud changes. The OAuth callback browser blocker and scoped activation/containment inputs remain external dependencies.

## Evidence to collect after publication

Record the final source SHA/tree, remote PR head/base readback, fresh run IDs/URLs, complete job and step outcomes, actual checkout SHA, and checkout parents/tree. For a PR merge checkout, prove its parents bind the fresh base and published head; compare its tree with the reviewed candidate or inspect any base-induced difference. Bind raw logs and metadata with hashes in a new immutable receipt. Require success of each intended gate; skipped, cancelled and failed steps are not PASS. The lead's fresh reads confirm old runs 38293925253 and 38293926292 remain SUCCESS from 2026-10-12; they certify historical ddb862f scope only. Add any new evidence only at its exact tested source.
