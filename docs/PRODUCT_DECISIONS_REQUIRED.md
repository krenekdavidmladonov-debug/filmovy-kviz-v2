# Product decisions required before final quiz rendering

This is a decision queue, not a design proposal. Questions are based on `QUIZ_BEHAVIOR_SPEC_DRAFT.md` and are intentionally concrete.

Priority meanings:

- **P0** — required before implementing the final renderer/state machine.
- **P1** — required before the editor can faithfully author the behavior.
- **P2** — can be deferred without corrupting migrated data.

## Top 10 decisions to make first

1. **P0 · AUDIO source policy:** For the 27 AUDIO slides backed by YouTube, choose: A) show a compliant visible YouTube player to the audience, B) replace/migrate them to licensed direct audio, or C) mark them unsupported until assets are supplied. A hidden/audio-only YouTube iframe is not an acceptable option under current policies.
2. **P0 · IMAGE composition:** For `type=image` + `mediaRaw`, confirm whether the main image is always a full projector background. If yes, choose fit: A) cover/crop, B) contain with bars, or C) per-slide setting.
3. **P0 · VIDEO composition:** During playback, choose: A) visible standard YouTube player, B) visible reduced-controls player, or C) no YouTube playback until owned video exists. Absence of title/thumbnail/branding cannot be guaranteed.
4. **P0 · Media end transition:** At `videoEnd` on AUDIO/VIDEO choose: A) remain on the stopped player/frame, B) return to the static prompt, C) show a finished state, or D) automatically advance. Automatic answer reveal must be a separate explicit choice.
5. **P0 · Zero timing semantics:** Confirm whether `start=0,end>0` means “play from the beginning to end” and `start=0,end=0` means “no bounded segment”.
6. **P0 · `audioTrigger`:** The sole positive value is 35. Choose only after human V1 knowledge confirms whether it means A) delayed autoplay, B) cue point, C) reveal/play trigger, or D) obsolete legacy data.
7. **P0 · Background overlays:** Confirm whether 20–80 means overlay opacity percent, image opacity percent, or another scale; also define overlay color and whether text is above it.
8. **P0 · RECAP overrides:** Define how the five override slots align to questions and what `extraText` and `overrideMedia` do. Until decided, the override recap cannot be faithfully rendered.
9. **P0 · PL meaning:** Name the `pl` type, describe its projector behavior, and confirm whether its private text answer is revealable like an ordinary question.
10. **P0 · Authored END vs session end:** Choose whether the authored END slide is the final visible state, whether `end-session` follows it, and whether the hard-coded “quiz ended” screen remains.

## Cross-cutting decisions

### P0

1. When a slide has no configured media source (25 AUDIO, 22 VIDEO, 18 IMAGE), should live control: A) allow text-only presentation with warning, B) block starting the slide, or C) skip it only after moderator confirmation?
2. Is media playback always initiated by an explicit moderator action, or may navigation to a slide initiate playback? If autoplay is requested, what is the fallback after `onAutoplayBlocked`?
3. Can media finish automatically navigate or reveal, or must navigation and reveal always remain explicit moderator actions?
4. Is `answerRevealed` independent of media state, or is reveal disabled until the segment finishes?
5. For all `background` media, define fit (`cover`/`contain`), focal position, overlay color, opacity direction, and safe text area.
6. When external media fails, choose the projector fallback: A) text-only slide, B) neutral unavailable card, or C) keep previous safe slide while moderator resolves it.
7. Must all external assets be preflighted before a live session, and does one failed asset block session start?
8. Confirm the maximum number of active heavy players: proposed invariant is one per projector. Are moderator preview players allowed simultaneously on a different device?
9. Define whether the READY/PLAYING/FINISHED states are public Firestore state controlled by the moderator or local technical state derived by the projector.
10. Decide if projector refresh/reconnect resumes media, returns to READY, or stays paused. Automatic resumption with sound may be browser-blocked.

### P1

