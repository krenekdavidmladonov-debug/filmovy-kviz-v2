# Events architecture — discovery draft

Status: **PRODUCT + ARCHITECTURE DISCOVERY (2026-09-02)**. This is not an implementation or migration contract.

## Decision labels

- **CONFIRMED REQUIREMENT** — behavior explicitly required for Filmový Kvíz V2.
- **RECOMMENDATION** — proposed V2 design, subject to review before implementation.
- **HUMAN DECISION** — product or operating choice that cannot be inferred safely.
- **FUTURE** — extension point only; not part of the first implementation.

## Scope and evidence

- **CONFIRMED REQUIREMENT:** A quiz is reusable content; an event is one scheduled performance of that content. One quiz may be assigned to multiple events.
- **CONFIRMED REQUIREMENT:** The known V1 collection names were `events/{eventId}` and `registrations/{registrationId}`. V1 registrations were intentionally not migrated.
- **RECOMMENDATION:** Treat those names as historical hints only. The committed migration framework deliberately excludes events, registrations, teams, contacts, active scores, and live state, so there is no verified V1 field-level schema to preserve.
- **CONFIRMED REQUIREMENT:** No production Firebase service or personal contact data was inspected for this discovery.
- **RECOMMENDATION:** Do not create an events/registrations migration until a separately authorized, structure-only V1 inventory exists. A future inventory must redact values and report only field names, types, counts, and structural relationships.

## Domain boundaries

```text
editable quiz ── publish/lock ──> immutable quiz snapshot
                                      │
                                      └── assigned to one or more events

private event ── allowlist mapper ──> public event
      │
      ├── private registrations ── acceptance ──> operational teams
      ├── event rounds + scores ── derive ──> private leaderboard
      ├── live session ── allowlist ──> projector leaderboard/results
      └── jobs ──> PDF artifacts / provider-agnostic email delivery
```

- **RECOMMENDATION:** Keep the existing `quizzes` editor model authoritative for editable content and add an immutable quiz snapshot boundary. Event, registration, scoring, and publication mutations go through Cloud Functions.
- **RECOMMENDATION:** Keep contacts only in registration documents. Teams are operational identities and do not duplicate email, phone, contact person, or note.
- **RECOMMENDATION:** Keep projector output under the existing `publicSessions` boundary. Results and leaderboard snapshots are new allowlisted render modes, not reads of private event data.

## Event lifecycle and quiz assignment

### Event state

- **RECOMMENDATION:** `lifecycleStatus` is one of `draft`, `scheduled`, `ready`, `live`, `finalizing`, `completed`, `cancelled`, or `archived`.
- **RECOMMENDATION:** Registration state is independent: `scheduled`, `open`, `paused`, `full`, or `closed`. A completed or cancelled event can never accept registrations even if a stale registration field says `open`.
- **RECOMMENDATION:** Functions own legal transitions. Clients send an expected event revision; the server transaction validates the current state, increments `revision`, and records the actor and timestamp.
- **RECOMMENDATION:** `ready` means the event has a locked quiz snapshot, validated scoring configuration, generated event rounds, and no unresolved blocking preflight errors.

### Stable quiz source

- **CONFIRMED REQUIREMENT:** The same quiz must be usable by multiple events.
- **RECOMMENDATION:** On event lock, create or reuse `quizSnapshots/{snapshotId}` for the exact `quizId` and quiz `revision`. Copy the private ordered slides and derived rounds/questions into an immutable, staff-only snapshot. Store `{ quizId, quizRevision, snapshotId, lockedAt }` in the event.
- **RECOMMENDATION:** Event-linked live sessions add `eventId` and `quizSnapshotId`; they read the immutable snapshot. Existing non-event sessions may continue using `quizId` during a transition period.
- **RECOMMENDATION:** Event round records point to snapshot round IDs but own event-specific scoring settings. Editing a source quiz after lock cannot change a ready/live/completed event, printed sheets, or its answer key.
- **HUMAN DECISION:** Decide whether unlocking a ready event creates a new snapshot and invalidates generated artifacts automatically, or is forbidden once referee access/scoring has begun.

## Authoritative event record

Recommended shape for `events/{eventId}` (private; illustrative field names):

