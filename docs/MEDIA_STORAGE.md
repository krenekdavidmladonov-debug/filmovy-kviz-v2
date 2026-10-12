# Owned media foundation

This package adds image/audio assets to the existing quiz editor and player contract. It does not deploy or migrate anything. Legacy HTTP images and YouTube audio/video remain compatible; video uploads remain out of scope. Media authoring adds independent answer/background image roles through this same protocol.

## Data and immutable ownership

The reserved value quiz-asset:<quizId>/<sha256 assetId> occupies existing string fields: IMAGE questionImage, AUDIO mediaSource, or image answerImage/backgroundImage. No signed URL, access token, local Blob URL or file bytes are persisted in a slide/publication. The server derives assetId from quiz/admin/request ID. The private document at quizzes/{quizId}/mediaAssets/{assetId} records quizId, assetId, kind, contentType, size, createdBy, createdAt, uploadExpiresAt, fingerprint and status. Finalization adds readyAt and the immutable Storage object generation.

Files use quiz-assets/{quizId}/{assetId}/source. Once created they cannot be overwritten or deleted by clients. Existing event locking copies the reference into the immutable snapshot; subsequent library edits choose a new reference. Metadata and object are retained even if the library question stops using them. There is no automatic physical cleanup, orphan sweep or bucket lifecycle rule. Retention/cleanup is a future decision requiring snapshot-aware reference analysis.

## Upload boundary

1. beginQuizMediaUpload requires an admin token plus a fresh, enabled admin account and an existing quiz. It creates a 30-minute upload grant for one exact actor, path, MIME and size; request-ID reuse with different declared metadata is rejected.
2. Storage Rules permit only create under that grant, with matching admin identity, quiz, expiry, size and supported MIME. They deny all direct get/list/update/delete, including staff.
3. finalizeQuizMediaUpload checks the fresh admin, actual object size and content type, and a matching file signature from its first 4096 bytes. It removes Firebase download tokens and records the object's generation.
4. Editor create/update and event locking verify every owned reference is ready, belongs to that quiz and has the correct kind. Conflicting roles, arbitrary paths and use in unsupported fields are rejected.

Supported images: PNG/JPEG/WebP, at most 10 MiB. Audio: MP3/WAV, at most 25 MiB. SVG, HTML and video uploads are rejected. Signature checks detect a simple mislabeled file; they are not full codec decoding, malware scanning or a guarantee that every browser can decode a corrupt file. Unsupported/corrupt media fails visibly in the player. No transcoding service is introduced.

The editor prevents save, keyboard save, selection and structural mutations while upload is pending. After successful preparation it updates the local draft; explicit Save commits the binding. Abandoning a draft never physically deletes its uploaded object.

## Reads and reveal

readQuizMedia serves only GET, with nosniff/no-store and bounded single-byte Range support. Staff reads require a verified token and a fresh enabled admin/moderator role. A public request includes sessionId; the server authorizes the exact reference against the current active publicSessions projection and checks its actual asset kind. It repeats that authorization after Storage IO. An unrelated reveal revision does not revoke a still-visible image; navigation, results presentation and session ending do.

Ordinary AUDIO is absent from the public payload and cannot be downloaded through the public endpoint. The moderator device fetches it with staff authentication. A specifically selected recap exposes that audio to the existing public projector. No public client lists Storage or reads private quiz metadata. A displayed public asset can of course be copied by a viewer; this is reveal timing/access control, not DRM.

The gateway reads a pinned object generation. Clients create in-memory Blob URLs, abort pending reads and revoke URLs on replacement/unmount. No durable media cache or bearer download URL is added. Network loss retains the existing projector disconnect behavior.

## Player and UI compatibility

MediaPlayer selects the existing YouTube adapter or a native audio/video adapter, sharing the existing command/generation, reducer, callbacks and single-player budget. IMAGE uses the existing separate question/image contain layout with black bars. AUDIO remains manual: idle does not play; START/END apply to the ordinary question, STOP releases the prior player, REPLAY creates a new generation. Native pause reports ready and native resume reports playing for that same generation; stale and terminal callbacks remain rejected. Recap uses the existing playback plan from 0:00 without the ordinary END limit. Browser autoplay restrictions report an error and require a manual retry.

## Offline verification

Use only a demo-* project and local Auth/Firestore/Functions/Storage emulators. Any emulator signal requires an explicit localhost Storage endpoint; a missing Storage emulator cannot fall through to a configured cloud bucket. Test fixtures guard this before SDK initialization or synthetic writes.

- pnpm check
- focused media/model/player/legacy tests through pnpm test:unit
- pnpm test:rules
- firebase emulators:exec --only auth,firestore,functions,storage --project demo-filmovy-kviz-v2 "pnpm test:e2e:media && pnpm test:e2e:media-browser"

CI includes these Storage contracts and a synthetic browser upload/editor/projector flow. Existing browser groups remain enabled. The tests do not require cloud Storage, a Gmail account or real credentials.

## Later authorized staging work

No staging configuration was changed. A separate approved deployment must select the exact reviewed SHA and V2 staging bucket, verify default bucket configuration and private bucket IAM, deploy the three endpoints and versioned Storage Rules, then test the cross-service Firestore Rules dependency and browser CORS in that environment. Review the documented Storage Rules service permission before any permission changes. Confirm tokenless reads, public reveal timing, immutable snapshots, bounded object sizes and HTTP response limits/cost at expected audience volume. No public bucket permission is required. No cleanup/lifecycle policy should be enabled implicitly.

References: [Storage Rules conditions and Firestore lookups](https://firebase.google.com/docs/storage/security/rules-conditions), [Storage emulator connections and limitations](https://firebase.google.com/docs/emulator-suite/connect_storage).

## Authoring extension

MediaUploadField is the single picker for upload, validated HTTP(S) link and ready assets of the current quiz. Images have separate question, answer and background roles; only background uses cover. Direct audio supports mp3/wav/ogg/m4a; video supports mp4/webm/ogv links, plus the existing YouTube parser. Codec/server availability is checked by the actual browser player. The ready-asset library displays up to 200 records; it is not a cross-quiz search.

A changed source clears START/END and requires a new valid interval. The unchanged imported 0/0 exception from PR #26 remains intact. Equal mapped media fields preserve their original representation; a changed empty string explicitly detaches a role and shadows legacy fallback without deleting its history. An upload cancellation invalidates late completions, and question selection/save are blocked during transfer. Grants/finalization time out after 30 seconds, transfer after two minutes, media reads after 15 seconds. Error/retry retains the draft.

See [MEDIA_AUTHORING_RELEASE.md](MEDIA_AUTHORING_RELEASE.md) for provenance, tests, rollout scope and component rollback. No cloud operation is performed by the build script.
