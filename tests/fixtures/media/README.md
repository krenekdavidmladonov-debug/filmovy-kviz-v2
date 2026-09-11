# Synthetic media fixture

synthetic.webm is a five-second, silent VP9 test pattern generated locally; it contains no user or third-party footage. Used to verify real native browser video decoding/playback without an external host.

Regenerate with FFmpeg:

```
ffmpeg -f lavfi -i testsrc2=size=384x216:rate=15 -t 5 -c:v libvpx-vp9 -b:v 120k -an synthetic.webm
```

PNG and WAV fixtures are generated in tests/e2e/media-fixture.mjs. No cloud upload is used by these tests.
