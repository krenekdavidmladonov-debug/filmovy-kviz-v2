# Security

## Core invariants

1. Correct answers never reach public/projector clients before reveal.
2. Public clients cannot read private quiz sources, registrations, contacts, or staff data.
3. `request.auth != null` is authentication, not administrative authorization.
4. Staff privileges require a current active server-managed membership, concrete permissions and resource scope. Legacy role claims grant no authority.
5. Sensitive state changes are validated and authorized server-side.
6. Firestore and Storage start deny-by-default; access is added narrowly and tested in emulators.
7. Production access and deployment require explicit user approval.

## Preventing answer leakage

The projector reads only one `publicSessions/{sessionId}` document. The trusted `buildPublicSessionState` allowlist builds this projection from private quiz data. In ordinary question mode it copies only explicitly safe title/text/options, normalized visual media, and presentation controls; AUDIO source is omitted entirely. In explicit recap mode it adds only the selected question's display-form `revealedAnswer` and allowed answer image—not the private slide or question. Hiding an answer in React state, CSS, a network response, an error, or an unread UI branch is not acceptable.

The projector ignores inbound BroadcastChannel presentation state entirely. Only Firestore may supply a slide or an explicitly reviewed interim-results page. The projector rejects cache-only data, stale revisions and foreign sessions, invalidates old callbacks, and performs a fresh server read on reconnect. Channel player lifecycle reports contain only session ID, generation and an allowlisted state; authenticated staff and the trusted Function still validate them.

Every navigation, reveal, hide, and end operation replaces the entire public document in the same transaction as the private update. Navigation resets `answerRevealed`; therefore old answer fields cannot survive through merge semantics. The projector rejects Firestore cache-only snapshots and clears itself on browser offline events so a disconnected client does not continue showing an old revealed answer.

Private answer media must use protected paths or server-controlled delivery; prompt and answer media must not share guessable unrestricted URLs.

## Authorization

The current policy is defined in [PERSONAL_ACCESS.md](PERSONAL_ACCESS.md) and the shared permission module. Firebase Auth verifies identity; current membership, permissions and resource scope authorize each operation. Role labels are editable presets. Legacy custom claims are preserved but ignored as authority.

Every legacy staff callable uses the explicit fail-closed policy wrapper. Permission and scope are reread inside each content transaction, so revocation conflicts with delayed saves. HTTP media and print gateways check the same current membership. Storage grants bind member version, quiz scope, MIME, size and expiry. No browser writes membership, content, snapshots or audit directly.

Limited clients use bounded server views; hidden answers, answer media, notes, raw legacy records and contacts are removed before transport. Saving redacted content preserves the authoritative protected fields. Raw Firestore reads require every sensitive permission contained in that document and its resource scope. Public projections remain explicit allowlists. Full inventories, invite activation gate, owner bootstrap and rollback are documented in PERSONAL_ACCESS.md.

Direct snapshot reads additionally require the snapshot to be the owning event's current `quizAssignment.snapshotId`. Relocking an event revokes direct get/list access to its previous snapshot; a retained `snapshot.eventId` does not preserve access. Historical final results use their separate confirmed-results records rather than this private source exception.

Invitation and membership changes serialize on accessControl/state, validate permission dependencies and delegation bounds, prohibit self changes and protect the last owner. Accepting an invitation also rechecks the issuer's current Auth identity on each transaction attempt: a missing, disabled or unverified issuer cannot activate a membership. Auth and Firestore are separate services; this check does not make their state changes atomic. Only owners manage managers. Audit entries contain safe before/after grants, never passwords, tokens or quiz answers. New Auth identities without membership have no private access. Browser caches and drafts are cleared on identity or membership-version transitions.

## Public registration

Manual team add/edit is admin-only and shares transactional capacity and name reservations with online registrations. Its nullable token verifier never authorizes public access; manual records have no public management capability. Public requests cannot choose manual origin or bypass their email/window requirements. See `EVENT_TEAM_TOOLS.md`.

Registration uses callable Functions rather than direct Firestore writes. It validates fields/types, normalization/limits, contact format, team-size bounds, server-time window, unique names, and both capacities transactionally. Management tokens are random bearer capabilities; registration records store only SHA-256 verifiers and invalid combinations are non-enumerating. Transactional email retains the same token only in a separate authenticated ciphertext envelope, denied to every client role. Email intents/receipts remain server-only; staff receive only safe delivery status through the registration. No public email relay exists. A private task endpoint accepts only event/intent IDs, and the worker derives recipients/content from server-only intents. Only the worker binds Gmail OAuth secrets; create/replay and the worker bind the protected encryption keyring. Local vault/fake-provider access requires both a demo project and a localhost emulator, and the real Gmail adapter refuses emulator execution. Actual cloud key/OAuth values, IAM setup and deployment remain unconfigured. Responses reveal no other teams or contacts. Production abuse controls remain a launch prerequisite. See [TRANSACTIONAL_EMAIL.md](TRANSACTIONAL_EMAIL.md).

## Firebase configuration and secrets

Firebase web configuration is not a secret, but project selection is safety-critical. Local defaults use a `demo-*` project and emulators. Cloud access additionally requires explicit staging mode and the exact allowlisted V2 staging project/app/domain. Other cloud and production builds are rejected. Service-account keys and secrets are forbidden in Git. The isolated staging bootstrap uses only operator CLI OAuth in memory and synthetic data; its generated passwords/tokens remain under ignored `.local-data/staging`. See `STAGING.md`.