1. Should timing accept seconds only, or should the editor also accept `mm:ss` and store normalized seconds?
2. Should `videoEnd` be mandatory when a media source is present? The migrated dataset contains media sources without positive bounds.
3. Should source URL and legacy YouTube ID be edited as one canonical video reference, with the ID derived automatically?
4. Define validation for provider/type mismatch, especially the three IMAGE slides whose URL provider is YouTube.
5. Should the editor display a preflight result (reachable, embeddable, duration covers range) without mutating source data?
6. Are moderator notes available in live control? If yes, must they be visually separated from any public data to prevent accidental projection?
7. `optionsStr` differs from `options` on all 21 meaningful occurrences. Should it become a named native field, stay legacy-only, or be reviewed per slide before conversion?
8. Should persistent Firestore cache ever be enabled for private admin data? If yes, define trusted-device consent, cache clearing on sign-out, and stale-data handling.

### P2

1. Define media preload distance (none, next slide only, or configurable) after lifecycle correctness is proven.
2. Define accessible reduced-motion and audio descriptions/captions requirements.
3. Define analytics/diagnostics retention without logging question, answer, note, or source URL.
4. Define future owned-media ingestion, checksums, transcoding, and cache eviction.

## TYPE: AUDIO

### P0

1. For YouTube-backed AUDIO, choose visible compliant YouTube, replacement direct audio, or unsupported status.
2. Before playback should the projector show: A) full question, B) neutral audio-ready card, or C) both question and visible player?
3. Who starts playback: A) moderator with a dedicated Play action, B) navigation with autoplay attempt, or C) audience-facing player control?
4. At segment end should it: A) stay on audio/player state, B) return to question, C) show “audio finished”, or D) advance?
5. Is replay allowed before reveal, after reveal, both, or never?
6. What does positive `audioTrigger=35` mean? Do not map it until human V1 behavior identifies it.
7. What should happen on the 25 AUDIO slides with no source?

### P1

1. Should start/end be mandatory and should duration be shown in editor/live control?
2. Should moderator see the YouTube title/thumbnail even if a future owned audio source is audience-facing?
3. Does note contain spoken moderator instructions that must appear in live control?

### P2

1. Choose any audio visualization only after the compliant source policy is decided.
2. Decide whether volume is global session state or local device state.

## TYPE: VIDEO

### P0

1. Choose player visibility/control level while accepting mandatory YouTube UI/branding behavior.
2. Should initial state show prompt, thumbnail/player, or a moderator-controlled ready card?
3. At end choose stopped frame, prompt, finished card, or advance.
4. If the requested start lands on an earlier keyframe, is that acceptable or must owned edited clips replace YouTube segments?
5. What should happen on the 22 VIDEO slides with no source?
6. How should ads, embed-disabled, removed, age-restricted, or region-restricted videos affect live flow?

### P1

1. Should the editor test embeddability and range against current duration?
2. Should the three VIDEO multiple-choice variants display options before, during, or after playback?
3. May the moderator seek outside the configured segment? Doing so invalidates API `endSeconds` behavior.

### P2

1. Define captions/default language and full-screen policy.

## TYPE: IMAGE

### P0

1. Confirm the human input that `mediaRaw` is a background for every IMAGE slide.
2. Choose cover, contain, or per-slide fit; if cover, define whether focal position is needed.
3. Decide whether question text overlays the image or appears in a separate region.
4. Decide how to treat the three YouTube-provider URLs: valid image-like content, bad legacy data requiring replacement, or another media behavior.
5. What should happen on 18 IMAGE slides with no source?

### P1

1. Should the editor relabel migrated IMAGE `prompt` media to a dedicated “main/background image” role after human confirmation?
2. Must image dimensions/aspect ratio be preflighted?

### P2

1. Define alt text and accessibility authoring.

## TYPE: QUESTION

### P0

1. Confirm background overlay meaning and composition for 19 background variants.
2. For the one answer image, should reveal show: A) text then image, B) image only, C) both side-by-side, or D) staged reveal?
3. Should answer image replace, overlay, or sit beside the question background?
4. Do the 10 no-options QUESTION slides behave exactly like FREE, or remain a distinct scored type?