```ts
type Event = {
  schemaVersion: 1;
  title: string;
  startsAt: Timestamp;
  timeZone: 'Europe/Prague' | string;
  venue: {
    name: string;
    address?: string;
    room?: string;
    organizerNote?: string;
  };
  teamCapacity: number;
  acceptedTeamCount: number; // server-derived
  waitlistedTeamCount: number; // server-derived
  registration: {
    status: 'scheduled' | 'open' | 'paused' | 'full' | 'closed';
    opensAt?: Timestamp;
    closesAt?: Timestamp;
    approvalMode: 'automatic' | 'manual';
    waitlistEnabled: boolean;
    maxTeamSize: number;
  };
  quizAssignment?: {
    quizId: string;
    quizRevision: number;
    snapshotId: string;
    lockedAt: Timestamp;
  };
  lifecycleStatus:
    | 'draft' | 'scheduled' | 'ready' | 'live'
    | 'finalizing' | 'completed' | 'cancelled' | 'archived';
  organization: {
    replyToName: string;
    replyToEmail?: string;
    privateInstructions?: string;
  };
  scoring: {
    unitScale: number;
    defaultRoundMaxUnits?: number;
    rankingMode: 'dense' | 'competition';
    leaderboardPublication: 'hidden' | 'manual' | 'live';
    winnerMusicMediaId?: string;
  };
  activeSessionId?: string;
  revision: number;
  createdAt: Timestamp;
  createdBy: string;
  updatedAt: Timestamp;
  updatedBy: string;
};
```

- **RECOMMENDATION:** Store scoring as integer `scoreUnits`; `unitScale=2` represents half-points without floating-point ambiguity. The supported scale is an explicit event setting and cannot change after scoring starts.
- **RECOMMENDATION:** `acceptedTeamCount` is capacity authority and changes transactionally with acceptance/cancellation. Never trust a browser count.
- **RECOMMENDATION:** Public copy, capacity buckets, and public registration status are derived; they are not duplicated browser input.
- **HUMAN DECISION:** Confirm whether capacity counts teams only (the current requirement says team capacity) or must also enforce a total-person venue limit.

## Recommended Firestore layout

### Private operational collections

| Path | Purpose | Direct client access |
|---|---|---|
| `quizSnapshots/{snapshotId}` + private slide/round/question children | Immutable event quiz source | staff read; no client write |
| `events/{eventId}` | Event authority, counters, assignment, configuration | staff read; mutations by Function |
| `events/{eventId}/rounds/{roundId}` | Ordered event scoring manifest | staff/referee-safe projection read; Function write |
| `events/{eventId}/registrations/{registrationId}` | Contact and consent record | authorized staff read only; Function write |
| `events/{eventId}/registrationKeys/{keyHash}` | Server-only duplicate/idempotency reservation | no client access |
| `events/{eventId}/teams/{teamId}` | Operational team without contacts | staff read; Function write |
| `events/{eventId}/roundScores/{roundId_teamId}` | Canonical score per team and round | staff read; Function write |
| `events/{eventId}/scoreTotals/{teamId}` | Server-derived total | staff read; Function write |
| `events/{eventId}/scoreAudit/{auditId}` | Immutable score change audit | admin/moderator read; server create only |
| `events/{eventId}/scoringState/{document}` | Round progress and private leaderboard snapshot | staff read; Function write |
| `events/{eventId}/results/current` | Frozen final ranking and reveal cursor | staff read; Function write |
| `refereeCapabilities/{capabilityId}` | Hash, scope, expiry, revoke state | server only |
| `refereeGrants/{uid}` | Short-lived event/device grant after QR redemption | subject user may read minimal status; server write |
| `emailJobs/{jobId}` | Transactional provider-agnostic outbox | server only |
| `documentJobs/{jobId}` | PDF generation job and artifact metadata | authorized staff read; server write |

### Deliberately public/sanitized collections

| Path | Safe content | Access |
|---|---|---|
| `publicEvents/{eventId}` | title, public venue copy, start, description, registration/capacity bucket | anonymous read under explicit query/get rules; no writes |
| `publicSessions/{sessionId}` | existing sanitized projector snapshot plus presentation mode | anonymous get of known random ID; no list/write |
| `publicSessions/{sessionId}/leaderboards/current` | one bounded, ordered safe leaderboard array | anonymous get of known session; no list/write |
| `publicSessions/{sessionId}/results/current` | only already revealed result entries and media command | anonymous get of known session; no list/write |

