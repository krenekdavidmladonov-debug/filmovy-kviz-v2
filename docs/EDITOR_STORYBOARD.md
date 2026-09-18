# Editor storyboard and movement

The editor offers an editing view and a storyboard of the actual slide stream, sorted by position. It preserves system slides, recaps and legacy content instead of reconstructing a different running order. The shared in-memory working copy feeds card captions and previews; pending changes and draft questions are labelled. Selecting a card opens the existing form. Missing system sections remain available through the original structure, not invented as slides in the storyboard.

Previews mount only near the viewport. They receive no answer content, media players or audio/video source; image assets use the existing private editor renderer. This is a private editor view, not a public projection.

Questions can be moved before another question, to a round end, or with the visible up/down and round-selection controls. The drag handle also accepts arrow keys. Unsaved content, uploads, in-flight writes and read-only access disable structural changes. A completed move announces success and restores focus to the moved card.

Movement reuses the existing authorized revision-checked operations. A move across rounds appends once, then adjacent moves reach the requested position. Each step uses the acknowledged revision; a failed step aborts the sequence and reloads the persisted order. This is not an atomic multi-step move. Long-distance moves require more calls and can be partly applied on interruption. No background retries or optimistic order are used. Server-derived numbers/recaps continue to use existing behavior; event snapshots, collections and authorization boundaries are unchanged.

Validation includes shared draft navigation, persisted order, mobile overflow, real mouse drag between visible cards, keyboard activation, cross-round numbering/recaps, partial failure/recovery and a 180-question viewport preview check. Native drag scrolling across off-screen targets and touch drag are not claimed by these tests; the explicit round selector and buttons remain usable alternatives.

Local final validation: pnpm check passed; 445 unit and 50 rules tests; 9 save/storyboard browser cases; 2 seeded editor core cases; 2 complete editor cases; 1 performance scenario (60/180 questions); 3 dark-theme/accessibility scenarios. Existing draft/role/revision/live/snapshot boundary script passed. One initial seeded core run timed out awaiting a save response; a fresh repeat passed, so this is retained as an unresolved intermittent observation rather than called a proven fix.
