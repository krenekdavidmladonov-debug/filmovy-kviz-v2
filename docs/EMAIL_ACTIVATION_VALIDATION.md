# Registration email activation preparation — 2026-10-13

Local candidate on `codex/email-activation-preparation`, based on `ef43eb1f1bee517b70cf86b6e4ce95029c8d7aff`. The owner supplied a replacement Gmail sender/test recipient in ignored private selection. No address or credential was added to committed files. This is local implementation and preparation evidence; deployed staging remains email-disabled.

## Implemented boundary and review

Default-off adds no email parameter declarations or secret bindings. Explicit exact-V2-staging activation requires a canonical UTC cutoff and one allowed mailbox. Other registrations remain functional without email intents/envelopes. Dispatch and the actual delivery lease transaction reject old, other-recipient and team-message intents before writes or secret/provider access. Existing protected create receipts remain validated on retry. The worker explicitly requires private invocation.

GPT-6.1 Sol HIGH implemented the trusted boundary; MEDIUM independently reviewed it and authored the offline planner; LOW reviewed evidence and reconciled operational documentation. The lead reviewed, added the real transaction regression and CI invocation, and ran integration serially. The frozen 70-function release inventory itself was not changed.

## Verification

Evidence directory: `.local-data/email-activation/verification-NOdW0h`. Final `verification.json` SHA-256: `c91db437d0e40f1043039142a2e191cbfc44b169afdb6bad488a5f8d15458059`. It binds 15 source files, nine logs/results and four orchestration scripts; LOW independently checked every hash and the actual result counts.

| Check | Result / actual scope |
| --- | --- |
| `pnpm check` | PASS: workspace/test typecheck, lint and production build. |
| Targeted Vitest | 82 PASS / five files: email activation, Gmail delivery, transactional email, team email and registrations. |
| Node offline tests | 13 PASS: eight planner guards and five retained release-inventory contracts. Final manifest-test-only edit also passed targeted ESLint. |
| Compiled SDK discovery | PASS: actual installed SDK, 70 default-off exports without email bindings, five opt-in exports with create keyring / worker four secrets, private worker invoker, zero parameters and zero handler/network invocations. |
| `pnpm test:rules` | 50 PASS / actual isolated Firestore emulator. |
| Four email emulator suites | 23 PASS groups: registration email 9, new activation transaction 2, Gmail worker 7, organizational email 5. Auth/Firestore/Functions suite exited 0. |
| Final source binding | Every recorded source hash still matched; all five emulator ports closed. |

The new transaction regression verifies unchanged document data and nanosecond update times, no lazy secret/provider resolution for rejected intents, one allowed fake send and terminal replay with no further writes/send. It injects the activation predicate into the real transaction; it does not simulate cloud IAM, OAuth or deliver internet mail. Compiled discovery inspects metadata with instrumented network blocking, not an OS sandbox or a deployed artifact certificate.

All runtime tests used only `demo-filmovy-kviz-v2`, synthetic `example.test` contacts and fake providers. Runtime staging copies contain compiled code/package metadata and dependency links, without root `.env` or runtime configuration. The isolated launcher removed cloud credential environment and used private empty configuration directories. Existing debug logs were preserved as historical private files, not published or treated as new test evidence.

## Corrected verification stops

The first check found a new test accessing SDK metadata omitted from the SDK's TypeScript type; the private-invoker assertion was preserved using object matching. The next unit run exposed inherited emulator-host flags in mocked cloud fixtures; test environment isolation was corrected without weakening runtime guards. The original release inventory test still asserted emulator-only implementation text; three stale source-shape assertions were removed while retaining all manifest/authorization checks, with actual default-off behavior covered by unit and compiled discovery.

After all checks passed, receipt finalization stopped because silent successful ESLint produced no log file. A bounded finalizer verified existing results, source hashes and closed ports and recorded the observed silent exit separately; it did not repeat successful suites. Original failures remain in the ignored evidence directories. No application or cloud failure is inferred from these test/orchestration stops.

## Remaining execution

[EMAIL_ACTIVATION_PLAN.md](EMAIL_ACTIVATION_PLAN.md) defines the exact five functions, private queue/secret prerequisites, rollout, off/paused-queue containment and bounded smoke. The selected addresses are already supplied; the actual Google `gmail.send` OAuth consent, credential provisioning and queue/configuration verification remain missing. The offline planner does not certify cloud readiness or execution authorization. No push, remote CI, OAuth, deployment or real send occurred in this phase. Production/V1, existing retained QA and expired IAM permissions were not accessed or changed.
