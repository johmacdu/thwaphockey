import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

describe('UI sound layer', () => {
  it('ships the thwapSfx engine and the 10 owned hockey clips referenced from /sfx', () => {
    expect(html).toContain('window.thwapSfx=play');
    for (const f of ['tap', 'done', 'hands', 'bardown', 'buzzer', 'whistle',
      'goal-crowd', 'skate-nav', 'card-open', 'skate-loop']) {
      expect(html).toContain(`sfx/${f}.mp3`);
    }
  });

  it('is ON by default (thwapSfxOn only OFF when explicitly "0"), separate from narration mute', () => {
    expect(html).toContain("localStorage.getItem('thwapSfxOn')!=='0'");
    // narration mute (#gdrAudio / thwapMuted) is a different control and must remain
    expect(html).toContain('thwapMuted');
  });

  it('renders the mute toggle immediately before the footer theme toggle', () => {
    const i = html.indexOf("id='sfxToggle'");
    const j = html.indexOf("id='themeToggle'");
    expect(i).toBeGreaterThan(-1);
    expect(j).toBeGreaterThan(-1);
    expect(i).toBeLessThan(j);
    // both live inside .footer-actions
    const fa = html.indexOf("<div class='footer-actions'>");
    expect(fa).toBeGreaterThan(-1);
    expect(fa).toBeLessThan(i);
  });

  it('hooks the real seams: done drills, per-discipline rewards, card open, and the drag-spin glide', () => {
    expect(html).toContain("t.closest('.exdone')");            // Mark done -> puck off boards
    expect(html).toContain("thwapSfx('shootReward')");         // shooting -> bar down
    expect(html).toContain("thwapSfx('handsReward')");         // stickhandling -> stick tick
    expect(html).toContain("thwapSfx('drylandReward')");       // dryland -> buzzer
    expect(html).toContain("thwapSfx('cardOpen')");            // open player card -> glide + settle
    expect(html).toContain('thwapSfxGlideStart()');            // drag-spin: continuous skate glide
    expect(html).toContain('thwapSfxGlideStop()');
  });

  it('silences the celebratory sounds under prefers-reduced-motion', () => {
    expect(html).toContain('prefers-reduced-motion: reduce');
    expect(html).toContain('reduce&&CELEBRATE[name]');
  });
});
