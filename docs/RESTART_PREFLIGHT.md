# Approved read-only V2 staging preflight — 2026-10-12

The owner approved both the [AGENTS.md](../AGENTS.md) membership/permission/scope alignment and read-only V2 staging preflight on 2026-10-12. This record covers metadata inspection of `filmovy-kviz-v2-staging`, with Functions inventory bounded to `europe-west1`. It is not deployment approval or a claim that staging runs the current candidate.

Evidence is retained locally in ignored `.local-data/restart-preflight-20261012/inventory.json`, `extras.json` and `complete.json`. These contain staged metadata snapshots and corrected follow-up reads; they are not public artifacts. Identity details, SDK configuration keys and local credential material are omitted here. See [DEVELOPMENT_STATUS.md](DEVELOPMENT_STATUS.md) and [RESTART_RELEASE_PLAN.md](RESTART_RELEASE_PLAN.md) for coordination and proposed deployment scope.

## Observed metadata

| Area | Read-only finding | Practical limit |
| --- | --- | --- |
| Project access | Node SDK project read succeeded after normal escalation for access to the local OAuth cache. | The initial problem was local file permission, not evidence of an expired login. |
| APIs | All 10 inspected prerequisite APIs were enabled. | Enabled APIs alone do not establish application readiness. |
| Functions | 71 ACTIVE Gen 2 functions: exact proposed 70-function inventory plus `health`; no Gen 1 functions in the inspected region. All six excluded email functions were absent. | Names and metadata do not establish deployed source equivalence; other regions are outside this inventory. |
| Runtime configuration | All 71 inspected runtimes matched the staging project, region and Storage bucket; no emulator environment was present. | This checks the selected public configuration fields, not all code or secrets. |
| Firestore indexes | Two inspected indexes were READY and matched the expected definitions. | No workload or data-content verification was performed. |
| Storage bucket | `EUROPE-WEST1`, uniform bucket-level access, public access prevention enforced. Runtime custom bucket role includes object get/update; expected service-agent binding is present. | No media objects were read and no IAM changes were made. |
| Firestore Rules | Deployed source equals `8106c4a`, differs from the candidate, and lacks the newer replaced-snapshot authorization fix. | This is a concrete deployment gap; current local Rules tests do not prove deployed Rules behavior. |
| Storage Rules | Deployed source equals the current candidate. | Source equality does not establish complete runtime behavior. |
| Hosting | Latest returned release: `sites/filmovy-kviz-v2-staging/releases/1789655741188000`, version `752720637f78079b`, FINALIZED, released `2026-09-17T14:35:41.188Z`. | Historical deployed version; not proof of candidate Hosting assets or online acceptance. |
| Auth and membership | Three Auth accounts and two memberships inspected; owner and moderator memberships were active with verified accounts. Owner lacks `event.delete`. | No raw identities are reproduced; no grants or accounts were changed. The missing permission was not automatically granted. |
| Collaboration control | Collaboration enabled, revision 18. | Any future pause requires separately approved compare-and-set against the then-current revision. No pause write occurred. |
| GitHub | Connected repository lookup and authenticated CLI repository lookup both returned 404; CLI identity matched the expected owner. Git remote HEAD read succeeded at `0d452d8`. | Git transport access does not establish GitHub API access, review approval or CI status. CI remains unverified. |

## Corrected inspection attempts

The initial index API request returned 400; omitting `pageSize` corrected the read. A Cloud Functions map-field projection returned 400; a public-field whitelist read of Cloud Run environment configuration supplied the intended runtime metadata. Initial failures are preserved in the local snapshots and do not invalidate the successful corrected reads. They do not represent cloud writes.

## Remaining work and boundaries

Artifact preparation and a verified exact-candidate builder are pending; the lead is preparing the new builder. No candidate checksums or successful staging build are asserted by this record. A deployment proposal must account for the deployed Firestore Rules gap, exact artifacts, any separately approved collaboration pause, smoke checks and rollback.

The approved inspection read no quiz or team-contact content, media objects or data exports. It sent no email, deployed nothing, and changed no cloud resources, accounts, permissions or collaboration settings. Production remains outside scope.

Metadata inspection is not a full deployed-source audit, authorization behavior test or security certification. Remote CI, online candidate acceptance, real-data migration and physical projector/audio acceptance remain unverified. Cloud writes and deployment require separate explicit approval.
