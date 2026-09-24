#!/usr/bin/env node
/*
 * Thwap drill-audio generator (one-time batch, run locally by the user).
 *
 * Reads ELEVENLABS_API_KEY from the environment or a local .env.local file
 * (NEVER hardcoded, never printed). Produces one MP3 per drill script for a
 * given voice, at audio/<voiceCode>/<slug>.mp3.
 *
 * Usage:
 *   node scripts/generate-audio.js --voice can
 *   node scripts/generate-audio.js --voice can --only stick_01,dry_07   # subset
 *   node scripts/generate-audio.js --voice can --force                  # re-gen existing
 *
 * The key is loaded from (first hit wins):
 *   1. process.env.ELEVENLABS_API_KEY
 *   2. .env.local in this repo root
 *   3. ../thwaphockey-site/.env.local  (the main checkout, where the user added it)
 */
'use strict';
const fs = require('fs');
const path = require('path');

// ---- voices registry: add the next voice's ID here as they're created ----
const VOICES = {
  can: { id: 'dllHSct4GokGc1AH9JwT', label: 'Canadian hockey voice' },
  // mn:  { id: '...', label: 'MN hockey voice' },
  // bos: { id: '...', label: 'Boston hockey voice' },
  // nynj:{ id: '...', label: 'NJ/NY hockey voice' },
  // qc:  { id: '...', label: 'French Canadian (English) voice' },
  // rus: { id: '...', label: 'Russian (English) voice' },
  // swe: { id: '...', label: 'Swede (English) voice' },
};

// ElevenLabs delivery settings from the recording brief (frozen per voice).
const MODEL_ID = 'eleven_multilingual_v2';
const VOICE_SETTINGS = {
  stability: 0.45,
  similarity_boost: 0.80,
  style: 0.40,
  use_speaker_boost: true,
};

function loadKey() {
  if (process.env.ELEVENLABS_API_KEY) return process.env.ELEVENLABS_API_KEY.trim();
  const candidates = [
    path.join(__dirname, '..', '.env.local'),
    path.join(__dirname, '..', '..', 'thwaphockey-site', '.env.local'),
  ];
  for (const f of candidates) {
    try {
      const txt = fs.readFileSync(f, 'utf8');
      const m = txt.match(/^\s*ELEVENLABS_API_KEY\s*=\s*(.+)\s*$/m);
      if (m) return m[1].replace(/^["']|["']$/g, '').trim();
    } catch (_) { /* not present */ }
  }
  return null;
}

function parseArgs() {
  const a = process.argv.slice(2);
  const out = { voice: 'can', only: null, force: false };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--voice') out.voice = a[++i];
    else if (a[i] === '--only') out.only = a[++i].split(',').map(s => s.trim());
    else if (a[i] === '--force') out.force = true;
  }
  return out;
}

async function tts(text, voiceId, apiKey) {
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
      'Accept': 'audio/mpeg',
    },
    body: JSON.stringify({
      text,
      model_id: MODEL_ID,
      voice_settings: VOICE_SETTINGS,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`ElevenLabs ${res.status}: ${body.slice(0, 300)}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  return buf;
}

async function main() {
  const { voice, only, force } = parseArgs();
  const v = VOICES[voice];
  if (!v) {
    console.error(`Unknown voice "${voice}". Known: ${Object.keys(VOICES).join(', ')}`);
    process.exit(1);
  }
  const apiKey = loadKey();
  if (!apiKey) {
    console.error('ELEVENLABS_API_KEY not found (env or .env.local). See scripts/generate-audio.js header.');
    process.exit(1);
  }
  const scriptsPath = path.join(__dirname, 'audio-scripts.json');
  const scripts = JSON.parse(fs.readFileSync(scriptsPath, 'utf8'));
  const outDir = path.join(__dirname, '..', 'audio', voice);
  fs.mkdirSync(outDir, { recursive: true });

  let slugs = Object.keys(scripts);
  if (only) slugs = slugs.filter(s => only.includes(s));

  console.log(`Voice: ${v.label} (${voice})  •  ${slugs.length} clips  •  out: audio/${voice}/`);
  let done = 0, skipped = 0, failed = 0;
  for (const slug of slugs) {
    const outFile = path.join(outDir, `${slug}.mp3`);
    if (!force && fs.existsSync(outFile)) { skipped++; continue; }
    try {
      const buf = await tts(scripts[slug], v.id, apiKey);
      fs.writeFileSync(outFile, buf);
      done++;
      console.log(`  ✓ ${slug}.mp3  (${(buf.length / 1024).toFixed(0)} KB)`);
      await new Promise(r => setTimeout(r, 350)); // gentle pacing
    } catch (e) {
      failed++;
      console.error(`  ✗ ${slug}: ${e.message}`);
    }
  }
  console.log(`\nDone: ${done} generated, ${skipped} skipped (exist), ${failed} failed.`);
  if (failed) process.exit(2);
}

main().catch(e => { console.error(e); process.exit(1); });
