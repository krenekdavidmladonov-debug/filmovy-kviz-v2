# Media architecture

## Guarantees

Media control is explicit and revisioned. Navigation resets media to `idle` and advances `mediaGeneration`; every play, stop, replay, finish, or recap selection advances it again. Client callbacks carry their generation and stale callbacks are ignored before any trusted mutation.

The local player lifecycle is:

```text
IDLE → PREPARING → READY → PLAYING → STOPPING → READY
                              └──────→ FINISHED
                 any state ─────────→ ERROR
```

Only one heavy player may exist in a projector window. No previous-slide players, hidden players, background players, timers, or subscriptions survive React cleanup. No next-slide player is preloaded in this foundation. Development diagnostics are available at `window.__FILMOVY_KVIZ_MEDIA_DEBUG__` and fail when a projector exceeds the one-player budget.

Normalized slide fields are `mediaSource`, `clipStartSeconds`, and optional `clipEndSeconds`. Legacy `videoStart` / `videoEnd` remain preserved in `presentation` and private raw data; compatibility mapping uses them only when normalized fields are absent. Internally timing is finite non-negative seconds. An end is used only when it is strictly greater than start.

## AUDIO

In ordinary question mode, the public projector payload omits the audio source and the renderer cannot mount a YouTube iframe. The projector shows question copy and a vinyl state driven by the sanitized media command. The moderator laptop mounts the visible, controlled YouTube player, so system audio comes from that device. PLAY loads the configured segment, STOP pauses and returns to its start, REPLAY loads it again from the configured start, and finish leaves the question visible.

## VIDEO

Before play, the question is visible and no player is mounted. PLAY or REPLAY mounts one 16:9 projector player and hides the question. STOP, finish, navigation, or error returns to the stable question. There is no automatic answer reveal or navigation.

## RECAP

Recap AUDIO/VIDEO has one visible player on the projector. Moderator PLAY/STOP/REPLAY commands are remote, the player never autoplays, starts at 0:00, and deliberately ignores question clip start/end. The visible standard YouTube controls on the projector provide pause, seek, current time, and duration without mounting a competing moderator player. Mirroring that timeline back into the moderator window is a future same-device enhancement, not a guarantee of this foundation.

## YouTube limitations

YouTube behavior is **BEST EFFORT**, not a spoiler-free guarantee. The implementation uses the documented IFrame API and does not obscure, background, or extract audio from a player. YouTube may display title, thumbnail, channel, branding, ads, errors, region/age restrictions, and controls; requested start can resolve to a nearby keyframe. A browser can also block scripted playback. See the official [IFrame Player API](https://developers.google.com/youtube/iframe_api_reference), [player parameters](https://developers.google.com/youtube/player_parameters), [required minimum functionality](https://developers.google.com/youtube/terms/required-minimum-functionality), and [developer policies](https://developers.google.com/youtube/terms/developer-policies).

Owned/direct media is a future source adapter. It is not silently treated as YouTube and no media is uploaded or copied by this foundation.