- **RECOMMENDATION:** For tens of teams, one leaderboard snapshot document is simpler and cheaper than one listener/document per team. It remains far below Firestore's document limit and gives the projector one listener.
- **RECOMMENDATION:** Use random Firestore IDs for private resources. Public event slugs, if added, resolve through an explicit sanitized mapping and confer no authorization.

## Public event projection

Recommended `publicEvents/{eventId}` content:

```ts
type PublicEvent = {
  title: string;
  startsAt: Timestamp;
  timeZone: string;
  venueName: string;
  publicLocation?: string;
  description?: string;
  registrationStatus: 'scheduled' | 'open' | 'few_left' | 'waitlist' | 'full' | 'closed';
  registrationDeadline?: Timestamp;
  teamSize: { min: number; max: number };
  revision: number;
  updatedAt: Timestamp;
};
```

- **CONFIRMED REQUIREMENT:** No contact person, registration note, email, phone, or complete registration record may enter this projection.
- **RECOMMENDATION:** Publish a capacity bucket rather than exact remaining seats unless exact counts are explicitly desired. The registration Function remains authoritative even when the projection is stale.
- **RECOMMENDATION:** Replace the complete public document on each update through one allowlist mapper, matching the established `publicSessions` pattern.

## Email architecture

- **CONFIRMED REQUIREMENT:** Support registration confirmation, update/cancellation, pre-event reminder, and an organizational message to event teams.
- **CONFIRMED REQUIREMENT:** Provider credentials and send operations never live in the browser.
- **RECOMMENDATION:** Use a transactional outbox. The business Function writes the authoritative registration/event mutation and an `emailJobs` record with a deterministic deduplication key. A server worker leases, renders, and sends it through an adapter.
- **RECOMMENDATION:** The job references `eventId`, `registrationId`, a versioned template key, locale, and semantic payload. The worker resolves the current recipient from the private registration immediately before sending; avoid copying contact data into logs or long-lived job documents.
- **RECOMMENDATION:** Adapter contract: `send({ messageId, from, replyTo, recipients, subject, text, html }): Promise<{ providerMessageId }>` plus normalized transient/permanent error classification. Do not expose provider-specific objects to event code.
- **RECOMMENDATION:** Job states are `pending`, `leased`, `sent`, `retry`, `failed`, or `cancelled`; use lease expiry, bounded exponential retries, and provider idempotency/message IDs. A sent job is immutable.
- **RECOMMENDATION:** Bulk messages create one campaign record, then server-side fan-out jobs with a rate cap and cancellation switch. Never accept arbitrary recipient addresses or raw HTML from a moderator request.
- **RECOMMENDATION:** Templates are allowlisted and escaped. Organizational free text is stored as plain text and rendered safely. Links use short-lived opaque action tokens; no PII is embedded in URLs.
- **HUMAN DECISION:** Choose provider, sender domain, reply-to policy, locale, and delivery/retention expectations before production. The architecture deliberately does not choose or integrate a provider.

## Printable playing sheets

- **CONFIRMED REQUIREMENT:** Generate printable team sheets per registered team and a referee sheet containing question numbers, correct answers, and optional point values.
- **RECOMMENDATION:** Generate PDFs server-side from the locked quiz snapshot and accepted team roster with a dedicated PDF layout library. This gives deterministic pagination/fonts and keeps answer keys away from public browsers.
- **RECOMMENDATION:** A `documentJobs` Function validates staff scope, event readiness, snapshot revision, and requested artifact type. It produces a versioned private artifact or streams it to the authorized requester.
- **RECOMMENDATION:** Artifact metadata records source event revision, snapshot ID, roster revision, template version, checksum, creator, and expiry. Any source change marks prior artifacts stale; it never silently mutates an existing PDF.
- **RECOMMENDATION:** Team sheets contain team display name, event title, ordered round/question numbers, and writing space. They contain no contact details or correct answers.
- **RECOMMENDATION:** Referee answer sheets are `admin`/`moderator` downloads only and use protected temporary delivery. Referee QR access does not imply answer-key access.
- **RECOMMENDATION:** Browser print CSS is useful for an admin preview but not the canonical generator. Client-only generation risks inconsistent page breaks and unnecessarily exposes the full answer key. A headless-browser HTML-to-PDF service is viable but operationally heavier; a dedicated Node PDF library is the preferred first implementation for the simple forms.
- **HUMAN DECISION:** Confirm paper size (A4 expected), questions per round/page, duplex behavior, team sheet personalization, branding, and whether judges need one master sheet or one sheet per round.

