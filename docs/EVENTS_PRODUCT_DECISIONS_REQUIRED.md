# Events and scoring — product decisions required

Status: **DISCOVERY QUESTIONS (2026-09-02)**. Every numbered question below is a **HUMAN DECISION**; priorities indicate when an explicit answer is needed.

The options below are intentionally concrete. Recommended choices are architecture guidance, not silently confirmed product behavior.

## P0 — required before the first implementation slice

1. **Capacity behavior:** At the team limit, should registration A) stop accepting submissions, or B) start a waitlist? **Recommendation:** B, with a visible `waitlist` public state.
2. **Capacity unit:** Is event capacity A) number of teams only, or B) both teams and total people? **Current requirement supports A**, but the venue may need B.
3. **Approval mode:** Are registrations A) accepted automatically while capacity remains, or B) always pending staff approval? **Recommendation:** configurable per event; start with A as default.
4. **Pending capacity:** If manual approval is used, does a pending registration A) reserve a slot, or B) consume capacity only on approval? **Recommendation:** B.
5. **Duplicate policy:** May one email register A) only one team per event, or B) multiple differently named teams? Also, is duplicate team name A) blocked, B) warned for staff review, or C) allowed? **Recommendation:** multiple teams per contact only if explicitly needed; team-name duplicates go to review rather than public error detail.
6. **Required contacts:** Is telephone A) mandatory or B) optional? Is email verification A) required before acceptance or B) confirmation-only? **Recommendation:** phone policy is a business decision; start with confirmation email but do not block the last capacity slot on an unreliable verification race without a reservation policy.
7. **Quiz lock:** After an event is `ready`, can an admin A) create a replacement quiz snapshot and invalidate artifacts, or B) never unlock after referee access/scoring starts? **Recommendation:** A before scoring; B after the first score.
8. **Score precision:** Are scores A) integers only, B) half-points, or C) another fixed increment? **Recommendation:** choose a fixed event-level scale before scoring and store integer units.
9. **Round scoring:** Does the referee enter A) one total per team/round, or B) points per question? **Current required UI supports A**; B should be deferred unless audit/product needs it.
10. **Interim incomplete teams:** If some teams lack the newest round, should they A) be omitted, B) appear unranked, or C) be ranked by current total with a warning? **Recommendation:** B.
11. **Moderator contact access:** Do moderators A) need registration email/phone for check-in and organization, or B) only need team names/status with contacts restricted to admin? **Recommendation:** grant only the minimum actual operating need.
12. **Self-service window:** Until when may a team edit/cancel, and which of team name/member count/contact changes require staff review after acceptance?

## P0 — required before referee/results implementation

1. **Referee QR sharing control:** Choose A) one active device per QR, B) several devices up to a limit, or C) one device plus a short staff PIN. **Recommendation:** C for production; A for the simplest first emulator slice.
2. **Referee access duration:** Does access expire A) at scheduled event end, B) when moderator closes scoring, or C) after a short post-event correction window? **Recommendation:** the earliest of explicit revoke and configured end + correction window.
3. **Referee corrections:** Can a referee correct A) any open/submitted round, B) only open rounds, or C) submitted rounds with a required reason? **Recommendation:** C; locked/final scores require moderator/admin.
4. **Tie ranking gaps:** Equal totals must use A) dense ranks `1, 2, 2, 3`, or B) competition ranks `1, 2, 2, 4`? **NEEDS HUMAN DECISION.**
5. **Tie reveal:** Teams sharing a rank are A) revealed together, or B) revealed individually with the same displayed rank? **Recommendation:** A.
6. **Co-winners:** When several teams share rank 1, should winner music A) play once for the group, or B) once per team? **Recommendation:** A.
7. **END transition:** After winner music, should END be A) moderator-triggered, B) triggered by confirmed media completion, or C) triggered after a configured timeout? **Recommendation:** A, because playback can fail and event pacing is human-controlled.
8. **Final correction:** If a score changes after results are prepared or partially revealed, should the system A) invalidate and restart the entire reveal, or B) permit an in-place corrected result with an explicit notice? **Recommendation:** A before completion; post-event corrections need an auditable published-results policy.

## P1 — required before production

1. **Registration retention:** How long are contact person, email, phone, note, consent evidence, and cancellation token retained after the event? Specify deletion/anonymization periods, not “as needed.”
2. **Public capacity:** Should `publicEvents` show A) only `open/few_left/full/waitlist`, or B) the exact number of free team slots? **Recommendation:** A.
3. **Waitlist promotion:** On cancellation, A) automatically promote the oldest eligible team and email it, or B) require staff confirmation? **Recommendation:** B for the first release; automate after operating rules are proven.
4. **Email identity:** Select provider, verified sender domain/address, reply-to identity, Czech template copy, delivery retry window, and whether bulk campaigns need approval/preview.
5. **Email consent:** Separate transactional event messages from optional marketing. Confirm legal basis/copy and whether organizational bulk messages are strictly event-service communications.
6. **Generated PDF format:** Confirm A4, margins, font/branding, questions per page, one sheet per team or generic copies, duplex behavior, and master referee sheet versus per-round sheets.
7. **Artifact retention:** Are generated sheets A) ephemeral downloads, B) retained privately until event completion, or C) retained longer? **Recommendation:** B with automatic expiry; answer-key PDFs shortest possible.
8. **Leaderboard publication:** Per event choose A) always manual, B) auto-update while visible, or C) always live after scoring starts. **Recommendation:** B: moderator publishes once, trusted updates continue until hidden.
9. **Eligible teams:** Define final handling for withdrawn, no-show, and disqualified teams and whether they appear in archived/public results.
10. **Operational incident controls:** Name who may pause registration, revoke referee access, cancel an email campaign, and withdraw an accidentally published leaderboard/result during an event.
11. **Referee answer access:** Does the QR view A) never show answers (paper/master PDF only), or B) receive a separately scoped answer-key mode? **Recommendation:** A.
12. **Privacy export/deletion:** Define the process for a team's access/correction/deletion request without weakening immutable scoring audit beyond legal requirements.

## P2 — may be decided later

1. **Digital answer mode:** Which rounds may be `paper`, `digital`, or `hybrid`, and how is a digital submission converted to a manual round total? **Confirmed constraint:** no speed bonus.
2. **Team digital access:** QR/team code per event, per team, or per player? How are shared screenshots/revocation handled?
3. **Multi-venue events:** Can one event have rooms/heats and independent capacities, or should those be separate events sharing one quiz snapshot?
4. **Advanced scoring:** Are negative points, bonus questions, discarded rounds, penalties, or manual tie-break questions ever needed? Do not add them speculatively.
5. **Public archive:** Should completed events expose a permanent sanitized results page, an expiring link, or no public archive?
6. **Exports:** Which formats are required after an event (CSV/XLSX/PDF), and should contact exports be separate, permissioned, and time-limited?
7. **Localization:** Is Czech the only initial locale, and must event/email/PDF templates later support multiple locales per event?
8. **Offline scoring:** Is a best-effort local unsaved draft sufficient, or is fully offline authoritative scoring a future requirement? The recommended first release requires an online save acknowledgement.

## Recommended decision meeting order

1. Resolve P0 registration/capacity/quiz-lock questions.
2. Confirm score scale and one-total-per-round model.
3. Resolve referee device policy and ranking/reveal semantics.
4. Approve retention, contact access, and incident owners before production design review.
5. Choose provider/PDF presentation details only after the server boundaries and emulator tests exist.
