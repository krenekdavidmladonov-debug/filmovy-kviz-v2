# Scoring, leaderboard, and final results — discovery draft

Status: **PRODUCT + SECURITY DESIGN, NOT IMPLEMENTATION (2026-09-02)**.

## Decision labels

- **CONFIRMED REQUIREMENT** — explicitly required behavior.
- **RECOMMENDATION** — proposed V2 architecture.
- **HUMAN DECISION** — unresolved product/operating behavior.
- **FUTURE** — extension point, not first-version scope.

## Core invariants

- **CONFIRMED REQUIREMENT:** A score belongs to exactly one event, team, and round. A referee enters points after correcting a round and can later correct them.
- **CONFIRMED REQUIREMENT:** Two referees may work concurrently; a stale client must never silently overwrite a newer score.
- **CONFIRMED REQUIREMENT:** Leaderboards contain team display name, total score, and rank only. They contain no contact person, email, phone, registration note, or private registration reference.
- **CONFIRMED REQUIREMENT:** Final results reveal manually from last place to first. Tied totals may share a rank. Revealing first place triggers configurable winner music, followed by the END slide.
- **CONFIRMED REQUIREMENT:** A correct answer is never sent to a public/projector client before explicit reveal. Scoring and results additions must preserve the existing private-source/public-projection pattern.

## Event round manifest

- **RECOMMENDATION:** When an event locks its immutable quiz snapshot, derive `events/{eventId}/rounds/{roundId}` records. These are the scoring contract for the event and do not change when the source quiz changes.

```ts
type EventRound = {
  snapshotRoundId: string;
  position: number;
  title: string;
  questionCount: number;
  scoreMode: 'round_total';
  minScoreUnits: number;       // normally 0
  maxScoreUnits: number;
  unitScale: number;           // copied from locked event config
  answerMode: 'paper';
  status: 'pending' | 'open' | 'submitted' | 'locked';
  revision: number;
  updatedAt: Timestamp;
  updatedBy: ActorRef;
};
```

- **RECOMMENDATION:** First implementation stores one total per team/round because the confirmed referee UI enters round totals. Do not manufacture per-question scores unless the product needs them.
- **RECOMMENDATION:** Round max and score scale are locked before scoring begins. Validation requires an integer `scoreUnits` in `[minScoreUnits, maxScoreUnits]`.
- **FUTURE:** Per-question/manual/digital details may be added beneath a score or submission collection while the canonical round total remains the leaderboard input.

## Canonical score and derived total

### Round score

Path: `events/{eventId}/roundScores/{roundId_teamId}`. The deterministic ID is derived server-side from already validated IDs; clients do not construct authorization from it.

```ts
type RoundScore = {
  eventId: string;
  roundId: string;
  teamId: string;
  scoreUnits: number;
  unitScale: number;
  revision: number;
  createdAt: Timestamp;
  createdBy: ActorRef;
  updatedAt: Timestamp;
  updatedBy: ActorRef;
};

type ActorRef = {
  kind: 'admin' | 'moderator' | 'referee';
  actorId: string; // uid or opaque grant/audit id, never raw token
};
```

- **RECOMMENDATION:** Missing score means “not entered,” which is different from zero. UI and ranking completeness must preserve that distinction.
- **RECOMMENDATION:** Use fixed-point integer units, never floating-point points. Display `scoreUnits / unitScale` using a shared formatter.
- **RECOMMENDATION:** Keep contact data and referee token/capability IDs out of score documents. The actor reference identifies a grant/session audit ID, not the bearer credential.

### Team total

Path: `events/{eventId}/scoreTotals/{teamId}`.

```ts
type ScoreTotal = {
  teamId: string;
  totalUnits: number;
  unitScale: number;
  scoredRoundCount: number;
  expectedRoundCount: number;
  complete: boolean;
  revision: number;
  updatedAt: Timestamp;
};
```

- **RECOMMENDATION:** The server maintains totals from canonical score deltas in the same transaction as each score change. A periodic/admin reconciliation Function can recompute every total from source scores and report structural mismatches without printing team/contact data.
- **RECOMMENDATION:** Canonical `roundScores` are the source of truth. `scoreTotals`, private leaderboard, and public projection are disposable, rebuildable views.

