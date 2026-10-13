# Retained staging QA execution — 2026-10-13

Application: **`ddb862f946a7621e4ff9dbfb30f8976ad8d0e3ac`**. Separate Storage fix: **`5fe7d9ba2f4f17dd1c8e727896ea7faa92b713fe`**. Project: `filmovy-kviz-v2-staging`. Evidence root: `.local-data/restart-qa/staging-qa-ddb862f-20261012-01` (ignored, protected, retained). This record supplements the [approved QA scope](STAGING_ACCEPTANCE_DDB862F.md) and [application rollout](STAGING_EXECUTION_DDB862F.md).

The lead alone executed cloud/browser actions. Existing GPT-6.1 Sol HIGH prepared bounded continuation tooling, MEDIUM independently reviewed it, LOW checked receipts and maintained the completion matrix. No worker had cloud authority. Existing worktrees and original failed-attempt receipts remain intact.

## Completed evidence

| Scope | Actual observation |
| --- | --- |
| Storage correction | Exactly one ruleset POST and one release PATCH. Ruleset `005b3fcb-4545-4869-894f-f6e277d871ac`; release updateTime `2026-10-12T23:55:11.689821Z`; source SHA-256 `fbc1eb76b53cf915ed1ef36ce45daeb75a184d5e4dee97d9b342deefaef4e89b`. Functions, Hosting, Firestore Rules, captured IAM/bucket/API/control metadata unchanged. [Deployment, tests and rollback](STAGING_STORAGE_READ_BUDGET.md). |
| Authoring and rehearsal | Full reviewed continuation PASS at source revision 6: saved/reopened text, image and audio questions; upload/finalize 200; protected image and actual audio playback; manual agenda preserved; focus trap, Escape/remount, fullscreen. Lead visually checked desktop 1366 and narrow 390 screenshots. |
| Viewer and snapshot | Viewer none/selected checks PASS: filtered answers/notes/contacts, denied mutations, raw private Firestore and direct Storage; current protected image read succeeds. Only second relock reached source revision 7, snapshot `aehIdVCqSQ5YA4mItwyR`. Old snapshot slides/rounds denied 403, old-context image 404 empty, current image 200 exact bytes. |
| Registration | Two public UI teams; exact create replay; update/reissue revision contract, stale ABORTED, old-token get/update/cancel NOT_FOUND, no-op/replay stable. Both accepted at revision 2. Two sequential orderings tested, not a simultaneous-race claim. |
| Scoring | Two-window stale conflict preserves draft; explicit stale request ABORTED; correction succeeds. Team A 3 points, revision 2/history 2; B 1 point, revision 1/history 1. B's server-committed response was deliberately dropped; retry used the same captured request and did not duplicate revision/history. |
| Live answer boundary | Single session only. Original reveal committed despite a short browser timeout. Read-only authoritative private/public state and projector DOM confirmed revision 7 and exactly one answer; no reveal replay. Subsequent return removed the answer from fresh public DTO and DOM, revisions 8/9. |

Final table and end PASS at `2026-10-13T00:32:32.463Z`: the sole session ended at revision **14**, event completed. Final version `5160a77d75e7961d8378d15165c8c9fae96fa1c48d1dc524a2007f6a8dbe10e5` contains Team A 3 points/rank 1 and Team B 1 point/rank 2. Both final groups were explicitly revealed (revisions 11/12), then table 13 and end 14. Historical results and reload matched that same version and rows at `00:32:56.044Z`; raw rows were deep-equal. Two serialized row hashes differ only because JSON property order differs; they are not used as semantic equality.

Both private PDF exports were captured from their actual UI blobs at `00:44:08Z` / `00:44:09Z`. Lead text and full-page visual review PASS: one page each, legible Czech text, no clipping/overlap, three answer spaces in the team sheet and three answers in the key. Team sheet contains no answers; neither PDF contains synthetic contact addresses or token fields. Team sheet: 10505 B, SHA-256 `3ec3545c7ebec697aab5c3312a83eed6a080a81447e664ba120c9a046b769048`. Answer key: 12835 B, SHA-256 `8918f37af05d9ff9136306b62f69791fb8703ae9694ccd16fd86bdc698016d21`. Lead visual receipt SHA-256: `ff7e27c6cafff44161d580a4b3f030c84493107173fd1e883640d3733f21f0f8`, binding both PDFs and rendered PNGs.

Remaining answer-key access checks now PASS: fresh selected viewer membership version 2 received **403**, anonymous received **401**, neither a PDF response. `pdf-negative-resume.jsonl` ends `PDF_NEGATIVE_RESUME_COMPLETE`, zero cloud writes. Terminal recheck confirmed the same completed event, ended revision 14, current snapshot/version and unchanged viewer scope; saved PDFs were rehashed without re-export. `event-browser.jsonl` now contains the corresponding `history-pdf` completion. The helper was frozen at `5d2599cea14b4841a7932dc2eae8dbb137243dec4f295d4963e5ba60fcf97f29`; HIGH authored, MEDIUM and lead independently reviewed, 29 focused local guard checks/syntax/lint PASS. Plan SHA-256 `d789f00c92826a477e58593e6512252c0c90f48d6c5e4fecba5e57584cf73480` bound the exact prior stop, captured PDF bytes and history. This completes the bounded UI/endpoint journey; the independent metadata audit remains blocked below.

## Retained resource inventory

