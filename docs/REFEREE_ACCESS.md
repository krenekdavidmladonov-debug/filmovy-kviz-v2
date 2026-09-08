# Referee access to one event

## Authority and data boundary

An existing current `admin` manages event access. The current application grants admins management of all events; it has no event ownership ACL. `moderator` remains unable to issue, list, rotate or revoke grants. The server checks both the caller token and the current Auth user/role. No global referee role or Auth account is created, and RequireStaff is unchanged.

`events/{eventId}/refereeAccess/{accessId}` is server-only under the existing default-deny Rules. Only management callables return its safe label, expiry, version and status. A 256-bit server-generated key is returned once on issue/rotation. Only a purpose-separated SHA-256 verifier is persisted. QR generation uses the already bundled qrcode library locally; no external QR service receives the link. A label identifies the capability, not a verified person.

The named callable boundary consists of `listRefereeAccess`, `issueRefereeAccess`, `changeRefereeAccess`, `readRefereeEvent`, `readRefereeHistory`, and `saveRefereeScore`. Referee requests authenticate their explicit event/access/key tuple, independently of any staff session. They cannot authenticate staff operations. No grant confers Firestore read or write access.

Read results allowlist event title, access label, snapshot identifier, round identifiers/titles, accepted team identifiers/names and current score values/revisions. No contacts, registration tokens, questions, answers, private snapshot bodies, staff UIDs or score operation documents are returned. History allows only values, revision, time, reason and an actor label; historical staff entries are labelled “Pořadatel”. The latest 100 history entries are returned. Public registration projections and contracts are unchanged.

## Delivery, reload and revocation

Private links use `/referee/{eventId}#access=…&key=…`. The fragment is never part of the initial HTTP request or Referer. The page removes it with history.replaceState before its protected requests and stores the credential in per-tab sessionStorage. Reload reuses the credential. Ending this access removes only that tab's referee entry; it never signs out Firebase Auth, so an admin in another tab stays signed in. There is no derived Firebase token or separate server session: every use of the retained key is freshly authorized. A browser duplicating a tab may copy sessionStorage; both copies remain subject to the same server revocation.

This is a bearer capability. Its holder may share it. Fragment removal does not defend against same-origin script compromise, browser extensions, clipboard leaks, a downloaded QR or history/sync capture before removal. sessionStorage retains the key while the tab/session survives, and is not an offline data cache. No secret is put in analytics or application logs. Callables transmit it over HTTPS in the request body. The deployment's request-body logging must not be enabled. Tests do not emit keys or retain QR/trace artifacts.

Expiry is server-clock based (default UI 24 hours, server maximum 30 days). Referee reads/writes are allowed only for ready/live/finalizing events; cancellation/archival denies work. Each read and score transaction reads the grant and event again, including idempotent receipts. Revocation/rotation writes that same grant document. Firestore transaction conflicts serialize a competing score save: a save may commit before revocation; after confirmed revocation any subsequently started old-key request fails. Rotation replaces the verifier and increments the version, invalidating every old tab without waiting for a Firebase token to expire. Already delivered information cannot be recalled.

The UI refreshes its minimal view every five seconds, disables work on an unverified view, and shows “Přístup vypršel / byl odebrán” on denial. Draft input remains distinguishable from acknowledged scores. Revocation is enforced by the next request immediately, regardless of this display refresh interval.

## Shared scoring and uncertain responses

Staff and referee share `scoring/core.ts`; there is one scores collection, revision check, half-point validation, operation receipt and atomic history. Existing staff operation IDs and actorUid history remain compatible. Referee audit stores stable actorAccessId and the server-owned label, never the issuing admin's identity as the scoring actor. The read authorization hook executes before operation-receipt replay. Existing scores/history are not migrated.

Issuance uses a client requestId mapped to one deterministic grant ID. A retry with the same body returns safe metadata and key:null; the unrecoverable key requires explicit rotation. The UI retains an uncertain issuance request instead of silently creating another. Each event supports at most 50 named grants, including revoked ones; reuse/rotate a named access. Rotation/revocation uses expectedVersion, so retrying an uncertain rotation cannot silently issue another key. Refresh the list and explicitly rotate after reviewing its warning. Score retries reuse the existing per-row requestId and shared idempotent receipt.

## Abuse controls and deployment dependencies

The referee entry callables validate bounded credential shapes and use a per-observed-IP fixed-window limiter (180 protected requests/minute). It stores only a purpose-separated IP digest and count/window in server-only `refereeRateLimits`. This bounds database work for repeated attempts from one observed address; shared NAT users share the limit, distributed abuse and upstream proxy/IP configuration remain limitations. There is no new App Check exemption or disabled Auth/Rules. High-entropy keys, uniform invalid/expired/revoked errors and timing-safe verifier comparison supplement this bounded limiter. Function maxInstances is 10. Limiter records have one fixed document per observed address, not per request; future operational retention should remove old counters by policy, not this feature or a migration.

Future authorized deployment requires the six listed referee callables, updated `saveEventScore` (shared audit support), and frontend Hosting. No Rules or index change is needed: grants/limiter remain default-denied, all queries use existing single-field indexes. Never run a deployment as part of feature CI. Existing workflows are emulator-only and contain no push/PR-triggered deploy.

## Verification

`tests/e2e/referee-access-emulator.mjs` exercises actual Auth/Functions/Firestore emulator contracts, grant lifecycle, authority, payload allowlists, conflicting actors, idempotent receipts, revoke/save races, public registration and direct-client denial. Rules tests explicitly cover grant and limiter paths and a forged referee claim. The browser scenario in `tests/browser/referee-access.spec.ts` issues and decodes a private QR, uses an isolated browser, saves/corrects half-points, tests admin/referee conflict, reload, unchanged staff sign-in and open-tab revocation. CI runs both in the added “Referee access contracts and browser E2E” step with demo emulators, no secrets or cloud access.