## Human workflow

### Admin before event

1. **CONFIRMED REQUIREMENT:** Create an event with date/time, venue, team capacity, organizer settings, and scoring configuration.
2. **RECOMMENDATION:** Assign a quiz, review preflight, and lock an immutable quiz snapshot.
3. **CONFIRMED REQUIREMENT:** Open registration and monitor accepted, pending, waitlisted, and cancelled registrations.
4. **RECOMMENDATION:** Close registration, resolve duplicates/waitlist, and freeze the playing roster.
5. **CONFIRMED REQUIREMENT:** Generate team sheets and referee answer sheet.
6. **CONFIRMED REQUIREMENT:** Create a scoped, expiring referee QR and verify it on a non-admin mobile browser.

### Event night

1. **RECOMMENDATION:** Moderator checks teams in, creates/opens the event-linked live session, and preflights projector/media.
2. **CONFIRMED REQUIREMENT:** Teams answer on paper; referee enters each corrected round through the event-scoped view.
3. **CONFIRMED REQUIREMENT:** The moderator can show recap and a sanitized interim leaderboard between rounds.
4. **CONFIRMED REQUIREMENT:** Final results are revealed manually from last place to first, then winner music and the END slide are presented.

### After event

1. **RECOMMENDATION:** Finalize scores into an immutable results snapshot and archive generated artifacts according to retention policy.
2. **RECOMMENDATION:** Export non-sensitive results separately from registration contacts.
3. **RECOMMENDATION:** Expire/revoke referee grants, cancel unsent jobs, and delete contacts on the approved retention schedule while retaining non-PII event results/audit as allowed.

## Performance and realtime behavior

- **CONFIRMED REQUIREMENT:** Optimize for tens of teams, not millions, while avoiding `N teams × N listeners × N queries`.
- **RECOMMENDATION:** Projector: one listener for `publicSessions/{sessionId}` and at most one listener for the current leaderboard/results snapshot.
- **RECOMMENDATION:** Referee: one bounded roster/round read or safe projection listener, plus changed score documents for the selected round. Do not start one listener per team.
- **RECOMMENDATION:** Admin: page/bounded queries for registrations; one event document and one scoring-state snapshot. Load contact records only on an authorized registration screen.
- **RECOMMENDATION:** Score writes update canonical score, team total, audit, and private leaderboard in a transaction or enqueue a coalesced recalculation. For tens of teams, recomputing/sorting all totals server-side is acceptable; publishing remains a single snapshot write.
- **RECOMMENDATION:** Add composite indexes only for implemented queries, especially registrations by status/time and teams by display order. Start rules deny-by-default and accompany each new query with emulator tests.

## Future digital answering readiness

- **FUTURE:** Add private `events/{eventId}/questionWindows`, `teamAccess`, and `answerSubmissions` without changing quiz/event ownership or canonical scoring records.
- **CONFIRMED REQUIREMENT:** Answer time must not create a speed bonus. Server time may enforce whether a window is open, never derive score magnitude.
- **RECOMMENDATION:** A submission is an immutable attempt tied to event, team, snapshot question, and window revision. A trusted evaluator or moderator converts it into the same canonical `roundScores` model used for paper play.
- **RECOMMENDATION:** Team join capabilities must be distinct from referee/admin capabilities, scoped to one event/team, revocable, rate-limited, and unable to read correct answers or other teams.
- **FUTURE:** Support mixed paper/digital rounds through an event-round `answerMode` (`paper`, `digital`, `hybrid`) only after its product behavior is defined.

## Delivery sequence

- **RECOMMENDATION:** First implementation phase: event CRUD + immutable quiz assignment + `publicEvents` projection + server-only registration transaction, all behind deny-by-default Rules and emulator tests. Do not combine scoring, QR, PDF, and email provider delivery in that first vertical slice.
- **RECOMMENDATION:** Second: registration administration/cancellation/waitlist and transactional email outbox with a fake emulator adapter.
- **RECOMMENDATION:** Third: event rounds, operational teams, referee capability redemption, revisioned score entry, and private totals.
- **RECOMMENDATION:** Fourth: public leaderboard/final reveal state machine, then PDF generation and a real email provider after explicit production decisions.