## Save-round transaction and concurrency

### Request

The mobile UI presents one selected round and sends only changed rows:

```ts
type ScoreChange = {
  teamId: string;
  scoreUnits: number;
  expectedRevision: number; // 0 means no existing score
  correctionReason?: string;
};

type SaveRoundRequest = {
  eventId: string;
  roundId: string;
  expectedRoundRevision: number;
  requestId: string;
  changes: ScoreChange[];
};
```

- **RECOMMENDATION:** A callable verifies App Check, authenticated staff/referee grant, event scope, scoring lifecycle, round/team membership, request size, distinct team IDs, fixed-point bounds, and every expected revision.
- **RECOMMENDATION:** In one Firestore transaction, read the round and each changed canonical score/total, reject any mismatch with `ABORTED`, then write scores, total deltas, audit entries, and increment revisions. A retry with the same `requestId` returns the prior safe result.
- **RECOMMENDATION:** The referee UI “ULOŽIT KOLO” is one logical operation over changed entries. Tens of teams fit comfortably in a bounded transaction; set an explicit maximum and split only if real event size later requires it.
- **RECOMMENDATION:** A conflict response returns only safe identifiers/current revisions and asks the client to reload. It does not return contacts, raw audit, or another event's data.

### Lost-update behavior

- **RECOMMENDATION:** Referees editing different team rows do not conflict except where they touch the same canonical score/total. Referees editing the same row from the same revision cause one transaction to win and the stale transaction to abort.
- **RECOMMENDATION:** `expectedRoundRevision` protects round lock/finalization state, not all row edits. Increment it on lifecycle changes (`open`/`submitted`/`locked`), avoiding needless conflicts between independent team rows.
- **RECOMMENDATION:** No generic last-write-wins update, increment-only client write, or offline queued direct write is allowed. The UI keeps unsaved local input visible after conflict so the referee can compare and intentionally reapply.
- **RECOMMENDATION:** Scoring requires an online Function response. Offline drafts may remain local on the referee device but are visibly unsaved and never presented as authoritative.

## Corrections and auditability

Path: `events/{eventId}/scoreAudit/{auditId}`.

```ts
type ScoreAudit = {
  roundId: string;
  teamId: string;
  previousUnits: number | null;
  nextUnits: number;
  previousRevision: number;
  nextRevision: number;
  reason?: string;
  actor: ActorRef;
  requestId: string;
  occurredAt: Timestamp;
};
```

- **RECOMMENDATION:** Create audit records in the same transaction as the canonical change; client updates/deletes are always denied. Never store raw QR tokens, contact details, IP addresses, or arbitrary request bodies in audit.
- **RECOMMENDATION:** Require a short correction reason after a round is submitted/locked; first entry while open needs no reason. Only admin/moderator may unlock a finalized round, through an audited Function.
- **RECOMMENDATION:** Event finalization refuses incomplete teams/rounds unless a moderator explicitly records an allowed resolution (for example disqualified/withdrawn team) rather than silently treating missing as zero.
- **HUMAN DECISION:** Define who may correct a submitted/locked score and how long the post-event correction window remains open.

## Private leaderboard derivation

- **RECOMMENDATION:** Sort eligible teams by `totalUnits DESC`; apply an explicitly selected tie algorithm; use normalized display name and stable random team ID only as deterministic order within a tie. Alphabetical tie order is presentation order, not a tie-break.
- **RECOMMENDATION:** Exclude cancelled/withdrawn teams. Keep disqualified teams in a separate explicit status instead of assigning a magic negative score.
- **RECOMMENDATION:** A team with missing required rounds is marked incomplete and does not receive an apparently final rank. Interim leaderboards may include it only with a clear completeness policy chosen by the product owner.
- **RECOMMENDATION:** Store a private bounded snapshot at `events/{eventId}/scoringState/leaderboard`:

```ts
type PrivateLeaderboard = {
  sourceRevision: number;
  scoredThroughRoundId?: string;
  complete: boolean;
  entries: Array<{
    teamId: string;
    displayName: string;
    totalUnits: number;
    rank: number | null;
    scoredRoundCount: number;
  }>;
  updatedAt: Timestamp;
};
```

- **RECOMMENDATION:** For tens of teams, server recomputation and sort after a save (or a coalesced task immediately afterward) is simple and fast. Publication checks `sourceRevision` so a stale asynchronous calculation cannot replace a newer snapshot.

## Sanitized live leaderboard

Path: `publicSessions/{sessionId}/leaderboards/current`.

```ts
type PublicLeaderboard = {
  mode: 'hidden' | 'interim' | 'final';
  revision: number;
  scoredThroughRoundLabel?: string;
  entries: Array<{
    publicTeamId: string;
    teamName: string;
    totalUnits: number;
    unitScale: number;
    rank: number;
  }>;
  updatedAt: Timestamp;
};
```

- **CONFIRMED REQUIREMENT:** Totals are automatically derived from canonical scores; browsers never submit totals or ranks.
- **RECOMMENDATION:** Publication is an authorized moderator Function that copies only allowlisted fields from a current private leaderboard. If configured `live`, subsequent trusted recalculations may replace the public document automatically; `manual` requires explicit republish.
- **RECOMMENDATION:** Hiding deletes/replaces entries with an empty `hidden` snapshot. Do not leave old entries in a hidden UI branch or CSS.
- **RECOMMENDATION:** The projector has one listener for this snapshot, not one listener/query per team. Anonymous list and every client write remain denied.
- **RECOMMENDATION:** `publicTeamId` is an event-specific opaque ID. Even if enumerated, it maps only to safe public display data and is never usable to locate a registration.
- **HUMAN DECISION:** During interim ranking, decide whether teams missing the newest round are A) omitted, B) shown unranked, or C) ranked by current total with an “incomplete” marker. Recommendation: do not give an apparently comparable rank to incomplete teams.

## Finalization and ranking

### Ranking algorithms

- **CONFIRMED REQUIREMENT:** Equal total points may share a place.
- **HUMAN DECISION:** Ranking gaps are unresolved:
  - dense ranking: totals ordered `30, 20, 20, 10` produce `1, 2, 2, 3`;
  - competition ranking: the same totals produce `1, 2, 2, 4`.
- **RECOMMENDATION:** Store the selected `rankingMode` in the event before scoring begins and include it in the frozen result snapshot. Never change historical ranks by changing a global setting later.
- **RECOMMENDATION:** Equal integer `totalUnits` is the only first-version tie condition. Do not invent speed, answer-time, last-round, or hidden tie-break bonuses.

Reference algorithms:

```ts
// Input is sorted by totalUnits descending.
if (firstEntry) rank = 1;
else if (entry.totalUnits === previous.totalUnits) rank = previous.rank;
else if (rankingMode === 'dense') rank = previous.rank + 1;
else rank = currentZeroBasedIndex + 1; // competition
```

- **RECOMMENDATION:** Freeze final results at `events/{eventId}/results/current` from a complete current scoring revision. Store ordered entries, ranking mode, source revision, result revision, reveal cursor, and status. Later score correction invalidates/rebuilds results through an explicit moderator flow; it never mutates a completed public reveal silently.

### Reveal state machine

```text
PREPARED
  -> REVEALING (manual reveal lowest unrevealed rank group)
  -> WINNER_REVEALED (rank 1 group published; winner music command once)
  -> COMPLETE (explicit transition to END)
```