The local auth seed uses Admin SDK only after two fail-closed checks: the Authentication Emulator must be on local port `9099`, and the project ID must start with `demo-`. It creates three documented development accounts and never loads credentials.

The quiz seed applies the same fail-closed design to Firestore: it requires local port `8080` and a `demo-*` project. Stable IDs make it safely repeatable. Its Admin SDK access is strictly an emulator-only development tool and does not justify client writes in Rules.

The V1 migration tool follows the same fail-closed principle. Managed export bytes and extracted data stay under the Git-ignored `.local-data/` tree. Extraction and WRITE require an exact local emulator host (`localhost`, `127.0.0.1`, or `[::1]` plus a valid port) and a `demo-*` project ID; the emulator writer has no production override. The separately guarded staging-only cloud path is documented in tools/migration-v1/CLOUD_IMPORT.md, including read-only source IAM requirements and private root-last import journals. Emulator WRITE additionally requires a fresh emulator target with no quiz migration documents. Local inventories may contain document IDs and titles for operator reconciliation, while the committed report contains structural counts only. Neither form contains question text, answer values, notes, options, contacts, or raw documents.

## Rules and tests

Firestore Rules tests run through `firebase emulators:exec` and `@firebase/rules-unit-testing`, not mocked SDK calls. The suite covers anonymous/unprivileged denial for private sessions and quiz sources, anonymous single-document public reads, public list/write denial, staff private reads, direct staff write denial, and default denial. Emulator E2E additionally invokes real callable emulators as anonymous, ordinary user, moderator, and admin. Editor coverage verifies admin-only idempotent creation of one empty private draft, admin CRUD, moderator read-only behavior, direct-write denial, stale/concurrent saves, exact legacy round-trip (including the imported `0/0` timing sentinel), contiguous ordering, guided Choice/Video repairs, invalid indices/timing rejection, sanitized repair responses, and that editor activity leaves sentinel public/session snapshot state unchanged.

Storage now allows only admin create under an exact server-issued quiz media upload grant. All direct get/list/update/delete remain denied. The authenticated/current-publication read gateway, MIME/size/signature checks and immutable generation binding are covered by local Storage contracts and browser tests; see MEDIA_STORAGE.md. Further access still requires explicit boundary tests.

## Operational safeguards

- Separate local, staging, and production Firebase projects.
- Use least-privilege CI identities and protected deployment environments.
- Require review for Rules, Functions authorization, and public projection changes.
- Log security-relevant mutations without secrets or unnecessary contact data.
- Define backup, retention, deletion, and incident-response procedures before launch.

### Internal event scoring
The saveEventScore callable rechecks the current Auth user's admin/moderator claim and disabled flag on every invocation, including retries. The existing global staff scope is preserved. New writes require the event's current immutable snapshot, an existing snapshot round, an accepted canonical registration, an operational lifecycle, a safe half-point integer (or null), an exact score revision, and a reason for corrections/clearing. Score, history and actor/event-bound idempotency receipt commit atomically. Rules grant only staff score/history reads and deny all client writes; scoreOperations is server-only. Management tokens grant no scoring authority. Nothing is published and contact access is unchanged. Full contract and emulator tests: EVENT_SCORING.md.

## Referee capabilities

Referee access is a separate per-event bearer capability, not a staff role or Firestore claim. Grants and rate-limit counters remain server-only. Every protected transaction checks current grant validity and event state; revocation conflicts with in-flight score transactions. See [REFEREE_ACCESS.md](REFEREE_ACCESS.md) for delivery limits, payload allowlists, expiry and tests.


Interim result publication rechecks the current Auth role on every transaction attempt, event/session/snapshot binding, accepted roster, included scores and source fingerprint. Public output is a fresh allowlist of only the reviewed current page; private versions/audit and scores retain staff-only reads and deny every client write. Referee and registration management capabilities confer no publication access. See [INTERIM_RESULTS.md](INTERIM_RESULTS.md).


Final reveal extends the same event-bound live session with private immutable finalVersions, revisioned finalOperations and an explicitly revealed public page. Staff confirmation, corrections, closure and moderator-only synthetic sound are documented in [FINAL_REVEAL.md](FINAL_REVEAL.md). No Rules, indexes or cloud data change is required by this implementation.

## Event organizational email

Admin-only preview/confirmation creates an immutable emailCampaigns record and recipient snapshots in the existing emailIntents outbox. The shared task worker delivers plain-text organizational messages without management capabilities or changes to registration confirmation status. All client campaign/intent access remains denied; safe history and status are exposed only through fresh-admin callables. Atomic recipient limits, snapshot/idempotence contracts and offline tests: [EVENT_TEAM_EMAIL.md](EVENT_TEAM_EMAIL.md).

Media authoring extends the shared picker/gateway/renderer to question, private answer and background roles. Explicit empty fields detach without deleting legacy data or snapshot assets. See MEDIA_AUTHORING_RELEASE.md for the complete contract and deployment scope.


Complete editor extends the same private ordered stream with explicit draft/ready authoring, independent answer mode, default appearance, atomic round/recap creation and private in-memory rehearsal. Drafts block preflight, snapshot lock and live publication. See [COMPLETE_EDITOR_RELEASE.md](COMPLETE_EDITOR_RELEASE.md) for field compatibility, authorization, verification and the integrated deployment manifest.

## Event management extension

See [EVENT_MANAGEMENT.md](EVENT_MANAGEMENT.md) for the independent disposition overlay, scoped permission mapping, shared transactional guards, capability revocation and exact server-side deletion ownership/allowlist. No content backfill or Storage cleanup is introduced. Cloud team email remains disabled.
