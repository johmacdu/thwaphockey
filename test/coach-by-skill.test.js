// test/coach-by-skill.test.js
//
// EXECUTION test: boots index.html in jsdom AS A COACH and checks the coach-home
// "This week by skill" panel -- per-discipline participation built from each
// roster member's weekly split, including iq + pass. Guards that the coach can
// finally see who trained Hockey IQ and Passing, and the tap-to-expand who/
// who-hasn't detail.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { JSDOM } from 'jsdom';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(__dirname, '../index.html'), 'utf8');

const COACH = { token: 'tkn', email: 'coach@test.com', name: 'Coach', teams: ['TESTTEAM'], teamList: [{ code: 'TESTTEAM', name: 'Test Team' }], childPlayerId: null };

const ROSTER = {
  ok: true,
  team: { code: 'TESTTEAM', name: 'Test Team' },
  participation: { trained: 2, total: 3 },
  members: [
    { playerId: 'alder', firstName: 'Alder', lastName: '', week: { stick: 2, shoot: 1, dryland: 0, iq: 1, pass: 0 }, idpGoal: 'x' },
    { playerId: 'brook', firstName: 'Brooklyn', lastName: '', week: { stick: 0, shoot: 0, dryland: 0, iq: 0, pass: 1 }, idpGoal: '' },
    { playerId: 'cole', firstName: 'Cole', lastName: '', week: { stick: 3, shoot: 2, dryland: 1, iq: 0, pass: 1 }, idpGoal: 'y' },
  ],
};

async function boot() {
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'https://thwaphockey.com/',
    beforeParse(window) {
      window.scrollTo = () => {};
      window.HTMLMediaElement.prototype.play = () => Promise.resolve();
      try { window.localStorage.setItem('thwapCoach', JSON.stringify(COACH)); } catch (e) { /* noop */ }
      window.fetch = (u) => {
        const url = String(u);
        if (url.indexOf('action=roster') >= 0) return Promise.resolve({ ok: true, json: () => Promise.resolve(ROSTER) });
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: false }) });
      };
    },
  });
  await new Promise((r) => setTimeout(r, 140));
  return dom.window;
}

function rowFor(win, label) {
  return Array.from(win.document.querySelectorAll('#chBySkillList .bskill-row'))
    .find((r) => r.querySelector('.bskill-lab') && r.querySelector('.bskill-lab').textContent === label);
}

describe('coach home: This week by skill', () => {
  it('renders a row per discipline, including Hockey IQ and Passing', async () => {
    const win = await boot();
    expect(win.document.getElementById('chBySkill').hidden).toBe(false);
    const labels = Array.from(win.document.querySelectorAll('#chBySkillList .bskill-lab')).map((e) => e.textContent);
    expect(labels).toEqual(['Hands', 'Shooting', 'Dryland', 'Hockey IQ', 'Passing']);
  });

  it('counts how many trained each skill this week', async () => {
    const win = await boot();
    // stick: Alder + Cole = 2/3 ; iq: Alder only = 1/3 ; pass: Brooklyn + Cole = 2/3
    expect(rowFor(win, 'Hands').querySelector('.bskill-count').textContent).toBe('2/3');
    expect(rowFor(win, 'Hockey IQ').querySelector('.bskill-count').textContent).toBe('1/3');
    expect(rowFor(win, 'Passing').querySelector('.bskill-count').textContent).toBe('2/3');
  });

  it('tapping a skill reveals who has and has not done it', async () => {
    const win = await boot();
    const passRow = rowFor(win, 'Passing');
    const detail = passRow.nextElementSibling; // the .bskill-detail
    expect(detail.hidden).toBe(true);
    passRow.dispatchEvent(new win.Event('click', { bubbles: true }));
    expect(detail.hidden).toBe(false);
    // Passing: did it = Brooklyn, Cole ; not yet = Alder
    expect(detail.textContent).toContain('Alder');     // not yet
    expect(detail.textContent).toContain('Brooklyn');  // did it
    expect(detail.textContent).toContain('Cole');
  });
});
