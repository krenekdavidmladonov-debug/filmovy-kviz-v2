# Personal access release review

Status: implementation candidate. Independent security review, exact-head CI and online deployment verification are separate required gates. This document is a review map, not a completed independent review.

## Verified starting point

- Repository base: `17526c0fa5c9fdaabeb167a546282f78fb0208e4`, `codex/justkviz-dark-mode`, Draft PR #30.
- Read-only staging inspection: `filmovy-kviz-v2-staging`, Hosting version `0a4452bdbdc5d779`, release `1789463256564000`. Its 32 deployed file hashes matched the referenced dark-mode build.
- Actual Functions inventory: 59. This module requires 54 existing updates and 9 new Functions; every name is enumerated in `tools/access/deployment-manifest.json`.
- Original content fingerprint: 1,892 documents, aggregate SHA-256 `da97c937f70036426c4794a06dffaf91b4cd579b79a25f0189eb7a660658bd32`; original Storage inventory contained zero objects.
- Auth inventory contained three synthetic staging identities, no identified personal owner. Email/password already enabled. Displayed nick is `displayName`.
- No original content, Auth identity, claim, provider, domain, IAM role or cloud service was changed during implementation.

Repeat the target/inventory/fingerprint checks immediately before any release; these observations are not a deployment receipt.

## Independent review coverage

| Surface | Implementation / evidence | Required review |
| --- | --- | --- |
| Permission and scope model | `packages/quiz-domain/src/access.ts`, `tests/accessPermissions.test.ts` | Role label is not authority; explicit dependencies; empty selection denies; scope-preserving presets; bounded delegation |
| Legacy staff callables | `functions/src/access/authorization.ts`; editor, events, live, scoring, registrations, referee, interim/final and disabled email modules | Every exported staff path has a policy; resource resolved server-side; current membership checked in each transaction retry; no legacy claim bypass |
| Invitations and owners | `functions/src/access/callables.ts`, `tools/access/owner-handoff.mjs` | Verified email binding, hash only, one use/reissue/expiry, current issuer, ownership recheck, self/peer management limits, last-owner concurrency, operator-only exact identity bootstrap |
| Private reads and editor saves | `functions/src/access/reads.ts`, `editor-fields.ts`, `tests/access/emulator.mjs` | No out-of-scope download or nested raw data; separate answers/notes/contacts; exact hidden-field preservation; delete/repair/media alias bypasses |
| Firestore / Storage | Root Rules, `tests/firestore.rules.test.ts`, `tests/access/rules.test.ts` | Direct query/URL denial, no client membership writes, public boundaries, stale grant/version/cutoff checks |
| Media / print / snapshot / projector | `functions/src/access/media.ts`, media and print endpoints, `tests/access/media-sessions.mjs` | Revoked Auth plus current membership, scope before/after IO, private answer bytes, event snapshot isolation, export permissions, explicit public reveal only |
| Browser identities and caches | `AuthProvider.tsx`, access API, account/users routes, `tests/browser/personal-access.spec.mjs` | Five isolated contexts, invitation without issuer signout, signup/verification, same UID after credential changes, actual referee score, redacted viewer, immediate editor removal, no cross-account drafts |
| Legacy behavior | Existing CI emulator/browser stages | Complete editor, media, draft restrictions, anonymous registration/projector, bounded referee links, scoring and print remain functional; rate limits unchanged |
| Staging release | Deployment manifest, additive membership plan, `docs/PERSONAL_ACCESS.md` | Full inventory/source/Rules/index agreement before activation; preserve original access/content; own QA cleanup while retaining security audit; safe forward recovery |

The original four public registration callables and health handler have no behavior change. The six absent email Functions remain absent; team emails stay disabled. Source-level authorization for the four team-message APIs is still updated and tested so future activation cannot restore a legacy bypass.

## Evidence handling

Local emulator/browser output and synthetic screenshots are ignored under `.local-data/users-access/`. Passwords and invitation tokens are generated only for isolated `.test` fixtures and are not included in reports, screenshots, traces or commits. Firebase emulator verification links remain in ignored emulator output; redact OOB codes before displaying log excerpts. CI runs the same local-only fixtures, with browser tracing/video/password screenshots disabled.

Attach the exact final commit SHA, successful CI run URL and independent reviewer findings to the Draft PR. Record LOCAL, CI and ONLINE separately. Online evidence must identify deployed Function source/builds, Rules releases, index readiness and frontend hashes, then demonstrate permitted and denied requests with isolated QA identities. Remove only owned QA content/accounts/uploads; retain access audit entries and preserve original limiters.

The actual personal owner step remains **ČEKÁ NA NASTAVENÍ OSOBNÍHO ÚČTU** until an exact verified UID/email is explicitly approved. A successful synthetic owner test cannot fulfill that step.
