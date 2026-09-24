# Drill narration audio

Pre-generated, drill-length voice narration for the 54 drills (19 stickhandling,
19 shooting, 16 dryland). Each clip is timed to run the length of the drill so
"And done!" lands as the timer hits zero. Clips are static MP3s served from
`audio/<voiceCode>/<slug>.mp3` and played by the drill page's "Listen" control.

Voices are **unlockable** — the player picks one from the voice chips; more voices
unlock as the player completes more drills (framework in `index.html`,
`THWAP_VOICES`). Canadian is the starter voice, always unlocked.

## Voices

| code | label | ElevenLabs voice ID | unlockAt |
|------|-------|---------------------|----------|
| `can` | Canadian | `dllHSct4GokGc1AH9JwT` | 0 (starter) |

Add the next voice by (1) picking/creating it in your ElevenLabs account, (2) adding
a row to `VOICES` in `scripts/generate-audio.js` and to `THWAP_VOICES` in
`index.html` (with an `unlockAt` drill-count threshold), (3) running the generator
for that voice code, (4) committing the new `audio/<code>/` MP3s.

## Generating the audio (run locally — needs the ElevenLabs key)

The generator reads `ELEVENLABS_API_KEY` from your environment or a local
`.env.local` file. **The key is never committed** (`.env.local` is gitignored) and
never printed. It is used only when you run the generator on your machine.

```bash
# key must be available as env var OR in .env.local (ELEVENLABS_API_KEY=...)
node scripts/generate-audio.js --voice can            # all 54 Canadian clips
node scripts/generate-audio.js --voice can --only stick_01,dry_07   # a subset
node scripts/generate-audio.js --voice can --force    # re-generate existing clips
```

Output lands in `audio/can/`. Listen to a few (especially the countdowns and any
hockey jargon), then commit the MP3s and deploy. Delivery settings (model, stability,
similarity, style, speaker boost) come from the recording brief and are frozen in the
script — keep them identical across all clips of a voice for consistency.

Cost note: each run of a full voice is ~54 metered TTS calls on your ElevenLabs plan.
Generating is a one-time batch per voice; playback afterward is free (static files).
