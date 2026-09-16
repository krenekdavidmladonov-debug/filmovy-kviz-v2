# Event management

Implementation and release evidence for scoped event lifecycle, archive, trash and deletion.

Starting point: `be094fd17e18276130678952cf69417ce917245e`, including PR #31 application head `7b15faf53b4714122bf6cafd2ae751eda2061e35`. Existing main checkout is older and is not the release base.

Only `filmovy-kviz-v2-staging` is authorized for cloud work. Original content and the personal owner account are excluded from automated QA and cleanup.

## State and permission contract

`lifecycleStatus` retains the outcome. Independent `disposition` is active, archived, trash or deleting. Missing disposition defaults to active; legacy lifecycle archived maps to archived without a backfill. Unarchiving a legacy document cannot reconstruct a lost outcome, so its terminal archived lifecycle remains read-only.

| Operation | Permission in current scoped membership | Allowed starting state | Result |
| --- | --- | --- | --- |
| Read | event.read, additional contacts/answers/notes permissions for those fields | active/archive | redacted current reads |
| Edit / registration settings | event.manage (contacts also for teams) | operational active action | expected revision; safe organizational fields during live |
| Cancel | event.manage | draft/scheduled/ready/live/finalizing | cancelled, closed registration, revoked capability epoch |
| End all runs and cancel | event.manage + event.live | same, with active sessions | explicit confirmation, atomic closure and neutral public sessions |
| Return to preparation | event.manage | cancelled, no scores or played session | ready/scheduled, registration closed, no session resurrection |
| Archive | event.manage | completed/cancelled or legacy archived, no active session | archived disposition; outcome and data preserved |
| Unarchive | event.manage | archived | active disposition; terminal outcome preserved |
| Trash | event.manage | active/archive, no active session | trash, public event removed, capability epoch advanced |
| Restore | event.manage | trash only | previous disposition/outcome, registration closed, live pointer removed |
| Permanently delete / resume | event.read + event.delete | trash/deleting | recent Auth authentication, exact title and revision; server batches |

`event.delete` is the only added permission. Existing owner membership implicitly receives it; manager/moderator/referee presets do not. Explicit delegation uses the existing grant parser and scope rules. No legacy admin claim grants it. Trash metadata/inventory is available only with event.manage or event.delete, within event scope; ordinary private reads, export and snapshot/media reads reject trash/deleting. Membership is reread in write transactions, so revocation conflicts with writes even for an old ID token.

## Actual event relationships and deletion allowlist

- `events/{id}` owns registrations, registrationNames, registrationOperations, scores (with history), scoreOperations, refereeAccess, emailIntents, emailSecrets, emailCampaigns and eventOperations.
- `sessions` are discovered by exact eventId and checked against the event's liveSessionId. Each owns interimVersions/interimOperations/finalVersions/finalOperations and its exact publicSessions copy.
- `quizSnapshots` are discovered by owner eventId, exact assignment and session references. Both existing and missing roots require an exclusive-reference check. Shared snapshots remain. Snapshot slides/rounds are deleted only with proven ownership.
- `publicEvents/{id}` is the event's public projection. Library quizzes, source questions, library media, Auth users, memberships and global referee limiters are never deletion targets.
- Current media assets are library-owned; generated PDFs are response bytes. The deletion implementation has **zero Storage mutations**. Any future event file type requires a reviewed exact-reference/generation contract before entering this allowlist.

Deletion stores a server-created plan and cursor in eventDeletions, first locks the event as deleting, and removes content in batches of at most 100 documents. Missing parent documents are discovered with listDocuments; unknown descendants stop the job. Each transaction rereads membership, event lock and phase/count to serialize concurrent resume requests. Root deletion happens last. A reload exposes persisted progress; the next authorized call resumes. There is no cron, browser deletion loop or bulk trash command.

Completed jobs retain only event ID, counts, completion time and retained-snapshot count. eventTombstones retains ID, original creator, revision and deletion time; eventAudit retains operation/actor/time. Contacts, title, answers and deleted content are not copied into these records. “Deleted” means removed from the application's active data; provider backup/soft-delete retention is unchanged.

## Concurrency, compatibility and links

Transitions use expected revision and an actor/event/request receipt; repeated requests do not repeat the audit. Operational writers read the same event in their transaction: registration, team updates, scoring, snapshot lock, live creation/control, referee access and delayed email work. Completed/cancelled/archive/trash/deleting cannot be bypassed through old handlers. Date fields use Europe/Prague, reject nonexistent DST times and require an explicit offset for repeated autumn times. Conflict handling retains the form and merges untouched fields from the newer version before a second explicit save.

Cancellation and trash increment capabilityVersion. Old team/referee links stay revoked after restore; issuing a new link rotates the token. Registration create retry also checks the recovered token against the current hash, preventing a revoked retry capability from reading data after rotation. Cloud registration has no email secret dependency, stores only token hashes and derives retry tokens from a 256-bit random client retry capability with a domain-separated SHA-256. Emulator-only fake email tests retain their vault. Cloud email endpoints remain absent and no messages are queued.

The existing event list now uses scoped document-ID pages (100 at a time), includes legacy documents without new fields, and computes filter counts only from permitted data. The UI displays 20 per page. There is no global count or cross-scope audit feed.

## Release and rollback

The checked-in deployment-manifest names every affected callable, including the four existing access-grant endpoints whose permission catalog changes. Targeted artifact preparation strips dev entrypoints, checks a clean exact SHA, fixed staging configuration, no credential files, no declared cloud/email parameters and no secret bindings. The only new client callables are deleteEvent, restoreEvent and trashEvent in europe-west1. Their sole authorized IAM addition is allUsers roles/run.invoker on the corresponding individual services; no invoker check is disabled.

Deploy backend guards first, verify them, then Rules and Hosting. Do not roll back to a pre-disposition backend after trash data exists: that could reopen content. A safe UI rollback keeps the protective backend/Rules; backend repair is a reviewed forward fix. No backfill or original-content writes are part of this release.

Bounds fail closed: 200 sessions per event and 1000 owned snapshots per plan; unknown child schemas or corrupt/ambiguous live pointers require an explicit repair before continuing. Already downloaded or photographed data cannot be recalled. Reauthentication currently uses the existing email/password provider.

## Evidence

Before cloud writes, a fresh inventory recorded 1923 documents (14 events, 6 library quizzes) and zero Storage objects. All 32 non-reserved Hosting files matched the gzip-level-9 hashes of the prepared application at `7b15faf53b4714122bf6cafd2ae751eda2061e35`. The personal owner and all original documents are outside QA mutation/cleanup scope. Detailed local/CI/online receipts and final release identifiers are recorded separately after verification.
