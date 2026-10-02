// test/shoot-prog-date-key.test.js
//
// Guard for the shooting progress localStorage key in index.html.
//
// BUG (fixed here): shootKey() keyed the per-day completion ONLY by rotation
// slot ('thwapShootProg|day'+shootDayI()), with NO date and NO player. Because
// shootDayI() is weekday % SHOOT_DAYS.length, the SAME key is reused every time
// that weekday-slot comes around. So a player who finished shooting on a prior
// day that mapped to the same slot had that key still set, and the next such day
// read it back as already-done -- every shoot drill showed checked without being
// done (the exact "Lewie's shooting was marked done and he didn't do them" bug).
//
// Stickhandling (bfStick|<player>|<todayKey>) and Dryland
// (bfDryland|<player>|<todayKey>|<wid>) were already date-scoped; only shooting
// was not. The fix scopes shootKey() by player + calendar date too, so a new day
// always starts fresh. This is display state only -- it does not touch the server
// counts/stickers, so no stats are reset.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dir, '..', 'index.html'), 'utf8');

describe('shoot progress key is date + player scoped', () => {
  it('includes a per-player and per-date component (not slot-only)', () => {
    // Capture the whole one-line shootKey() definition (it ends with
    // "'|day'+shootDayI(); }" on a single line in index.html).
    const m = html.match(/function shootKey\(\)\{[^\n]*shootDayI\(\);\s*\}/);
    expect(m, 'shootKey() must exist on one line').toBeTruthy();
    const body = m[0];
    // The returned key must still be a thwapShootProg key and still disambiguate
    // the rotation day, but ALSO carry the player and the calendar date.
    expect(body).toContain("'thwapShootProg|'");
    expect(body).toContain('bfPlayer'); // player scoping
    expect(body).toContain("getFullYear()"); // date scoping (y-m-d)
    expect(body).toContain("shootDayI()"); // keeps rotation-day disambiguation
  });

  it('does NOT use the old slot-only key that caused the false-done bug', () => {
    expect(html).not.toContain(
      "function shootKey(){ return 'thwapShootProg|day'+shootDayI(); }"
    );
  });
});
