# Drill narration audio (timer-driven segments)

Sass narrates every drill in step with the on-screen timer. Audio is split into
small **segments** that the drill runner fires at each phase transition, so the
narration can never drift from the on-screen count:

- **setup** — the drill's intro cue (per drill)
- **countdown** — number segments `n5,n4,n3,n2,n1` then `cue/go`
- **reps** — number segments `n1..nN` fired as each rep number appears
- **switch** — `cue/switch` on a dedicated step between sides
- **finish** — `cue/done`

Segments live at `audio/<voiceCode>/seg/<key>.mp3`. Numbers (`n1`..`n20`) and the
shared `cue/*` clips are reused across every drill; only `drill/<slug>/setup` is
unique per drill. The app plays them via a timer-driven controller in `index.html`
(`thwapPlayCue`), with a rep-scoped metronome tick and a Mute toggle. The metronome
is a synced Web Audio tick (no audio file), muted with the narration.

## Voices

| code | label | ElevenLabs voice ID | unlockAt |
|------|-------|---------------------|----------|
| `can` | Canadian | `5ZvI0fBo2w7CxuiM9ObF` | 0 |
| `mn`  | Minnesotan | `MqdBjMcqClsTO77t1vGB` | 0 |
| `ny`  | New Yorker | _needs ElevenLabs voice ID_ | 20 |
| `chi` | Chicagoan | `erLaZvTFBCJD969knK8N` | 20 |
| `bos` | Bostonian | `UZvBfqEdvCFLqsBOo9Zr` | 20 |
| `fca` | French Canadian | _needs ElevenLabs voice ID_ | 20 |
| `fin` | Finnish | _needs ElevenLabs voice ID_ | 20 |
| `swe` | Swedish | _needs ElevenLabs voice ID_ | 20 |
| `rus` | Russian | _needs ElevenLabs voice ID_ | 20 |
| `dan` | Danish | _needs ElevenLabs voice ID_ | 20 |

(`us`/American was removed from the app list; its clips can stay or be deleted.)

Add a voice: (1) pick/create it in ElevenLabs, (2) add a row to `VOICES` in
`scripts/generate-segments.cjs` and to `THWAP_VOICES` in `index.html`, (3) run the
generator for that voice code, (4) commit the new `audio/<code>/seg/` clips.

## Generating (run locally — needs the ElevenLabs key)

Reads `ELEVENLABS_API_KEY` from env or a gitignored `.env.local` (never committed,
never printed). Segment text is `scripts/segments.json`.

```bash
node scripts/generate-segments.cjs --voice can          # all segments, Canadian
node scripts/generate-segments.cjs --voice mn           # Minnesota
node scripts/generate-segments.cjs --voice can --only n1,cue/go,drill/stick_07/setup
node scripts/generate-segments.cjs --voice can --force  # re-generate existing
```

Existing clips are skipped unless `--force`. Cost: a full voice is ~82 short TTS
calls, one-time; playback afterward is free static files.