| Resource | Exact ID / state |
| --- | --- |
| Identity pair | `staging-qa-ddb862f-20261012-01-operator` and `staging-qa-ddb862f-20261012-01-viewer`; limited memberships, viewer selected exact own quiz/event, version 2. |
| Collaboration | Paused, revision 21, updateTime `2026-10-12T21:33:30.823178Z`; no unpause. |
| Quiz | `quiz_baba5c0ac925bc2f8ead8485651af958c9465e16719aa98a44c00e016375e32c`; source revision 7; one round, three questions. |
| Event | `xodmN7Y3EGaMO8O2MPYf`; completed; no second event. |
| Snapshots | Initial text-only `pr6SjyOJhPurZiJkmFto`; current `aehIdVCqSQ5YA4mItwyR`; no third snapshot. |
| Teams | `5u9vjmPPDCKjPrh52vm9` and `Bg5hXiAwyhSWpOpLG2jZ`. |
| Session | `52sOrPUuV22eyo6cYRar`; ended revision 14; no second session. |
| Ready image | `967805e802c97d000adfb7da18235c557b220ac0d0bee2626475d7d8a1df3b22`, generation `1791849391879749`, 84 B. |
| Ready audio | `33d5b69f01c2bd4fe561a1cbcc8cde96d302983d09b1eebd81aec075649b0bd1`, generation `1791849400478039`, 64044 B. |
| Old image grant | `5701b92974b0b0cea7d7a5c7a96714e01b2d534914e2ae71375b5a18b91a456f`, expired; its object absent on successful inspection after expiry, before the two new uploads. No deletion. |

## Evidence and limits

`storage-release-verification.json` SHA-256 `77dda9c9701de37595882f43b51f2cfa7a10a70efdb61d567b247d576bc5b8cd` binds the deployment boundary. `editor-browser.jsonl`, `editor-resume.jsonl`, `scope-browser.jsonl`, `snapshot-relock-readback.jsonl`, `viewer-metadata.jsonl` and `event-browser.jsonl` preserve the actual stages. Exact request bodies, registration capabilities and credentials are in separate protected files, never in Git or this report.

Final offline binding PASS: `retained-qa-verification.json`, mode `RETAINED_QA_PUBLIC_EVIDENCE_VERIFIED`, SHA-256 **`98f6c3aeabc931fa7eada895e120032d90f1b6cc598b4d6063040992898b135a`**. It binds 25 retained public inputs, all five event-journey completions, exact team/score/session/version links, preserved continuation stops, PDF bytes and the lead visual receipt/PNG hashes. LOW authored the verifier, HIGH reviewed its boundaries, lead ran the frozen `01cf8199f41993659350fa0206e8ed63ff57438641ce5559d0b1466e9cac892d` helper. MEDIUM independently rehashed all 25 inputs and matched all 30 stage records, including exactly one completion for each of the five event phases. It validates captured evidence, not a new cloud/browser run or independent visual judgment; metadata audit remains explicitly BLOCKED. No application code changed in this documentation continuation.

The original live reveal response was not captured; this is explicitly reconciled through fresh authoritative state and UI, not a fabricated response. The original pre-reveal assertion ran before the stop but emitted no standalone receipt. Continuations do not erase that limitation. The first continuation stopped before writes on an omitted `snapshotRounds` read. The second confirmed only previous/next/start, then stopped because an unescaped `(default)` in the QA path matcher rejected the own final-version read. The third confirmed both final reveals, then blocked the SDK's read-only transaction commit containing an exact session `verify` write. Fresh winner readback and the independently reviewed fourth continuation completed only table/end. Online audible winner-fanfare success is not claimed; editor audio playback is separate evidence. These are QA harness issues, not demonstrated application failures. No completed mutation was blindly repeated.

The original history/PDF observer stop did not record its specific cause; no retrospective cause is asserted. The first PDF continuation demonstrably stopped on the built-in Chromium PDF viewer's local resource. The second preserved both successful exports, then stopped because delayed viewer CSS/JS arrived after the PDF capture phase. All stop receipts and saved PDFs remain intact. The completed negative-only continuation regenerated no exports and repeated no history/live mutations.

The initial snapshot contained no image. Its revoked metadata and inaccessible old media context are demonstrated; previously attached old-image revocation is not independently proved by that particular scenario.

Independent raw object metadata inspection is **BLOCKED**: `storage.objects.get` is missing, HTTP 403 even with field projection. Successful finalize and protected reads do not establish independent download-token absence. The [precise two-object read proposal](STAGING_METADATA_READ_BOUNDARY.md) is prepared; no IAM change, impersonation or repeated access probes. Retained assets/generations are captured from application ready documents and responses, not a global object inventory.

The heartbeat is confirmed **PAUSED** after completing the other authorized work. The outstanding question asks for at most 30 minutes of read access to these two objects, or leaving this audit unverified. No answer or IAM approval is inferred. After approval, obtain a fresh policy/etag, freeze the expiry and review the exact conditional update before execution. With no approval, preserve this report and do not repeat the completed workflows or the same access failure. Storage rollback and its known limitation remain in [the deployment record](STAGING_STORAGE_READ_BUDGET.md); no rollback was performed.

All QA data remain retained as approved. No real email, cleanup/delete/disable, IAM/API/bucket setting changes, additional application deployment, push/merge, V1/production access or migration occurred. Physical projector/HDMI/audio and print acceptance, real delivery and applicable public-launch policies remain separate evidence/decisions; see [completion matrix](COMPLETION_MATRIX.md). Passing synthetic work is not a claim of 100% production readiness.
