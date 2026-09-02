# Local event-night operation

This profile is a fail-closed, production-build local pilot. It uses only `demo-filmovy-kviz-v2` and loopback Firebase emulators. It never deploys and never seeds during normal start.

## One-time preparation

Run `PREPARE_EVENT_NIGHT.cmd` once from a clean release commit. It:

1. verifies Node 22, Java 21, pnpm, Git, and demo-only environment values;
2. selects the lowest-blocker migrated quiz without printing private values;
3. creates a production build tied to the exact Git HEAD and records file SHA-256 hashes;
4. starts fresh local emulators, seeds only the demo admin, migrates the four offline V1 quizzes, and performs independent read-back;
5. runs candidate login/readiness health through the Hosting Emulator;
6. exports a checksummed snapshot under `.local-data/event-night/emulator-data/` and stops its own worker.

It refuses to overwrite an existing snapshot. A reset is intentionally not exposed as an event operator command.

## Event use

- `START_EVENT_NIGHT.cmd` validates the build, HEAD, candidate, snapshot, checksums, and ports; creates a timestamped backup; imports the snapshot; runs browser health; and opens `http://localhost:5000/admin/login`.
- `BACKUP_EVENT_NIGHT.cmd` performs a live emulator export and atomically promotes it only after checksum validation. The prior snapshot is retained in `.local-data/event-night/backups/`.
- `STOP_EVENT_NIGHT.cmd` updates health, exports and validates current data, retains the previous known-good snapshot, then terminates only the identity-checked worker it owns.

After an unclean shutdown, the last successfully promoted snapshot remains unchanged. The next start validates and imports that snapshot; it never replaces it with an empty seed. Work performed after the most recent successful checkpoint may need to be repeated.

Keep the laptop awake and plugged in. Do not run development launchers on the same ports. Internet is still required for public YouTube playback, but the core application, local data, and launch flow do not depend on GitHub, Codex, or production Firebase during the event.