- **CONFIRMED REQUIREMENT:** Reveal proceeds manually from last place toward first.
- **RECOMMENDATION:** Reveal one rank group at a time, so tied teams sharing a place appear together and neither is presented as beating the other. This requires product confirmation.
- **RECOMMENDATION:** `revealNextResult(expectedResultRevision)` runs in a transaction, advances only one group, increments revision, and completely replaces `publicSessions/{sessionId}/results/current` with already revealed entries only. Unrevealed teams/ranks never reach the projector client.
- **RECOMMENDATION:** Public results order can be ascending rank for the final board while the animation event identifies the newly revealed group. Presentation order does not alter canonical ranking.
- **RECOMMENDATION:** When the rank-1 group first becomes public, the same trusted transition emits an idempotent winner music command with monotonic generation. Retries/reconnects cannot play a second command generation accidentally.
- **RECOMMENDATION:** Winner music is an allowlisted media reference resolved server-side. No arbitrary URL or browser-provided source enters the public command.
- **RECOMMENDATION:** After music, an explicit moderator command transitions to the existing END slide/mode. Automatic timing should not be guessed because media duration/browser playback can fail.
- **HUMAN DECISION:** Confirm A) reveal tied teams together or B) reveal them individually while showing the same rank. Recommendation: A.
- **HUMAN DECISION:** Confirm whether END is manual after music, automatic when playback finishes, or automatic after a configured fallback duration. Recommendation: manual, with a visible moderator control.
- **HUMAN DECISION:** If multiple teams share rank 1, confirm that winner music fires once for the whole co-winner group.

## Referee mobile workflow

1. **CONFIRMED REQUIREMENT:** Scan event QR; no admin navigation is exposed.
2. **RECOMMENDATION:** Redeem into a short-lived anonymous-auth device grant and show only event title, selected round, team names, current scores/revisions, and grant expiry.
3. **CONFIRMED REQUIREMENT:** For `KOLO 2`, enter one bounded point total per team and choose `ULOŽIT KOLO`.
4. **RECOMMENDATION:** Validate locally for quick feedback, then treat only the Function result as saved. Show per-row conflicts and unsaved state clearly.
5. **RECOMMENDATION:** Mark a round submitted only after all eligible teams have a score or explicit exception. Moderator may reopen with audit.
6. **RECOMMENDATION:** Keep answers out of the mobile scorer by default. The separately generated protected referee answer sheet satisfies answer-key needs without widening QR scope.

## Rules and Function boundary

- **RECOMMENDATION:** Firestore Rules deny all client writes to event rounds, scores, totals, audits, results, `publicSessions` children, capabilities, and grants.
- **RECOMMENDATION:** Admin/moderator may read private scoring documents under explicit claims. Referee direct reads, if used, are limited to a separately allowlisted referee view and an active same-event grant; score writes always call Functions.
- **RECOMMENDATION:** Every scoring Function independently verifies role or referee grant, event scope, lifecycle, expected revisions, bounds, and resource existence. UI route guards are convenience only.
- **RECOMMENDATION:** Public clients may get the known leaderboard/results projection only. They cannot list sessions, infer hidden results, or query private totals.

## Required verification before implementation is considered complete

- **RECOMMENDATION:** Unit tests for fixed-point formatting, bounds, dense/competition rank, tie groups, incomplete teams, withdrawal/disqualification, and deterministic ordering.
- **RECOMMENDATION:** Transaction tests for create/update, same-row concurrent conflict, different-row concurrency, idempotent retry, round lock race, total delta, and audit atomicity.
- **RECOMMENDATION:** Emulator authorization tests for anonymous, ordinary auth, wrong-event referee, expired/revoked referee, moderator, and admin; include every direct-write denial.
- **RECOMMENDATION:** Projection tests assert forbidden contact/private/reference fields are absent and unrevealed final entries never reach projector reads.
- **RECOMMENDATION:** State-machine tests verify manual last-to-first reveal, tied-group behavior after decision, one winner-music generation, retry idempotency, and explicit END transition.
- **RECOMMENDATION:** Reconciliation test rebuilds totals/leaderboard from canonical scores and detects a seeded mismatch without logging private values.

## Future digital answers

- **FUTURE:** Digital submissions are a separate private input stream, not direct score writes. A trusted evaluator creates/updates canonical round scores through the same revision/audit boundary.
- **CONFIRMED REQUIREMENT:** Submission time may validate the open window but never increase points. There is no speed bonus.
- **FUTURE:** Preserve `snapshotQuestionId`, answer-window revision, team capability, and evaluation status so paper and digital modes can coexist. Correct answers remain private until explicit recap reveal.
