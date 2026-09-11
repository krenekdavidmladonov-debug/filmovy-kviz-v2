# One-time staging editor hotfix

This branch is based on the deployed frontend, not current main. Review against
`reference/staging-editor-core-base` only. Never merge this branch into main to
replace newer development. Main and PR #26 remain independent and unchanged.

## Provenance

- Frontend: `edc659ec0137e626c4b7dba63d4eab7211d66cfa`.
- Hosting release `1788981978655000`, version `9d3b3fcd4c7eb916`.
- Existing deployment record: staging-final-fanfare-fix worktree,
  `.local-data/staging-final-fanfare/deploy.json`. Its deployment script asserts
  exact clean Git HEAD before building and records the resulting Hosting release.
  Read-only Hosting API verification on 2026-09-11 confirms this is still latest.
  All 29 files retained in that deployment's local dist (including index and its
  bundles) also match the currently served staging HTTPS bytes; SHA-256 results
  are retained in the local `editor-hotfix-evidence/hosting-artifacts.json` report.
- `updateQuizSlide`: ACTIVE, Functions hash
  `8e5c1eefed4658cf6f76d67abf69279008f84cc4` (not a Git SHA), source generation
  `1788779594382062`, Cloud Build `32a204d6-f1a0-4f00-9b00-ed845a58d618` SUCCESS.
- Its exact source ZIP was downloaded read-only. All 18 editor JS/map/declaration
  artifacts match compilation of the frontend baseline byte-for-byte. All six
  then-existing domain JS files match too. Thirteen deployed editor callables
  have identical source ZIP MD5s. Normalized executable JS SHA-256s are checked
  into `tools/staging/editor-baseline-hashes.json` and asserted by compatibility tests.
- Existing editor contracts: admin claim; revision-checked existing-quiz writes;
  strict identifier, slide and structural validation; transactional counters and
  private derived records; ID/revision/counter-only responses. Retained operations:
  updateQuizMetadata, createQuizSlide, duplicateQuizSlide, deleteQuizSlide,
  moveQuizSlide, updateQuizRound, duplicateQuizRound, moveQuizRound, removeQuizRound,
  reorderQuizQuestion, moveQuizQuestionToRound, repairQuizPreflightIssue.
- createQuiz is not deployed. Other backend components have different source
  hashes; this branch does not claim one Git origin for all staging Functions.

## Transfer and adaptations

Source: PR #26, commit `c92a8b5211b11ce438498fb934a2ddff04c186bb`.
Only its editor diff was applied, not its newer main ancestry. The transfer covers
sentinel mapping/preservation, save validation distinct from strict preflight,
revision-conflict messaging, admin-only idempotent creation, empty/full library
CTA, empty editor preview, synthetic fixtures and regression tests.

Two QuizEditorPage hunks needed adaptation because staging has no media upload
state. The existing staging form and its save guard are retained. Documentation
contexts referring to newer cloud imports/media grants were excluded. No new
media or email files, Rules, indexes, dependencies or lockfile changes are included.
CI additionally checks out the actual PR head and runs for this release branch and
the immutable reference base; existing quality gates remain intact.

## Compatibility and review

`editor-compatibility.mjs` builds the exact old web/domain source with demo config,
and loads verified old editor implementations for every callable except the two
candidate exports. A browser test proves old-client normal save/reload still works
and records the original sentinel save blocker as expected, not a fixed old client.
The candidate browser/emulator suites cover the new flow against those actual old
contracts, repeated create requests, non-admin denial, data/snapshot preservation,
strict invalid timing/preflight, and concurrent editors retaining drafts.
Browser requests explicitly reject every prohibited email/media callable. Direct
library, creation, detail, editor, readiness and repair routes are covered.

Review conclusions: no change to role authorization, revision checks, transaction
ownership, direct-write Rules, snapshot/publication paths, or other staging UI.
The two deployment exports import only the editor module, Node crypto, Firebase
Admin and Functions SDKs. Module initialization only initializes Admin/Firestore;
there is no email worker, task queue, Storage client, media gateway or secret load.
No additional cloud dependency is needed. New-root idempotency is actor-bound and
transactional; responses contain no answers. Preflight retains missing-timing blockers.

## Build and later rollout — DO NOT RUN DEPLOY NOW

Build with Node 22, a clean committed release HEAD and validated V2 staging web
configuration using `node tools/staging/build-editor-hotfix.mjs`. This only builds.
The output under `.local-data/editor-hotfix-release/<release SHA>/` contains the
Hosting build, a Functions package with exactly two exports, a hook-free Firebase
configuration, and a build-time source/configuration/SHA-256 manifest. Install its
backend dependencies using its unchanged staging package-lock (`npm ci --omit=dev
--ignore-scripts --no-audit --no-fund`) and verify module loading before rollout.

After separate explicit approval, first reverify the current Hosting release and
updateQuizSlide source generation against this record; abort on any drift. Check
the exact candidate SHA and artifact checksums, emulator and CI results. Let
`<config>` denote the absolute generated `firebase.editor-hotfix.json` path.
Run individually, never via DEPLOY_STAGING.cmd or tools/staging/deploy.mjs:

```text
firebase deploy --project filmovy-kviz-v2-staging --config <config> --only functions:updateQuizSlide,functions:createQuiz --non-interactive
firebase deploy --project filmovy-kviz-v2-staging --config <config> --only hosting:filmovy-kviz-v2-staging --non-interactive
```

The generated config contains only the exact two-export Functions source and
Hosting site `filmovy-kviz-v2-staging`; no Rules/indexes/Storage and no predeploy or
postdeploy hooks. Package scripts are removed from the generated backend package.
The repository's broad deployment wrapper is forbidden for this rollout.

Hosting recovery is independent: restore finalized version `9d3b3fcd4c7eb916` on
that exact site, then verify the resulting release and HTTPS assets. This requires
separate approval and a Hosting release referencing that existing version; it does
not restore Functions or reverse data created after rollout.

Functions recovery: retain the downloaded exact generation ZIP from
`gs://gcf-v2-sources-177615774316-europe-west1/updateQuizSlide/function-source.zip#1788779594382062`
and its checksum before approval. Restore only updateQuizSlide from that package
using a hook-free Functions-only config and explicit project/selector. createQuiz
has no previous version; disabling/deleting that new endpoint requires an explicit
rollback decision and approval. Do not delete any created quiz data. The previous
updateQuizSlide source exists and was verified, but recovery is not executed here.

All workflow validation in this preparation is LOCAL/EMULATOR/CI, never ONLINE PASS.
Final release SHA, actual test/CI results and artifact paths belong in the final
release report and generated manifest, not a self-referential committed SHA.
