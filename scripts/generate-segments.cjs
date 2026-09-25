#!/usr/bin/env node
/*
 * Thwap segment-audio generator (timer-driven model).
 *
 * Reads scripts/segments.json (key -> spoken text) and writes each as
 * audio/<voice>/seg/<key>.mp3. Keys may contain '/' (e.g. cue/go,
 * drill/stick_07/setup) -> nested folders are created.
 *
 * Shared cues + numbers are reused across every drill; only per-drill setup
 * lines are unique. Far fewer/shorter TTS calls than one long clip per drill,
 * and the app's timer fires each segment at its exact phase for zero drift.
 *
 * Usage:
 *   node scripts/generate-segments.cjs --voice can
 *   node scripts/generate-segments.cjs --voice can --only n1,n2,cue/go
 *   node scripts/generate-segments.cjs --voice can --force
 *
 * Key (env or .env.local ELEVENLABS_API_KEY) never printed. See generate-audio.cjs header.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const VOICES = {
  can: { id: 'dllHSct4GokGc1AH9JwT', label: 'Canadian hockey voice' },
  mn:  { id: 'MqdBjMcqClsTO77t1vGB', label: 'Minnesota hockey voice' },
  us:  { id: 'kpftzLQxRv90Nn6qoJRf', label: 'American hockey voice' },
  bos: { id: 'UZvBfqEdvCFLqsBOo9Zr', label: 'Boston hockey voice' },
  ny:  { id: 'q3pCVYOxlOb5G3l2O13o', label: 'New Yorker hockey voice' },
  rus: { id: 'u5UJ3o5MZq3cWrXIXi37', label: 'Russian hockey voice' },
  swe: { id: 'TIMFVcMCO4bdy7J79GWF', label: 'Swedish hockey voice' },
  fin: { id: 'KQem9e29QRWURqusQZoF', label: 'Finnish hockey voice' },
};
const MODEL_ID = 'eleven_multilingual_v2';
const VOICE_SETTINGS = { stability: 0.5, similarity_boost: 0.8, style: 0.35, use_speaker_boost: true };

function loadKey() {
  if (process.env.ELEVENLABS_API_KEY) return process.env.ELEVENLABS_API_KEY.trim();
  const candidates = [
    process.env.ELEVENLABS_ENV_FILE,
    path.join(__dirname, '..', '.env.local'),
    path.join(__dirname, '..', '..', 'thwaphockey-site', '.env.local'),
    '/Users/woodymac/.kiro/crew/workspace/thwaphockey-site/.env.local',
  ].filter(Boolean);
  for (const f of candidates) {
    try {
      const m = fs.readFileSync(f, 'utf8').match(/^\s*ELEVENLABS_API_KEY\s*=\s*(.+)\s*$/m);
      if (m) return m[1].replace(/^["']|["']$/g, '').trim();
    } catch (_) {}
  }
  return null;
}
function parseArgs() {
  const a = process.argv.slice(2); const out = { voice: 'can', only: null, force: false };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--voice') out.voice = a[++i];
    else if (a[i] === '--only') out.only = a[++i].split(',').map(s => s.trim());
    else if (a[i] === '--force') out.force = true;
  }
  return out;
}
async function tts(text, voiceId, apiKey) {
  const res = await fetch('https://api.elevenlabs.io/v1/text-to-speech/' + voiceId, {
    method: 'POST',
    headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json', 'Accept': 'audio/mpeg' },
    body: JSON.stringify({ text, model_id: MODEL_ID, voice_settings: VOICE_SETTINGS }),
  });
  if (!res.ok) { const b = await res.text().catch(() => ''); throw new Error('ElevenLabs ' + res.status + ': ' + b.slice(0, 200)); }
  return Buffer.from(await res.arrayBuffer());
}
async function main() {
  const { voice, only, force } = parseArgs();
  const v = VOICES[voice];
  if (!v) { console.error('Unknown voice "' + voice + '". Known: ' + Object.keys(VOICES).join(', ')); process.exit(1); }
  const apiKey = loadKey();
  if (!apiKey) { console.error('ELEVENLABS_API_KEY not found (env or .env.local).'); process.exit(1); }
  const segs = JSON.parse(fs.readFileSync(path.join(__dirname, 'segments.json'), 'utf8'));
  const base = path.join(__dirname, '..', 'audio', voice, 'seg');
  let keys = Object.keys(segs).filter(k => k[0] !== '_');
  if (only) keys = keys.filter(k => only.includes(k));
  console.log('Voice: ' + v.label + ' (' + voice + ')  •  ' + keys.length + ' segments  •  out: audio/' + voice + '/seg/');
  let done = 0, skipped = 0, failed = 0;
  for (const key of keys) {
    const outFile = path.join(base, key + '.mp3');
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    if (!force && fs.existsSync(outFile)) { skipped++; continue; }
    try {
      const buf = await tts(segs[key], v.id, apiKey);
      fs.writeFileSync(outFile, buf); done++;
      console.log('  \u2713 ' + key + '.mp3  (' + (buf.length / 1024).toFixed(0) + ' KB)');
      await new Promise(r => setTimeout(r, 300));
    } catch (e) { failed++; console.error('  \u2717 ' + key + ': ' + e.message); }
  }
  console.log('\nDone: ' + done + ' generated, ' + skipped + ' skipped, ' + failed + ' failed.');
  if (failed) process.exit(2);
}
main().catch(e => { console.error(e); process.exit(1); });