### P1

1. What does differing `optionsStr` represent on 18 QUESTION slides, and must it be editable/rendered?
2. Are option labels fixed A–D, numeric, hidden, or derived from order?
3. Can question option counts be arbitrary? Real data proves 4, but the model supports general arrays.
4. Define scoring for option questions versus open questions.

### P2

1. Decide whether options remain visible after reveal.

## TYPE: FREE

### P0

1. Does FREE differ behaviorally/scoring-wise from QUESTION-without-options?
2. Confirm background overlay composition on the 13 background variants.
3. Are READY/PLAYING/FINISHED irrelevant for FREE and collapsed into one visible state?

### P1

1. Must the one missing moderator note be flagged or accepted?
2. Define scoring and answer normalization; no automatic matching behavior is implied by current data.

### P2

1. Decide whether long free answers require alternate reveal typography after content review.

## TYPE: INTRO

### P0

1. Is each INTRO a quiz intro, a round intro, or can it be either based on `roundHeader`?
2. Does entering INTRO change live round state or only display content?
3. Should reveal controls be disabled because INTRO has no answer?
4. Confirm background composition for five variants.

### P1

1. What is the one non-empty `optionsStr` on INTRO when all four array options are empty?
2. May admins create/move/delete INTRO freely, or must round structure constrain it?

### P2

1. Animation/transition style is deliberately deferred.

## TYPE: AGENDA

### P0

1. Are agenda items plain display text or navigable round shortcuts?
2. Should reveal be unavailable?
3. Are 5/6 items arbitrary list length or derived from round count?

### P1

1. What is the differing `optionsStr` on one AGENDA?
2. Should agenda items be regenerated when rounds change or remain authored source data?

### P2

1. Numbering, columns, and visual hierarchy are deferred.

## TYPE: RECAP

### P0

1. Is RECAP generated from prior questions/answers, or is it a standalone authored slide?
2. How do five `recapOverrides` entries align to questions: index, source question number, or another key?
3. Does `extraText` supplement question text, answer text, or moderator copy?
4. Is `overrideMedia` prompt, answer, background, or replacement for another source?
5. Are empty override objects meaningful placeholders preserving alignment?
6. Is recap content already “revealed”, or does it require per-item/global reveal?

### P1

1. Should recap be edited as raw aligned entries, generated preview, or both?
2. What happens when source questions are moved/deleted?

### P2

1. Recap paging/animation is deferred.

## TYPE: END

### P0

1. Is authored END shown before or instead of the system `ended` screen?
2. Does navigating to END automatically end the session, or is ending always a separate moderator action?
3. After session end, can the moderator return to END/previous slides?
4. Should reveal be unavailable?

### P1

1. Must exactly one END exist and be last, or are multiple/no END slides valid?

### P2

1. Closing animation and event links are deferred.

## TYPE: PL

### P0

1. What does `pl` stand for in the original product?
2. Is it functionally a FREE question, picture/location/person question, or a distinct mechanic?
3. Are its six `bgImage` values projector backgrounds with overlay 70/75?
4. Is the private `correct` text the complete revealable answer?
5. Does it have unique scoring, timing, or moderator instructions not encoded in observed fields?

### P1

1. After meaning is confirmed, should existing PL slides remain legacy, convert to a native type automatically, or require per-slide review?
2. Which fields should become editable versus remain locked raw history?

### P2

1. Final user-facing name/icon is deferred until semantics are known.

## Recommended human review order

1. AUDIO — source policy is both a product and YouTube compliance blocker.
2. VIDEO — establishes the shared timed-player lifecycle.
3. IMAGE — resolves background semantics used by multiple types.
4. QUESTION — resolves options, backgrounds, and answer image reveal.
5. FREE — clarifies relationship to open QUESTION.
6. INTRO — defines round transitions.
7. RECAP — defines the only structured override mechanism.
8. AGENDA — depends on settled round structure.
9. END — settles authored versus system terminal state.
10. PL — review with someone who knows the original mechanic; preserve as legacy until then.
