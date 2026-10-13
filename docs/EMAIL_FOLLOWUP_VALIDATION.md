# OAuth diagnostics and activation package follow-up

This continuation starts from `ccf2de0156e1d930238616a3127847dcdbe482ee` on `codex/oauth-followup-readiness`. The lead assigned separate HIGH implementation, MEDIUM CI/independent review and LOW readiness/evidence scopes, with no more than three workers active. [Development status](DEVELOPMENT_STATUS.md) records ownership. The application runtime remains identical to `10db080`; these changes concern operator tooling and CI.

## Completed checks

| Check | Evidence and scope |
| --- | --- |
| Safe OAuth diagnostics | HIGH's complete synthetic suite passed 26 tests; after the final one-line callback-path restriction, its affected test passed again. Fixed-value status, rejected-callback deduplication and success/exchange/storage/receipt failures are covered. MEDIUM independently reviewed the exact final helper and test hashes. No actual consent attempt or token exchange was repeated. |
| Initial package guards | Lead's pinned Node 22 run passed all 13 tests, including the real Windows path-link fixture with no skip. This supersedes the author's Node 24 result that skipped the link fixture. |
| Integrated project checks | `pnpm check` passed typecheck, lint and all workspace production builds. The isolated Firestore demo project passed all 50 Rules tests. Retained logs are in `.local-data/email-activation/followup-verification-20261013`. |
| CI definition | Existing Ubuntu guard step includes OAuth and package tests. The separate five-minute Windows job covers real CurrentUser DPAPI/ACL protection and the package's actual child-environment regression, without installing dependencies or receiving credentials. YAML/structure review is recorded with the final source; no remote run is claimed. |
| Read-only staging metadata | Exactly 11 target GETs, zero resource writes or secret-value/registration-data reads. Three registration targets ACTIVE, two workers NOT_FOUND, Cloud Tasks and Secret Manager DISABLED. Four secret metadata requests denied; secret existence/versions remain unverified. [Exact inventory](FINAL_LAUNCH_READINESS.md#bounded-staging-email-inventory--2026-10-13). |

Initial implementation commits are `b500c64` (OAuth diagnostics) and `f976544` (separate five-target builder and CI). Clean source `8463c9766275660add8b6e0affb592646ae9bd35` produced a 44-file package, receipt SHA256 `c7c4830cd626874328ac45cc0884ce39b296d821746ec91518044a1bf74c1663`. This preliminary package and its exact dependency-installed work copy are retained unchanged.

## Operator correction found during actual package verification

The first metadata launch stopped without a completion receipt. The next attempt retained a precise diagnostic: the child failed the closed-environment assertion before importing the SDK. A synthetic no-import probe established that Windows/libuv added OS bootstrap variables omitted from the explicit child environment, including the parent PATH. Escalation alone did not change this behavior. Neither stop is application acceptance evidence.

The HIGH worker corrected both the builder's compiler environment and the ignored metadata harness to supply explicit isolated values for those Windows bootstrap fields. The exact child key/value assertion remains required. Lead Node 22 verification passed all **14 package tests with no skips**, including a real synthetic child process with fake parent credential/preload/PATH/user variables. Targeted lint passed. The unchanged application/runtime and Rules reuse their prior passing checks; this JavaScript-only correction receives new actual compilation and package discovery below. Final corrected-package and SDK results remain pending until execution; the preliminary package is not a completed activation certificate.

## External boundary

The protected client and approved OAuth application already exist. Chrome still blocks the approved callback with `ERR_BLOCKED_BY_CLIENT`; no usable Gmail grant was obtained. A fresh consent attempt requires normal supported access to that callback. Do not recreate the client, replay/extract the stale code or bypass the browser block.

After a grant, use the [activation plan](EMAIL_ACTIVATION_PLAN.md) for the concrete API/secret/queue/private-IAM and five-Function changes, fresh cutoff, selected-recipient smoke and containment. Its queue-pause/off rollback preserves secrets, old keyring keys and receipts. The new package alone supplies no deployment or real-send authority. No new cloud writes, provisioning, deployment, real email, publication or remote CI occurred in this phase. Frozen staging application `ddb862f` and separately applied Storage fix `5fe7d9b` remain unchanged; venue and public-launch decisions remain separate in the [completion matrix](COMPLETION_MATRIX.md).
